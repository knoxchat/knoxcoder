/** Rate limits, audit log, session topics, and tasks. */

import { randomUUID } from "node:crypto";
import type {
  AuditLogEntry,
  BrainTask,
  RateLimitState,
  SessionTopic
} from "../types.js";
import { get } from "./connection.js";
import { rowToSessionTopic, rowToTask } from "./mappers.js";
import { brainState } from "./state.js";

// ── Rate Limiting ──────────────────────────────────────────────────────────

/**
 * Check if an LLM memory call is within rate limits.
 * Returns true if allowed, false if rate limited.
 */
export async function checkRateLimit(tokensNeeded: number = 0): Promise<boolean> {
  const db = await get();
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  const row = await db.get("SELECT * FROM brain_rate_limits WHERE id = 1") as any;
  if (!row) return true;

  // Reset if we're in a new hour
  if (now - row.hour_start > hourMs) {
    await db.run(
      "UPDATE brain_rate_limits SET calls_this_hour = 0, tokens_this_hour = 0, hour_start = ? WHERE id = 1",
      [now],
    );
    return true;
  }

  const config = brainState.config;
  if (row.calls_this_hour >= config.llm_calls_per_hour_limit) {
    await db.run("UPDATE brain_rate_limits SET denied_count = denied_count + 1 WHERE id = 1");
    return false;
  }
  if (row.tokens_this_hour + tokensNeeded > config.llm_tokens_per_hour_limit) {
    await db.run("UPDATE brain_rate_limits SET denied_count = denied_count + 1 WHERE id = 1");
    return false;
  }

  return true;
}

/**
 * Record an LLM memory call for rate limiting.
 */
export async function recordLlmCall(tokensUsed: number): Promise<void> {
  const db = await get();
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  const row = await db.get("SELECT hour_start FROM brain_rate_limits WHERE id = 1") as any;
  if (!row || now - row.hour_start > hourMs) {
    await db.run(
      "UPDATE brain_rate_limits SET calls_this_hour = 1, tokens_this_hour = ?, hour_start = ? WHERE id = 1",
      [tokensUsed, now],
    );
  } else {
    await db.run(
      "UPDATE brain_rate_limits SET calls_this_hour = calls_this_hour + 1, tokens_this_hour = tokens_this_hour + ? WHERE id = 1",
      [tokensUsed],
    );
  }
}

/**
 * Get rate limit state.
 */
export async function getRateLimitState(): Promise<RateLimitState> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_rate_limits WHERE id = 1") as any;
  if (!row) {
    return { calls_this_hour: 0, tokens_this_hour: 0, hour_start: Date.now(), denied_count: 0 };
  }
  return {
    calls_this_hour: row.calls_this_hour,
    tokens_this_hour: row.tokens_this_hour,
    hour_start: row.hour_start,
    denied_count: row.denied_count,
  };
}

// ── Audit Trail ────────────────────────────────────────────────────────────

/**
 * Record an audit log entry for any CRUD operation.
 */
export async function auditLog(action: string, targetType: string, targetId: number | string | null, details: Record<string, any> = {}): Promise<void> {
  try {
    const db = await get();
    await db.run(
      "INSERT INTO brain_audit_log (action, target_type, target_id, details) VALUES (?, ?, ?, ?)",
      [action, targetType, String(targetId ?? ""), JSON.stringify(details)],
    );
  } catch {
    // Never let audit logging break main operations
  }
}

/**
 * Query audit log entries.
 */
