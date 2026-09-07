import { describe, expect, it } from "vitest";

import { formatTokenCount } from "./formatTokenCount";

describe("formatTokenCount", () => {
  it("keeps values under one thousand as integers", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(420)).toBe("420");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("uses k / m / b / t suffixes by magnitude", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(4200)).toBe("4.2k");
    expect(formatTokenCount(42_000)).toBe("42k");
    expect(formatTokenCount(128_000)).toBe("128k");
    expect(formatTokenCount(1_000_000)).toBe("1.0m");
    expect(formatTokenCount(1_356_000)).toBe("1.4m");
    expect(formatTokenCount(12_400_000)).toBe("12m");
    expect(formatTokenCount(1_356_000_000)).toBe("1.4b");
    expect(formatTokenCount(1_356_000_000_000)).toBe("1.4t");
  });

  it("promotes to the next unit when rounding reaches 1000", () => {
    expect(formatTokenCount(999_500)).toBe("1.0m");
    expect(formatTokenCount(999_500_000)).toBe("1.0b");
  });

  it("treats non-finite and negative values as zero", () => {
    expect(formatTokenCount(Number.NaN)).toBe("0");
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatTokenCount(-12)).toBe("0");
  });
});
