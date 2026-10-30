/**
 * MEM-13 — bounded utility U and Value = R·U.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-value-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Forgetting: typeof import("./Forgetting.js").Forgetting;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let Value: typeof import("./Value.js").Value;

const THEOREM = { F: 19 / 81, c: 0.5, pruneThreshold: 0.1, reviewThreshold: 0.5 };
const VALUE = { kappa: 5, archiveThreshold: 0.05, forgetting: THEOREM };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Forgetting } = await import("./Forgetting.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
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
}

async function fusionHits(query: string, id: number, type: "semantic" | "episodic" = "semantic"): Promise<boolean> {
  const hits = await RetrievalFusion.search({
    query,
    includeEpisodic: type === "episodic",
    limit: 20,
  });
  return hits.some((h) => h.type === type && h.id === id);
}

describe("MEM-13 bounded utility U and Value = R·U", () => {
  it("defaults are κ=5 and θ_arch=0.05", () => {
    const p = Value.getValueParams();
    expect(p.kappa).toBe(5);
    expect(p.archiveThreshold).toBe(0.05);
    expect(Value.UTILITY_KAPPA_DEFAULT).toBe(5);
    expect(Value.ARCHIVE_VALUE_THRESHOLD).toBe(0.05);
  });

  it("h=u=0 → U=I₀ (prior only until MEM-17)", () => {
    expect(Value.utility(0, 0, 0.8, 5)).toBeCloseTo(0.8, 10);
    expect(Value.utilityFromSource({ i0: 0.6, helpful_count: 0, unhelpful_count: 0 }, VALUE)).toBeCloseTo(0.6, 10);
    expect(Value.utilityFromSource({ importance_score: 0.4 }, VALUE)).toBeCloseTo(0.4, 10);
  });

  it("U=(h+κ I₀)/(h+u+κ) and clamps to [0,1]", () => {
    expect(Value.utility(2, 8, 1, 5)).toBeCloseTo(7 / 15, 10);
    expect(Value.utility(0, 0, 2, 5)).toBe(1);
    expect(Value.utility(0, 0, -1, 5)).toBe(0);
    expect(Value.utility(-3, -2, 0.5, 5)).toBeCloseTo(0.5, 10);
    expect(Value.utility(100, 0, 1, 5)).toBe(1);
    expect(Value.utility(0, 100, 1, 5)).toBeCloseTo(5 / 105, 10);
  });

  it("Value = R·U and stays in [0,1]", () => {
    const r = Forgetting.retrievability(1, 1, THEOREM);
    expect(r).toBeCloseTo(0.9, 5);
    expect(Value.memoryValue(1, 1, 0.8, VALUE)).toBeCloseTo(r * 0.8, 10);
    expect(Value.memoryValueFromSource({
      i0: 0.8,
      stability: 1,
      last_accessed_at: daysAgo(1),
      helpful_count: 0,
      unhelpful_count: 0,
    }, VALUE)).toBeCloseTo(r * 0.8, 5);
    expect(Value.memoryValue(0, 1, 1.4, VALUE)).toBe(1);
    expect(Value.memoryValue(1, 1, 0, VALUE)).toBe(0);
  });

  it("archives when Value < θ_arch=0.05, not when Value ≥ θ_arch", () => {
    const freshLow = { i0: 0.01, stability: 14, last_accessed_at: daysAgo(0), helpful_count: 0, unhelpful_count: 0 };
    const freshHigh = { i0: 0.8, stability: 14, last_accessed_at: daysAgo(0), helpful_count: 0, unhelpful_count: 0 };
    const unhelpful = { i0: 1, stability: 14, last_accessed_at: daysAgo(0), helpful_count: 0, unhelpful_count: 100 };
    expect(Value.memoryValueFromSource(freshLow, VALUE)).toBeLessThan(0.05);
    expect(Value.shouldArchiveByValue(freshLow, VALUE)).toBe(true);
    expect(Value.isDefaultRetrieveValue(freshLow, undefined, VALUE)).toBe(false);
    expect(Value.shouldArchiveByValue(freshHigh, VALUE)).toBe(false);
    expect(Value.shouldArchiveByValue(unhelpful, VALUE)).toBe(true);
    expect(Value.isDefaultRetrieveValue(freshLow, { pinned: true }, VALUE)).toBe(true);
  });

  it("insert keeps h=u=0 so U=I₀", async () => {
    await reset();
    const sessionId = "mem13-insert";
    await BrainManager.trackSession(sessionId, "MEM-13 insert", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Value prior",
      content: "The quartzvalueinsertleaf fact is stored with I₀ only.",
      importance: 0.7,
      session_id: sessionId,
    });
    const row = await BrainStore.getSemanticById(id);
    expect(row).toMatchObject({ i0: 0.7, helpful_count: 0, unhelpful_count: 0 });
    expect(Value.utilityFromSource(row, VALUE)).toBeCloseTo(0.7, 10);
    expect(Value.shouldArchiveByValue(row, VALUE)).toBe(false);
  });

  it("default fusion skips Value < θ_arch but keeps the row (no DELETE)", async () => {
    await reset();
    const sessionId = "mem13-fusion";
    const token = "quartzvalueleafabc";
    await BrainManager.trackSession(sessionId, "MEM-13 fusion", testDir);
    const keepId = await BrainManager.store({
      category: "fact",
      title: `Keep ${token}`,
      content: `This document is about ${token} and should stay in retrieve.`,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });
    const archiveId = await BrainManager.store({
      category: "fact",
      title: `Archive ${token}`,
      content: `This document is about ${token} and should archive by Value.`,
      keywords: token,
      importance: 0.01,
      session_id: sessionId,
    });

    expect(await fusionHits(token, keepId)).toBe(true);
    expect(await fusionHits(token, archiveId)).toBe(false);

    const archived = await BrainStore.getSemanticById(archiveId);
    expect(archived).toBeTruthy();
    expect(archived?.content).toContain(token);
    expect(archived?.tombstoned_at).toBeFalsy();
    expect(archived?.i0).toBe(0.01);
    expect(Value.shouldArchiveByValue(archived, VALUE)).toBe(true);
  });

  it("pinned low-Value memory stays in default retrieve", async () => {
    await reset();
    const sessionId = "mem13-pin";
    const token = "quartzvaluepinleaf";
    await BrainManager.trackSession(sessionId, "MEM-13 pin", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: `Pinned ${token}`,
      content: `User pinned ${token} despite a tiny I₀.`,
      keywords: token,
      importance: 0.01,
      session_id: sessionId,
    });
    expect(await fusionHits(token, id)).toBe(false);
    expect(await BrainManager.pinMemory(id)).toBe(true);
    expect(await fusionHits(token, id)).toBe(true);
    const row = await BrainStore.getSemanticById(id);
    expect(row?.tombstoned_at).toBeFalsy();
  });
});
