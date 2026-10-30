/**
 * MEM-09 — live recipes (and their linked workflow once) are M₅.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem09-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;
let calculateAddressableMemory: typeof import("./MemoryHierarchy.js").calculateAddressableMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Hippocampus } = await import("./regions/Hippocampus.js"));
  ({ calculateAddressableMemory } = await import("./MemoryHierarchy.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
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

async function storedSemanticTokens(id: number): Promise<number> {
  const db = await BrainStore.get();
  const row = await db.get<{ tokens: number }>(
    `SELECT CAST((LENGTH(title) + LENGTH(content) + LENGTH(keywords)) / 4 AS INTEGER) AS tokens
     FROM brain_semantic WHERE id = ?`,
    [id],
  );
  return row?.tokens ?? 0;
}

async function insertRecipe(opts: {
  id: string;
  title: string;
  intent: string;
  status?: string;
  memoryId?: number | null;
  sessionId?: string | null;
}): Promise<void> {
  const db = await BrainStore.get();
  await db.run(
    `INSERT INTO brain_recipes (id, title, intent_text, memory_id, status, source_session_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.title,
      opts.intent,
      opts.memoryId ?? null,
      opts.status ?? "verified",
      opts.sessionId ?? null,
    ],
  );
}

describe("MEM-09 live recipes are M5", () => {
  it("counts title/intent for an unlinked live recipe and ignores retired ones", async () => {
    await reset();
    const title = "Replay login form";
    const intent = "scaffold the login form from the verified recipe";
    await insertRecipe({ id: "r-unlinked", title, intent, status: "candidate" });
    await insertRecipe({
      id: "r-retired",
      title: "Retired should not count as M5 storage",
      intent: "this retired recipe title and intent must not enter C_addr",
      status: "retired",
    });

    const hierarchy = await calculateAddressableMemory();
    expect(hierarchy.m5_tokens).toBe(recipeIndexTokens(title, intent));
    expect(hierarchy.c_addr).toBe(hierarchy.m3_tokens + hierarchy.m4_tokens + hierarchy.m5_tokens);
  });

  it("moves a linked live workflow from M4 to M5 once and does not add title/intent", async () => {
    await reset();
    const title = "Workflow once";
    const content = "linked-workflow-token-body-for-m5-once-counting";
    const memoryId = await BrainManager.store({
      category: "workflow",
      title,
      content,
      importance: 0.7,
    });
    const before = await calculateAddressableMemory();
    const leafTokens = await storedSemanticTokens(memoryId);
    expect(before.m4_tokens).toBeGreaterThanOrEqual(leafTokens);

    const recipeTitle = "Replay auth";
    const intent = "replay the auth workflow";
    await insertRecipe({
      id: "r-linked",
      title: recipeTitle,
      intent,
      memoryId,
      status: "verified",
    });
    await insertRecipe({
      id: "r-shared",
      title: "Second recipe sharing the same workflow handle",
      intent: "must not double-count the linked workflow row",
      memoryId,
      status: "quarantined",
    });

    const afterLink = await calculateAddressableMemory();
    expect(afterLink.m4_tokens).toBe(before.m4_tokens - leafTokens);
    expect(afterLink.m5_tokens).toBe(leafTokens);
    expect(afterLink.m5_tokens).not.toBe(
      leafTokens + recipeIndexTokens(recipeTitle, intent),
    );
    expect(afterLink.c_addr).toBe(before.c_addr);

    await BrainManager.forget(memoryId);
    const afterForget = await calculateAddressableMemory();
    expect(afterForget.m4_tokens).toBe(afterLink.m4_tokens);
    expect(afterForget.m5_tokens).toBe(
      recipeIndexTokens(recipeTitle, intent) +
        recipeIndexTokens(
          "Second recipe sharing the same workflow handle",
          "must not double-count the linked workflow row",
        ),
    );
    expect(afterForget.c_addr).toBe(
      afterForget.m3_tokens + afterForget.m4_tokens + afterForget.m5_tokens,
    );
  });

  it("returns a retired recipe's workflow to M4", async () => {
    await reset();
    const memoryId = await BrainManager.store({
      category: "workflow",
      title: "Retire handle",
      content: "workflow-row-that-returns-to-m4-when-recipe-retires",
      importance: 0.6,
    });
    const leafTokens = await storedSemanticTokens(memoryId);
    await insertRecipe({
      id: "r-will-retire",
      title: "Soon retired",
      intent: "retire this so the workflow is knowledge again",
      memoryId,
    });
    const linked = await calculateAddressableMemory();
    expect(linked.m5_tokens).toBe(leafTokens);

    const db = await BrainStore.get();
    await db.run(`UPDATE brain_recipes SET status = 'retired' WHERE id = 'r-will-retire'`);
    const after = await calculateAddressableMemory();
    expect(after.m5_tokens).toBe(0);
    expect(after.m4_tokens).toBe(linked.m4_tokens + leafTokens);
    expect(after.c_addr).toBe(linked.c_addr);
  });

  it("counts leftover procedures in M5 without recipe blob bytes", async () => {
    await reset();
    const name = "Leftover procedure";
    const description = "still counted until MEM-37 folds procedures into recipes";
    const steps = ["step-one", "step-two"];
    const trigger = "when leftover procedures remain";
    await BrainManager.storeProcedure({
      name,
      description,
      steps,
      trigger_pattern: trigger,
      category: "general",
    });
    const procedureTokens = Math.floor(
      (name.length + description.length + JSON.stringify(steps).length + trigger.length) / 4,
    );

    await insertRecipe({
      id: "r-with-blob",
      title: "Has a blob",
      intent: "blob bytes are not C_addr",
    });
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_recipe_steps (recipe_id, seq, kind, path, blob_hash, checkpoint_id)
       VALUES ('r-with-blob', 0, 'write_file', 'src/auth.ts', ?, 'cp-1')`,
      ["a".repeat(64)],
    );

    const hierarchy = await calculateAddressableMemory();
    expect(hierarchy.m5_tokens).toBe(
      recipeIndexTokens("Has a blob", "blob bytes are not C_addr") + procedureTokens,
    );
    expect(hierarchy.c_addr).toBe(hierarchy.m3_tokens + hierarchy.m4_tokens + hierarchy.m5_tokens);
  });

  it("Hippocampus persist reports recipes as M5 and skips leftover writes for a linked pattern", async () => {
    await reset();
    const sessionId = "mem09-hippo";
    await BrainManager.trackSession(sessionId, "MEM-09 hippo", testDir);
    const patternId = await BrainStore.storeSemantic({
      category: "code_pattern",
      title: "LinkedPatternSignatureForM5",
      content: "code pattern already used as a recipe lexical handle",
      session_id: sessionId,
    });
    await insertRecipe({
      id: "r-pattern",
      title: "Linked pattern recipe",
      intent: "this recipe is the product M5",
      memoryId: patternId,
      sessionId,
    });

    const result = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 1,
      entity_count: 0,
    });
    expect(result.recipes).toBe(1);
    expect(result.procedural).toBe(0);

    const db = await BrainStore.get();
    const procedures = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_procedures");
    const patterns = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_learning_patterns");
    expect(procedures?.n ?? 0).toBe(0);
    expect(patterns?.n ?? 0).toBe(0);

    const hierarchy = await calculateAddressableMemory();
    expect(hierarchy.m5_tokens).toBe(await storedSemanticTokens(patternId));
    expect(hierarchy.m4_tokens).toBe(0);
  });

  it("Hippocampus persist still records leftover learning for an unlinked code_pattern", async () => {
    await reset();
    const sessionId = "mem09-leftover";
    await BrainManager.trackSession(sessionId, "MEM-09 leftover", testDir);
    await BrainStore.storeSemantic({
      category: "code_pattern",
      title: "UnlinkedPatternSignatureForLearning",
      content: "no recipe owns this pattern yet",
      session_id: sessionId,
    });

    const result = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 1,
      entity_count: 0,
    });
    expect(result.recipes).toBe(0);
    expect(result.procedural).toBe(1);

    const db = await BrainStore.get();
    const procedures = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_procedures");
    const patterns = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_learning_patterns");
    expect(procedures?.n ?? 0).toBe(0);
    expect(patterns?.n ?? 0).toBe(1);
  });
});
