import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { RecipeStore, RecipeTransitionError, canTransition, canonicalRecipeId } from "./RecipeStore";
import type { NewRecipeInput } from "./types";

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-store-"));
  db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
  store = new RecipeStore(db as any);
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" };

function input(over: Partial<NewRecipeInput> = {}): NewRecipeInput {
  return {
    projectId: "p1",
    title: "Add button",
    intentText: "create a button component",
    intentFingerprint: "create button component",
    steps: [
      { kind: "write_file", path: "src/Button.tsx", blobHash: "aaa", checkpointId: "cp1" },
      { kind: "command", command: "npm test" },
    ],
    oracle,
    ...over,
  };
}

describe("RecipeStore.create", () => {
  it("creates a candidate with ordered steps and derived checkpoint ids", async () => {
    const { recipe, created } = await store.create(input());
    expect(created).toBe(true);
    expect(recipe.id).toMatch(/^[0-9a-f]{64}$/);
    expect(recipe.status).toBe("candidate");
    expect(recipe.steps.map((s) => s.kind)).toEqual(["write_file", "command"]);
    expect(recipe.sourceCheckpointIds).toEqual(["cp1"]);
    expect(recipe.oracle).toEqual(oracle);
    expect(recipe.stats).toEqual({ replays: 0, ok: 0, reverted: 0, failedVerify: 0 });
  });

  it("dedupes identical work, even when captured from a different checkpoint", async () => {
    const a = await store.create(input());
    const b = await store.create(
      input({
        title: "other title",
        steps: [
          { kind: "write_file", path: "src/Button.tsx", blobHash: "aaa", checkpointId: "cp9" },
          { kind: "command", command: "npm test" },
        ],
      }),
    );
    expect(b.created).toBe(false);
    expect(b.recipe.id).toBe(a.recipe.id);
    expect(b.recipe.title).toBe("Add button");
    expect((await db.get("SELECT COUNT(*) n FROM brain_recipes"))!.n).toBe(1);
    expect((await db.get("SELECT COUNT(*) n FROM brain_recipe_steps"))!.n).toBe(2);
  });

  it("does not dedupe different content, project, or step order", async () => {
    const base = await store.create(input());
    const otherBlob = await store.create(
      input({ steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "bbb", checkpointId: "cp1" }] }),
    );
    const otherProject = await store.create(input({ projectId: "p2" }));
    const reordered = await store.create(input({ steps: [...input().steps].reverse() }));
    const ids = new Set([base, otherBlob, otherProject, reordered].map((r) => r.recipe.id));
    expect(ids.size).toBe(4);
  });

  it("persists family id and slot values without changing the snapshot id", async () => {
    const { recipe } = await store.create(input());
    const updated = await store.setFamily(recipe.id, {
      familyId: "f".repeat(64),
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button"] }],
      slotValues: { componentName: "Button" },
    });
    expect(updated.id).toBe(recipe.id);
    expect(updated.familyId).toBe("f".repeat(64));
    expect(updated.slots[0]).toMatchObject({ name: "componentName", examples: ["Button"] });
    expect(updated.slotValues).toEqual({ componentName: "Button" });
    expect(await store.list({ familyId: updated.familyId })).toHaveLength(1);
  });

  it("canonical id ignores slot/precondition ordering", () => {
    const s1 = [{ name: "a", kind: "identifier" as const }, { name: "b", kind: "path" as const }];
    const p1 = [{ kind: "file", value: "x" }, { kind: "dep", value: "y" }];
    expect(canonicalRecipeId(input({ slots: s1, preconditions: p1 }))).toBe(
      canonicalRecipeId(input({ slots: [...s1].reverse(), preconditions: [...p1].reverse() })),
    );
  });

  it("does not revive a retired recipe when re-captured", async () => {
    const { recipe } = await store.create(input());
    await store.retire(recipe.id);
    const again = await store.create(input());
    expect(again.created).toBe(false);
    expect(again.recipe.status).toBe("retired");
  });

  it("redacts secrets before hashing and storing", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const { recipe } = await store.create(
      input({
        intentText: `use key ${secret}`,
        steps: [{ kind: "command", command: `curl -H "Authorization: Bearer ${secret}" x` }],
      }),
    );
    const dump = JSON.stringify(recipe);
    expect(dump).not.toContain(secret);
  });

  it("rejects malformed recipes", async () => {
    await expect(store.create(input({ steps: [] }))).rejects.toThrow(/step/);
    await expect(store.create(input({ intentFingerprint: " " }))).rejects.toThrow(/Fingerprint/);
    await expect(
      store.create(input({ steps: [{ kind: "write_file", path: "a.ts" }] })),
    ).rejects.toThrow(/blobHash/);
    await expect(store.create(input({ steps: [{ kind: "command" }] }))).rejects.toThrow(/command/);
    expect((await db.get("SELECT COUNT(*) n FROM brain_recipes"))!.n).toBe(0);
  });
});

