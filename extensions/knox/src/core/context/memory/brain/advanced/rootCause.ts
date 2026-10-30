import { BrainStore } from "../BrainStore.js";
import type { HealthStatus } from "../types.js";

// ══════════════════════════════════════════════════════════════════════════════
// 24. Root Cause Analysis
// ══════════════════════════════════════════════════════════════════════════════

export interface RootCause {
  category: "storage" | "performance" | "data_quality" | "configuration" | "growth";
  severity: "low" | "medium" | "high" | "critical";
  symptom: string;
  root_cause: string;
  evidence: string[];
  recommended_actions: string[];
  estimated_impact: string;
}

export interface RootCauseReport {
  timestamp: string;
  overall_status: "healthy" | "degraded" | "critical";
  root_causes: RootCause[];
  health_summary: HealthStatus;
  tier_balance: Record<string, number>;
  query_performance: {
    avg_ms: number;
    slow_queries: number;
    total_queries: number;
  };
}

export class RootCauseAnalyzer {
  /**
   * Perform deep root-cause analysis beyond basic health checks.
   * Examines storage patterns, data quality, query performance,
   * configuration issues, and growth trajectories.
   */
  static async analyze(): Promise<RootCauseReport> {
    const db = await BrainStore.get();
    const health = await BrainStore.getHealth();
    const causes: RootCause[] = [];

    // ── Storage Analysis ──────────────────────────────────────────────────

    // 1. Check WAL size vs main DB
    let walSizeBytes = 0;
    try {
      const { getMemoryBrainSqlitePath } = await import("../../../../util/paths.js");
      const walPath = getMemoryBrainSqlitePath() + "-wal";
      const fs = await import("fs");
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch {}

    if (walSizeBytes > 10 * 1024 * 1024) {
      causes.push({
        category: "storage",
        severity: walSizeBytes > 50 * 1024 * 1024 ? "high" : "medium",
        symptom: `WAL file is ${(walSizeBytes / (1024 * 1024)).toFixed(1)}MB`,
        root_cause: "WAL checkpointing is not keeping up with write rate, or WAL checkpoint never runs",
        evidence: [`WAL size: ${walSizeBytes} bytes`, `Main DB: ${health.db_size_bytes} bytes`],
        recommended_actions: ["Run PRAGMA wal_checkpoint(TRUNCATE)", "Run 'optimize' to VACUUM"],
        estimated_impact: "Improved write performance and reduced disk usage",
      });
    }

    // 2. Check for oversized individual memories
    const largeMemories = await db.get(
      `SELECT COUNT(*) as c, MAX(length(content)) as maxlen FROM brain_semantic WHERE length(content) > 10000`,
    ) as any;
    if (largeMemories?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: largeMemories.c > 50 ? "high" : "medium",
        symptom: `${largeMemories.c} semantic memories exceed 10KB (max: ${(largeMemories.maxlen / 1024).toFixed(1)}KB)`,
        root_cause: "Large uncompressed content stored in semantic memories — possibly raw code or verbose text",
        evidence: [`Count over 10KB: ${largeMemories.c}`, `Max content length: ${largeMemories.maxlen}`],
        recommended_actions: ["Run 'consolidate' to compress cold-tier memories", "Review auto-extract settings to filter verbose content"],
        estimated_impact: "Reduced DB size and faster query performance",
      });
    }

    // ── Tier Balance Analysis ─────────────────────────────────────────────

    const tierCounts: Record<string, number> = {};
    const semTiers = await db.all(`SELECT tier, COUNT(*) as c FROM brain_semantic GROUP BY tier`);
    const epTiers = await db.all(`SELECT tier, COUNT(*) as c FROM brain_episodic GROUP BY tier`);
    for (const r of [...semTiers, ...epTiers]) {
      const t = (r as any).tier;
      tierCounts[t] = (tierCounts[t] ?? 0) + (r as any).c;
    }
    const totalMem = Object.values(tierCounts).reduce((s, c) => s + c, 0);

    if (totalMem > 0) {
      const hotRatio = (tierCounts["hot"] ?? 0) / totalMem;
      if (hotRatio > 0.6) {
        causes.push({
          category: "configuration",
          severity: hotRatio > 0.8 ? "high" : "medium",
          symptom: `Hot tier contains ${(hotRatio * 100).toFixed(0)}% of all memories`,
          root_cause: "Consolidation runs too infrequently or importance thresholds are too high",
          evidence: [
            `Hot: ${tierCounts["hot"] ?? 0}`,
            `Warm: ${tierCounts["warm"] ?? 0}`,
            `Cold: ${tierCounts["cold"] ?? 0}`,
            `Total: ${totalMem}`,
          ],
          recommended_actions: [
            "Run 'consolidate' to recompute R/Value tiers",
            "Review archive_value_threshold / stability (clock knobs are unused)",
            "Increase consolidation frequency",
          ],
          estimated_impact: "Better memory retrieval performance and reduced working set",
        });
      }

      const coldRatio = ((tierCounts["cold"] ?? 0) + (tierCounts["frozen"] ?? 0)) / totalMem;
      if (coldRatio > 0.8 && totalMem > 100) {
        causes.push({
          category: "data_quality",
          severity: "medium",
          symptom: `${(coldRatio * 100).toFixed(0)}% of memories are cold/frozen`,
          root_cause: "Most memories have low importance or haven't been accessed — possible over-extraction",
          evidence: [
            `Cold+Frozen: ${(tierCounts["cold"] ?? 0) + (tierCounts["frozen"] ?? 0)}`,
            `Hot+Warm: ${(tierCounts["hot"] ?? 0) + (tierCounts["warm"] ?? 0)}`,
          ],
          recommended_actions: [
            "Review auto_extract_min_importance setting (raise it)",
            "Prune old frozen memories",
          ],
          estimated_impact: "Smaller DB and more meaningful memory retrieval",
        });
      }
    }

