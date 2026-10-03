import { describe, expect, it } from "vitest";

import {
  applyCacheBreakpoints,
  extractUsage,
  supportsExplicitCacheControl,
} from "./promptCache";

describe("promptCache (K-030)", () => {
  it("detects models that need explicit breakpoints", () => {
    expect(supportsExplicitCacheControl("anthropic/claude-sonnet-4.5")).toBe(true);
    expect(supportsExplicitCacheControl("google/gemini-2.5-pro")).toBe(true);
    expect(supportsExplicitCacheControl("openai/gpt-5")).toBe(false);
    expect(supportsExplicitCacheControl(undefined)).toBe(false);
  });

  it("marks the first system and last two user messages, without mutating", () => {
    const input = [
      { role: "system", content: "stable" },
      { role: "system", content: "plan" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: [{ type: "text", text: "u2a" }, { type: "text", text: "u2b" }] },
      { role: "user", content: "u3" },
    ];
    const snapshot = JSON.stringify(input);
    const out = applyCacheBreakpoints(input) as any[];
    expect(JSON.stringify(input)).toBe(snapshot);

    expect(out[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out[1].content).toBe("plan");
    expect(out[2].content).toBe("u1");
    expect(out[4].content[0].cache_control).toBeUndefined();
    expect(out[4].content[1].cache_control).toEqual({ type: "ephemeral" });
    expect(out[5].content[0].cache_control).toEqual({ type: "ephemeral" });

    const count = JSON.stringify(out).split("cache_control").length - 1;
    expect(count).toBeLessThanOrEqual(4);
  });

  it("keeps the marked system block identical across turns", () => {
    const sys = { role: "system", content: "stable prompt" };
    const a = applyCacheBreakpoints([sys, { role: "user", content: "q1" }]);
    const b = applyCacheBreakpoints([
      sys,
      { role: "user", content: "q1" },
      { role: "assistant", content: "r" },
      { role: "user", content: "q2" },
    ]);
    expect(JSON.stringify(a[0])).toBe(JSON.stringify(b[0]));
  });

  it("extracts usage including cache tokens from each provider shape", () => {
    expect(
      extractUsage({
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
      }),
    ).toEqual({
      promptTokens: 1000,
      completionTokens: 50,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    });
    expect(
      extractUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 3,
      }),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
    });
    expect(extractUsage({})).toBeUndefined();
    expect(extractUsage(null)).toBeUndefined();
  });
});
