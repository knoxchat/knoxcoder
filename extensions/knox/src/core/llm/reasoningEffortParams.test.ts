import { describe, expect, it } from "vitest";

import { DEFAULT_REASONING_EFFORT_CONFIG } from "./reasoningEffortConfig";
import {
  REASONING_EFFORT_LEVELS,
  reasoningRequestParams,
} from "./reasoningEffortParams";
import { toChatBody } from "./openaiTypeConverters";

describe("reasoning effort follows the OpenRouter enum", () => {
  it("default effort list is exactly the documented enum, without max", () => {
    expect([...REASONING_EFFORT_LEVELS].sort()).toEqual(
      ["high", "low", "medium", "minimal", "none", "xhigh"],
    );
    expect(DEFAULT_REASONING_EFFORT_CONFIG.allowed).toEqual([
      ...REASONING_EFFORT_LEVELS,
    ]);
    expect(DEFAULT_REASONING_EFFORT_CONFIG.allowed).not.toContain("max");
    expect(DEFAULT_REASONING_EFFORT_CONFIG.default).toBe("medium");
  });

  it.each(["xhigh", "high", "medium", "low", "minimal", "none"])(
    "sends %s as reasoning_effort",
    (level) => {
      expect(reasoningRequestParams(level)).toEqual({ reasoning_effort: level });
      expect(reasoningRequestParams(level.toUpperCase())).toEqual({
        reasoning_effort: level,
      });
    },
  );

  it("sends max as xhigh effort plus verbosity max", () => {
    expect(reasoningRequestParams("max")).toEqual({
      reasoning_effort: "xhigh",
      verbosity: "max",
    });
  });

  it("drops unknown or empty values instead of forwarding them", () => {
    expect(reasoningRequestParams(undefined)).toEqual({});
    expect(reasoningRequestParams("")).toEqual({});
    expect(reasoningRequestParams("ultra")).toEqual({});
  });

  it("applies to the chat request body", () => {
    const msgs = [{ role: "user", content: "hi" }] as any;
    const high = toChatBody(msgs, { model: "m", reasoningEffort: "high" } as any) as any;
    expect(high.reasoning_effort).toBe("high");
    expect(high.verbosity).toBeUndefined();
    const max = toChatBody(msgs, { model: "m", reasoningEffort: "max" } as any) as any;
    expect(max.reasoning_effort).toBe("xhigh");
    expect(max.verbosity).toBe("max");
    const none = toChatBody(msgs, { model: "m", reasoningEffort: "none" } as any) as any;
    expect(none.reasoning_effort).toBe("none");
    const bad = toChatBody(msgs, { model: "m", reasoningEffort: "ultra" } as any) as any;
    expect("reasoning_effort" in bad).toBe(false);
  });
});
