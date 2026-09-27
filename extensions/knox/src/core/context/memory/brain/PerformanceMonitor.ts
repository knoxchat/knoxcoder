/**
 * PerformanceMonitor — Self-management & reliability module.
 *
 * Mirrors Knox-MS operational excellence patterns:
 *
 * 1. **Performance Metrics Collection** — Track response times, token usage,
 *    success/failure rates across all memory operations.
 *
 * 2. **Healing Actions Library** — Auto-remediation beyond VACUUM:
 *    rebalance tiers, clear stale data, repair indices, purge orphans.
 *
 * 3. **Multi-dimensional Health Scoring** — Weighted composite score
 *    across latency, accuracy, efficiency, and capacity dimensions.
 *
 * 4. **Predictive Analytics** — Exponential Moving Average (EMA) forecasting
 *    for capacity planning and growth rate estimation.
 *
 * 5. **Adaptive Strategy Selection** — Track which healing strategies work
 *    best and prefer them automatically.
 *
 * 6. **Consolidation Stats API** — Expose scheduler state, run counts,
 *    last run time, average duration, and cycle history.
 */

import { BrainStore } from "./BrainStore.js";
import { ResilientLlm } from "./LlmResilience.js";
import type { HealthStatus, SleepSubPhaseCounts } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OperationMetric {
  operation: string;
  duration_ms: number;
  token_count: number;
  success: boolean;
  timestamp: number;
}

export interface MetricsSummary {
  total_operations: number;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
  p99_response_ms: number;
  total_tokens_used: number;
  operations_per_minute: number;
  by_operation: Record<string, {
    count: number;
    success_rate: number;
    avg_ms: number;
    p95_ms: number;
    total_tokens: number;
  }>;
  uptime_ms: number;
}

export interface HealthScore {
  overall: number; // 0.0–1.0
  dimensions: {
    latency: number;      // Response time health (lower is better)
    accuracy: number;     // Success rate health
    efficiency: number;   // Token usage efficiency
    capacity: number;     // Storage / tier balance health
    fragmentation: number; // DB fragmentation health
  };
  weights: {
    latency: number;
    accuracy: number;
    efficiency: number;
    capacity: number;
    fragmentation: number;
  };
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface CapacityForecast {
  current_db_size_bytes: number;
  growth_rate_bytes_per_day: number;
  days_until_100mb: number | null;
  days_until_500mb: number | null;
  memory_growth_rate_per_day: number;
  ema_response_ms: number;
  ema_tokens_per_op: number;
  trend: "stable" | "growing" | "shrinking" | "accelerating";
  recommendations: string[];
}

export type HealingAction =
  | "vacuum"
  | "reindex"
  | "rebalance_tiers"
  | "clear_stale_sessions"
  | "purge_orphan_associations"
  | "compress_cold"
  | "prune_expired"
  | "repair_counts"
  | "defragment_graph";

export interface HealingResult {
  action: HealingAction;
  success: boolean;
  duration_ms: number;
  details: string;
  impact: number; // 0.0–1.0 measured improvement
}

export interface HealingStrategy {
  action: HealingAction;
  total_runs: number;
  success_count: number;
  avg_impact: number;
  avg_duration_ms: number;
  last_run_at: number;
  effectiveness: number; // computed: success_rate * avg_impact
}

export interface ConsolidationStats {
  total_runs: number;
  last_run_at: string | null;
  last_duration_ms: number;
  avg_duration_ms: number;
  total_promoted: number;
  total_demoted: number;
  total_pruned: number;
  total_distilled: number;
  total_replayed: number;
  total_compressed: number;
  scheduler_active: boolean;
  scheduler_interval_hours: number;
  next_scheduled_at: string | null;
  /** Last sleep cycle sub-phase breakdown (IMP-06). */
  last_sub_phases: SleepSubPhaseCounts | null;
  cycle_history: Array<{
    timestamp: string;
    duration_ms: number;
    promoted: number;
    demoted: number;
    pruned: number;
  }>;
}

// ── Performance Metrics Collection ───────────────────────────────────────────

export class MetricsCollector {
  private metrics: OperationMetric[] = [];
  private maxHistory = 5000;
  private startTime = Date.now();

