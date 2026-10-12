import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { parseBundleRecipes, toBundleRecipe, type BundleRecipe } from "./bundle";
import { RecipeStore } from "./RecipeStore";
import type { Recipe, RecipeStep } from "./types";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const blobs = new Set([H1, H2]);

function good(over: Partial<BundleRecipe> = {}): BundleRecipe {
  return {
    title: "Add Header",
    intentText: "create Header component",
    intentFingerprint: "component create header",
    slots: [{ name: "componentName", kind: "identifier" }],
    preconditions: [{ kind: "file_exists", value: "package.json" }],
    steps: [{ kind: "write_file", path: "src/Header.tsx", blobHash: H1, baseBlobHash: H2 }],
    ...over,
  };
}

describe("recipe bundles (MC-63)", () => {
  it("valid entries parse into project-scoped inputs with no oracle, stats or checkpoint ids", () => {
    const { inputs, rejected } = parseBundleRecipes([good()], blobs, "proj-local");
    expect(rejected).toEqual([]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ projectId: "proj-local", scope: "project" });
    expect(inputs[0].oracle).toBeUndefined();
    expect(inputs[0].steps[0].checkpointId).toBeUndefined();
  });

  it.each([
    ["command step", good({ steps: [{ kind: "command" as any, path: "x", blobHash: H1 }] }), /not importable/],
    ["path traversal", good({ steps: [{ kind: "write_file", path: "../../etc/passwd", blobHash: H1 }] }), /unsafe step path/],
    ["absolute path", good({ steps: [{ kind: "write_file", path: "/etc/passwd", blobHash: H1 }] }), /unsafe step path/],
    ["windows path", good({ steps: [{ kind: "write_file", path: "C:\\x", blobHash: H1 }] }), /unsafe step path/],
    ["blob not in bundle", good({ steps: [{ kind: "write_file", path: "a.ts", blobHash: "c".repeat(64) }] }), /not in the bundle/],
    ["bad blob hash", good({ steps: [{ kind: "write_file", path: "a.ts", blobHash: "zzz" }] }), /invalid blob hash/],
    ["bad slot name", good({ slots: [{ name: "x; rm -rf /", kind: "identifier" }] }), /invalid slot/],
    ["secret", good({ intentText: "use key sk-abcdefghijklmnopqrstuvwxyz0123456789" }), /secret/],
    ["no steps", good({ steps: [] }), /step count/],
  ])("rejects %s", (_name, entry, reason) => {
    const { inputs, rejected } = parseBundleRecipes([entry], blobs, "p");
    expect(inputs).toEqual([]);
    expect(rejected[0].reason).toMatch(reason);
  });

  it("drops a drift baseline the bundle cannot serve, and ignores smuggled fields", () => {
    const entry: any = good({ steps: [{ kind: "write_file", path: "a.ts", blobHash: H1, baseBlobHash: "c".repeat(64) }] });
    entry.status = "verified";
    entry.stats = { replays: 99, ok: 99, reverted: 0, failedVerify: 0 };
    entry.oracle = { kind: "build", passedAt: "2026-01-01" };
    const { inputs } = parseBundleRecipes([entry], blobs, "p");
    expect(inputs[0].steps[0].baseBlobHash).toBeUndefined();
    expect(Object.keys(inputs[0])).not.toContain("status");
    expect(inputs[0].oracle).toBeUndefined();
  });

  it("non-array and oversize lists are handled", () => {
    expect(parseBundleRecipes("x", blobs, "p").rejected[0].reason).toMatch(/not a list/);
    expect(parseBundleRecipes(undefined, blobs, "p")).toEqual({ inputs: [], rejected: [] });
    const many = Array.from({ length: 205 }, () => good());
    expect(parseBundleRecipes(many, blobs, "p").inputs).toHaveLength(200);
  });

  it("only verified, command-free recipes are shareable", () => {
    const base = { id: "i", projectId: "p", scope: "project", title: "t", intentText: "x", intentFingerprint: "x", slots: [], preconditions: [], sourceCheckpointIds: [], stats: { replays: 3, ok: 3, reverted: 0, failedVerify: 0 }, captureCount: 2, createdAt: "", updatedAt: "" } satisfies Omit<Recipe, "status" | "steps">;
    const step: RecipeStep = { kind: "write_file", path: "a.ts", blobHash: H1, checkpointId: "cp" };
    expect(toBundleRecipe({ ...base, status: "candidate", steps: [step] })).toBeUndefined();
    expect(toBundleRecipe({ ...base, status: "verified", steps: [step, { kind: "command", command: "npm i" }] })).toBeUndefined();
    const shared = toBundleRecipe({ ...base, status: "verified", steps: [step] })!;
    expect(JSON.stringify(shared)).not.toMatch(/cp|stats|projectId/);
  });
});

describe("round trip into a RecipeStore (MC-63)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof open>>;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-bundle-"));
    db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await createTables(db);
  });
  afterEach(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a verified recipe from a sender arrives as a candidate on the receiver, and re-import dedupes", async () => {
    const sender = new RecipeStore(db as any);
    const made = await sender.create({ projectId: "sender", title: "Add Header", intentText: "create Header", intentFingerprint: "create header", steps: [{ kind: "write_file", path: "src/H.tsx", blobHash: H1, checkpointId: "cp1" }], oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z" } });
    await sender.transition(made.recipe.id, "verified");
    const shared = toBundleRecipe((await sender.get(made.recipe.id))!)!;

    const wire = JSON.parse(JSON.stringify([shared]));
    const receiver = new RecipeStore(db as any);
    const { inputs } = parseBundleRecipes(wire, blobs, "receiver");
    const first = await receiver.create(inputs[0]);
    expect(first.created).toBe(true);
    expect(first.recipe.status).toBe("candidate");
    expect(first.recipe.projectId).toBe("receiver");
    expect(first.recipe.oracle).toBeUndefined();
    expect(first.recipe.stats).toEqual({ replays: 0, ok: 0, reverted: 0, failedVerify: 0 });
    expect((await receiver.list({ projectId: "receiver", status: "verified" })).length).toBe(0);
    expect((await receiver.create(inputs[0])).created).toBe(false);
  });
});
