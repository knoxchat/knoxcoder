/** Human-readable formatters for tool dispatch output. */

import type {
  CheckpointStrategyConfig,
  CheckpointLifecycleReport,
  EventReplayResult,
} from "../CheckpointManager.js";
import type {
  BatchDeleteResult,
  BatchStoreResult,
} from "../BatchOperations.js";
import type {
  RelatedSession,
  RootCauseReport,
  SpacedRepetitionState,
  LruCacheStats,
} from "../AdvancedFeatures.js";
import type {
  MetricsSummary,
  HealthScore,
  CapacityForecast,
  HealingResult,
  ConsolidationStats,
} from "../PerformanceMonitor.js";
import type {
  BrainSession,
  BrainStats,
  RecallResult,
  SemanticMemory,
  HealthStatus,
} from "../types.js";

// ── Formatting Helpers ─────────────────────────────────────────────────────

export function formatRecallResult(result: RecallResult): string {
  const parts: string[] = [];

  if (result.semantic.length > 0) {
    parts.push(`📚 Semantic Memories (${result.semantic.length} found):`);
    for (const mem of result.semantic) {
      parts.push(`  [#${mem.id}] [${mem.category}] ${mem.title}`);
      parts.push(`    ${mem.content.substring(0, 300)}${mem.content.length > 300 ? "..." : ""}`);
      parts.push(`    Importance: ${mem.importance_score.toFixed(2)} | Retrieved: ${mem.retrieval_count}x | Tier: ${mem.tier}`);
    }
    parts.push("");
  }

  if (result.episodic.length > 0) {
    parts.push(`💭 Episodic Memories (${result.episodic.length} found):`);
    for (const ep of result.episodic) {
      parts.push(`  [#${ep.id}] [${ep.session_id.substring(0, 8)}...] ${ep.role}: ${ep.content.substring(0, 200)}${ep.content.length > 200 ? "..." : ""}`);
    }
    parts.push("");
  }

  if (result.associations.length > 0) {
    parts.push(`🔗 Associations (${result.associations.length} found):`);
    for (const a of result.associations) {
      parts.push(`  ${a.source_type}#${a.source_id} —[${a.relationship}]→ ${a.target_type}#${a.target_id} (strength: ${a.strength.toFixed(2)})`);
    }
  }

  if (parts.length === 0) {
    return "No memories found matching the query.";
  }

  return parts.join("\n");
}

export function formatSemanticList(memories: SemanticMemory[], header: string): string {
  if (memories.length === 0) return `${header}\nNo results.`;
  const parts = [header];
  for (const mem of memories) {
    parts.push(`[#${mem.id}] [${mem.category}] ${mem.title}`);
    parts.push(`  ${mem.content.substring(0, 200)}${mem.content.length > 200 ? "..." : ""}`);
    parts.push(`  Keywords: ${mem.keywords || "none"} | Importance: ${mem.importance_score.toFixed(2)} | Retrieved: ${mem.retrieval_count}x`);
  }
  return parts.join("\n");
}

export function formatSessionList(sessions: BrainSession[]): string {
  if (sessions.length === 0) return "No sessions tracked yet.";
  const parts = [`Tracked Sessions (${sessions.length}):`];
  for (const s of sessions) {
    const status = s.is_active ? "🟢" : "⚪";
    parts.push(`  ${status} [${s.id.substring(0, 8)}...] ${s.title} (${s.message_count} msgs, ${s.updated_at})`);
    if (s.workspace_directory) {
      parts.push(`    Workspace: ${s.workspace_directory}`);
    }
  }
  return parts.join("\n");
}

export function formatSessionDetail(session: BrainSession, history: any[]): string {
  const parts = [
    `Session: ${session.title}`,
    `ID: ${session.id}`,
    `Workspace: ${session.workspace_directory || "N/A"}`,
    `Messages: ${session.message_count}`,
    `Created: ${session.created_at}`,
    `Updated: ${session.updated_at}`,
    `Active: ${session.is_active}`,
  ];

  if (session.summary) {
    parts.push("", "Summary:", session.summary);
  }

  if (history.length > 0) {
    parts.push("", `Recent History (${history.length} messages):`);
    for (const msg of history.slice(-20)) {
      const preview = msg.content.substring(0, 150).replace(/\n/g, " ");
      parts.push(`  [${msg.role}] ${preview}${msg.content.length > 150 ? "..." : ""}`);
    }
  }

  return parts.join("\n");
}