describe("RecipeStore status transitions", () => {
  it("candidate -> verified requires an oracle pass", async () => {
    const noOracle = await store.create(input({ oracle: undefined }));
    await expect(store.verify(noOracle.recipe.id)).rejects.toBeInstanceOf(RecipeTransitionError);
    expect((await store.get(noOracle.recipe.id))!.status).toBe("candidate");

    await store.recordOracle(noOracle.recipe.id, oracle);
    expect((await store.verify(noOracle.recipe.id)).status).toBe("verified");
  });

  it("quarantine and retire follow the state machine", async () => {
    const { recipe } = await store.create(input());
    await store.verify(recipe.id);
    expect((await store.quarantine(recipe.id)).status).toBe("quarantined");
    await expect(store.verify(recipe.id)).rejects.toBeInstanceOf(RecipeTransitionError);
    expect((await store.retire(recipe.id)).status).toBe("retired");
    await expect(store.transition(recipe.id, "candidate")).rejects.toBeInstanceOf(RecipeTransitionError);
    await expect(store.recordOracle(recipe.id, oracle)).rejects.toThrow();
  });

  it("transition table is complete", () => {
    expect(canTransition("candidate", "verified")).toBe(true);
    expect(canTransition("verified", "candidate")).toBe(false);
    expect(canTransition("quarantined", "candidate")).toBe(true);
    expect(canTransition("quarantined", "verified")).toBe(false);
    for (const s of ["candidate", "verified", "quarantined", "retired"] as const) {
      expect(canTransition("retired", s)).toBe(false);
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("errors for unknown ids", async () => {
    await expect(store.retire("nope")).rejects.toThrow(/not found/);
  });
});

describe("RecipeStore queries and stats", () => {
  it("lists by project, status and fingerprint", async () => {
    const a = await store.create(input());
    await store.create(input({ projectId: "p2" }));
    await store.verify(a.recipe.id);
    expect((await store.list({ projectId: "p1" })).map((r) => r.id)).toEqual([a.recipe.id]);
    expect(await store.list({ status: "verified" })).toHaveLength(1);
    expect(await store.list({ status: ["candidate", "verified"] })).toHaveLength(2);
    expect(await store.list({ intentFingerprint: "nothing" })).toHaveLength(0);
  });

  it("records replay outcomes", async () => {
    const { recipe } = await store.create(input());
    await store.recordReplay(recipe.id, "ok");
    const r = await store.recordReplay(recipe.id, "reverted");
    expect(r.stats).toEqual({ replays: 2, ok: 1, reverted: 1, failedVerify: 0 });
    expect(r.lastReplayedAt).toBeTruthy();
  });

  it("refcounts blobs for live recipes only (retired release their pins)", async () => {
    const a = await store.create(input());
    const b = await store.create(
      input({
        intentFingerprint: "other",
        steps: [
          { kind: "write_file", path: "src/B.tsx", blobHash: "aaa", baseBlobHash: "base", checkpointId: "cp2" },
        ],
      }),
    );
    expect(Object.fromEntries(await store.pinnedBlobRefCounts())).toEqual({ aaa: 2, base: 1 });

    await store.quarantine(b.recipe.id); // still pinned: can be re-proved
    expect((await store.pinnedBlobRefCounts()).get("aaa")).toBe(2);

    await store.retire(b.recipe.id);
    expect(Object.fromEntries(await store.pinnedBlobRefCounts())).toEqual({ aaa: 1 });
    await store.retire(a.recipe.id);
    expect((await store.pinnedBlobRefCounts()).size).toBe(0);
  });

  it("rename, pin, notes, and procedure edits survive round-trip", async () => {
    const { recipe } = await store.create(
      input({ preconditions: [{ kind: "language", value: "typescript" }, { kind: "file_exists", value: "src/a.ts" }] }),
    );
    const renamed = await store.updateInspector(recipe.id, { title: "Create Button", notes: "from the lint turn", pinned: true });
    expect(renamed.title).toBe("Create Button");
    expect(renamed.notes).toBe("from the lint turn");
    expect(renamed.pinned).toBe(true);
    const edited = await store.updateProcedure(recipe.id, {
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button"] }],
      userPreconditions: [{ kind: "file_exists", value: "src/Button.tsx" }],
    });
    expect(edited.slots).toEqual([{ name: "componentName", kind: "identifier", examples: ["Button"] }]);
    expect(edited.preconditions).toEqual([
      { kind: "language", value: "typescript" },
      { kind: "file_exists", value: "src/Button.tsx" },
    ]);
    await store.retire(recipe.id);
    await expect(store.updateInspector(recipe.id, { title: "nope" })).rejects.toThrow(/retired/);
  });

  it("delete cascades steps", async () => {
    const { recipe } = await store.create(input());
    expect(await store.delete(recipe.id)).toBe(true);
    expect((await db.get("SELECT COUNT(*) n FROM brain_recipe_steps"))!.n).toBe(0);
    expect(await store.get(recipe.id)).toBeNull();
  });
});
