/**
 * MEM-42: σ, ε_B, ε_S published with each bench run.
 *
 *   σ   = mean_q N_q / N          (A1 scoping)
 *   ε_B = per-level beam miss     (A2; relevant leaf's ancestor dropped)
 *   ε_S = |R ∩ Cand − C(q)| / |R ∩ Cand|   (A3 budget / selection miss)
 *
 * If the summary tree is not ready, ε_B is `null` with note
 * `n/a — flat FTS`. Do not claim the theorem is empirically held.
 *
 * Dependency-free so `scripts/mc-gate.mts` / self-improve can import it.
 */
import {
  RECALL_SCALE_TREE_B,
  theoremRecallFloor,
} from "./gate";

/** Exact copy for the unpublished-tree case (Part VIII / MEM-24). */
export const EPSILON_B_FLAT_FTS = "n/a — flat FTS";

export const THEOREM_ERRORS_FILENAME = "theorem-errors.json";

export interface TheoremErrorReport {
  /** σ = mean_q N_q / N. */
  sigma: number;
  /**
   * Per-level beam miss. `null` when the tree is silent (flat FTS) or
   * no relevant leaf was in the tree.
   */
  epsilon_b: number | null;
  /** Why ε_B is unpublished. Present only when `epsilon_b` is null. */
  epsilon_b_note?: string;
  /** Selection / budget miss on R ∩ Cand. */
  epsilon_s: number;
  /**
   * Finite ε_B was measured **and** Rec stayed at the theorem floor.
   * Flat FTS must stay false.
   */
  theorem_held: boolean;
  tree_ready?: boolean;
  epsilon_b_opportunities?: number;
  epsilon_s_opportunities?: number;
}

export interface SelectionMissInput {
  /** Gold keys R(q). */
  relevant: readonly string[];
  /** Gold keys that reached Cand(q). */
  candidates: readonly string[];
  /** Gold keys that reached C(q). */
  selected: readonly string[];
}

export interface SelectionMissRate {
  epsilonS: number;
  opportunities: number;
  misses: number;
}

/** σ = N_q / N. 0 when N is 0. */
export function scopeSelectivity(nQ: number, n: number): number {
  if (!(n > 0) || !Number.isFinite(n) || !Number.isFinite(nQ)) return 0;
  return Math.max(0, nQ) / n;
}

/** σ = mean_q N_q / N. Each query may have its own N_q; N is shared. */
export function meanSelectivity(
  points: readonly { n_q: number; n: number }[],
): number {
  if (points.length === 0) return 0;
  return (
    points.reduce((sum, p) => sum + scopeSelectivity(p.n_q, p.n), 0) / points.length
  );
}

/**
 * A3: a relevant memory that reached Cand is dropped from C(q) with
 * rate ε_S. No opportunities → 0 (no observed budget miss).
 */
export function selectionMissRate(input: SelectionMissInput): SelectionMissRate {
  const relevant = new Set(input.relevant.filter(Boolean));
  const candidates = new Set(input.candidates.filter((k) => relevant.has(k)));
  const selected = new Set(input.selected.filter((k) => relevant.has(k)));
  const opportunities = candidates.size;
  if (opportunities === 0) {
    return { epsilonS: 0, opportunities: 0, misses: 0 };
  }
  let misses = 0;
  for (const key of candidates) {
    if (!selected.has(key)) misses++;
  }
  return { epsilonS: misses / opportunities, opportunities, misses };
}

export function poolRate(
  parts: readonly { opportunities: number; misses: number }[],
): { rate: number; opportunities: number; misses: number } {
  let opportunities = 0;
  let misses = 0;
  for (const part of parts) {
    opportunities += Math.max(0, part.opportunities);
    misses += Math.max(0, part.misses);
  }
  return {
    rate: opportunities > 0 ? misses / opportunities : 0,
    opportunities,
    misses,
  };
}

export function isFiniteError(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Theorem is only claimable when ε_B was measured on a ready tree. */
export function canClaimTheorem(epsilonB: number | null | undefined): boolean {
  return isFiniteError(epsilonB);
}

export function epsilonBNote(epsilonB: number | null | undefined, note?: string): string | undefined {
  if (isFiniteError(epsilonB)) return undefined;
  const text = note?.trim();
  return text || EPSILON_B_FLAT_FTS;
}

export function theoremHeldOnCurve(
  points: readonly { n_q: number; rec: number }[],
  errors: { epsilonS: number; epsilonB: number | null; b?: number },
): boolean {
  if (!isFiniteError(errors.epsilonB)) return false;
  const branching = errors.b ?? RECALL_SCALE_TREE_B;
  for (const point of points) {
    const floor = theoremRecallFloor(point.n_q, {
      epsilonS: errors.epsilonS,
      epsilonB: errors.epsilonB,
      b: branching,
    });
    if (point.rec + 1e-12 < floor) return false;
  }
  return points.length > 0;
}

export function buildTheoremErrorReport(input: {
  sigma: number;
  epsilonB: number | null;
  epsilonS: number;
  treeReady?: boolean;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonSOpportunities?: number;
  points?: readonly { n_q: number; rec: number }[];
  b?: number;
}): TheoremErrorReport {
  const epsilon_b = isFiniteError(input.epsilonB) ? input.epsilonB : null;
  const epsilon_s = Number.isFinite(input.epsilonS) ? Math.max(0, input.epsilonS) : 0;
  const note = epsilonBNote(epsilon_b, input.epsilonBNote);
  const theorem_held =
    epsilon_b != null &&
    (input.points
      ? theoremHeldOnCurve(input.points, {
          epsilonS: epsilon_s,
          epsilonB: epsilon_b,
          b: input.b,
        })
      : true);
  const report: TheoremErrorReport = {
    sigma: Number.isFinite(input.sigma) ? Math.max(0, input.sigma) : 0,
    epsilon_b,
    epsilon_s,
    theorem_held,
  };
  if (note) report.epsilon_b_note = note;
  if (input.treeReady != null) report.tree_ready = input.treeReady;
  if (input.epsilonBOpportunities != null) {
    report.epsilon_b_opportunities = input.epsilonBOpportunities;
  }
  if (input.epsilonSOpportunities != null) {
    report.epsilon_s_opportunities = input.epsilonSOpportunities;
  }
  return report;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function readEpsilonB(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && /n\/a/i.test(value)) return null;
  return readFinite(value);
}

/** Own-key pick so `epsilon_b: null` (flat FTS) is not dropped by `??`. */
function firstOwn(rec: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
  }
  return undefined;
}

