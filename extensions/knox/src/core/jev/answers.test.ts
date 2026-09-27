import { describe, expect, it } from "vitest";

import { confidenceFromProbabilities } from "./answers";

describe("confidenceFromProbabilities", () => {
  it("is 1 for a one-hot distribution", () => {
    expect(
      confidenceFromProbabilities({ chat: 1, view_read: 0, clarify: 0 }),
    ).toBeCloseTo(1);
  });

  it("is 0 for a uniform distribution", () => {
    expect(
      confidenceFromProbabilities({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 }),
    ).toBeCloseTo(0);
  });

  it("is high when one option dominates", () => {
    expect(
      confidenceFromProbabilities({ chat: 0.9, view_read: 0.05, clarify: 0.05 }),
    ).toBeGreaterThan(0.5);
  });
});
