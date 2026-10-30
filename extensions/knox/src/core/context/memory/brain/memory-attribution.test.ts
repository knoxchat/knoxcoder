/**
 * MEM-17 — attribution log and `[mem:id]` cites.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-attr-${Date.now()}`);

let Attribution: typeof import("./attribution.js").Attribution;
let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let buildRecipeHint: typeof import("../recipes/recipeHint.js").buildRecipeHint;
let buildRecipeStub: typeof import("../recipes/recipeHint.js").buildRecipeStub;

const TOKEN = "quartzmem17attrleaf";
const AGED = "2020-01-15T12:00:00.000Z";

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ Attribution } = await import("./attribution.js"));
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ buildRecipeHint, buildRecipeStub } = await import("../recipes/recipeHint.js"));

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
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
  MemoryPipeline.resetInjectStateForTests();
}

async function storeFact(sessionId: string): Promise<number> {
  await BrainManager.trackSession(sessionId, "MEM-17 attr", testDir);
  const id = await BrainManager.store({
    category: "fact",
    title: `Login ${TOKEN} oauth jwt refresh`,
    content: `The ${TOKEN} oauth-jwt-refresh service stores login facts for the session module.`,
    keywords: `${TOKEN}, oauth, jwt, refresh, login`,
    importance: 0.99,
    session_id: sessionId,
  });
  const db = await BrainStore.get();
  await db.run("UPDATE brain_semantic SET last_accessed_at = ? WHERE id = ?", [AGED, id]);
  return id;
}

async function semanticState(id: number): Promise<{
  stability: number;
  difficulty: number;
  helpful_count: number;
  unhelpful_count: number;
}> {
  const db = await BrainStore.get();
  const row = await db.get<{
    stability: number;
    difficulty: number;
    helpful_count: number;
    unhelpful_count: number;
  }>(
    "SELECT stability, difficulty, helpful_count, unhelpful_count FROM brain_semantic WHERE id = ?",
    [id],
  );
  if (!row) throw new Error(`missing semantic ${id}`);
  return row;
}

describe("MEM-17 attribution log and [mem:id] cites", () => {
  it("formats and parses stable cite tokens", () => {
    expect(Attribution.memoryCiteToken("semantic", 42)).toBe("[mem:semantic:42]");
    expect(Attribution.memoryCiteToken("recipe", "abc-def")).toBe("[mem:recipe:abc-def]");
    const parsed = Attribution.parseMemoryCites(
      "Used [mem:semantic:42] and [mem:recipe:deadbeef] plus junk [mem:other:1] [mem:semantic:0]",
    );
    expect(parsed).toEqual([
      { type: "semantic", mem_id: "42", token: "[mem:semantic:42]" },
      { type: "recipe", mem_id: "deadbeef", token: "[mem:recipe:deadbeef]" },
    ]);
  });

  it("parses product attribute targets and helpful flags", () => {
    expect(Attribution.parseAttributeTarget(42)).toEqual({
      type: "semantic",
      mem_id: "42",
      token: "[mem:semantic:42]",
    });
    expect(Attribution.parseAttributeTarget("[mem:recipe:deadbeef]")).toEqual({
      type: "recipe",
      mem_id: "deadbeef",
      token: "[mem:recipe:deadbeef]",
    });
    expect(Attribution.parseAttributeTarget("episodic:7")).toEqual({
      type: "episodic",
      mem_id: "7",
      token: "[mem:episodic:7]",
    });
    expect(Attribution.parseAttributeTarget(0)).toBeNull();
    expect(Attribution.parseHelpfulFlag(true)).toBe(true);
    expect(Attribution.parseHelpfulFlag("false")).toBe(false);
    expect(Attribution.parseHelpfulFlag("unhelpful")).toBe(false);
    expect(Attribution.parseHelpfulFlag("maybe")).toBeNull();
  });

  it("renders [mem:type:id] on inject lines and recipe hints", async () => {
    await reset();
    const sessionId = "mem17-cite-render";
    const id = await storeFact(sessionId);
    const built = await ContextBuilder.buildDetailed({
      message: `${TOKEN} oauth jwt refresh login`,
      session_id: sessionId,
    });
    const cite = `[mem:semantic:${id}]`;
    expect(built.context).toContain(cite);
    expect(built.context).toContain("[mem:type:id]");
    const item = built.items.find((row) => row.id === id);
    expect(item?.cite).toBe(cite);
    expect(item?.mem_id).toBe(String(id));

    const recipe = {
      id: "abcdef123456",
      title: "Add Button",
      intentText: "",
      slots: [],
      preconditions: [],
      oracle: { kind: "build", passedAt: "" },
      stats: { replays: 1, ok: 1, reverted: 0, failedVerify: 0 },
      steps: [{ kind: "command", command: "npm test" }],
    } as unknown as import("../recipes/types.js").Recipe;
    expect(buildRecipeStub(recipe)).toContain("[mem:recipe:abcdef123456]");
    expect(await buildRecipeHint(recipe, async () => undefined)).toContain("[mem:recipe:abcdef123456]");
  });

  it("cited + turn succeeded increments h and raises S", async () => {
    await reset();
    const sessionId = "mem17-helpful";
    const id = await storeFact(sessionId);
    const built = await MemoryPipeline.runPreTurn({
      message: `${TOKEN} oauth jwt refresh login`,
      session_id: sessionId,
      turn_id: "t-helpful",
    });
    expect(built.context?.items.some((item) => item.id === id)).toBe(true);
    const before = await semanticState(id);

    const result = await MemoryPipeline.runPostTurn({
      message: `Reuse the login service [mem:semantic:${id}]`,
      session_id: sessionId,
      assistant_message: `Reuse the login service [mem:semantic:${id}]`,
      user_message: `${TOKEN} oauth jwt refresh login`,
      turn_id: "t-helpful",
      turn_succeeded: true,
    });
    expect(result.attribution?.cited).toBe(1);
    expect(result.attribution?.applied.helpful).toBe(1);

    const after = await semanticState(id);
    expect(after.helpful_count).toBe(1);
    expect(after.unhelpful_count).toBe(0);
    expect(after.stability).toBeGreaterThan(before.stability);
    expect(after.difficulty).toBe(5);

    const db = await BrainStore.get();
    const row = await db.get<{ injected: number; cited: number; helpful: number }>(
      "SELECT injected, cited, helpful FROM brain_attribution WHERE turn_id = 't-helpful'",
    );
    expect(row).toEqual({ injected: 1, cited: 1, helpful: 1 });
  });

  it("injected-not-cited is calibration only (no h, no S)", async () => {
    await reset();
    const sessionId = "mem17-uncited";
    const id = await storeFact(sessionId);
    await MemoryPipeline.runPreTurn({
      message: `${TOKEN} oauth jwt refresh login`,
      session_id: sessionId,
      turn_id: "t-uncited",
    });
    const before = await semanticState(id);

    const result = await MemoryPipeline.runPostTurn({
      message: "I will look at the files without citing memory.",
      session_id: sessionId,
      assistant_message: "I will look at the files without citing memory.",
      turn_id: "t-uncited",
      turn_succeeded: true,
    });
    expect(result.attribution?.injected).toBeGreaterThanOrEqual(1);
    expect(result.attribution?.cited).toBe(0);
    expect(result.attribution?.applied.helpful).toBe(0);

    const after = await semanticState(id);
    expect(after).toEqual(before);

    const db = await BrainStore.get();
    const row = await db.get<{ injected: number; cited: number; helpful: number | null }>(
      "SELECT injected, cited, helpful FROM brain_attribution WHERE turn_id = 't-uncited' AND mem_id = ?",
      [String(id)],
    );
    expect(row).toEqual({ injected: 1, cited: 0, helpful: null });
  });

  it("next user turn without correction accepts a pending cite (delayed helpful)", async () => {
    await reset();
    const sessionId = "mem17-delayed";
    const id = await storeFact(sessionId);
    await MemoryPipeline.runPreTurn({
      message: `${TOKEN} oauth jwt refresh login`,
      session_id: sessionId,
      turn_id: "t-delay-1",
    });
    await MemoryPipeline.runPostTurn({
      message: `Used [mem:semantic:${id}] for the login path.`,
      session_id: sessionId,
      assistant_message: `Used [mem:semantic:${id}] for the login path.`,
      turn_id: "t-delay-1",
    });
    const pending = await semanticState(id);
    expect(pending.helpful_count).toBe(0);
    expect(pending.stability).toBe(14);

    await MemoryPipeline.runPreTurn({
      message: "next, add rate limiting to that login path",
      session_id: sessionId,
      turn_id: "t-delay-2",
    });
    const after = await semanticState(id);
    expect(after.helpful_count).toBe(1);
    expect(after.stability).toBeGreaterThan(14);

    const db = await BrainStore.get();
    const row = await db.get<{ helpful: number }>(
      "SELECT helpful FROM brain_attribution WHERE turn_id = 't-delay-1'",
    );
    expect(row?.helpful).toBe(1);
  });

  it("next user turn correction increments u and applies FSRS harmful", async () => {
    await reset();
    const sessionId = "mem17-correct";
    const id = await storeFact(sessionId);
    await MemoryPipeline.runPreTurn({
      message: `${TOKEN} oauth jwt refresh login`,
      session_id: sessionId,
      turn_id: "t-ok",
    });
    await MemoryPipeline.runPostTurn({
      message: `Use [mem:semantic:${id}] for oauth.`,
      session_id: sessionId,
      assistant_message: `Use [mem:semantic:${id}] for oauth.`,
      turn_id: "t-ok",
      turn_succeeded: true,
    });
    const helped = await semanticState(id);
    expect(helped.helpful_count).toBe(1);
    expect(helped.stability).toBeGreaterThan(14);

    await MemoryPipeline.runPreTurn({
      message: `that's wrong, we do not use ${TOKEN} oauth-jwt-refresh`,
      session_id: sessionId,
      turn_id: "t-fix",
    });
    const after = await semanticState(id);
    expect(after.helpful_count).toBe(1);
    expect(after.unhelpful_count).toBe(1);
    expect(after.stability).toBeCloseTo(helped.stability * 0.3, 8);
    expect(after.difficulty).toBe(6);

    const db = await BrainStore.get();
    const row = await db.get<{ helpful: number }>(
      "SELECT helpful FROM brain_attribution WHERE turn_id = 't-ok'",
    );
    expect(row?.helpful).toBe(0);
  });

  it("re-attributing the same turn does not double-count h", async () => {
    await reset();
    const sessionId = "mem17-idem";
    const id = await storeFact(sessionId);
    await MemoryPipeline.runPreTurn({
      message: `${TOKEN} oauth jwt refresh login`,
      session_id: sessionId,
      turn_id: "t-idem",
    });
    const input = {
      message: `cite [mem:semantic:${id}]`,
      session_id: sessionId,
      assistant_message: `cite [mem:semantic:${id}]`,
      turn_id: "t-idem",
      turn_succeeded: true,
    };
    await MemoryPipeline.runPostTurn(input);
    const once = await semanticState(id);
    await MemoryPipeline.runPostTurn(input);
    const twice = await semanticState(id);
    expect(twice.helpful_count).toBe(1);
    expect(twice.stability).toBe(once.stability);
  });

  it("recipe cite writes attribution and does not change a semantic leaf", async () => {
    await reset();
    const sessionId = "mem17-recipe";
    const id = await storeFact(sessionId);
    MemoryPipeline.noteRecipeInject({ id: "cafebabe42", title: "Add login" });
    const before = await semanticState(id);

    const result = await MemoryPipeline.attributeTurn({
      message: "reuse the recipe [mem:recipe:cafebabe42]",
      session_id: sessionId,
      assistant_message: "reuse the recipe [mem:recipe:cafebabe42]",
      turn_id: "t-recipe",
      turn_succeeded: true,
    });
    expect(result.cited).toBe(1);
    expect(result.injected).toBe(1);
    expect(await semanticState(id)).toEqual(before);

    const db = await BrainStore.get();
    const row = await db.get<{ mem_type: string; mem_id: string; injected: number; cited: number; helpful: number }>(
      "SELECT mem_type, mem_id, injected, cited, helpful FROM brain_attribution WHERE turn_id = 't-recipe'",
    );
    expect(row).toEqual({
      mem_type: "recipe",
      mem_id: "cafebabe42",
      injected: 1,
      cited: 1,
      helpful: 1,
    });
  });

  it("attributeMemory writes the same h/u + FSRS path (MEM-19)", async () => {
    await reset();
    const sessionId = "mem19-helper";
    const id = await storeFact(sessionId);
    const before = await semanticState(id);

    const helped = await Attribution.attributeMemory({
      id,
      helpful: true,
      session_id: sessionId,
      turn_id: "tool-help",
    });
    expect(helped.ok).toBe(true);
    expect(helped.applied).toBe("helpful");
    expect(helped.cite?.token).toBe(`[mem:semantic:${id}]`);

    const afterHelp = await semanticState(id);
    expect(afterHelp.helpful_count).toBe(1);
    expect(afterHelp.stability).toBeGreaterThan(before.stability);

    const harmed = await Attribution.attributeMemory({
      id: `[mem:semantic:${id}]`,
      helpful: false,
      session_id: sessionId,
      turn_id: "tool-harm",
    });
    expect(harmed.applied).toBe("unhelpful");
    const afterHarm = await semanticState(id);
    expect(afterHarm.unhelpful_count).toBe(1);
    expect(afterHarm.stability).toBeCloseTo(afterHelp.stability * 0.3, 8);
  });
});
