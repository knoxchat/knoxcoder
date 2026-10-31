/**
 * MEM-35 — recipe eviction uses theorem Value = R·U, not the leftover
 * status / track-record score. S₀ = 30 (workflow). Evict when Value < θ_arch
 * or the 256MB disk budget requires it. Family cap stays a pin budget.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { Forgetting } from "../brain/Forgetting";
import { Value } from "../brain/Value";
import {
  ARCHIVE_VALUE_THRESHOLD,
  RECIPE_CATEGORY,
  RECIPE_STABILITY_S0,
  enforceRecipeBudget,
  planEviction,
  planFamilyVariantEviction,
  recipeHelpfulCount,
  recipeMemoryValue,
  recipeUnhelpfulCount,
  recipeValueSource,
  shouldRetireRecipeByValue,
} from "./budget";
import { RecipeStore } from "./RecipeStore";
import { intentFingerprint } from "./intentFingerprint";
import type { NewRecipeInput, Recipe } from "./types";

const VALUE = {
  kappa: 5,
  archiveThreshold: ARCHIVE_VALUE_THRESHOLD,
  forgetting: { F: 19 / 81, c: 0.5, pruneThreshold: 0.1, reviewThreshold: 0.5 },
};

const NOW = Date.parse("2026-06-01T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

function recipe(over: Partial<Recipe> = {}): Recipe {
  const createdAt = over.createdAt ?? daysAgo(0);
  return {
    id: over.id ?? "a".repeat(64),
    projectId: "A",
    scope: "project",
    status: "verified",
    title: "t",
    intentText: "add eslint config",
    intentFingerprint: "add eslint config",
    slots: [],
    preconditions: [],
    steps: [{ kind: "write_file", path: "f.js", blobHash: "blob", checkpointId: "cp" }],
    sourceCheckpointIds: ["cp"],
    stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
    captureCount: 1,
    createdAt,
    updatedAt: over.updatedAt ?? createdAt,
    ...over,
  };
}

describe("MEM-35 recipe Value = R·U", () => {
  it("uses workflow S₀ = 30 and returns theorem Value, not a status score", () => {
    expect(RECIPE_STABILITY_S0).toBe(30);
    expect(RECIPE_CATEGORY).toBe("workflow");
    expect(Forgetting.initialStability("workflow")).toBe(30);

    const fresh = recipe();
    const source = recipeValueSource(fresh);
    expect(source.category).toBe("workflow");
    expect(source.stability).toBe(30);
    expect(source.i0).toBe(0.5);
    expect(source.helpful_count).toBe(0);
    expect(source.unhelpful_count).toBe(0);

    const u = Value.utilityFromSource(source, VALUE);
    const expected = Value.memoryValue(0, RECIPE_STABILITY_S0, u, VALUE);
    expect(recipeMemoryValue(fresh, NOW, VALUE)).toBeCloseTo(expected, 10);
    expect(recipeMemoryValue(fresh, NOW, VALUE)).toBeCloseTo(0.5, 10);
    expect(recipeMemoryValue(fresh, NOW, VALUE)).toBeLessThanOrEqual(1);
    expect(recipeMemoryValue(fresh, NOW, VALUE)).toBeGreaterThan(ARCHIVE_VALUE_THRESHOLD);
  });

  it("decays with S = 30, not episodic S = 1", () => {
    const aged = recipe({ createdAt: daysAgo(31), updatedAt: daysAgo(31) });
    const workflow = recipeMemoryValue(aged, NOW, VALUE);
    const episodic = Value.memoryValueFromSource(
      { ...recipeValueSource(aged), category: "episodic", stability: 1 },
      VALUE,
      NOW,
    );
    const r30 = Forgetting.retrievability(31, 30, VALUE.forgetting);
    expect(workflow).toBeCloseTo(r30 * 0.5, 8);
    expect(workflow).toBeGreaterThan(episodic);
    expect(workflow).toBeGreaterThan(ARCHIVE_VALUE_THRESHOLD);
  });

  it("takes h/u from replay stats (MEM-18) plus hint leaf counts (MEM-39)", () => {
    const replayed = recipe({ stats: { replays: 4, ok: 3, reverted: 1, failedVerify: 0 } });
    expect(recipeHelpfulCount(replayed)).toBe(3);
    expect(recipeUnhelpfulCount(replayed)).toBe(1);
    expect(recipeMemoryValue(replayed, NOW, VALUE)).toBeGreaterThan(
      recipeMemoryValue(recipe({ stats: { replays: 1, ok: 0, reverted: 1, failedVerify: 0 } }), NOW, VALUE),
    );

    const hinted = recipe({
      stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
      helpfulCount: 2,
      unhelpfulCount: 4,
    });
    expect(recipeHelpfulCount(hinted)).toBe(2);
    expect(recipeUnhelpfulCount(hinted)).toBe(4);

    const both = recipe({
      stats: { replays: 4, ok: 3, reverted: 1, failedVerify: 0 },
      helpfulCount: 2,
      unhelpfulCount: 1,
    });
    expect(recipeHelpfulCount(both)).toBe(5);
    expect(recipeUnhelpfulCount(both)).toBe(2);
  });

  it("retires only when Value < θ_arch, not because a leftover count cap is exceeded", () => {
    const keep = recipe({ id: "1".repeat(64) });
    const dead = recipe({ id: "2".repeat(64), i0: 0.01 });
    expect(shouldRetireRecipeByValue(dead, NOW, VALUE)).toBe(true);
    expect(shouldRetireRecipeByValue(keep, NOW, VALUE)).toBe(false);
    expect(shouldRetireRecipeByValue({ ...dead, pinned: true }, NOW, VALUE)).toBe(false);

    const crowd = Array.from({ length: 12 }, (_, n) =>
      recipe({
        id: String(n).padStart(64, "0"),
        steps: [{ kind: "write_file", path: `f${n}.js`, blobHash: `b${n}`, checkpointId: "c" }],
      }),
    );
    expect(
      planEviction(crowd, () => 1, { maxRecipesPerProject: 2, maxBlobBytesPerProject: 1e9 }, { nowMs: NOW, value: VALUE }),
    ).toEqual([]);
    expect(
      planEviction([keep, dead], () => 1, { maxRecipesPerProject: 99, maxBlobBytesPerProject: 1e9 }, { nowMs: NOW, value: VALUE }),
    ).toEqual([dead.id]);
  });

  it("disk budget evicts the lowest theorem Value first and counts a shared blob once", () => {
    const strong = recipe({
      id: "1".repeat(64),
      stats: { replays: 4, ok: 4, reverted: 0, failedVerify: 0 },
      steps: [{ kind: "write_file", path: "a.js", blobHash: "a", checkpointId: "c" }],
    });
    const weak = recipe({
      id: "2".repeat(64),
      stats: { replays: 3, ok: 0, reverted: 3, failedVerify: 0 },
      steps: [{ kind: "write_file", path: "b.js", blobHash: "b", checkpointId: "c" }],
    });
    const evict = planEviction(
      [strong, weak],
      () => 100,
      { maxRecipesPerProject: 99, maxBlobBytesPerProject: 100 },
      { nowMs: NOW, value: VALUE },
    );
    expect(evict).toEqual([weak.id]);

    const shareA = recipe({
      id: "3".repeat(64),
      steps: [{ kind: "write_file", path: "a", blobHash: "same", checkpointId: "c" }],
    });
    const shareB = recipe({
      id: "4".repeat(64),
      steps: [{ kind: "write_file", path: "b", blobHash: "same", checkpointId: "c" }],
    });
    expect(
      planEviction(
        [shareA, shareB],
        () => 100,
        { maxRecipesPerProject: 99, maxBlobBytesPerProject: 100 },
        { nowMs: NOW, value: VALUE },
      ),
    ).toEqual([]);
  });

  it("family pin budget ranks extra variants by Value, not status", () => {
    const familyId = "fam-value";
    const strong = recipe({
      id: "1".repeat(64),
      familyId,
      stats: { replays: 5, ok: 5, reverted: 0, failedVerify: 0 },
    });
    const extras = Array.from({ length: 8 }, (_, n) =>
      recipe({
        id: String(n + 2).padStart(64, "0"),
        familyId,
        status: n === 0 ? "quarantined" : "verified",
      }),
    );
    const drop = planFamilyVariantEviction([strong, ...extras], 8, { nowMs: NOW, value: VALUE });
    expect(drop).toHaveLength(1);
    expect(drop).not.toContain(strong.id);
  });
});

describe("MEM-35 enforceRecipeBudget", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof open>>;
  let store: RecipeStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-value-"));
    db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await createTables(db);
    store = new RecipeStore(db as any);
  });
  afterEach(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z" };

  function input(n: number, over: Partial<NewRecipeInput> = {}): NewRecipeInput {
    return {
      projectId: "A",
      title: `r${n}`,
      intentText: "add eslint config",
      intentFingerprint: intentFingerprint(`add eslint config ${n}`),
      steps: [{ kind: "write_file", path: `f${n}.js`, blobHash: `blob${n}`, checkpointId: "cp" }],
      oracle,
      ...over,
    };
  }

  it("retires a Value < θ_arch recipe and keeps a high-Value neighbor under the disk cap", async () => {
    const keep = (await store.create(input(1))).recipe;
    await store.verify(keep.id);
    await store.recordReplay(keep.id, "ok");
    await store.recordReplay(keep.id, "ok");
    const dead = await store.verify((await store.create(input(2))).recipe.id);

    const live = await store.listLive();
    const planned = planEviction(
      live.map((r) => (r.id === dead.id ? { ...r, i0: 0.01 } : r)),
      () => 10,
      { maxRecipesPerProject: 1, maxBlobBytesPerProject: 1e9 },
      { nowMs: NOW, value: VALUE },
    );
    expect(planned).toEqual([dead.id]);

    await db.run("UPDATE brain_recipes SET ok_count = 0, reverted_count = 80 WHERE id = ?", [dead.id]);
    const evicted = await enforceRecipeBudget(
      store,
      () => 10,
      { maxRecipesPerProject: 1, maxBlobBytesPerProject: 1e9 },
      { nowMs: NOW, value: VALUE },
    );
    expect(evicted).toEqual([dead.id]);
    expect((await store.get(dead.id))?.status).toBe("retired");
    expect((await store.get(keep.id))?.status).toBe("verified");
  });
});
