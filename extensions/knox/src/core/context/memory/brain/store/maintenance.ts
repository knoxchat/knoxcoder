/** Consolidation, stats, health, and optimize. */

import fs from "fs";
import { getMemoryBrainSqlitePath } from "../../../../util/paths.js";
import type {
  BrainStats,
  ConsolidationResult,
  HealthStatus
} from "../types.js";
import { compressColdTier, decompressContent } from "./compression.js";
import { get } from "./connection.js";
import { brainState } from "./state.js";

// ── Consolidation (Knox-MS Memory Tiering Pattern) ─────────────────────────

/**
 * Consolidate memories using Ebbinghaus-inspired decay.
 * - Hot memories older than 24h with low importance → warm
 * - Warm memories older than 7 days with low importance → cold
 * - Cold memories older than 90 days with no retrievals → pruned
 * - Expired semantic memories → pruned
 */
export async function consolidate(): Promise<ConsolidationResult> {
  const db = await get();
  const result: ConsolidationResult = { promoted: 0, demoted: 0, pruned: 0, summaries_created: 0 };

  // Hot → Warm (episodic older than 24h, importance < 0.7)
  const hotToWarm = await db.run(
    `UPDATE brain_episodic SET tier = 'warm'
     WHERE tier = 'hot' AND importance_score < 0.7
     AND created_at < datetime('now', '-1 day')`,
  );
  result.demoted += hotToWarm.changes ?? 0;

  // Warm → Cold (episodic older than 7 days, importance < 0.5)
  const warmToCold = await db.run(
    `UPDATE brain_episodic SET tier = 'cold'
     WHERE tier = 'warm' AND importance_score < 0.5
     AND created_at < datetime('now', '-7 days')`,
  );
  result.demoted += warmToCold.changes ?? 0;

  // Prune cold episodic older than 90 days with very low importance
  const prunedEpisodic = await db.run(
    `DELETE FROM brain_episodic
     WHERE tier = 'cold' AND importance_score < 0.3
     AND created_at < datetime('now', '-90 days')`,
  );
  result.pruned += prunedEpisodic.changes ?? 0;

  // Hot → Warm (semantic older than 7 days, importance < 0.6, no recent access)
  // Pinned memories are exempt from demotion/pruning.
  const notPinned = `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`;
  const semHotToWarm = await db.run(
    `UPDATE brain_semantic SET tier = 'warm'
     WHERE tier = 'hot' AND importance_score < 0.6
     AND last_accessed_at < datetime('now', '-7 days')
     AND ${notPinned}`,
  );
  result.demoted += semHotToWarm.changes ?? 0;

  // Warm → Cold (semantic older than 30 days, low retrieval count)
  const semWarmToCold = await db.run(
    `UPDATE brain_semantic SET tier = 'cold'
     WHERE tier = 'warm' AND retrieval_count < 3
     AND last_accessed_at < datetime('now', '-30 days')
     AND ${notPinned}`,
  );
  result.demoted += semWarmToCold.changes ?? 0;

  // Prune expired semantic memories (never prune pinned)
  const prunedSemantic = await db.run(
    `DELETE FROM brain_semantic
     WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
     AND ${notPinned}`,
  );
  result.pruned += prunedSemantic.changes ?? 0;

  // Promote frequently accessed memories (cold/warm → hot)
  const promoted = await db.run(
    `UPDATE brain_semantic SET tier = 'hot'
     WHERE tier IN ('warm', 'cold') AND retrieval_count >= 5
     AND last_accessed_at > datetime('now', '-3 days')`,
  );
  result.promoted += promoted.changes ?? 0;

  // Compress cold-tier content to save space
  await compressColdTier().catch(() => {});

  // Decompress promoted memories (cold → hot)
  if ((promoted.changes ?? 0) > 0) {
    const hotRows = await db.all(
      `SELECT id, content FROM brain_semantic WHERE tier = 'hot' AND content LIKE 'z:%'`,
    );
    for (const r of hotRows) {
      const decompressed = decompressContent((r as any).content);
      if (decompressed !== (r as any).content) {
        await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [decompressed, (r as any).id]);
      }
    }
  }

  return result;
}

