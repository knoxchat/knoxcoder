/**
 * MEM-38 — index checkpoint metadata as M₃/M₄ pointer leaves.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { looksLikeCheckpointDump } from "../../soul/checkpointPointer.js";

const testDir = path.join(os.tmpdir(), `brain-mem38-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let calculateAddressableMemory: typeof import("./MemoryHierarchy.js").calculateAddressableMemory;
let pinMemoryForWorkspaceCheckpoint: typeof import("../../soul/recordSoulEvent.js").pinMemoryForWorkspaceCheckpoint;
let indexWorkspaceCheckpointMetadata: typeof import("../../soul/recordSoulEvent.js").indexWorkspaceCheckpointMetadata;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ calculateAddressableMemory } = await import("./MemoryHierarchy.js"));
  ({
    pinMemoryForWorkspaceCheckpoint,
    indexWorkspaceCheckpointMetadata,
  } = await import("../../soul/recordSoulEvent.js"));
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
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_checkpoints");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  try {
    await db.exec("DELETE FROM brain_recipe_steps");
    await db.exec("DELETE FROM brain_recipes");
  } catch {
    // Recipe tables may be absent on a stripped fixture.
  }
  (BrainManager as { workingMem?: unknown; workingMemSessionId?: string | null; activeSessionId?: string | null }).workingMem = null;
  (BrainManager as { workingMemSessionId?: string | null }).workingMemSessionId = null;
  (BrainManager as { activeSessionId?: string | null }).activeSessionId = null;
}

async function insertRecipeForCheckpoint(input: {
  recipeId: string;
  checkpointId: string;
  path: string;
}): Promise<void> {
  const db = await BrainStore.get();
  await db.run(
    `INSERT INTO brain_recipes
      (id, project_id, scope, status, title, intent_text, intent_fingerprint, created_at, updated_at)
     VALUES (?, '', 'project', 'verified', ?, ?, ?, datetime('now'), datetime('now'))`,
    [input.recipeId, "Auth recipe", "replay auth", "fp-auth"],
  );
  await db.run(
    `INSERT INTO brain_recipe_steps (recipe_id, seq, kind, path, blob_hash, checkpoint_id)
     VALUES (?, 0, 'write_file', ?, ?, ?)`,
    [input.recipeId, input.path, "a".repeat(64), input.checkpointId],
  );
}

async function leafRow(id: number): Promise<{
  content: string;
  metadata: string;
  token_count: number;
  session_id: string;
}> {
  const db = await BrainStore.get();
  const row = await db.get<{
    content: string;
    metadata: string;
    token_count: number;
    session_id: string;
  }>("SELECT content, metadata, token_count, session_id FROM brain_episodic WHERE id = ?", [id]);
  if (!row) throw new Error(`missing checkpoint leaf ${id}`);
  return row;
}

describe("MEM-38 checkpoint metadata leaves", () => {
  it("pins an upsertable pointer leaf with id, label, session, files, and recipe ids", async () => {
    await reset();
    const sessionId = "mem38-pin";
    const workspaceCheckpointId = "ws-mem38-login";
    await BrainManager.trackSession(sessionId, "MEM-38 pin", testDir);
    await insertRecipeForCheckpoint({
      recipeId: "recipe-mem38-auth",
      checkpointId: workspaceCheckpointId,
      path: "src/auth.ts",
    });

    const first = await pinMemoryForWorkspaceCheckpoint({
      workspaceCheckpointId,
      label: "workspace ws-mem38: auth fix",
      sessionId,
      files: ["src/auth.ts", "src/login.ts"],
    });
    expect(first).toBeTruthy();

    const leaf = await BrainStore.findCheckpointPointerLeaf(workspaceCheckpointId);
    expect(leaf).toBeTruthy();
    expect(leaf!.session_id).toBe(sessionId);
    expect(leaf!.content).toContain(`checkpoint_id=${workspaceCheckpointId}`);
    expect(leaf!.content).toContain("src/auth.ts");
    expect(leaf!.content).toContain("recipe-mem38-auth");
    expect(leaf!.content).toContain("workspace ws-mem38: auth fix");
    expect(leaf!.content).not.toContain("fileSnapshots");
    expect(looksLikeCheckpointDump(leaf!.content)).toBe(false);
    expect(JSON.parse(leaf!.metadata).kind).toBe("checkpoint");

    const again = await pinMemoryForWorkspaceCheckpoint({
      workspaceCheckpointId,
      label: "workspace ws-mem38: auth fix again",
      sessionId,
      files: ["src/auth.ts", "src/session.ts"],
      recipeIds: ["recipe-mem38-auth"],
    });
    expect(again).toBe(first);
    const upserted = await BrainStore.findCheckpointPointerLeaf(workspaceCheckpointId);
    expect(upserted?.id).toBe(leaf!.id);
    expect(upserted?.content).toContain("src/session.ts");
    expect(upserted?.content).toContain("recipe-mem38-auth");
  });

  it("lets fusion retrieve the turn that changed src/auth.ts", async () => {
    await reset();
    const sessionId = "mem38-fusion";
    const workspaceCheckpointId = "ws-mem38-fusion";
    await BrainManager.trackSession(sessionId, "MEM-38 fusion", testDir);
    const leafId = await indexWorkspaceCheckpointMetadata({
      workspaceCheckpointId,
      label: "auth middleware",
      sessionId,
      files: ["src/auth.ts"],
      recipeIds: ["recipe-mem38-fusion"],
    });
    expect(leafId).toBeGreaterThan(0);

    const hits = await RetrievalFusion.search({
      query: "the turn that changed src/auth.ts",
      sessionId,
      includeEpisodic: true,
      limit: 20,
    });
    const hit = hits.find((row) => row.type === "episodic" && row.id === leafId);
    expect(hit).toBeTruthy();
    expect(String((hit!.data as { content?: string }).content)).toContain("checkpoint_id=");
  });

  it("injects checkpoint_id= and does not add blob bytes to C_addr", async () => {
    await reset();
    const sessionId = "mem38-inject";
    const workspaceCheckpointId = "ws-mem38-inject";
    await BrainManager.trackSession(sessionId, "MEM-38 inject", testDir);
    const before = await calculateAddressableMemory();
    const leafId = await indexWorkspaceCheckpointMetadata({
      workspaceCheckpointId,
      memoryCheckpointId: 11,
      label: "auth fix",
      sessionId,
      files: ["src/auth.ts"],
    });
    const row = await leafRow(leafId);
    const after = await calculateAddressableMemory();

    expect(after.m4_tokens).toBe(before.m4_tokens + row.token_count);
    expect(after.c_addr).toBe(before.c_addr + row.token_count);
    expect(after.c_addr - before.c_addr).toBeLessThan(200);
    expect(row.content).not.toMatch(/[A-Fa-f0-9]{64}/);

    const built = await ContextBuilder.buildDetailed({
      message: "the turn that changed src/auth.ts",
      session_id: sessionId,
      memory_mode: "full",
    });
    expect(built.context).toContain(`checkpoint_id=${workspaceCheckpointId}`);
    expect(built.context).toContain(`[mem:episodic:${leafId}]`);
    expect(built.context).not.toContain("turn that changed:");
    expect(built.context).not.toContain("fileSnapshots");
    expect(built.context).not.toContain("snapshot_path");
    expect(looksLikeCheckpointDump(built.context)).toBe(false);
    const item = built.items.find((rowItem) => rowItem.id === leafId);
    expect(item?.cite).toBe(`[mem:episodic:${leafId}]`);
    expect(item?.kind).toBe("episodic");
  });
});
