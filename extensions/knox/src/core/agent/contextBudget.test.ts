import { describe, expect, it } from "vitest";
import type { ChatMessage } from "..";

import { compileChatMessages } from "../llm/countTokens";
import {
  calibrationRatio,
  computeContextUsage,
  resolveContextWindow,
} from "./contextBudget";
import { createAgentLoopCompactor } from "./loop";

const big = (n: number) => "word ".repeat(n);

function history(turns: number, size: number): ChatMessage[] {
  const out: ChatMessage[] = [
    { role: "system", content: "You are Knox." },
    { role: "system", content: "## Task Execution Plan\n1. do the thing" },
  ];
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: `q${i} ${big(size)}` });
    out.push({ role: "assistant", content: `a${i} ${big(size)}` });
  }
  return out;
}

describe("resolveContextWindow", () => {
  it("uses the llm's own window and caps maxTokens to a quarter", () => {
    const w = resolveContextWindow({
      model: "x",
      contextLength: 8000,
      completionOptions: { maxTokens: 64000 },
    });
    expect(w.contextLength).toBe(8000);
    expect(w.maxTokens).toBe(2000);
    expect(w.source).toBe("llm");
  });
  it("uses the catalog, then a conservative fallback (not 32k/gpt-4o)", () => {
    expect(resolveContextWindow({ model: "gpt-4o" }).contextLength).toBe(128000);
    const unknown = resolveContextWindow({ model: "mystery" });
    expect(unknown.contextLength).toBe(128000);
    expect(unknown.source).toBe("fallback");
  });
});

describe("calibration and meter", () => {
  it("clamps the ratio and prefers reported usage", () => {
    expect(calibrationRatio(1000, 100)).toBe(3);
    expect(calibrationRatio(0, 100)).toBe(1);
    const w = resolveContextWindow({ model: "x", contextLength: 10000 });
    const u = computeContextUsage([{ role: "user", content: "hi" }], w, 5000);
    expect(u).toMatchObject({ used: 5000, limit: 10000, ratio: 0.5, source: "reported" });
  });
});

describe("agent compactor across window sizes", () => {
  for (const contextLength of [8_000, 32_000, 200_000, 1_000_000]) {
    it(`keeps history under the window at ${contextLength}`, async () => {
      const compact = createAgentLoopCompactor({
        model: "gpt-4o",
        contextLength,
        completionOptions: { maxTokens: 1024 },
      } as never);
      const turns = Math.min(400, Math.ceil((contextLength * 2) / 300));
      const messages = history(turns, 150);
      const out = await compact(messages);
      const text = out.map((m) => String(m.content)).join("\n");
      expect(text).toContain("Task Execution Plan");
      expect(text).toContain("You are Knox.");
      const approx = out.reduce((n, m) => n + String(m.content).length / 4, 0);
      expect(approx).toBeLessThan(contextLength);
    });
  }

  it("shrinks the window when the provider reports more tokens than estimated", async () => {
    const llm = { model: "gpt-4o", contextLength: 32_000 } as never;
    const compact = createAgentLoopCompactor(llm);
    const messages = history(40, 150);
    const before = (await compact(messages)).length;
    compact.observeUsage?.(500_000, messages);
    const after = (await compact(messages)).length;
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe("long-run eval: history never overflows", () => {
  for (const contextLength of [8_000, 32_000, 200_000]) {
    it(`stays under ${contextLength} across 300 growing rounds`, async () => {
      const compact = createAgentLoopCompactor({
        model: "gpt-4o",
        contextLength,
        completionOptions: { maxTokens: 1024 },
      } as never);
      let messages: ChatMessage[] = history(0, 0);
      for (let round = 0; round < 300; round++) {
        messages.push({ role: "user", content: `q${round} ${big(120)}` });
        messages.push({ role: "assistant", content: `a${round} ${big(120)}` });
        messages = await compact(messages);
        const approx = messages.reduce(
          (n, m) => n + String(m.content).length / 4,
          0,
        );
        expect(approx).toBeLessThan(contextLength);
      }
      const text = messages.map((m) => String(m.content)).join("\n");
      expect(text).toContain("Task Execution Plan");
    }, 60_000);
  }
});

describe("last-resort pruning keeps protected messages", () => {
  it("never drops the plan or system prompt", () => {
    const out = compileChatMessages("gpt-4o", history(60, 200), 4000, 500, false);
    const text = out.map((m) => String(m.content)).join("\n");
    expect(text).toContain("Task Execution Plan");
  });
});
