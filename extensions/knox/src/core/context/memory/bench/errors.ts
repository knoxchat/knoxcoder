/**
 * MEM-42 / MEM-76 / MEM-77: theorem errors published with each bench run.
 *
 *   σ     = mean_q N_q / N                         (A1 scoping)
 *   ε_Ω   = gold outside Ω(q) / |G_W(q)|          (A1 scope miss)
 *   ε_B   = per-level beam miss                    (A2)
 *   ε_S   = |G_W ∩ Cand − C(q)| / |G_W ∩ Cand|    (A3)
 *   Rec_W = |G_W(q) ∩ C(q)| / |G_W(q)|
 *
 * Bound = 1 − ε_Ω − ε_S(W_mem) − ε_B ⌈log_b n⌉.
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

/** A3: ε_S is measured at these W_mem tiers (Part VIII). */
export const EPSILON_S_TIERS = [4_096, 32_768, 200_000] as const;

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
  /** A1: gold outside Ω(q) / |G_W(q)| (MEM-76). */
  epsilon_omega?: number;
  epsilon_omega_opportunities?: number;
  /** Rec_W against the budgeted gold set G_W(q). */
  rec_w?: number;
  /** ε_S(W_mem) at 4K / 32K / 200K (MEM-77). */
  epsilon_s_by_tier?: Record<string, number>;
  /** Per-level ε_B at each measured N_q (MEM-77). */
  epsilon_b_by_level?: Array<{ n_q: number; level: number; epsilon_b: number }>;
  /**
   * Finite ε_B was measured **and** Rec_W stayed at the theorem floor.
   * Flat FTS must stay false.
   */
  theorem_held: boolean;
  tree_ready?: boolean;
  epsilon_b_opportunities?: number;
  epsilon_s_opportunities?: number;
}

export interface SelectionMissInput {
  /** Gold keys R(q) / G_W(q). */
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

export interface ScopeMissRate {
  epsilonOmega: number;
  opportunities: number;
  misses: number;
}

export interface BudgetedGoldItem {
  key: string;
  /** Token estimate (annotator or chars/4). */
  tokens: number;
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

/**
 * A1: a gold memory in G_W(q) that sits outside Ω(q) (wrong project,
 * missing as-of mode). No gold → 0 (no observed scope miss).
 */
export function scopeMissRate(input: {
  relevant: readonly string[];
  inOmega: readonly string[];
}): ScopeMissRate {
  const relevant = new Set(input.relevant.filter(Boolean));
  const inOmega = new Set(input.inOmega.filter((k) => relevant.has(k)));
  const opportunities = relevant.size;
  if (opportunities === 0) {
    return { epsilonOmega: 0, opportunities: 0, misses: 0 };
  }
  const misses = opportunities - inOmega.size;
  return { epsilonOmega: misses / opportunities, opportunities, misses };
}

/**
 * Annotator-prioritized gold that fits `W_mem`. Order is the annotator
 * ranking. The first item is always kept so G_W is never empty when gold
 * exists (a single over-budget fact is still the answer).
 */
export function budgetedGoldSet(
  gold: readonly BudgetedGoldItem[],
  wMem: number,
): string[] {
  const budget = Number.isFinite(wMem) && wMem > 0 ? wMem : Number.POSITIVE_INFINITY;
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const item of gold) {
    const key = item.key?.trim();
    if (!key || seen.has(key)) continue;
    const tok = Math.max(1, Math.ceil(Number.isFinite(item.tokens) ? item.tokens : 1));
    if (out.length > 0 && used + tok > budget) continue;
    seen.add(key);
    out.push(key);
    used += tok;
  }
  return out;
}

/** Rec_W(q) = |G_W ∩ C| / |G_W|. Empty G_W is 1 (nothing to miss). */
export function recW(gW: readonly string[], selected: readonly string[]): number {
  const gold = [...new Set(gW.filter(Boolean))];
  if (gold.length === 0) return 1;
  const sel = new Set(selected.filter(Boolean));
  let hits = 0;
  for (const key of gold) {
    if (sel.has(key)) hits++;
  }
  return hits / gold.length;
}

/** Rank-order greedy fill used to simulate ε_S at a W_mem tier. */
export function greedySelectByBudget(
  ranked: readonly BudgetedGoldItem[],
  budget: number,
): string[] {
  const cap = Number.isFinite(budget) && budget > 0 ? budget : Number.POSITIVE_INFINITY;
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const item of ranked) {
    const key = item.key?.trim();
    if (!key || seen.has(key)) continue;
    const tok = Math.max(1, Math.ceil(Number.isFinite(item.tokens) ? item.tokens : 1));
    if (used + tok > cap) continue;
    seen.add(key);
    out.push(key);
    used += tok;
  }
  return out;
}

