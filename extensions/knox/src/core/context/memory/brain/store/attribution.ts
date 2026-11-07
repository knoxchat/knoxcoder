/** Persist attribution rows (MEM-17) and leaf h / u counts (MEM-18). */

import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import { get } from "./connection.js";

export type AttributionMemType = "semantic" | "episodic" | "recipe";
export type AttributionChannel = "lexical" | "ripgrep" | "graph" | "tree";
/** `turn` = normal inject/cite; `ablation` = MEM-59 probe row. */
export type AttributionSource = "turn" | "ablation";

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
  source?: string;
  /** P(selected) at inject time (MEM-60). Null = not logged (treated as 1). */
  propensity?: number | null;
  scope_key?: string | null;
  /** JSON `{rel, U, R}` at inject time (MEM-62 replay). */
  features?: string | null;
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
  source?: AttributionSource;
  propensity?: number | null;
  scope_key?: string | null;
  features?: AttributionFeatures | null;
}

/** Score features logged at inject time so MEM-62 can replay η_U / η_R. */
export interface AttributionFeatures {
  rel: number;
  U: number;
  R: number;
}

const ATTRIBUTION_SELECT =
  "id, turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel, score, source, propensity, scope_key, features, created_at";

function asFeatures(value: AttributionFeatures | null | undefined): string | null {
  if (!value) return null;
  const { rel, U, R } = value;
  if (![rel, U, R].every((n) => Number.isFinite(n))) return null;
  return JSON.stringify({ rel, U, R });
}

export function parseFeatures(raw: string | null | undefined): AttributionFeatures | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AttributionFeatures>;
    if ([v.rel, v.U, v.R].every((n) => typeof n === "number" && Number.isFinite(n))) {
      return { rel: v.rel as number, U: v.U as number, R: v.R as number };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function asPropensity(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(1, n) : null;
}

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
    source: raw.source == null || raw.source === "" ? "turn" : String(raw.source),
    propensity: raw.propensity == null ? null : Number(raw.propensity),
    scope_key: raw.scope_key == null ? null : String(raw.scope_key),
    features: raw.features == null ? null : String(raw.features),
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
  const source: AttributionSource = input.source === "ablation" ? "ablation" : "turn";
  const propensity = asPropensity(input.propensity);
  const scopeKey = input.scope_key ?? null;
  const features = asFeatures(input.features);

  if (!existing) {
    const result = await db.run(
      `INSERT INTO brain_attribution (turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel, score, source, propensity, scope_key, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        turnId,
        input.session_id ?? null,
        input.mem_type,
        memId,
        injected,
        cited,
        helpful,
        channel,
        score,
        source,
        propensity,
        scopeKey,
        features,
      ],
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
     SET injected = ?, cited = ?, helpful = ?, channel = ?, score = ?, session_id = COALESCE(session_id, ?),
         propensity = COALESCE(propensity, ?), scope_key = COALESCE(scope_key, ?), features = COALESCE(features, ?)
     WHERE id = ?`,
    [
      nextInjected,
      nextCited,
      nextHelpful,
      nextChannel,
      nextScore,
      input.session_id ?? null,
      propensity,
      scopeKey,
      features,
      existing.id,
    ],
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

/**
 * h / u deltas may be fractional (MEM-57: an uncited injection adds ω = 0.1 to u).
 * SQLite keeps a non-integral value in an INTEGER-affinity column as REAL.
 */
function finiteDelta(value: number | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function incrementUtilityCountsOn(
  db: DatabaseConnection,
  kind: "semantic" | "episodic",
  id: number,
  delta: { helpful?: number; unhelpful?: number },
): Promise<{ helpful_count: number; unhelpful_count: number } | null> {
  const memId = Math.trunc(Number(id));
  const h = finiteDelta(delta.helpful);
  const u = finiteDelta(delta.unhelpful);
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
  const h = finiteDelta(delta.helpful);
  const u = finiteDelta(delta.unhelpful);
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
