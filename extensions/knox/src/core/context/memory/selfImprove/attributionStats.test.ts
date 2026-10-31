import { describe, expect, it } from "vitest";

import {
  attributionCoverage,
  formatAttributionCoverage,
  formatRecVsN,
  formatTheoremReport,
  readRecVsNPoints,
} from "./attributionStats";

describe("MEM-43 theorem report stats", () => {
  it("measures attribution coverage as injects with an outcome", () => {
    const stats = attributionCoverage([
      { injected: 1, helpful: 1 },
      { injected: 1, helpful: 0 },
      { injected: 1, helpful: null },
      { injected: 0, helpful: 1 },
    ]);
    expect(stats).toEqual({ injected: 3, withOutcome: 2, coverage: 2 / 3 });
    expect(formatAttributionCoverage(stats)).toBe("66.7% (2/3 injects have an outcome)");
    expect(formatAttributionCoverage({ injected: 0, withOutcome: 0, coverage: 0 })).toBe("n/a (no injects)");
  });

  it("reads Rec vs N points and formats the theorem section", () => {
    const points = readRecVsNPoints({
      points: [
        { n: 10000, rec: 0.85, epsilon_s: 0.1 },
        { n: 1000, rec: 0.9 },
      ],
    });
    expect(points.map((p) => p.n)).toEqual([1000, 10000]);
    expect(formatRecVsN(points)).toBe("N=1000 Rec=0.9; N=10000 Rec=0.85");

    const text = formatTheoremReport({
      scalePoints: points,
      theorem: { sigma: 0.2, epsilon_b: 0.05, epsilon_s: 0.1, theorem_held: true },
      falseInjectRate: 0.12,
      attribution: { injected: 10, withOutcome: 3, coverage: 0.3 },
      wrongApplyRate: 0.5,
    });
    expect(text).toContain("## Theorem");
    expect(text).toContain("N=1000 Rec=0.9");
    expect(text).toContain("ε_S 0.1");
    expect(text).toContain("false-inject: 0.12");
    expect(text).toContain("30% (3/10 injects have an outcome)");
    expect(text).toContain("recipe wrongApplyRate: 0.5");
  });
});
