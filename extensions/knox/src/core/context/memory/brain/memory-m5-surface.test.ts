/**
 * MEM-37 — one M₅ surface. Leftover brain_procedures / BasalGanglia writes
 * yield when a live recipe owns the same intent fingerprint.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { intentFingerprint } from "../recipes/intentFingerprint.js";

const testDir = path.join(os.tmpdir(), `brain-mem37-${Date.now()}`);

const HOW_TO = "how to setup the login workflow";

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let ContextSections: typeof import("./ContextSections.js").ContextSections;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;
let BasalGanglia: typeof import("./regions/BasalGanglia.js").BasalGanglia;
let calculateAddressableMemory: typeof import("./MemoryHierarchy.js").calculateAddressableMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ ContextSections } = await import("./ContextSections.js"));
  ({ Hippocampus } = await import("./regions/Hippocampus.js"));
  ({ BasalGanglia } = await import("./regions/BasalGanglia.js"));
  ({ calculateAddressableMemory } = await import("./MemoryHierarchy.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("learning_enabled", "true");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_procedures");
  await db.exec("DELETE FROM brain_learning_patterns");
  try {
    await db.exec("DELETE FROM brain_recipe_steps");
    await db.exec("DELETE FROM brain_recipes");
  } catch {
    // Recipe tables may be absent on a stripped fixture.
  }
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
}

function recipeIndexTokens(title: string, intent: string): number {
  return Math.floor((title.length + intent.length) / 4);
}

function procedureTokens(input: {
  name: string;
  description: string;
  steps: string[];
  trigger_pattern: string;
}): number {
  return Math.floor(
    (input.name.length +
      input.description.length +
      JSON.stringify(input.steps).length +
      input.trigger_pattern.length) /
      4,
  );
}

async function insertRecipe(opts: {
  id: string;
  title: string;
  intent: string;
  fingerprint?: string;
  status?: string;
  memoryId?: number | null;
  sessionId?: string | null;
}): Promise<void> {
  const db = await BrainStore.get();
  await db.run(
    `INSERT INTO brain_recipes (id, title, intent_text, intent_fingerprint, memory_id, status, source_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.title,
      opts.intent,
      opts.fingerprint ?? intentFingerprint(opts.intent),
      opts.memoryId ?? null,
      opts.status ?? "verified",
      opts.sessionId ?? null,
    ],
  );
}

async function insertLoginProcedure(): Promise<{
  name: string;
  description: string;
  steps: string[];
  trigger_pattern: string;
}> {
  const proc = {
    name: "Setup login workflow",
    description: HOW_TO,
    steps: ["open settings", "save login"],
    trigger_pattern: HOW_TO,
  };
  await BrainManager.storeProcedure({ ...proc, category: "general" });
  return proc;
}

describe("MEM-37 one M5 surface", () => {
  it("skips leftover procedure inject when a live recipe owns the fingerprint", async () => {
    await reset();
    await insertLoginProcedure();
    const uncovered = await ContextSections.collectProcedureCandidates(HOW_TO);
    expect(uncovered.some((c) => c.kind === "procedure")).toBe(true);

    await insertRecipe({
      id: "r-login",
      title: "Setup login",
      intent: HOW_TO,
    });
    const covered = await ContextSections.collectProcedureCandidates(HOW_TO);
    expect(covered).toEqual([]);

    const built = await ContextBuilder.buildDetailed({
      message: HOW_TO,
      include_graph: false,
      include_patterns: false,
    });
    expect(built.items.some((item) => item.kind === "procedure")).toBe(false);
  });

  it("does not apply the how-to leftover boost when a recipe covers the query", async () => {
    await reset();
    const uncovered = ContextSections.computeBudget(HOW_TO, 4000);
    const hello = ContextSections.computeBudget("hello", 4000);
    expect(uncovered.procedures).toBeGreaterThan(hello.procedures);

    await insertRecipe({
      id: "r-howto",
      title: "Setup login",
      intent: HOW_TO,
    });
    const live = await ContextSections.computeBudgetForQuery(HOW_TO, 4000);
    const suppressed = ContextSections.computeBudget(HOW_TO, 4000, { coveredByRecipe: true });
    expect(live.procedures).toBe(suppressed.procedures);
    expect(live.procedures).toBeLessThan(uncovered.procedures);
  });

  it("counts leftover procedure tokens in M5 only when no recipe covers them", async () => {
    await reset();
    const proc = await insertLoginProcedure();
    const leftoverTokens = procedureTokens(proc);
    const before = await calculateAddressableMemory();
    expect(before.m5_tokens).toBe(leftoverTokens);

    const title = "Setup login";
    await insertRecipe({ id: "r-m5", title, intent: HOW_TO });
    const after = await calculateAddressableMemory();
    expect(after.m5_tokens).toBe(recipeIndexTokens(title, HOW_TO));
    expect(after.m5_tokens).not.toBe(leftoverTokens + recipeIndexTokens(title, HOW_TO));
    expect(after.c_addr).toBe(after.m3_tokens + after.m4_tokens + after.m5_tokens);
  });

  it("Hippocampus persist skips leftover learning when a recipe shares the fingerprint", async () => {
    await reset();
    const sessionId = "mem37-hippo-fp";
    await BrainManager.trackSession(sessionId, "MEM-37 hippo", testDir);
    await BrainStore.storeSemantic({
      category: "code_pattern",
      title: "Setup login workflow",
      content: HOW_TO,
      session_id: sessionId,
    });
    await insertRecipe({
      id: "r-fp",
      title: "Setup login",
      intent: HOW_TO,
      sessionId,
    });

    const result = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 1,
      entity_count: 0,
    });
    expect(result.recipes).toBe(1);
    expect(result.procedural).toBe(0);

    const db = await BrainStore.get();
    const patterns = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_learning_patterns");
    expect(patterns?.n ?? 0).toBe(0);
  });

  it("BasalGanglia.recordSuccess is a no-op when a live recipe covers the signature", async () => {
    await reset();
    await insertRecipe({
      id: "r-success",
      title: "Setup login",
      intent: HOW_TO,
    });
    const skipped = await BasalGanglia.recordSuccess({
      goal_type: "coding",
      pattern_signature: "Setup login workflow",
      description: HOW_TO,
      success: true,
    });
    expect(skipped).toBe(0);
    const db = await BrainStore.get();
    const patterns = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_learning_patterns");
    expect(patterns?.n ?? 0).toBe(0);

    await reset();
    const written = await BasalGanglia.recordSuccess({
      goal_type: "coding",
      pattern_signature: "Unlinked leftover signature",
      description: "no recipe owns this leftover pattern yet",
      success: true,
    });
    expect(written).toBeGreaterThan(0);
  });
});
