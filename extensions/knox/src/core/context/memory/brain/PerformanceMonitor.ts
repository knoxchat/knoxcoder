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

import { brainMaxBytes } from "./store/dbSafety.js";
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
  /** Days until `max_bytes`. Leftover `days_until_100mb` aliases this. */
  days_until_cap: number | null;
  cap_bytes: number;
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
  | "defragment_graph"
  | "prune_missing_checkpoints"
  | "check_invariants";

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
    // Disk valve is max_bytes (MEM-04). Tiers are R/Value, not a hot quota.
    let capacity = 1.0;
    const cap = brainMaxBytes();
    if (cap > 0) {
      const ratio = basicHealth.db_size_bytes / cap;
      if (ratio >= 1) capacity = 0.2;
      else if (ratio > 0.9) capacity = 0.5;
      else if (ratio > 0.75) capacity = 0.75;
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
    const cap = brainMaxBytes();
    const daysUntilCap = cap > 0 && growthRate > 0 && currentDbSizeBytes < cap
      ? (cap - currentDbSizeBytes) / growthRate
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
    if (daysUntilCap !== null && daysUntilCap < 30) {
      const capMb = Math.round(cap / (1024 * 1024));
      recommendations.push(`DB will reach max_bytes (${capMb}MB) in ~${Math.ceil(daysUntilCap)} days.`);
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
      days_until_cap: daysUntilCap,
      cap_bytes: cap,
      days_until_100mb: daysUntilCap,
      days_until_500mb: null,
      memory_growth_rate_per_day: memGrowthPerDay,
      ema_response_ms: this.emaResponseMs,
      ema_tokens_per_op: this.emaTokensPerOp,
      trend,
      recommendations,
    };
  }
}

export * from "./monitor/healing.js";
export * from "./monitor/tracking.js";
