/**
 * MEM-61 — isotonic calibration of the cut-off.
 *
 *   P̂(helpful | m, q) = iso(score)
 *
 * `iso` is a monotone non-decreasing step function fit by pool-adjacent-violators
 * (PAV) on `brain_attribution`, each row weighted by 1 / propensity (MEM-60) so a
 * rarely-shown memory counts as much as the many it stood in for. The cut is
 * P̂ ≥ θ. Fits are per scope after `calibration_min_injections` labelled
 * injections, else global, else the caller falls back to top-k by score.
 *
 * PAV is a monotone least-squares fit, not a model. Lexical only: no embedding,
 * no neural rerank (AGENTS.md).
 */

import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import type { AttributionRow } from "./store/attribution.js";

/** Cap on 1/propensity so one rarely-shown memory cannot dominate a fit. */
export const IPW_WEIGHT_CAP = 20;
/** Labelled injections a global fit needs before it replaces the top-k fallback. */
export const CALIBRATION_GLOBAL_MIN_SAMPLES = 40;
/** Starvation guard: a fit that rejects everything still keeps this many best hits. */
export const CALIBRATED_MIN_KEEP = 3;

export interface CalibrationSample {
  score: number;
  /** 0 or 1. */
  y: number;
  /** IPW weight, already capped. */
  w: number;
  scope_key: string;
  /** Source turn key, used to split train / holdout in MEM-62. */
  turn_id: string;
}

export interface IsotonicBlock {
  /** Smallest score pooled into this block. */
  lo: number;
  /** Largest score pooled into this block. */
  hi: number;
  /** Weighted helpful rate of the block. */
  p: number;
  /** Total weight. */
  w: number;
}

export interface IsotonicFit {
  /** Labelled samples used. */
  n: number;
  blocks: IsotonicBlock[];
}

export type CalibrationMode = "scope" | "global" | "cold";

export interface CalibrationSelection {
  mode: CalibrationMode;
  fit: IsotonicFit | null;
  n: number;
}

/** 1 / propensity, capped. Missing propensity means the row was always shown: weight 1. */
export function ipwWeight(propensity: number | null | undefined, cap = IPW_WEIGHT_CAP): number {
  const p = Number(propensity);
  if (!Number.isFinite(p) || p <= 0) return 1;
  return Math.min(cap, 1 / Math.min(1, p));
}

/**
 * Label of one log row, or null when it carries no evidence.
 *   ablation row  → its own helpful flag (answer changed / unchanged)
 *   cited pending → skipped
 *   injected      → helpful === 1 ? 1 : 0  (injected-not-cited counts as 0)
 */
export function calibrationLabel(row: Pick<AttributionRow, "injected" | "cited" | "helpful" | "score" | "source">): 0 | 1 | null {
  if (row.injected !== 1) return null;
  const score = Number(row.score);
  if (!Number.isFinite(score) || score <= 0) return null;
  if (row.source === "ablation") {
    if (row.helpful == null) return null;
    return row.helpful === 1 ? 1 : 0;
  }
  if (row.cited === 1 && row.helpful == null) return null;
  return row.helpful === 1 ? 1 : 0;
}

const ABLATION_PREFIX = "ablation:";

export function ablationTurnId(turnId: string): string {
  return `${ABLATION_PREFIX}${turnId}`;
}

export function ablationOriginTurn(turnId: string | null | undefined): string | null {
  if (!turnId || !turnId.startsWith(ABLATION_PREFIX)) return null;
  return turnId.slice(ABLATION_PREFIX.length);
}

/** Rows → weighted samples. An ablation verdict replaces the turn row it probed. */
export function buildCalibrationSamples(rows: readonly AttributionRow[]): CalibrationSample[] {
  const overridden = new Set<string>();
  for (const row of rows) {
    if (row.source !== "ablation") continue;
    const origin = ablationOriginTurn(row.turn_id);
    if (origin && row.helpful != null) overridden.add(`${origin}|${row.mem_type}|${row.mem_id}`);
  }
  const out: CalibrationSample[] = [];
  for (const row of rows) {
    if (row.source !== "ablation" && overridden.has(`${row.turn_id}|${row.mem_type}|${row.mem_id}`)) continue;
    const y = calibrationLabel(row);
    if (y == null) continue;
    out.push({
      score: Number(row.score),
      y,
      w: ipwWeight(row.propensity),
      scope_key: row.scope_key ?? "",
      turn_id: ablationOriginTurn(row.turn_id) ?? row.turn_id ?? "",
    });
  }
  return out;
}

