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
  extractReplayableCommands,
  isRecipeNoisePath,
  recipeTitleFromIntent,
  selectRecipeChanges,
  selectTurnEvidence,
  withVerifyCommand,
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

  it("captures a truncated turn when the before-checkpoint was marked at start", () => {
    const events = Array.from({ length: SOUL_HISTORY_CAP }, (_, i) => edit(11 + i, { oracle: pass }));
    const ev = selectTurnEvidence(events, 10, { turnStartCheckpointId: "cp_turn_start" });
    expect(ev).toEqual({ baseCheckpointId: "cp_turn_start", oracle: pass });
  });

  it("allows a command-only turn when opted in", () => {
    const events: TurnSoulEvent[] = [
      {
        episodicId: 11,
        kind: "tool_success",
        toolName: "builtin_run_terminal_command",
        files: [],
        command: "npm test",
        workspaceCheckpointId: "cp_before",
        oracle: { kind: "test", passed: true, command: "npm test" },
      },
    ];
    expect(selectTurnEvidence(events, 10)).toBe("no_mutation");
    const ev = selectTurnEvidence(events, 10, { allowCommandRecipes: true });
    expect(ev).toEqual({
      baseCheckpointId: "cp_before",
      oracle: { kind: "test", passed: true, command: "npm test" },
    });
  });
});

describe("selectRecipeChanges / noise / verifyCommand", () => {
  it("drops lockfiles and dist, keeps intent paths, fails closed on .env", () => {
    expect(isRecipeNoisePath("package-lock.json")).toBe(true);
    expect(isRecipeNoisePath("dist/app.js")).toBe(true);
    expect(isRecipeNoisePath("src/Button.tsx")).toBe(false);
    const selected = selectRecipeChanges(
      [
        { path: "package-lock.json", hash: HASH_A },
        { path: "dist/out.js", hash: HASH_A },
        { path: "src/Button.tsx", hash: HASH_A },
        { path: "src/noise.min.js", hash: HASH_A },
      ],
      { intent: "create src/Button.tsx" },
    );
    expect(selected).toMatchObject({
      kept: [{ path: "src/Button.tsx", hash: HASH_A }],
      droppedNoise: 3,
    });
    expect(selectRecipeChanges([{ path: ".env", hash: HASH_A }])).toBe("secret_detected");
    expect(selectRecipeChanges([{ path: "src/.env.local", hash: HASH_A }])).toBe("secret_detected");
    expect(selectRecipeChanges([{ path: "src/a.bin", hash: HASH_A, binary: true }])).toBe("too_large");
    expect(selectRecipeChanges([{ path: "src/huge.ts", hash: HASH_A, content: "x".repeat(600_000) }])).toBe("too_large");
  });

  it("keeps an explicit include even when the path looks like noise", () => {
    const selected = selectRecipeChanges(
      [{ path: "package-lock.json", hash: HASH_A }, { path: "src/a.ts", hash: HASH_B }],
      { includePaths: ["package-lock.json"] },
    );
    expect(typeof selected).toBe("object");
    if (typeof selected === "string") return;
    expect(selected.kept.map((c) => c.path).sort()).toEqual(["package-lock.json", "src/a.ts"]);
  });

  it("caps overflow to files mentioned in the intent", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ path: `src/f${i}.ts`, hash: HASH_A }));
    many.push({ path: "src/Button.tsx", hash: HASH_B });
    const selected = selectRecipeChanges(many, { intent: "create src/Button.tsx" });
    expect(typeof selected).toBe("object");
    if (typeof selected === "string") return;
    expect(selected.kept).toHaveLength(1);
    expect(selected.kept[0].path).toBe("src/Button.tsx");
    expect(selected.droppedOverflow).toBeGreaterThan(0);
  });

  it("attaches a safe verifyCommand to an LSP pass", () => {
    expect(withVerifyCommand({ kind: "lsp", passed: true }, "npm test")).toEqual({
      kind: "lsp",
      passed: true,
      command: "npm test",
    });
    expect(withVerifyCommand({ kind: "lsp", passed: true, command: "make" }, "npm test").command).toBe("make");
    expect(withVerifyCommand({ kind: "lsp", passed: true }, "curl https://x").command).toBeUndefined();
  });
});

