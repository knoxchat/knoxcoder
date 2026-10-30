/**
 * MEM-18 — attribution drives U, FSRS, w_s, and calibrated θ.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-attr-refit-${Date.now()}`);

let Attribution: typeof import("./attribution.js").Attribution;
let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;
let Value: typeof import("./Value.js").Value;
let outcomes: typeof import("./memoryOutcomes.js");
let RecipeStore: typeof import("../recipes/RecipeStore.js").RecipeStore;
let applyReplayResult: typeof import("../recipes/feedback.js").applyReplayResult;
let recordRevert: typeof import("../recipes/feedback.js").recordRevert;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ Attribution } = await import("./attribution.js"));
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
  ({ Value } = await import("./Value.js"));
  outcomes = await import("./memoryOutcomes.js");
  ({ RecipeStore } = await import("../recipes/RecipeStore.js"));
  ({ applyReplayResult, recordRevert } = await import("../recipes/feedback.js"));

  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "global");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_attribution");
  await db.exec("DELETE FROM brain_memory_outcomes");
  await db.exec("DELETE FROM brain_recipe_steps");
  await db.exec("DELETE FROM brain_recipes");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
  await BrainStore.saveConfig("w_lexical", "1");
  await BrainStore.saveConfig("w_ripgrep", "1");
  await BrainStore.saveConfig("w_graph", "1");
  await BrainStore.saveConfig("w_tree", "1");
  await BrainStore.saveConfig("calibrated_theta", "0.35");
  await BrainStore.saveConfig("retrieval_threshold", "0.6");
}

async function semanticState(id: number): Promise<{
  helpful_count: number;
  unhelpful_count: number;
  stability: number;
  i0: number;
}> {
  const db = await BrainStore.get();
  const row = await db.get<{
    helpful_count: number;
    unhelpful_count: number;
    stability: number;
    i0: number;
  }>(
    "SELECT helpful_count, unhelpful_count, stability, i0 FROM brain_semantic WHERE id = ?",
    [id],
  );
  if (!row) throw new Error(`missing semantic ${id}`);
  return row;
}

describe("MEM-18 attribution refit (pure)", () => {
  it("picks the winning channel from lexical vs graph scores", () => {
    expect(outcomes.winningChannel({ fts5: 0.8, trigram: 0.2, graph: 0.1 })).toBe("lexical");
    expect(outcomes.winningChannel({ fts5: 0.1, graph: 0.6 })).toBe("graph");
    expect(outcomes.winningChannel({ channel: "tree" })).toBe("tree");
    expect(outcomes.winningChannel({})).toBeNull();
  });

  it("calibrates θ as P(helpful | injected) and ignores pending cites", () => {
    const rows = [
      { injected: 1, cited: 1, helpful: 1, channel: "lexical" },
      { injected: 1, cited: 1, helpful: 1, channel: "lexical" },
      { injected: 1, cited: 0, helpful: null, channel: "lexical" },
      { injected: 1, cited: 1, helpful: 0, channel: "graph" },
      { injected: 1, cited: 1, helpful: null, channel: "graph" },
    ].map((row, i) => ({
      id: i + 1,
      turn_id: `t${i}`,
      session_id: "s",
      mem_type: "semantic",
      mem_id: String(i + 1),
      created_at: null,
      score: 0.5,
      ...row,
    }));
    const calibrated = outcomes.calibrateTheta(rows);
    expect(calibrated).toEqual({ rate: 0.5, n: 4, helpful_n: 2 });

    const refit = outcomes.computeAttributionRefit(rows);
    expect(refit.theta_updated).toBe(false);
    expect(refit.channel_weights.lexical).toBeCloseTo(1.1, 8);
    expect(refit.channel_weights.graph).toBeCloseTo(0.95, 8);
    expect(refit.channel_weights.ripgrep).toBe(1);
    expect(refit.channel_weights.tree).toBe(1);
  });

  it("fits θ once the log has enough injected outcomes", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      turn_id: `t${i}`,
      session_id: "s",
      mem_type: "semantic",
      mem_id: String(i + 1),
      injected: 1,
      cited: i < 3 ? 1 : 0,
      helpful: i < 3 ? 1 : null,
      channel: "lexical",
      score: 0.4,
      created_at: null,
    }));
    const refit = outcomes.computeAttributionRefit(rows);
    expect(refit.calibration_n).toBe(10);
    expect(refit.helpful_rate).toBeCloseTo(0.3, 8);
    expect(refit.theta).toBeCloseTo(0.3, 8);
    expect(refit.theta_updated).toBe(true);
  });
});

describe("MEM-18 attribution drives U and recipe replay", () => {
  it("recordRecallOutcome increments h/u so U moves", async () => {
    await reset();
    await BrainManager.trackSession("s-u", "MEM-18 U", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "zephyrlint rule alpha",
      content: "zephyrlint rule alpha applies to imports",
      keywords: "zephyrlint",
      session_id: "s-u",
      importance: 0.5,
    });
    const before = Value.utilityFromSource(await semanticState(id));
    const db = await BrainStore.get();
    await outcomes.recordRecallOutcome(db, [id], "verified", { turnId: "outcome-ok" });
    const helped = await semanticState(id);
    expect(helped.helpful_count).toBe(1);
    expect(Value.utilityFromSource(helped)).toBeGreaterThan(before);

    await outcomes.recordRecallOutcome(db, [id], "reverted", { turnId: "outcome-bad" });
    const after = await semanticState(id);
    expect(after.unhelpful_count).toBe(1);
    expect(Value.utilityFromSource(after)).toBeLessThan(Value.utilityFromSource(helped));

    const row = await db.get<{ mem_type: string; helpful: number }>(
      "SELECT mem_type, helpful FROM brain_attribution WHERE turn_id = 'outcome-ok'",
    );
    expect(row).toEqual({ mem_type: "semantic", helpful: 1 });
  });

  it("recipe replay ok/revert writes attribution and feeds the linked memory", async () => {
    await reset();
    await BrainManager.trackSession("s-recipe", "MEM-18 recipe", testDir);
    const memoryId = await BrainManager.store({
      category: "workflow",
      title: "Create a Button component",
      content: "workflow for creating a Button component",
      keywords: "button,component",
      session_id: "s-recipe",
      importance: 0.5,
    });
    const db = await BrainStore.get();
    const store = new RecipeStore(db);
    const created = await store.create({
      projectId: "p",
      intentFingerprint: "create button mem18",
      steps: [{ kind: "write_file", path: "src/a.ts", blobHash: "h-new" }],
      oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z" },
    });
    await store.verify(created.recipe.id);
    await store.setMemoryId(created.recipe.id, memoryId);

    const before = await semanticState(memoryId);
    await applyReplayResult(store, {
      status: "applied",
      recipeId: created.recipe.id,
      restored: false,
      appliedPaths: [],
      driftedPaths: [],
      outcome: "ok",
    });
    const helped = await semanticState(memoryId);
    expect(helped.helpful_count).toBe(1);
    expect(helped.stability).toBeGreaterThan(before.stability);

    const recipeRow = await db.get<{ mem_type: string; mem_id: string; helpful: number }>(
      "SELECT mem_type, mem_id, helpful FROM brain_attribution WHERE mem_type = 'recipe'",
    );
    expect(recipeRow).toEqual({
      mem_type: "recipe",
      mem_id: created.recipe.id,
      helpful: 1,
    });

    await recordRevert(store, created.recipe.id, new Date());
    const after = await semanticState(memoryId);
    expect(after.unhelpful_count).toBe(1);
    expect(after.stability).toBeCloseTo(helped.stability * 0.3, 8);

    const revertRow = await db.get<{ helpful: number }>(
      "SELECT helpful FROM brain_attribution WHERE mem_type = 'recipe' AND helpful = 0",
    );
    expect(revertRow?.helpful).toBe(0);
  });

  it("persists the winning channel on a cited inject", async () => {
    await reset();
    const result = await Attribution.persistAttributionDecision({
      turn_id: "t-channel",
      session_id: "s-channel",
      cite: {
        type: "semantic",
        mem_id: "9",
        token: "[mem:semantic:9]",
        channel: "graph",
        score: 0.72,
      },
      injected: true,
      cited: true,
      helpful: true,
    });
    expect(result.applied).toBe("helpful");
    const db = await BrainStore.get();
    const row = await db.get<{ channel: string; score: number; helpful: number }>(
      "SELECT channel, score, helpful FROM brain_attribution WHERE turn_id = 't-channel'",
    );
    expect(row).toEqual({ channel: "graph", score: 0.72, helpful: 1 });
  });

  it("sleep φ₇ refits w_s and calibrated θ without flipping live retrieval_threshold", async () => {
    await reset();
    const db = await BrainStore.get();
    for (let i = 0; i < 6; i++) {
      await db.run(
        `INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected, cited, helpful, channel)
         VALUES (?, 'semantic', ?, 1, 1, 1, 'lexical')`,
        [`help-${i}`, String(i + 1)],
      );
    }
    for (let i = 0; i < 4; i++) {
      await db.run(
        `INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected, cited, helpful, channel)
         VALUES (?, 'semantic', ?, 1, 0, NULL, 'graph')`,
        [`miss-${i}`, String(i + 20)],
      );
    }
    await db.run(
      `INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected, cited, helpful, channel)
       VALUES ('bad-graph', 'semantic', '99', 1, 1, 0, 'graph')`,
    );

    const cycle = await SleepConsolidation.runCycle();
    expect(cycle.sub_phases.refit).toBe(11);
    expect(cycle.refit?.theta_updated).toBe(true);
    expect(cycle.refit?.channel_updated).toBe(true);
    expect(cycle.refit?.channel_weights.lexical).toBeCloseTo(1.3, 8);
    expect(cycle.refit?.channel_weights.graph).toBeCloseTo(0.95, 8);

    const cfg = BrainStore.getConfig();
    expect(cfg.w_lexical).toBeCloseTo(1.3, 8);
    expect(cfg.w_graph).toBeCloseTo(0.95, 8);
    expect(cfg.calibrated_theta).toBeCloseTo(6 / 11, 8);
    expect(cfg.retrieval_threshold).toBe(0.6);
    expect(cfg.w_ripgrep).toBe(1);
    expect(cfg.w_tree).toBe(1);
  });
});
