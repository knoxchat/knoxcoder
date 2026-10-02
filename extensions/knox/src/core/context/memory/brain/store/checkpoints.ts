/** Knowledge snapshots and memory checkpoints. */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { getMemoryBrainPath } from "../../../../util/paths.js";
import { RetrievalFusion } from "../RetrievalFusion.js";
import type {
  MemoryCheckpoint
} from "../types.js";
import { get } from "./connection.js";
import { auditLog } from "./runtime.js";

// ── Checkpoint / Rollback ──────────────────────────────────────────────────

/**
 * Knowledge snapshot schema v2 includes associations, tags, collections,
 * topics, and tasks so a rewind matches what the agent knew — not only
 * semantic/graph rows.
 */
export const KNOWLEDGE_SNAPSHOT_VERSION = 2;

export async function collectKnowledgeSnapshot(
  label: string,
  workspaceCheckpointId?: string,
  compressed = false,
): Promise<Record<string, any>> {
  const db = await get();
  const [
    semantic,
    entities,
    patterns,
    edges,
    procedures,
    associations,
    tags,
    collections,
    collectionItems,
    sessionTopics,
    tasks,
  ] = await Promise.all([
    db.all("SELECT * FROM brain_semantic"),
    db.all("SELECT * FROM brain_entities"),
    db.all("SELECT * FROM brain_learning_patterns"),
    db.all("SELECT * FROM brain_graph_edges"),
    db.all("SELECT * FROM brain_procedures"),
    db.all("SELECT * FROM brain_associations"),
    db.all("SELECT * FROM brain_tags"),
    db.all("SELECT * FROM brain_collections"),
    db.all("SELECT * FROM brain_collection_items"),
    db.all("SELECT * FROM brain_session_topics"),
    db.all("SELECT * FROM brain_tasks"),
  ]);

  return {
    version: KNOWLEDGE_SNAPSHOT_VERSION,
    created_at: new Date().toISOString(),
    label,
    compressed,
    workspace_checkpoint_id: workspaceCheckpointId,
    semantic,
    entities,
    patterns,
    edges,
    procedures,
    associations,
    tags,
    collections,
    collection_items: collectionItems,
    session_topics: sessionTopics,
    tasks,
  };
}

export function readKnowledgeSnapshot(snapshotPath: string): any {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }
  const raw = fs.readFileSync(snapshotPath);
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    return JSON.parse(zlib.gunzipSync(raw as Uint8Array).toString("utf-8"));
  }
  return JSON.parse(raw.toString("utf-8"));
}

