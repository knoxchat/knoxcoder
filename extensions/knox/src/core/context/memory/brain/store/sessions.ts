/** Session rows and per-tier token estimates. */

import type {
  BrainSession
} from "../types.js";
import { get } from "./connection.js";
import { rowToSession } from "./mappers.js";

// ── Session Operations ─────────────────────────────────────────────────────

export async function createSession(id: string, title: string, workspaceDir: string): Promise<void> {
  const db = await get();
  const { hashProjectId } = await import("../projectScope.js");
  const projectId = hashProjectId(workspaceDir);
  await db.run(
    `INSERT OR REPLACE INTO brain_sessions (id, title, workspace_directory, project_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [id, title, workspaceDir, projectId],
  );
}

/** Backfill project_id and workspace_directory when a session is re-tracked (IMP-25). */
export async function ensureSessionProjectId(sessionId: string, workspaceDir: string): Promise<void> {
  if (!workspaceDir) return;
  const db = await get();
  const { hashProjectId } = await import("../projectScope.js");
  const projectId = hashProjectId(workspaceDir);
  await db.run(
    `UPDATE brain_sessions
     SET workspace_directory = CASE WHEN workspace_directory = '' OR workspace_directory IS NULL THEN ? ELSE workspace_directory END,
         project_id = CASE WHEN project_id = '' OR project_id IS NULL THEN ? ELSE project_id END,
         updated_at = datetime('now')
     WHERE id = ?`,
    [workspaceDir, projectId, sessionId],
  );
}

export async function listSessionIdsByProject(projectId: string): Promise<string[]> {
  const db = await get();
  const rows = await db.all(
    "SELECT id FROM brain_sessions WHERE project_id = ?",
    [projectId],
  );
  return rows.map((r: any) => r.id as string);
}

/**
 * Estimate token counts per memory tier for C_effective calculation.
 */
export async function getTierTokenCounts(): Promise<Record<string, number>> {
  const db = await get();
  const tiers = ["active", "hot", "warm", "cold", "frozen"];
  const counts: Record<string, number> = Object.fromEntries(tiers.map((t) => [t, 0]));

  const semRows = await db.all(`
    SELECT tier,
      SUM(CAST((LENGTH(title) + LENGTH(content) + LENGTH(keywords)) / 4 AS INTEGER)) AS tokens
    FROM brain_semantic
    GROUP BY tier
  `);
  for (const r of semRows) {
    const tier = (r as any).tier;
    if (counts[tier] !== undefined) {
      counts[tier] += (r as any).tokens ?? 0;
    }
  }

  const epRows = await db.all(`
    SELECT tier,
      SUM(CASE WHEN token_count > 0 THEN token_count
           ELSE CAST(LENGTH(content) / 4 AS INTEGER) END) AS tokens
    FROM brain_episodic
    GROUP BY tier
  `);
  for (const r of epRows) {
    const tier = (r as any).tier;
    if (counts[tier] !== undefined) {
      counts[tier] += (r as any).tokens ?? 0;
    }
  }

  return counts;
}

export async function updateSession(id: string, updates: Partial<Pick<BrainSession, "title" | "summary" | "is_active" | "message_count">>): Promise<void> {
  const db = await get();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];

  if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
  if (updates.summary !== undefined) { sets.push("summary = ?"); params.push(updates.summary); }
  if (updates.is_active !== undefined) { sets.push("is_active = ?"); params.push(updates.is_active ? 1 : 0); }
  if (updates.message_count !== undefined) { sets.push("message_count = ?"); params.push(updates.message_count); }

  params.push(id);
  await db.run(`UPDATE brain_sessions SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function getSession(id: string): Promise<BrainSession | null> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_sessions WHERE id = ?", [id]);
  return row ? rowToSession(row) : null;
}

export async function listSessions(limit = 50, workspaceDir?: string): Promise<BrainSession[]> {
  const db = await get();
  let sql = "SELECT * FROM brain_sessions";
  const params: any[] = [];

  if (workspaceDir) {
    sql += " WHERE workspace_directory = ?";
    params.push(workspaceDir);
  }

  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);

  const rows = await db.all(sql, params);
  return rows.map(rowToSession);
}

export async function deleteSession(id: string): Promise<boolean> {
  const db = await get();
  const result = await db.run("DELETE FROM brain_sessions WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}