export async function getAuditLog(options: {
  action?: string;
  target_type?: string;
  target_id?: string;
  limit?: number;
  since?: string;
} = {}): Promise<AuditLogEntry[]> {
  const db = await get();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }
  if (options.target_type) {
    conditions.push("target_type = ?");
    params.push(options.target_type);
  }
  if (options.target_id) {
    conditions.push("target_id = ?");
    params.push(options.target_id);
  }
  if (options.since) {
    conditions.push("created_at >= ?");
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(options.limit ?? 50);

  const rows = await db.all(
    `SELECT * FROM brain_audit_log ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return rows.map((r: any) => ({
    id: r.id,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    details: r.details,
    created_at: r.created_at,
  }));
}

// ── Session Topics ─────────────────────────────────────────────────────────

/**
 * Store a detected topic for a session.
 */
export async function addSessionTopic(
  sessionId: string,
  topic: string,
  keywords: string,
  messageRangeStart: number,
  messageRangeEnd: number,
  confidence: number = 0.5,
): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT INTO brain_session_topics (session_id, topic, keywords, message_range_start, message_range_end, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, topic, keywords, messageRangeStart, messageRangeEnd, confidence],
  );
  return result.lastID!;
}

/**
 * Get topics for a session.
 */
export async function getSessionTopics(sessionId: string): Promise<SessionTopic[]> {
  const db = await get();
  const rows = await db.all(
    "SELECT * FROM brain_session_topics WHERE session_id = ? ORDER BY message_range_start ASC",
    [sessionId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    session_id: r.session_id,
    topic: r.topic,
    keywords: r.keywords,
    message_range_start: r.message_range_start,
    message_range_end: r.message_range_end,
    confidence: r.confidence,
    created_at: r.created_at,
  }));
}

/**
 * Get the latest topic for a session.
 */
export async function getLatestSessionTopic(sessionId: string): Promise<SessionTopic | null> {
  const db = await get();
  const row = await db.get(
    "SELECT * FROM brain_session_topics WHERE session_id = ? ORDER BY id DESC LIMIT 1",
    [sessionId],
  );
  if (!row) return null;
  return rowToSessionTopic(row);
}

// ── Tasks (REL-13) ─────────────────────────────────────────────────────────

export async function openTask(input: {
  sessionId: string;
  title: string;
  topicId?: number | null;
  id?: string;
}): Promise<BrainTask> {
  const db = await get();
  const id = input.id ?? randomUUID();
  await db.run(
    `INSERT INTO brain_tasks (id, session_id, topic_id, title, opened_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [id, input.sessionId, input.topicId ?? null, input.title],
  );
  const row = await db.get("SELECT * FROM brain_tasks WHERE id = ?", [id]);
  return rowToTask(row);
}

export async function getOpenTask(sessionId: string): Promise<BrainTask | null> {
  const db = await get();
  const row = await db.get(
    `SELECT * FROM brain_tasks
     WHERE session_id = ? AND closed_at IS NULL
     ORDER BY opened_at DESC LIMIT 1`,
    [sessionId],
  );
  return row ? rowToTask(row) : null;
}

export async function closeTask(taskId: string): Promise<void> {
  const db = await get();
  await db.run(
    `UPDATE brain_tasks SET closed_at = datetime('now') WHERE id = ? AND closed_at IS NULL`,
    [taskId],
  );
}

export async function bindTaskTopic(taskId: string, topicId: number): Promise<void> {
  const db = await get();
  await db.run(`UPDATE brain_tasks SET topic_id = ? WHERE id = ?`, [topicId, taskId]);
}

export async function listSessionTasks(sessionId: string): Promise<BrainTask[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_tasks WHERE session_id = ? ORDER BY rowid ASC`,
    [sessionId],
  );
  return rows.map(rowToTask);
}

/**
 * REL-05: return the active topic, creating a lightweight current-topic
 * when this session has none yet so extracts can be tagged.
 */
export async function ensureCurrentTopic(
  sessionId: string,
  seed?: { topic?: string; keywords?: string },
): Promise<SessionTopic> {
  const existing = await getLatestSessionTopic(sessionId);
  if (existing) return existing;

  const keywords = (seed?.keywords ?? "").trim();
  const fromKw = keywords
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const topic =
    seed?.topic?.trim() ||
    (fromKw.length > 0
      ? fromKw.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" / ")
      : "Current");
  const id = await addSessionTopic(sessionId, topic, keywords, 0, 0, 0.4);
  return {
    id,
    session_id: sessionId,
    topic,
    keywords,
    message_range_start: 0,
    message_range_end: 0,
    confidence: 0.4,
    created_at: new Date().toISOString(),
  };
}
