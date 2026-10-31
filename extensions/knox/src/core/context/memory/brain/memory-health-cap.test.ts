/**
 * Disk valve default (1 GiB) and leftover hot-count handling (MEM-15).
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-health-cap-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let BRAIN_DEFAULT_MAX_BYTES: typeof import("./store/dbSafety.js").BRAIN_DEFAULT_MAX_BYTES;
let applyBrainMaxBytesSetting: typeof import("./store/dbSafety.js").applyBrainMaxBytesSetting;
let brainMaxBytes: typeof import("./store/dbSafety.js").brainMaxBytes;
let Tiers: typeof import("./Tiers.js").Tiers;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  delete process.env.KNOX_BRAIN_MAX_BYTES;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ BRAIN_DEFAULT_MAX_BYTES, applyBrainMaxBytesSetting, brainMaxBytes } = await import("./store/dbSafety.js"));
  ({ Tiers } = await import("./Tiers.js"));

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
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
  BrainManager.getWorkingMemory().clear();
  BrainStore.resetStaleTierRecomputeForTests();
}

describe("memory health cap and leftover hot quota", () => {
  it("defaults max_bytes to 1 GiB and does not alarm on leftover 100MB / 500-hot knobs", async () => {
    await reset();
    expect(BRAIN_DEFAULT_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(brainMaxBytes()).toBe(1024 * 1024 * 1024);

    const sessionId = "health-cap-hot";
    await BrainManager.trackSession(sessionId, "health cap", testDir);
    for (let i = 0; i < 12; i++) {
      await BrainStore.addEpisodic(sessionId, "user_message", "user", `fresh turn ${i}`, 8, 0.5);
    }
    const health = await BrainStore.getHealth();
    expect(health.issues.some((issue) => /100MB/i.test(issue))).toBe(false);
    expect(health.issues.some((issue) => /too many hot/i.test(issue))).toBe(false);
    expect(health.issues.some((issue) => /haven't been accessed/i.test(issue))).toBe(false);
  });

  it("low-Value inserts classify as frozen instead of DEFAULT hot", async () => {
    await reset();
    expect(Tiers.classifyInsertTier({ importance_score: 0.01, i0: 0.01, stability: 1, category: "episodic" })).toBe(
      "frozen",
    );
    expect(Tiers.classifyInsertTier({ importance_score: 0.8, i0: 0.8, stability: 14, category: "fact" })).toBe("hot");

    const sessionId = "health-cap-insert";
    await BrainManager.trackSession(sessionId, "insert tier", testDir);
    const frozenId = await BrainStore.addEpisodic(sessionId, "user_message", "user", "tiny value turn", 4, 0.01);
    const hotId = await BrainStore.addEpisodic(sessionId, "user_message", "user", "normal turn", 4, 0.5);
    const db = await BrainStore.get();
    const frozen = (await db.get("SELECT tier FROM brain_episodic WHERE id = ?", [frozenId])) as { tier: string };
    const hot = (await db.get("SELECT tier FROM brain_episodic WHERE id = ?", [hotId])) as { tier: string };
    expect(frozen.tier).toBe("frozen");
    expect(hot.tier).toBe("hot");
  });

  it("getHealth recomputes leftover DEFAULT-hot labels from live R/Value", async () => {
    await reset();
    const sessionId = "health-cap-stale";
    await BrainManager.trackSession(sessionId, "stale hot", testDir);
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(await BrainStore.addEpisodic(sessionId, "user_message", "user", `old turn ${i} stalehot`, 8, 0.5));
    }
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET created_at = datetime('now', '-60 days'),
           stability = 1,
           tier = 'hot'
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );

    const health = await BrainStore.getHealth();
    expect(health.issues.some((issue) => /too many hot/i.test(issue))).toBe(false);
    const stillHot = (await db.get(
      "SELECT COUNT(*) AS n FROM brain_episodic WHERE tier = 'hot'",
    )) as { n: number };
    expect(stillHot.n).toBe(0);
  });

  it("heal rebalance_tiers uses R/Value instead of a recency hot quota", async () => {
    await reset();
    const sessionId = "health-cap-rebalance";
    await BrainManager.trackSession(sessionId, "rebalance", testDir);
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(await BrainStore.addEpisodic(sessionId, "user_message", "user", `rebalance turn ${i}`, 8, 0.5));
    }
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET created_at = datetime('now', '-60 days'),
           stability = 1,
           tier = 'hot'
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    const healed = await BrainManager.runHealingAction("rebalance_tiers");
    expect(healed.details).toMatch(/R\/Value/);
    expect(healed.success).toBe(true);
    const stillHot = (await db.get(
      "SELECT COUNT(*) AS n FROM brain_episodic WHERE tier = 'hot'",
    )) as { n: number };
    expect(stillHot.n).toBe(0);
  });

  it("health size alarm compares against max_bytes, not 100MB", async () => {
    await reset();
    const prevEnv = process.env.KNOX_BRAIN_MAX_BYTES;
    delete process.env.KNOX_BRAIN_MAX_BYTES;
    applyBrainMaxBytesSetting(1);
    try {
      const health = await BrainStore.getHealth();
      expect(health.issues.some((issue) => issue.includes("max_bytes"))).toBe(true);
      expect(health.issues.some((issue) => /100MB/i.test(issue))).toBe(false);
    } finally {
      applyBrainMaxBytesSetting(BRAIN_DEFAULT_MAX_BYTES);
      if (prevEnv === undefined) delete process.env.KNOX_BRAIN_MAX_BYTES;
      else process.env.KNOX_BRAIN_MAX_BYTES = prevEnv;
    }
  });
});
