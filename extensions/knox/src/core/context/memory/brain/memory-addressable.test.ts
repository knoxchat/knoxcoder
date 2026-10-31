/**
 * MEM-07 — C_addr / C_use / Rec-ready metrics replace C_effective.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem07-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let calculateAddressableMemory: typeof import("./MemoryHierarchy.js").calculateAddressableMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ calculateAddressableMemory } = await import("./MemoryHierarchy.js"));
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
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_procedures");
  try {
    await db.exec("DELETE FROM brain_recipes");
  } catch {
    // Recipe table may be absent on a stripped fixture.
  }
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  try {
    await db.exec("DELETE FROM brain_metrics_snapshots");
  } catch {
    // Created on first snapshot.
  }
}

async function storedSemanticTokens(id: number): Promise<number> {
  const db = await BrainStore.get();
  const row = await db.get<{ tokens: number }>(
    `SELECT CAST((LENGTH(title) + LENGTH(content) + LENGTH(keywords)) / 4 AS INTEGER) AS tokens
     FROM brain_semantic WHERE id = ?`,
    [id],
  );
  return row?.tokens ?? 0;
}

function semanticTokens(title: string, content: string, keywords = ""): number {
  return Math.floor((title.length + content.length + keywords.length) / 4);
}

describe("MEM-07 addressable memory metrics", () => {
  it("C_addr is raw |M3|+|M4|+|M5| and is not W + tokens/rᵢ", async () => {
    await reset();
    await BrainManager.trackSession("mem07-session", "Hierarchy", testDir);
    const title = "Addressable fact";
    const content = "A stored leaf used to measure C_addr without compression ratios.";
    await BrainManager.store({
      category: "fact",
      title,
      content,
      importance: 0.8,
    });

    const hierarchy = await calculateAddressableMemory({
      activeSessionId: "mem07-session",
      workingMemoryTokens: 500,
    });
    expect(hierarchy.levels.find((l) => l.id === "M2")?.tokens).toBe(500);
    expect(hierarchy.c_addr).toBe(
      hierarchy.m3_tokens + hierarchy.m4_tokens + hierarchy.m5_tokens,
    );
    expect(hierarchy.m4_tokens).toBeGreaterThanOrEqual(semanticTokens(title, content));
    expect(hierarchy.c_addr).toBe(hierarchy.m3_tokens + hierarchy.m4_tokens + hierarchy.m5_tokens);
    expect(hierarchy.c_addr).not.toBe(500 + hierarchy.m4_tokens);

    const { resetRoutedWindow, resolveMemoryWindow } = await import("./window.js");
    resetRoutedWindow();
    const metrics = await BrainManager.getEffectiveContext();
    expect(metrics.c_addr).toBe(hierarchy.c_addr);
    expect(metrics.c_use).toBe(0);
    expect(metrics.w).toBe(resolveMemoryWindow().w);
    expect(metrics.w).toBeLessThan(BrainStore.getConfig().context_max_tokens);
    expect(metrics).not.toHaveProperty("total_effective");
    expect(metrics).not.toHaveProperty("hierarchy_effective_tokens");
    expect(metrics.c_addr).not.toBe(metrics.w + hierarchy.c_addr);
    expect(metrics.memory_levels?.find((l) => l.id === "M4")?.effective_tokens).toBe(
      metrics.memory_levels?.find((l) => l.id === "M4")?.tokens,
    );
  });

  it("tombstoned unlinked leaves drop out of C_addr", async () => {
    await reset();
    const title = "Forgettable fact";
    const content = "unlinked-leaf-token-body-for-c-addr";
    const memoryId = await BrainManager.store({
      category: "fact",
      title,
      content,
      importance: 0.7,
    });
    const before = await calculateAddressableMemory();
    const leafTokens = await storedSemanticTokens(memoryId);
    expect(before.m4_tokens).toBeGreaterThanOrEqual(leafTokens);

    await BrainManager.forget(memoryId);
    const afterForget = await calculateAddressableMemory();
    expect(afterForget.m4_tokens).toBe(before.m4_tokens - leafTokens);
    expect(afterForget.m5_tokens).toBe(before.m5_tokens);
    expect(afterForget.c_addr).toBe(before.c_addr - leafTokens);
  });

  it("C_use is last inject tokens and snapshots store C_addr not W+hierarchy", async () => {
    await reset();
    await BrainManager.store({
      category: "fact",
      title: "Snapshot fact",
      content: "enough tokens to make c_addr positive for the metrics snapshot.",
      importance: 0.6,
    });
    BrainManager.recordContextBuild(8000, 16000);
    const metrics = await BrainManager.getEffectiveContext();
    expect(metrics.c_use).toBe(8000);
    expect(metrics.last_context_tokens_used).toBe(8000);
    expect(metrics.c_addr).toBeGreaterThan(0);

    const id = await BrainManager.storeMetricsSnapshot();
    expect(id).toBeGreaterThan(0);
    const trend = await BrainManager.getMetricsTrend(24);
    expect(trend.snapshots[0].c_addr).toBe(metrics.c_addr);
    expect(trend.snapshots[0].c_use).toBe(8000);
    expect(trend.snapshots[0]).not.toHaveProperty("total_effective");
    expect(["improving", "stable", "degrading"]).toContain(trend.addressable_memory_trend);
  });
});
