import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import type { StoreInput } from "../brain/types";
import { RecipeStore } from "./RecipeStore";
import { applyMemoryUpdates, collectReviewEvents, errorFixMemory, runSelfReview } from "./selfReviewApply";
import { planMemoryUpdates } from "./selfReview";
import type { NewRecipeInput } from "./types";

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;
let stored: StoreInput[];
const storeMemory = async (input: StoreInput) => (stored.push(input), stored.length);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-self-review-"));
  db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
  store = new RecipeStore(db as any);
  stored = [];
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" };
const input = (over: Partial<NewRecipeInput> = {}): NewRecipeInput => ({
  projectId: "p1",
  title: "Add button",
  intentText: "create a button",
  intentFingerprint: "create button",
  steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "aaa", checkpointId: "cp1" }],
  oracle,
  ...over,
});

async function verified(over: Partial<NewRecipeInput> = {}) {
  const { recipe } = await store.create(input(over));
  return store.verify(recipe.id);
}

describe("applyMemoryUpdates (MC-41)", () => {
  it("merges byte-and-path identical duplicates; keeps blob variants (P1.8)", async () => {
    const variant = await verified({
      steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "bbb", checkpointId: "cp2" }],
    });
    const a = await verified({ slots: [{ name: "x", kind: "identifier" }] });
    const b = await verified({ slots: [{ name: "y", kind: "identifier" }] });
    await store.recordReplay(a.id, "ok");
    await store.recordReplay(b.id, "ok");
    await store.recordReplay(b.id, "ok");

    const recipes = await store.list({ status: ["verified"] });
    const updates = planMemoryUpdates([], recipes);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ action: "merge_recipes", keepId: b.id, dropIds: [a.id] });
    const report = await applyMemoryUpdates(updates, { store, storeMemory });

    expect(report.merged).toHaveLength(1);
    const keep = await store.get(b.id);
    expect(keep!.status).toBe("verified");
    expect(keep!.stats).toMatchObject({ replays: 3, ok: 3 });
    expect((await store.get(a.id))!.status).toBe("retired");
    expect((await store.get(variant.id))!.status).toBe("verified");
  });

  it("retired duplicates no longer pin blobs", async () => {
    const a = await verified();
    const b = await verified({ steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "bbb", checkpointId: "cp2" }] });
    await store.absorb(b.id, [a.id]);
    const pins = await store.pinnedBlobRefCounts();
    expect(pins.has("aaa")).toBe(false);
    expect(pins.get("bbb")).toBe(1);
  });

  it("stores an error_fix memory for a recurring failure", async () => {
    const events = Array.from({ length: 3 }, () => ({ kind: "build_fail" as const, text: "error TS2304 in /a/b.ts" }));
    const report = await applyMemoryUpdates(planMemoryUpdates(events, []), { store, storeMemory });
    expect(report.errorFixes).toBe(1);
    expect(stored[0]).toMatchObject({ category: "error_fix" });
    expect(stored[0].content).toContain("3 times");
  });

  it("redacts secrets in the error_fix memory", () => {
    const m = errorFixMemory("token=sk_live_abcdefghijklmnop1234 failed", 4);
    expect(m.content).not.toContain("abcdefghijklmnop1234");
    expect(m.title).not.toContain("abcdefghijklmnop1234");
  });

  it("quarantines a failing recipe and skips ones that are not live", async () => {
    const live = await verified();
    const gone = await store.retire((await store.create(input({ title: "x", intentFingerprint: "other" }))).recipe.id);
    const report = await applyMemoryUpdates(
      [
        { action: "quarantine_recipe", recipeId: live.id, reason: "revert x3" },
        { action: "quarantine_recipe", recipeId: gone.id, reason: "revert x3" },
        { action: "quarantine_recipe", recipeId: "f".repeat(64), reason: "missing" },
      ],
      { store, storeMemory },
    );
    expect(report.quarantined).toEqual([live.id]);
    expect(report.skipped).toHaveLength(2);
    expect((await store.get(live.id))!.status).toBe("quarantined");
  });

  it("one failing update does not stop the rest", async () => {
    let n = 0;
    const report = await applyMemoryUpdates(
      [
        { action: "add_error_fix", signature: "a", count: 3 },
        { action: "add_error_fix", signature: "b", count: 3 },
      ],
      {
        store,
        storeMemory: async (m) => {
          if (n++ === 0) throw new Error("db busy");
          stored.push(m);
          return 1;
        },
      },
    );
    expect(report.errorFixes).toBe(1);
    expect(report.skipped).toHaveLength(1);
  });
});

describe("collectReviewEvents / runSelfReview", () => {
  async function seed(
    kind: string,
    content: string,
    files: string[] = [],
    createdAt = new Date().toISOString(),
    extra: Record<string, unknown> = {},
  ) {
    await db.run(`INSERT OR IGNORE INTO brain_sessions (id, title) VALUES ('s1', 't')`).catch(() => {});
    await db.run(
      `INSERT INTO brain_episodic (session_id, type, role, content, metadata, created_at) VALUES ('s1','tool_call','tool',?,?,?)`,
      [content, JSON.stringify({ soul: true, kind, files, ...extra }), createdAt.replace("T", " ").slice(0, 19)],
    );
  }

  it("turns soul rows into review events and ignores other kinds and old rows", async () => {
    await seed("build:fail", "build:fail error TS1 at /x.ts");
    await seed("restore", "restored", ["src/a.ts"]);
    await seed("tool_success", "ok");
    await seed("tool_error", "too old", [], "2020-01-01T00:00:00Z");
    const events = await collectReviewEvents(db as any);
    expect(events.map((e) => e.kind).sort()).toEqual(["build_fail", "revert"]);
    expect(events.find((e) => e.kind === "revert")!.text).toBe("src/a.ts");
  });

  it("collects user_correction soul rows with the recipe id (P7.1)", async () => {
    await seed("user_correction", "not this: skipped recipe Button", [], new Date().toISOString(), { recipeId: "r1" });
    const events = await collectReviewEvents(db as any);
    expect(events).toEqual([expect.objectContaining({ kind: "user_correction", recipeId: "r1" })]);
  });

  it("runs end to end from seeded history", async () => {
    for (let i = 0; i < 3; i++) await seed("build:fail", `build:fail error TS${i}00 in /p${i}/x.ts`);
    const out = await runSelfReview(db as any, { store, storeMemory });
    expect(out.events).toBe(3);
    expect(out.report.errorFixes).toBe(1);
    expect(stored[0].category).toBe("error_fix");
  });
});