  /**
   * Record a single operation metric.
   */
  record(metric: OperationMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxHistory) {
      // Keep only the most recent half
      this.metrics = this.metrics.slice(-Math.floor(this.maxHistory / 2));
    }
  }

  /**
   * Convenience: measure an async operation and record its metric.
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    tokenCount: number = 0,
  ): Promise<T> {
    const start = performance.now();
    let success = true;
    try {
      const result = await fn();
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      this.record({
        operation,
        duration_ms: performance.now() - start,
        token_count: tokenCount,
        success,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get a full summary of collected metrics.
   */
  getSummary(windowMs?: number): MetricsSummary {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const recent = this.metrics.filter((m) => m.timestamp >= cutoff);

    if (recent.length === 0) {
      return {
        total_operations: 0,
        success_rate: 1,
        avg_response_ms: 0,
        p95_response_ms: 0,
        p99_response_ms: 0,
        total_tokens_used: 0,
        operations_per_minute: 0,
        by_operation: {},
        uptime_ms: Date.now() - this.startTime,
      };
    }

    const durations = recent.map((m) => m.duration_ms).sort((a, b) => a - b);
    const successCount = recent.filter((m) => m.success).length;
    const totalTokens = recent.reduce((s, m) => s + m.token_count, 0);

    const windowActual = recent.length > 1
      ? recent[recent.length - 1].timestamp - recent[0].timestamp
      : 60000;
    const opsPerMin = windowActual > 0
      ? (recent.length / windowActual) * 60000
      : 0;

    // Per-operation breakdown
    const byOp: Record<string, OperationMetric[]> = {};
    for (const m of recent) {
      (byOp[m.operation] ??= []).push(m);
    }

    const byOperation: MetricsSummary["by_operation"] = {};
    for (const [op, ms] of Object.entries(byOp)) {
      const sorted = ms.map((m) => m.duration_ms).sort((a, b) => a - b);
      const opSuccess = ms.filter((m) => m.success).length;
      byOperation[op] = {
        count: ms.length,
        success_rate: ms.length > 0 ? opSuccess / ms.length : 1,
        avg_ms: sorted.reduce((s, d) => s + d, 0) / sorted.length,
        p95_ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        total_tokens: ms.reduce((s, m) => s + m.token_count, 0),
      };
    }

    return {
      total_operations: recent.length,
      success_rate: successCount / recent.length,
      avg_response_ms: durations.reduce((s, d) => s + d, 0) / durations.length,
      p95_response_ms: durations[Math.floor(durations.length * 0.95)] ?? 0,
      p99_response_ms: durations[Math.floor(durations.length * 0.99)] ?? 0,
      total_tokens_used: totalTokens,
      operations_per_minute: opsPerMin,
      by_operation: byOperation,
      uptime_ms: Date.now() - this.startTime,
    };
  }

  /**
   * Clear all recorded metrics.
   */
  reset(): void {
    this.metrics = [];
    this.startTime = Date.now();
  }

  /**
   * Get raw metrics count for diagnostics.
   */
  getCount(): number {
    return this.metrics.length;
  }
}

// ── Multi-dimensional Health Scoring ────────────────────────────────────────

export class HealthScorer {
  private static readonly DEFAULT_WEIGHTS = {
    latency: 0.20,
    accuracy: 0.30,
    efficiency: 0.15,
    capacity: 0.25,
    fragmentation: 0.10,
  };

