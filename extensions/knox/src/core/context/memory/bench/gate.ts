/**
 * MC-46 + MEM-40: self-eval gates. Dependency-free so `scripts/mc-gate.mts` can
 * import this file directly.
 *
 * - `compareToBaseline` — fixture bench vs `baseline.json`.
 * - `gateRecallScale` — Rec_W vs N. Fail a drop vs the previous N worse than
 *   `RECALL_SCALE_DROP_SLACK`. When MEM-76 publishes finite ε_S / ε_B, also
 *   enforce `1 - ε_Ω - ε_S - ε_B ceil(log_b N_q)`. Flat FTS (ε_B n/a) does not
 *   claim that floor.
 * - `gateSearchCost` — leftover P1-5 scan detector. Search(q) is
 *   O(log N_q); an absolute ms SLO is machine-dependent.
 * - `answerableHorizon` / `gateHorizon` — H_0.85 from Rec vs fact age (MEM-41).
 */
export interface GateSummary {
  recallAtK: number;
  precision: number;
  falseInjectRate: number;
  tokensMean: number;
}

export interface GateTolerances {
  /** Recall must not drop at all. */
  recall: number;
  /** Tie-breaking differs a little between platforms (see memoryBench.test.ts). */
  precision: number;
  falseInject: number;
  tokensRatio: number;
  tokensSlack: number;
  /** MC-50 absolute targets. */
  maxFalseInject: number;
  minRecall: number;
}

export const DEFAULT_GATE_TOLERANCES: GateTolerances = {
  recall: 0,
  precision: 0.1,
  falseInject: 0.05,
  tokensRatio: 1.25,
  tokensSlack: 20,
  maxFalseInject: 0.4,
  minRecall: 1,
};

export interface GateResult {
  ok: boolean;
  failures: string[];
}

export function compareToBaseline(
  current: GateSummary,
  baseline: GateSummary,
  tol: GateTolerances = DEFAULT_GATE_TOLERANCES,
): GateResult {
  const failures: string[] = [];
  const check = (bad: boolean, msg: string) => {
    if (bad) failures.push(msg);
  };
  check(current.recallAtK < baseline.recallAtK - tol.recall, `recallAtK ${current.recallAtK} < baseline ${baseline.recallAtK}`);
  check(current.precision < baseline.precision - tol.precision, `precision ${current.precision} < baseline ${baseline.precision} - ${tol.precision}`);
  check(
    current.falseInjectRate > baseline.falseInjectRate + tol.falseInject,
    `falseInjectRate ${current.falseInjectRate} > baseline ${baseline.falseInjectRate} + ${tol.falseInject}`,
  );
  const tokenCeiling = Math.ceil(baseline.tokensMean * tol.tokensRatio) + tol.tokensSlack;
  check(current.tokensMean > tokenCeiling, `tokensMean ${current.tokensMean} > ceiling ${tokenCeiling}`);
  check(current.falseInjectRate > tol.maxFalseInject, `falseInjectRate ${current.falseInjectRate} > target ${tol.maxFalseInject}`);
  check(current.recallAtK < tol.minRecall, `recallAtK ${current.recallAtK} < target ${tol.minRecall}`);
  return { ok: failures.length === 0, failures };
}

/**
 * MEM-40/42: Rec at N_{i+1} may not fall more than this below Rec at N_i.
 * Scheduled N values grow ~10×, so 0.10 is one tenth of recall per decade.
 * When both ε_* are finite the tighter theorem floor also applies.
 */
export const RECALL_SCALE_DROP_SLACK = 0.1;

/** Needles must stay answerable at every N. Same ρ as H_0.85 (MEM-41). */
export const RECALL_SCALE_MIN_REC = 0.85;

/** Theorem headline: H_ρ = sup { L : E[Rec | fact age = L] ≥ ρ }. */
export const HORIZON_RHO = 0.85;

