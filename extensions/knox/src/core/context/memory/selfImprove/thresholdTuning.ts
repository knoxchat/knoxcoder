/**
 * MC-47 / MEM-43: offline threshold tuning. Sweeps the leftover relevance-gate
 * score bar and the replay threshold, and fits theorem θ / w_s from
 * `brain_attribution` (and leftover outcomes that write that same table).
 *
 * Nothing here writes a setting. `applyApproved` only calls the injected writer for proposals the
 * user named, so "no setting is written without consent" is enforced in one place and tested.
 */
import { evaluateRelevanceGate, LEXICAL_SCORE_MIN, type RelevanceGateInput } from "../brain/RelevanceGate";
import {
  ATTRIBUTION_THETA_MIN_SAMPLES,
  CALIBRATED_THETA_DEFAULT,
  computeAttributionRefit,
  emptyChannelWeights,
  FUSION_CHANNELS,
  type AttributionChannelCounts,
  type AttributionRefitInput,
  type ChannelWeights,
  type FusionChannel,
} from "../brain/memoryOutcomes";
import type { AttributionRow } from "../brain/store/attribution";
import { REPLAY_THRESHOLD } from "../recipes/RecipeMatcher";
import type { AttributionSample } from "./attributionStats";

export type { AttributionSample, AttributionRefitInput, ChannelWeights, FusionChannel };

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

export interface ThetaMetrics {
  helpfulRate: number;
  calibrationN: number;
}

export type NumericProposalId =
  | "relevance.lexicalScoreMin"
  | "recipes.replayThreshold"
  | "retrieval.theta";

export type TuningSettingId = NumericProposalId | "fusion.channelWeights";
export type TuningSettingValue = number | ChannelWeights;

export interface Proposal<M> {
  /** Stable name; also the key passed to `applyApproved`. */
  id: NumericProposalId;
  current: number;
  proposed: number;
  before: M;
  after: M;
  samples: number;
  /** Why this value, or why nothing changed. */
  rationale: string;
  changed: boolean;
}

export interface ChannelWeightsProposal {
  id: "fusion.channelWeights";
  current: ChannelWeights;
  proposed: ChannelWeights;
  before: Record<FusionChannel, AttributionChannelCounts>;
  after: Record<FusionChannel, AttributionChannelCounts>;
  samples: number;
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
  theta: Proposal<ThetaMetrics>;
  channelWeights: ChannelWeightsProposal;
}

function asAttributionRows(rows: readonly AttributionSample[]): AttributionRow[] {
  return rows.map((row, i) => ({
    id: i + 1,
    turn_id: `sample-${i}`,
    session_id: null,
    mem_type: row.mem_type ?? "semantic",
    mem_id: row.mem_id ?? String(i + 1),
    injected: Number(row.injected) === 1 ? 1 : 0,
    cited: Number(row.cited ?? (row.helpful != null ? 1 : 0)) === 1 ? 1 : 0,
    helpful: row.helpful == null ? null : Number(row.helpful) === 1 ? 1 : 0,
    channel: row.channel ?? null,
    score: row.score ?? null,
    created_at: null,
  }));
}

function formatWeights(weights: ChannelWeights): string {
  return FUSION_CHANNELS.map((channel) => `${channel} ${r3(weights[channel])}`).join(", ");
}

function citedChannelSamples(counts: Record<FusionChannel, AttributionChannelCounts>): number {
  return FUSION_CHANNELS.reduce(
    (sum, channel) => sum + counts[channel].helpful + counts[channel].unhelpful,
    0,
  );
}

/** Fit θ = P(helpful | injected) from the attribution log (MEM-18 / MEM-43). */
export function tuneTheta(
  rows: readonly AttributionSample[],
  current = CALIBRATED_THETA_DEFAULT,
): Proposal<ThetaMetrics> {
  const refit = computeAttributionRefit(asAttributionRows(rows), {
    theta: current,
    weights: emptyChannelWeights(),
  });
  const metrics = { helpfulRate: r3(refit.helpful_rate), calibrationN: refit.calibration_n };
  const base = { id: "retrieval.theta" as const, current, samples: refit.calibration_n, before: metrics };
  if (refit.calibration_n < ATTRIBUTION_THETA_MIN_SAMPLES) {
    return {
      ...base,
      proposed: current,
      after: metrics,
      changed: false,
      rationale: `only ${refit.calibration_n} injected outcomes (need ${ATTRIBUTION_THETA_MIN_SAMPLES}); not enough attribution to fit θ`,
    };
  }
  if (!refit.theta_updated) {
    return {
      ...base,
      proposed: current,
      after: metrics,
      changed: false,
      rationale: "fitted θ matches the current bar",
    };
  }
  return {
    ...base,
    proposed: r3(refit.theta),
    after: metrics,
    changed: true,
    rationale: `P(helpful | injected) ${metrics.helpfulRate} -> proposed θ ${r3(refit.theta)}`,
  };
}

