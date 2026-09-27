import { describe, expect, it } from "vitest";

import { normalizeReasoningEffortPrefs } from "./GlobalContext";

describe("normalizeReasoningEffortPrefs", () => {
  it("returns an empty map for invalid input", () => {
    expect(normalizeReasoningEffortPrefs(undefined)).toEqual({ byModel: {} });
    expect(normalizeReasoningEffortPrefs("high")).toEqual({ byModel: {} });
  });

  it("keeps last effort and per-model values", () => {
    expect(
      normalizeReasoningEffortPrefs({
        lastEffort: "high",
        byModel: {
          "deepseek/deepseek-v4-flash": "high",
          skip: 1,
          "": "low",
        },
      }),
    ).toEqual({
      lastEffort: "high",
      byModel: { "deepseek/deepseek-v4-flash": "high" },
    });
  });
});
