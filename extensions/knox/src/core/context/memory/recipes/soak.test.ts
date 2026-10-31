/**
 * MC-83: 1000-turn soak with recipes on, against a real sqlite file.
 *
 * Each turn does what a turn does at start: list the project's verified recipes, match the
 * message, and (on a replayable hit) run an exact replay through in-memory ports; on a miss it
 * "generates" and captures a candidate that is promoted the second time the work is seen. The
 * growth budget runs every 100 turns, as the host is expected to schedule it.
 *
 * Numbers are printed so they can be copied into docs/known-issues.md. The bounds asserted here
 * are loose enough for CI machines but would fail on an unbounded-growth or O(n^2) regression.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { computeIntentFingerprint } from "./intentFingerprint";
import { enforceAllFamilyVariantCaps, enforceRecipeBudget, DEFAULT_RECIPE_BUDGET, MAX_FAMILY_VARIANTS } from "./budget";
import { linkRecipeFamily } from "./family";
import { bestMatch } from "./RecipeMatcher";
import { RecipeStore } from "./RecipeStore";
import { replayExact, type ReplayPorts } from "./replayer";
import { applySlots, fillSlotsFromMessage } from "./slots";

const TURNS = 1000;
const DISTINCT_INTENTS = 400; // many live recipes; count cap is leftover (MEM-35)
const PROJECT = "soak-project";
const ORACLE = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" };

const ADJ = ["red", "blue", "green", "quick", "slow", "tiny", "huge", "calm", "bold", "dark", "pale", "warm", "cold", "sharp", "soft", "wild", "neat", "plain", "rich", "odd"];
const NOUN = ["button", "modal", "table", "router", "parser", "cache", "queue", "logger", "form", "chart", "menu", "tabs", "badge", "toast", "avatar", "slider", "tooltip", "drawer", "header", "footer"];

function intent(n: number): string {
  return `create a ${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length) % NOUN.length]} component`;
}

const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

let dir: string;
let dbPath: string;
let db: Awaited<ReturnType<typeof open>>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-soak-"));
  dbPath = path.join(dir, "brain.sqlite");
  db = await open({ filename: dbPath, driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
});
afterAll(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("1000-turn soak (MC-83)", () => {
  it("keeps the database, blob pins and replay latency bounded", async () => {
    const store = new RecipeStore(db as any);
    const files = new Map<string, string>(); // workspace: path -> content hash
    const blobs = new Map<string, string>(); // blob hash -> bytes (stand-in for the blob store)
    const blobSize = (h: string) => blobs.get(h)?.length ?? 0;

    const ports: ReplayPorts = {
      readBlob: async (h) => blobs.get(h),
      currentHash: async (p) => files.get(p),
      createCheckpoint: async () => "cp-pre",
      restoreCheckpoint: async () => undefined,
      writeFile: async (p, c) => {
        files.set(p, `h:${String(c).length}:${p}`);
        return { ok: true };
      },
      deleteFile: async (p) => (files.delete(p), { ok: true }),
      runCommand: async () => ({ ok: true }),
      verify: async () => ({ ok: true }),
    };

    const replayMs: number[] = [];
    const matchMs: number[] = [];
    let replays = 0;
    let generated = 0;
    let evicted = 0;
    let maxLive = 0;
    const sizeAt: Record<number, number> = {};
    const dbBytes = () => fs.statSync(dbPath).size;

    for (let turn = 0; turn < TURNS; turn++) {
      // Zipf-ish: a hot head repeats a lot, a long tail mostly appears once or twice.
      const n = turn % 3 === 0 ? turn % 20 : (turn * 7919) % DISTINCT_INTENTS;
      const message = intent(n);

      const t0 = performance.now();
      const recipes = await store.list({ projectId: PROJECT, status: "verified" });
      const match = bestMatch({ message, recipes, projectId: PROJECT });
      matchMs.push(performance.now() - t0);

      if (match?.replayable) {
        // A clean workspace for the target file, as at the start of a repeated task.
        const step = match.recipe.steps.find((s) => s.kind === "write_file")!;
        if (step.baseBlobHash) files.set(step.path!, step.baseBlobHash);
        else files.delete(step.path!);
        const r0 = performance.now();
        const result = await replayExact(match.recipe, ports);
        replayMs.push(performance.now() - r0);
        expect(result.status).toBe("applied");
        await store.recordReplay(match.recipe.id, "ok");
        replays++;
      } else {
        generated++;
        const fp = computeIntentFingerprint(message).key;
        const file = `src/${fp.replace(/\W+/g, "-").slice(0, 40)}.ts`;
        const bytes = `// ${message}\n` + "x".repeat(2000 + (n % 5) * 500);
        const hash = `blob-${fp}-${bytes.length}`;
        blobs.set(hash, bytes);
        const { recipe } = await store.create({
          projectId: PROJECT,
          intentText: message,
          intentFingerprint: fp,
          title: message,
          steps: [{ kind: "write_file", path: file, blobHash: hash, checkpointId: `cp-${turn}` }],
          preconditions: [{ kind: "file_absent", value: file }],
          oracle: ORACLE,
        });
        // Second sighting of the same work promotes it (MC-15).
        if (recipe.status === "candidate" && recipe.captureCount >= 2) await store.verify(recipe.id);
        else if (recipe.status === "candidate") await store.recordCapture(recipe.id, ORACLE);
      }

      if (turn % 100 === 99) {
        evicted += (await enforceRecipeBudget(store, blobSize)).length;
        sizeAt[turn + 1] = dbBytes();
        const live = await store.listLive();
        maxLive = Math.max(maxLive, live.length);
        expect(live.length).toBeLessThanOrEqual(DISTINCT_INTENTS + MAX_FAMILY_VARIANTS);
      }
    }

    let slotReplays = 0;
    const variantNames = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango"];
    for (const name of variantNames) {
      const message = `create a ${name} widget`;
      const bytes = `export function ${name}() { return "${name}"; }\n`;
      const hash = `slot-${name}`;
      blobs.set(hash, bytes);
      const { recipe } = await store.create({
        projectId: PROJECT,
        intentText: message,
        intentFingerprint: computeIntentFingerprint(message).key,
        title: message,
        steps: [{ kind: "write_file", path: `src/${name}.ts`, blobHash: hash, checkpointId: `cp-slot-${name}` }],
        oracle: ORACLE,
      });
      if (recipe.status === "candidate") await store.verify(recipe.id);
      await linkRecipeFamily(store, (await store.get(recipe.id)) ?? recipe, { readBlob: async (h) => blobs.get(h) });
    }
    await enforceAllFamilyVariantCaps(store);
    evicted += (await enforceRecipeBudget(store, blobSize)).length;
    const familyLive = (await store.listLive()).filter((r) => r.familyId);
    const byFamily = new Map<string, number>();
    for (const r of familyLive) byFamily.set(r.familyId!, (byFamily.get(r.familyId!) ?? 0) + 1);
    expect(Math.max(0, ...byFamily.values())).toBeLessThanOrEqual(MAX_FAMILY_VARIANTS);

    const slotted = familyLive.find((r) => r.slots.length > 0);
    if (slotted) {
      const fill = fillSlotsFromMessage(slotted.slots, "create a WidgetX widget");
      if (fill.unfilled === 0) {
        const src = slotted.steps.find((s) => s.blobHash);
        const text = src?.blobHash ? blobs.get(src.blobHash) : undefined;
        if (text && src?.path) {
          const applied = applySlots(slotted, fill.values, new Map([[src.path, text]]));
          if (applied.ok) {
            const result = await replayExact(applied.recipe, ports, { merged: applied.merged });
            if (result.status === "applied") slotReplays++;
          }
        }
      }
    }

    const pinned = await store.pinnedBlobRefCounts();
    const pinnedBytes = [...pinned.keys()].reduce((n, h) => n + blobSize(h), 0);
    const retired = (await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes WHERE status = 'retired'"))!.n;
    const rows = (await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes"))!.n;
    const stepRows = (await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipe_steps"))!.n;

    const summary = {
      turns: TURNS,
      replays,
      generated,
      evicted,
      maxLive,
      recipeRows: rows,
      retiredRows: retired,
      stepRows,
      dbBytes: dbBytes(),
      dbBytesAt: sizeAt,
      pinnedBlobs: pinned.size,
      pinnedBytes,
      matchP95Ms: +percentile(matchMs, 0.95).toFixed(2),
      replayP95Ms: +percentile(replayMs, 0.95).toFixed(2),
      slotReplays,
    };
    console.info(`[mc-83 soak] ${JSON.stringify(summary)}`);

    expect(replays).toBeGreaterThan(100); // recipes are actually being reused
    expect(percentile(replayMs, 0.95)).toBeLessThan(300); // 300ms p95 replay target
    expect(percentile(matchMs, 0.95)).toBeLessThan(300); // list + match at turn start
    expect(pinnedBytes).toBeLessThanOrEqual(DEFAULT_RECIPE_BUDGET.maxBlobBytesPerProject);
    // Disk budget is the pin valve (MEM-35). Family cap still bounds variants.
    expect(pinned.size).toBeLessThanOrEqual(DISTINCT_INTENTS + MAX_FAMILY_VARIANTS);
    // The database stays small, and the second half does not grow like the first (it plateaus).
    expect(dbBytes()).toBeLessThan(16 * 1024 * 1024);
    expect(dbBytes() - sizeAt[500]).toBeLessThan(sizeAt[500] * 1.5 + 1024 * 1024);
  }, 120_000);
});
