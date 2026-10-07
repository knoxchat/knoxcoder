import { describe, expect, it } from "vitest";

import { countTokens, pruneLinesFromBottom, pruneLinesFromTop } from "./countTokens";

const lines = Array.from({ length: 20_000 }, (_, i) => `packages/pkg/src/dir-${i % 10}/file-${i}.ts`);
const text = lines.join("\n");

describe("pruneLinesFrom{Top,Bottom}", () => {
  it("returns the prompt unchanged when it fits", () => {
    expect(pruneLinesFromTop("a\nb", 100, "m")).toBe("a\nb");
    expect(pruneLinesFromBottom("a\nb", 100, "m")).toBe("a\nb");
  });

  it("stays within the budget on long lists (no drift)", () => {
    for (const budget of [50, 1_000, 50_000]) {
      const top = pruneLinesFromTop(text, budget, "m");
      const bottom = pruneLinesFromBottom(text, budget, "m");
      expect(countTokens(top, "m")).toBeLessThanOrEqual(budget);
      expect(countTokens(bottom, "m")).toBeLessThanOrEqual(budget);
      // ...and keeps nearly all of what fits (within one line).
      expect(countTokens(top, "m")).toBeGreaterThan(budget - 30);
    }
  });

  it("keeps the right end", () => {
    expect(pruneLinesFromTop(text, 100, "m").endsWith(lines[lines.length - 1])).toBe(true);
    expect(pruneLinesFromBottom(text, 100, "m").startsWith(lines[0])).toBe(true);
  });

  it("returns an empty string when nothing fits", () => {
    expect(pruneLinesFromTop("x".repeat(400), 5, "m")).toBe("");
  });
});