/**
 * Default Rec-vs-age schedule (days). Covers the Part IV worked example
 * (1d / 4.4d / 43d), category S₀ (14 / 30 / 60), and a one-year point.
 * Override with `KNOX_HORIZON_LS=0,14,60`.
 */
export const HORIZON_LS = [0, 1, 4.4, 14, 30, 43, 60, 365] as const;

/** Theorem default branching factor `b` (summary tree). */
export const RECALL_SCALE_TREE_B = 8;

/** Default Rec-vs-N schedule. 1e6 is nightly-only (`KNOX_SCALE_NIGHTLY=1`). */
export const RECALL_SCALE_NS = [1_000, 10_000, 100_000] as const;

export const RECALL_SCALE_NIGHTLY_N = 1_000_000;

/**
 * Leftover P1-5: pre-turn p95 at large N. Catches a table scan (every query
 * in seconds at 100k), not a laptop SLO. Rec-vs-N has ~13 gold queries, so
 * p95 is the max. GHA windows-2022 sat ~0.5 s p50 / ~2.9 s max at 100k with
 * Rec held; 2500 ms treated one cold sample as a scan. The old 750 ms
 * ceiling was searchSemantic-only on a laptop.
 */
export const PRE_TURN_P95_SCAN_MS = 4_000;

export const PRE_TURN_MAX_SCAN_MS = 6_000;

/**
 * last/first median may not track N. 100× N and a linear scan is ~100×;
 * inverted-index + tree on GHA Windows is ~2–4× p50. Slack 8 leaves room.
 * Growth uses p50 when published (p95 is max at n=13).
 */
export const SEARCH_COST_VS_N_SLACK = 8;

export interface RecallScaleGatePoint {
  n: number;
  n_q: number;
  rec: number;
}

export interface RecallScaleGateOptions {
  /** Max Rec drop when N increases. Default `RECALL_SCALE_DROP_SLACK`. */
  dropSlack?: number;
  /** Absolute Rec floor at every N. Default `RECALL_SCALE_MIN_REC`. */
  minRec?: number;
  /** Theorem branching factor. Default 8 (`tree_branching_b`). */
  b?: number;
  /**
   * When ε_S and ε_B are finite, Rec_W must stay
   * `>= 1 - ε_Ω - ε_S - ε_B ceil(log_b N_q)`. Omit / leave n/a for flat FTS.
   * ε_Ω defaults to 0 when unpublished.
   */
  epsilonS?: number;
  epsilonB?: number;
  epsilonOmega?: number;
}

/** `1 - ε_Ω - ε_S - ε_B ceil(log_b N_q)`. `N_q <= 1` has zero tree levels. */
export function theoremRecallFloor(
  nQ: number,
  opts: { epsilonS: number; epsilonB: number; epsilonOmega?: number; b?: number },
): number {
  const branching = opts.b ?? RECALL_SCALE_TREE_B;
  const levels =
    nQ <= 1 || branching <= 1 ? 0 : Math.ceil(Math.log(nQ) / Math.log(branching));
  const omega = Number.isFinite(opts.epsilonOmega) ? Math.max(0, opts.epsilonOmega as number) : 0;
  return 1 - omega - opts.epsilonS - opts.epsilonB * levels;
}