  /**
   * Compute a composite health score across multiple dimensions.
   *
   * Each dimension is scored 0.0–1.0 (1.0 = perfect health).
   * The overall score is a weighted average.
   */
  static async score(
    metrics: MetricsSummary,
    basicHealth: HealthStatus,
    weights?: Partial<typeof HealthScorer.DEFAULT_WEIGHTS>,
  ): Promise<HealthScore> {
    const w = { ...HealthScorer.DEFAULT_WEIGHTS, ...weights };

    // ── Latency dimension ──
    // < 50ms = 1.0, 50-200ms = good, 200-1000ms = degraded, >1s = poor
    const avgMs = metrics.avg_response_ms;
    const latency = avgMs <= 50 ? 1.0
      : avgMs <= 200 ? 1.0 - ((avgMs - 50) / 150) * 0.3
      : avgMs <= 1000 ? 0.7 - ((avgMs - 200) / 800) * 0.4
      : Math.max(0.1, 0.3 - ((avgMs - 1000) / 5000) * 0.2);

    // ── Accuracy dimension ──
    // Direct success rate mapping
    const accuracy = metrics.success_rate;

    // ── Efficiency dimension ──
    // Token usage per operation (lower is better for memory ops)
    const avgTokensPerOp = metrics.total_operations > 0
      ? metrics.total_tokens_used / metrics.total_operations
      : 0;
    const efficiency = avgTokensPerOp <= 100 ? 1.0
      : avgTokensPerOp <= 500 ? 1.0 - ((avgTokensPerOp - 100) / 400) * 0.3
      : avgTokensPerOp <= 2000 ? 0.7 - ((avgTokensPerOp - 500) / 1500) * 0.3
      : Math.max(0.2, 0.4 - ((avgTokensPerOp - 2000) / 10000) * 0.2);

    // ── Capacity dimension ──
    // Based on tier balance and total memory count
    const db = await BrainStore.get();
    const tierCounts = await db.all(
      `SELECT tier, COUNT(*) as c FROM (
        SELECT tier FROM brain_episodic UNION ALL SELECT tier FROM brain_semantic
      ) GROUP BY tier`,
    );
    const tiers: Record<string, number> = { hot: 0, warm: 0, cold: 0 };
    for (const r of tierCounts) {
      tiers[(r as any).tier] = (r as any).c;
    }
    const totalMem = tiers.hot + tiers.warm + tiers.cold;

    let capacity = 1.0;
    if (totalMem > 0) {
      const hotRatio = tiers.hot / totalMem;
      // Ideal: 20-40% hot. Too many hot = overloaded, too few = under-utilized
      if (hotRatio > 0.6) capacity -= (hotRatio - 0.6) * 1.5;
      else if (hotRatio < 0.1 && totalMem > 50) capacity -= 0.2;

      // Penalize very large DBs
      const dbMb = basicHealth.db_size_bytes / (1024 * 1024);
      if (dbMb > 200) capacity -= 0.3;
      else if (dbMb > 100) capacity -= 0.15;
      else if (dbMb > 50) capacity -= 0.05;
    }
    capacity = Math.max(0.1, Math.min(1.0, capacity));

    // ── Fragmentation dimension ──
    const fragmentation = Math.max(0, 1.0 - basicHealth.fragmentation_ratio * 3);

    // ── Weighted overall ──
    const overall =
      latency * w.latency +
      accuracy * w.accuracy +
      efficiency * w.efficiency +
      capacity * w.capacity +
      fragmentation * w.fragmentation;

    const grade: HealthScore["grade"] =
      overall >= 0.9 ? "A"
      : overall >= 0.75 ? "B"
      : overall >= 0.6 ? "C"
      : overall >= 0.4 ? "D"
      : "F";

    return {
      overall,
      dimensions: { latency, accuracy, efficiency, capacity, fragmentation },
      weights: w,
      grade,
    };
  }
}

// ── Predictive Analytics (EMA Forecasting) ──────────────────────────────────

export class PredictiveAnalytics {
  // EMA state
  private emaResponseMs: number = 0;
  private emaTokensPerOp: number = 0;
  private emaMemoryGrowth: number = 0;
  private lastDbSizeBytes: number = 0;
  private lastSnapshotTime: number = 0;
  private sizeHistory: Array<{ time: number; size: number }> = [];
  private initialized = false;
  private alpha: number; // EMA smoothing factor (0.0–1.0)

  constructor(alpha: number = 0.2) {
    this.alpha = alpha;
  }

