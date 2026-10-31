/**
 * Memory checkpoint completeness, pairing, strategy persist, and crash-safe rollback.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-checkpoint-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let CheckpointManager: typeof import("./CheckpointManager.js").CheckpointManager;
let RecipeStore: typeof import("../recipes/RecipeStore.js").RecipeStore;
let linkRecipeMemory: typeof import("../recipes/memoryLink.js").linkRecipeMemory;
let rewindMemoryForWorkspaceCheckpoint: typeof import("../../soul/recordSoulEvent.js").rewindMemoryForWorkspaceCheckpoint;
let pinMemoryForWorkspaceCheckpoint: typeof import("../../soul/recordSoulEvent.js").pinMemoryForWorkspaceCheckpoint;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ CheckpointManager } = await import("./CheckpointManager.js"));
  ({ RecipeStore } = await import("../recipes/RecipeStore.js"));
  ({ linkRecipeMemory } = await import("../recipes/memoryLink.js"));
  ({
    rewindMemoryForWorkspaceCheckpoint,
    pinMemoryForWorkspaceCheckpoint,
  } = await import("../../soul/recordSoulEvent.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_collection_items");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_associations");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_tasks");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_entities");
  await db.exec("DELETE FROM brain_learning_patterns");
  await db.exec("DELETE FROM brain_procedures");
  await db.exec("DELETE FROM brain_collections");
  await db.exec("DELETE FROM brain_audit_log");
  await db.exec("DELETE FROM brain_checkpoints");
  await db.exec("DELETE FROM brain_sessions");
  try {
    await db.exec("DELETE FROM brain_recipe_steps");
    await db.exec("DELETE FROM brain_recipes");
    await db.exec("DELETE FROM brain_memory_outcomes");
    await db.exec("DELETE FROM brain_memory_supersessions");
    await db.exec("DELETE FROM brain_attribution");
    await db.exec("DELETE FROM brain_summary_tree");
  } catch {
    // Recipe / theorem tables may be absent on a stripped fixture.
  }
  (BrainManager as any).workingMem = null;
  (BrainManager as any).workingMemSessionId = null;
  (BrainManager as any).activeSessionId = null;
  await CheckpointManager.updateConfig({
    mode: "hybrid",
    adaptive_change_threshold: 10,
    time_interval_minutes: 60,
    max_checkpoints: 20,
    max_age_days: 30,
    max_total_size_mb: 100,
    compress_snapshots: true,
  });
}

describe("memory checkpoints", () => {
  it("round-trips associations, tags, and collections on rollback", async () => {
    await reset();
    const sessionId = "cp-complete-session";
    await BrainManager.trackSession(sessionId, "Complete snapshot", testDir);

    const first = await BrainManager.store({
      category: "fact",
      title: "Alpha fact",
      content: "alpha-checkpoint-token stays after rewind",
      keywords: "alpha, checkpoint",
      session_id: sessionId,
      importance: 0.9,
    });
    const second = await BrainManager.store({
      category: "fact",
      title: "Beta fact",
      content: "beta-checkpoint-token stays after rewind",
      keywords: "beta, checkpoint",
      session_id: sessionId,
      importance: 0.9,
    });
    await BrainManager.dispatch("associate", {
      source_type: "semantic",
      source_id: first,
      target_type: "semantic",
      target_id: second,
      relationship: "related",
      strength: 0.8,
    });
    await BrainManager.dispatch("tag", {
      memory_type: "semantic",
      memory_id: first,
      tag: "pinned",
    });
    const collectionOut = await BrainManager.dispatch("create_collection", {
      name: "checkpoint-kit",
      description: "kept across rewind",
    });
    const collectionId = Number(/ID:\s*(\d+)/i.exec(collectionOut)?.[1] ?? 0);
    if (collectionId > 0) {
      await BrainManager.dispatch("add_to_collection", {
        collection_id: collectionId,
        memory_type: "semantic",
        memory_id: first,
      });
    }

    const checkpoint = await BrainManager.createCheckpoint("complete");
    const snapshot = BrainStore.readKnowledgeSnapshot(checkpoint.snapshot_path);
    expect(snapshot.version).toBe(BrainStore.KNOWLEDGE_SNAPSHOT_VERSION);
    expect(snapshot.version).toBe(3);
    expect(Array.isArray(snapshot.recipes)).toBe(true);
    expect(Array.isArray(snapshot.recipe_steps)).toBe(true);
    expect(Array.isArray(snapshot.memory_outcomes)).toBe(true);
    expect(Array.isArray(snapshot.memory_supersessions)).toBe(true);
    expect(Array.isArray(snapshot.attribution)).toBe(true);
    expect(Array.isArray(snapshot.summary_tree)).toBe(true);
    expect(snapshot.associations.length).toBeGreaterThan(0);
    expect(snapshot.tags.length).toBeGreaterThan(0);

    await BrainManager.store({
      category: "fact",
      title: "Ephemeral",
      content: "this should vanish on rollback",
      keywords: "ephemeral",
      session_id: sessionId,
      importance: 0.5,
    });
    await BrainStore.removeTag("semantic", first, "pinned");
    await BrainStore.deleteSemantic(first);

    await BrainManager.rollbackCheckpoint(checkpoint.id);

    expect(await BrainStore.getSemanticById(first)).not.toBeNull();
    expect(await BrainStore.isPinned(first)).toBe(true);
    const db = await BrainStore.get();
    const assoc = await db.get(
      "SELECT * FROM brain_associations WHERE source_id = ? AND target_id = ?",
      [first, second],
    );
    expect(assoc).toBeTruthy();
    const ephemeral = await db.get(
      "SELECT id FROM brain_semantic WHERE title = ?",
      ["Ephemeral"],
    );
    expect(ephemeral).toBeFalsy();
  });

  it("rolls back the transaction when restore fails mid-insert", async () => {
    await reset();
    const sessionId = "cp-txn-session";
    await BrainManager.trackSession(sessionId, "Txn", testDir);
    const keptId = await BrainManager.store({
      category: "fact",
      title: "Keep me",
      content: "pre-rollback-marker",
      keywords: "keep",
      session_id: sessionId,
      importance: 0.9,
    });
    const checkpoint = await BrainManager.createCheckpoint("txn");
    await BrainManager.store({
      category: "fact",
      title: "After pin",
      content: "post-checkpoint-marker",
      keywords: "after",
      session_id: sessionId,
      importance: 0.9,
    });

    const snapshot = BrainStore.readKnowledgeSnapshot(checkpoint.snapshot_path);
    snapshot.edges = [
      {
        id: 1,
        source_entity_id: 999_001,
        target_entity_id: 999_002,
        relationship: "broken",
        weight: 0.5,
        properties: "{}",
        created_at: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(checkpoint.snapshot_path, JSON.stringify(snapshot, null, 2));

    await expect(BrainManager.rollbackCheckpoint(checkpoint.id)).rejects.toThrow();
    expect(await BrainStore.getSemanticById(keptId)).not.toBeNull();
    const db = await BrainStore.get();
    const after = await db.get(
      "SELECT id FROM brain_semantic WHERE title = ?",
      ["After pin"],
    );
    expect(after).toBeTruthy();
  });

  it("persists strategy config and normalizes time_interval to time_based", async () => {
    await reset();
    await CheckpointManager.updateConfig({
      mode: "time_interval",
      time_interval_minutes: 15,
      max_checkpoints: 7,
    });
    expect(CheckpointManager.getConfig().mode).toBe("time_based");
    expect(CheckpointManager.getConfig().time_interval_minutes).toBe(15);

    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT value FROM brain_config WHERE key = ?",
      ["checkpoint_strategy"],
    ) as { value?: string } | undefined;
    expect(row?.value).toBeTruthy();
    expect(JSON.parse(row!.value!).mode).toBe("time_based");

    await CheckpointManager.updateConfig({ mode: "hybrid" });
    await CheckpointManager.hydrateFromStore();
    expect(CheckpointManager.getConfig().mode).toBe("hybrid");

    await CheckpointManager.updateConfig({ mode: "manual" });
    expect(CheckpointManager.getConfig().mode).toBe("manual");
    expect(await CheckpointManager.recordChange()).toBeNull();
    expect(await CheckpointManager.beforeDestructiveOp("delete")).toBeNull();
  });

  it("pins once per workspace checkpoint and finds the nearest earlier snapshot", async () => {
    await reset();
    const sessionId = "cp-pin-session";
    await BrainManager.trackSession(sessionId, "Pin", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Pinned knowledge",
      content: "paired-workspace-token",
      keywords: "paired",
      session_id: sessionId,
      importance: 0.9,
    });

    const first = await BrainManager.pinForWorkspaceCheckpoint(
      "ws-cp-alpha",
      "paired alpha",
    );
    expect(first).toBeTruthy();
    const again = await BrainManager.pinForWorkspaceCheckpoint(
      "ws-cp-alpha",
      "paired alpha again",
    );
    expect(again?.id).toBe(first?.id);

    const viaSoul = await pinMemoryForWorkspaceCheckpoint({
      workspaceCheckpointId: "ws-cp-alpha",
    });
    expect(viaSoul).toBe(first?.id);

    const later = await BrainManager.createCheckpoint("later unpaired");
    const db = await BrainStore.get();
    await db.run(
      "UPDATE brain_checkpoints SET created_at = ? WHERE id = ?",
      ["2026-01-01 00:00:00", first!.id],
    );
    await db.run(
      "UPDATE brain_checkpoints SET created_at = ? WHERE id = ?",
      ["2026-01-02 00:00:00", later.id],
    );
    const nearest = await BrainManager.findNearestCheckpointBefore(
      "2026-01-01 12:00:00",
    );
    expect(nearest?.id).toBe(first?.id);
  });

  it("does not evict workspace-linked snapshots during lifecycle cleanup", async () => {
    await reset();
    const sessionId = "cp-lifecycle-session";
    await BrainManager.trackSession(sessionId, "Lifecycle", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Linked",
      content: "linked-token",
      keywords: "linked",
      session_id: sessionId,
      importance: 0.9,
    });
    const linked = await BrainManager.createCheckpoint("keep me", "ws-keep");
    const extras: number[] = [];
    for (let i = 0; i < 4; i++) {
      extras.push((await BrainManager.createCheckpoint(`extra-${i}`)).id);
    }

    await CheckpointManager.updateConfig({ max_checkpoints: 1, max_age_days: 365 });
    const report = await CheckpointManager.runLifecycleCleanup();
    expect(report.deleted_by_count).toBeGreaterThan(0);

    const remaining = await BrainStore.listCheckpoints(50);
    expect(remaining.some((cp) => cp.id === linked.id)).toBe(true);
    expect(
      remaining.some((cp) => cp.workspace_checkpoint_id === "ws-keep"),
    ).toBe(true);
  });

  it("rewinds a linked brain checkpoint and records delete rows for undo", async () => {
    await reset();
    const sessionId = "cp-rewind-session";
    await BrainManager.trackSession(sessionId, "Rewind", testDir);
    const original = await BrainManager.store({
      category: "fact",
      title: "Original",
      content: "rewind-original-token",
      keywords: "original",
      session_id: sessionId,
      importance: 0.9,
    });
    const pinned = await BrainManager.pinForWorkspaceCheckpoint(
      "ws-rewind",
      "rewind pin",
    );
    expect(pinned).toBeTruthy();

    const later = await BrainManager.store({
      category: "fact",
      title: "Later",
      content: "rewind-later-token",
      keywords: "later",
      session_id: sessionId,
      importance: 0.9,
    });
    await BrainManager.recordMessage(sessionId, "user", "after checkpoint turn", {
      importance: 0.5,
    });

    const result = await rewindMemoryForWorkspaceCheckpoint({
      sessionId,
      workspaceCheckpointId: "ws-rewind",
      createdAt: pinned!.created_at,
    });
    expect(result.rewound).toBe(true);
    expect(result.memoryCheckpointId).toBe(pinned?.id);
    expect(await BrainStore.getSemanticById(original)).not.toBeNull();
    expect(await BrainStore.getSemanticById(later)).toBeNull();

    await BrainManager.forget(original);
    const forgotten = await BrainStore.getSemanticById(original);
    expect(forgotten).not.toBeNull();
    expect(forgotten?.tombstoned_at).toBeTruthy();
    const undoable = await CheckpointManager.getUndoableOperations(20);
    const deleteEntry = undoable.find(
      (entry) =>
        (entry.action === "tombstone" || entry.action === "delete")
        && String(entry.target_id) === String(original),
    );
    expect(deleteEntry).toBeTruthy();
    const undone = await CheckpointManager.undoOperation(deleteEntry!.id);
    expect(undone.success).toBe(true);
    const restored = await BrainStore.getSemanticById(original);
    expect(restored).not.toBeNull();
    expect(restored?.tombstoned_at).toBeFalsy();
  });

  it("prunes checkpoint rows whose snapshot files are missing", async () => {
    await reset();
    const sessionId = "cp-prune-session";
    await BrainManager.trackSession(sessionId, "Prune", testDir);
    const checkpoint = await BrainManager.createCheckpoint("missing file");
    fs.unlinkSync(checkpoint.snapshot_path);
    const health = await BrainStore.getHealth();
    expect(health.issues.some((issue) => issue.includes("snapshot"))).toBe(true);
    const pruned = await BrainStore.pruneMissingCheckpointSnapshots();
    expect(pruned).toBe(1);
    const remaining = await BrainStore.listCheckpoints(20);
    expect(remaining.some((cp) => cp.id === checkpoint.id)).toBe(false);
  });

  it("useSessionAsContext pins semantic rows into working memory without a new store", async () => {
    await reset();
    const sessionId = "reuse-as-context";
    await BrainManager.trackSession(sessionId, "Reuse session", testDir);
    const memoryId = await BrainManager.store({
      category: "decision",
      title: "Reuse JWT",
      content: "Session reuse pins this JWT decision",
      keywords: "jwt, reuse",
      session_id: sessionId,
    });
    const semanticBefore = await BrainStore.getSemanticBySession(sessionId, 20);
    const result = await BrainManager.useSessionAsContext(sessionId);
    expect(result.ok).toBe(true);
    expect(result.pinned).toBeGreaterThanOrEqual(1);
    expect(result.workingMemory).toBeGreaterThanOrEqual(1);
    expect(await BrainStore.isPinned(memoryId)).toBe(true);
    const wm = BrainManager.getWorkingMemory();
    expect(
      wm.getAll().some((item) => item.content.includes("Session reuse pins this JWT decision")),
    ).toBe(true);
    const semanticAfter = await BrainStore.getSemanticBySession(sessionId, 20);
    expect(semanticAfter.length).toBe(semanticBefore.length);
  });

  it("rewinds recipes, outcomes, and supersessions with the workflow memory (MEM-36)", async () => {
    await reset();
    const sessionId = "cp-mem36-session";
    await BrainManager.trackSession(sessionId, "MEM-36 rewind", testDir);
    const captured = await captureVerifiedRecipe({
      sessionId,
      title: "Replay login form",
      intent: "scaffold the login form from the verified recipe",
    });
    const db = await BrainStore.get();
    await db.run(
      "INSERT INTO brain_memory_outcomes (memory_id, verified_count, revert_count) VALUES (?, 2, 0)",
      [captured.memoryId],
    );
    await db.run(
      "INSERT INTO brain_memory_supersessions (old_id, new_id, reason) VALUES (?, ?, ?)",
      [captured.memoryId, captured.memoryId + 100, "mem36-supersede"],
    );
    await db.run(
      `INSERT INTO brain_attribution (turn_id, session_id, mem_type, mem_id, injected, cited, helpful)
       VALUES ('t-mem36', ?, 'recipe', ?, 1, 1, 1)`,
      [sessionId, captured.id],
    );
    await db.run(
      "INSERT INTO brain_summary_tree (kind, text, token_count) VALUES ('node', 'mem36-tree', 4)",
    );

    const pinned = await BrainManager.pinForWorkspaceCheckpoint(
      "ws-mem36",
      "recipe capture",
    );
    expect(pinned).toBeTruthy();
    const snapshot = BrainStore.readKnowledgeSnapshot(pinned!.snapshot_path);
    expect(snapshot.version).toBe(3);
    expect(snapshot.recipes.some((row: { id: string }) => row.id === captured.id)).toBe(true);
    expect(snapshot.recipe_steps.some((row: { path: string }) => row.path === "src/auth.ts")).toBe(true);
    expect(snapshot.memory_outcomes.some((row: { memory_id: number }) => row.memory_id === captured.memoryId)).toBe(true);
    expect(snapshot.memory_supersessions.some((row: { reason: string }) => row.reason === "mem36-supersede")).toBe(true);
    expect(snapshot.attribution.some((row: { mem_id: string }) => row.mem_id === captured.id)).toBe(true);
    expect(snapshot.summary_tree.some((row: { text: string }) => row.text === "mem36-tree")).toBe(true);

    const laterFact = await BrainManager.store({
      category: "fact",
      title: "After recipe pin",
      content: "post-recipe-checkpoint-token",
      keywords: "after",
      session_id: sessionId,
      importance: 0.5,
    });
    const laterRecipe = await captureVerifiedRecipe({
      sessionId,
      title: "Later recipe",
      intent: "this recipe is captured after the pin and must vanish",
    });
    await db.run("DELETE FROM brain_recipe_steps WHERE recipe_id = ?", [captured.id]);
    await db.run("DELETE FROM brain_recipes WHERE id = ?", [captured.id]);
    await BrainStore.deleteSemantic(captured.memoryId);

    const result = await rewindMemoryForWorkspaceCheckpoint({
      sessionId,
      workspaceCheckpointId: "ws-mem36",
      createdAt: pinned!.created_at,
    });
    expect(result.rewound).toBe(true);
    expect(result.memoryCheckpointId).toBe(pinned?.id);

    const store = new RecipeStore(await BrainStore.get());
    const recipe = await store.get(captured.id);
    expect(recipe).not.toBeNull();
    expect(recipe?.status).toBe("verified");
    expect(recipe?.steps.some((step) => step.path === "src/auth.ts")).toBe(true);
    expect(recipe?.memoryId).toBeTruthy();
    expect(await BrainStore.getSemanticById(recipe!.memoryId!)).not.toBeNull();
    expect(await store.get(laterRecipe.id)).toBeNull();
    expect(await BrainStore.getSemanticById(laterFact)).toBeNull();

    const after = await BrainStore.get();
    expect(
      await after.get("SELECT * FROM brain_memory_outcomes WHERE memory_id = ?", [captured.memoryId]),
    ).toBeTruthy();
    expect(
      await after.get("SELECT * FROM brain_memory_supersessions WHERE reason = ?", ["mem36-supersede"]),
    ).toBeTruthy();
    expect(
      await after.get("SELECT * FROM brain_attribution WHERE mem_id = ?", [captured.id]),
    ).toBeTruthy();
    expect(
      await after.get("SELECT * FROM brain_summary_tree WHERE text = ?", ["mem36-tree"]),
    ).toBeTruthy();
  });

  it("relinks a verified recipe when rewind drops its workflow memory (MEM-36)", async () => {
    await reset();
    const sessionId = "cp-mem36-relink";
    await BrainManager.trackSession(sessionId, "MEM-36 relink", testDir);
    const captured = await captureVerifiedRecipe({
      sessionId,
      title: "Relink workflow",
      intent: "relink when the workflow row is missing after rewind",
    });
    const checkpoint = await BrainManager.createCheckpoint("relink");
    const snapshot = BrainStore.readKnowledgeSnapshot(checkpoint.snapshot_path);
    snapshot.semantic = (snapshot.semantic ?? []).filter(
      (row: { id: number }) => row.id !== captured.memoryId,
    );
    fs.writeFileSync(checkpoint.snapshot_path, JSON.stringify(snapshot, null, 2));

    await BrainManager.rollbackCheckpoint(checkpoint.id);

    const store = new RecipeStore(await BrainStore.get());
    const recipe = await store.get(captured.id);
    expect(recipe).not.toBeNull();
    expect(recipe?.status).toBe("verified");
    expect(recipe?.memoryId).toBeTruthy();
    expect(recipe?.memoryId).not.toBe(captured.memoryId);
    const workflow = await BrainStore.getSemanticById(recipe!.memoryId!);
    expect(workflow).not.toBeNull();
    expect(workflow?.content).toContain(`recipe_id: ${captured.id}`);
    expect(await BrainStore.getSemanticById(captured.memoryId)).toBeNull();
  });

  it("leaves recipes in place for a v2 snapshot and still relinks a missing workflow", async () => {
    await reset();
    const sessionId = "cp-mem36-v2";
    await BrainManager.trackSession(sessionId, "MEM-36 v2", testDir);
    const captured = await captureVerifiedRecipe({
      sessionId,
      title: "Legacy snapshot",
      intent: "v2 snapshots omit recipes so rewind must not drop them",
    });
    const checkpoint = await BrainManager.createCheckpoint("v2-compat");
    const snapshot = BrainStore.readKnowledgeSnapshot(checkpoint.snapshot_path);
    snapshot.version = 2;
    snapshot.semantic = (snapshot.semantic ?? []).filter(
      (row: { id: number }) => row.id !== captured.memoryId,
    );
    delete snapshot.recipes;
    delete snapshot.recipe_steps;
    delete snapshot.memory_outcomes;
    delete snapshot.memory_supersessions;
    delete snapshot.attribution;
    delete snapshot.summary_tree;
    fs.writeFileSync(checkpoint.snapshot_path, JSON.stringify(snapshot, null, 2));
    const afterRecipe = await captureVerifiedRecipe({
      sessionId,
      title: "Captured after v2 rewrite",
      intent: "v2 rewind must not delete a recipe that was never snapshotted",
    });

    await BrainManager.rollbackCheckpoint(checkpoint.id);

    const store = new RecipeStore(await BrainStore.get());
    expect(await store.get(captured.id)).not.toBeNull();
    expect(await store.get(afterRecipe.id)).not.toBeNull();
    const recipe = await store.get(captured.id);
    expect(recipe?.memoryId).toBeTruthy();
    expect(await BrainStore.getSemanticById(recipe!.memoryId!)).not.toBeNull();
  });

  it("rewinds theorem columns on semantic and graph rows (MEM-36)", async () => {
    await reset();
    const sessionId = "cp-mem36-theorem";
    await BrainManager.trackSession(sessionId, "MEM-36 theorem", testDir);
    const memoryId = await BrainManager.store({
      category: "fact",
      title: "Valid TypeScript alias",
      content: "TS is TypeScript for this project.",
      keywords: "typescript, ts",
      session_id: sessionId,
      importance: 0.8,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic
       SET stability = 14, difficulty = 4, i0 = 0.8,
           helpful_count = 3, unhelpful_count = 1, inject_count = 7,
           valid_from = '2024-01-01', valid_to = '2026-12-31',
           summary_of = '[1]', tombstoned_at = NULL
       WHERE id = ?`,
      [memoryId],
    );
    const entityId = await BrainStore.addEntity({
      name: "TypeScript",
      entity_type: "concept",
      description: "Language",
      properties: {},
      confidence: 0.9,
    });
    await db.run(
      `UPDATE brain_entities
       SET canonical_id = ?, valid_from = '2024-01-01', valid_to = '2026-12-31'
       WHERE id = ?`,
      [entityId, entityId],
    );
    const edgeId = await BrainStore.addEdge({
      source_entity_id: entityId,
      target_entity_id: entityId,
      relationship: "alias_of",
      weight: 1,
    });
    await db.run(
      `UPDATE brain_graph_edges
       SET valid_from = '2024-01-01', valid_to = '2026-12-31', canonical_id = ?
       WHERE id = ?`,
      [entityId, edgeId],
    );

    const checkpoint = await BrainManager.createCheckpoint("theorem-cols");
    await db.run(
      `UPDATE brain_semantic
       SET stability = 1, helpful_count = 0, unhelpful_count = 0, inject_count = 0,
           valid_to = NULL
       WHERE id = ?`,
      [memoryId],
    );
    await db.run(
      "UPDATE brain_entities SET canonical_id = NULL, valid_to = NULL WHERE id = ?",
      [entityId],
    );

    await BrainManager.rollbackCheckpoint(checkpoint.id);

    const fact = await db.get<{
      stability: number;
      difficulty: number;
      i0: number;
      helpful_count: number;
      unhelpful_count: number;
      inject_count: number;
      valid_from: string;
      valid_to: string;
      summary_of: string;
    }>("SELECT stability, difficulty, i0, helpful_count, unhelpful_count, inject_count, valid_from, valid_to, summary_of FROM brain_semantic WHERE id = ?", [memoryId]);
    expect(fact?.stability).toBe(14);
    expect(fact?.difficulty).toBe(4);
    expect(fact?.i0).toBeCloseTo(0.8);
    expect(fact?.helpful_count).toBe(3);
    expect(fact?.unhelpful_count).toBe(1);
    expect(fact?.inject_count).toBe(7);
    expect(fact?.valid_from).toContain("2024-01-01");
    expect(fact?.valid_to).toContain("2026-12-31");
    expect(fact?.summary_of).toBe("[1]");

    const entity = await db.get<{
      canonical_id: number;
      valid_from: string;
      valid_to: string;
    }>("SELECT canonical_id, valid_from, valid_to FROM brain_entities WHERE id = ?", [entityId]);
    expect(entity?.canonical_id).toBe(entityId);
    expect(entity?.valid_from).toContain("2024-01-01");
    expect(entity?.valid_to).toContain("2026-12-31");

    const edge = await db.get<{
      canonical_id: number;
      valid_from: string;
      valid_to: string;
    }>("SELECT canonical_id, valid_from, valid_to FROM brain_graph_edges WHERE id = ?", [edgeId]);
    expect(edge?.canonical_id).toBe(entityId);
    expect(edge?.valid_from).toContain("2024-01-01");
    expect(edge?.valid_to).toContain("2026-12-31");
  });
});

async function captureVerifiedRecipe(opts: {
  sessionId: string;
  title: string;
  intent: string;
}): Promise<{ id: string; memoryId: number }> {
  const store = new RecipeStore(await BrainStore.get());
  const created = await store.create({
    projectId: "mem36",
    intentFingerprint: opts.intent,
    title: opts.title,
    intentText: opts.intent,
    steps: [
      {
        kind: "write_file",
        path: "src/auth.ts",
        blobHash: "ab".repeat(32),
        checkpointId: "ws-mem36",
      },
      { kind: "command", command: "npm test" },
    ],
    oracle: {
      kind: "build",
      passedAt: new Date().toISOString(),
      command: "npm run build",
    },
    sourceSessionId: opts.sessionId,
  });
  await store.verify(created.recipe.id);
  const recipe = await linkRecipeMemory(
    store,
    (await store.get(created.recipe.id))!,
    (memory) => BrainManager.store(memory),
    async (id) => (await BrainStore.getSemanticById(id)) != null,
  );
  if (recipe.memoryId == null) {
    throw new Error("expected a linked workflow memory");
  }
  return { id: recipe.id, memoryId: recipe.memoryId };
}
