import { describe, expect, it, vi } from "vitest";

import {
  applyApproved,
  formatTuningReport,
  proposeThresholds,
  relevanceMetrics,
  tuneChannelWeights,
  tuneReplayThreshold,
  tuneRelevance,
  tuneTheta,
  type AttributionSample,
  type RelevanceSample,
  type ReplaySample,
} from "./thresholdTuning";

/** Irrelevant items with a weak score (0.25..0.3) that only a higher bar rejects; relevant ones score high. */
function relevanceHistory(): RelevanceSample[] {
  const out: RelevanceSample[] = [];
  for (let i = 0; i < 12; i++) out.push({ relevant: true, input: { query: "zzz", title: "a", content: "b", fts5: 0.6 } });
  for (let i = 0; i < 12; i++) out.push({ relevant: false, input: { query: "zzz", title: "a", content: "b", fts5: 0.28 } });
  return out;
}

function replayHistory(): ReplaySample[] {
  const out: ReplaySample[] = [];
  for (let i = 0; i < 20; i++) out.push({ score: 0.95, outcome: "ok" });
  for (let i = 0; i < 5; i++) out.push({ score: 0.86, outcome: "reverted" });
  for (let i = 0; i < 5; i++) out.push({ score: 0.86, outcome: "ok" });
  return out;
}

describe("threshold tuning (MC-47)", () => {
  it("proposes a higher relevance bar when it cuts false injection at equal recall", () => {
    const p = tuneRelevance(relevanceHistory());
    expect(p.changed).toBe(true);
    expect(p.proposed).toBeGreaterThan(0.28);
    expect(p.before.falseInjectRate).toBe(1);
    expect(p.after.falseInjectRate).toBe(0);
    expect(p.after.recall).toBe(p.before.recall);
  });

  it("never trades recall for fewer false injections", () => {
    const history: RelevanceSample[] = [
      ...relevanceHistory(),
      // relevant but weak: raising the bar would lose it
      ...Array.from({ length: 4 }, () => ({ relevant: true, input: { query: "zzz", title: "a", fts5: 0.27 } })),
    ];
    const p = tuneRelevance(history);
    expect(relevanceMetrics(history, p.proposed).recall).toBe(p.before.recall);
  });

  it("tightens the replay threshold until wrong-apply is under 2%", () => {
    const p = tuneReplayThreshold(replayHistory());
    expect(p.before.wrongApplyRate).toBeGreaterThan(0.02);
    expect(p.changed).toBe(true);
    expect(p.proposed).toBeGreaterThan(0.86);
    expect(p.after.wrongApplyRate).toBeLessThanOrEqual(0.02);
  });

  it("proposes nothing on too little history", () => {
    const p = tuneReplayThreshold(replayHistory().slice(0, 5));
    expect(p.changed).toBe(false);
    expect(p.proposed).toBe(p.current);
    expect(p.rationale).toMatch(/not enough history/);
  });

  it("the report shows the proposal and its evidence, and says nothing was changed", () => {
    const text = formatTuningReport(proposeThresholds({ relevance: relevanceHistory(), replays: replayHistory() }), "2026-10-13");
    expect(text).toContain("No setting was changed");
    expect(text).toContain("`retrieval.theta`");
    expect(text).toContain("`fusion.channelWeights`");
    expect(text).toContain("`relevance.lexicalScoreMin`");
    expect(text).toMatch(/Before: .*falseInjectRate 1/);
    expect(text).toMatch(/After: .*falseInjectRate 0/);
  });

  it("fits θ and w_s from brain_attribution, not only LEXICAL_SCORE_MIN", () => {
    const attribution: AttributionSample[] = Array.from({ length: 10 }, (_, i) => ({
      injected: 1,
      cited: i < 4 ? 1 : 0,
      helpful: i < 3 ? 1 : i === 3 ? 0 : null,
      channel: i < 3 ? "lexical" : "graph",
    }));
    const theta = tuneTheta(attribution);
    expect(theta.id).toBe("retrieval.theta");
    expect(theta.changed).toBe(true);
    expect(theta.proposed).toBe(0.3);
    expect(theta.before.calibrationN).toBe(10);

    const weights = tuneChannelWeights(attribution);
    expect(weights.id).toBe("fusion.channelWeights");
    expect(weights.changed).toBe(true);
    expect(weights.proposed.lexical).toBeGreaterThan(1);
    expect(weights.proposed.graph).toBeLessThan(1);

    const report = proposeThresholds({ attribution });
    expect(report.theta.proposed).toBe(0.3);
    expect(report.channelWeights.changed).toBe(true);
    expect(report.relevance.changed).toBe(false);
  });

  it("writes nothing without approval, and only approved changes with it", async () => {
    const report = proposeThresholds({ relevance: relevanceHistory(), replays: replayHistory() });
    const write = vi.fn(async () => {});
    expect(await applyApproved(report, new Set(), write)).toEqual([]);
    expect(write).not.toHaveBeenCalled();

    expect(await applyApproved(report, new Set(["recipes.replayThreshold"]), write)).toEqual(["recipes.replayThreshold"]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("recipes.replayThreshold", report.replay.proposed);

    const attributionReport = proposeThresholds({
      attribution: Array.from({ length: 10 }, (_, i) => ({
        injected: 1,
        cited: 1,
        helpful: i < 3 ? 1 : 0,
        channel: "lexical",
      })),
    });
    expect(await applyApproved(attributionReport, new Set(["retrieval.theta", "fusion.channelWeights"]), write)).toEqual([
      "retrieval.theta",
      "fusion.channelWeights",
    ]);
    expect(write).toHaveBeenCalledWith("retrieval.theta", attributionReport.theta.proposed);
    expect(write).toHaveBeenCalledWith("fusion.channelWeights", attributionReport.channelWeights.proposed);
  });
});
