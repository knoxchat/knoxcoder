/**
 * MC-80 golden tasks for recipe replay. Scripted: the "LLM" is a counter, no live model.
 * Runs the real decision engine, precondition checker, preview/merge, replayer and feedback
 * against an in-memory workspace. (Binding to `callTool` is the host's job: MC-30.)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decide } from "../agent/decisionEngine";
import { applyReplayResult, recordRevert } from "../context/memory/recipes/feedback";
import { applyBrainPragmas } from "../context/memory/brain/store/dbSafety";
import { createTables } from "../context/memory/brain/store/schema";
import { RecipeStore } from "../context/memory/recipes/RecipeStore";
import { intentFingerprint } from "../context/memory/recipes/intentFingerprint";
import { bestMatch } from "../context/memory/recipes/RecipeMatcher";
import { checkPreconditions, type PreconditionEnv } from "../context/memory/recipes/preconditions";
import { acceptRecipe } from "../context/memory/recipes/promotion";
import { previewReplay } from "../context/memory/recipes/replayPreview";
import { replayExact, replayFailureContext, type ReplayPorts } from "../context/memory/recipes/replayer";
import type { Recipe } from "../context/memory/recipes/types";

const BASE = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;";
const RESULT = `${BASE}\nexport const e = 5;`;
const hash = (t: string) => `h:${t.length}:${[...t].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7)}`;
const blobs = new Map<string, string>([[hash(BASE), BASE], [hash(RESULT), RESULT]]);

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-golden-"));
  db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
  store = new RecipeStore(db as any);
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function verifiedRecipe(over: { verifyCommand?: string } = {}): Promise<Recipe> {
  const { recipe } = await store.create({
    projectId: "p",
    title: "add e const",
    intentText: "add the e constant to src/a.ts",
    intentFingerprint: intentFingerprint("add the e constant"),
    steps: [{ kind: "write_file", path: "src/a.ts", blobHash: hash(RESULT), baseBlobHash: hash(BASE), checkpointId: "cp1" }],
    oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z", command: over.verifyCommand },
    preconditions: [{ kind: "file_exists", value: "src/a.ts" }],
  });
  const res = await acceptRecipe(store, recipe.id);
  return res.recipe;
}

interface World {
  disk: Map<string, string>;
  snapshots: Map<string, Map<string, string>>;
  llmCalls: string[];
  verifyOk: boolean;
}

function world(initial: string = BASE): World {
  return { disk: new Map([["src/a.ts", initial]]), snapshots: new Map(), llmCalls: [], verifyOk: true };
}

function ports(w: World): ReplayPorts & { readCurrent(p: string): Promise<string | undefined> } {
  return {
    readBlob: async (h) => blobs.get(h),
    currentHash: async (p) => (w.disk.has(p) ? hash(w.disk.get(p)!) : undefined),
    readCurrent: async (p) => w.disk.get(p),
    createCheckpoint: async () => {
      w.snapshots.set("pre", new Map(w.disk));
      return "pre";
    },
    restoreCheckpoint: async (id) => {
      w.disk = new Map(w.snapshots.get(id)!);
    },
    writeFile: async (p, c) => (w.disk.set(p, String(c)), { ok: true }),
    deleteFile: async (p) => (w.disk.delete(p), { ok: true }),
    runCommand: async () => ({ ok: true }),
    verify: async () => (w.verifyOk ? { ok: true } : { ok: false, detail: "tsc: error TS2304" }),
  };
}

const env = (w: World): PreconditionEnv => ({
  rootEntries: async () => ["src", "package.json"],
  readText: async () => undefined,
  exists: async (p) => w.disk.has(p),
  dirtyPaths: async () => [],
});

/** The turn driver: decide -> (replay | LLM). Returns what path was taken. */
async function runTurn(w: World, recipes: Recipe[], message: string, autoReplay: "ask" | "exact" = "exact") {
  const match = bestMatch({ message, recipes, projectId: "p" });
  const p = ports(w);
  const preconditions = match ? await checkPreconditions(match.recipe.preconditions, env(w)) : undefined;
  const preview = match ? await previewReplay(match.recipe, p) : undefined;
  const decision = decide({ match, preconditions, autoReplay, drifted: preview?.drifted, permissionMode: undefined });
  let replay;
  let fallbackContext = "";
  if (decision.mode === "exact" && match) {
    replay = await replayExact(match.recipe, p, { merged: preview?.merged });
    if (replay.status !== "applied") {
      fallbackContext = replayFailureContext(replay);
      w.llmCalls.push(fallbackContext);
    }
  } else {
    w.llmCalls.push(`llm:${decision.mode}`);
  }
  return { decision, replay, preview, match, fallbackContext };
}

