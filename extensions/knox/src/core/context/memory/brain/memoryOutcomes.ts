/**
 * MC-51 / MC-52 outcomes plus MEM-18 attribution refit.
 *
 * `brain_memory_outcomes` records verified / revert counts. The theorem path
 * is `brain_attribution` → h/u (U) / FSRS / w_s / θ. Recipe replay writes that
 * same attribution table so Value has one feed.
 */
import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import {
  incrementUtilityCountsOn,
  listAttributionLog,
  upsertAttributionOn,
  type AttributionRow,
} from "./store/attribution.js";
import { applyMemoryFsrsOn } from "./store/fsrs.js";

export type RecallOutcome = "verified" | "reverted";

export interface MemoryOutcome {
  verified: number;
  reverted: number;
}

// ── MEM-18: w_s / θ from the attribution log ──────────────────────────────

export const FUSION_CHANNELS = ["lexical", "ripgrep", "graph", "tree"] as const;
export type FusionChannel = (typeof FUSION_CHANNELS)[number];

export const ATTRIBUTION_THETA_MIN_SAMPLES = 8;
export const ATTRIBUTION_THETA_MIN = 0.15;
export const ATTRIBUTION_THETA_MAX = 0.85;
export const CHANNEL_WEIGHT_STEP = 0.05;
export const CHANNEL_WEIGHT_MIN = 0.1;
export const CHANNEL_WEIGHT_MAX = 4;
export const CALIBRATED_THETA_DEFAULT = 0.35;

export interface ChannelWeights {
  lexical: number;
  ripgrep: number;
  graph: number;
  tree: number;
}

export interface ChannelScoreSource {
  fts5?: number | null;
  trigram?: number | null;
  graph?: number | null;
  ripgrep?: number | null;
  tree?: number | null;
  channel?: FusionChannel | string | null;
}

export interface AttributionRefitInput {
  theta: number;
  weights: ChannelWeights;
}

export interface AttributionChannelCounts {
  helpful: number;
  unhelpful: number;
}

export interface AttributionRefitResult {
  rows: number;
  calibration_n: number;
  helpful_n: number;
  helpful_rate: number;
  theta: number;
  theta_updated: boolean;
  channel_counts: Record<FusionChannel, AttributionChannelCounts>;
  channel_weights: ChannelWeights;
  channel_updated: boolean;
}

export function isFusionChannel(value: string | null | undefined): value is FusionChannel {
  return value === "lexical" || value === "ripgrep" || value === "graph" || value === "tree";
}

export function emptyChannelWeights(): ChannelWeights {
  return { lexical: 1, ripgrep: 1, graph: 1, tree: 1 };
}

export function emptyChannelCounts(): Record<FusionChannel, AttributionChannelCounts> {
  return {
    lexical: { helpful: 0, unhelpful: 0 },
    ripgrep: { helpful: 0, unhelpful: 0 },
    graph: { helpful: 0, unhelpful: 0 },
    tree: { helpful: 0, unhelpful: 0 },
  };
}

