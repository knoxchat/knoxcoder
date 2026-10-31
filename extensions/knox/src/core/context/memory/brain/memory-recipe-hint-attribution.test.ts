/**
 * MEM-39 — attribute recipe hints, not only replays.
 *
 * A cited stub/hint whose turn succeeds increments recipe leaf h; a user
 * correction or revert increments u. Same `brain_attribution` table
 * (`mem_type='recipe'`). Replay stats stay separate; Value adds both.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-hint-attr-${Date.now()}`);

let Attribution: typeof import("./attribution.js").Attribution;
let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let RecipeStore: typeof import("../recipes/RecipeStore.js").RecipeStore;
let applyReplayResult: typeof import("../recipes/feedback.js").applyReplayResult;
let attributeRecipeHint: typeof import("../recipes/feedback.js").attributeRecipeHint;
let recordRevert: typeof import("../recipes/feedback.js").recordRevert;
let recipeHelpfulCount: typeof import("../recipes/budget.js").recipeHelpfulCount;
let recipeUnhelpfulCount: typeof import("../recipes/budget.js").recipeUnhelpfulCount;
let buildRecipeStub: typeof import("../recipes/recipeHint.js").buildRecipeStub;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ Attribution } = await import("./attribution.js"));
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ RecipeStore } = await import("../recipes/RecipeStore.js"));
  ({ applyReplayResult, attributeRecipeHint, recordRevert } = await import("../recipes/feedback.js"));
  ({ recipeHelpfulCount, recipeUnhelpfulCount } = await import("../recipes/budget.js"));
  ({ buildRecipeStub } = await import("../recipes/recipeHint.js"));

  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "global");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_attribution");
  await db.exec("DELETE FROM brain_memory_outcomes");
  await db.exec("DELETE FROM brain_recipe_steps");
  await db.exec("DELETE FROM brain_recipes");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
  MemoryPipeline.resetInjectStateForTests();
}

async function seedRecipe(sessionId: string, title = "Create a Button component") {
  await BrainManager.trackSession(sessionId, "MEM-39 hint", testDir);
  const db = await BrainStore.get();
  const store = new RecipeStore(db);
  const created = await store.create({
    projectId: "p",
    title,
    intentText: title,
    intentFingerprint: `${title} mem39`,
    sourceSessionId: sessionId,
    steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "h-new" }],
    oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z" },
  });
  await store.verify(created.recipe.id);
  return { store, recipe: (await store.get(created.recipe.id))! };
}

describe("MEM-39 recipe hint attribution", () => {
  it("cited hint + turn succeeded increments recipe leaf h", async () => {
    await reset();
    const sessionId = "mem39-help";
    const { store, recipe } = await seedRecipe(sessionId);
    const stub = buildRecipeStub(recipe, { why: "similar intent" });
    MemoryPipeline.noteRecipeInject(recipe);

    const result = await MemoryPipeline.attributeTurn({
      message: `reuse ${recipe.title} [mem:recipe:${recipe.id}]`,
      session_id: sessionId,
      assistant_message: `reuse ${recipe.title} [mem:recipe:${recipe.id}]`,
      turn_id: "t-hint-ok",
      turn_succeeded: true,
      recipe_hint: stub,
    });
    expect(result.injected).toBe(1);
    expect(result.cited).toBe(1);
    expect(result.applied.helpful).toBe(1);

    const after = (await store.get(recipe.id))!;
    expect(after.helpfulCount).toBe(1);
    expect(after.unhelpfulCount ?? 0).toBe(0);
    expect(after.stats.ok).toBe(0);
    expect(recipeHelpfulCount(after)).toBe(1);

    const db = await BrainStore.get();
    const row = await db.get<{ mem_type: string; mem_id: string; injected: number; cited: number; helpful: number }>(
      "SELECT mem_type, mem_id, injected, cited, helpful FROM brain_attribution WHERE turn_id = 't-hint-ok'",
    );
    expect(row).toEqual({
      mem_type: "recipe",
      mem_id: recipe.id,
      injected: 1,
      cited: 1,
      helpful: 1,
    });
  });

  it("injected-not-cited is calibration only (no recipe h)", async () => {
    await reset();
    const sessionId = "mem39-uncited";
    const { store, recipe } = await seedRecipe(sessionId);
    MemoryPipeline.noteRecipeInject(recipe);

    const result = await MemoryPipeline.attributeTurn({
      message: "I will write the button from scratch.",
      session_id: sessionId,
      assistant_message: "I will write the button from scratch.",
      turn_id: "t-hint-skip",
      turn_succeeded: true,
      recipe_hint: buildRecipeStub(recipe),
    });
    expect(result.injected).toBe(1);
    expect(result.cited).toBe(0);
    expect(result.applied.helpful).toBe(0);

    const after = (await store.get(recipe.id))!;
    expect(after.helpfulCount ?? 0).toBe(0);
    expect(recipeHelpfulCount(after)).toBe(0);

    const db = await BrainStore.get();
    const row = await db.get<{ injected: number; cited: number; helpful: number | null }>(
      "SELECT injected, cited, helpful FROM brain_attribution WHERE turn_id = 't-hint-skip'",
    );
    expect(row).toEqual({ injected: 1, cited: 0, helpful: null });
  });

  it("next user turn correction increments recipe leaf u", async () => {
    await reset();
    const sessionId = "mem39-correct";
    const { store, recipe } = await seedRecipe(sessionId);
    MemoryPipeline.noteRecipeInject(recipe);
    await MemoryPipeline.attributeTurn({
      message: `Use [mem:recipe:${recipe.id}] for the button.`,
      session_id: sessionId,
      assistant_message: `Use [mem:recipe:${recipe.id}] for the button.`,
      turn_id: "t-hint-cited",
      turn_succeeded: true,
    });
    expect(((await store.get(recipe.id))!).helpfulCount).toBe(1);

    await MemoryPipeline.runPreTurn({
      message: `that's wrong, we do not use ${recipe.title}`,
      session_id: sessionId,
      turn_id: "t-hint-fix",
    });
    const after = (await store.get(recipe.id))!;
    expect(after.helpfulCount).toBe(1);
    expect(after.unhelpfulCount).toBe(1);
    expect(recipeUnhelpfulCount(after)).toBe(1);

    const db = await BrainStore.get();
    const row = await db.get<{ helpful: number }>(
      "SELECT helpful FROM brain_attribution WHERE turn_id = 't-hint-cited'",
    );
    expect(row?.helpful).toBe(0);
  });

  it("replay stats and hint leaf counts add for Value, and replay revert does not touch leaf h", async () => {
    await reset();
    const sessionId = "mem39-both";
    const { store, recipe } = await seedRecipe(sessionId);

    await applyReplayResult(store, {
      status: "applied",
      recipeId: recipe.id,
      restored: false,
      appliedPaths: [],
      driftedPaths: [],
      outcome: "ok",
    });
    const afterReplay = (await store.get(recipe.id))!;
    expect(afterReplay.stats.ok).toBe(1);
    expect(afterReplay.helpfulCount ?? 0).toBe(0);
    expect(recipeHelpfulCount(afterReplay)).toBe(1);

    MemoryPipeline.noteRecipeInject(recipe);
    await MemoryPipeline.attributeTurn({
      message: `reuse [mem:recipe:${recipe.id}]`,
      session_id: sessionId,
      assistant_message: `reuse [mem:recipe:${recipe.id}]`,
      turn_id: "t-hint-plus",
      turn_succeeded: true,
    });
    const afterHint = (await store.get(recipe.id))!;
    expect(afterHint.stats.ok).toBe(1);
    expect(afterHint.helpfulCount).toBe(1);
    expect(recipeHelpfulCount(afterHint)).toBe(2);

    await recordRevert(store, recipe.id, new Date());
    const afterRevert = (await store.get(recipe.id))!;
    expect(afterRevert.stats.ok).toBe(0);
    expect(afterRevert.stats.reverted).toBe(1);
    expect(afterRevert.helpfulCount).toBe(1);
    expect(recipeHelpfulCount(afterRevert)).toBe(1);
    expect(recipeUnhelpfulCount(afterRevert)).toBe(1);
  });

  it("attributeRecipeHint / attributeMemory write the same recipe leaf path", async () => {
    await reset();
    const sessionId = "mem39-tool";
    const { store, recipe } = await seedRecipe(sessionId);

    const helped = await attributeRecipeHint({
      recipeId: recipe.id,
      helpful: true,
      session_id: sessionId,
      turn_id: "tool-hint-ok",
    });
    expect(helped.ok).toBe(true);
    expect(helped.applied).toBe("helpful");
    expect(((await store.get(recipe.id))!).helpfulCount).toBe(1);

    const harmed = await Attribution.attributeMemory({
      id: `[mem:recipe:${recipe.id}]`,
      helpful: false,
      session_id: sessionId,
      turn_id: "tool-hint-bad",
    });
    expect(harmed.applied).toBe("unhelpful");
    const after = (await store.get(recipe.id))!;
    expect(after.helpfulCount).toBe(1);
    expect(after.unhelpfulCount).toBe(1);

    const db = await BrainStore.get();
    const rows = await db.all<{ mem_type: string; helpful: number }[]>(
      "SELECT mem_type, helpful FROM brain_attribution WHERE mem_id = ? ORDER BY id",
      [recipe.id],
    );
    expect(rows).toEqual([
      { mem_type: "recipe", helpful: 1 },
      { mem_type: "recipe", helpful: 0 },
    ]);
  });

  it("re-attributing the same hint turn does not double-count h", async () => {
    await reset();
    const sessionId = "mem39-idem";
    const { store, recipe } = await seedRecipe(sessionId);
    MemoryPipeline.noteRecipeInject(recipe);
    const input = {
      message: `cite [mem:recipe:${recipe.id}]`,
      session_id: sessionId,
      assistant_message: `cite [mem:recipe:${recipe.id}]`,
      turn_id: "t-hint-idem",
      turn_succeeded: true,
    };
    await MemoryPipeline.attributeTurn(input);
    await MemoryPipeline.attributeTurn(input);
    expect(((await store.get(recipe.id))!).helpfulCount).toBe(1);
  });
});
