import { describe, expect, it } from "vitest";

import { formatElapsed } from "./LoadingState";

describe("formatElapsed", () => {
  it("formats sub-minute durations to one decimal", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(3.2)).toBe("3.2s");
    expect(formatElapsed(59.94)).toBe("59.9s");
  });

  it("formats minutes with remaining seconds", () => {
    expect(formatElapsed(60)).toBe("1m 0.0s");
    expect(formatElapsed(75.4)).toBe("1m 15.4s");
  });

  it("guards invalid values", () => {
    expect(formatElapsed(-1)).toBe("0.0s");
    expect(formatElapsed(Number.NaN)).toBe("0.0s");
  });
});
