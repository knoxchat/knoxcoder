/** Import/export and cross-session backlog search. */

import { RetrievalFusion } from "../RetrievalFusion.js";
import type {
  BacklogSearchResult,
  EpisodicMemory,
  MemoryExport,
  SemanticMemory
} from "../types.js";
import { loadConfig } from "./config.js";
import { get } from "./connection.js";
import { rowToAssociation, rowToAuditLogEntry, rowToCollection, rowToCollectionItem, rowToEdge, rowToEntity, rowToEpisodic, rowToPattern, rowToProcedure, rowToSemantic, rowToSession, rowToSessionTopic, rowToTag, rowToTask } from "./mappers.js";

// ── Import/Export ──────────────────────────────────────────────────────────

export async function exportAll(): Promise<MemoryExport> {
  const db = await get();

  const sessions = (await db.all("SELECT * FROM brain_sessions")).map(rowToSession);
  const semantic = (await db.all("SELECT * FROM brain_semantic")).map(rowToSemantic);
  const episodic = (await db.all("SELECT * FROM brain_episodic")).map(rowToEpisodic);
  const associations = (await db.all("SELECT * FROM brain_associations")).map(rowToAssociation);
  const entities = (await db.all("SELECT * FROM brain_entities")).map(rowToEntity);
  const edges = (await db.all("SELECT * FROM brain_graph_edges")).map(rowToEdge);
  const patterns = (await db.all("SELECT * FROM brain_learning_patterns")).map(rowToPattern);
  const procedures = (await db.all("SELECT * FROM brain_procedures")).map(rowToProcedure);
  const tags = (await db.all("SELECT * FROM brain_tags")).map(rowToTag);
  const collections = (await db.all(
    `SELECT c.*, COUNT(ci.id) as item_count
     FROM brain_collections c
     LEFT JOIN brain_collection_items ci ON c.id = ci.collection_id
     GROUP BY c.id`,
  )).map(rowToCollection);
  const collectionItems = (await db.all("SELECT * FROM brain_collection_items")).map(rowToCollectionItem);
  const auditLog = (await db.all("SELECT * FROM brain_audit_log ORDER BY id ASC")).map(rowToAuditLogEntry);
  const sessionTopics = (await db.all("SELECT * FROM brain_session_topics ORDER BY id ASC")).map(rowToSessionTopic);
  const tasks = (await db.all("SELECT * FROM brain_tasks ORDER BY opened_at ASC")).map(rowToTask);
  const configRows = await db.all("SELECT key, value FROM brain_config");
  const config: Record<string, string> = {};
  for (const row of configRows) {
    config[(row as any).key] = (row as any).value;
  }

  return {
    version: "1.0.0",
    exported_at: new Date().toISOString(),
    sessions,
    semantic,
    episodic,
    associations,
    entities,
    edges,
    patterns,
    procedures,
    tags,
    collections,
    collection_items: collectionItems,
    audit_log: auditLog,
    session_topics: sessionTopics,
    tasks,
    config,
  };
}

