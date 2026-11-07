import { describe, expect, it } from "vitest";

import {
  answerableHorizon,
  compareToBaseline,
  flatTopKHitBound,
  gateAccuracy,
  gateErasure,
  gateHorizon,
  gateHorizonRegression,
  gateLatencyAt1e6,
  gateRecallScale,
  gateRelease,
  gateSearchCost,
  theoremRecallFloor,
  HORIZON_RHO,
  PRE_TURN_P95_SCAN_MS,
  RECALL_SCALE_DROP_SLACK,
  RECALL_SCALE_MIN_REC,
  RETRIEVAL_P95_AT_1E6_MS,
  SEARCH_COST_VS_N_SLACK,
  type GateSummary,
} from "./gate";

const base: GateSummary = { recallAtK: 1, precision: 0.625, falseInjectRate: 0, tokensMean: 166 };

describe("mc:gate comparison (MC-46)", () => {
  it("passes an identical or better run", () => {
    expect(compareToBaseline(base, base).ok).toBe(true);
    expect(compareToBaseline({ ...base, precision: 0.9 }, base).ok).toBe(true);
  });

  it("fails each regression", () => {
    expect(compareToBaseline({ ...base, recallAtK: 0.9 }, base).failures.join()).toContain("recallAtK");
    expect(compareToBaseline({ ...base, precision: 0.4 }, base).failures.join()).toContain("precision");
    expect(compareToBaseline({ ...base, falseInjectRate: 0.1 }, base).failures.join()).toContain("falseInjectRate");
    expect(compareToBaseline({ ...base, tokensMean: 400 }, base).failures.join()).toContain("tokensMean");
  });

  it("enforces the absolute false-inject target even with a loose baseline", () => {
    const loose = { ...base, falseInjectRate: 0.5 };
    const r = compareToBaseline({ ...loose, falseInjectRate: 0.5 }, loose);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("target");
  });
});

