/** MC-53 (global scope + leakage) and MC-54 (growth budget). */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { RecipeStore } from "./RecipeStore";
import { matchRecipes } from "./RecipeMatcher";
import { enforceRecipeBudget, MAX_FAMILY_VARIANTS, planEviction, planFamilyVariantEviction, runRecipeMaintenance } from "./budget";
import { intentFingerprint } from "./intentFingerprint";
import type { NewRecipeInput, Recipe } from "./types";

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-budget-"));
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

function input(projectId: string, n: number, over: Partial<NewRecipeInput> = {}): NewRecipeInput {
  return {
    projectId,
    title: `r${n}`,
    intentText: "add eslint config",
    intentFingerprint: intentFingerprint("add eslint config"),
    steps: [{ kind: "write_file", path: `f${n}.js`, blobHash: `blob${n}`, checkpointId: "cp" }],
    oracle,
    preconditions: [{ kind: "file_exists", value: "package.json" }],
    ...over,
  };
}

async function verified(i: NewRecipeInput): Promise<Recipe> {
  const { recipe } = await store.create(i);
  return store.verify(recipe.id);
}

describe("MC-53 global recipes", () => {
  it("needs explicit consent, verified status and a precondition", async () => {
    const cand = (await store.create(input("A", 1))).recipe;
    await expect(store.promoteToGlobal(cand.id, { consent: false })).rejects.toThrow(/consent/);
    await expect(store.promoteToGlobal(cand.id, { consent: true })).rejects.toThrow(/verified/);
    const noPre = await verified(input("A", 2, { preconditions: [] }));
    await expect(store.promoteToGlobal(noPre.id, { consent: true })).rejects.toThrow(/precondition/);
  });

  it("project recipes never leak to another project; promoted ones are visible to all", async () => {
    const a = await verified(input("A", 1));
    const b = await verified(input("B", 2));
    expect((await store.listVisibleTo("B")).map((r) => r.id)).toEqual([b.id]);

    const message = "add eslint config";
    const all = await store.list();
    expect(matchRecipes({ message, recipes: all, projectId: "B" }).map((m) => m.recipe.id)).toEqual([b.id]);
    // No project id: fail closed, nothing leaks.
    expect(matchRecipes({ message, recipes: all })).toEqual([]);

    await store.promoteToGlobal(a.id, { consent: true });
    expect((await store.listVisibleTo("B")).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    const ids = matchRecipes({ message, recipes: await store.list(), projectId: "C" }).map((m) => m.recipe.id);
    expect(ids).toEqual([a.id]);

    await store.demoteToProject(a.id);
    expect((await store.listVisibleTo("B")).map((r) => r.id)).toEqual([b.id]);
  });

  it("listVisibleTo filters in SQL so a busy foreign project cannot hide this one (P7.9)", async () => {
    const local = await verified(input("B", 1));
    for (let n = 2; n <= 6; n++) await verified(input("A", n));
    const visible = await store.listVisibleTo("B", { limit: 2 });
    expect(visible.map((r) => r.id)).toContain(local.id);
    expect(visible.every((r) => r.projectId === "B" || r.scope === "global")).toBe(true);
  });
});

describe("MC-54 growth budget", () => {
  const size = () => 100;

  it("does not evict by the leftover per-project count cap (MEM-35)", async () => {
    const strong = await verified(input("A", 1));
    await store.recordReplay(strong.id, "ok");
    const weak = await verified(input("A", 2));
    const cand = (await store.create(input("A", 3))).recipe;
    const other = await verified(input("B", 4));

    const live = await store.listLive();
    expect(planEviction(live, size, { maxRecipesPerProject: 1, maxBlobBytesPerProject: 1e9 })).toEqual([]);
    expect(live.map((r) => r.id)).toEqual(expect.arrayContaining([strong.id, weak.id, cand.id, other.id]));
  });

  it("enforces the byte cap on distinct blobs and frees pins when retiring", async () => {
    await verified(input("A", 1));
    await verified(input("A", 2));
    await verified(input("A", 3));
    expect(planEviction(await store.listLive(), size, { maxRecipesPerProject: 99, maxBlobBytesPerProject: 300 })).toEqual([]);

    const evicted = await enforceRecipeBudget(store, size, { maxRecipesPerProject: 99, maxBlobBytesPerProject: 200 });
    expect(evicted).toHaveLength(1);
    expect((await store.pinnedBlobRefCounts()).size).toBe(2);
  });

  it("runRecipeMaintenance purges retired rows older than 30 days", async () => {
    const stale = await verified(input("A", 1));
    await store.retire(stale.id);
    await db.run("UPDATE brain_recipes SET updated_at = ? WHERE id = ?", [
      "2019-01-01T00:00:00.000Z",
      stale.id,
    ]);
    const { purged } = await runRecipeMaintenance(store, size);
    expect(purged).toBe(1);
    expect(await store.get(stale.id)).toBeNull();
  });

  it("a family of 20 variants keeps only N best and frees the extra pins (P7.10)", async () => {
    const familyId = "fam-cap";
    const created: Recipe[] = [];
    for (let n = 1; n <= 20; n++) {
      const rec = await verified(
        input("A", n, {
          familyId,
          intentFingerprint: "create component $name",
          steps: [{ kind: "write_file", path: `src/V${n}.tsx`, blobHash: `blob${n}`, checkpointId: "c" }],
        }),
      );
      await store.setFamily(rec.id, { familyId, slots: [{ name: "componentName", kind: "identifier" }], slotValues: { componentName: `V${n}` } });
      created.push((await store.get(rec.id))!);
    }
    await store.recordReplay(created[0].id, "ok");
    await store.recordReplay(created[0].id, "ok");
    const drop = planFamilyVariantEviction(await store.list({ familyId, status: ["verified"] }), MAX_FAMILY_VARIANTS);
    expect(drop).toHaveLength(20 - MAX_FAMILY_VARIANTS);
    expect(drop).not.toContain(created[0].id);
    const { evicted } = await runRecipeMaintenance(store, size);
    expect(evicted).toEqual(expect.arrayContaining(drop));
    const live = await store.list({ familyId, status: ["verified"] });
    expect(live).toHaveLength(MAX_FAMILY_VARIANTS);
    expect(live.map((r) => r.id)).toContain(created[0].id);
    expect((await store.pinnedBlobRefCounts()).size).toBe(MAX_FAMILY_VARIANTS);
  });

  it("counts a shared blob once", async () => {
    await verified(input("A", 1, { steps: [{ kind: "write_file", path: "a", blobHash: "same", checkpointId: "c" }] }));
    await verified(input("A", 2, { steps: [{ kind: "write_file", path: "b", blobHash: "same", checkpointId: "c" }] }));
    expect(planEviction(await store.listLive(), size, { maxRecipesPerProject: 99, maxBlobBytesPerProject: 100 })).toEqual([]);
  });
});
