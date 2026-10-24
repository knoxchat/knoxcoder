import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyBrainPragmas } from "core/context/memory/brain/store/dbSafety";
import { createTables } from "core/context/memory/brain/store/schema";
import { hashProjectId } from "core/context/memory/brain/projectScope";
import { RecipeStore } from "core/context/memory/recipes/RecipeStore";

let db: Awaited<ReturnType<typeof open>>;
let dir: string;
vi.mock("core/context/memory/brain/store/connection", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get: async () => db,
}));

import { listRecipes, setRecipeStatus } from "./recipeList";

const HERE = "file:///work/here";
const THERE = "file:///work/there";
const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-list-"));
  db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function make(projectDir: string, name: string) {
  const store = new RecipeStore(db as never);
  const { recipe } = await store.create({
    projectId: hashProjectId(projectDir),
    title: name,
    intentFingerprint: name,
    steps: [{ kind: "write_file", path: `src/${name}.ts`, blobHash: name, checkpointId: `cp-${name}` }],
    oracle,
  });
  await store.verify(recipe.id);
  return recipe;
}

describe("recipe list (MC-70)", () => {
  it("lists only this project's recipes, with stats and source checkpoints", async () => {
    const mine = await make(HERE, "a");
    await make(THERE, "b");
    const listed = await listRecipes(HERE);
    expect(listed.recipes.map((r) => r.id)).toEqual([mine.id]);
    expect(listed.recipes[0]).toMatchObject({ status: "verified", uses: 0, reverted: 0, files: 1, sourceCheckpointIds: ["cp-a"] });
  });

  it("retires and quarantines, and refuses another project's recipe", async () => {
    const mine = await make(HERE, "a");
    const other = await make(THERE, "b");
    expect(await setRecipeStatus(HERE, mine.id, "quarantined")).toEqual({ ok: true });
    expect((await listRecipes(HERE)).recipes[0].status).toBe("quarantined");
    expect(await setRecipeStatus(HERE, mine.id, "retired")).toEqual({ ok: true });
    expect(await setRecipeStatus(HERE, mine.id, "quarantined")).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setRecipeStatus(HERE, other.id, "retired")).toEqual({ ok: false, reason: "not_found" });
    expect(await setRecipeStatus(HERE, "nope", "retired")).toEqual({ ok: false, reason: "not_found" });
  });

  it("restores a quarantined recipe to candidate and verifies a candidate with an oracle", async () => {
    const mine = await make(HERE, "a");
    expect(await setRecipeStatus(HERE, mine.id, "quarantined")).toEqual({ ok: true });
    expect(await setRecipeStatus(HERE, mine.id, "candidate")).toEqual({ ok: true });
    expect((await listRecipes(HERE)).recipes[0].status).toBe("candidate");
    expect(await setRecipeStatus(HERE, mine.id, "verified")).toEqual({ ok: true });
    expect((await listRecipes(HERE)).recipes[0].status).toBe("verified");
  });

  it("marks skillEligible after enough clean replays", async () => {
    const mine = await make(HERE, "a");
    const store = new RecipeStore(db as never);
    expect((await listRecipes(HERE)).recipes[0].skillEligible).toBe(false);
    for (let i = 0; i < 3; i++) {
      await store.recordReplay(mine.id, "ok");
    }
    expect((await listRecipes(HERE)).recipes[0].skillEligible).toBe(true);
  });
});