function finiteScore(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Channel that produced the candidate. Recency / importance are priors, not channels. */
export function winningChannel(source?: ChannelScoreSource | null): FusionChannel | null {
  if (!source) return null;
  if (isFusionChannel(source.channel)) return source.channel;
  const candidates: Array<[FusionChannel, number]> = [
    ["lexical", finiteScore(source.fts5) + finiteScore(source.trigram)],
    ["ripgrep", finiteScore(source.ripgrep)],
    ["graph", finiteScore(source.graph)],
    ["tree", finiteScore(source.tree)],
  ];
  let best: FusionChannel | null = null;
  let bestScore = 0;
  for (const [channel, score] of candidates) {
    if (score > bestScore) {
      best = channel;
      bestScore = score;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Running P(helpful | injected). Injected-not-cited counts as not helpful
 * (calibration only). Pending cited rows are skipped.
 */
export function calibrateTheta(rows: readonly AttributionRow[]): {
  rate: number;
  n: number;
  helpful_n: number;
} {
  let helpful = 0;
  let n = 0;
  for (const row of rows) {
    if (row.injected !== 1) continue;
    if (row.cited === 1 && row.helpful == null) continue;
    n += 1;
    if (row.helpful === 1) helpful += 1;
  }
  return { rate: n > 0 ? helpful / n : 0, n, helpful_n: helpful };
}

export function countChannelOutcomes(
  rows: readonly AttributionRow[],
): Record<FusionChannel, AttributionChannelCounts> {
  const counts = emptyChannelCounts();
  for (const row of rows) {
    if (row.cited !== 1 || row.helpful == null || !isFusionChannel(row.channel)) continue;
    if (row.helpful === 1) counts[row.channel].helpful += 1;
    else counts[row.channel].unhelpful += 1;
  }
  return counts;
}

/** w_s = clamp(1 + step · (h_s − u_s), min, max). Unused channels keep their current weight. */
export function refitChannelWeights(
  counts: Record<FusionChannel, AttributionChannelCounts>,
  current: ChannelWeights = emptyChannelWeights(),
): { weights: ChannelWeights; updated: boolean } {
  const weights = { ...current };
  let updated = false;
  for (const channel of FUSION_CHANNELS) {
    const { helpful, unhelpful } = counts[channel];
    if (helpful + unhelpful === 0) continue;
    const next = clamp(
      1 + CHANNEL_WEIGHT_STEP * (helpful - unhelpful),
      CHANNEL_WEIGHT_MIN,
      CHANNEL_WEIGHT_MAX,
    );
    if (Math.abs(next - weights[channel]) > 1e-9) updated = true;
    weights[channel] = next;
  }
  return { weights, updated };
}

export function computeAttributionRefit(
  rows: readonly AttributionRow[],
  current: AttributionRefitInput = { theta: CALIBRATED_THETA_DEFAULT, weights: emptyChannelWeights() },
): AttributionRefitResult {
  const calibrated = calibrateTheta(rows);
  const channelCounts = countChannelOutcomes(rows);
  const refit = refitChannelWeights(channelCounts, current.weights);
  const enough = calibrated.n >= ATTRIBUTION_THETA_MIN_SAMPLES;
  const theta = enough
    ? clamp(calibrated.rate, ATTRIBUTION_THETA_MIN, ATTRIBUTION_THETA_MAX)
    : current.theta;
  return {
    rows: rows.length,
    calibration_n: calibrated.n,
    helpful_n: calibrated.helpful_n,
    helpful_rate: calibrated.rate,
    theta,
    theta_updated: enough && Math.abs(theta - current.theta) > 1e-9,
    channel_counts: channelCounts,
    channel_weights: refit.weights,
    channel_updated: refit.updated,
  };
}

export async function loadAttributionRefit(
  db: DatabaseConnection,
  current: AttributionRefitInput = { theta: CALIBRATED_THETA_DEFAULT, weights: emptyChannelWeights() },
): Promise<AttributionRefitResult> {
  return computeAttributionRefit(await listAttributionLog(db), current);
}

export interface RecipeReplayAttribution {
  id: string;
  memoryId?: number;
  sourceSessionId?: string;
  stats: { replays: number; reverted: number; failedVerify: number };
}

function recipeReplayTurnId(recipe: RecipeReplayAttribution, outcome: "ok" | "reverted" | "failedVerify"): string {
  const ordinal =
    outcome === "ok"
      ? recipe.stats.replays
      : outcome === "reverted"
        ? recipe.stats.reverted
        : recipe.stats.failedVerify;
  return `recipe-${outcome}:${recipe.id}:${ordinal}`;
}

/** Write recipe (+ linked workflow) attribution so one table feeds Value. */
export async function attributeRecipeReplay(
  db: DatabaseConnection,
  recipe: RecipeReplayAttribution,
  outcome: "ok" | "reverted" | "failedVerify",
): Promise<void> {
  const helpful = outcome === "ok";
  const turnId = recipeReplayTurnId(recipe, outcome);
  await upsertAttributionOn(db, {
    turn_id: turnId,
    session_id: recipe.sourceSessionId ?? null,
    mem_type: "recipe",
    mem_id: recipe.id,
    injected: true,
    cited: true,
    helpful,
  });
  if (recipe.memoryId == null || !(recipe.memoryId > 0)) return;
  if (outcome === "ok" || outcome === "reverted") {
    await recordRecallOutcome(db, [recipe.memoryId], outcome === "ok" ? "verified" : "reverted", {
      turnId,
      sessionId: recipe.sourceSessionId,
    });
    return;
  }
  await incrementUtilityCountsOn(db, "semantic", recipe.memoryId, { unhelpful: 1 });
  await applyMemoryFsrsOn(db, "semantic", recipe.memoryId, "harmful");
  await upsertAttributionOn(db, {
    turn_id: turnId,
    session_id: recipe.sourceSessionId ?? null,
    mem_type: "semantic",
    mem_id: String(recipe.memoryId),
    injected: true,
    cited: true,
    helpful: false,
  });
}

// ── MC-51 ──────────────────────────────────────────────────────────────────

/** MC-50: at least one verified turn and no reverts. */
export function isVerifiedByOutcome(outcome: MemoryOutcome | undefined): boolean {
  return !!outcome && outcome.verified > 0 && outcome.reverted === 0;
}

export interface RecordRecallOutcomeOptions {
  turnId?: string;
  sessionId?: string | null;
  channel?: FusionChannel | string | null;
  score?: number | null;
}

export async function recordRecallOutcome(
  db: DatabaseConnection,
  memoryIds: number[],
  outcome: RecallOutcome,
  options: RecordRecallOutcomeOptions = {},
): Promise<void> {
  const col = outcome === "verified" ? "verified_count" : "revert_count";
  const helpful = outcome === "verified";
  for (const id of new Set(memoryIds)) {
    if (!(id > 0)) continue;
    await db.run(
      `INSERT INTO brain_memory_outcomes (memory_id, ${col}, updated_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(memory_id) DO UPDATE SET ${col} = ${col} + 1, updated_at = datetime('now')`,
      [id],
    );
    await incrementUtilityCountsOn(db, "semantic", id, helpful ? { helpful: 1 } : { unhelpful: 1 });
    await applyMemoryFsrsOn(db, "semantic", id, helpful ? "helpful" : "harmful");
    await upsertAttributionOn(db, {
      turn_id: options.turnId?.trim() || `outcome:${id}:${outcome}:${Date.now()}`,
      session_id: options.sessionId,
      mem_type: "semantic",
      mem_id: String(id),
      injected: true,
      cited: true,
      helpful,
      channel: options.channel,
      score: options.score,
    });
  }
}

export async function loadOutcomes(db: DatabaseConnection, memoryIds: number[]): Promise<Map<number, MemoryOutcome>> {
  const out = new Map<number, MemoryOutcome>();
  const ids = [...new Set(memoryIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db.all<{ memory_id: number; verified_count: number; revert_count: number }[]>(
      `SELECT memory_id, verified_count, revert_count FROM brain_memory_outcomes
       WHERE memory_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) out.set(r.memory_id, { verified: r.verified_count, reverted: r.revert_count });
  }
  return out;
}

// ── MC-52 ──────────────────────────────────────────────────────────────────

export const CONTRADICTION_CATEGORIES = new Set(["decision", "preference"]);
const SUBJECT_OVERLAP_MIN = 0.5;

export interface ContradictionCandidate {
  id: number;
  category: string;
  title: string;
  content: string;
  created_at?: string;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / (a.size + b.size - n);
}

/**
 * Same category (decision/preference), same subject (title overlap), different content.
 * Subject comes from the title only, so "Use tabs" vs "Use spaces" share a subject with the
 * shared words and differ in the rest.
 */
export function conflictsWith(next: ContradictionCandidate, older: ContradictionCandidate): boolean {
  if (next.id === older.id) return false;
  if (!CONTRADICTION_CATEGORIES.has(next.category) || next.category !== older.category) return false;
  if (next.content.trim().toLowerCase() === older.content.trim().toLowerCase()) return false;
  const subject = jaccard(tokens(next.title), tokens(older.title));
  const titleSame = next.title.trim().toLowerCase() === older.title.trim().toLowerCase();
  return titleSame || subject >= SUBJECT_OVERLAP_MIN;
}

export function findSuperseded(next: ContradictionCandidate, older: ContradictionCandidate[]): ContradictionCandidate[] {
  return older.filter((o) => conflictsWith(next, o));
}

export function supersessionNote(newer: Pick<ContradictionCandidate, "title">, older: Pick<ContradictionCandidate, "content">): string {
  return `Updated: "${newer.title}" replaces an earlier note (was: ${older.content.replace(/\s+/g, " ").trim().slice(0, 120)}).`;
}

/** Mark `oldId` superseded by `newId`. History stays in `brain_semantic`; recall skips old rows. */
export async function markSuperseded(db: DatabaseConnection, oldId: number, newId: number, reason: string): Promise<void> {
  if (oldId === newId) return;
  await db.run(
    `INSERT INTO brain_memory_supersessions (old_id, new_id, reason) VALUES (?, ?, ?)
     ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, reason = excluded.reason`,
    [oldId, newId, reason],
  );
  // MEM-26: close the old fact's validity interval. The row stays queryable by id.
  await db.run(
    `UPDATE brain_semantic
     SET valid_to = COALESCE(valid_to, datetime('now'))
     WHERE id = ? AND (valid_to IS NULL OR datetime(valid_to) > datetime('now'))`,
    [oldId],
  );
}

export async function loadSupersededIds(db: DatabaseConnection, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const rows = await db.all<{ old_id: number }[]>(
      `SELECT old_id FROM brain_memory_supersessions WHERE old_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) out.add(r.old_id);
  }
  return out;
}

/** Explains why `newId` is current: the notes for everything it replaced. */
export async function explainSupersession(db: DatabaseConnection, newId: number): Promise<string[]> {
  const rows = await db.all<{ reason: string; content: string; title: string }[]>(
    `SELECT s.reason AS reason, o.content AS content, n.title AS title
       FROM brain_memory_supersessions s
       JOIN brain_semantic o ON o.id = s.old_id
       JOIN brain_semantic n ON n.id = s.new_id
      WHERE s.new_id = ? ORDER BY s.created_at, s.old_id`,
    [newId],
  );
  return rows.map((r) => r.reason || supersessionNote({ title: r.title }, { content: r.content }));
}

/**
 * After storing `next`: supersede conflicting older decision/preference memories in the same
 * source session scope. Returns the superseded ids.
 */
export async function supersedeConflicts(db: DatabaseConnection, next: ContradictionCandidate): Promise<number[]> {
  if (!CONTRADICTION_CATEGORIES.has(next.category)) return [];
  const rows = await db.all<ContradictionCandidate[]>(
    `SELECT id, category, title, content, created_at FROM brain_semantic
      WHERE category = ? AND id != ?
        AND id NOT IN (SELECT old_id FROM brain_memory_supersessions)`,
    [next.category, next.id],
  );
  const hit = findSuperseded(next, rows.filter((r) => !r.created_at || !next.created_at || r.created_at <= next.created_at));
  for (const o of hit) await markSuperseded(db, o.id, next.id, supersessionNote(next, o));
  return hit.map((o) => o.id);
}
