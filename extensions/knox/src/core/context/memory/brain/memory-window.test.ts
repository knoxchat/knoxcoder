/**
 * MEM-27 — W is the routed model's window, never the 10M stored ceiling.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { UNKNOWN_CONTEXT_FALLBACK } from "../../../agent/contextBudget.js";
import { MEMORY_CONTEXT_TOKEN_CEILING } from "./types.js";

const testDir = path.join(os.tmpdir(), `brain-mem27-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let TaskRouter: typeof import("./TaskRouter.js").TaskRouter;
let getMemoryInjectBudget: typeof import("./memoryConfigAccess.js").getMemoryInjectBudget;
let getContextMaxTokens: typeof import("./memoryConfigAccess.js").getContextMaxTokens;
let MEMORY_INJECT_HARD_CAP_TOKENS: typeof import("./memoryConfigAccess.js").MEMORY_INJECT_HARD_CAP_TOKENS;
let resolveMemoryWindow: typeof import("./window.js").resolveMemoryWindow;
let resetRoutedWindow: typeof import("./window.js").resetRoutedWindow;
let isMemoryContextCeiling: typeof import("./window.js").isMemoryContextCeiling;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ TaskRouter } = await import("./TaskRouter.js"));
  ({ getMemoryInjectBudget, getContextMaxTokens, MEMORY_INJECT_HARD_CAP_TOKENS } = await import(
    "./memoryConfigAccess.js"
  ));
  ({ resolveMemoryWindow, resetRoutedWindow, isMemoryContextCeiling } = await import("./window.js"));
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

describe("MEM-27 routed model window", () => {
  it("treats the 10M stored ceiling as not a live budget", () => {
    expect(isMemoryContextCeiling(MEMORY_CONTEXT_TOKEN_CEILING)).toBe(true);
    expect(isMemoryContextCeiling(128_000)).toBe(false);
    expect(getContextMaxTokens(MEMORY_CONTEXT_TOKEN_CEILING)).toBe(UNKNOWN_CONTEXT_FALLBACK);
    expect(getContextMaxTokens()).toBeLessThan(MEMORY_CONTEXT_TOKEN_CEILING);
  });

  it("a 128k model cannot be given a 10M memory budget", () => {
    const budget = getMemoryInjectBudget({
      w: 128_000,
      wOut: 2048,
      maxTokensOverride: MEMORY_CONTEXT_TOKEN_CEILING,
    });
    expect(budget).toBeLessThan(MEMORY_CONTEXT_TOKEN_CEILING);
    expect(budget).toBeLessThanOrEqual(128_000 - 2048);
    expect(budget).toBeLessThanOrEqual(MEMORY_INJECT_HARD_CAP_TOKENS);

    const window = resolveMemoryWindow({
      llm: { model: "wide", contextLength: 128_000, completionOptions: { maxTokens: 2048 } },
    });
    expect(window.w).toBe(128_000);
    expect(getMemoryInjectBudget({ window, maxTokensOverride: 10_000_000 })).toBeLessThan(10_000_000);
  });

  it("an 8k model cannot be given 8k of memory plus output", () => {
    const w = 8000;
    const window = resolveMemoryWindow({
      llm: { model: "tiny", contextLength: w, completionOptions: { maxTokens: 2048 } },
      remember: false,
    });
    expect(window.w).toBe(w);
    expect(window.wOut).toBeGreaterThan(0);
    expect(window.wOut).toBeLessThan(w);

    const budget = getMemoryInjectBudget({ w: window.w, wOut: window.wOut });
    expect(budget).toBeLessThan(w);
    expect(budget + window.wOut).toBeLessThanOrEqual(w);
    expect(budget).toBeLessThanOrEqual(MEMORY_INJECT_HARD_CAP_TOKENS);
  });

  it("ContextBuilder inject budget follows W − W_out, not the 10M ceiling", async () => {
    const built = await ContextBuilder.buildDetailed({
      message: "no lexical hits expected here",
      max_tokens: MEMORY_CONTEXT_TOKEN_CEILING,
      llm: { model: "tiny", contextLength: 8000, completionOptions: { maxTokens: 2048 } },
    });
    expect(built.w).toBe(8000);
    expect(built.w_out).toBeGreaterThan(0);
    expect(built.inject_budget).toBeDefined();
    expect(built.inject_budget! + built.w_out!).toBeLessThanOrEqual(8000);
    expect(built.inject_budget).toBeLessThan(MEMORY_CONTEXT_TOKEN_CEILING);
  });

  it("getEffectiveContext publishes routed W, not the stored 10M ceiling", async () => {
    resolveMemoryWindow({
      llm: { model: "wide", contextLength: 128_000, completionOptions: { maxTokens: 4096 } },
      remember: true,
    });
    const metrics = await BrainManager.getEffectiveContext();
    expect(metrics.w).toBe(128_000);
    expect(metrics.w_out).toBeGreaterThan(0);
    expect(metrics.w).toBeLessThan(BrainStore.getConfig().context_max_tokens);
    expect(metrics.context_max_tokens).toBe(128_000);
    expect(metrics.routed_model).toBe("wide");
  });

  it("TaskRouter uses configured easy/medium/hard models and W follows Model(x)", async () => {
    await BrainStore.saveConfig("easy_model", "tiny-easy");
    await BrainStore.saveConfig("medium_model", "mid-model");
    await BrainStore.saveConfig("hard_model", "big-hard");

    const easy = TaskRouter.scoreAndRoute({
      message: "hi",
      llm: { model: "tiny-easy", contextLength: 8000, completionOptions: { maxTokens: 1024 } },
    });
    expect(easy.modelId).toBe("tiny-easy");
    expect(easy.w).toBe(8000);
    expect(easy.wOut + easy.w).toBeGreaterThan(easy.w);
    expect(easy.wOut).toBeLessThanOrEqual(Math.floor(8000 / 4));

    const hard = TaskRouter.scoreAndRoute({
      message: "x".repeat(5000) + "```\n".repeat(10),
      toolCount: 6,
      codeBlockCount: 4,
      llm: { model: "current", contextLength: 32_000 },
    });
    expect(hard.modelId).toBe("big-hard");
    expect(hard.w).toBe(UNKNOWN_CONTEXT_FALLBACK);
    expect(hard.w).not.toBe(32_000);

    await BrainStore.saveConfig("easy_model", "");
    await BrainStore.saveConfig("medium_model", "");
    await BrainStore.saveConfig("hard_model", "");
    const fallback = TaskRouter.scoreAndRoute({
      message: "hi",
      llm: { model: "chat-now", contextLength: 16_000, completionOptions: { maxTokens: 1024 } },
    });
    expect(fallback.modelId).toBe("chat-now");
    expect(fallback.w).toBe(16_000);
  });
});
