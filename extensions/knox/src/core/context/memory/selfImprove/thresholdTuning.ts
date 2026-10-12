/**
 * MC-47: offline threshold tuning. Sweeps the relevance-gate score bar and the replay threshold
 * over recorded history and PROPOSES new values with before/after numbers.
 *
 * Nothing here writes a setting. `applyApproved` only calls the injected writer for proposals the
 * user named, so "no setting is written without consent" is enforced in one place and tested.
 */
import { evaluateRelevanceGate, LEXICAL_SCORE_MIN, type RelevanceGateInput } from "../brain/RelevanceGate";
import { REPLAY_THRESHOLD } from "../recipes/RecipeMatcher";

/** A recalled memory and whether it turned out to be relevant (kept by the user / helped a verified turn). */
export interface RelevanceSample {
  input: RelevanceGateInput;
  relevant: boolean;
}

/** A replay attempt: the match score it was chosen at and how it ended. */
export interface ReplaySample {
  score: number;
  outcome: "ok" | "reverted" | "failed_verify";
}

export interface RelevanceMetrics {
  recall: number;
  precision: number;
  falseInjectRate: number;
}

export interface ReplayMetrics {
  /** Share of all attempts that would still replay at the threshold. */
  coverage: number;
  wrongApplyRate: number;
  replayed: number;
}

export interface Proposal<M> {
  /** Stable name; also the key passed to `applyApproved`. */
  id: "relevance.lexicalScoreMin" | "recipes.replayThreshold";
  current: number;
  proposed: number;
  before: M;
  after: M;
  samples: number;
  /** Why this value, or why nothing changed. */
  rationale: string;
  changed: boolean;
}

export const RELEVANCE_GRID: readonly number[] = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
export const REPLAY_GRID: readonly number[] = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
/** README success target: wrong-apply rate under 2%. */
export const MAX_WRONG_APPLY = 0.02;
/** Fewer samples than this is noise; propose nothing. */
export const MIN_SAMPLES = 20;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function relevanceMetrics(samples: readonly RelevanceSample[], lexicalScoreMin: number): RelevanceMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let negatives = 0;
  for (const s of samples) {
    const passed = evaluateRelevanceGate({ ...s.input, lexicalScoreMin }).passed;
    if (s.relevant) passed ? tp++ : fn++;
    else {
      negatives++;
      if (passed) fp++;
    }
  }
  return {
    recall: tp + fn === 0 ? 1 : r3(ratio(tp, tp + fn)),
    precision: tp + fp === 0 ? 1 : r3(ratio(tp, tp + fp)),
    falseInjectRate: r3(ratio(fp, negatives)),
  };
}

export function replayMetrics(samples: readonly ReplaySample[], threshold: number): ReplayMetrics {
  const taken = samples.filter((s) => s.score >= threshold);
  const bad = taken.filter((s) => s.outcome !== "ok").length;
  return { coverage: r3(ratio(taken.length, samples.length)), wrongApplyRate: r3(ratio(bad, taken.length)), replayed: taken.length };
}

/**
 * Lowest false-inject rate that keeps recall at the current level; ties go to the value nearest the
 * current one so proposals stay small.
 */
export function tuneRelevance(
  samples: readonly RelevanceSample[],
  current = LEXICAL_SCORE_MIN,
  grid: readonly number[] = RELEVANCE_GRID,
): Proposal<RelevanceMetrics> {
  const before = relevanceMetrics(samples, current);
  const base = { id: "relevance.lexicalScoreMin" as const, current, samples: samples.length, before };
  if (samples.length < MIN_SAMPLES) {
    return { ...base, proposed: current, after: before, changed: false, rationale: `only ${samples.length} samples (need ${MIN_SAMPLES}); not enough history to tune` };
  }
  let best = { value: current, m: before };
  for (const v of grid) {
    const m = relevanceMetrics(samples, v);
    if (m.recall < before.recall) continue;
    const better =
      m.falseInjectRate < best.m.falseInjectRate ||
      (m.falseInjectRate === best.m.falseInjectRate && Math.abs(v - current) < Math.abs(best.value - current));
    if (better) best = { value: v, m };
  }
  const changed = best.value !== current && best.m.falseInjectRate < before.falseInjectRate;
  if (!changed) {
    return { ...base, proposed: current, after: before, changed: false, rationale: "no value lowers false injection without losing recall; keep the current bar" };
  }
  return {
    ...base,
    proposed: best.value,
    after: best.m,
    changed: true,
    rationale: `false-inject ${before.falseInjectRate} -> ${best.m.falseInjectRate} with recall held at ${best.m.recall}`,
  };
}