  /**
   * Update EMA values with new observations.
   */
  update(metrics: MetricsSummary, dbSizeBytes: number): void {
    const now = Date.now();

    if (!this.initialized) {
      this.emaResponseMs = metrics.avg_response_ms;
      this.emaTokensPerOp = metrics.total_operations > 0
        ? metrics.total_tokens_used / metrics.total_operations
        : 0;
      this.lastDbSizeBytes = dbSizeBytes;
      this.lastSnapshotTime = now;
      this.sizeHistory.push({ time: now, size: dbSizeBytes });
      this.initialized = true;
      return;
    }

    // EMA update: new = α * observation + (1-α) * previous
    this.emaResponseMs = this.alpha * metrics.avg_response_ms + (1 - this.alpha) * this.emaResponseMs;

    const currentTokensPerOp = metrics.total_operations > 0
      ? metrics.total_tokens_used / metrics.total_operations
      : this.emaTokensPerOp;
    this.emaTokensPerOp = this.alpha * currentTokensPerOp + (1 - this.alpha) * this.emaTokensPerOp;

    // Growth rate in bytes/day
    const elapsedMs = now - this.lastSnapshotTime;
    if (elapsedMs > 60000) { // At least 1 minute between snapshots
      const growthBytes = dbSizeBytes - this.lastDbSizeBytes;
      const growthPerDay = elapsedMs > 0 ? (growthBytes / elapsedMs) * 86400000 : 0;
      this.emaMemoryGrowth = this.alpha * growthPerDay + (1 - this.alpha) * this.emaMemoryGrowth;
      this.lastDbSizeBytes = dbSizeBytes;
      this.lastSnapshotTime = now;

      this.sizeHistory.push({ time: now, size: dbSizeBytes });
      if (this.sizeHistory.length > 100) {
        this.sizeHistory = this.sizeHistory.slice(-50);
      }
    }
  }

  /**
   * Generate capacity forecast based on EMA trends.
   */
  forecast(currentDbSizeBytes: number, currentMemoryCount: number): CapacityForecast {
    const growthRate = Math.max(0, this.emaMemoryGrowth);
    const limit100mb = 100 * 1024 * 1024;
    const limit500mb = 500 * 1024 * 1024;

    const daysUntil100mb = growthRate > 0 && currentDbSizeBytes < limit100mb
      ? (limit100mb - currentDbSizeBytes) / growthRate
      : null;

    const daysUntil500mb = growthRate > 0 && currentDbSizeBytes < limit500mb
      ? (limit500mb - currentDbSizeBytes) / growthRate
      : null;

    // Estimate memory count growth from DB growth
    const avgMemoryBytes = currentMemoryCount > 0 ? currentDbSizeBytes / currentMemoryCount : 500;
    const memGrowthPerDay = avgMemoryBytes > 0 ? growthRate / avgMemoryBytes : 0;

    // Determine trend from recent history
    let trend: CapacityForecast["trend"] = "stable";
    if (this.sizeHistory.length >= 3) {
      const recent = this.sizeHistory.slice(-5);
      const deltas = [];
      for (let i = 1; i < recent.length; i++) {
        const dt = recent[i].time - recent[i - 1].time;
        if (dt > 0) deltas.push((recent[i].size - recent[i - 1].size) / dt);
      }
      if (deltas.length >= 2) {
        const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
        const lastDelta = deltas[deltas.length - 1];
        if (avgDelta <= 0) trend = "shrinking";
        else if (lastDelta > avgDelta * 1.5) trend = "accelerating";
        else trend = "growing";
      }
    }

    const recommendations: string[] = [];
    if (daysUntil100mb !== null && daysUntil100mb < 30) {
      recommendations.push(`DB will reach 100MB in ~${Math.ceil(daysUntil100mb)} days. Consider running consolidation more frequently.`);
    }
    if (this.emaResponseMs > 500) {
      recommendations.push(`Average response time trending to ${this.emaResponseMs.toFixed(0)}ms. Consider optimizing queries.`);
    }
    if (trend === "accelerating") {
      recommendations.push("DB growth is accelerating. Review auto-extract and episodic retention settings.");
    }

    return {
      current_db_size_bytes: currentDbSizeBytes,
      growth_rate_bytes_per_day: growthRate,
      days_until_100mb: daysUntil100mb,
      days_until_500mb: daysUntil500mb,
      memory_growth_rate_per_day: memGrowthPerDay,
      ema_response_ms: this.emaResponseMs,
      ema_tokens_per_op: this.emaTokensPerOp,
      trend,
      recommendations,
    };
  }
}

// ── Healing Actions Library ─────────────────────────────────────────────────

export class HealingEngine {
  private strategyStats: Map<HealingAction, HealingStrategy> = new Map();

