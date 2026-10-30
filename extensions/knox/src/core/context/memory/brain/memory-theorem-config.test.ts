/**
 * MEM-02: theorem parameter table is stored and readable without flipping live retrieval.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-theorem-config-${Date.now()}`);

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let getTheoremParams: typeof import("./memoryConfigAccess.js").getTheoremParams;
let getMemoryInjectHardCap: typeof import("./memoryConfigAccess.js").getMemoryInjectHardCap;
let MEMORY_INJECT_HARD_CAP_TOKENS: typeof import("./memoryConfigAccess.js").MEMORY_INJECT_HARD_CAP_TOKENS;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ getTheoremParams, getMemoryInjectHardCap, MEMORY_INJECT_HARD_CAP_TOKENS } = await import(
    "./memoryConfigAccess.js"
  ));
  await BrainStore.get();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("MEM-02 theorem parameter table", () => {
  it("defaults match the revised Knox-MS table including live fused-candidate / θ knobs", async () => {
    await BrainStore.reloadConfig();
    const cfg = BrainStore.getConfig();
    const theorem = getTheoremParams();

    expect(theorem.forgettingF).toBeCloseTo(19 / 81, 10);
    expect(theorem.forgettingC).toBe(0.5);
    expect(theorem.fsrsA).toBeCloseTo(Math.exp(1.5), 10);
    expect(theorem.fsrsB).toBe(0.2);
    expect(theorem.fsrsG).toBe(1);
    expect(theorem.utilityKappa).toBe(5);
    expect(theorem.archiveValueThreshold).toBe(0.05);
    expect(theorem.rrfK0).toBe(60);
    expect(theorem.etaUtility).toBe(0.5);
    expect(theorem.etaRetrievability).toBe(0.3);
    expect(theorem.treeBranchingB).toBe(8);
    expect(theorem.treeBeamB).toBe(4);
    expect(theorem.coverageLambda).toBe(0.5);
    expect(theorem.wMemTokens).toBe(4096);
    expect(theorem.fusionCandidateCutoff).toBe(50);
    expect(theorem.calibratedTheta).toBe(0.35);
    expect(theorem.pprAlpha).toBeCloseTo(0.15, 10);
    expect(theorem.pprEpsilon).toBeCloseTo(1e-4, 10);
    expect(theorem.channelWeights).toEqual({ lexical: 1, ripgrep: 1, graph: 1, tree: 1 });

    expect(cfg.retrieval_threshold).toBe(0.35);
    expect(cfg.calibrated_theta).toBe(0.35);
    expect(cfg.retrieval_top_k).toBe(50);
    expect(cfg.ebbinghaus_lambda).toBe(0.03);
    expect(getMemoryInjectHardCap()).toBe(MEMORY_INJECT_HARD_CAP_TOKENS);
    expect(MEMORY_INJECT_HARD_CAP_TOKENS).toBe(8000);
  });

  it("persists theorem keys through brain_config reload", async () => {
    await BrainStore.saveConfig("forgetting_c", "0.75");
    await BrainStore.saveConfig("w_lexical", "1.5");
    await BrainStore.reloadConfig();
    const theorem = getTheoremParams();
    expect(theorem.forgettingC).toBe(0.75);
    expect(theorem.channelWeights.lexical).toBe(1.5);
    expect(BrainStore.getConfig().retrieval_top_k).toBe(50);

    await BrainStore.saveConfig("forgetting_c", "0.5");
    await BrainStore.saveConfig("w_lexical", "1");
  });
});