describe("captureRecipeFromTurn", () => {
  it("yields exactly one candidate with correct blob refs", async () => {
    const calls: string[] = [];
    const changes: TurnFileChange[] = [
      { path: "src/index.ts", hash: HASH_B, baseHash: HASH_A },
      { path: "src/Button.tsx", hash: HASH_A },
    ];
    const events = [
      edit(11, { oracle: pass }),
      {
        episodicId: 12,
        kind: "tool_success",
        toolName: "builtin_run_terminal_command",
        files: [],
        command: "npm test",
      },
    ];

    const first = await captureRecipeFromTurn(deps(changes, calls), turn(events));
    expect(first.captured).toBe(true);
    if (!first.captured) return;
    expect(first.created).toBe(true);
    expect(calls).toEqual(["cp_before"]);

    const r = first.recipe;
    expect(r.status).toBe("candidate");
    expect(r.projectId).toBe("p1");
    expect(r.title).toMatch(/Button/i);
    expect(r.sourceCheckpointIds).toEqual(["cp_after"]);
    expect(r.oracle).toMatchObject({ kind: "build", command: "npm run build" });
    expect(r.steps).toEqual([
      { kind: "write_file", path: "src/Button.tsx", blobHash: HASH_A, checkpointId: "cp_after" },
      { kind: "write_file", path: "src/index.ts", blobHash: HASH_B, baseBlobHash: HASH_A, checkpointId: "cp_after" },
      { kind: "command", command: "npm test" },
    ]);
    expect(r.preconditions).toEqual(
      expect.arrayContaining([
        { kind: "file_absent", value: "src/Button.tsx" },
        { kind: "file_exists", value: "src/index.ts" },
        { kind: "clean_paths", value: "src/Button.tsx" },
        { kind: "clean_paths", value: "src/index.ts" },
      ]),
    );
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
    const many = Array.from({ length: 51 }, (_, i) => ({ path: `src/f${i}.ts`, hash: HASH_A }));
    const oversized = await captureRecipeFromTurn(deps(many), turn(events));
    expect(oversized.captured).toBe(true);
    if (oversized.captured) {
      expect(oversized.recipe.steps.filter((s) => s.kind === "write_file")).toHaveLength(50);
    }
  });

  it("drops lockfile churn so a small source edit still captures", async () => {
    const events = [edit(11, { oracle: pass })];
    const res = await captureRecipeFromTurn(
      deps([
        { path: "src/Button.tsx", hash: HASH_A },
        { path: "package-lock.json", hash: HASH_B },
        { path: "dist/app.js", hash: HASH_B },
      ]),
      turn(events),
    );
    expect(res.captured).toBe(true);
    if (!res.captured) return;
    expect(res.recipe.steps.map((s) => s.path)).toEqual(["src/Button.tsx"]);
  });

  it("never stores a .env edit, even next to a normal file", async () => {
    const events = [edit(11, { oracle: pass })];
    const res = await captureRecipeFromTurn(
      deps([
        { path: "src/Button.tsx", hash: HASH_A },
        { path: ".env", hash: HASH_B },
      ]),
      turn(events),
    );
    expect(res).toEqual({ captured: false, reason: "secret_detected" });
    expect(await store.list()).toHaveLength(0);
  });

  it("captures a truncated turn using the marked before-checkpoint", async () => {
    const events = Array.from({ length: SOUL_HISTORY_CAP }, (_, i) => edit(11 + i, { oracle: pass }));
    const res = await captureRecipeFromTurn(deps([{ path: "src/Button.tsx", hash: HASH_A }]), {
      ...turn(events),
      turnStartCheckpointId: "cp_turn_start",
    });
    expect(res.captured).toBe(true);
  });

  it("uses finishTurn tools when soul history missed the write (plan-apply)", async () => {
    const res = await captureRecipeFromTurn(deps([{ path: "src/Button.tsx", hash: HASH_A }]), {
      ...turn([]),
      events: [
        {
          episodicId: 11,
          kind: "tool_success",
          toolName: "builtin_read_file",
          files: [],
          workspaceCheckpointId: "cp_before",
          oracle: pass,
        },
      ],
      turnTools: [{ name: "builtin_edit_file", status: "done", args: { filepath: "src/Button.tsx" } }],
    });
    expect(res.captured).toBe(true);
  });

  it("stores a command-only recipe when opted in", async () => {
    const events: TurnSoulEvent[] = [
      {
        episodicId: 11,
        kind: "tool_success",
        toolName: "builtin_run_terminal_command",
        files: [],
        command: "npx tsc --noEmit",
        workspaceCheckpointId: "cp_before",
        oracle: { kind: "build", passed: true, command: "npx tsc --noEmit" },
      },
    ];
    const res = await captureRecipeFromTurn(deps([]), {
      ...turn(events),
      allowCommandRecipes: true,
    });
    expect(res.captured).toBe(true);
    if (!res.captured) return;
    expect(res.recipe.steps).toEqual([{ kind: "command", command: "npx tsc --noEmit" }]);
  });

  it("records delete_file steps when the turn deleted a file", async () => {
    const events = [edit(11, { oracle: pass })];
    const res = await captureRecipeFromTurn(
      deps([
        { path: "src/Button.tsx", hash: HASH_A },
        { path: "src/old.ts", deleted: true, baseHash: HASH_B },
      ]),
      turn(events),
    );
    expect(res.captured).toBe(true);
    if (!res.captured) return;
    expect(res.recipe.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "write_file", path: "src/Button.tsx", blobHash: HASH_A }),
        expect.objectContaining({ kind: "delete_file", path: "src/old.ts", baseBlobHash: HASH_B }),
      ]),
    );
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

  it("extracts slots when a second similar success lands (P1.2)", async () => {
    const events = [edit(11, { oracle: pass })];
    const first = await captureRecipeFromTurn(
      deps([{ path: "src/Button.tsx", hash: HASH_A }]),
      turn(events, { userMessage: "Create a React component Button" }),
    );
    expect(first.captured).toBe(true);
    const second = await captureRecipeFromTurn(
      deps([{ path: "src/Card.tsx", hash: HASH_B }]),
      turn(events, { userMessage: "Create a React component Card" }),
    );
    expect(second.captured).toBe(true);
    if (!second.captured) return;
    expect(second.recipe.slots).toEqual([
      { name: "componentName", kind: "identifier", examples: ["Button", "Card"] },
    ]);
    expect(second.recipe.slotValues).toEqual({ componentName: "Card" });
    expect(second.recipe.familyId).toBeTruthy();
    const peer = await store.get(first.captured ? first.recipe.id : "");
    expect(peer?.familyId).toBe(second.recipe.familyId);
    expect(peer?.slotValues).toEqual({ componentName: "Button" });
    expect(second.recipe.status).toBe("verified");
    expect(peer?.status).toBe("verified");
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

describe("extractReplayableCommands / recipeTitleFromIntent", () => {
  it("keeps safe unique terminal commands and drops the oracle command, network, and secrets", () => {
    const events: TurnSoulEvent[] = [
      { episodicId: 11, kind: "tool_success", toolName: "builtin_run_terminal_command", files: [], command: "npm test" },
      { episodicId: 12, kind: "tool_success", toolName: "builtin_run_terminal_command", files: [], command: "npm test" },
      {
        episodicId: 13,
        kind: "tool_success",
        toolName: "builtin_run_terminal_command",
        files: [],
        command: "curl https://example.com",
      },
      {
        episodicId: 14,
        kind: "tool_success",
        toolName: "builtin_run_terminal_command",
        files: [],
        summary: "Background job sh_1 exited 0: npx tsc --noEmit",
      },
    ];
    expect(extractReplayableCommands(events, 10, "npm test")).toEqual(["npx tsc --noEmit"]);
  });

  it("names the recipe from the intent and the files", () => {
    expect(recipeTitleFromIntent("please create a Button component", ["src/Button.tsx"])).toMatch(/Button/);
    expect(recipeTitleFromIntent("please create a Button component", ["src/Button.tsx"])).toContain("Button.tsx");
  });
});