  /**
   * Run a specific healing action with impact measurement.
   */
  async runAction(action: HealingAction): Promise<HealingResult> {
    const start = performance.now();
    let success = false;
    let details = "";
    let impact = 0;

    // Measure health before
    const healthBefore = await BrainStore.getHealth();

    try {
      switch (action) {
        case "vacuum": {
          const db = await BrainStore.get();
          await db.exec("VACUUM");
          details = "Database compacted via VACUUM";
          success = true;
          break;
        }
        case "reindex": {
          const db = await BrainStore.get();
          await db.exec("REINDEX");
          await db.exec("ANALYZE");
          details = "Indexes rebuilt and statistics updated";
          success = true;
          break;
        }
        case "rebalance_tiers": {
          const result = await HealingEngine.rebalanceTiers();
          details = result;
          success = true;
          break;
        }
        case "clear_stale_sessions": {
          const result = await HealingEngine.clearStaleSessions();
          details = result;
          success = true;
          break;
        }
        case "purge_orphan_associations": {
          const result = await HealingEngine.purgeOrphanAssociations();
          details = result;
          success = true;
          break;
        }
        case "compress_cold": {
          const compressed = await BrainStore.compressColdTier();
          details = `Compressed ${compressed} cold-tier memories`;
          success = true;
          break;
        }
        case "prune_expired": {
          const result = await HealingEngine.pruneExpired();
          details = result;
          success = true;
          break;
        }
        case "repair_counts": {
          const result = await HealingEngine.repairCounts();
          details = result;
          success = true;
          break;
        }
        case "defragment_graph": {
          const result = await HealingEngine.defragmentGraph();
          details = result;
          success = true;
          break;
        }
      }

      // Measure health after and compute impact
      const healthAfter = await BrainStore.getHealth();
      const beforeIssues = healthBefore.issues.length;
      const afterIssues = healthAfter.issues.length;
      impact = beforeIssues > 0 ? Math.max(0, (beforeIssues - afterIssues) / beforeIssues) : 0.1;
      // Fragmentation improvement bonus
      if (healthAfter.fragmentation_ratio < healthBefore.fragmentation_ratio) {
        impact = Math.min(1, impact + (healthBefore.fragmentation_ratio - healthAfter.fragmentation_ratio));
      }
    } catch (err: any) {
      details = `Failed: ${err?.message ?? String(err)}`;
    }

    const duration_ms = performance.now() - start;
    const result: HealingResult = { action, success, duration_ms, details, impact };

    // Update strategy stats
    this.recordStrategy(action, success, impact, duration_ms);

    return result;
  }

  /**
   * Auto-heal: run the most effective healing strategies based on current health.
   * Returns all results.
   */
  async autoHeal(health: HealthStatus): Promise<HealingResult[]> {
    const actions = this.selectActions(health);
    const results: HealingResult[] = [];
    for (const action of actions) {
      results.push(await this.runAction(action));
    }
    return results;
  }

  /**
   * Select healing actions based on health issues and adaptive strategy ranking.
   */
  private selectActions(health: HealthStatus): HealingAction[] {
    const actions: Array<{ action: HealingAction; priority: number }> = [];

    // Map issues to candidate actions
    for (const issue of health.issues) {
      const lower = issue.toLowerCase();
      if (lower.includes("fragmentation")) {
        actions.push({ action: "vacuum", priority: 10 });
      }
      if (lower.includes("hot memories") || lower.includes("too many")) {
        actions.push({ action: "rebalance_tiers", priority: 9 });
      }
      if (lower.includes("haven't been accessed")) {
        actions.push({ action: "prune_expired", priority: 7 });
        actions.push({ action: "clear_stale_sessions", priority: 6 });
      }
      if (lower.includes("exceeds") || lower.includes("100mb")) {
        actions.push({ action: "compress_cold", priority: 8 });
        actions.push({ action: "vacuum", priority: 7 });
      }
    }

    // Always consider low-cost maintenance
    if (actions.length === 0) {
      actions.push({ action: "purge_orphan_associations", priority: 3 });
      actions.push({ action: "repair_counts", priority: 2 });
    }

    // Sort by adaptive effectiveness, then by priority
    actions.sort((a, b) => {
      const effA = this.getEffectiveness(a.action);
      const effB = this.getEffectiveness(b.action);
      // Weight effectiveness 60%, priority 40%
      const scoreA = effA * 0.6 + (a.priority / 10) * 0.4;
      const scoreB = effB * 0.6 + (b.priority / 10) * 0.4;
      return scoreB - scoreA;
    });

    // Deduplicate and take top 3
    const seen = new Set<HealingAction>();
    const selected: HealingAction[] = [];
    for (const a of actions) {
      if (!seen.has(a.action)) {
        seen.add(a.action);
        selected.push(a.action);
        if (selected.length >= 3) break;
      }
    }

    return selected;
  }

