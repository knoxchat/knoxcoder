import { describe, expect, it } from "vitest";

import { compareToBaseline, type GateSummary } from "./gate";

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
    const loose = { ...base, falseInjectRate: 0.333 };
    const r = compareToBaseline({ ...loose, falseInjectRate: 0.333 }, loose);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("target");
  });
});
