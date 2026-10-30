/** Consolidation, stats, health, and optimize. */

import fs from "fs";
import { getMemoryBrainSqlitePath } from "../../../../util/paths.js";
import type {
  BrainStats,
  ConsolidationResult,
  HealthStatus
} from "../types.js";
import { compressColdTier } from "./compression.js";
import { get } from "./connection.js";
import { brainState } from "./state.js";
import { decompressLiveTiers, recomputeMemoryTiers } from "./tiers.js";

// ── Consolidation (Knox-MS Memory Tiering Pattern) ─────────────────────────

/**
 * Recompute stored tiers from R and Value (MEM-15).
 * Clock knobs are unused. Age never tombstones; forget/TTL/privacy are MEM-06.
 */
export async function consolidate(): Promise<ConsolidationResult> {
  const result: ConsolidationResult = { promoted: 0, demoted: 0, pruned: 0, summaries_created: 0 };

  const tiers = await recomputeMemoryTiers();
  result.promoted = tiers.promoted;
  result.demoted = tiers.demoted;

  await compressColdTier().catch(() => {});
  if (tiers.promoted > 0) {
    await decompressLiveTiers().catch(() => {});
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

  const tierMap: Record<string, number> = { active: 0, hot: 0, warm: 0, cold: 0, frozen: 0 };
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
    `SELECT MIN(last_accessed_at) as m FROM brain_semantic WHERE tier != 'cold' AND tier != 'frozen'`,
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
    recommendations.push("Run 'consolidate' to archive old memories and 'optimize' to compact the database");
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
    recommendations.push("Run 'consolidate' to recompute R/Value tiers");
  }

  if (oldestDays > 30) {
    issues.push(`Some memories haven't been accessed in ${oldestDays.toFixed(0)} days`);
    recommendations.push("Run 'consolidate' to recompute R/Value tiers for unused memories");
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