  /**
   * Get the adaptive effectiveness score for an action (0.0–1.0).
   */
  private getEffectiveness(action: HealingAction): number {
    const stats = this.strategyStats.get(action);
    if (!stats || stats.total_runs === 0) return 0.5; // default for untried
    return stats.effectiveness;
  }

  /**
   * Record outcome of a healing strategy for adaptive learning.
   */
  private recordStrategy(action: HealingAction, success: boolean, impact: number, duration_ms: number): void {
    const existing = this.strategyStats.get(action) ?? {
      action,
      total_runs: 0,
      success_count: 0,
      avg_impact: 0,
      avg_duration_ms: 0,
      last_run_at: 0,
      effectiveness: 0.5,
    };

    existing.total_runs++;
    if (success) existing.success_count++;

    // Running averages
    existing.avg_impact = ((existing.avg_impact * (existing.total_runs - 1)) + impact) / existing.total_runs;
    existing.avg_duration_ms = ((existing.avg_duration_ms * (existing.total_runs - 1)) + duration_ms) / existing.total_runs;
    existing.last_run_at = Date.now();

    // Compute effectiveness: success_rate * avg_impact
    const successRate = existing.success_count / existing.total_runs;
    existing.effectiveness = successRate * existing.avg_impact;

    this.strategyStats.set(action, existing);
  }

  /**
   * Get all strategy statistics (for adaptive strategy selection visibility).
   */
  getStrategies(): HealingStrategy[] {
    return Array.from(this.strategyStats.values()).sort((a, b) => b.effectiveness - a.effectiveness);
  }

  // ── Individual Healing Actions ─────────────────────────────────────────────