describe("recipe golden tasks (MC-80)", () => {
  it("replay-exact: zero LLM calls, identical bytes", async () => {
    const r = await verifiedRecipe();
    const w = world();
    const t = await runTurn(w, [r], "add the e constant");
    expect(t.decision.mode).toBe("exact");
    expect(t.replay?.status).toBe("applied");
    expect(w.llmCalls).toEqual([]);
    expect(w.disk.get("src/a.ts")).toBe(RESULT);
  });

  it("replay-adapt: user edits elsewhere in the file make exact unsafe, so the LLM adapts", async () => {
    const r = await verifiedRecipe();
    const edited = BASE.replace("a = 1", "a = 100");
    const w = world(edited);
    const t = await runTurn(w, [r], "add the e constant");
    expect(t.preview?.drifted).toBe(true);
    expect(t.preview?.conflicts).toEqual([]);
    expect(t.decision.mode).toBe("adapt");
    expect(t.replay).toBeUndefined();
    expect(w.llmCalls).toEqual(["llm:adapt"]);
    expect(w.disk.get("src/a.ts")).toBe(edited);
  });

  it("replay-refused-precondition: file missing, replay refused with a reason", async () => {
    const r = await verifiedRecipe();
    const w = world();
    w.disk.clear();
    const t = await runTurn(w, [r], "add the e constant");
    expect(t.decision.mode).toBe("suggest");
    expect(t.decision.why).toMatch(/refused/i);
    expect(w.disk.size).toBe(0);
  });

  it("poisoned recipe: failed verify restores files, counts failedVerify, falls back to the LLM", async () => {
    const r = await verifiedRecipe();
    const w = world();
    w.verifyOk = false;
    const t = await runTurn(w, [r], "add the e constant");
    expect(t.replay?.status).toBe("failed_verify");
    expect(t.replay?.restored).toBe(true);
    expect(w.disk.get("src/a.ts")).toBe(BASE);
    expect(w.llmCalls).toHaveLength(1);
    expect(w.llmCalls[0]).toContain("TS2304");
    const after = await applyReplayResult(store, t.replay!);
    expect(after?.stats.failedVerify).toBe(1);
  });

  it("revert quarantines the recipe and it is never matched for replay again", async () => {
    const r = await verifiedRecipe();
    const w = world();
    const t = await runTurn(w, [r], "add the e constant");
    await applyReplayResult(store, t.replay!);
    const q = await recordRevert(store, r.id, new Date());
    expect(q?.status).toBe("quarantined");
    const again = await runTurn(world(), [(await store.get(r.id))!], "add the e constant");
    expect(again.decision.mode).toBe("generate");
  });

  it("drift conflict: user edited the same region, exact is refused and adapt is chosen", async () => {
    const r = await verifiedRecipe();
    const w = world(`${BASE}\n// my own tail`);
    const p = ports(w);
    const preview = await previewReplay(r, p);
    expect(preview.conflicts).toEqual(["src/a.ts"]);
    const match = bestMatch({ message: "add the e constant", recipes: [r], projectId: "p" })!;
    const d = decide({ match, preconditions: { ok: true, failures: [], summary: "" }, autoReplay: "exact", drifted: preview.drifted });
    expect(d.mode).toBe("adapt");
    expect((await replayExact(r, p)).status).toBe("drifted");
    expect(w.disk.get("src/a.ts")).toBe(`${BASE}\n// my own tail`);
  });
});