/** ε_S(W_mem) at each published budget tier (MEM-77). */
export function selectionMissByTier(
  input: {
    relevant: readonly string[];
    candidates: readonly BudgetedGoldItem[];
  },
  tiers: readonly number[] = EPSILON_S_TIERS,
): Record<string, SelectionMissRate> {
  const candKeys = input.candidates.map((c) => c.key).filter(Boolean);
  const out: Record<string, SelectionMissRate> = {};
  for (const tier of tiers) {
    out[String(tier)] = selectionMissRate({
      relevant: input.relevant,
      candidates: candKeys,
      selected: greedySelectByBudget(input.candidates, tier),
    });
  }
  return out;
}

export function meanTierRates(
  perQuery: readonly Record<string, SelectionMissRate>[],
  tiers: readonly number[] = EPSILON_S_TIERS,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tier of tiers) {
    const key = String(tier);
    const pooled = poolRate(
      perQuery.map((row) => row[key] ?? { opportunities: 0, misses: 0, epsilonS: 0 }),
    );
    out[key] = pooled.rate;
  }
  return out;
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
  errors: {
    epsilonS: number;
    epsilonB: number | null;
    epsilonOmega?: number;
    b?: number;
  },
): boolean {
  if (!isFiniteError(errors.epsilonB)) return false;
  const branching = errors.b ?? RECALL_SCALE_TREE_B;
  const epsilonOmega = Number.isFinite(errors.epsilonOmega) ? Math.max(0, errors.epsilonOmega as number) : 0;
  for (const point of points) {
    const floor = theoremRecallFloor(point.n_q, {
      epsilonOmega,
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
  epsilonOmega?: number;
  recW?: number;
  epsilonSByTier?: Record<string, number>;
  epsilonBByLevel?: Array<{ n_q: number; level: number; epsilon_b: number }>;
  treeReady?: boolean;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonSOpportunities?: number;
  epsilonOmegaOpportunities?: number;
  points?: readonly { n_q: number; rec: number }[];
  b?: number;
}): TheoremErrorReport {
  const epsilon_b = isFiniteError(input.epsilonB) ? input.epsilonB : null;
  const epsilon_s = Number.isFinite(input.epsilonS) ? Math.max(0, input.epsilonS) : 0;
  const epsilon_omega = Number.isFinite(input.epsilonOmega) ? Math.max(0, input.epsilonOmega as number) : 0;
  const note = epsilonBNote(epsilon_b, input.epsilonBNote);
  const recPoints = input.points ?? (input.recW != null ? [{ n_q: 1, rec: input.recW }] : undefined);
  const theorem_held =
    epsilon_b != null &&
    (recPoints
      ? theoremHeldOnCurve(recPoints, {
          epsilonOmega: epsilon_omega,
          epsilonS: epsilon_s,
          epsilonB: epsilon_b,
          b: input.b,
        })
      : true);
  const report: TheoremErrorReport = {
    sigma: Number.isFinite(input.sigma) ? Math.max(0, input.sigma) : 0,
    epsilon_b,
    epsilon_s,
    epsilon_omega,
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
  if (input.epsilonOmegaOpportunities != null) {
    report.epsilon_omega_opportunities = input.epsilonOmegaOpportunities;
  }
  if (input.recW != null && Number.isFinite(input.recW)) {
    report.rec_w = Math.max(0, Math.min(1, input.recW));
  }
  if (input.epsilonSByTier && Object.keys(input.epsilonSByTier).length > 0) {
    report.epsilon_s_by_tier = input.epsilonSByTier;
  }
  if (input.epsilonBByLevel && input.epsilonBByLevel.length > 0) {
    report.epsilon_b_by_level = input.epsilonBByLevel;
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
  const epsilonOmega = readFinite(src.epsilon_omega ?? src.epsilonOmega ?? src.ε_Ω);
  if (
    sigma === undefined &&
    epsilonS === undefined &&
    epsilonB === undefined &&
    epsilonOmega === undefined
  ) {
    return undefined;
  }
  const noteRaw = src.epsilon_b_note ?? src.epsilonBNote;
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : undefined;
  const recWValue = readFinite(src.rec_w ?? src.recW ?? src.Rec_W);
  const report = buildTheoremErrorReport({
    sigma: sigma ?? 0,
    epsilonB: epsilonB === undefined ? null : epsilonB,
    epsilonS: epsilonS ?? 0,
    epsilonOmega: epsilonOmega ?? 0,
    recW: recWValue,
    treeReady: src.tree_ready === true || src.treeReady === true,
    epsilonBNote: note,
    epsilonBOpportunities: readFinite(src.epsilon_b_opportunities ?? src.epsilonBOpportunities),
    epsilonSOpportunities: readFinite(src.epsilon_s_opportunities ?? src.epsilonSOpportunities),
    epsilonOmegaOpportunities: readFinite(
      src.epsilon_omega_opportunities ?? src.epsilonOmegaOpportunities,
    ),
  });
  const byTier = asRecord(src.epsilon_s_by_tier ?? src.epsilonSByTier);
  if (byTier) {
    const tiers: Record<string, number> = {};
    for (const [key, value] of Object.entries(byTier)) {
      const n = readFinite(value);
      if (n != null) tiers[key] = n;
    }
    if (Object.keys(tiers).length) report.epsilon_s_by_tier = tiers;
  }
  const byLevelRaw = src.epsilon_b_by_level ?? src.epsilonBByLevel;
  if (Array.isArray(byLevelRaw)) {
    const levels: Array<{ n_q: number; level: number; epsilon_b: number }> = [];
    for (const item of byLevelRaw) {
      const row = asRecord(item);
      if (!row) continue;
      const nQ = readFinite(row.n_q ?? row.nQ);
      const level = readFinite(row.level);
      const eps = readFinite(row.epsilon_b ?? row.epsilonB);
      if (nQ == null || level == null || eps == null) continue;
      levels.push({ n_q: nQ, level, epsilon_b: eps });
    }
    if (levels.length) report.epsilon_b_by_level = levels;
  }
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
  epsilonOmega?: number;
  epsilonOmegaOpportunities?: number;
  epsilonOmegaMisses?: number;
  recW?: number;
  n_q: number;
  n: number;
  rec: number;
  epsilonSByTier?: Record<string, SelectionMissRate>;
  epsilonBByLevel?: Array<{ level: number; opportunities: number; misses: number }>;
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
  const scope = poolRate(
    samples.map((s) => ({
      opportunities: s.epsilonOmegaOpportunities ?? 0,
      misses: s.epsilonOmegaMisses ?? 0,
    })),
  );
  const anyReady = samples.some((s) => isFiniteError(s.epsilonB));
  const note = samples.find((s) => !isFiniteError(s.epsilonB) && s.epsilonBNote)?.epsilonBNote;
  const rec =
    opts.rec ??
    (samples.length ? samples.reduce((sum, s) => sum + s.rec, 0) / samples.length : 0);
  const recWValues = samples.map((s) => s.recW).filter((n): n is number => Number.isFinite(n));
  const recWMean = recWValues.length
    ? recWValues.reduce((sum, n) => sum + n, 0) / recWValues.length
    : rec;
  const nQ =
    opts.n_q ??
    (samples.length ? samples.reduce((sum, s) => sum + s.n_q, 0) / samples.length : 0);
  const byLevel = aggregateLevelMisses(samples, nQ);
  const tierRows = samples
    .map((s) => s.epsilonSByTier)
    .filter((row): row is Record<string, SelectionMissRate> => Boolean(row && Object.keys(row).length));
  return buildTheoremErrorReport({
    sigma: meanSelectivity(samples),
    epsilonB: anyReady ? beam.rate : null,
    epsilonS: select.rate,
    epsilonOmega: scope.rate,
    recW: recWMean,
    epsilonSByTier: tierRows.length ? meanTierRates(tierRows) : undefined,
    epsilonBByLevel: byLevel.length ? byLevel : undefined,
    treeReady: anyReady,
    epsilonBNote: anyReady ? undefined : note,
    epsilonBOpportunities: beam.opportunities,
    epsilonSOpportunities: select.opportunities,
    epsilonOmegaOpportunities: scope.opportunities,
    points: samples.length ? [{ n_q: nQ, rec: recWMean }] : [],
    b: opts.b,
  });
}

function aggregateLevelMisses(
  samples: readonly QueryErrorSample[],
  nQ: number,
): Array<{ n_q: number; level: number; epsilon_b: number }> {
  const byLevel = new Map<number, { opportunities: number; misses: number }>();
  for (const sample of samples) {
    for (const row of sample.epsilonBByLevel ?? []) {
      const prev = byLevel.get(row.level) ?? { opportunities: 0, misses: 0 };
      prev.opportunities += Math.max(0, row.opportunities);
      prev.misses += Math.max(0, row.misses);
      byLevel.set(row.level, prev);
    }
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, part]) => ({
      n_q: nQ,
      level,
      epsilon_b: part.opportunities > 0 ? part.misses / part.opportunities : 0,
    }));
}

export function formatTheoremErrorsLine(errors: TheoremErrorReport): string {
  const epsilonB = isFiniteError(errors.epsilon_b)
    ? String(roundError(errors.epsilon_b))
    : (errors.epsilon_b_note ?? EPSILON_B_FLAT_FTS);
  const omega = Number.isFinite(errors.epsilon_omega)
    ? `, ε_Ω ${roundError(errors.epsilon_omega as number)}`
    : "";
  const recWPart = Number.isFinite(errors.rec_w) ? `, Rec_W ${roundError(errors.rec_w as number)}` : "";
  return `σ ${roundError(errors.sigma, 4)}${omega}, ε_B ${epsilonB}, ε_S ${roundError(errors.epsilon_s)}${recWPart}, theorem_held ${errors.theorem_held}`;
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
