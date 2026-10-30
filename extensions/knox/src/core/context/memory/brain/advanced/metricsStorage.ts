import { BrainStore } from "../BrainStore.js";
import type { MetricsSummary } from "../PerformanceMonitor.js";

// ══════════════════════════════════════════════════════════════════════════════
// 27. Performance Metrics Storage
// ══════════════════════════════════════════════════════════════════════════════

export interface StoredMetricsSnapshot {
  id: number;
  timestamp: string;
  total_operations: number;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
  total_tokens_used: number;
  operations_per_minute: number;
  db_size_bytes: number;
  memory_count: number;
  memory_tokens_saved: number;
  /** Addressable stored tokens (|M₃| + |M₄| + |M₅|). */
  c_addr: number;
  /** Last inject tokens (C_use). */
  c_use: number;
  by_operation_json: string; // JSON
}

export interface MetricsTrend {
  snapshots: StoredMetricsSnapshot[];
  period_hours: number;
  avg_response_trend: "improving" | "stable" | "degrading";
  success_rate_trend: "improving" | "stable" | "degrading";
  growth_rate_trend: "stable" | "growing" | "shrinking" | "accelerating";
  compression_trend: "improving" | "stable" | "degrading";
  /** C_addr growth trend (addressable store, not window capacity). */
  addressable_memory_trend: "improving" | "stable" | "degrading";
}