// ── Statistics ─────────────────────────────────────────────────────────────

export async function getStats(): Promise<BrainStats> {
  const db = await get();
  const dbPath = getMemoryBrainSqlitePath();

  const sessionCount = await db.get("SELECT COUNT(*) as c FROM brain_sessions");
  const episodicCount = await db.get("SELECT COUNT(*) as c FROM brain_episodic");
  const semanticCount = await db.get("SELECT COUNT(*) as c FROM brain_semantic");
  const assocCount = await db.get("SELECT COUNT(*) as c FROM brain_associations");
  const entityCount = await db.get("SELECT COUNT(*) as c FROM brain_entities");
  const edgeCount = await db.get("SELECT COUNT(*) as c FROM brain_graph_edges");
  const patternCount = await db.get("SELECT COUNT(*) as c FROM brain_learning_patterns");
  const procedureCount = await db.get("SELECT COUNT(*) as c FROM brain_procedures");
  const tagCount = await db.get("SELECT COUNT(*) as c FROM brain_tags");
  const collectionCount = await db.get("SELECT COUNT(*) as c FROM brain_collections");

  const tierCounts = await db.all(
    `SELECT tier, COUNT(*) as c FROM (
      SELECT tier FROM brain_episodic UNION ALL SELECT tier FROM brain_semantic
    ) GROUP BY tier`,
  );

  const categoryCounts = await db.all(
    "SELECT category, COUNT(*) as c FROM brain_semantic GROUP BY category",
  );

  const entityTypeCounts = await db.all(
    "SELECT entity_type, COUNT(*) as c FROM brain_entities GROUP BY entity_type",
  );

  const oldest = await db.get(
    `SELECT MIN(created_at) as m FROM (
      SELECT created_at FROM brain_episodic UNION ALL SELECT created_at FROM brain_semantic
    )`,
  );
  const newest = await db.get(
    `SELECT MAX(created_at) as m FROM (
      SELECT created_at FROM brain_episodic UNION ALL SELECT created_at FROM brain_semantic
    )`,
  );

  let dbSizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    dbSizeBytes = stat.size;
  } catch {}

  const tierMap: Record<string, number> = { hot: 0, warm: 0, cold: 0 };
  for (const row of tierCounts) {
    tierMap[(row as any).tier] = (row as any).c;
  }

  const catMap: Record<string, number> = {};
  for (const row of categoryCounts) {
    catMap[(row as any).category] = (row as any).c;
  }

  const entityTypeMap: Record<string, number> = {};
  for (const row of entityTypeCounts) {
    entityTypeMap[(row as any).entity_type] = (row as any).c;
  }

  return {
    total_sessions: (sessionCount as any)?.c ?? 0,
    total_episodic: (episodicCount as any)?.c ?? 0,
    total_semantic: (semanticCount as any)?.c ?? 0,
    total_associations: (assocCount as any)?.c ?? 0,
    total_entities: (entityCount as any)?.c ?? 0,
    total_edges: (edgeCount as any)?.c ?? 0,
    total_patterns: (patternCount as any)?.c ?? 0,
    total_procedures: (procedureCount as any)?.c ?? 0,
    total_tags: (tagCount as any)?.c ?? 0,
    total_collections: (collectionCount as any)?.c ?? 0,
    tier_counts: tierMap as any,
    category_counts: catMap,
    entity_type_counts: entityTypeMap,
    oldest_memory: (oldest as any)?.m ?? null,
    newest_memory: (newest as any)?.m ?? null,
    db_size_bytes: dbSizeBytes,
  };
}

