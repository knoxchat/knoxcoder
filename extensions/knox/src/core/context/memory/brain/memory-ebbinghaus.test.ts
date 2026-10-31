/**
 * MEM-12 — power-law forgetting + category S₀ (and leftover I(m,t) helpers).
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-ebbinghaus-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Ebbinghaus: typeof import("./Ebbinghaus.js").Ebbinghaus;
let Forgetting: typeof import("./Forgetting.js").Forgetting;

const THEOREM = { F: 19 / 81, c: 0.5, pruneThreshold: 0.1, reviewThreshold: 0.5 };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Ebbinghaus } = await import("./Ebbinghaus.js"));
  ({ Forgetting } = await import("./Forgetting.js"));

  await BrainStore.get();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function resetDatabase(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
}

describe("MEM-12 power-law forgetting + category S₀", () => {
  it("uses theorem defaults F=19/81, c=0.5 and leftover prune/review knobs", () => {
    const p = Ebbinghaus.getEbbinghausParams();
    expect(p.forgettingF).toBeCloseTo(19 / 81, 10);
    expect(p.forgettingC).toBe(0.5);
    expect(p.lambda).toBe(0.03);
    expect(p.pruneThreshold).toBe(0.1);
    expect(p.reviewThreshold).toBe(0.5);
  });

  it("episodic S=1, no reinforcement: R(1d)≈0.9, R(4.4d)≈0.7, R(43d)≈0.3", () => {
    expect(Forgetting.retrievability(1, 1, THEOREM)).toBeCloseTo(0.9, 5);
    expect(Forgetting.retrievability(4.4, 1, THEOREM)).toBeCloseTo(0.7, 2);
    expect(Forgetting.retrievability(43, 1, THEOREM)).toBeCloseTo(0.3, 2);
    expect(Ebbinghaus.retention(daysAgo(1), 1, { ...Ebbinghaus.getEbbinghausParams(), forgettingF: THEOREM.F, forgettingC: THEOREM.c })).toBeCloseTo(0.9, 2);
  });

  it("S₀ is category-based", () => {
    expect(Forgetting.initialStability("episodic")).toBe(1);
    expect(Forgetting.initialStability("fact")).toBe(14);
    expect(Forgetting.initialStability("error_fix")).toBe(14);
    expect(Forgetting.initialStability("code_pattern")).toBe(14);
    expect(Forgetting.initialStability("preference")).toBe(30);
    expect(Forgetting.initialStability("workflow")).toBe(30);
    expect(Forgetting.initialStability("decision")).toBe(60);
    expect(Forgetting.initialStability("project_context")).toBe(60);
    expect(Forgetting.initialStability("summary")).toBe(14);
    expect(Forgetting.initialStability("insight")).toBe(14);
    expect(Forgetting.initialStability("summary", { linkedAsTreeNode: true, inheritStability: 60 })).toBe(60);
    expect(Forgetting.resolveStability(null, "fact")).toBe(14);
    expect(Forgetting.resolveStability(0, "decision")).toBe(60);
    expect(Forgetting.clampStability(0)).toBe(Forgetting.STABILITY_EPSILON);
    expect(Forgetting.retrievability(10, 0, THEOREM)).toBeGreaterThan(0);
    expect(Forgetting.retrievability(10, 0, THEOREM)).toBeLessThan(1);
  });

  it("does not use outcomeFactor as R", () => {
    const r = Forgetting.retrievability(1, 1, THEOREM);
    expect(r).toBeCloseTo(0.9, 5);
    expect(Ebbinghaus.outcomeFactor(3, 0)).toBeGreaterThan(1);
    expect(Ebbinghaus.outcomeFactor(0, 2)).toBeLessThan(1);
    expect(r).not.toBe(Ebbinghaus.outcomeFactor(3, 0));
  });

  it("insert sets stability=S₀, difficulty=5, i0=importance", async () => {
    await resetDatabase();
    const sessionId = "mem12-insert";
    await BrainManager.trackSession(sessionId, "MEM-12 insert", testDir);

    const factId = await BrainManager.store({
      category: "fact",
      title: "Auth uses JWT",
      content: "The auth service issues JWT access tokens.",
      importance: 0.8,
      session_id: sessionId,
    });
    const decisionId = await BrainManager.store({
      category: "decision",
      title: "Use bun",
      content: "We decided to use bun for the package manager.",
      importance: 0.6,
      session_id: sessionId,
    });
    const epiId = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      "Remember the quartzleaf turn about JWT.",
      12,
      0.4,
    );

    const db = await BrainStore.get();
    const fact = await db.get<{ stability: number; difficulty: number; i0: number }>(
      "SELECT stability, difficulty, i0 FROM brain_semantic WHERE id = ?",
      [factId],
    );
    const decision = await db.get<{ stability: number; difficulty: number; i0: number }>(
      "SELECT stability, difficulty, i0 FROM brain_semantic WHERE id = ?",
      [decisionId],
    );
    const epi = await db.get<{ stability: number; difficulty: number; i0: number }>(
      "SELECT stability, difficulty, i0 FROM brain_episodic WHERE id = ?",
      [epiId],
    );

    expect(fact).toEqual({ stability: 14, difficulty: 5, i0: 0.8 });
    expect(decision).toEqual({ stability: 60, difficulty: 5, i0: 0.6 });
    expect(epi).toEqual({ stability: 1, difficulty: 5, i0: 0.4 });
  });

  it("summary/insight inherit S₀ when linked as a tree node", async () => {
    await resetDatabase();
    const sessionId = "mem12-inherit";
    await BrainManager.trackSession(sessionId, "MEM-12 inherit", testDir);
    const decisionId = await BrainManager.store({
      category: "decision",
      title: "Ship the rewrite",
      content: "We decided to ship the memory rewrite this week.",
      importance: 0.7,
      session_id: sessionId,
    });
    const insightId = await BrainStore.storeSemantic({
      category: "insight",
      title: "Rewrite digest",
      content: "Pointer summary of the ship-the-rewrite decision.",
      importance: 0.5,
      session_id: sessionId,
      summary_of: [{ type: "semantic", id: decisionId }],
    });
    const loneId = await BrainStore.storeSemantic({
      category: "insight",
      title: "Standalone insight",
      content: "An insight with no tree link keeps S₀=14.",
      importance: 0.5,
      session_id: sessionId,
    });

    const db = await BrainStore.get();
    const insight = await db.get<{ stability: number }>("SELECT stability FROM brain_semantic WHERE id = ?", [insightId]);
    const lone = await db.get<{ stability: number }>("SELECT stability FROM brain_semantic WHERE id = ?", [loneId]);
    expect(insight?.stability).toBe(60);
    expect(lone?.stability).toBe(14);
  });

  it("age never DELETEs a shouldPrune leaf", async () => {
    await resetDatabase();
    const sessionId = "mem12-age";
    await BrainManager.trackSession(sessionId, "MEM-12 age", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      "Cold leftover about quartzforgetleaf from last year.",
      10,
      0.2,
    );
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET tier = 'cold', importance_score = 0.2, salience = 0.2,
           created_at = datetime('now', '-500 days')
       WHERE id = ?`,
      [id],
    );
    const aged = (await db.get("SELECT created_at, content FROM brain_episodic WHERE id = ?", [id])) as {
      created_at: string;
      content: string;
    };
    expect(Ebbinghaus.shouldPrune(aged.created_at, 0, 0.2, 0.2, undefined, { stability: 1, category: "episodic" })).toBe(true);

    const { SleepConsolidation } = await import("./SleepConsolidation.js");
    const cycle = await SleepConsolidation.runCycle();
    expect(cycle.pruned).toBe(0);

    const row = await db.get<{ id: number; tombstoned_at: string | null; content: string; tier: string }>(
      "SELECT id, tombstoned_at, content, tier FROM brain_episodic WHERE id = ?",
      [id],
    );
    expect(row).toBeTruthy();
    expect(row?.content).toContain("quartzforgetleaf");
    expect(row?.tombstoned_at).toBeNull();
    expect(row?.tier).toBe("frozen");
  });

  it("leftover I(m,t) still grows with access count", () => {
    const old = daysAgo(14);
    const decayed = Ebbinghaus.importanceEvolution(0.8, old, 0, 0.5, 0.8, undefined, { stability: 1 });
    const reinforced = Ebbinghaus.importanceEvolution(0.8, old, 10, 0.5, 0.8, undefined, { stability: 1 });
    expect(reinforced).toBeGreaterThan(decayed);
  });

  it("leftover I(m,t) α helper still exists but is not live S", () => {
    const boosted = Ebbinghaus.boostImportanceOnAccess(0.5, 5);
    expect(boosted).toBeCloseTo(0.5 * (1 + 0.1 * 5), 5);
  });

  it("retrieved-not-used leaves S, D, I, and retrieval_count unchanged", async () => {
    await resetDatabase();
    const id = await BrainManager.store({
      category: "fact",
      title: "Boost test memory",
      content: "Content for spaced repetition boost testing.",
      importance: 0.5,
    });

    await BrainManager.recall({ query: "spaced repetition boost testing", include_episodic: false });

    const db = await BrainStore.get();
    const row = (await db.get(
      "SELECT retrieval_count, importance_score, stability, difficulty FROM brain_semantic WHERE id = ?",
      [id],
    )) as {
      retrieval_count: number;
      importance_score: number;
      stability: number;
      difficulty: number;
    };
    expect(row.retrieval_count).toBe(0);
    expect(row.importance_score).toBeCloseTo(0.5, 5);
    expect(row.stability).toBe(14);
    expect(row.difficulty).toBe(5);
  });

  it("sleep does not rewrite leftover I (MEM-14)", async () => {
    await resetDatabase();
    const id = await BrainManager.store({
      category: "fact",
      title: "Sleep I leaf",
      content: "Sleep must not raise leftover importance_score.",
      importance: 0.4,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic
       SET importance_score = 0.4, retrieval_count = 4, salience = 0.9,
           last_accessed_at = datetime('now'), tier = 'hot'
       WHERE id = ?`,
      [id],
    );
    const { SleepConsolidation } = await import("./SleepConsolidation.js");
    await SleepConsolidation.runCycle();
    const row = (await db.get(
      "SELECT importance_score FROM brain_semantic WHERE id = ?",
      [id],
    )) as { importance_score: number };
    expect(row.importance_score).toBeCloseTo(0.4, 5);
  });

  it("getReviewDue returns fading memories", async () => {
    await resetDatabase();
    const id = await BrainManager.store({
      category: "fact",
      title: "Old fading fact",
      content: "This memory has not been accessed in 60 days.",
      importance: 0.4,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET stability = 1, last_accessed_at = datetime('now', '-60 days') WHERE id = ?`,
      [id],
    );

    const due = await BrainManager.getReviewDue(10);
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].current_retention).toBeLessThan(0.5);
    expect(due[0].strength).toBe(1);
  });

  it("getEbbinghausStats exposes config and review counts", async () => {
    await resetDatabase();
    const stats = await BrainManager.getEbbinghausStats();
    expect(stats.config.lambda).toBe(0.03);
    expect(typeof stats.review_due_count).toBe("number");
    expect(stats.avg_retention).toBeGreaterThanOrEqual(0);
    expect(stats.avg_retention).toBeLessThanOrEqual(1);
  });
});