export function gateRecallScale(
  points: readonly RecallScaleGatePoint[],
  opts: RecallScaleGateOptions = {},
): GateResult {
  const failures: string[] = [];
  const slack = opts.dropSlack ?? RECALL_SCALE_DROP_SLACK;
  const minRec = opts.minRec ?? RECALL_SCALE_MIN_REC;
  const branching = opts.b ?? RECALL_SCALE_TREE_B;
  const applyTheorem =
    Number.isFinite(opts.epsilonS) && Number.isFinite(opts.epsilonB);

  if (points.length === 0) {
    return { ok: false, failures: ["recall-scale: no points"] };
  }

  const ordered = [...points].sort((a, b) => a.n - b.n);
  let prev: RecallScaleGatePoint | undefined;
  for (const point of ordered) {
    if (!(point.rec + 1e-12 >= minRec)) {
      failures.push(`Rec ${point.rec} at N=${point.n} < min ${minRec}`);
    }
    if (prev && point.n > prev.n && point.rec + 1e-12 < prev.rec - slack) {
      failures.push(
        `Rec dropped ${prev.rec} → ${point.rec} from N=${prev.n} to N=${point.n} (slack ${slack})`,
      );
    }
    if (applyTheorem) {
      const floor = theoremRecallFloor(point.n_q, {
        epsilonOmega: opts.epsilonOmega,
        epsilonS: opts.epsilonS as number,
        epsilonB: opts.epsilonB as number,
        b: branching,
      });
      if (point.rec + 1e-12 < floor) {
        failures.push(
          `Rec ${point.rec} at N=${point.n} N_q=${point.n_q} < theorem floor ${roundGate(floor)}`,
        );
      }
    }
    prev = point;
  }

  return { ok: failures.length === 0, failures };
}

export interface SearchCostGatePoint {
  n: number;
  latencyP95Ms: number;
  latencyMaxMs?: number;
  /** Median. With ~13 Rec-vs-N queries, p95 is the max; growth uses p50. */
  latencyP50Ms?: number;
}

export interface SearchCostGateOptions {
  p95BudgetMs?: number;
  maxBudgetMs?: number;
  vsNSlack?: number;
  /** Apply the absolute ceiling only at this N or above. Default 10_000. */
  minN?: number;
}

/**
 * Search(q) = O(B b log_b N_q). Fail a leftover O(N) scan: p95/max over a
 * CI-safe ceiling, or median growing with N faster than `SEARCH_COST_VS_N_SLACK`.
 */
