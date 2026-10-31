/**
 * MEM-14 — FSRS strengthen only on use.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-fsrs-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Fsrs: typeof import("./Fsrs.js").Fsrs;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let SpacedRepetition: typeof import("./AdvancedFeatures.js").SpacedRepetition;

const FSRS = { a: Math.exp(1.5), b: 0.2, g: 1 };

function expectedSPrime(s: number, d: number, r: number): number {
  return s * (1 + FSRS.a * (11 - d) * s ** -FSRS.b * (Math.exp(FSRS.g * (1 - r)) - 1));
}

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Fsrs } = await import("./Fsrs.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ SpacedRepetition } = await import("./AdvancedFeatures.js"));

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

async function semanticState(id: number): Promise<{
  stability: number;
  difficulty: number;
  importance_score: number;
  retrieval_count: number;
}> {
  const db = await BrainStore.get();
  const row = await db.get<{
    stability: number;
    difficulty: number;
    importance_score: number;
    retrieval_count: number;
  }>(
    "SELECT stability, difficulty, importance_score, retrieval_count FROM brain_semantic WHERE id = ?",
    [id],
  );
  if (!row) throw new Error(`missing semantic ${id}`);
  return row;
}

describe("MEM-14 FSRS strengthen only on use", () => {
  it("defaults are a=e^1.5, b=0.2, g=1", () => {
    const p = Fsrs.getFsrsParams();
    expect(p.a).toBeCloseTo(Math.exp(1.5), 10);
    expect(p.b).toBe(0.2);
    expect(p.g).toBe(1);
    expect(Fsrs.FSRS_A_DEFAULT).toBeCloseTo(Math.exp(1.5), 10);
    expect(Fsrs.FSRS_HARMFUL_STABILITY_FACTOR).toBe(0.3);
  });

  it("S' = S · (1 + a (11-D) S^{-b} (e^{g(1-R)} − 1))", () => {
    const s = 14;
    const d = 5;
    const r = 0.7;
    expect(Fsrs.nextStability(s, d, r, FSRS)).toBeCloseTo(expectedSPrime(s, d, r), 10);
    expect(Fsrs.nextStability(s, d, 1, FSRS)).toBeCloseTo(s, 10);
    expect(Fsrs.nextStability(s, d, 0.3, FSRS)).toBeGreaterThan(Fsrs.nextStability(s, d, 0.9, FSRS));
  });

  it("used+helpful → S ← S'; used+harmful → 0.3S and D ← min(10, D+1); unused → no change", () => {
    const s = 14;
    const d = 5;
    const r = 0.5;
    const helpful = Fsrs.applyFsrs(s, d, r, "helpful", FSRS);
    expect(helpful.stability).toBeCloseTo(expectedSPrime(s, d, r), 10);
    expect(helpful.difficulty).toBe(5);

    const harmful = Fsrs.applyFsrs(s, d, r, "harmful", FSRS);
    expect(harmful.stability).toBeCloseTo(s * 0.3, 10);
    expect(harmful.difficulty).toBe(6);

    const capped = Fsrs.applyFsrs(s, 10, r, "harmful", FSRS);
    expect(capped.difficulty).toBe(10);

    const unused = Fsrs.applyFsrs(s, d, r, "unused", FSRS);
    expect(unused).toEqual({ stability: s, difficulty: d });
  });

  it("persist used+helpful / used+harmful writes S and D; unused does not", async () => {
    await reset();
    const sessionId = "mem14-persist";
    await BrainManager.trackSession(sessionId, "MEM-14 persist", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "FSRS persist",
      content: "The quartzfsrspersistleaf fact starts at S₀=14.",
      importance: 0.8,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET last_accessed_at = datetime('now', '-10 days') WHERE id = ?`,
      [id],
    );

    const before = await semanticState(id);
    expect(before.stability).toBe(14);
    expect(before.difficulty).toBe(5);

    const unused = await SpacedRepetition.applyOnUse(id, "unused");
    expect(unused).toEqual({ stability: 14, difficulty: 5 });
    expect(await semanticState(id)).toMatchObject({ stability: 14, difficulty: 5, importance_score: 0.8 });

    const helpful = await SpacedRepetition.applyOnUse(id, "helpful");
    expect(helpful).toBeTruthy();
    expect(helpful!.stability).toBeGreaterThan(14);
    expect(helpful!.difficulty).toBe(5);
    const afterHelpful = await semanticState(id);
    expect(afterHelpful.stability).toBeCloseTo(helpful!.stability, 10);
    expect(afterHelpful.difficulty).toBe(5);
    expect(afterHelpful.importance_score).toBeCloseTo(0.8, 5);

    const aged = afterHelpful.stability;
    const harmful = await SpacedRepetition.applyOnUse(id, "harmful");
    expect(harmful!.stability).toBeCloseTo(aged * 0.3, 10);
    expect(harmful!.difficulty).toBe(6);
    expect((await semanticState(id)).difficulty).toBe(6);
  });

  it("recall and fusion retrieve do not raise S", async () => {
    await reset();
    const sessionId = "mem14-retrieve";
    const token = "quartzfsrsretrieveleaf";
    await BrainManager.trackSession(sessionId, "MEM-14 retrieve", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: `Login ${token}`,
      content: `The ${token} service stores login facts for the session module.`,
      keywords: token,
      importance: 0.7,
      session_id: sessionId,
    });

    for (let i = 0; i < 8; i++) {
      await BrainManager.recall({ query: token, session_id: sessionId, include_episodic: false });
      await RetrievalFusion.search({ query: token, includeEpisodic: false, limit: 10 });
    }

    const row = await semanticState(id);
    expect(row.stability).toBe(14);
    expect(row.difficulty).toBe(5);
    expect(row.importance_score).toBeCloseTo(0.7, 5);
  });

  it("retrieve does not write S, D, I, or retrieval_count", async () => {
    await reset();
    const id = await BrainManager.store({
      category: "fact",
      title: "No retrieve boost",
      content: "quartzfsrsboostleaf leftover retrieve must not strengthen.",
      importance: 0.4,
    });
    const before = await semanticState(id);
    await RetrievalFusion.search({
      query: "quartzfsrsboostleaf leftover retrieve must not strengthen",
      includeEpisodic: false,
      limit: 10,
    });
    expect(await semanticState(id)).toEqual(before);
  });

  it("episodic used+harmful writes S and D", async () => {
    await reset();
    const sessionId = "mem14-epi";
    await BrainManager.trackSession(sessionId, "MEM-14 episodic", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      "quartzfirsepi leaf about a bad citation.",
      10,
      0.4,
    );
    const next = await BrainStore.applyMemoryFsrs("episodic", id, "harmful");
    expect(next).toEqual({ stability: 0.3, difficulty: 6 });
    const db = await BrainStore.get();
    const row = await db.get<{ stability: number; difficulty: number }>(
      "SELECT stability, difficulty FROM brain_episodic WHERE id = ?",
      [id],
    );
    expect(row).toEqual({ stability: 0.3, difficulty: 6 });
  });
});