    // ── Orphan / Integrity Analysis ───────────────────────────────────────

    const orphanAssoc = await db.get(
      `SELECT COUNT(*) as c FROM brain_associations
       WHERE (source_type = 'semantic' AND source_id NOT IN (SELECT id FROM brain_semantic))
       OR (target_type = 'semantic' AND target_id NOT IN (SELECT id FROM brain_semantic))
       OR (source_type = 'episodic' AND source_id NOT IN (SELECT id FROM brain_episodic))
       OR (target_type = 'episodic' AND target_id NOT IN (SELECT id FROM brain_episodic))`,
    ) as any;
    if (orphanAssoc?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: orphanAssoc.c > 100 ? "high" : "low",
        symptom: `${orphanAssoc.c} orphan associations found`,
        root_cause: "Memories were deleted without cleaning up their associations",
        evidence: [`Orphan count: ${orphanAssoc.c}`],
        recommended_actions: ["Run heal action: purge_orphan_associations"],
        estimated_impact: "Cleaner data, slightly faster association queries",
      });
    }

    // ── Growth Rate Analysis ──────────────────────────────────────────────

    const recentGrowth = await db.get(
      `SELECT COUNT(*) as c FROM brain_semantic WHERE created_at > datetime('now', '-24 hours')`,
    ) as any;
    if (recentGrowth?.c > 100) {
      causes.push({
        category: "growth",
        severity: recentGrowth.c > 500 ? "high" : "medium",
        symptom: `${recentGrowth.c} new semantic memories in the last 24 hours`,
        root_cause: "High auto-extraction rate or frequent store operations",
        evidence: [`24h new memories: ${recentGrowth.c}`],
        recommended_actions: [
          "Raise auto_extract_min_importance",
          "Reduce max_episodic_per_session",
          "Run consolidation more frequently",
        ],
        estimated_impact: "Controlled growth and better signal-to-noise ratio",
      });
    }

    // ── Expired / Stale Data ──────────────────────────────────────────────

    const expiredCount = await db.get(
      `SELECT COUNT(*) as c FROM brain_semantic WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`,
    ) as any;
    if (expiredCount?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: expiredCount.c > 50 ? "medium" : "low",
        symptom: `${expiredCount.c} expired semantic memories still in database`,
        root_cause: "Expired memory cleanup has not run recently",
        evidence: [`Expired count: ${expiredCount.c}`],
        recommended_actions: ["Run 'consolidate' to prune expired memories"],
        estimated_impact: "Reduced DB size and cleaner search results",
      });
    }

    // ── Duplicate Detection ───────────────────────────────────────────────

    const duplicates = await db.get(
      `SELECT COUNT(*) as c FROM (
        SELECT title, category, COUNT(*) as cnt FROM brain_semantic
        GROUP BY title, category HAVING cnt > 1
      )`,
    ) as any;
    if (duplicates?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: duplicates.c > 20 ? "medium" : "low",
        symptom: `${duplicates.c} duplicate semantic memory title+category combinations`,
        root_cause: "Same facts stored multiple times, possibly from repeated auto-extraction",
        evidence: [`Duplicate groups: ${duplicates.c}`],
        recommended_actions: ["Review and deduplicate semantic memories", "Enable deduplication in auto-extract"],
        estimated_impact: "Cleaner, deduplicated knowledge base",
      });
    }

    // ── Determine overall status ──────────────────────────────────────────

    const criticalCount = causes.filter((c) => c.severity === "critical").length;
    const highCount = causes.filter((c) => c.severity === "high").length;
    let overallStatus: "healthy" | "degraded" | "critical" = "healthy";
    if (criticalCount > 0) overallStatus = "critical";
    else if (highCount > 0 || causes.length >= 3) overallStatus = "degraded";

    return {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      root_causes: causes,
      health_summary: health,
      tier_balance: tierCounts,
      query_performance: {
        avg_ms: 0, // Would be populated from MetricsCollector if available
        slow_queries: 0,
        total_queries: 0,
      },
    };
  }
}
