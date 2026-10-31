/**
 * MEM-28 — W_mem = min(w_mem_tokens, W − |C_system| − |C_goal| − |C_recent| − W_out).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem28-${Date.now()}`);

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let ContextSections: typeof import("./ContextSections.js").ContextSections;
let computeWMem: typeof import("./memoryConfigAccess.js").computeWMem;
let getMemoryInjectBudget: typeof import("./memoryConfigAccess.js").getMemoryInjectBudget;
let getMemoryInjectHardCap: typeof import("./memoryConfigAccess.js").getMemoryInjectHardCap;
let MEMORY_INJECT_HARD_CAP_TOKENS: typeof import("./memoryConfigAccess.js").MEMORY_INJECT_HARD_CAP_TOKENS;
let resetRoutedWindow: typeof import("./window.js").resetRoutedWindow;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  delete process.env.KNOX_MEMORY_INJECT_CAP;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ ContextSections } = await import("./ContextSections.js"));
  ({ computeWMem, getMemoryInjectBudget, getMemoryInjectHardCap, MEMORY_INJECT_HARD_CAP_TOKENS } =
    await import("./memoryConfigAccess.js"));
  ({ resetRoutedWindow } = await import("./window.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterEach(() => {
  resetRoutedWindow();
  delete process.env.KNOX_MEMORY_INJECT_CAP;
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("MEM-28 W_mem remainder", () => {
  it("caps a large remainder at w_mem_tokens (4096), not 8000", () => {
    const budget = computeWMem({
      w: 128_000,
      wOut: 2048,
      systemTokens: 1000,
      goalTokens: 200,
      recentTokens: 3000,
    });
    expect(budget.remainder).toBe(128_000 - 1000 - 200 - 3000 - 2048);
    expect(budget.remainder).toBeGreaterThan(8000);
    expect(budget.wMem).toBe(4096);
    expect(budget.wMem).toBe(getMemoryInjectHardCap());
    expect(MEMORY_INJECT_HARD_CAP_TOKENS).toBe(4096);
    expect(getMemoryInjectBudget({
      w: 128_000,
      wOut: 2048,
      systemTokens: 1000,
      goalTokens: 200,
      recentTokens: 3000,
    })).toBe(4096);
  });

  it("uses the remainder when it is smaller than the local cap", () => {
    const budget = computeWMem({
      w: 8000,
      wOut: 2000,
      systemTokens: 2500,
      goalTokens: 400,
      recentTokens: 1500,
    });
    expect(budget.remainder).toBe(1600);
    expect(budget.wMem).toBe(1600);
    expect(budget.wMem + budget.systemTokens + budget.goalTokens + budget.recentTokens + budget.wOut)
      .toBe(8000);
  });

  it("does not apply 8000 as a third constant", () => {
    const wide = computeWMem({ w: 32_000, wOut: 2048 });
    expect(wide.remainder).toBe(32_000 - 2048);
    expect(wide.wMem).toBe(4096);
    expect(wide.wMem).not.toBe(8000);
  });

  it("KNOX_MEMORY_INJECT_CAP overrides the local w_mem cap only", () => {
    process.env.KNOX_MEMORY_INJECT_CAP = "1200";
    expect(getMemoryInjectHardCap()).toBe(1200);
    expect(computeWMem({ w: 128_000, wOut: 2048 }).wMem).toBe(1200);
    expect(computeWMem({ w: 8000, wOut: 2000, systemTokens: 5000 }).wMem).toBe(1000);
    process.env.KNOX_MEMORY_INJECT_CAP = "10";
    expect(getMemoryInjectHardCap()).toBe(4096);
  });

  it("ContextBuilder W_mem excludes C_goal (leftover computeBudget is unused)", async () => {
    const howToShares = ContextSections.computeBudget("how to setup the workflow", 4000);
    const defaultShares = ContextSections.computeBudget("hello", 4000);
    expect(howToShares.procedures).toBeGreaterThan(defaultShares.procedures);

    const donated = ContextSections.leftoverSectionShares(
      { semantic: 100, episodic: 80, graph: 40, procedures: 30, patterns: 20 },
      { semantic: true, episodic: false, graph: false, procedures: true, patterns: true },
    );
    expect(donated.episodic).toBe(0);
    expect(donated.graph).toBe(0);
    expect(donated.procedures).toBe(150);

    const built = await ContextBuilder.buildDetailed({
      message: "how to setup the workflow",
      goal: "Ship the setup guide",
      llm: { model: "tiny", contextLength: 8000, completionOptions: { maxTokens: 2000 } },
      system_tokens: 1500,
      recent_tokens: 500,
    });
    expect(built.w).toBe(8000);
    expect(built.w_out).toBe(2000);
    expect(built.system_tokens).toBe(1500);
    expect(built.recent_tokens).toBe(500);
    expect(built.goal_tokens).toBeGreaterThan(0);
    expect(built.w_mem).toBe(built.inject_budget);
    expect(
      (built.w_mem ?? 0) +
        (built.system_tokens ?? 0) +
        (built.goal_tokens ?? 0) +
        (built.recent_tokens ?? 0) +
        (built.w_out ?? 0),
    ).toBeLessThanOrEqual(8000);
    expect(built.inject_budget).toBeLessThanOrEqual(4096);
  });
});