/** Fit RRF channel weights w_s from cited+helpful vs unhelpful (MEM-18 / MEM-43). */
export function tuneChannelWeights(
  rows: readonly AttributionSample[],
  current: ChannelWeights = emptyChannelWeights(),
): ChannelWeightsProposal {
  const refit = computeAttributionRefit(asAttributionRows(rows), {
    theta: CALIBRATED_THETA_DEFAULT,
    weights: current,
  });
  const samples = citedChannelSamples(refit.channel_counts);
  const base = {
    id: "fusion.channelWeights" as const,
    current,
    proposed: current,
    before: refit.channel_counts,
    after: refit.channel_counts,
    samples,
  };
  if (samples === 0) {
    return { ...base, changed: false, rationale: "no cited channel outcomes in brain_attribution; keep current w_s" };
  }
  if (!refit.channel_updated) {
    return {
      ...base,
      proposed: refit.channel_weights,
      changed: false,
      rationale: "fitted w_s matches the current weights",
    };
  }
  return {
    ...base,
    proposed: refit.channel_weights,
    changed: true,
    rationale: `refit w_s from cited+helpful vs unhelpful: ${formatWeights(current)} -> ${formatWeights(refit.channel_weights)}`,
  };
}

export interface TuningHistory {
  relevance?: readonly RelevanceSample[];
  replays?: readonly ReplaySample[];
  attribution?: readonly AttributionSample[];
  current?: AttributionRefitInput;
}

export function proposeThresholds(history: TuningHistory): TuningReport {
  return {
    relevance: tuneRelevance(history.relevance ?? []),
    replay: tuneReplayThreshold(history.replays ?? []),
    theta: tuneTheta(history.attribution ?? [], history.current?.theta),
    channelWeights: tuneChannelWeights(history.attribution ?? [], history.current?.weights),
  };
}

export function formatTuningReport(report: TuningReport, generatedAt: string): string {
  const metrics = (x: object) => Object.entries(x).map(([k, v]) => `${k} ${v}`).join(", ");
  const row = (label: string, p: Proposal<object>) => [
    `### ${label} (\`${p.id}\`)`,
    "",
    `- Current: ${p.current}`,
    `- Proposed: ${p.changed ? p.proposed : "no change"}`,
    `- Before: ${metrics(p.before)}`,
    `- After: ${metrics(p.after)}`,
    `- Samples: ${p.samples}`,
    `- Why: ${p.rationale}`,
    "",
  ].join("\n");
  const weights = report.channelWeights;
  const weightBlock = [
    `### Channel weights w_s (\`${weights.id}\`)`,
    "",
    `- Current: ${formatWeights(weights.current)}`,
    `- Proposed: ${weights.changed ? formatWeights(weights.proposed) : "no change"}`,
    `- Samples: ${weights.samples}`,
    `- Why: ${weights.rationale}`,
    "",
  ].join("\n");
  return [
    "# Threshold tuning proposal",
    "",
    `Generated ${generatedAt}. Fits θ and w_s from brain_attribution / outcomes; leftover lexical and replay sweeps stay available. **No setting was changed**; apply a value only after you approve it.`,
    "",
    row("Retrieval θ", report.theta),
    weightBlock,
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
  approved: ReadonlySet<TuningSettingId>,
  write: (id: TuningSettingId, value: TuningSettingValue) => Promise<void>,
): Promise<string[]> {
  const done: string[] = [];
  for (const p of [report.theta, report.relevance, report.replay]) {
    if (!p.changed || !approved.has(p.id)) continue;
    await write(p.id, p.proposed);
    done.push(p.id);
  }
  if (report.channelWeights.changed && approved.has(report.channelWeights.id)) {
    await write(report.channelWeights.id, report.channelWeights.proposed);
    done.push(report.channelWeights.id);
  }
  return done;
}
