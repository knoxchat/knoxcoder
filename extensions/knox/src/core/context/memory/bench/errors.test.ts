/**
 * MEM-42: σ, ε_B, ε_S helpers.
 */
import { describe, expect, it } from "vitest";

import {
  EPSILON_B_FLAT_FTS,
  aggregateQueryErrors,
  buildTheoremErrorReport,
  canClaimTheorem,
  formatTheoremErrorsLine,
  keysFromRefs,
  loadTheoremErrors,
  meanSelectivity,
  readTheoremErrors,
  scopeSelectivity,
  selectionMissRate,
  theoremHeldOnCurve,
} from "./errors";

describe("MEM-42 theorem errors", () => {
  it("computes σ = mean_q N_q / N", () => {
    expect(scopeSelectivity(20, 100)).toBeCloseTo(0.2);
    expect(scopeSelectivity(0, 10)).toBe(0);
    expect(meanSelectivity([
      { n_q: 20, n: 100 },
      { n_q: 20, n: 100 },
    ])).toBeCloseTo(0.2);
  });

  it("ε_S is |R ∩ Cand − C| / |R ∩ Cand|", () => {
    expect(selectionMissRate({
      relevant: ["a", "b"],
      candidates: ["a", "b"],
      selected: ["a"],
    })).toEqual({ epsilonS: 0.5, opportunities: 2, misses: 1 });
    expect(selectionMissRate({
      relevant: ["a"],
      candidates: [],
      selected: [],
    })).toEqual({ epsilonS: 0, opportunities: 0, misses: 0 });
  });

  it("does not claim the theorem when ε_B is n/a — flat FTS", () => {
    expect(canClaimTheorem(null)).toBe(false);
    expect(canClaimTheorem(undefined)).toBe(false);
    expect(canClaimTheorem(0.02)).toBe(true);
    const unpublished = buildTheoremErrorReport({
      sigma: 0.2,
      epsilonB: null,
      epsilonS: 0,
    });
    expect(unpublished.epsilon_b).toBeNull();
    expect(unpublished.epsilon_b_note).toBe(EPSILON_B_FLAT_FTS);
    expect(unpublished.theorem_held).toBe(false);
  });

  it("theorem_held requires Rec ≥ 1 − ε_S − ε_B ceil(log_b N_q)", () => {
    const points = [{ n_q: 4096, rec: 0.87 }];
    expect(theoremHeldOnCurve(points, { epsilonS: 0.05, epsilonB: 0.02, b: 8 })).toBe(true);
    expect(theoremHeldOnCurve([{ n_q: 4096, rec: 0.70 }], { epsilonS: 0.05, epsilonB: 0.05, b: 8 })).toBe(false);
    expect(theoremHeldOnCurve(points, { epsilonS: 0, epsilonB: null })).toBe(false);
  });

  it("reads new keys from baseline.json and prefers a scale sibling", () => {
    const baseline = {
      recallAtK: 1,
      sigma: 1,
      epsilon_b: null,
      epsilon_b_note: EPSILON_B_FLAT_FTS,
      epsilon_s: 0,
      theorem_held: false,
    };
    const fromBaseline = readTheoremErrors(baseline);
    expect(fromBaseline?.epsilon_b).toBeNull();
    expect(fromBaseline?.epsilon_b_note).toBe(EPSILON_B_FLAT_FTS);
    expect(fromBaseline?.theorem_held).toBe(false);

    const scale = {
      sigma: 0.2,
      epsilon_b: 0.01,
      epsilon_s: 0,
      theorem_held: true,
    };
    const loaded = loadTheoremErrors({ baseline, theoremErrors: scale });
    expect(loaded?.epsilon_b).toBeCloseTo(0.01);
    expect(loaded?.sigma).toBeCloseTo(0.2);
    expect(formatTheoremErrorsLine(loaded!)).toContain("ε_B 0.01");
  });

  it("maps cand/selected refs back to gold keys", () => {
    const idByTitle = new Map([["JWT auth", "auth-jwt"]]);
    const keyById = new Map([[42, "auth-jwt"]]);
    expect(keysFromRefs([{ title: "JWT auth", id: 42 }], idByTitle, keyById)).toEqual(["auth-jwt"]);
    expect(keysFromRefs([{ title: "other", id: 42 }], idByTitle, keyById)).toEqual(["auth-jwt"]);
  });

  it("pools per-query miss counts", () => {
    const report = aggregateQueryErrors([
      {
        epsilonB: 0.25,
        epsilonBOpportunities: 4,
        epsilonBMisses: 1,
        epsilonS: 0,
        epsilonSOpportunities: 2,
        epsilonSMisses: 0,
        n_q: 20,
        n: 100,
        rec: 1,
      },
      {
        epsilonB: 0,
        epsilonBOpportunities: 4,
        epsilonBMisses: 0,
        epsilonS: 0.5,
        epsilonSOpportunities: 2,
        epsilonSMisses: 1,
        n_q: 20,
        n: 100,
        rec: 1,
      },
    ]);
    expect(report.sigma).toBeCloseTo(0.2);
    expect(report.epsilon_b).toBeCloseTo(0.125);
    expect(report.epsilon_s).toBeCloseTo(0.25);
    expect(report.tree_ready).toBe(true);
  });
});