/** Read σ / ε_B / ε_S from baseline.json or a sibling theorem-errors.json. */
export function readTheoremErrors(raw: unknown): TheoremErrorReport | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const nested = asRecord(rec.theorem) ?? asRecord(rec.theorem_errors);
  const src = nested ?? rec;
  const sigma = readFinite(src.sigma ?? src.σ);
  const epsilonS = readFinite(src.epsilon_s ?? src.epsilonS ?? src.ε_S);
  const epsilonB = readEpsilonB(firstOwn(src, "epsilon_b", "epsilonB", "ε_B"));
  if (sigma === undefined && epsilonS === undefined && epsilonB === undefined) {
    return undefined;
  }
  const noteRaw = src.epsilon_b_note ?? src.epsilonBNote;
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : undefined;
  const report = buildTheoremErrorReport({
    sigma: sigma ?? 0,
    epsilonB: epsilonB === undefined ? null : epsilonB,
    epsilonS: epsilonS ?? 0,
    treeReady: src.tree_ready === true || src.treeReady === true,
    epsilonBNote: note,
    epsilonBOpportunities: readFinite(src.epsilon_b_opportunities ?? src.epsilonBOpportunities),
    epsilonSOpportunities: readFinite(src.epsilon_s_opportunities ?? src.epsilonSOpportunities),
  });
  if (typeof src.theorem_held === "boolean") report.theorem_held = src.theorem_held;
  else if (typeof src.theoremHeld === "boolean") report.theorem_held = src.theoremHeld;
  return report;
}

/**
 * Prefer a scale-bench `theorem-errors.json` (real tree) over fixture
 * baseline keys, which often report ε_B as n/a.
 */
export function loadTheoremErrors(options: {
  baseline?: unknown;
  theoremErrors?: unknown;
}): TheoremErrorReport | undefined {
  const fromScale = readTheoremErrors(options.theoremErrors);
  if (fromScale && isFiniteError(fromScale.epsilon_b)) return fromScale;
  return readTheoremErrors(options.baseline) ?? fromScale;
}

export interface QueryErrorSample {
  epsilonB: number | null;
  epsilonBNote?: string;
  epsilonBOpportunities: number;
  epsilonBMisses: number;
  epsilonS: number;
  epsilonSOpportunities: number;
  epsilonSMisses: number;
  n_q: number;
  n: number;
  rec: number;
}

export function aggregateQueryErrors(
  samples: readonly QueryErrorSample[],
  opts: { b?: number; rec?: number; n_q?: number } = {},
): TheoremErrorReport {
  const beam = poolRate(
    samples.map((s) => ({ opportunities: s.epsilonBOpportunities, misses: s.epsilonBMisses })),
  );
  const select = poolRate(
    samples.map((s) => ({ opportunities: s.epsilonSOpportunities, misses: s.epsilonSMisses })),
  );
  const anyReady = samples.some((s) => isFiniteError(s.epsilonB));
  const note = samples.find((s) => !isFiniteError(s.epsilonB) && s.epsilonBNote)?.epsilonBNote;
  const rec =
    opts.rec ??
    (samples.length ? samples.reduce((sum, s) => sum + s.rec, 0) / samples.length : 0);
  const nQ =
    opts.n_q ??
    (samples.length ? samples.reduce((sum, s) => sum + s.n_q, 0) / samples.length : 0);
  return buildTheoremErrorReport({
    sigma: meanSelectivity(samples),
    epsilonB: anyReady ? beam.rate : null,
    epsilonS: select.rate,
    treeReady: anyReady,
    epsilonBNote: anyReady ? undefined : note,
    epsilonBOpportunities: beam.opportunities,
    epsilonSOpportunities: select.opportunities,
    points: samples.length ? [{ n_q: nQ, rec }] : [],
    b: opts.b,
  });
}

export function formatTheoremErrorsLine(errors: TheoremErrorReport): string {
  const epsilonB = isFiniteError(errors.epsilon_b)
    ? String(roundError(errors.epsilon_b))
    : (errors.epsilon_b_note ?? EPSILON_B_FLAT_FTS);
  return `σ ${roundError(errors.sigma, 4)}, ε_B ${epsilonB}, ε_S ${roundError(errors.epsilon_s)}, theorem_held ${errors.theorem_held}`;
}

export function roundError(n: number, digits = 3): number {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

export function keysFromRefs(
  refs: readonly { title?: string; id?: number | null }[],
  idByTitle: ReadonlyMap<string, string>,
  keyById?: ReadonlyMap<number, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const byTitle = ref.title ? idByTitle.get(ref.title) : undefined;
    const byId =
      keyById && ref.id != null && Number.isFinite(ref.id)
        ? keyById.get(Number(ref.id))
        : undefined;
    const key = byTitle ?? byId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
