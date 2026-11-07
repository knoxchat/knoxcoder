/**
 * MEM-62 — refit the ✓ parameters from outcomes, per user.
 *
 * Bounded coordinate search over the attribution log, one group at a time:
 *
 *   fsrs   F, c, a, γ(=fsrs_b), g, D₀   replay each memory's events; Brier of R(t, S) vs "helpful"
 *   eta    η_U, η_R                     IPW AUC of rel·(1+η_U U)(1+η_R R) vs "helpful"
 *   omega  ω                            Brier of U(h,u) on ablation-labelled uncited injections
 *   theta  θ                            IPW F1 of "inject iff iso(score) ≥ θ"
 *   w_s    handled by `refitChannelWeights` (closed form, already in φ₇)
 *
 * Guard rails, all of them required for a value to be written:
 *   - clamp to a published range (`REFIT_RANGES`),
 *   - minimum sample size per group (`REFIT_MIN_SAMPLES`),
 *   - the search sees only the train split; a group is **rolled back** unless its
 *     held-out objective does not drop (held-out = every 4th turn / memory),
 *   - every change is audit-logged with the previous value, so `rollbackRefit` can undo it.
 *
 * `w_mem_tokens` and `coverage_lambda` are not refit: they act on the *candidate
 * set* (token budget, redundancy), which the attribution log does not record, so
 * there is no honest objective for them. Reported as skipped. `S_cat` is likewise
 * not refit (needs per-category history at creation time).
 *
 * Lexical / numeric only. Per user: nothing leaves the local brain file.
 */

import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import {
  buildCalibrationSamples,
  calibrationLabel,
  fitIsotonic,
  ipwWeight,
  predictIsotonic,
  type CalibrationSample,
} from "./calibration.js";
import { applyFsrs, type FsrsOutcome, type FsrsParams } from "./Fsrs.js";
import { DEFAULT_DIFFICULTY, initialStability, retrievability } from "./Forgetting.js";
import { REFIT_KEYS, type RefitKey } from "./memoryConfigAccess.js";
import { parseFeatures, type AttributionRow } from "./store/attribution.js";

// ── Published ranges and minimum samples ────────────────────────────────────

export interface RefitRange {
  min: number;
  max: number;
  /** Relative step for multiplicative moves, absolute for additive. */
  step: number;
  mode: "mul" | "add";
}

export const REFIT_RANGES: Partial<Record<RefitKey, RefitRange>> = {
  forgetting_F: { min: 0.05, max: 1.0, step: 0.25, mode: "mul" },
  forgetting_c: { min: 0.2, max: 1.0, step: 0.15, mode: "mul" },
  fsrs_a: { min: 0.5, max: 10, step: 0.25, mode: "mul" },
  fsrs_b: { min: 0.05, max: 0.6, step: 0.2, mode: "mul" },
  fsrs_g: { min: 0.3, max: 2.5, step: 0.2, mode: "mul" },
  difficulty_initial: { min: 3, max: 7, step: 0.5, mode: "add" },
  utility_omega: { min: 0.02, max: 0.5, step: 0.25, mode: "mul" },
  eta_utility: { min: 0, max: 2, step: 0.1, mode: "add" },
  eta_retrievability: { min: 0, max: 2, step: 0.1, mode: "add" },
  retrieval_threshold: { min: 0.15, max: 0.85, step: 0.05, mode: "add" },
};

export const REFIT_MIN_SAMPLES = {
  fsrs: 50,
  eta: 100,
  omega: 30,
  theta: 100,
} as const;

/** Keys with no log objective, and why. */
export const REFIT_SKIPPED: Partial<Record<RefitKey, string>> = {
  w_mem_tokens: "acts on the candidate set / token budget, not logged",
  coverage_lambda: "acts on the candidate set (redundancy), not logged",
};

const EPS = 1e-9;
const ROUNDS = 2;

export type RefitGroupName = "fsrs" | "eta" | "omega" | "theta";
export type RefitStatus = "applied" | "unchanged" | "skipped" | "rolled_back";

