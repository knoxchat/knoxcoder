/**
 * MEM-15 — tiers from R and Value only.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-tiers-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let FiveTierHierarchy: typeof import("./advanced/fiveTierHierarchy.js").FiveTierHierarchy;
let Forgetting: typeof import("./Forgetting.js").Forgetting;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;
let Tiers: typeof import("./Tiers.js").Tiers;
let Value: typeof import("./Value.js").Value;

const THEOREM = { F: 19 / 81, c: 0.5, pruneThreshold: 0.1, reviewThreshold: 0.5 };
const TIER = { archiveThreshold: 0.05, forgetting: THEOREM };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ FiveTierHierarchy } = await import("./advanced/fiveTierHierarchy.js"));
  ({ Forgetting } = await import("./Forgetting.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
  ({ Tiers } = await import("./Tiers.js"));
  ({ Value } = await import("./Value.js"));

  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
  BrainManager.getWorkingMemory().clear();
}

async function fusionHits(query: string, id: number, type: "semantic" | "episodic"): Promise<boolean> {
  const hits = await RetrievalFusion.search({
    query,
    includeEpisodic: type === "episodic",
    limit: 20,
  });
  return hits.some((h) => h.type === type && h.id === id);
}

describe("MEM-15 tiers from R and Value only", () => {
  it("R bands are hot ≥0.9, warm ≥0.7, cold ≥0.3, else frozen", () => {
    expect(Tiers.TIER_R_HOT).toBe(0.9);
    expect(Tiers.TIER_R_WARM).toBe(0.7);
    expect(Tiers.TIER_R_COLD).toBe(0.3);
    expect(Tiers.classifyRankedTier(0.9, 0.9, 0.05)).toBe("hot");
    expect(Tiers.classifyRankedTier(0.89, 0.8, 0.05)).toBe("warm");
    expect(Tiers.classifyRankedTier(0.7, 0.7, 0.05)).toBe("warm");
    expect(Tiers.classifyRankedTier(0.69, 0.5, 0.05)).toBe("cold");
    expect(Tiers.classifyRankedTier(0.3, 0.3, 0.05)).toBe("cold");
    expect(Tiers.classifyRankedTier(0.29, 0.2, 0.05)).toBe("frozen");
  });

  it("Value < θ_arch freezes even when R is high", () => {
    expect(Tiers.classifyRankedTier(1, 0.049, 0.05)).toBe("frozen");
    expect(Tiers.classifyRankedTier(1, 0.05, 0.05)).toBe("hot");
    expect(Tiers.classifyMemoryTier(
      { stability: 14, i0: 0.04, last_accessed_at: daysAgo(0) },
      undefined,
      TIER,
    )).toBe("frozen");
  });

  it("theorem worked example maps to hot / warm / frozen", () => {
    expect(Forgetting.retrievability(1, 1, THEOREM)).toBeCloseTo(0.9, 5);
    expect(Forgetting.retrievability(4.4, 1, THEOREM)).toBeCloseTo(0.7, 2);
    expect(Forgetting.retrievability(43, 1, THEOREM)).toBeCloseTo(0.3, 2);
    expect(Tiers.classifyMemoryTier(
      { stability: 1, category: "episodic", i0: 1, created_at: daysAgo(1) },
      undefined,
      TIER,
    )).toBe("hot");
    expect(Tiers.classifyMemoryTier(
      { stability: 1, category: "episodic", i0: 1, created_at: daysAgo(4.4) },
      undefined,
      TIER,
    )).toBe("warm");
    expect(Tiers.classifyMemoryTier(
      { stability: 1, category: "episodic", i0: 1, created_at: daysAgo(43) },
      undefined,
      TIER,
    )).toBe("cold");
    expect(Tiers.classifyMemoryTier(
      { stability: 1, category: "episodic", i0: 1, created_at: daysAgo(50) },
      undefined,
      TIER,
    )).toBe("frozen");
  });

  it("WM marks Active; pin never stores Frozen", () => {
    const stale = {
      stability: 1,
      category: "fact",
      i0: 0.2,
      last_accessed_at: daysAgo(500),
    };
    expect(Tiers.classifyMemoryTier(stale, undefined, TIER)).toBe("frozen");
    expect(Tiers.classifyMemoryTier(stale, { pinned: true }, TIER)).toBe("cold");
    expect(Tiers.classifyMemoryTier(stale, { inWorkingMemory: true, pinned: true }, TIER)).toBe("active");
    expect(Tiers.workingMemoryLeafRef({
      id: "semantic:42",
      source: "semantic",
    })).toEqual({ kind: "semantic", id: 42 });
  });

  it("clock knobs are unused leftovers", async () => {
    await reset();
    await BrainStore.saveConfig("hot_to_warm_hours", "1");
    await BrainStore.saveConfig("warm_to_cold_days", "1");
    await BrainStore.saveConfig("cold_prune_days", "1");

    const sessionId = "mem15-clock";
    await BrainManager.trackSession(sessionId, "MEM-15 clock", testDir);
    const id = await BrainManager.store({
      category: "decision",
      title: "Clock knobs unused",
      content: "This decision stays hot because last access is now, not because of age clocks.",
      keywords: "clockknobsmem15",
      importance: 0.8,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET created_at = datetime('now', '-400 days') WHERE id = ?`,
      [id],
    );

    await BrainStore.consolidate();
    const row = await BrainStore.getSemanticById(id);
    expect(row?.tier).toBe("hot");
    expect(row?.tombstoned_at).toBeNull();
  });

  it("sleep recomputes R/Value tiers and does not tombstone", async () => {
    await reset();
    const sessionId = "mem15-sleep";
    const token = "mem15sleeptierleaf";
    await BrainManager.trackSession(sessionId, "MEM-15 sleep", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      `Aged leftover about ${token} should freeze, not delete.`,
      12,
      0.2,
    );
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic SET created_at = datetime('now', '-91 days'), stability = 1 WHERE id = ?`,
      [id],
    );

    const cycle = await SleepConsolidation.runCycle();
    expect(cycle.pruned).toBe(0);
    const row = (await db.get(
      "SELECT tier, tombstoned_at, content FROM brain_episodic WHERE id = ?",
      [id],
    )) as { tier: string; tombstoned_at: string | null; content: string };
    expect(row.tier).toBe("frozen");
    expect(row.tombstoned_at).toBeNull();
    expect(row.content).toContain(token);
    expect(await fusionHits(token, id, "episodic")).toBe(false);
  });

  it("WM leaf becomes Active on recompute; attribution helper writes one row", async () => {
    await reset();
    const sessionId = "mem15-active";
    await BrainManager.trackSession(sessionId, "MEM-15 active", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "WM active fact",
      content: "A fact currently held in working memory.",
      keywords: "wmmem15active",
      importance: 0.8,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic
       SET last_accessed_at = datetime('now', '-91 days'), stability = 1, i0 = 0.2, importance_score = 0.2
       WHERE id = ?`,
      [id],
    );

    await BrainStore.recomputeMemoryTiers();
    expect((await BrainStore.getSemanticById(id))?.tier).toBe("frozen");

    BrainManager.getWorkingMemory().add({
      id: `semantic:${id}`,
      source: "semantic",
      content: "A fact currently held in working memory.",
      relevance: 0.9,
    });
    await BrainStore.recomputeMemoryTiers();
    expect((await BrainStore.getSemanticById(id))?.tier).toBe("active");

    BrainManager.getWorkingMemory().clear();
    const next = await BrainStore.applyMemoryTier("semantic", id);
    expect(next).toBe("frozen");
    expect(Value.shouldArchiveByValue(await BrainStore.getSemanticById(id))).toBe(true);
  });

  it("five-tier consolidate uses R/Value and keeps a frozen leaf", async () => {
    await reset();
    const sessionId = "mem15-five";
    const token = "mem15fivetierleaf";
    await BrainManager.trackSession(sessionId, "MEM-15 five", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      `Deep archive mention of ${token} stays on disk.`,
      10,
      0.05,
    );
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic SET created_at = datetime('now', '-400 days'), stability = 1 WHERE id = ?`,
      [id],
    );

    const result = await FiveTierHierarchy.consolidate();
    expect(result.pruned).toBe(0);
    const row = (await db.get(
      "SELECT tier, tombstoned_at FROM brain_episodic WHERE id = ?",
      [id],
    )) as { tier: string; tombstoned_at: string | null };
    expect(row.tier).toBe("frozen");
    expect(row.tombstoned_at).toBeNull();
  });
});
