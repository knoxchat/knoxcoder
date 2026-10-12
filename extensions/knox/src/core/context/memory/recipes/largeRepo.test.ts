/**
 * MC-84: a 500k-file repository must cost the same per turn as a tiny one.
 *
 * The recipe path may touch only: the workspace root listing, root manifests, and the exact
 * paths a recipe names. These tests give it a virtual 500,000-file tree that throws if anything
 * else is asked for, and count the calls.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { checkPreconditions, derivePreconditions, type PreconditionEnv } from "./preconditions";
import { RecipeStore } from "./RecipeStore";
import { detectDrift } from "./replayer";
import type { Recipe, RecipeStep } from "./types";

const FILES = 500_000;
const ROOT = ["package.json", "tsconfig.json", "src", "node_modules", ".git", "README.md"];
const MANIFESTS = new Set(["package.json", "Cargo.toml", "requirements.txt", "pyproject.toml"]);

function bigRepo(recipePaths: string[]) {
  const allowedPaths = new Set(recipePaths);
  const calls = { rootEntries: 0, readText: [] as string[], exists: [] as string[], dirtyPaths: [] as string[][] };
  const env: PreconditionEnv = {
    rootEntries: async () => (calls.rootEntries++, ROOT),
    readText: async (rel) => {
      calls.readText.push(rel);
      if (!MANIFESTS.has(rel)) throw new Error(`walked outside the manifests: ${rel}`);
      return rel === "package.json" ? JSON.stringify({ dependencies: { react: "1" } }) : undefined;
    },
    exists: async (rel) => {
      calls.exists.push(rel);
      if (!allowedPaths.has(rel)) throw new Error(`stat of a path no recipe names: ${rel}`);
      return false;
    },
    dirtyPaths: async (paths) => {
      calls.dirtyPaths.push(paths);
      for (const p of paths) if (!allowedPaths.has(p)) throw new Error(`git status for a path no recipe names: ${p}`);
      return [];
    },
  };
  return { env, calls, filesInTree: FILES };
}

function steps(n: number): RecipeStep[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "write_file" as const, path: `src/gen/file${i}.ts`, blobHash: `b${i}`, baseBlobHash: i % 2 ? `base${i}` : undefined }));
}

describe("large repository (MC-84)", () => {
  it("preconditions read the root once and ask git once, however many paths a recipe names", async () => {
    const recipeSteps = steps(60);
    const pre = [
      ...derivePreconditions(recipeSteps),
      { kind: "language", value: "typescript" },
      { kind: "framework", value: "react" },
      { kind: "dependency", value: "react" },
      { kind: "dependency", value: "lodash" },
    ];
    const { env, calls } = bigRepo(recipeSteps.map((s) => s.path!));
    // file_exists on a missing file fails; that is fine here, only the access pattern matters.
    const result = await checkPreconditions(pre, env);
    expect(result.ok).toBe(false);

    expect(calls.rootEntries).toBe(1);
    expect(calls.dirtyPaths).toHaveLength(1); // one `git status`, not 60
    expect(calls.dirtyPaths[0]).toHaveLength(60);
    // package.json is parsed once per distinct file even though four checks need it.
    expect(calls.readText.filter((p) => p === "package.json")).toHaveLength(1);
    expect(calls.exists.length).toBeLessThanOrEqual(60); // one stat per named path
    expect(new Set(calls.exists).size).toBe(calls.exists.length);
  });

  it("a recipe with no touched paths costs only the root listing", async () => {
    const { env, calls } = bigRepo([]);
    const result = await checkPreconditions([{ kind: "language", value: "typescript" }], env);
    expect(result.ok).toBe(true);
    expect(calls).toMatchObject({ rootEntries: 1, readText: [], exists: [], dirtyPaths: [] });
  });

  it("an unknown git state fails closed without a second call", async () => {
    const recipeSteps = steps(3);
    const { env, calls } = bigRepo(recipeSteps.map((s) => s.path!));
    env.dirtyPaths = async (paths) => (calls.dirtyPaths.push(paths), undefined);
    const result = await checkPreconditions(
      recipeSteps.map((s) => ({ kind: "clean_paths", value: s.path! })),
      env,
    );
    expect(result.ok).toBe(false);
    expect(calls.dirtyPaths).toHaveLength(1);
  });

  it("drift detection hashes only the recipe's own files", async () => {
    const recipeSteps = steps(40);
    const recipe = { steps: recipeSteps } as Recipe;
    const seen: string[] = [];
    await detectDrift(recipe, async (p) => (seen.push(p), undefined));
    expect(seen).toEqual(recipeSteps.map((s) => s.path));
  });
});

describe("recipe list cost does not grow with recipe count (MC-84)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof open>>;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-largerepo-"));
    db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await createTables(db);
  });
  afterEach(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists N recipes with their steps in two queries", async () => {
    const store = new RecipeStore(db as any);
    for (let i = 0; i < 150; i++) {
      await store.create({
        projectId: "p",
        intentFingerprint: `fp ${i}`,
        steps: [
          { kind: "write_file", path: `src/a${i}.ts`, blobHash: `h${i}` },
          { kind: "command", command: "npm test" },
        ],
      });
    }
    let queries = 0;
    const real = db.all.bind(db);
    (db as any).all = (...args: unknown[]) => (queries++, (real as any)(...args));
    const list = await store.list({ projectId: "p" });
    expect(list).toHaveLength(150);
    expect(queries).toBe(2);
    expect(list.every((r) => r.steps.length === 2 && r.steps[0].kind === "write_file" && r.steps[1].kind === "command")).toBe(true);
  });

  it("returns [] without a steps query when nothing matches", async () => {
    const store = new RecipeStore(db as any);
    let queries = 0;
    const real = db.all.bind(db);
    (db as any).all = (...args: unknown[]) => (queries++, (real as any)(...args));
    expect(await store.list({ projectId: "none" })).toEqual([]);
    expect(queries).toBe(1);
  });
});
