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
let rewindMemoryForWorkspaceCheckpoint: typeof import("../../soul/recordSoulEvent.js").rewindMemoryForWorkspaceCheckpoint;
let pinMemoryForWorkspaceCheckpoint: typeof import("../../soul/recordSoulEvent.js").pinMemoryForWorkspaceCheckpoint;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ CheckpointManager } = await import("./CheckpointManager.js"));
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
    const undoable = await CheckpointManager.getUndoableOperations(20);
    const deleteEntry = undoable.find(
      (entry) => entry.action === "delete" && String(entry.target_id) === String(original),
    );
    expect(deleteEntry).toBeTruthy();
    const undone = await CheckpointManager.undoOperation(deleteEntry!.id);
    expect(undone.success).toBe(true);
    expect(await BrainStore.getSemanticById(original)).not.toBeNull();
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
});
