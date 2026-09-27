/**
 * Part IV — Ebbinghaus Forgetting & Spaced Repetition tests (IMP-08).
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-ebbinghaus-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Ebbinghaus: typeof import("./Ebbinghaus.js").Ebbinghaus;
let SpacedRepetition: typeof import("./AdvancedFeatures.js").SpacedRepetition;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Ebbinghaus } = await import("./Ebbinghaus.js"));
  ({ SpacedRepetition } = await import("./AdvancedFeatures.js"));

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
  await db.exec("DELETE FROM brain_sessions");
}

describe("Part IV — Ebbinghaus Forgetting & Spaced Repetition", () => {
  it("uses theorem defaults: λ=0.03, θ_prune=0.1, α=0.1, β=0.1", () => {
    const p = Ebbinghaus.getEbbinghausParams();
    expect(p.lambda).toBe(0.03);
    expect(p.pruneThreshold).toBe(0.1);
    expect(p.strengtheningAlpha).toBe(0.1);
    expect(p.repetitionBeta).toBe(0.1);
    expect(p.initialRetention).toBe(1.0);
  });

  it("R(t) = R₀·e^(-λt/S) decays slowly with λ=0.03", () => {
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const r = Ebbinghaus.retentionFromMemory(oneDayAgo, 1, 0.5, 0.5);
    expect(r).toBeGreaterThan(0.95);
    expect(r).toBeLessThan(1.0);
  });

  it("S(m) grows with β per access: S_new = S_old + β", () => {
    const salience = 0.5;
    const importance = 0.5;
    const s0 = Ebbinghaus.memoryStrength(0, salience, importance);
    const s5 = Ebbinghaus.memoryStrength(5, salience, importance);
    expect(s5).toBeGreaterThan(s0);
    const beta = Ebbinghaus.strengthGainOnAccess();
    const modifiers =
      (1 + 0.5 * salience) * (1 + 0.3 * importance);
    expect(s5 - s0).toBeCloseTo(5 * beta * modifiers, 1);
  });

  it("I(m,t) = I₀·R(t)·(1+α·access_count) evolution", () => {
    const old = new Date(Date.now() - 14 * 86400000).toISOString();
    const decayed = Ebbinghaus.importanceEvolution(0.8, old, 0, 0.5, 0.8);
    const reinforced = Ebbinghaus.importanceEvolution(0.8, old, 10, 0.5, 0.8);
    expect(reinforced).toBeGreaterThan(decayed);
  });

  it("boostImportanceOnAccess applies α strengthening", () => {
    const boosted = Ebbinghaus.boostImportanceOnAccess(0.5, 5);
    expect(boosted).toBeCloseTo(0.5 * (1 + 0.1 * 5), 5);
  });

  it("SpacedRepetition.boostOnRetrieval increments access and boosts importance", async () => {
    await resetDatabase();
    const id = await BrainManager.store({
      category: "fact",
      title: "Boost test memory",
      content: "Content for spaced repetition boost testing.",
      importance: 0.5,
    });

    const newImportance = await SpacedRepetition.boostOnRetrieval(id);
    expect(newImportance).toBeGreaterThan(0.5);

    const db = await BrainStore.get();
    const row = (await db.get("SELECT retrieval_count FROM brain_semantic WHERE id = ?", [id])) as {
      retrieval_count: number;
    };
    expect(row.retrieval_count).toBe(1);
  });

  it("getReviewDue returns fading memories", async () => {
    await resetDatabase();
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_semantic (category, title, content, importance_score, retrieval_count, last_accessed_at, tier)
       VALUES ('fact', 'Old fading fact', 'This memory has not been accessed in 60 days.', 0.4, 0, ?, 'hot')`,
      [old],
    );

    const due = await BrainManager.getReviewDue(10);
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].current_retention).toBeLessThan(0.5);
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
