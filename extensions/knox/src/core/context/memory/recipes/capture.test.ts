import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { RecipeStore } from "./RecipeStore";
import {
  SOUL_HISTORY_CAP,
  captureRecipeFromTurn,
  selectTurnEvidence,
  type CaptureDeps,
  type TurnFileChange,
  type TurnSoulEvent,
} from "./capture";

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-capture-"));
  db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
  store = new RecipeStore(db as any);
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const pass = { kind: "build" as const, passed: true, command: "npm run build" };

function edit(id: number, over: Partial<TurnSoulEvent> = {}): TurnSoulEvent {
  return {
    episodicId: id,
    kind: "tool_success",
    toolName: "builtin_edit_file",
    files: ["src/Button.tsx"],
    workspaceCheckpointId: "cp_before",
    ...over,
  };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function deps(changes: TurnFileChange[] | undefined, calls: string[] = []): CaptureDeps {
  return {
    store,
    async diffAgainst(base) {
      calls.push(base);
      return changes ? { afterCheckpointId: "cp_after", changes } : undefined;
    },
  };
}

const turn = (events: TurnSoulEvent[], over: Partial<Parameters<typeof captureRecipeFromTurn>[1]> = {}) => ({
  events,
  markEpisodicId: 10,
  sessionId: "s1",
  projectId: "p1",
  userMessage: "Create a Button component",
  ...over,
});

describe("selectTurnEvidence", () => {
  it("accepts a mutation followed by a passing oracle, using the earliest turn checkpoint", () => {
    const ev = selectTurnEvidence(
      [edit(5), edit(11, { workspaceCheckpointId: "cp_first" }), edit(12, { workspaceCheckpointId: "cp_later", oracle: pass })],
      10,
    );
    expect(ev).toEqual({ baseCheckpointId: "cp_first", oracle: pass });
  });

  it("ignores events from before the turn started", () => {
    expect(selectTurnEvidence([edit(5, { oracle: pass })], 10)).toBe("no_mutation");
  });

  it("refuses when there is no verdict, or the last verdict failed", () => {
    expect(selectTurnEvidence([edit(11)], 10)).toBe("no_oracle");
    expect(
      selectTurnEvidence([edit(11, { oracle: pass }), edit(12, { oracle: { ...pass, passed: false } })], 10),
    ).toBe("oracle_failed");
    // A failure that was later fixed is fine.
    expect(
      typeof selectTurnEvidence([edit(11, { oracle: { ...pass, passed: false } }), edit(12, { oracle: pass })], 10),
    ).toBe("object");
  });

  it("refuses when no mutating tool succeeded (read-only turn with an oracle)", () => {
    const readOnly = edit(11, { toolName: "builtin_read_file", oracle: pass });
    expect(selectTurnEvidence([readOnly], 10)).toBe("no_mutation");
    expect(selectTurnEvidence([edit(11, { kind: "tool_error", oracle: pass })], 10)).toBe("no_mutation");
  });

  it("refuses without a workspace checkpoint", () => {
    expect(selectTurnEvidence([edit(11, { workspaceCheckpointId: undefined, oracle: pass })], 10)).toBe(
      "no_checkpoint",
    );
  });

  it("refuses when the soul history was truncated mid-turn", () => {
    const events = Array.from({ length: SOUL_HISTORY_CAP }, (_, i) => edit(11 + i, { oracle: pass }));
    expect(selectTurnEvidence(events, 10)).toBe("history_truncated");
    // Full history that still reaches back before the turn is fine.
    const ok = [edit(5), ...events.slice(1)];
    expect(typeof selectTurnEvidence(ok, 10)).toBe("object");
  });
});

describe("captureRecipeFromTurn", () => {
  it("yields exactly one candidate with correct blob refs", async () => {
    const calls: string[] = [];
    const changes: TurnFileChange[] = [
      { path: "src/index.ts", hash: HASH_B, baseHash: HASH_A },
      { path: "src/Button.tsx", hash: HASH_A },
      { path: "src/old.ts", deleted: true, baseHash: HASH_B },
    ];
    const events = [edit(11, { oracle: pass })];

    const first = await captureRecipeFromTurn(deps(changes, calls), turn(events));
    expect(first.captured).toBe(true);
    if (!first.captured) return;
    expect(first.created).toBe(true);
    expect(calls).toEqual(["cp_before"]);

    const r = first.recipe;
    expect(r.status).toBe("candidate");
    expect(r.projectId).toBe("p1");
    expect(r.sourceCheckpointIds).toEqual(["cp_after"]);
    expect(r.oracle).toMatchObject({ kind: "build", command: "npm run build" });
    expect(r.steps).toEqual([
      { kind: "write_file", path: "src/Button.tsx", blobHash: HASH_A, checkpointId: "cp_after" },
      { kind: "write_file", path: "src/index.ts", blobHash: HASH_B, baseBlobHash: HASH_A, checkpointId: "cp_after" },
      { kind: "delete_file", path: "src/old.ts", baseBlobHash: HASH_B, checkpointId: "cp_after" },
    ]);
    // Blobs are pinned for retention (MC-12).
    expect([...(await store.pinnedBlobRefCounts()).keys()].sort()).toEqual([HASH_A, HASH_B]);

    // Capturing the same turn again does not add a second candidate.
    expect(first.promoted).toBe(false);
    const again = await captureRecipeFromTurn(deps(changes), turn(events));
    expect(again.captured && again.created).toBe(false);
    expect(await store.list()).toHaveLength(1);
    // The same intent succeeded twice: promoted (MC-15).
    expect(again.captured && again.promoted).toBe(true);
    expect((await store.list())[0].status).toBe("verified");
  });

  it("links a memory only once the recipe is verified (MC-17)", async () => {
    const stored: string[] = [];
    const withMemory = (): CaptureDeps => ({
      ...deps([{ path: "src/Button.tsx", hash: HASH_A }]),
      async storeMemory(m) {
        stored.push(m.content);
        return 42;
      },
    });
    const events = [edit(11, { oracle: pass })];
    const first = await captureRecipeFromTurn(withMemory(), turn(events));
    expect(first.captured && first.recipe.memoryId).toBeUndefined();
    expect(stored).toHaveLength(0);

    const second = await captureRecipeFromTurn(withMemory(), turn(events));
    expect(second.captured && second.recipe.memoryId).toBe(42);
    expect(stored).toHaveLength(1);

    await captureRecipeFromTurn(withMemory(), turn(events));
    expect(stored).toHaveLength(1);
  });

  it("does not touch the checkpoint engine when the turn does not qualify", async () => {
    const calls: string[] = [];
    const res = await captureRecipeFromTurn(deps([], calls), turn([edit(11)]));
    expect(res).toEqual({ captured: false, reason: "no_oracle" });
    expect(calls).toEqual([]);
    expect(await store.list()).toHaveLength(0);
  });

  it("skips when the turn start was never marked", async () => {
    const res = await captureRecipeFromTurn(deps([]), turn([edit(11, { oracle: pass })], { markEpisodicId: undefined }));
    expect(res).toEqual({ captured: false, reason: "no_turn_mark" });
  });

  it("skips empty diffs, missing after-checkpoint, and oversized turns", async () => {
    const events = [edit(11, { oracle: pass })];
    expect(await captureRecipeFromTurn(deps([]), turn(events))).toEqual({ captured: false, reason: "no_changes" });
    expect(await captureRecipeFromTurn(deps(undefined), turn(events))).toEqual({
      captured: false,
      reason: "no_changes",
    });
    const many = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.ts`, hash: HASH_A }));
    expect(await captureRecipeFromTurn(deps(many), turn(events))).toEqual({
      captured: false,
      reason: "too_many_files",
    });
    expect(await store.list()).toHaveLength(0);
  });

  it("stores nothing when a file holds a secret or is a secret file", async () => {
    const events = [edit(11, { oracle: pass })];
    const leaked = await captureRecipeFromTurn(
      deps([{ path: "src/config.ts", hash: HASH_A, hasSecret: true }]),
      turn(events),
    );
    expect(leaked).toEqual({ captured: false, reason: "secret_detected" });
    const envFile = await captureRecipeFromTurn(deps([{ path: ".env", hash: HASH_A }]), turn(events));
    expect(envFile).toEqual({ captured: false, reason: "secret_detected" });
    expect(await store.list()).toHaveLength(0);
  });

  it("redacts secrets typed in the user message", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const res = await captureRecipeFromTurn(
      deps([{ path: "a.ts", hash: HASH_A }]),
      turn([edit(11, { oracle: pass })], { userMessage: `use key ${secret} to add a.ts` }),
    );
    expect(res.captured).toBe(true);
    if (res.captured) {
      expect(res.recipe.title).not.toContain(secret);
      expect(res.recipe.intentText).not.toContain(secret);
      expect(res.recipe.intentFingerprint).not.toContain(secret.slice(0, 20));
    }
  });
});