/**
 * Weighted pool-adjacent-violators. Returns blocks with strictly increasing
 * `lo` and non-decreasing `p`.
 */
export function fitIsotonic(samples: readonly CalibrationSample[]): IsotonicFit {
  const sorted = samples
    .filter((s) => Number.isFinite(s.score) && s.w > 0 && (s.y === 0 || s.y === 1))
    .sort((a, b) => a.score - b.score);
  // Pool identical scores first so a tie cannot be split into a violation.
  const blocks: IsotonicBlock[] = [];
  for (const s of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && last.hi === s.score && last.lo === s.score) {
      last.p = (last.p * last.w + s.y * s.w) / (last.w + s.w);
      last.w += s.w;
    } else {
      blocks.push({ lo: s.score, hi: s.score, p: s.y, w: s.w });
    }
  }
  const stack: IsotonicBlock[] = [];
  for (const block of blocks) {
    stack.push({ ...block });
    while (stack.length >= 2 && stack[stack.length - 2].p > stack[stack.length - 1].p) {
      const b = stack.pop() as IsotonicBlock;
      const a = stack.pop() as IsotonicBlock;
      const w = a.w + b.w;
      stack.push({ lo: a.lo, hi: b.hi, p: (a.p * a.w + b.p * b.w) / w, w });
    }
  }
  return { n: sorted.length, blocks: stack };
}

/** iso(score). Below the first block uses the first value; above the last, the last. */
export function predictIsotonic(fit: IsotonicFit | null | undefined, score: number): number {
  if (!fit || fit.blocks.length === 0 || !Number.isFinite(score)) return 0;
  let value = fit.blocks[0].p;
  for (const block of fit.blocks) {
    if (block.lo <= score) value = block.p;
    else break;
  }
  return value;
}

export function isMonotone(fit: IsotonicFit): boolean {
  for (let i = 1; i < fit.blocks.length; i++) {
    if (fit.blocks[i].p < fit.blocks[i - 1].p - 1e-12) return false;
    if (fit.blocks[i].lo <= fit.blocks[i - 1].lo) return false;
  }
  return true;
}

/** Scope fit when it has enough injections, else global when it has enough, else cold. */
export function selectCalibration(
  fits: { scope?: IsotonicFit | null; global?: IsotonicFit | null },
  minScopeInjections: number,
  minGlobalInjections = CALIBRATION_GLOBAL_MIN_SAMPLES,
): CalibrationSelection {
  const scope = fits.scope;
  if (scope && scope.n >= minScopeInjections && scope.blocks.length > 0) {
    return { mode: "scope", fit: scope, n: scope.n };
  }
  const global = fits.global;
  if (global && global.n >= minGlobalInjections && global.blocks.length > 0) {
    return { mode: "global", fit: global, n: global.n };
  }
  return { mode: "cold", fit: null, n: Math.max(scope?.n ?? 0, global?.n ?? 0) };
}

export interface CutCandidate {
  score: number;
  pinned?: boolean;
}

/**
 * Apply the cut to candidates already ranked best-first.
 *   cold:       top `topK`
 *   calibrated: P̂ ≥ θ, pinned rows always, and never fewer than
 *               CALIBRATED_MIN_KEEP (starvation guard: a fit that rejects
 *               everything would stop producing the data that refits it)
 */
export function applyCalibratedCut<T extends CutCandidate>(
  ranked: readonly T[],
  selection: CalibrationSelection,
  theta: number,
  topK: number,
): T[] {
  if (selection.mode === "cold" || !selection.fit) {
    return ranked.slice(0, Math.max(1, topK));
  }
  const kept = ranked.filter((c) => c.pinned || predictIsotonic(selection.fit, c.score) >= theta);
  if (kept.length >= Math.min(CALIBRATED_MIN_KEEP, ranked.length)) return kept;
  const keep = new Set<T>(kept);
  for (const candidate of ranked) {
    if (keep.size >= CALIBRATED_MIN_KEEP) break;
    keep.add(candidate);
  }
  return ranked.filter((c) => keep.has(c));
}

// ── Persistence ────────────────────────────────────────────────────────────