export function formatStats(stats: BrainStats): string {
  const sizeKB = (stats.db_size_bytes / 1024).toFixed(1);
  return [
    "Memory Brain Statistics:",
    `  Sessions: ${stats.total_sessions}`,
    `  Episodic memories: ${stats.total_episodic}`,
    `  Semantic memories: ${stats.total_semantic}`,
    `  Associations: ${stats.total_associations}`,
    `  Knowledge graph: ${stats.total_entities} entities, ${stats.total_edges} edges`,
    `  Learning patterns: ${stats.total_patterns}`,
    `  Procedures: ${stats.total_procedures}`,
    `  Tags: ${stats.total_tags}`,
    `  Collections: ${stats.total_collections}`,
    `  Tiers: hot=${stats.tier_counts.hot}, warm=${stats.tier_counts.warm}, cold=${stats.tier_counts.cold}`,
    `  Categories: ${Object.entries(stats.category_counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `  Entity types: ${Object.entries(stats.entity_type_counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `  Oldest: ${stats.oldest_memory ?? "N/A"}`,
    `  Newest: ${stats.newest_memory ?? "N/A"}`,
    `  DB Size: ${sizeKB} KB`,
  ].join("\n");
}

export function formatProcedureList(procedures: any[]): string {
  if (procedures.length === 0) return "No procedures stored yet.";
  const parts = [`Procedures (${procedures.length}):`];
  for (const p of procedures) {
    const steps = JSON.parse(p.steps) as string[];
    parts.push(`  [#${p.id}] [${p.category}] ${p.name}`);
    parts.push(`    ${p.description}`);
    parts.push(`    Steps: ${steps.length} | Success rate: ${(p.success_rate * 100).toFixed(0)}% | Executions: ${p.execution_count}`);
    parts.push(`    Trigger: ${p.trigger_pattern || "manual"}`);
  }
  return parts.join("\n");
}

export function formatHealth(health: HealthStatus): string {
  const statusEmoji = health.status === "healthy" ? "🟢" : health.status === "degraded" ? "🟡" : "🔴";
  const sizeKB = (health.db_size_bytes / 1024).toFixed(1);
  const parts = [
    `Memory Brain Health: ${statusEmoji} ${health.status.toUpperCase()}`,
    `  Total memories: ${health.total_memories}`,
    `  DB size: ${sizeKB} KB`,
    `  Fragmentation: ${(health.fragmentation_ratio * 100).toFixed(1)}%`,
    `  Oldest unaccessed: ${health.oldest_unaccessed_days.toFixed(0)} days`,
  ];

  if (health.issues.length > 0) {
    parts.push("  Issues:");
    for (const issue of health.issues) {
      parts.push(`    ⚠ ${issue}`);
    }
  }

  if (health.recommendations.length > 0) {
    parts.push("  Recommendations:");
    for (const rec of health.recommendations) {
      parts.push(`    → ${rec}`);
    }
  }

  return parts.join("\n");
}

export function formatConfig(config: any): string {
  const parts = ["Memory Brain Configuration:"];
  for (const [key, value] of Object.entries(config)) {
    parts.push(`  ${key}: ${value}`);
  }
  return parts.join("\n");
}

export function formatBacklogResult(result: any): string {
  const parts: string[] = [];
  parts.push(`Cross-Session Backlog Search — ${result.sessions_searched} sessions searched, ${result.total_matches} total matches`);
  parts.push("");

  if (result.semantic.length > 0) {
    parts.push(`📚 Semantic Memories (${result.semantic.length}):`);
    for (const mem of result.semantic) {
      parts.push(`  [#${mem.id}] [${mem.category}] ${mem.title}`);
      parts.push(`    ${mem.content.substring(0, 250)}${mem.content.length > 250 ? "..." : ""}`);
      parts.push(`    Session: ${mem.source_session_id ?? "N/A"} | Importance: ${mem.importance_score.toFixed(2)} | Retrieved: ${mem.retrieval_count}x`);
    }
    parts.push("");
  }

  if (result.episodic.length > 0) {
    parts.push(`💭 Episodic Memories (${result.episodic.length}):`);
    for (const ep of result.episodic) {
      parts.push(`  [#${ep.id}] [Session: ${ep.session_id.substring(0, 8)}...] [${ep.role}]`);
      parts.push(`    ${ep.content.substring(0, 250)}${ep.content.length > 250 ? "..." : ""}`);
      parts.push(`    ${ep.created_at} | Importance: ${ep.importance_score.toFixed(2)}`);
    }
  }

  if (result.total_matches === 0) {
    parts.push("No matching memories found across sessions.");
  }

  return parts.join("\n");
}

// ── Performance & Self-Management Formatters ─────────────────────────────

export function formatMetrics(m: MetricsSummary): string {
  const parts = [
    "Performance Metrics:",
    `  Total operations: ${m.total_operations}`,
    `  Success rate: ${(m.success_rate * 100).toFixed(1)}%`,
    `  Avg response: ${m.avg_response_ms.toFixed(1)}ms`,
    `  P95 response: ${m.p95_response_ms.toFixed(1)}ms`,
    `  P99 response: ${m.p99_response_ms.toFixed(1)}ms`,
    `  Total tokens: ${m.total_tokens_used}`,
    `  Ops/min: ${m.operations_per_minute.toFixed(2)}`,
    `  Uptime: ${(m.uptime_ms / 60000).toFixed(1)} min`,
  ];
  const ops = Object.entries(m.by_operation);
  if (ops.length > 0) {
    parts.push("  Per-operation:");
    for (const [op, s] of ops) {
      parts.push(`    ${op}: ${s.count} calls, ${(s.success_rate * 100).toFixed(0)}% success, avg ${s.avg_ms.toFixed(1)}ms, p95 ${s.p95_ms.toFixed(1)}ms, ${s.total_tokens} tokens`);
    }
  }
  return parts.join("\n");
}

export function formatHealthScore(h: HealthScore): string {
  return [
    `Health Score: ${h.grade} (${(h.overall * 100).toFixed(1)}%)`,
    `  Latency:       ${(h.dimensions.latency * 100).toFixed(1)}% (weight: ${h.weights.latency})`,
    `  Accuracy:      ${(h.dimensions.accuracy * 100).toFixed(1)}% (weight: ${h.weights.accuracy})`,
    `  Efficiency:    ${(h.dimensions.efficiency * 100).toFixed(1)}% (weight: ${h.weights.efficiency})`,
    `  Capacity:      ${(h.dimensions.capacity * 100).toFixed(1)}% (weight: ${h.weights.capacity})`,
    `  Fragmentation: ${(h.dimensions.fragmentation * 100).toFixed(1)}% (weight: ${h.weights.fragmentation})`,
  ].join("\n");
}

export function formatForecast(f: CapacityForecast): string {
  const sizeMb = (f.current_db_size_bytes / (1024 * 1024)).toFixed(2);
  const growthKbDay = (f.growth_rate_bytes_per_day / 1024).toFixed(1);
  const parts = [
    "Capacity Forecast:",
    `  Current DB size: ${sizeMb} MB`,
    `  Growth rate: ${growthKbDay} KB/day`,
    `  Trend: ${f.trend}`,
    `  EMA response time: ${f.ema_response_ms.toFixed(1)}ms`,
    `  EMA tokens/op: ${f.ema_tokens_per_op.toFixed(1)}`,
    `  Memory growth: ${f.memory_growth_rate_per_day.toFixed(1)} memories/day`,
  ];
  if (f.days_until_100mb !== null) parts.push(`  Days until 100MB: ${Math.ceil(f.days_until_100mb)}`);
  if (f.days_until_500mb !== null) parts.push(`  Days until 500MB: ${Math.ceil(f.days_until_500mb)}`);
  if (f.recommendations.length > 0) {
    parts.push("  Recommendations:");
    for (const r of f.recommendations) parts.push(`    → ${r}`);
  }
  return parts.join("\n");
}

export function formatHealingResult(results: HealingResult[]): string {
  if (results.length === 0) return "No healing actions were needed.";
  const parts = [`Healing Results (${results.length} actions):`];
  for (const r of results) {
    const status = r.success ? "✓" : "✗";
    parts.push(`  ${status} [${r.action}] ${r.details} (${r.duration_ms.toFixed(0)}ms, impact: ${(r.impact * 100).toFixed(0)}%)`);
  }
  return parts.join("\n");
}

export function formatConsolidationStats(s: ConsolidationStats): string {
  const parts = [
    "Consolidation Statistics:",
    `  Total runs: ${s.total_runs}`,
    `  Last run: ${s.last_run_at ?? "never"}`,
    `  Last duration: ${s.last_duration_ms.toFixed(0)}ms`,
    `  Avg duration: ${s.avg_duration_ms.toFixed(0)}ms`,
    `  Scheduler: ${s.scheduler_active ? "active" : "inactive"} (every ${s.scheduler_interval_hours}h)`,
    `  Next scheduled: ${s.next_scheduled_at ?? "N/A"}`,
    "  Totals:",
    `    Promoted: ${s.total_promoted}`,
    `    Demoted: ${s.total_demoted}`,
    `    Pruned: ${s.total_pruned}`,
    `    Distilled: ${s.total_distilled}`,
    `    Replayed: ${s.total_replayed}`,
    `    Compressed: ${s.total_compressed}`,
  ];
  if (s.cycle_history.length > 0) {
    parts.push(`  Recent cycles (last ${Math.min(5, s.cycle_history.length)}):`);
    for (const c of s.cycle_history.slice(-5)) {
      parts.push(`    [${c.timestamp}] ${c.duration_ms.toFixed(0)}ms — promoted: ${c.promoted}, demoted: ${c.demoted}, pruned: ${c.pruned}`);
    }
  }
  return parts.join("\n");
}

// ── Tier C Formatting Helpers ──────────────────────────────────────────────

export function formatCheckpointStrategyConfig(cfg: CheckpointStrategyConfig): string {
  return [
    "Checkpoint Strategy Configuration:",
    `  Mode: ${cfg.mode}`,
    `  Adaptive change threshold: ${cfg.adaptive_change_threshold}`,
    `  Time interval: ${cfg.time_interval_minutes} minutes`,
    `  Max checkpoints: ${cfg.max_checkpoints}`,
    `  Max age: ${cfg.max_age_days} days`,
    `  Max total size: ${cfg.max_total_size_mb} MB`,
    `  Compress snapshots: ${cfg.compress_snapshots}`,
  ].join("\n");
}

export function formatLifecycleReport(report: CheckpointLifecycleReport): string {
  const sizeMb = (report.total_size_bytes / (1024 * 1024)).toFixed(2);
  return [
    "Checkpoint Lifecycle Cleanup:",
    `  Deleted by age: ${report.deleted_by_age}`,
    `  Deleted by count: ${report.deleted_by_count}`,
    `  Deleted by size: ${report.deleted_by_size}`,
    `  Total deleted: ${report.total_deleted}`,
    `  Remaining: ${report.remaining}`,
    `  Total size: ${sizeMb} MB`,
  ].join("\n");
}

export function formatReplayResult(replay: EventReplayResult): string {
  if (replay.events_replayed === 0) return "No events found in the specified range.";
  const parts = [
    `Event Replay (${replay.events_replayed} events):`,
    `  From: ${replay.from_timestamp}`,
    `  To: ${replay.target_timestamp}`,
    "",
  ];
  for (const op of replay.operations) {
    parts.push(`  [${op.timestamp}] ${op.action} → ${op.target_type}#${op.target_id}`);
    const detailStr = Object.entries(op.details).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
    if (detailStr) parts.push(`    ${detailStr}`);
  }
  return parts.join("\n");
}

export function formatBatchDeleteResult(result: BatchDeleteResult): string {
  const parts = [
    `Batch Delete (${result.target_type}):`,
    `  Requested: ${result.requested}`,
    `  Deleted: ${result.deleted}`,
    `  Failed: ${result.failed}`,
  ];
  if (result.errors.length > 0) {
    parts.push("  Errors:");
    for (const err of result.errors) parts.push(`    ⚠ ${err}`);
  }
  return parts.join("\n");
}

export function formatBatchStoreResult(result: BatchStoreResult): string {
  const parts = [
    `Batch Store:`,
    `  Stored: ${result.stored} (IDs: ${result.ids.join(", ")})`,
    `  Failed: ${result.failed}`,
  ];
  if (result.errors.length > 0) {
    parts.push("  Errors:");
    for (const err of result.errors) parts.push(`    ⚠ ${err}`);
  }
  return parts.join("\n");
}

// ── Tier D Formatting Helpers ──────────────────────────────────────────────

export function formatRelatedSessions(related: RelatedSession[]): string {
  if (related.length === 0) return "No related sessions found.";
  const parts = [`Related Sessions (${related.length}):`];
  for (const r of related) {
    parts.push(`  [${r.session.id.substring(0, 8)}...] "${r.session.title}" (relevance: ${r.relevance_score.toFixed(1)})`);
    if (r.shared_entities.length > 0) parts.push(`    Shared entities: ${r.shared_entities.join(", ")}`);
    if (r.shared_topics.length > 0) parts.push(`    Shared topics: ${r.shared_topics.join(", ")}`);
    if (r.shared_keywords.length > 0) parts.push(`    Shared keywords: ${r.shared_keywords.slice(0, 10).join(", ")}`);
  }
  return parts.join("\n");
}

export function formatRootCauseReport(report: RootCauseReport): string {
  const statusEmoji = report.overall_status === "healthy" ? "🟢" : report.overall_status === "degraded" ? "🟡" : "🔴";
  const parts = [
    `Root Cause Analysis: ${statusEmoji} ${report.overall_status.toUpperCase()} (${report.timestamp})`,
  ];

  if (report.root_causes.length === 0) {
    parts.push("  No issues detected — system is healthy.");
  } else {
    parts.push(`  ${report.root_causes.length} issue(s) found:`);
    for (const cause of report.root_causes) {
      const sevEmoji = cause.severity === "critical" ? "🔴" : cause.severity === "high" ? "🟠" : cause.severity === "medium" ? "🟡" : "⚪";
      parts.push(`  ${sevEmoji} [${cause.category}] ${cause.symptom}`);
      parts.push(`    Root cause: ${cause.root_cause}`);
      if (cause.evidence.length > 0) parts.push(`    Evidence: ${cause.evidence.join("; ")}`);
      if (cause.recommended_actions.length > 0) parts.push(`    Actions: ${cause.recommended_actions.join("; ")}`);
      parts.push(`    Impact: ${cause.estimated_impact}`);
    }
  }

  const tierStr = Object.entries(report.tier_balance).map(([k, v]) => `${k}=${v}`).join(", ");
  if (tierStr) parts.push(`  Tier balance: ${tierStr}`);

  return parts.join("\n");
}

export function formatReviewDue(items: SpacedRepetitionState[]): string {
  if (items.length === 0) return "No memories due for review — all retention levels are adequate.";
  const parts = [`Memories Due for Review (${items.length}):`];
  for (const item of items) {
    const overdueStr = item.overdue ? " ⚠ OVERDUE" : "";
    parts.push(`  [#${item.memory_id}] [${item.category}] "${item.title}"`);
    parts.push(`    Retention: ${(item.current_retention * 100).toFixed(0)}% | Strength: ${item.strength.toFixed(2)} | Retrievals: ${item.retrieval_count}${overdueStr}`);
    parts.push(`    Next review: ${item.days_until_review.toFixed(1)} days (${item.next_optimal_review})`);
  }
  return parts.join("\n");
}

export function formatCacheStats(stats: LruCacheStats): string {
  const parts = [
    "LRU Cache Statistics:",
    `  Size: ${stats.size} / ${stats.max_size}`,
    `  Hits: ${stats.hits} | Misses: ${stats.misses} | Evictions: ${stats.evictions}`,
    `  Hit rate: ${(stats.hit_rate * 100).toFixed(1)}%`,
    `  Memory: ${(stats.total_memory_bytes / 1024).toFixed(1)} KB`,
    `  Avg entry age: ${(stats.avg_entry_age_ms / 1000).toFixed(1)}s`,
  ];
  if (stats.hottest_keys.length > 0) {
    parts.push("  Hottest keys:");
    for (const k of stats.hottest_keys.slice(0, 5)) {
      parts.push(`    "${k.key}" — ${k.hits} hits`);
    }
  }
  return parts.join("\n");
}