export interface RefitGroupReport {
  group: RefitGroupName;
  keys: RefitKey[];
  samples: number;
  status: RefitStatus;
  reason?: string;
  before: Partial<Record<RefitKey, number>>;
  after: Partial<Record<RefitKey, number>>;
  train: { before: number; after: number };
  holdout: { before: number; after: number };
}

export interface RefitReport {
  groups: RefitGroupReport[];
  skipped_keys: Array<{ key: RefitKey; reason: string }>;
  /** Values to persist: only keys of groups with status `applied`. */
  changes: Partial<Record<RefitKey, number>>;
}

export type RefitValues = Partial<Record<RefitKey, number>>;

// ── Splits ──────────────────────────────────────────────────────────────────

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Every 4th key is held out. Stable across runs, so a rollback decision is reproducible. */
export function isHoldout(key: string): boolean {
  return hashString(key) % 4 === 0;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// ── Objective builders (pure) ───────────────────────────────────────────────

export interface FsrsEvent {
  /** Days since the memory's previous event. */
  days: number;
  /** Was it helpful when injected? */
  y: 0 | 1;
  /** Live outcome this event applies to S / D. */
  outcome: FsrsOutcome;
  w: number;
  memory: string;
}

/** Per-memory event streams from the log (semantic / episodic only). */
export function buildFsrsEvents(rows: readonly AttributionRow[]): FsrsEvent[] {
  const overridden = new Set<string>();
  for (const row of rows) {
    if (row.source === "ablation" && row.helpful != null && row.turn_id?.startsWith("ablation:")) {
      overridden.add(`${row.turn_id.slice("ablation:".length)}|${row.mem_type}|${row.mem_id}`);
    }
  }
  const byMemory = new Map<string, Array<{ at: number; row: AttributionRow }>>();
  rows.forEach((row, index) => {
    if (row.injected !== 1 || (row.mem_type !== "semantic" && row.mem_type !== "episodic")) return;
    const at = parseTime(row.created_at) ?? index * 1000;
    const key = `${row.mem_type}:${row.mem_id}`;
    const list = byMemory.get(key) ?? [];
    list.push({ at, row });
    byMemory.set(key, list);
  });
  const events: FsrsEvent[] = [];
  for (const [memory, list] of byMemory) {
    list.sort((a, b) => a.at - b.at);
    let prev: number | null = null;
    for (const { at, row } of list) {
      if (row.source !== "ablation" && overridden.has(`${row.turn_id}|${row.mem_type}|${row.mem_id}`)) continue;
      let y: 0 | 1 | null = null;
      let outcome: FsrsOutcome = "unused";
      if (row.source === "ablation") {
        if (row.helpful == null) continue;
        y = row.helpful === 1 ? 1 : 0;
        outcome = y === 1 ? "helpful" : "unused";
      } else if (row.cited === 1 && row.helpful == null) {
        continue;
      } else if (row.helpful === 1) {
        y = 1;
        outcome = "helpful";
      } else {
        y = 0;
        outcome = row.cited === 1 && row.helpful === 0 ? "harmful" : "unused";
      }
      if (prev != null) {
        events.push({
          days: Math.max(0, (at - prev) / 86_400_000),
          y,
          outcome,
          w: ipwWeight(row.propensity),
          memory,
        });
      } else {
        // First event only seeds the state. It has no elapsed time to predict from.
        events.push({ days: -1, y, outcome, w: 0, memory });
      }
      prev = at;
    }
  }
  return events;
}

/** Weighted Brier score of R(t, S) against "helpful", replaying S / D with `p`. Lower is better. */
export function fsrsReplayLoss(
  events: readonly FsrsEvent[],
  p: { F: number; c: number; a: number; b: number; g: number; d0: number },
  split: "all" | "train" | "holdout" = "all",
): { loss: number; n: number } {
  const fsrs: Partial<FsrsParams> = {
    a: p.a,
    b: p.b,
    g: p.g,
    difficultyInitial: p.d0,
    forgetting: { F: p.F, c: p.c, pruneThreshold: 0.1, reviewThreshold: 0.5 },
  };
  let sum = 0;
  let weight = 0;
  let n = 0;
  let state: { memory: string; s: number; d: number } | null = null;
  const s0 = initialStability("fact");
  for (const ev of events) {
    if (!state || state.memory !== ev.memory) state = { memory: ev.memory, s: s0, d: p.d0 };
    const inSplit =
      split === "all" || (split === "holdout" ? isHoldout(ev.memory) : !isHoldout(ev.memory));
    if (ev.days >= 0) {
      const r = retrievability(ev.days, state.s, { F: p.F, c: p.c });
      if (inSplit && ev.w > 0) {
        sum += ev.w * (r - ev.y) ** 2;
        weight += ev.w;
        n += 1;
      }
      if (ev.outcome !== "unused") {
        const next = applyFsrs(state.s, state.d, r, ev.outcome, fsrs);
        state.s = next.stability;
        state.d = next.difficulty;
      }
    } else if (ev.outcome !== "unused") {
      const r = 1;
      const next = applyFsrs(state.s, state.d, r, ev.outcome, fsrs);
      state.s = next.stability;
      state.d = next.difficulty;
    }
  }
  return { loss: weight > 0 ? sum / weight : 1, n };
}

export interface RankRow {
  rel: number;
  U: number;
  R: number;
  y: 0 | 1;
  w: number;
  turn_id: string;
}

export function buildRankRows(rows: readonly AttributionRow[]): RankRow[] {
  const out: RankRow[] = [];
  for (const row of rows) {
    if (row.source === "ablation") continue;
    const features = parseFeatures(row.features);
    const y = calibrationLabel({
      injected: row.injected,
      cited: row.cited,
      helpful: row.helpful,
      score: row.score,
      source: row.source,
    });
    if (!features || y == null) continue;
    out.push({ ...features, y, w: ipwWeight(row.propensity), turn_id: row.turn_id ?? "" });
  }
  return out;
}

/** Weighted AUC (ties count ½). Higher is better. 0.5 when one class is missing. */
export function weightedAuc(items: ReadonlyArray<{ s: number; y: 0 | 1; w: number }>): number {
  const pos = items.filter((i) => i.y === 1);
  const neg = items.filter((i) => i.y === 0);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let num = 0;
  let den = 0;
  for (const p of pos) {
    for (const n of neg) {
      const w = p.w * n.w;
      den += w;
      num += w * (p.s > n.s + 1e-12 ? 1 : Math.abs(p.s - n.s) <= 1e-12 ? 0.5 : 0);
    }
  }
  return den > 0 ? num / den : 0.5;
}

const AUC_CAP = 1500;

export function etaObjective(
  rows: readonly RankRow[],
  etaU: number,
  etaR: number,
  split: "train" | "holdout",
): number {
  const items = rows
    .filter((r) => (split === "holdout" ? isHoldout(r.turn_id) : !isHoldout(r.turn_id)))
    .slice(-AUC_CAP)
    .map((r) => ({ s: r.rel * (1 + etaU * r.U) * (1 + etaR * r.R), y: r.y, w: r.w }));
  return weightedAuc(items);
}

export interface OmegaEvent {
  memory: string;
  /** What this event does to (h, u). */
  kind: "helpful" | "harmful" | "uncited" | "ablation_yes" | "ablation_no";
  w: number;
}

/** Utility replay events. Ablation rows are the labelled ones. */
export function buildOmegaEvents(rows: readonly AttributionRow[]): OmegaEvent[] {
  const overridden = new Set<string>();
  for (const row of rows) {
    if (row.source === "ablation" && row.helpful != null && row.turn_id?.startsWith("ablation:")) {
      overridden.add(`${row.turn_id.slice("ablation:".length)}|${row.mem_type}|${row.mem_id}`);
    }
  }
  const out: OmegaEvent[] = [];
  for (const row of rows) {
    if (row.injected !== 1 || (row.mem_type !== "semantic" && row.mem_type !== "episodic")) continue;
    const memory = `${row.mem_type}:${row.mem_id}`;
    const w = ipwWeight(row.propensity);
    if (row.source === "ablation") {
      if (row.helpful == null) continue;
      out.push({ memory, kind: row.helpful === 1 ? "ablation_yes" : "ablation_no", w });
    } else if (row.cited === 1) {
      if (row.helpful === 1) out.push({ memory, kind: "helpful", w });
      else if (row.helpful === 0) out.push({ memory, kind: "harmful", w });
    } else if (!overridden.has(`${row.turn_id}|${row.mem_type}|${row.mem_id}`)) {
      out.push({ memory, kind: "uncited", w });
    }
  }
  return out;
}

/** Brier of U(h, u) on ablation-labelled events, replaying h/u with ω. Lower is better. */
export function omegaLoss(
  events: readonly OmegaEvent[],
  omega: number,
  kappa: number,
  split: "train" | "holdout",
): { loss: number; n: number } {
  const state = new Map<string, { h: number; u: number }>();
  let sum = 0;
  let weight = 0;
  let n = 0;
  for (const ev of events) {
    const s = state.get(ev.memory) ?? { h: 0, u: 0 };
    state.set(ev.memory, s);
    if (ev.kind === "ablation_yes" || ev.kind === "ablation_no") {
      const inSplit = split === "holdout" ? isHoldout(ev.memory) : !isHoldout(ev.memory);
      if (inSplit) {
        const p = (s.h + kappa * 0.5) / (s.h + s.u + kappa);
        const y = ev.kind === "ablation_yes" ? 1 : 0;
        sum += ev.w * (p - y) ** 2;
        weight += ev.w;
        n += 1;
      }
      if (ev.kind === "ablation_yes") {
        s.h += 1;
        s.u = Math.max(0, s.u - omega);
      }
    } else if (ev.kind === "helpful") s.h += 1;
    else if (ev.kind === "harmful") s.u += 1;
    else s.u += omega;
  }
  return { loss: weight > 0 ? sum / weight : 1, n };
}

/** Weighted F1 of "inject iff iso(score) ≥ θ" on `eval`, with the map fit on `fit`. Higher is better. */
export function thetaObjective(
  fit: readonly CalibrationSample[],
  evalSet: readonly CalibrationSample[],
  theta: number,
): number {
  const iso = fitIsotonic(fit);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const s of evalSet) {
    const inject = predictIsotonic(iso, s.score) >= theta;
    if (inject && s.y === 1) tp += s.w;
    else if (inject && s.y === 0) fp += s.w;
    else if (!inject && s.y === 1) fn += s.w;
  }
  const denom = 2 * tp + fp + fn;
  return denom > 0 ? (2 * tp) / denom : 0;
}

