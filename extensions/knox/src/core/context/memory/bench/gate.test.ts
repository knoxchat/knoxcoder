import { describe, expect, it } from "vitest";

import {
  answerableHorizon,
  compareToBaseline,
  gateHorizon,
  gateRecallScale,
  theoremRecallFloor,
  HORIZON_RHO,
  RECALL_SCALE_DROP_SLACK,
  RECALL_SCALE_MIN_REC,
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

  it("computes 1 - ε_S - ε_B ceil(log_b N_q)", () => {
    // log_8(4096) = 4, so floor = 1 - 0.05 - 0.02*4 = 0.87
    expect(theoremRecallFloor(4096, { epsilonS: 0.05, epsilonB: 0.02, b: 8 })).toBeCloseTo(0.87);
    expect(theoremRecallFloor(1, { epsilonS: 0.05, epsilonB: 0.02 })).toBeCloseTo(0.95);
  });

  it("rejects an empty curve", () => {
    expect(gateRecallScale([]).ok).toBe(false);
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