export async function restoreKnowledgeTables(snapshot: any): Promise<void> {
  const db = await get();
  const sessionRows = await db.all("SELECT id FROM brain_sessions");
  const sessionIds = new Set(sessionRows.map((row: any) => String(row.id)));

  await db.exec("DELETE FROM brain_collection_items");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_associations");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_tasks");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_entities");
  await db.exec("DELETE FROM brain_learning_patterns");
  await db.exec("DELETE FROM brain_procedures");
  await db.exec("DELETE FROM brain_collections");

  for (const mem of snapshot.semantic ?? []) {
    const sessionId =
      mem.source_session_id && sessionIds.has(String(mem.source_session_id))
        ? mem.source_session_id
        : null;
    await db.run(
      `INSERT INTO brain_semantic (id, category, title, content, source_session_id, keywords, importance_score, retrieval_count, tier, created_at, last_accessed_at, expires_at, emotional_valence, salience, topic_id, task_id, mismatch_count, mismatch_until, mismatch_topic_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mem.id,
        mem.category,
        mem.title,
        mem.content,
        sessionId,
        mem.keywords,
        mem.importance_score,
        mem.retrieval_count,
        mem.tier,
        mem.created_at,
        mem.last_accessed_at,
        mem.expires_at,
        mem.emotional_valence ?? "neutral",
        mem.salience ?? 0.5,
        mem.topic_id ?? null,
        mem.task_id ?? null,
        mem.mismatch_count ?? 0,
        mem.mismatch_until ?? null,
        mem.mismatch_topic_id ?? null,
      ],
    );
  }

  for (const entity of snapshot.entities ?? []) {
    await db.run(
      `INSERT INTO brain_entities (id, name, entity_type, description, properties, confidence, mention_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.name,
        entity.entity_type,
        entity.description,
        entity.properties,
        entity.confidence,
        entity.mention_count,
        entity.created_at,
        entity.updated_at,
      ],
    );
  }

  for (const edge of snapshot.edges ?? []) {
    await db.run(
      `INSERT INTO brain_graph_edges (id, source_entity_id, target_entity_id, relationship, weight, properties, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        edge.id,
        edge.source_entity_id,
        edge.target_entity_id,
        edge.relationship,
        edge.weight,
        edge.properties,
        edge.created_at,
      ],
    );
  }

  for (const pattern of snapshot.patterns ?? []) {
    await db.run(
      `INSERT INTO brain_learning_patterns (id, goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, last_used_at, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pattern.id,
        pattern.goal_type,
        pattern.pattern_signature,
        pattern.description,
        pattern.success_count,
        pattern.failure_count,
        pattern.confidence,
        pattern.avg_tokens_used,
        pattern.last_used_at,
        pattern.created_at,
        pattern.metadata,
      ],
    );
  }

  for (const proc of snapshot.procedures ?? []) {
    await db.run(
      `INSERT INTO brain_procedures (id, name, description, steps, trigger_pattern, success_rate, execution_count, last_executed_at, created_at, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        proc.id,
        proc.name,
        proc.description,
        proc.steps,
        proc.trigger_pattern,
        proc.success_rate,
        proc.execution_count,
        proc.last_executed_at,
        proc.created_at,
        proc.category,
      ],
    );
  }

  for (const assoc of snapshot.associations ?? []) {
    await db.run(
      `INSERT OR IGNORE INTO brain_associations (id, source_type, source_id, target_type, target_id, relationship, strength, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assoc.id,
        assoc.source_type,
        assoc.source_id,
        assoc.target_type,
        assoc.target_id,
        assoc.relationship,
        assoc.strength,
        assoc.created_at,
      ],
    );
  }

  for (const tag of snapshot.tags ?? []) {
    await db.run(
      `INSERT OR IGNORE INTO brain_tags (id, memory_type, memory_id, tag, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [tag.id, tag.memory_type, tag.memory_id, tag.tag, tag.created_at],
    );
  }

  for (const collection of snapshot.collections ?? []) {
    await db.run(
      `INSERT OR IGNORE INTO brain_collections (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        collection.id,
        collection.name,
        collection.description,
        collection.created_at,
        collection.updated_at,
      ],
    );
  }

  for (const item of snapshot.collection_items ?? []) {
    await db.run(
      `INSERT OR IGNORE INTO brain_collection_items (id, collection_id, memory_type, memory_id, added_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        item.id,
        item.collection_id,
        item.memory_type,
        item.memory_id,
        item.added_at,
      ],
    );
  }

  for (const topic of snapshot.session_topics ?? []) {
    if (!topic.session_id || !sessionIds.has(String(topic.session_id))) {
      continue;
    }
    await db.run(
      `INSERT OR IGNORE INTO brain_session_topics (id, session_id, topic, keywords, message_range_start, message_range_end, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        topic.id,
        topic.session_id,
        topic.topic,
        topic.keywords,
        topic.message_range_start,
        topic.message_range_end,
        topic.confidence,
        topic.created_at,
      ],
    );
  }

  for (const task of snapshot.tasks ?? []) {
    if (!task.session_id || !sessionIds.has(String(task.session_id))) {
      continue;
    }
    await db.run(
      `INSERT OR IGNORE INTO brain_tasks (id, session_id, topic_id, title, opened_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.session_id,
        task.topic_id ?? null,
        task.title,
        task.opened_at,
        task.closed_at ?? null,
      ],
    );
  }
}

/**
 * Create a checkpoint snapshot of the current memory state.
 * v2 snapshots include associations, tags, collections, topics, and tasks.
 */
export async function createCheckpoint(
  label: string,
  workspaceCheckpointId?: string,
  options?: { compress?: boolean },
): Promise<MemoryCheckpoint> {
  const db = await get();

  let linkedWorkspaceId = workspaceCheckpointId;
  if (!linkedWorkspaceId) {
    try {
      const { resolveLinkedWorkspaceCheckpointId } = await import(
        "../../../soul/recordSoulEvent.js"
      );
      linkedWorkspaceId = resolveLinkedWorkspaceCheckpointId();
    } catch {
      // Linking is best-effort.
    }
  }

  const compress = options?.compress === true;
  const snapshot = await collectKnowledgeSnapshot(
    label,
    linkedWorkspaceId,
    compress,
  );

  const brainDir = getMemoryBrainPath();
  if (!fs.existsSync(brainDir)) {
    fs.mkdirSync(brainDir, { recursive: true });
  }
  const snapshotPath = path.join(
    brainDir,
    compress
      ? `checkpoint-${Date.now()}.json.gz`
      : `checkpoint-${Date.now()}.json`,
  );
  if (compress) {
    const compressed = zlib.gzipSync(
      Buffer.from(JSON.stringify(snapshot), "utf-8") as Uint8Array,
    );
    fs.writeFileSync(snapshotPath, compressed as Uint8Array);
  } else {
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  }

  const result = await db.run(
    `INSERT INTO brain_checkpoints (label, semantic_count, entity_count, pattern_count, snapshot_path, workspace_checkpoint_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      label,
      (snapshot.semantic ?? []).length,
      (snapshot.entities ?? []).length,
      (snapshot.patterns ?? []).length,
      snapshotPath,
      linkedWorkspaceId ?? null,
    ],
  );

  await auditLog("create_checkpoint", "checkpoint", result.lastID!, {
    label,
    compressed: compress,
    workspace_checkpoint_id: linkedWorkspaceId,
  });

  return {
    id: result.lastID!,
    label,
    created_at: snapshot.created_at,
    semantic_count: (snapshot.semantic ?? []).length,
    entity_count: (snapshot.entities ?? []).length,
    pattern_count: (snapshot.patterns ?? []).length,
    snapshot_path: snapshotPath,
    workspace_checkpoint_id: linkedWorkspaceId,
  };
}