export class MetricsStorage {
  /**
   * Ensure the metrics storage table exists.
   */
  static async ensureTable(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_metrics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_operations INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 1.0,
        avg_response_ms REAL DEFAULT 0,
        p95_response_ms REAL DEFAULT 0,
        total_tokens_used INTEGER DEFAULT 0,
        operations_per_minute REAL DEFAULT 0,
        db_size_bytes INTEGER DEFAULT 0,
        memory_count INTEGER DEFAULT 0,
        memory_tokens_saved INTEGER DEFAULT 0,
        c_addr REAL DEFAULT 0,
        c_use REAL DEFAULT 0,
        by_operation_json TEXT DEFAULT '{}'
      )
    `);
    for (const col of [
      "memory_tokens_saved INTEGER DEFAULT 0",
      "c_addr REAL DEFAULT 0",
      "c_use REAL DEFAULT 0",
      "hierarchy_effective_tokens REAL DEFAULT 0",
      "total_effective REAL DEFAULT 0",
    ]) {
      try {
        await db.run(`ALTER TABLE brain_metrics_snapshots ADD COLUMN ${col}`);
      } catch {
        // Column already exists
      }
    }
  }

  /**
   * Persist a metrics snapshot to SQLite for historical trend analysis.
   */
  static async storeSnapshot(
    metrics: MetricsSummary,
    dbSizeBytes: number,
    memoryCount: number,
    memoryTokensSaved = 0,
    cAddr = 0,
    cUse = 0,
  ): Promise<number> {
    await MetricsStorage.ensureTable();
    const db = await BrainStore.get();

    const result = await db.run(
      `INSERT INTO brain_metrics_snapshots
       (total_operations, success_rate, avg_response_ms, p95_response_ms,
        total_tokens_used, operations_per_minute, db_size_bytes, memory_count,
        memory_tokens_saved, c_addr, c_use, by_operation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.total_operations,
        metrics.success_rate,
        metrics.avg_response_ms,
        metrics.p95_response_ms,
        metrics.total_tokens_used,
        metrics.operations_per_minute,
        dbSizeBytes,
        memoryCount,
        memoryTokensSaved,
        cAddr,
        cUse,
        JSON.stringify(metrics.by_operation),
      ],
    );

    // Auto-cleanup: keep only last 1000 snapshots
    await db.run(
      `DELETE FROM brain_metrics_snapshots WHERE id NOT IN (
        SELECT id FROM brain_metrics_snapshots ORDER BY timestamp DESC LIMIT 1000
      )`,
    );

    return result.lastID!;
  }

  /**
   * Get historical metrics snapshots for trend analysis.
   */
  static async getSnapshots(options: {
    hours?: number;
    limit?: number;
  } = {}): Promise<StoredMetricsSnapshot[]> {
    await MetricsStorage.ensureTable();
    const db = await BrainStore.get();
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.hours) {
      conditions.push(`timestamp > datetime('now', '-${Math.floor(options.hours)} hours')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(options.limit ?? 100);

    const rows = await db.all(
      `SELECT * FROM brain_metrics_snapshots ${where} ORDER BY timestamp DESC LIMIT ?`,
      params,
    );

    return rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      total_operations: r.total_operations,
      success_rate: r.success_rate,
      avg_response_ms: r.avg_response_ms,
      p95_response_ms: r.p95_response_ms,
      total_tokens_used: r.total_tokens_used,
      operations_per_minute: r.operations_per_minute,
      db_size_bytes: r.db_size_bytes,
      memory_count: r.memory_count,
      memory_tokens_saved: r.memory_tokens_saved ?? 0,
      c_addr: r.c_addr ?? 0,
      c_use: r.c_use ?? 0,
      by_operation_json: r.by_operation_json,
    }));
  }

  /**
   * Analyze trends from stored metrics.
   */
  static async analyzeTrends(hours: number = 24): Promise<MetricsTrend> {
    const snapshots = await MetricsStorage.getSnapshots({ hours, limit: 500 });

    // Default trends
    let avgResponseTrend: MetricsTrend["avg_response_trend"] = "stable";
    let successRateTrend: MetricsTrend["success_rate_trend"] = "stable";
    let growthRateTrend: MetricsTrend["growth_rate_trend"] = "stable";
    let compressionTrend: MetricsTrend["compression_trend"] = "stable";
    let addressableTrend: MetricsTrend["addressable_memory_trend"] = "stable";

    if (snapshots.length >= 3) {
      // Compare first third vs last third
      const third = Math.floor(snapshots.length / 3);
      // snapshots are DESC, so last entries are oldest
      const recent = snapshots.slice(0, third);
      const older = snapshots.slice(-third);

      const recentAvgMs = recent.reduce((s, r) => s + r.avg_response_ms, 0) / recent.length;
      const olderAvgMs = older.reduce((s, r) => s + r.avg_response_ms, 0) / older.length;

      if (recentAvgMs < olderAvgMs * 0.9) avgResponseTrend = "improving";
      else if (recentAvgMs > olderAvgMs * 1.1) avgResponseTrend = "degrading";

      const recentSuccessRate = recent.reduce((s, r) => s + r.success_rate, 0) / recent.length;
      const olderSuccessRate = older.reduce((s, r) => s + r.success_rate, 0) / older.length;

      if (recentSuccessRate > olderSuccessRate + 0.02) successRateTrend = "improving";
      else if (recentSuccessRate < olderSuccessRate - 0.02) successRateTrend = "degrading";

      const recentSize = recent.reduce((s, r) => s + r.db_size_bytes, 0) / recent.length;
      const olderSize = older.reduce((s, r) => s + r.db_size_bytes, 0) / older.length;

      if (olderSize > 0) {
        const growthRatio = recentSize / olderSize;
        if (growthRatio > 1.2) growthRateTrend = "accelerating";
        else if (growthRatio > 1.02) growthRateTrend = "growing";
        else if (growthRatio < 0.98) growthRateTrend = "shrinking";
      }

      const recentCompression =
        recent.reduce((s, r) => s + (r.memory_tokens_saved ?? 0), 0) / recent.length;
      const olderCompression =
        older.reduce((s, r) => s + (r.memory_tokens_saved ?? 0), 0) / older.length;
      if (recentCompression > olderCompression * 1.1) compressionTrend = "improving";
      else if (recentCompression < olderCompression * 0.9) compressionTrend = "degrading";

      const recentAddr = recent.reduce((s, r) => s + (r.c_addr ?? 0), 0) / recent.length;
      const olderAddr = older.reduce((s, r) => s + (r.c_addr ?? 0), 0) / older.length;
      if (recentAddr > olderAddr * 1.05) addressableTrend = "improving";
      else if (recentAddr < olderAddr * 0.95) addressableTrend = "degrading";
    }

    return {
      snapshots,
      period_hours: hours,
      avg_response_trend: avgResponseTrend,
      success_rate_trend: successRateTrend,
      growth_rate_trend: growthRateTrend,
      compression_trend: compressionTrend,
      addressable_memory_trend: addressableTrend,
    };
  }

  /**
   * Get a compact summary of metrics trends.
   */
  static async getTrendSummary(hours: number = 24): Promise<string> {
    const trend = await MetricsStorage.analyzeTrends(hours);

    if (trend.snapshots.length === 0) {
      return "No metrics snapshots stored yet. Metrics will be stored periodically during operation.";
    }

    const latest = trend.snapshots[0];
    const oldest = trend.snapshots[trend.snapshots.length - 1];
    const dbGrowthKb = (latest.db_size_bytes - oldest.db_size_bytes) / 1024;

    return [
      `Metrics Trend (last ${hours}h, ${trend.snapshots.length} snapshots):`,
      `  Avg response: ${latest.avg_response_ms.toFixed(1)}ms (trend: ${trend.avg_response_trend})`,
      `  Success rate: ${(latest.success_rate * 100).toFixed(1)}% (trend: ${trend.success_rate_trend})`,
      `  DB growth: ${dbGrowthKb >= 0 ? "+" : ""}${dbGrowthKb.toFixed(1)}KB (trend: ${trend.growth_rate_trend})`,
      `  C_addr: ${Math.round(latest.c_addr ?? 0).toLocaleString()} (trend: ${trend.addressable_memory_trend})`,
      `  C_use: ${Math.round(latest.c_use ?? 0).toLocaleString()}`,
      `  Total ops: ${latest.total_operations}`,
      `  Memory count: ${latest.memory_count}`,
    ].join("\n");
  }
}
