/**
 * MEM-70 — W_mem floor, shrink C_recent first, reroute or explicit error.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { planRecentShare, wMemFloor } from "./memoryConfigAccess.js";
import { UNKNOWN_CONTEXT_FALLBACK } from "../../../agent/contextBudget.js";

const testDir = path.join(os.tmpdir(), `brain-mem70-${Date.now()}`);

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let resetRoutedWindow: typeof import("./window.js").resetRoutedWindow;
let runAgentLoop: typeof import("../../../agent/loop.js").runAgentLoop;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ resetRoutedWindow } = await import("./window.js"));
  ({ runAgentLoop } = await import("../../../agent/loop.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterEach(() => {
  resetRoutedWindow();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("MEM-70 W_mem floor", () => {
  it("is min(1K, W/8)", () => {
    expect(wMemFloor(8000)).toBe(1000);
    expect(wMemFloor(128_000)).toBe(1024);
    expect(wMemFloor(4000)).toBe(500);
    expect(wMemFloor(256)).toBe(32);
  });

  it("overflows C_recent when keeping it would drop W_mem below the floor", () => {
    const plan = planRecentShare({
      w: 8000,
      wOut: 2000,
      systemTokens: 1500,
      goalTokens: 200,
      recentTokens: 3500,
      wMemCap: 4096,
    });
    expect(plan.wMemMin).toBe(1000);
    expect(plan.unsatisfiable).toBe(false);
    expect(plan.overflowed).toBe(true);
    expect(plan.recentTokens).toBe(204);
  });

  it("marks the window unsatisfiable when system + goal + W_out + floor exceed W", () => {
    const plan = planRecentShare({
      w: 256,
      wOut: 64,
      systemTokens: 150,
      goalTokens: 50,
      recentTokens: 0,
    });
    expect(plan.wMemMin).toBe(32);
    expect(plan.unsatisfiable).toBe(true);
    expect(plan.overflowed).toBe(false);
  });

  it("returns an explicit error for a tiny window and does not truncate", async () => {
    const built = await ContextBuilder.buildDetailed({
      message: "hi",
      llm: { model: "tiny", contextLength: 256, completionOptions: { maxTokens: 64 } },
      system_tokens: 150,
      goal_tokens: 50,
    });
    expect(built.budget_error).toMatch(/Memory window too small/);
    expect(built.budget_error).toMatch(/not truncated/);
    expect(built.context).toBe("");
    expect(built.items).toEqual([]);
    expect(built.w).toBe(256);
    expect(built.budget_invariant_met).toBe(true);
    expect((built.c_use ?? 0) + (built.w_out ?? 0)).toBeLessThanOrEqual(built.w ?? 0);
  });

  it("reroutes to a larger-window model when one is configured", async () => {
    await BrainStore.saveConfig("hard_model", "wide-hard");
    const built = await ContextBuilder.buildDetailed({
      message: "hi",
      llm: { model: "tiny", contextLength: 256, completionOptions: { maxTokens: 64 } },
      system_tokens: 150,
      goal_tokens: 50,
    });
    expect(built.budget_error).toBeUndefined();
    expect(built.rerouted_model).toBe("wide-hard");
    expect(built.w).toBe(UNKNOWN_CONTEXT_FALLBACK);
    expect(built.budget_invariant_met).toBe(true);
    await BrainStore.saveConfig("hard_model", "");
  });
});

describe("MEM-70 agent loop", () => {
  it("stops with an explicit error when the floor cannot fit", async () => {
    const result = await runAgentLoop({
      extras: {
        llm: {
          model: "tiny",
          contextLength: 256,
          completionOptions: { maxTokens: 64 },
          streamChat: async function* () {
            yield { role: "assistant", content: "should not run" };
          },
        } as never,
      },
      messages: [
        { role: "system", content: "x".repeat(800) },
        { role: "user", content: "hi" },
      ],
      tools: [],
      compact: false,
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("error");
    expect(result.summary).toMatch(/Memory window too small/);
    expect(result.steps).toBe(0);
  });

  it("reroutes to fallbackLlm when that window is large enough", async () => {
    const result = await runAgentLoop({
      extras: {
        llm: {
          model: "tiny",
          contextLength: 256,
          completionOptions: { maxTokens: 64 },
          streamChat: async function* () {
            yield { role: "assistant", content: "tiny should not run" };
          },
        } as never,
      },
      fallbackLlm: {
        model: "wide",
        contextLength: 8000,
        completionOptions: { maxTokens: 256 },
        streamChat: async function* () {
          yield { role: "assistant", content: "routed wide" };
        },
      } as never,
      messages: [
        { role: "system", content: "x".repeat(800) },
        { role: "user", content: "hi" },
      ],
      tools: [],
      compact: false,
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.summary).toContain("routed wide");
  });
});