const ATTRIBUTION_CALIBRATION_SELECT =
  "id, turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel, score, source, propensity, scope_key, features, created_at";

export async function loadCalibrationSamples(db: DatabaseConnection): Promise<CalibrationSample[]> {
  const rows = (await db.all(
    `SELECT ${ATTRIBUTION_CALIBRATION_SELECT} FROM brain_attribution WHERE injected = 1 AND score IS NOT NULL ORDER BY id ASC`,
  )) as Array<Record<string, unknown>>;
  return buildCalibrationSamples(
    rows.map((raw) => ({
      id: Number(raw.id),
      turn_id: raw.turn_id == null ? null : String(raw.turn_id),
      session_id: raw.session_id == null ? null : String(raw.session_id),
      mem_type: String(raw.mem_type ?? ""),
      mem_id: String(raw.mem_id ?? ""),
      injected: Number(raw.injected ?? 0),
      cited: Number(raw.cited ?? 0),
      helpful: raw.helpful == null ? null : Number(raw.helpful),
      channel: raw.channel == null ? null : String(raw.channel),
      score: raw.score == null ? null : Number(raw.score),
      source: raw.source == null ? "turn" : String(raw.source),
      propensity: raw.propensity == null ? null : Number(raw.propensity),
      scope_key: raw.scope_key == null ? null : String(raw.scope_key),
      features: raw.features == null ? null : String(raw.features),
      created_at: raw.created_at == null ? null : String(raw.created_at),
    })),
  );
}

export interface CalibrationRefitResult {
  samples: number;
  global_n: number;
  scopes: Array<{ scope_key: string; n: number }>;
}

/**
 * φ₇: refit the global map and one map per scope that has any labelled rows,
 * then replace the stored fits. A scope's map is only *used* once it reaches
 * `minScopeInjections`; smaller scopes are stored so the count is visible.
 */
export async function refitCalibration(db: DatabaseConnection): Promise<CalibrationRefitResult> {
  const samples = await loadCalibrationSamples(db);
  const byScope = new Map<string, CalibrationSample[]>();
  for (const sample of samples) {
    if (!sample.scope_key) continue;
    const list = byScope.get(sample.scope_key) ?? [];
    list.push(sample);
    byScope.set(sample.scope_key, list);
  }
  const global = fitIsotonic(samples);
  await db.run("DELETE FROM brain_calibration");
  await db.run("INSERT INTO brain_calibration (scope_key, n, points) VALUES ('', ?, ?)", [
    global.n,
    JSON.stringify(global.blocks),
  ]);
  const scopes: Array<{ scope_key: string; n: number }> = [];
  for (const [scopeKey, list] of byScope) {
    const fit = fitIsotonic(list);
    scopes.push({ scope_key: scopeKey, n: fit.n });
    await db.run("INSERT INTO brain_calibration (scope_key, n, points) VALUES (?, ?, ?)", [
      scopeKey,
      fit.n,
      JSON.stringify(fit.blocks),
    ]);
  }
  return { samples: samples.length, global_n: global.n, scopes };
}

async function readFit(db: DatabaseConnection, scopeKey: string): Promise<IsotonicFit | null> {
  const row = (await db.get("SELECT n, points FROM brain_calibration WHERE scope_key = ?", [scopeKey])) as
    | { n: number; points: string }
    | undefined;
  if (!row) return null;
  try {
    const blocks = JSON.parse(row.points) as IsotonicBlock[];
    if (!Array.isArray(blocks)) return null;
    return { n: Number(row.n) || 0, blocks };
  } catch {
    return null;
  }
}

/** Stored fits for a scope → the selection the live cut uses. Errors mean "cold". */
export async function loadCalibration(
  db: DatabaseConnection,
  scopeKey: string,
  minScopeInjections: number,
): Promise<CalibrationSelection> {
  try {
    const scope = scopeKey ? await readFit(db, scopeKey) : null;
    const global = await readFit(db, "");
    return selectCalibration({ scope, global }, minScopeInjections);
  } catch {
    return { mode: "cold", fit: null, n: 0 };
  }
}

export const Calibration = {
  ipwWeight,
  calibrationLabel,
  buildCalibrationSamples,
  fitIsotonic,
  predictIsotonic,
  isMonotone,
  selectCalibration,
  applyCalibratedCut,
  refitCalibration,
  loadCalibration,
};
