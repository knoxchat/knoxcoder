/** Persist attribution rows (MEM-17) and leaf h / u counts (MEM-18). */

import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import { get } from "./connection.js";

export type AttributionMemType = "semantic" | "episodic" | "recipe";
export type AttributionChannel = "lexical" | "ripgrep" | "graph" | "tree";

export interface AttributionRow {
  id: number;
  turn_id: string | null;
  session_id: string | null;
  mem_type: string;
  mem_id: string;
  injected: number;
  cited: number;
  helpful: number | null;
  channel: string | null;
  score: number | null;
  created_at: string | null;
}

export interface UpsertAttributionInput {
  turn_id: string;
  session_id?: string | null;
  mem_type: AttributionMemType;
  mem_id: string;
  injected: boolean;
  cited: boolean;
  helpful?: boolean | null;
  channel?: AttributionChannel | string | null;
  score?: number | null;
}

const ATTRIBUTION_SELECT =
  "id, turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel, score, created_at";

function asBoolInt(value: boolean | null | undefined): number | null {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function asScore(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asChannel(value: string | null | undefined): string | null {
  const channel = value?.trim();
  return channel ? channel : null;
}

function rowOf(raw: Record<string, unknown>): AttributionRow {
  return {
    id: Number(raw.id),
    turn_id: raw.turn_id == null ? null : String(raw.turn_id),
    session_id: raw.session_id == null ? null : String(raw.session_id),
    mem_type: String(raw.mem_type ?? ""),
    mem_id: String(raw.mem_id ?? ""),
    injected: Number(raw.injected ?? 0),
    cited: Number(raw.cited ?? 0),
    helpful: raw.helpful == null ? null : Number(raw.helpful),
    channel: raw.channel == null || raw.channel === "" ? null : String(raw.channel),
    score: raw.score == null ? null : Number(raw.score),
    created_at: raw.created_at == null ? null : String(raw.created_at),
  };
}

export async function listAttributionsForTurnOn(
  db: DatabaseConnection,
  turnId: string,
): Promise<AttributionRow[]> {
  const id = turnId.trim();
  if (!id) return [];
  const rows = await db.all(
    `SELECT ${ATTRIBUTION_SELECT} FROM brain_attribution WHERE turn_id = ? ORDER BY id ASC`,
    [id],
  );
  return (rows as Record<string, unknown>[]).map(rowOf);
}

export async function listAttributionsForTurn(turnId: string): Promise<AttributionRow[]> {
  return listAttributionsForTurnOn(await get(), turnId);
}

export async function listAttributionLog(db: DatabaseConnection): Promise<AttributionRow[]> {
  const rows = await db.all(
    `SELECT ${ATTRIBUTION_SELECT} FROM brain_attribution ORDER BY id ASC`,
  );
  return (rows as Record<string, unknown>[]).map(rowOf);
}

export async function listLatestAttributedTurn(
  sessionId: string,
): Promise<{ turn_id: string; rows: AttributionRow[] } | null> {
  const session = sessionId.trim();
  if (!session) return null;
  const db = await get();
  const latest = (await db.get(
    `SELECT turn_id FROM brain_attribution
     WHERE session_id = ? AND turn_id IS NOT NULL AND turn_id != ''
     ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
    [session],
  )) as { turn_id: string } | undefined;
  if (!latest?.turn_id) return null;
  const rows = await listAttributionsForTurnOn(db, latest.turn_id);
  return rows.length > 0 ? { turn_id: latest.turn_id, rows } : null;
}

/**
 * Insert or merge one (turn, memory) row. `injected` / `cited` are OR'd.
 * `helpful` is written only when the caller supplies a boolean.
 * `channel` / `score` fill in when missing; a later write does not clear them.
 */
export async function upsertAttributionOn(
  db: DatabaseConnection,
  input: UpsertAttributionInput,
): Promise<AttributionRow | null> {
  const turnId = input.turn_id.trim();
  const memId = input.mem_id.trim();
  if (!turnId || !memId || !input.mem_type) return null;

  const existing = (await db.get(
    `SELECT ${ATTRIBUTION_SELECT} FROM brain_attribution WHERE turn_id = ? AND mem_type = ? AND mem_id = ?`,
    [turnId, input.mem_type, memId],
  )) as Record<string, unknown> | undefined;

  const injected = input.injected ? 1 : 0;
  const cited = input.cited ? 1 : 0;
  const helpful = asBoolInt(input.helpful);
  const channel = asChannel(input.channel);
  const score = asScore(input.score);

  if (!existing) {
    const result = await db.run(
      `INSERT INTO brain_attribution (turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [turnId, input.session_id ?? null, input.mem_type, memId, injected, cited, helpful, channel, score],
    );
    const id = Number(result.lastID);
    const inserted = await db.get(
      `SELECT ${ATTRIBUTION_SELECT} FROM brain_attribution WHERE id = ?`,
      [id],
    );
    return inserted ? rowOf(inserted as Record<string, unknown>) : null;
  }

  const nextInjected = Number(existing.injected ?? 0) || injected;
  const nextCited = Number(existing.cited ?? 0) || cited;
  const nextHelpful = helpful != null ? helpful : existing.helpful == null ? null : Number(existing.helpful);
  const nextChannel = channel ?? (existing.channel == null || existing.channel === "" ? null : String(existing.channel));
  const nextScore = score ?? (existing.score == null ? null : Number(existing.score));
  await db.run(
    `UPDATE brain_attribution
     SET injected = ?, cited = ?, helpful = ?, channel = ?, score = ?, session_id = COALESCE(session_id, ?)
     WHERE id = ?`,
    [nextInjected, nextCited, nextHelpful, nextChannel, nextScore, input.session_id ?? null, existing.id],
  );
  const updated = await db.get(
    `SELECT ${ATTRIBUTION_SELECT} FROM brain_attribution WHERE id = ?`,
    [existing.id],
  );
  return updated ? rowOf(updated as Record<string, unknown>) : rowOf(existing);
}

export async function upsertAttribution(input: UpsertAttributionInput): Promise<AttributionRow | null> {
  return upsertAttributionOn(await get(), input);
}

export async function incrementUtilityCountsOn(
  db: DatabaseConnection,
  kind: "semantic" | "episodic",
  id: number,
  delta: { helpful?: number; unhelpful?: number },
): Promise<{ helpful_count: number; unhelpful_count: number } | null> {
  const memId = Math.trunc(Number(id));
  const h = Math.trunc(Number(delta.helpful ?? 0));
  const u = Math.trunc(Number(delta.unhelpful ?? 0));
  if (!(memId > 0) || (h === 0 && u === 0)) return null;

  const table = kind === "episodic" ? "brain_episodic" : "brain_semantic";
  await db.run(
    `UPDATE ${table}
     SET helpful_count = COALESCE(helpful_count, 0) + ?,
         unhelpful_count = COALESCE(unhelpful_count, 0) + ?
     WHERE id = ?`,
    [h, u, memId],
  );
  const row = (await db.get(
    `SELECT helpful_count, unhelpful_count FROM ${table} WHERE id = ?`,
    [memId],
  )) as { helpful_count: number; unhelpful_count: number } | undefined;
  return row ?? null;
}

export async function incrementUtilityCounts(
  kind: "semantic" | "episodic",
  id: number,
  delta: { helpful?: number; unhelpful?: number },
): Promise<{ helpful_count: number; unhelpful_count: number } | null> {
  return incrementUtilityCountsOn(await get(), kind, id, delta);
}

/**
 * MEM-39: hint-only leaf h/u on `brain_recipes`. Replay ok/revert stay in
 * `ok_count` / `reverted_count`; Value adds both (see `recipeHelpfulCount`).
 */
export async function incrementRecipeUtilityCountsOn(
  db: DatabaseConnection,
  recipeId: string,
  delta: { helpful?: number; unhelpful?: number },
): Promise<{ helpful_count: number; unhelpful_count: number } | null> {
  const id = recipeId.trim();
  const h = Math.trunc(Number(delta.helpful ?? 0));
  const u = Math.trunc(Number(delta.unhelpful ?? 0));
  if (!id || (h === 0 && u === 0)) return null;

  try {
    const result = await db.run(
      `UPDATE brain_recipes
       SET helpful_count = MAX(COALESCE(helpful_count, 0) + ?, 0),
           unhelpful_count = MAX(COALESCE(unhelpful_count, 0) + ?, 0),
           updated_at = datetime('now')
       WHERE id = ?`,
      [h, u, id],
    );
    if (!result.changes) return null;
  } catch {
    return null;
  }
  const row = (await db.get(
    `SELECT helpful_count, unhelpful_count FROM brain_recipes WHERE id = ?`,
    [id],
  )) as { helpful_count: number; unhelpful_count: number } | undefined;
  return row ?? null;
}

export async function incrementRecipeUtilityCounts(
  recipeId: string,
  delta: { helpful?: number; unhelpful?: number },
): Promise<{ helpful_count: number; unhelpful_count: number } | null> {
  return incrementRecipeUtilityCountsOn(await get(), recipeId, delta);
}

/**
 * Live rolling Rec proxy when no bench window is published: cited / injected
 * over the newest injects. Gold Rec(q) still comes from a bench window.
 */
export async function rollingInjectCiteRate(limit = 50): Promise<number | undefined> {
  const cap = Math.max(1, Math.min(Math.trunc(limit) || 50, 500));
  try {
    const db = await get();
    const row = (await db.get(
      `SELECT
         SUM(CASE WHEN injected = 1 THEN 1 ELSE 0 END) AS injected,
         SUM(CASE WHEN injected = 1 AND cited = 1 THEN 1 ELSE 0 END) AS cited
       FROM (
         SELECT injected, cited FROM brain_attribution
         WHERE injected = 1
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ?
       )`,
      [cap],
    )) as { injected: number | null; cited: number | null } | undefined;
    const injected = Number(row?.injected ?? 0);
    if (!(injected > 0)) return undefined;
    return Number(row?.cited ?? 0) / injected;
  } catch {
    return undefined;
  }
}
