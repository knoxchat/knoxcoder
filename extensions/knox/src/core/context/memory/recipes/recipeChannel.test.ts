/**
 * MEM-34 — recipe retrieval is a channel over Ω(q), not RecipeStore.list cap-1000.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { searchRecipesByQuery } from "./agentView";
import { matchRecipes, matchRecipesFromChannel } from "./RecipeMatcher";
import { RecipeStore } from "./RecipeStore";
import { intentFingerprint } from "./intentFingerprint";
import { RECIPE_CHANNEL_CANDIDATE_CAP, type NewRecipeInput, type Recipe } from "./types";

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-channel-"));
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

function input(over: Partial<NewRecipeInput> = {}): NewRecipeInput {
  return {
    projectId: "p1",
    title: "oauth jwt refresh",
    intentText: "oauth jwt refresh token omega",
    intentFingerprint: intentFingerprint("oauth jwt refresh token omega"),
    steps: [{ kind: "write_file", path: "src/auth/jwt.ts", blobHash: "needle", checkpointId: "cp" }],
    oracle,
    ...over,
  };
}

async function verified(over: Partial<NewRecipeInput> = {}): Promise<Recipe> {
  const { recipe } = await store.create(input(over));
  return store.verify(recipe.id);
}

describe("MEM-34 recipe channel", () => {
  it("creates the FTS content table on a fresh brain", async () => {
    const names = (await db.all<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table'")).map(
      (r) => r.name,
    );
    expect(names).toEqual(expect.arrayContaining(["brain_recipe_lex", "brain_recipes_fts"]));
  });

  it("finds a recipe by title, intent, path, and CJK without listing", async () => {
    const hit = await verified();
    await verified({
      title: "unrelated lint",
      intentText: "add eslint config",
      intentFingerprint: intentFingerprint("add eslint config"),
      steps: [{ kind: "write_file", path: "eslint.config.js", blobHash: "other", checkpointId: "cp" }],
    });

    const byTitle = await store.searchVisibleTo("p1", { query: "oauth jwt refresh", status: "verified" });
    expect(byTitle.map((r) => r.id)).toEqual([hit.id]);

    const byPath = await store.searchVisibleTo("p1", { query: "src/auth/jwt.ts", status: "verified" });
    expect(byPath.map((r) => r.id)).toEqual([hit.id]);

    const zh = await store.searchVisibleTo("p1", { query: "请添加 eslint config", status: "verified" });
    expect(zh).toHaveLength(1);
    expect(zh[0].title).toBe("unrelated lint");
  });

  it("keeps Ω(q) project-scoped and drops retired rows", async () => {
    const local = await verified();
    const foreign = await verified({
      projectId: "p2",
      title: "oauth jwt refresh foreign",
      steps: [{ kind: "write_file", path: "src/other.ts", blobHash: "p2", checkpointId: "cp" }],
    });
    const retired = await verified({
      title: "oauth jwt refresh retired",
      steps: [{ kind: "write_file", path: "src/retired.ts", blobHash: "ret", checkpointId: "cp" }],
    });
    await store.retire(retired.id);

    const hits = await store.searchVisibleTo("p1", { query: "oauth jwt refresh", status: "verified" });
    expect(hits.map((r) => r.id)).toEqual([local.id]);
    expect(hits.map((r) => r.id)).not.toContain(foreign.id);
    expect(hits.map((r) => r.id)).not.toContain(retired.id);
  });

  it("unions linked workflow memory ids into Ω(q)", async () => {
    const linked = await verified({
      title: "silent workflow",
      intentText: "zzzz no shared tokens",
      intentFingerprint: intentFingerprint("zzzz no shared tokens"),
      memoryId: 42,
      steps: [{ kind: "write_file", path: "src/z.ts", blobHash: "z", checkpointId: "cp" }],
    });
    const hits = await store.searchVisibleTo("p1", {
      query: "oauth jwt refresh",
      status: "verified",
      memoryIds: [42],
    });
    expect(hits.map((r) => r.id)).toContain(linked.id);
  });

  it("retrieves a family variant that does not share the slot token", async () => {
    const button = await verified({
      title: "Create Button",
      intentText: "create a React component called Button",
      intentFingerprint: intentFingerprint("create a React component called Button"),
      steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "btn", checkpointId: "cp" }],
    });
    const hits = await store.searchVisibleTo("p1", {
      query: "create a React component called Card",
      status: "verified",
    });
    expect(hits.map((r) => r.id)).toContain(button.id);
    const matched = matchRecipes({
      message: "create a React component called Card",
      projectId: "p1",
      recipes: hits,
    });
    expect(matched[0]?.recipe.id).toBe(button.id);
  });

  it("finds a needle that RecipeStore.list cap-1000 would drop (Dilution Lemma)", async () => {
    const needle = await verified();
    await db.run("UPDATE brain_recipes SET updated_at = ? WHERE id = ?", [
      "2019-01-01T00:00:00.000Z",
      needle.id,
    ]);

    await db.exec("BEGIN");
    for (let i = 0; i < 1100; i++) {
      await db.run(
        `INSERT INTO brain_recipes
           (id, project_id, status, title, intent_text, intent_fingerprint, updated_at)
         VALUES (?, 'p1', 'verified', ?, ?, ?, '2026-06-01T00:00:00.000Z')`,
        [`decoy${String(i).padStart(4, "0")}`, `decoy ${i}`, `noise filler ${i}`, `decoy filler ${i}`],
      );
    }
    await db.exec("COMMIT");

    const listed = await store.list({ projectId: "p1", status: "verified", limit: 1000 });
    expect(listed).toHaveLength(1000);
    expect(listed.map((r) => r.id)).not.toContain(needle.id);

    const found = await store.searchVisibleTo("p1", { query: "oauth jwt refresh", status: "verified" });
    expect(found.map((r) => r.id)).toContain(needle.id);
    expect(found.length).toBeLessThanOrEqual(RECIPE_CHANNEL_CANDIDATE_CAP);
  });

  it("matchRecipesFromChannel uses search, not an inventory dump", async () => {
    const hit = await verified();
    let listed = false;
    const channel = {
      searchVisibleTo: async (projectId: string, filter?: { query?: string }) => {
        expect(projectId).toBe("p1");
        expect(filter?.query).toMatch(/oauth/);
        return store.searchVisibleTo(projectId, { ...filter, status: "verified" });
      },
      list: async () => {
        listed = true;
        return store.list({ limit: 1000 });
      },
    };
    const matches = await matchRecipesFromChannel(channel, {
      message: "oauth jwt refresh token",
      projectId: "p1",
    });
    expect(listed).toBe(false);
    expect(matches[0]?.recipe.id).toBe(hit.id);
  });

  it("searchRecipesByQuery ranks channel hits and does not scan list(1000)", async () => {
    await verified();
    await verified({
      title: "Create Card",
      intentText: "create card component",
      intentFingerprint: intentFingerprint("create card component"),
      steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "card", checkpointId: "cp" }],
    });
    let listedLimit: number | undefined;
    const proxy = {
      searchVisibleTo: (projectId: string, filter?: { query?: string; limit?: number }) =>
        store.searchVisibleTo(projectId, filter),
      listVisibleTo: async (projectId: string, filter?: { limit?: number }) => {
        listedLimit = filter?.limit;
        return store.listVisibleTo(projectId, filter);
      },
    };
    const hits = await searchRecipesByQuery(proxy, "p1", "card", 8);
    expect(hits.map((r) => r.title)).toEqual(["Create Card"]);
    expect(listedLimit).toBeUndefined();

    const empty = await searchRecipesByQuery(proxy, "p1", "", 3);
    expect(listedLimit).toBe(3);
    expect(empty.length).toBeLessThanOrEqual(3);
  });
});