/**
 * List all checkpoints ordered by creation date.
 */
export async function listCheckpoints(limit: number = 20): Promise<MemoryCheckpoint[]> {
  const db = await get();
  const rows = await db.all(
    "SELECT * FROM brain_checkpoints ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map((row: any) => mapCheckpointRow(row));
}

/** Latest brain checkpoint linked to a workspace file checkpoint. */
export async function findCheckpointByWorkspaceId(
  workspaceCheckpointId: string,
): Promise<MemoryCheckpoint | undefined> {
  if (!workspaceCheckpointId.trim()) {
    return undefined;
  }
  const db = await get();
  const row = await db.get(
    "SELECT * FROM brain_checkpoints WHERE workspace_checkpoint_id = ? ORDER BY id DESC LIMIT 1",
    [workspaceCheckpointId],
  );
  return row ? mapCheckpointRow(row) : undefined;
}

/**
 * Closest brain checkpoint at or before a workspace restore time.
 * Used when an older file CP was never paired with a memory snapshot.
 */
export async function findNearestCheckpointBefore(
  createdAt: string,
): Promise<MemoryCheckpoint | undefined> {
  if (!createdAt.trim()) {
    return undefined;
  }
  const db = await get();
  const row = await db.get(
    `SELECT * FROM brain_checkpoints
     WHERE datetime(created_at) <= datetime(?)
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 1`,
    [createdAt],
  );
  return row ? mapCheckpointRow(row) : undefined;
}

/** Drop every brain checkpoint that was pinned to a deleted workspace CP. */
export async function deleteCheckpointsForWorkspaceId(
  workspaceCheckpointId: string,
): Promise<number> {
  if (!workspaceCheckpointId.trim()) {
    return 0;
  }
  const db = await get();
  const rows = await db.all(
    "SELECT id FROM brain_checkpoints WHERE workspace_checkpoint_id = ?",
    [workspaceCheckpointId],
  );
  let deleted = 0;
  for (const row of rows) {
    if (await deleteCheckpoint((row as any).id)) {
      deleted++;
    }
  }
  return deleted;
}

/**
 * Drop episodic turns recorded after a workspace restore point.
 * Conversation history before that timestamp is kept.
 */
export async function trimEpisodicAfter(
  sessionId: string,
  createdAt: string,
): Promise<number> {
  if (!sessionId || !createdAt) {
    return 0;
  }
  const db = await get();
  const result = await db.run(
    `DELETE FROM brain_episodic
     WHERE session_id = ? AND datetime(created_at) > datetime(?)`,
    [sessionId, createdAt],
  );
  return result.changes ?? 0;
}

export function mapCheckpointRow(row: any): MemoryCheckpoint {
  return {
    id: row.id,
    label: row.label,
    created_at: row.created_at,
    semantic_count: row.semantic_count,
    entity_count: row.entity_count,
    pattern_count: row.pattern_count,
    snapshot_path: row.snapshot_path,
    workspace_checkpoint_id: row.workspace_checkpoint_id || undefined,
  };
}

/**
 * Rollback memory to a checkpoint state.
 * Replaces knowledge tables (semantic, graph, patterns, procedures,
 * associations, tags, collections, topics, tasks) inside one transaction.
 * Episodic memory and sessions are NOT rolled back.
 */
export async function rollbackCheckpoint(checkpointId: number): Promise<string> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_checkpoints WHERE id = ?", [checkpointId]);
  if (!row) throw new Error(`Checkpoint #${checkpointId} not found`);

  const snapshotPath = (row as any).snapshot_path;
  const snapshot = readKnowledgeSnapshot(snapshotPath);

  await db.exec("BEGIN TRANSACTION");
  try {
    await restoreKnowledgeTables(snapshot);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  await RetrievalFusion.rebuildFts5(db).catch(() => {});

  const label = (row as any).label;
  const linked = (row as any).workspace_checkpoint_id as string | undefined;
  const base = `Rolled back to checkpoint "${label}" — restored ${snapshot.semantic?.length ?? 0} semantic, ${snapshot.entities?.length ?? 0} entities, ${snapshot.patterns?.length ?? 0} patterns, ${snapshot.edges?.length ?? 0} edges, ${snapshot.procedures?.length ?? 0} procedures, ${snapshot.associations?.length ?? 0} associations, ${snapshot.tags?.length ?? 0} tags`;
  if (!linked) {
    return base;
  }
  try {
    const { formatLinkedRestoreOffer } = await import(
      "../../../soul/extractToolFiles.js"
    );
    const offer = formatLinkedRestoreOffer(linked);
    return offer ? `${base}\n${offer}` : base;
  } catch {
    return `${base}\nLinked workspace checkpoint: ${linked}`;
  }
}

/** Remove checkpoint rows whose snapshot files are gone. */
export async function pruneMissingCheckpointSnapshots(): Promise<number> {
  const db = await get();
  const rows = await db.all("SELECT id, snapshot_path FROM brain_checkpoints");
  let pruned = 0;
  for (const row of rows) {
    const snapshotPath = (row as any).snapshot_path as string;
    if (snapshotPath && fs.existsSync(snapshotPath)) {
      continue;
    }
    await db.run("DELETE FROM brain_checkpoints WHERE id = ?", [(row as any).id]);
    pruned++;
  }
  return pruned;
}

/**
 * Delete a checkpoint and its snapshot file.
 */
export async function deleteCheckpoint(checkpointId: number): Promise<boolean> {
  const db = await get();
  const row = await db.get("SELECT snapshot_path FROM brain_checkpoints WHERE id = ?", [checkpointId]);
  if (!row) return false;

  const snapshotPath = (row as any).snapshot_path;
  if (snapshotPath && fs.existsSync(snapshotPath)) {
    fs.unlinkSync(snapshotPath);
  }

  await db.run("DELETE FROM brain_checkpoints WHERE id = ?", [checkpointId]);
  return true;
}