export function gateSearchCost(
  points: readonly SearchCostGatePoint[],
  opts: SearchCostGateOptions = {},
): GateResult {
  const failures: string[] = [];
  const p95Budget = opts.p95BudgetMs ?? PRE_TURN_P95_SCAN_MS;
  const maxBudget = opts.maxBudgetMs ?? PRE_TURN_MAX_SCAN_MS;
  const slack = opts.vsNSlack ?? SEARCH_COST_VS_N_SLACK;
  const minN = opts.minN ?? 10_000;

  if (points.length === 0) {
    return { ok: false, failures: ["search-cost: no points"] };
  }

  const ordered = [...points].sort((a, b) => a.n - b.n);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const growthOf = (point: SearchCostGatePoint): number =>
    point.latencyP50Ms != null && point.latencyP50Ms > 0 ? point.latencyP50Ms : point.latencyP95Ms;

  if (last.n >= minN) {
    if (!(last.latencyP95Ms < p95Budget)) {
      failures.push(
        `latencyP95 ${last.latencyP95Ms} at N=${last.n} >= scan ceiling ${p95Budget}`,
      );
    }
    if (last.latencyMaxMs != null && !(last.latencyMaxMs < maxBudget)) {
      failures.push(
        `latencyMax ${last.latencyMaxMs} at N=${last.n} >= scan ceiling ${maxBudget}`,
      );
    }
  }

  const firstGrowth = growthOf(first);
  const lastGrowth = growthOf(last);
  if (last.n >= 10 * first.n && firstGrowth > 0) {
    const ratio = lastGrowth / firstGrowth;
    if (ratio >= slack) {
      const stat = first.latencyP50Ms != null && last.latencyP50Ms != null ? "latencyP50" : "latencyP95";
      failures.push(
        `${stat} grew ${firstGrowth} → ${lastGrowth} (${ratio.toFixed(1)}×) from N=${first.n} to N=${last.n} (slack ${slack}×; Search is O(log N_q))`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

function roundGate(n: number): number {
  return Number(n.toFixed(4));
}

export interface HorizonGatePoint {
  /** Fact age L in days. */
  l: number;
  /** E[Rec | fact age = L]. */
  rec: number;
}

export interface HorizonGateOptions {
  /** Recall floor. Default `HORIZON_RHO` (0.85). */
  rho?: number;
  /**
   * Minimum published H_ρ. Default 0 — a short measured horizon is a
   * result, not a gate failure. Fresh facts (smallest L) must still clear ρ.
   */
  minH?: number;
}

export interface AnswerableHorizon {
  rho: number;
  /**
   * Prefix-sup on the measured curve: largest L such that every earlier
   * point still has Rec ≥ ρ. Equals the last measured L when the curve
   * never crosses (then `censored` is true and H is a lower bound).
   * 0 when even the youngest measured age misses ρ.
   */
  h: number;
  /**
   * Linear interpolation of the first downward crossing, when Rec is
   * assumed nonincreasing in L. Omitted when censored or when the first
   * point already misses.
   */
  hInterp?: number;
  /** Rec never fell below ρ — `h` is the largest measured L (a lower bound). */
  censored: boolean;
  /** First measured L with Rec < ρ, if any. */
  firstMissL?: number;
}

/**
 * H_ρ = sup { L : E[Rec | fact age = L] ≥ ρ }.
 *
 * Rec is treated as nonincreasing in L (forgetting). A later rebound does
 * not extend the horizon; the first downward crossing ends it. That matches
 * "the age up to which facts are still recalled at least ρ of the time".
 */
export function answerableHorizon(
  points: readonly HorizonGatePoint[],
  rho: number = HORIZON_RHO,
): AnswerableHorizon {
  const threshold = Number.isFinite(rho) ? rho : HORIZON_RHO;
  if (points.length === 0) {
    return { rho: threshold, h: 0, censored: false };
  }

  const ordered = [...points].sort((a, b) => a.l - b.l);
  let lastPass: HorizonGatePoint | undefined;
  let firstFail: HorizonGatePoint | undefined;
  for (const point of ordered) {
    if (point.rec + 1e-12 >= threshold) {
      if (!firstFail) lastPass = point;
    } else if (!firstFail) {
      firstFail = point;
    }
  }

  if (!lastPass) {
    return {
      rho: threshold,
      h: 0,
      censored: false,
      firstMissL: firstFail?.l,
    };
  }

  if (!firstFail) {
    return {
      rho: threshold,
      h: lastPass.l,
      censored: true,
    };
  }

  let hInterp: number | undefined;
  const span = firstFail.l - lastPass.l;
  const drop = lastPass.rec - firstFail.rec;
  if (span > 0 && drop > 0) {
    hInterp = lastPass.l + (span * (lastPass.rec - threshold)) / drop;
  }

  return {
    rho: threshold,
    h: lastPass.l,
    hInterp: hInterp !== undefined && Number.isFinite(hInterp) ? hInterp : undefined,
    censored: false,
    firstMissL: firstFail.l,
  };
}

/**
 * MEM-41: fresh facts (smallest L) must stay at Rec ≥ ρ. H_ρ is published
 * even when later ages drop — that drop *is* the horizon.
 */
export function gateHorizon(
  points: readonly HorizonGatePoint[],
  opts: HorizonGateOptions = {},
): GateResult {
  const failures: string[] = [];
  const rho = opts.rho ?? HORIZON_RHO;
  const minH = opts.minH ?? 0;

  if (points.length === 0) {
    return { ok: false, failures: ["horizon: no points"] };
  }

  const ordered = [...points].sort((a, b) => a.l - b.l);
  const fresh = ordered[0];
  if (!(fresh.rec + 1e-12 >= rho)) {
    failures.push(`Rec ${fresh.rec} at L=${fresh.l} < ρ ${rho}`);
  }

  const horizon = answerableHorizon(ordered, rho);
  if (!(horizon.h + 1e-12 >= minH)) {
    failures.push(`H_${rho} ${horizon.h} < min ${minH}`);
  }

  return { ok: failures.length === 0, failures };
}

/** MEM-78: p95 retrieval at N_q = 1e6 must stay under 300 ms. */
export const RETRIEVAL_P95_AT_1E6_MS = 300;

export function gateLatencyAt1e6(
  points: readonly SearchCostGatePoint[],
  opts: { p95Ms?: number; minN?: number } = {},
): GateResult {
  const failures: string[] = [];
  const p95 = opts.p95Ms ?? RETRIEVAL_P95_AT_1E6_MS;
  const minN = opts.minN ?? RECALL_SCALE_NIGHTLY_N;
  const atScale = points.filter((p) => p.n >= minN);
  if (atScale.length === 0) {
    return { ok: true, failures: [] };
  }
  for (const point of atScale) {
    if (!(point.latencyP95Ms < p95)) {
      failures.push(
        `latencyP95 ${point.latencyP95Ms} at N=${point.n} >= ${p95} ms (MEM-78)`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Dilution Lemma (Part VIII): P(gold in flat top-k) → 0 as N grows.
 * Hoeffding upper bound on P(Bin(N, p) ≤ k-1).
 */
export function flatTopKHitBound(n: number, k: number, p: number): number {
  if (!(n > 0) || !(k > 0) || !(p > 0) || p >= 1) return 1;
  const mean = n * p;
  if (mean <= k - 1) return 1;
  return Math.exp((-2 * (mean - (k - 1)) ** 2) / n);
}

export interface AccuracySummary {
  longmemeval?: number;
  locomo?: number;
  heldOut?: number;
  overall: number;
  skipped?: string[];
}

export interface AccuracyGateOptions {
  /** Max drop vs the previous release. Default 0 (no regression). */
  slack?: number;
}

export function gateAccuracy(
  current: AccuracySummary,
  previous?: AccuracySummary | null,
  opts: AccuracyGateOptions = {},
): GateResult {
  const failures: string[] = [];
  if (!Number.isFinite(current.overall) || current.overall < 0) {
    return { ok: false, failures: ["accuracy: missing overall"] };
  }
  if (!previous || !Number.isFinite(previous.overall)) {
    return { ok: true, failures: [] };
  }
  const slack = opts.slack ?? 0;
  if (current.overall + 1e-12 < previous.overall - slack) {
    failures.push(
      `accuracy ${current.overall} < previous ${previous.overall} (slack ${slack})`,
    );
  }
  return { ok: failures.length === 0, failures };
}

export function gateHorizonRegression(
  currentH: number,
  previousH: number | undefined,
  slack = 0,
): GateResult {
  if (previousH == null || !Number.isFinite(previousH)) {
    return { ok: true, failures: [] };
  }
  if (!(currentH + 1e-12 >= previousH - slack)) {
    return {
      ok: false,
      failures: [`H_0.85 ${currentH} < previous ${previousH} (slack ${slack})`],
    };
  }
  return { ok: true, failures: [] };
}

export interface ErasureBenchSummary {
  planted: number;
  hits: number;
  erasure_met: boolean;
}

export function gateErasure(report: ErasureBenchSummary): GateResult {
  const failures: string[] = [];
  if (!(report.planted > 0)) {
    failures.push("erasure: nothing planted");
  }
  if (report.hits !== 0) {
    failures.push(`erasure: ${report.hits} leftover hits after forget`);
  }
  if (!report.erasure_met) {
    failures.push("erasure: invariant not met");
  }
  return { ok: failures.length === 0, failures };
}

export interface ReleaseGateInput {
  recallScale: GateResult;
  accuracy: GateResult;
  horizon: GateResult;
  latency: GateResult;
  erasure: GateResult;
}

export const RELEASE_GATE_ROWS = [
  "recallScale",
  "accuracy",
  "horizon",
  "latency",
  "erasure",
] as const;

export function gateRelease(rows: ReleaseGateInput): GateResult {
  const failures: string[] = [];
  for (const key of RELEASE_GATE_ROWS) {
    const row = rows[key];
    if (!row.ok) {
      failures.push(`${key}: ${row.failures.join("; ") || "failed"}`);
    }
  }
  return { ok: failures.length === 0, failures };
}