export async function importData(data: MemoryExport): Promise<{ imported: Record<string, number> }> {
  const db = await get();
  const imported: Record<string, number> = {};

  await db.exec("BEGIN TRANSACTION");
  try {
    let count = 0;
    for (const session of data.sessions ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_sessions (id, title, workspace_directory, project_id, created_at, updated_at, message_count, summary, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.title,
          session.workspace_directory,
          session.project_id ?? "",
          session.created_at,
          session.updated_at,
          session.message_count,
          session.summary,
          session.is_active ? 1 : 0,
        ],
      );
      count += result.changes ?? 0;
    }
    imported.sessions = count;

    count = 0;
    for (const mem of data.semantic ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_semantic (id, category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, retrieval_count, tier, created_at, last_accessed_at, expires_at, topic_id, task_id, mismatch_count, mismatch_until, mismatch_topic_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mem.id, mem.category, mem.title, mem.content, mem.source_session_id, mem.keywords, mem.importance_score, mem.emotional_valence ?? "neutral", mem.salience ?? 0.5, mem.retrieval_count, mem.tier, mem.created_at, mem.last_accessed_at, mem.expires_at, mem.topic_id ?? null, mem.task_id ?? null, mem.mismatch_count ?? 0, mem.mismatch_until ?? null, mem.mismatch_topic_id ?? null],
      );
      count += result.changes ?? 0;
    }
    imported.semantic = count;

    count = 0;
    for (const mem of data.episodic ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_episodic (id, session_id, type, role, content, token_count, importance_score, emotional_valence, salience, tier, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mem.id, mem.session_id, mem.type, mem.role, mem.content, mem.token_count, mem.importance_score, mem.emotional_valence ?? "neutral", mem.salience ?? 0.5, mem.tier, mem.metadata, mem.created_at],
      );
      count += result.changes ?? 0;
    }
    imported.episodic = count;

    count = 0;
    for (const assoc of data.associations ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_associations (id, source_type, source_id, target_type, target_id, relationship, strength, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [assoc.id, assoc.source_type, assoc.source_id, assoc.target_type, assoc.target_id, assoc.relationship, assoc.strength, assoc.created_at],
      );
      count += result.changes ?? 0;
    }
    imported.associations = count;

    count = 0;
    for (const entity of data.entities ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_entities (id, name, entity_type, description, properties, confidence, mention_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entity.id, entity.name, entity.entity_type, entity.description, entity.properties, entity.confidence, entity.mention_count, entity.created_at, entity.updated_at],
      );
      count += result.changes ?? 0;
    }
    imported.entities = count;

    count = 0;
    for (const edge of data.edges ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_graph_edges (id, source_entity_id, target_entity_id, relationship, weight, properties, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [edge.id, edge.source_entity_id, edge.target_entity_id, edge.relationship, edge.weight, edge.properties, edge.created_at],
      );
      count += result.changes ?? 0;
    }
    imported.edges = count;

    count = 0;
    for (const pattern of data.patterns ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_learning_patterns (id, goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, last_used_at, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pattern.id, pattern.goal_type, pattern.pattern_signature, pattern.description, pattern.success_count, pattern.failure_count, pattern.confidence, pattern.avg_tokens_used, pattern.last_used_at, pattern.created_at, pattern.metadata],
      );
      count += result.changes ?? 0;
    }
    imported.patterns = count;

    count = 0;
    for (const proc of data.procedures ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_procedures (id, name, description, steps, trigger_pattern, success_rate, execution_count, last_executed_at, created_at, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [proc.id, proc.name, proc.description, proc.steps, proc.trigger_pattern, proc.success_rate, proc.execution_count, proc.last_executed_at, proc.created_at, proc.category],
      );
      count += result.changes ?? 0;
    }
    imported.procedures = count;

    count = 0;
    for (const tag of data.tags ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_tags (id, memory_type, memory_id, tag, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [tag.id, tag.memory_type, tag.memory_id, tag.tag, tag.created_at],
      );
      count += result.changes ?? 0;
    }
    imported.tags = count;

    count = 0;
    for (const collection of data.collections ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_collections (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [collection.id, collection.name, collection.description, collection.created_at, collection.updated_at],
      );
      count += result.changes ?? 0;
    }
    imported.collections = count;

    count = 0;
    for (const item of data.collection_items ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_collection_items (id, collection_id, memory_type, memory_id, added_at)
         VALUES (?, ?, ?, ?, ?)`,
        [item.id, item.collection_id, item.memory_type, item.memory_id, item.added_at],
      );
      count += result.changes ?? 0;
    }
    imported.collection_items = count;

    count = 0;
    for (const topic of data.session_topics ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_session_topics (id, session_id, topic, keywords, message_range_start, message_range_end, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [topic.id, topic.session_id, topic.topic, topic.keywords, topic.message_range_start, topic.message_range_end, topic.confidence, topic.created_at],
      );
      count += result.changes ?? 0;
    }
    imported.session_topics = count;

    count = 0;
    for (const task of data.tasks ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_tasks (id, session_id, topic_id, title, opened_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [task.id, task.session_id, task.topic_id ?? null, task.title, task.opened_at, task.closed_at ?? null],
      );
      count += result.changes ?? 0;
    }
    imported.tasks = count;

    count = 0;
    for (const entry of data.audit_log ?? []) {
      const result = await db.run(
        `INSERT OR IGNORE INTO brain_audit_log (id, action, target_type, target_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.id, entry.action, entry.target_type, String(entry.target_id ?? ""), entry.details, entry.created_at],
      );
      count += result.changes ?? 0;
    }
    imported.audit_log = count;

    count = 0;
    for (const [key, value] of Object.entries(data.config ?? {})) {
      const result = await db.run(
        `INSERT OR REPLACE INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
        [key, value],
      );
      count += result.changes ?? 0;
    }
    imported.config = count;

    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }

  await RetrievalFusion.rebuildFts5(db).catch(() => {});
  await loadConfig();

  return { imported };
}

// ── Cross-Session Backlog Search ───────────────────────────────────────────

/**
 * Search across ALL sessions for matching episodic and semantic memories.
 * Supports date range, role filters, and session ID filters.
 */
export async function searchBacklogs(
  query: string,
  options: {
    limit?: number;
    session_ids?: string[];
    date_from?: string;
    date_to?: string;
    roles?: string[];
    include_semantic?: boolean;
    include_episodic?: boolean;
  } = {},
): Promise<BacklogSearchResult> {
  const db = await get();
  const limit = options.limit ?? 30;

  // Project scope with no sessions → no cross-project matches (IMP-25)
  if (options.session_ids !== undefined && options.session_ids.length === 0) {
    return {
      semantic: [],
      episodic: [],
      sessions_searched: 0,
      total_matches: 0,
    };
  }

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

  let episodic: EpisodicMemory[] = [];
  let semantic: SemanticMemory[] = [];
  let sessionsSearched = 0;

  // Count sessions searched
  if (options.session_ids && options.session_ids.length > 0) {
    sessionsSearched = options.session_ids.length;
  } else {
    const countRow = await db.get("SELECT COUNT(DISTINCT id) as cnt FROM brain_sessions");
    sessionsSearched = (countRow as any)?.cnt ?? 0;
  }

  // Episodic search across all sessions
  if (options.include_episodic !== false) {
    const epConditions: string[] = [];
    const epParams: any[] = [];

    if (terms.length > 0) {
      const termConds = terms.map(() => "LOWER(e.content) LIKE ?");
      epConditions.push(`(${termConds.join(" OR ")})`);
      for (const term of terms) {
        epParams.push(`%${term}%`);
      }
    }

    if (options.session_ids && options.session_ids.length > 0) {
      epConditions.push(`e.session_id IN (${options.session_ids.map(() => "?").join(",")})`);
      epParams.push(...options.session_ids);
    }

    if (options.date_from) {
      epConditions.push("e.created_at >= ?");
      epParams.push(options.date_from);
    }
    if (options.date_to) {
      epConditions.push("e.created_at <= ?");
      epParams.push(options.date_to);
    }

    if (options.roles && options.roles.length > 0) {
      epConditions.push(`e.role IN (${options.roles.map(() => "?").join(",")})`);
      epParams.push(...options.roles);
    }

    const epWhere = epConditions.length > 0 ? `WHERE ${epConditions.join(" AND ")}` : "";
    epParams.push(limit);

    const epRows = await db.all(
      `SELECT e.*, s.title as session_title FROM brain_episodic e
       LEFT JOIN brain_sessions s ON e.session_id = s.id
       ${epWhere}
       ORDER BY e.importance_score DESC, e.created_at DESC LIMIT ?`,
      epParams,
    );
    episodic = epRows.map(rowToEpisodic);
  }

  // Semantic search across all sessions
  if (options.include_semantic !== false) {
    const semConditions: string[] = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
    const semParams: any[] = [];

    if (terms.length > 0) {
      const termConds = terms.map(() =>
        "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
      );
      semConditions.push(`(${termConds.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        semParams.push(like, like, like);
      }
    }

    if (options.session_ids && options.session_ids.length > 0) {
      semConditions.push(`source_session_id IN (${options.session_ids.map(() => "?").join(",")})`);
      semParams.push(...options.session_ids);
    } else if (options.session_ids !== undefined) {
      semConditions.push("1 = 0");
    }

    if (options.date_from) {
      semConditions.push("created_at >= ?");
      semParams.push(options.date_from);
    }
    if (options.date_to) {
      semConditions.push("created_at <= ?");
      semParams.push(options.date_to);
    }

    semParams.push(limit);

    const semRows = await db.all(
      `SELECT * FROM brain_semantic
       WHERE ${semConditions.join(" AND ")}
       ORDER BY importance_score DESC, retrieval_count DESC, last_accessed_at DESC LIMIT ?`,
      semParams,
    );
    semantic = semRows.map(rowToSemantic);

    // Update retrieval stats
    if (semantic.length > 0) {
      const ids = semantic.map((r) => r.id).join(",");
      await db.exec(`
        UPDATE brain_semantic
        SET retrieval_count = retrieval_count + 1,
            last_accessed_at = datetime('now')
        WHERE id IN (${ids})
      `);
    }
  }

  return {
    semantic,
    episodic,
    sessions_searched: sessionsSearched,
    total_matches: semantic.length + episodic.length,
  };
}