// ── Coordinate search ───────────────────────────────────────────────────────

function clampTo(range: RefitRange, value: number): number {
  return Math.max(range.min, Math.min(range.max, value));
}

function neighbors(range: RefitRange, value: number): number[] {
  if (range.mode === "add") {
    return [clampTo(range, value + range.step), clampTo(range, value - range.step)];
  }
  return [clampTo(range, value * (1 + range.step)), clampTo(range, value / (1 + range.step))];
}

/** Maximize `objective` over `keys` from `start`. Pure; returns the best values found. */
export function coordinateSearch(
  keys: readonly RefitKey[],
  start: Record<string, number>,
  objective: (values: Record<string, number>) => number,
): { values: Record<string, number>; score: number } {
  const values: Record<string, number> = { ...start };
  for (const key of keys) {
    const range = REFIT_RANGES[key];
    if (range) values[key] = clampTo(range, values[key]);
  }
  let best = objective(values);
  for (let round = 0; round < ROUNDS; round++) {
    let moved = false;
    for (const key of keys) {
      const range = REFIT_RANGES[key];
      if (!range) continue;
      for (const candidate of neighbors(range, values[key])) {
        if (Math.abs(candidate - values[key]) < EPS) continue;
        const next = { ...values, [key]: candidate };
        const score = objective(next);
        if (score > best + EPS) {
          best = score;
          values[key] = candidate;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return { values, score: best };
}

function pick(values: Record<string, number>, keys: readonly RefitKey[]): Partial<Record<RefitKey, number>> {
  const out: Partial<Record<RefitKey, number>> = {};
  for (const key of keys) out[key] = values[key];
  return out;
}

/** One guarded group fit. Exported for tests. */
export function runRefitGroup(input: {
  group: RefitGroupName;
  keys: readonly RefitKey[];
  samples: number;
  minSamples: number;
  current: Record<string, number>;
  /** Higher is better. */
  train: (values: Record<string, number>) => number;
  holdout: (values: Record<string, number>) => number;
}): RefitGroupReport {
  const { group, keys, samples, minSamples, current } = input;
  const before = pick(current, keys);
  const empty = { before: 0, after: 0 };
  if (samples < minSamples) {
    return {
      group,
      keys: [...keys],
      samples,
      status: "skipped",
      reason: `needs ≥ ${minSamples} samples, have ${samples}`,
      before,
      after: before,
      train: empty,
      holdout: empty,
    };
  }
  const trainBefore = input.train(current);
  const holdBefore = input.holdout(current);
  const found = coordinateSearch(keys, current, input.train);
  const after = pick(found.values, keys);
  const changed = keys.some((k) => Math.abs((after[k] ?? 0) - (before[k] ?? 0)) > EPS);
  const holdAfter = input.holdout(found.values);
  const report = {
    group,
    keys: [...keys],
    samples,
    before,
    train: { before: trainBefore, after: found.score },
    holdout: { before: holdBefore, after: holdAfter },
  };
  if (!changed) return { ...report, status: "unchanged", after: before };
  if (holdAfter < holdBefore - EPS) {
    return {
      ...report,
      status: "rolled_back",
      reason: "held-out objective dropped",
      after: before,
    };
  }
  return { ...report, status: "applied", after };
}

// ── Orchestration ───────────────────────────────────────────────────────────

export interface RefitInput {
  rows: readonly AttributionRow[];
  /** Current config values for the REFIT_KEYS (and utility_kappa as `kappa`). */
  current: Record<string, number>;
  kappa: number;
}

export function computeRefit(input: RefitInput): RefitReport {
  const { rows, current, kappa } = input;
  const groups: RefitGroupReport[] = [];

  // fsrs
  const events = buildFsrsEvents(rows);
  const fsrsKeys = ["forgetting_F", "forgetting_c", "fsrs_a", "fsrs_b", "fsrs_g", "difficulty_initial"] as const;
  const fsrsParams = (v: Record<string, number>) => ({
    F: v.forgetting_F,
    c: v.forgetting_c,
    a: v.fsrs_a,
    b: v.fsrs_b,
    g: v.fsrs_g,
    d0: v.difficulty_initial ?? DEFAULT_DIFFICULTY,
  });
  const fsrsCurrent = { difficulty_initial: DEFAULT_DIFFICULTY, ...current };
  groups.push(
    runRefitGroup({
      group: "fsrs",
      keys: fsrsKeys,
      samples: fsrsReplayLoss(events, fsrsParams(fsrsCurrent), "train").n,
      minSamples: REFIT_MIN_SAMPLES.fsrs,
      current: fsrsCurrent,
      train: (v) => -fsrsReplayLoss(events, fsrsParams(v), "train").loss,
      holdout: (v) => -fsrsReplayLoss(events, fsrsParams(v), "holdout").loss,
    }),
  );

  // eta
  const rank = buildRankRows(rows);
  groups.push(
    runRefitGroup({
      group: "eta",
      keys: ["eta_utility", "eta_retrievability"],
      samples: rank.length,
      minSamples: REFIT_MIN_SAMPLES.eta,
      current,
      train: (v) => etaObjective(rank, v.eta_utility, v.eta_retrievability, "train"),
      holdout: (v) => etaObjective(rank, v.eta_utility, v.eta_retrievability, "holdout"),
    }),
  );

  // omega
  const omegaEvents = buildOmegaEvents(rows);
  groups.push(
    runRefitGroup({
      group: "omega",
      keys: ["utility_omega"],
      samples: omegaLoss(omegaEvents, current.utility_omega, kappa, "train").n,
      minSamples: REFIT_MIN_SAMPLES.omega,
      current,
      train: (v) => -omegaLoss(omegaEvents, v.utility_omega, kappa, "train").loss,
      holdout: (v) => -omegaLoss(omegaEvents, v.utility_omega, kappa, "holdout").loss,
    }),
  );

  // theta: the map is fit on train turns, scored on both splits
  const samples = buildCalibrationSamples(rows);
  const trainSamples = samples.filter((s) => !isHoldout(s.turn_id));
  const holdSamples = samples.filter((s) => isHoldout(s.turn_id));
  groups.push(
    runRefitGroup({
      group: "theta",
      keys: ["retrieval_threshold"],
      samples: samples.length,
      minSamples: REFIT_MIN_SAMPLES.theta,
      current,
      train: (v) => thetaObjective(trainSamples, trainSamples, v.retrieval_threshold),
      holdout: (v) => thetaObjective(trainSamples, holdSamples, v.retrieval_threshold),
    }),
  );

  const changes: RefitValues = {};
  for (const g of groups) {
    if (g.status !== "applied") continue;
    for (const key of g.keys) {
      if (g.after[key] != null) changes[key] = g.after[key];
    }
  }
  const skipped_keys = (Object.entries(REFIT_SKIPPED) as Array<[RefitKey, string]>).map(([key, reason]) => ({
    key,
    reason,
  }));
  return { groups, skipped_keys, changes };
}

/** Keys the report may touch. Anything else is an error in this file. */
export function refitTouchesOnlyRefitKeys(report: RefitReport): boolean {
  const allowed = new Set<string>(REFIT_KEYS);
  return Object.keys(report.changes).every((k) => allowed.has(k));
}

export interface RefitRunResult {
  report: RefitReport;
  written: RefitValues;
  previous: RefitValues;
}

/** Load the log, fit, persist the applied groups, audit-log before/after. */
export async function runRefit(
  db: DatabaseConnection,
  deps: {
    getConfig: () => Record<string, unknown>;
    saveConfig: (key: string, value: string) => Promise<void>;
    auditLog: (action: string, kind: string, id: string | null, details: Record<string, unknown>) => Promise<unknown>;
  },
): Promise<RefitRunResult> {
  const { listAttributionLog } = await import("./store/attribution.js");
  const rows = await listAttributionLog(db);
  const cfg = deps.getConfig();
  const current: Record<string, number> = {};
  for (const key of REFIT_KEYS) {
    const n = Number(cfg[key]);
    if (Number.isFinite(n)) current[key] = n;
  }
  const kappa = Number(cfg.utility_kappa);
  const report = computeRefit({ rows, current, kappa: Number.isFinite(kappa) && kappa > 0 ? kappa : 5 });
  const written: RefitValues = {};
  const previous: RefitValues = {};
  for (const [key, value] of Object.entries(report.changes) as Array<[RefitKey, number]>) {
    previous[key] = current[key];
    await deps.saveConfig(key, String(value));
    written[key] = value;
  }
  await deps
    .auditLog("refit", "params", null, {
      groups: report.groups.map((g) => ({
        group: g.group,
        status: g.status,
        reason: g.reason,
        samples: g.samples,
        before: g.before,
        after: g.after,
        holdout: g.holdout,
      })),
      skipped_keys: report.skipped_keys,
      previous,
      written,
    })
    .catch(() => undefined);
  return { report, written, previous };
}

/** Restore the values a run replaced. */
export async function rollbackRefit(
  previous: RefitValues,
  saveConfig: (key: string, value: string) => Promise<void>,
): Promise<void> {
  for (const [key, value] of Object.entries(previous)) {
    if (value != null && Number.isFinite(value)) await saveConfig(key, String(value));
  }
}

export const Refit = {
  computeRefit,
  runRefit,
  rollbackRefit,
  coordinateSearch,
  buildFsrsEvents,
  fsrsReplayLoss,
  weightedAuc,
  isHoldout,
  REFIT_RANGES,
  REFIT_MIN_SAMPLES,
  REFIT_SKIPPED,
};