/** Lowest threshold whose wrong-apply rate stays under the target (most coverage); else the safest one. */
export function tuneReplayThreshold(
  samples: readonly ReplaySample[],
  current = REPLAY_THRESHOLD,
  maxWrongApply = MAX_WRONG_APPLY,
  grid: readonly number[] = REPLAY_GRID,
): Proposal<ReplayMetrics> {
  const before = replayMetrics(samples, current);
  const base = { id: "recipes.replayThreshold" as const, current, samples: samples.length, before };
  if (samples.length < MIN_SAMPLES) {
    return { ...base, proposed: current, after: before, changed: false, rationale: `only ${samples.length} replays (need ${MIN_SAMPLES}); not enough history to tune` };
  }
  const safe = [...grid].sort((a, b) => a - b).find((t) => {
    const m = replayMetrics(samples, t);
    return m.replayed > 0 && m.wrongApplyRate <= maxWrongApply;
  });
  const proposed = safe ?? Math.max(...grid);
  const after = replayMetrics(samples, proposed);
  const changed = proposed !== current && (safe !== undefined || after.wrongApplyRate < before.wrongApplyRate);
  if (!changed) {
    return { ...base, proposed: current, after: before, changed: false, rationale: safe === undefined ? "no threshold meets the wrong-apply target; keep the current one and review quarantined recipes" : "current threshold already gives the most coverage under the wrong-apply target" };
  }
  return {
    ...base,
    proposed,
    after,
    changed: true,
    rationale:
      safe === undefined
        ? `no threshold reaches ${maxWrongApply}; the strictest one cuts wrong-apply ${before.wrongApplyRate} -> ${after.wrongApplyRate}`
        : `wrong-apply ${before.wrongApplyRate} -> ${after.wrongApplyRate}, coverage ${before.coverage} -> ${after.coverage}`,
  };
}

export interface TuningReport {
  relevance: Proposal<RelevanceMetrics>;
  replay: Proposal<ReplayMetrics>;
}

export function proposeThresholds(history: { relevance: readonly RelevanceSample[]; replays: readonly ReplaySample[] }): TuningReport {
  return { relevance: tuneRelevance(history.relevance), replay: tuneReplayThreshold(history.replays) };
}

export function formatTuningReport(report: TuningReport, generatedAt: string): string {
  const row = (label: string, p: Proposal<object>) => {
    const m = (x: object) => Object.entries(x).map(([k, v]) => `${k} ${v}`).join(", ");
    return [
      `### ${label} (\`${p.id}\`)`,
      "",
      `- Current: ${p.current}`,
      `- Proposed: ${p.changed ? p.proposed : "no change"}`,
      `- Before: ${m(p.before)}`,
      `- After: ${m(p.after)}`,
      `- Samples: ${p.samples}`,
      `- Why: ${p.rationale}`,
      "",
    ].join("\n");
  };
  return [
    "# Threshold tuning proposal",
    "",
    `Generated ${generatedAt}. Offline sweep over recorded history. **No setting was changed**; apply a value only after you approve it.`,
    "",
    row("Relevance gate score bar", report.relevance),
    row("Replay threshold", report.replay),
  ].join("\n");
}

/**
 * Writes only the proposals the user approved, and only those that changed. Returns the ids written.
 * `write` is the single place a setting is persisted.
 */
export async function applyApproved(
  report: TuningReport,
  approved: ReadonlySet<Proposal<object>["id"]>,
  write: (id: Proposal<object>["id"], value: number) => Promise<void>,
): Promise<string[]> {
  const done: string[] = [];
  for (const p of [report.relevance, report.replay] as Proposal<object>[]) {
    if (!p.changed || !approved.has(p.id)) continue;
    await write(p.id, p.proposed);
    done.push(p.id);
  }
  return done;
}