  private static async rebalanceTiers(): Promise<string> {
    const db = await BrainStore.get();
    let moved = 0;

    // Force-demote excess hot episodic (keep only last 200 hot)
    const excess = await db.run(
      `UPDATE brain_episodic SET tier = 'warm'
       WHERE tier = 'hot' AND id NOT IN (
         SELECT id FROM brain_episodic WHERE tier = 'hot'
         ORDER BY importance_score DESC, created_at DESC LIMIT 200
       )`,
    );
    moved += excess.changes ?? 0;

    // Force-demote excess hot semantic (keep only top 100 by importance)
    const semExcess = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE tier = 'hot' AND id NOT IN (
         SELECT id FROM brain_semantic WHERE tier = 'hot'
         ORDER BY importance_score DESC, retrieval_count DESC LIMIT 100
       )`,
    );
    moved += semExcess.changes ?? 0;

    return `Rebalanced tiers: moved ${moved} memories from hot to warm`;
  }

  private static async clearStaleSessions(): Promise<string> {
    const db = await BrainStore.get();

    // Find sessions with no activity in 90+ days and no summary
    const stale = await db.run(
      `UPDATE brain_sessions SET is_active = 0
       WHERE is_active = 1
       AND updated_at < datetime('now', '-90 days')`,
    );

    return `Deactivated ${stale.changes ?? 0} stale sessions`;
  }

  private static async purgeOrphanAssociations(): Promise<string> {
    const db = await BrainStore.get();

    // Delete associations pointing to non-existent memories
    const orphanedSemantic = await db.run(
      `DELETE FROM brain_associations
       WHERE (source_type = 'semantic' AND source_id NOT IN (SELECT id FROM brain_semantic))
       OR (target_type = 'semantic' AND target_id NOT IN (SELECT id FROM brain_semantic))`,
    );

    const orphanedEpisodic = await db.run(
      `DELETE FROM brain_associations
       WHERE (source_type = 'episodic' AND source_id NOT IN (SELECT id FROM brain_episodic))
       OR (target_type = 'episodic' AND target_id NOT IN (SELECT id FROM brain_episodic))`,
    );

    const total = (orphanedSemantic.changes ?? 0) + (orphanedEpisodic.changes ?? 0);
    return `Purged ${total} orphan associations`;
  }

  private static async pruneExpired(): Promise<string> {
    const db = await BrainStore.get();
    const deleted = await db.run(
      `DELETE FROM brain_semantic
       WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`,
    );
    return `Pruned ${deleted.changes ?? 0} expired semantic memories`;
  }

  private static async repairCounts(): Promise<string> {
    const db = await BrainStore.get();

    // Fix session message counts
    const fixed = await db.run(
      `UPDATE brain_sessions SET message_count = (
        SELECT COUNT(*) FROM brain_episodic WHERE brain_episodic.session_id = brain_sessions.id
      ) WHERE message_count != (
        SELECT COUNT(*) FROM brain_episodic WHERE brain_episodic.session_id = brain_sessions.id
      )`,
    );

    // Fix entity mention counts
    const entityFixed = await db.run(
      `UPDATE brain_entities SET mention_count = GREATEST(mention_count, 1)
       WHERE mention_count < 1`,
    );

    return `Repaired ${(fixed.changes ?? 0) + (entityFixed.changes ?? 0)} count mismatches`;
  }

  private static async defragmentGraph(): Promise<string> {
    const db = await BrainStore.get();

    // Remove duplicate edges (same source/target/relationship)
    const dupes = await db.run(
      `DELETE FROM brain_graph_edges
       WHERE id NOT IN (
         SELECT MIN(id) FROM brain_graph_edges
         GROUP BY source_entity_id, target_entity_id, relationship
       )`,
    );

    // Remove self-referential edges
    const selfRef = await db.run(
      `DELETE FROM brain_graph_edges
       WHERE source_entity_id = target_entity_id`,
    );

    // Remove edges pointing to deleted entities
    const orphanEdges = await db.run(
      `DELETE FROM brain_graph_edges
       WHERE source_entity_id NOT IN (SELECT id FROM brain_entities)
       OR target_entity_id NOT IN (SELECT id FROM brain_entities)`,
    );

    const total = (dupes.changes ?? 0) + (selfRef.changes ?? 0) + (orphanEdges.changes ?? 0);
    return `Graph defragmented: removed ${total} invalid edges`;
  }
}

// ── Consolidation Stats Tracker ─────────────────────────────────────────────

export class ConsolidationTracker {
  private totalRuns = 0;
  private lastRunAt: string | null = null;
  private lastDurationMs = 0;
  private totalDurationMs = 0;
  private totalPromoted = 0;
  private totalDemoted = 0;
  private totalPruned = 0;
  private totalDistilled = 0;
  private totalReplayed = 0;
  private totalCompressed = 0;
  private lastSubPhases: SleepSubPhaseCounts | null = null;
  private cycleHistory: ConsolidationStats["cycle_history"] = [];
  private maxHistory = 50;
  private schedulerActive = false;
  private schedulerIntervalHours = 0;
  private schedulerStartedAt: number | null = null;

  /**
   * Record a completed consolidation cycle.
   */
  record(result: {
    promoted: number;
    demoted: number;
    pruned: number;
    distilled?: number;
    replayed?: number;
    compressed?: number;
    sub_phases?: SleepSubPhaseCounts;
  }, durationMs: number): void {
    this.totalRuns++;
    this.lastRunAt = new Date().toISOString();
    this.lastDurationMs = durationMs;
    this.totalDurationMs += durationMs;
    this.totalPromoted += result.promoted;
    this.totalDemoted += result.demoted;
    this.totalPruned += result.pruned;
    this.totalDistilled += result.distilled ?? 0;
    this.totalReplayed += result.replayed ?? 0;
    this.totalCompressed += result.compressed ?? 0;
    if (result.sub_phases) {
      this.lastSubPhases = result.sub_phases;
    }

    this.cycleHistory.push({
      timestamp: this.lastRunAt,
      duration_ms: durationMs,
      promoted: result.promoted,
      demoted: result.demoted,
      pruned: result.pruned,
    });

    if (this.cycleHistory.length > this.maxHistory) {
      this.cycleHistory = this.cycleHistory.slice(-this.maxHistory);
    }
  }

  /**
   * Mark scheduler as started.
   */
  setSchedulerActive(active: boolean, intervalHours: number): void {
    this.schedulerActive = active;
    this.schedulerIntervalHours = intervalHours;
    if (active) this.schedulerStartedAt = Date.now();
    else this.schedulerStartedAt = null;
  }

  /**
   * Get full consolidation statistics.
   */
  getStats(): ConsolidationStats {
    let nextScheduledAt: string | null = null;
    if (this.schedulerActive && this.schedulerStartedAt) {
      const intervalMs = this.schedulerIntervalHours * 3600000;
      if (this.lastRunAt) {
        const lastTime = new Date(this.lastRunAt).getTime();
        nextScheduledAt = new Date(lastTime + intervalMs).toISOString();
      } else {
        nextScheduledAt = new Date(this.schedulerStartedAt + intervalMs).toISOString();
      }
    }

    return {
      total_runs: this.totalRuns,
      last_run_at: this.lastRunAt,
      last_duration_ms: this.lastDurationMs,
      avg_duration_ms: this.totalRuns > 0 ? this.totalDurationMs / this.totalRuns : 0,
      total_promoted: this.totalPromoted,
      total_demoted: this.totalDemoted,
      total_pruned: this.totalPruned,
      total_distilled: this.totalDistilled,
      total_replayed: this.totalReplayed,
      total_compressed: this.totalCompressed,
      scheduler_active: this.schedulerActive,
      scheduler_interval_hours: this.schedulerIntervalHours,
      next_scheduled_at: nextScheduledAt,
      last_sub_phases: this.lastSubPhases,
      cycle_history: [...this.cycleHistory],
    };
  }
}

// ── Compression Metrics (IMP-15 / IMP-16) ───────────────────────────────────

export interface CompressionStats {
  total_tokens_saved: number;
  last_tokens_saved: number;
  compression_events: number;
}

export interface EffectiveContextBuildStats {
  /** Tokens in the last injected context string (actual usage). */
  last_context_tokens_used: number;
  /** W_max budget applied to the last build. */
  last_context_max_tokens: number;
  /** last_context_tokens_used / last_context_max_tokens (0–1). */
  window_utilization: number;
  last_build_at: number | null;
}

/** Tracks last context-build utilization for the capacity dashboard (IMP-16). */
export class EffectiveContextTracker {
  private lastContextTokensUsed = 0;
  private lastContextMaxTokens = 0;
  private lastBuildAt: number | null = null;

  recordBuild(tokensUsed: number, maxTokens: number): void {
    if (tokensUsed < 0 || maxTokens <= 0) return;
    this.lastContextTokensUsed = tokensUsed;
    this.lastContextMaxTokens = maxTokens;
    this.lastBuildAt = Date.now();
  }

  getStats(): EffectiveContextBuildStats {
    const utilization =
      this.lastContextMaxTokens > 0
        ? Math.min(1, this.lastContextTokensUsed / this.lastContextMaxTokens)
        : 0;
    return {
      last_context_tokens_used: this.lastContextTokensUsed,
      last_context_max_tokens: this.lastContextMaxTokens,
      window_utilization: utilization,
      last_build_at: this.lastBuildAt,
    };
  }

  reset(): void {
    this.lastContextTokensUsed = 0;
    this.lastContextMaxTokens = 0;
    this.lastBuildAt = null;
  }
}

/** Tracks local memory_tokens_saved from compress-oldest overflow (knox_ms_meta equivalent). */
export class CompressionMetrics {
  private totalTokensSaved = 0;
  private lastTokensSaved = 0;
  private compressionEvents = 0;

  record(tokensSaved: number): void {
    if (tokensSaved <= 0) return;
    this.totalTokensSaved += tokensSaved;
    this.lastTokensSaved = tokensSaved;
    this.compressionEvents += 1;
  }

  getStats(): CompressionStats {
    return {
      total_tokens_saved: this.totalTokensSaved,
      last_tokens_saved: this.lastTokensSaved,
      compression_events: this.compressionEvents,
    };
  }

  reset(): void {
    this.totalTokensSaved = 0;
    this.lastTokensSaved = 0;
    this.compressionEvents = 0;
  }
}