describe("MEM-40 recall-scale gate", () => {
  const point = (n: number, rec: number, n_q = Math.floor(n / 5)) => ({ n, n_q, rec });

  it("passes a flat or slowly dropping Rec curve", () => {
    expect(gateRecallScale([point(1_000, 1), point(10_000, 1), point(100_000, 1)]).ok).toBe(true);
    expect(
      gateRecallScale([
        point(1_000, 1),
        point(10_000, 1 - RECALL_SCALE_DROP_SLACK),
        point(100_000, 1 - RECALL_SCALE_DROP_SLACK),
      ]).ok,
    ).toBe(true);
  });

  it("fails a drop vs the previous N worse than the documented slack", () => {
    const r = gateRecallScale([point(1_000, 1), point(10_000, 1 - RECALL_SCALE_DROP_SLACK - 0.01)]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("dropped");
  });

  it("fails when Rec is below the documented floor even if it does not drop", () => {
    const rec = RECALL_SCALE_MIN_REC - 0.05;
    const r = gateRecallScale([point(1_000, rec), point(10_000, rec)]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("min");
  });

  it("does not apply the theorem floor until both ε_* exist", () => {
    const weak = [point(1_000, 0.86), point(10_000, 0.86)];
    expect(gateRecallScale(weak).ok).toBe(true);
    expect(gateRecallScale(weak, { epsilonS: 0.01 }).ok).toBe(true);
    const r = gateRecallScale(weak, { epsilonS: 0.01, epsilonB: 0.02 });
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("theorem floor");
  });

  it("computes 1 - ε_Ω - ε_S - ε_B ceil(log_b N_q)", () => {
    // log_8(4096) = 4, so floor = 1 - 0.05 - 0.02*4 = 0.87
    expect(theoremRecallFloor(4096, { epsilonS: 0.05, epsilonB: 0.02, b: 8 })).toBeCloseTo(0.87);
    expect(theoremRecallFloor(1, { epsilonS: 0.05, epsilonB: 0.02 })).toBeCloseTo(0.95);
    expect(
      theoremRecallFloor(4096, { epsilonOmega: 0.07, epsilonS: 0.05, epsilonB: 0.02, b: 8 }),
    ).toBeCloseTo(0.80);
  });

  it("rejects an empty curve", () => {
    expect(gateRecallScale([]).ok).toBe(false);
  });
});

describe("leftover P1-5 search-cost gate", () => {
  const point = (n: number, latencyP95Ms: number, latencyMaxMs = latencyP95Ms) => ({
    n,
    latencyP95Ms,
    latencyMaxMs,
  });

  it("passes log-ish growth under the scan ceiling", () => {
    expect(
      gateSearchCost([
        point(1_000, 451),
        point(10_000, 988),
        point(100_000, 1_145),
      ]).ok,
    ).toBe(true);
  });

  it("fails a leftover table-scan p95", () => {
    const r = gateSearchCost([point(1_000, 200), point(100_000, PRE_TURN_P95_SCAN_MS)]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("scan ceiling");
  });

  it("fails when p95 tracks N linearly", () => {
    const r = gateSearchCost([
      point(1_000, 200),
      point(100_000, 200 * SEARCH_COST_VS_N_SLACK),
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("O(log N_q)");
  });

  it("does not treat one slow Windows sample as a scan when p50 stays log-ish", () => {
    expect(
      gateSearchCost([
        { n: 1_000, latencyP50Ms: 142.8, latencyP95Ms: 176.9, latencyMaxMs: 176.9 },
        { n: 10_000, latencyP50Ms: 220.5, latencyP95Ms: 1_009.1, latencyMaxMs: 1_009.1 },
        { n: 100_000, latencyP50Ms: 529, latencyP95Ms: 2_869, latencyMaxMs: 2_869 },
      ]).ok,
    ).toBe(true);
  });

  it("fails when p50 tracks N linearly", () => {
    const r = gateSearchCost([
      { n: 1_000, latencyP50Ms: 200, latencyP95Ms: 220, latencyMaxMs: 220 },
      { n: 100_000, latencyP50Ms: 200 * SEARCH_COST_VS_N_SLACK, latencyP95Ms: 400, latencyMaxMs: 400 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("O(log N_q)");
    expect(r.failures.join()).toContain("latencyP50");
  });

  it("rejects an empty curve", () => {
    expect(gateSearchCost([]).ok).toBe(false);
  });
});

describe("MEM-41 answerable horizon", () => {
  const point = (l: number, rec: number) => ({ l, rec });

  it("is the last L that stays at Rec ≥ ρ when a later point drops", () => {
    const h = answerableHorizon([
      point(0, 1),
      point(14, 1),
      point(60, 0.9),
      point(180, 0.8),
    ]);
    expect(h.rho).toBe(HORIZON_RHO);
    expect(h.h).toBe(60);
    expect(h.censored).toBe(false);
    expect(h.firstMissL).toBe(180);
    // 0.90 @ 60d → 0.80 @ 180d crosses 0.85 at 120d
    expect(h.hInterp).toBeCloseTo(120, 10);
  });

  it("is censored at the last L when Rec never falls below ρ", () => {
    const h = answerableHorizon([point(0, 1), point(14, 0.9), point(365, 0.86)]);
    expect(h.h).toBe(365);
    expect(h.censored).toBe(true);
    expect(h.hInterp).toBeUndefined();
    expect(h.firstMissL).toBeUndefined();
  });

  it("is 0 when even the youngest age misses ρ", () => {
    const h = answerableHorizon([point(0, 0.7), point(14, 0.6)]);
    expect(h.h).toBe(0);
    expect(h.censored).toBe(false);
    expect(h.firstMissL).toBe(0);
  });

  it("does not let a later rebound extend the horizon", () => {
    const h = answerableHorizon([point(0, 1), point(14, 0.8), point(60, 0.95)]);
    expect(h.h).toBe(0);
    expect(h.firstMissL).toBe(14);
  });

  it("gates fresh Rec and an optional minimum H, not a drop at large L", () => {
    const crossing = [point(0, 1), point(60, 0.9), point(180, 0.7)];
    expect(gateHorizon(crossing).ok).toBe(true);
    expect(gateHorizon(crossing, { minH: 14 }).ok).toBe(true);
    expect(gateHorizon(crossing, { minH: 90 }).ok).toBe(false);
    expect(gateHorizon([point(0, 0.7), point(14, 0.7)]).ok).toBe(false);
    expect(gateHorizon([]).ok).toBe(false);
  });
});

describe("MEM-78 latency at 1e6 and Dilution Lemma", () => {
  it("skips the 300 ms gate when 1e6 is not in the curve", () => {
    expect(gateLatencyAt1e6([{ n: 100_000, latencyP95Ms: 1_000 }]).ok).toBe(true);
  });

  it("fails p95 >= 300 ms at 1e6", () => {
    const r = gateLatencyAt1e6([
      { n: 1_000, latencyP95Ms: 20 },
      { n: 1_000_000, latencyP95Ms: RETRIEVAL_P95_AT_1E6_MS },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("300");
  });

  it("passes a sub-300 ms 1e6 point", () => {
    expect(gateLatencyAt1e6([{ n: 1_000_000, latencyP95Ms: 250 }]).ok).toBe(true);
  });

  it("flat top-k hit probability collapses as N grows (Dilution Lemma)", () => {
    const k = 50;
    const p = 0.01;
    expect(flatTopKHitBound(1_000, k, p)).toBeGreaterThan(flatTopKHitBound(1_000_000, k, p));
    expect(flatTopKHitBound(1_000_000, k, p)).toBeLessThan(1e-10);
  });
});

describe("MEM-79 / MEM-80 accuracy, erasure, and release gate", () => {
  it("accuracy does not regress vs the previous release", () => {
    expect(gateAccuracy({ overall: 0.8 }, { overall: 0.8 }).ok).toBe(true);
    expect(gateAccuracy({ overall: 0.7 }, { overall: 0.8 }).ok).toBe(false);
    expect(gateAccuracy({ overall: 0.9 }).ok).toBe(true);
  });

  it("H_0.85 does not regress", () => {
    expect(gateHorizonRegression(60, 60).ok).toBe(true);
    expect(gateHorizonRegression(14, 60).ok).toBe(false);
    expect(gateHorizonRegression(60, undefined).ok).toBe(true);
  });

  it("erasure requires zero leftover hits", () => {
    expect(gateErasure({ planted: 2, hits: 0, erasure_met: true }).ok).toBe(true);
    expect(gateErasure({ planted: 2, hits: 1, erasure_met: true }).ok).toBe(false);
    expect(gateErasure({ planted: 2, hits: 0, erasure_met: false }).ok).toBe(false);
  });

  it("aggregates the five release rows", () => {
    const pass = { ok: true, failures: [] as string[] };
    const fail = { ok: false, failures: ["nope"] };
    expect(
      gateRelease({
        recallScale: pass,
        accuracy: pass,
        horizon: pass,
        latency: pass,
        erasure: pass,
      }).ok,
    ).toBe(true);
    const r = gateRelease({
      recallScale: pass,
      accuracy: fail,
      horizon: pass,
      latency: pass,
      erasure: pass,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("accuracy");
  });
});