// ── Health & Optimization ──────────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  const db = await get();
  const dbPath = getMemoryBrainSqlitePath();

  let dbSizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    dbSizeBytes = stat.size;
  } catch {}

  const totalMemories = await db.get(
    `SELECT COUNT(*) as c FROM (
      SELECT id FROM brain_episodic UNION ALL SELECT id FROM brain_semantic
    )`,
  );
  const total = (totalMemories as any)?.c ?? 0;

  // Check fragmentation (ratio of free pages)
  const pageCount = await db.get("PRAGMA page_count");
  const freePageCount = await db.get("PRAGMA freelist_count");
  const fragRatio = (pageCount as any)?.page_count > 0
    ? ((freePageCount as any)?.freelist_count ?? 0) / (pageCount as any).page_count
    : 0;

  // Check oldest unaccessed semantic memory
  const oldestUnaccessed = await db.get(
    `SELECT MIN(last_accessed_at) as m FROM brain_semantic WHERE tier != 'cold'`,
  );
  const oldestDate = (oldestUnaccessed as any)?.m;
  const oldestDays = oldestDate
    ? (Date.now() - new Date(oldestDate).getTime()) / 86400000
    : 0;

  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check for issues
  if (dbSizeBytes > 100 * 1024 * 1024) {
    issues.push("Database exceeds 100MB");
    recommendations.push("Run 'consolidate' to prune old memories and 'optimize' to compact the database");
  }

  if (fragRatio > 0.2) {
    issues.push(`Database fragmentation is ${(fragRatio * 100).toFixed(1)}%`);
    recommendations.push("Run 'optimize' to vacuum the database");
  }

  const hotCount = await db.get(
    `SELECT COUNT(*) as c FROM (
      SELECT id FROM brain_episodic WHERE tier = 'hot' UNION ALL SELECT id FROM brain_semantic WHERE tier = 'hot'
    )`,
  );
  if ((hotCount as any)?.c > brainState.config.max_hot_memories) {
    issues.push(`Too many hot memories (${(hotCount as any).c}/${brainState.config.max_hot_memories})`);
    recommendations.push("Run 'consolidate' to tier down old hot memories");
  }

  if (oldestDays > 30) {
    issues.push(`Some memories haven't been accessed in ${oldestDays.toFixed(0)} days`);
    recommendations.push("Run 'consolidate' to review and tier down unused memories");
  }

  const checkpointRows = await db.all("SELECT id, snapshot_path FROM brain_checkpoints");
  let missingSnapshots = 0;
  for (const row of checkpointRows) {
    const snapshotPath = (row as any).snapshot_path as string;
    if (!snapshotPath || !fs.existsSync(snapshotPath)) {
      missingSnapshots++;
    }
  }
  if (missingSnapshots > 0) {
    issues.push(`${missingSnapshots} memory checkpoint snapshot file${missingSnapshots === 1 ? " is" : "s are"} missing`);
    recommendations.push("Run heal action: prune_missing_checkpoints");
  }

  let status: "healthy" | "degraded" | "critical" = "healthy";
  if (issues.length >= 3) status = "critical";
  else if (issues.length >= 1) status = "degraded";

  return {
    status,
    db_size_bytes: dbSizeBytes,
    total_memories: total,
    fragmentation_ratio: fragRatio,
    oldest_unaccessed_days: oldestDays,
    issues,
    recommendations,
  };
}

export async function optimize(): Promise<string> {
  const db = await get();
  const results: string[] = [];

  // 1. Run VACUUM to compact database
  await db.exec("VACUUM");
  results.push("Database vacuumed (compacted)");

  // 2. Rebuild indexes
  await db.exec("REINDEX");
  results.push("Indexes rebuilt");

  // 3. Analyze for query optimizer
  await db.exec("ANALYZE");
  results.push("Query statistics updated");

  // 4. Integrity check
  const intResult = await db.get("PRAGMA integrity_check");
  const intStatus = (intResult as any)?.integrity_check ?? "unknown";
  results.push(`Integrity check: ${intStatus}`);

  return results.join("\n");
}
