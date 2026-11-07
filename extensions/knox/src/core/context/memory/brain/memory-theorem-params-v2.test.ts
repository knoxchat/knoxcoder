/**
 * MEM-45 — theorem parameter block v2. Defaults equal the docs Parameters table; no live behavior changes.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem45-${Date.now()}`);

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let getTheoremParamsV2: typeof import("./memoryConfigAccess.js").getTheoremParamsV2;
let getMemoryConfig: typeof import("./memoryConfigAccess.js").getMemoryConfig;
let REFIT_KEYS: typeof import("./memoryConfigAccess.js").REFIT_KEYS;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ getTheoremParamsV2, getMemoryConfig, REFIT_KEYS } = await import("./memoryConfigAccess.js"));
  await BrainStore.get();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("MEM-45 theorem params v2", () => {
  it("defaults equal the docs Parameters table", () => {
    const p = getTheoremParamsV2();
    expect(p.stabilityMaxDays).toBe(3650);
    expect(p.stabilityMinDays).toBe(0.1);
    expect(p.stabilityGainCap).toBe(10);
    expect(p.difficultyReversion).toBe(0.05);
    expect(p.difficultyHelpfulStep).toBe(0.5);
    expect(p.utilityOmega).toBe(0.1);
    expect(p.exploreRate).toBe(0.05);
    expect(p.ablationRate).toBe(0.02);
    expect(p.calibrationMinInjections).toBe(200);
    expect(p.calibrationFallbackTopK).toBe(20);
    expect(p.wMemFloorTokens).toBe(1024);
    expect(p.wMemFloorFraction).toBeCloseTo(1 / 8, 10);
    expect(p.tokenizerMargin).toBe(0.05);
    expect(p.activeSessionMinutes).toBe(30);
    expect(p.ripgrepTimeoutMs).toBe(200);
    expect(p.treeReservedSlots).toBe(0);
    expect(p.minhashPermutations).toBe(128);
    expect(p.minhashShingle).toBe(3);
  });

  it("trust is the strict order user > assistant > tool > external (1.0 / 0.7 / 0.4 / 0.2)", () => {
    const { trust } = getTheoremParamsV2();
    expect([trust.user, trust.assistant, trust.tool, trust.external]).toEqual([1.0, 0.7, 0.4, 0.2]);
    expect(trust.user).toBeGreaterThan(trust.assistant);
    expect(trust.assistant).toBeGreaterThan(trust.tool);
    expect(trust.tool).toBeGreaterThan(trust.external);
  });

  it("REFIT_KEYS are real, numeric config keys with no duplicates", () => {
    const cfg = getMemoryConfig() as unknown as Record<string, unknown>;
    expect(new Set(REFIT_KEYS).size).toBe(REFIT_KEYS.length);
    for (const key of REFIT_KEYS) {
      expect(typeof cfg[key], key).toBe("number");
    }
  });

  it("keys round-trip through brain_config", async () => {
    await BrainStore.saveConfig("explore_rate", "0.1");
    expect(getTheoremParamsV2().exploreRate).toBe(0.1);
    await BrainStore.saveConfig("explore_rate", "0.05");
  });

  it("live behavior is unchanged: v1 cut-off and candidates keep their defaults", () => {
    const cfg = getMemoryConfig();
    expect(cfg.retrieval_threshold).toBe(0.35);
    expect(cfg.fusion_candidate_cutoff).toBe(50);
    expect(cfg.w_mem_tokens).toBe(4096);
  });
});
