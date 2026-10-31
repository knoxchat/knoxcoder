/**
 * MEM-06 — single delete path: forget / TTL / privacy + tombstone.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AUDIT_TOMBSTONE,
  TOMBSTONE_REASON,
} from "./store/tombstone.js";

const testDir = path.join(os.tmpdir(), `brain-mem06-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let CheckpointManager: typeof import("./CheckpointManager.js").CheckpointManager;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let MemoryManager: typeof import("../MemoryManager.js").MemoryManager;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ CheckpointManager } = await import("./CheckpointManager.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ MemoryManager } = await import("../MemoryManager.js"));
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
  await db.exec("DELETE FROM brain_audit_log");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
}

async function fusionHits(query: string, id: number): Promise<boolean> {
  const hits = await RetrievalFusion.search({
    query,
    includeEpisodic: false,
    limit: 20,
  });
  return hits.some((h) => h.type === "semantic" && h.id === id);
}

async function ftsHas(token: string, id: number): Promise<boolean> {
  const db = await BrainStore.get();
  try {
    const rows = await db.all(
      `SELECT rowid AS id FROM brain_semantic_fts WHERE brain_semantic_fts MATCH ?`,
      [`"${token}"`],
    ) as { id: number }[];
    return rows.some((r) => Number(r.id) === id);
  } catch {
    return false;
  }
}

describe("MEM-06 forget / TTL / privacy tombstone", () => {
  it("builtin delete tombstones, keeps FTS, skips default retrieve, and undoes", async () => {
    await reset();
    const sessionId = "mem06-forget";
    const token = "forgettombstoneleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-06 forget", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Forget this fact",
      content: `Keep the ${token} text after forget.`,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });

    expect(await fusionHits(token, id)).toBe(true);
    const deleted = await BrainManager.dispatch("delete", { id });
    expect(deleted).toMatch(/deleted/i);

    const row = await BrainStore.getSemanticById(id);
    expect(row).not.toBeNull();
    expect(row?.content).toContain(token);
    expect(row?.tombstoned_at).toBeTruthy();
    expect(row?.tombstone_reason).toBe(TOMBSTONE_REASON.forget);
    expect(row?.tier).toBe("frozen");

    const audit = await BrainStore.getAuditLog({
      action: AUDIT_TOMBSTONE,
      target_type: "semantic",
      target_id: String(id),
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);

    expect(await fusionHits(token, id)).toBe(false);
    expect(await ftsHas(token, id)).toBe(true);

    const undoable = await CheckpointManager.getUndoableOperations(20);
    const entry = undoable.find(
      (e) => e.action === "tombstone" && String(e.target_id) === String(id),
    );
    expect(entry).toBeTruthy();
    const undone = await CheckpointManager.undoOperation(entry!.id);
    expect(undone.success).toBe(true);
    const restored = await BrainStore.getSemanticById(id);
    expect(restored?.tombstoned_at).toBeFalsy();
    expect(await fusionHits(token, id)).toBe(true);
  });

  it("pinned rows stay exempt from forget and TTL", async () => {
    await reset();
    const sessionId = "mem06-pin";
    await BrainManager.trackSession(sessionId, "MEM-06 pin", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Pinned stays",
      content: "Pinned quartzpinleaf06 must survive forget and TTL.",
      keywords: "quartzpinleaf06",
      importance: 0.4,
      session_id: sessionId,
    });
    expect(await BrainManager.pinMemory(id)).toBe(true);

    const msg = await BrainManager.dispatch("delete", { id });
    expect(msg).toMatch(/pinned/i);
    expect((await BrainStore.getSemanticById(id))?.tombstoned_at).toBeFalsy();

    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET expires_at = datetime('now', '-1 day') WHERE id = ?`,
      [id],
    );
    expect(await BrainStore.forgetExpiredTtl()).toBe(0);
    expect((await BrainStore.getSemanticById(id))?.tombstoned_at).toBeFalsy();
  });

  it("expired TTL is tombstoned by the dedicated helper and cleanup", async () => {
    await reset();
    const sessionId = "mem06-ttl";
    const token = "expiredttlmem06leaf";
    await BrainManager.trackSession(sessionId, "MEM-06 TTL", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Expired TTL leaf",
      content: `This ${token} fact has expired.`,
      keywords: token,
      importance: 0.4,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET expires_at = datetime('now', '-1 day') WHERE id = ?`,
      [id],
    );

    expect(await MemoryManager.cleanup()).toBeGreaterThanOrEqual(1);
    const row = await BrainStore.getSemanticById(id);
    expect(row).not.toBeNull();
    expect(row?.tombstoned_at).toBeTruthy();
    expect(row?.tombstone_reason).toBe(TOMBSTONE_REASON.ttl);
    expect(await fusionHits(token, id)).toBe(false);
    expect(await ftsHas(token, id)).toBe(true);
  });

  it("privacy wipe tombstones first then destroys the live database", async () => {
    await reset();
    const sessionId = "mem06-wipe";
    const token = "privacywipeleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-06 wipe", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Wipe me",
      content: `Privacy ${token} must leave a tombstone in the backup.`,
      keywords: token,
      importance: 0.9,
      session_id: sessionId,
    });
    expect(await BrainManager.pinMemory(id)).toBe(true);

    const { backup, recreated } = await BrainStore.wipeAll();
    expect(recreated).toBe(true);
    expect(backup && fs.existsSync(backup)).toBe(true);

    const live = await BrainStore.get();
    expect(
      (await live.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_semantic"))?.n,
    ).toBe(0);

    const bak = await open({ filename: backup!, driver: sqlite3.Database });
    try {
      const row = await bak.get<{
        id: number;
        tombstoned_at: string | null;
        tombstone_reason: string | null;
      }>(
        "SELECT id, tombstoned_at, tombstone_reason FROM brain_semantic WHERE id = ?",
        [id],
      );
      expect(row).toBeTruthy();
      expect(row?.tombstoned_at).toBeTruthy();
      expect(row?.tombstone_reason).toBe(TOMBSTONE_REASON.privacyWipe);
    } finally {
      await bak.close();
    }
  });

  it("forgotten near-duplicates do not hide a live gold fact from fusion", async () => {
    await reset();
    const sessionId = "mem06-fts-crowd";
    const token = "oauthjwtcrowdtoken";
    await BrainManager.trackSession(sessionId, "MEM-06 crowd", testDir);
    const db = await BrainStore.get();
    await db.exec("BEGIN");
    for (let i = 0; i < 2800; i++) {
      await db.run(
        `INSERT INTO brain_semantic (category, title, content, keywords, source_session_id, importance_score, tombstoned_at, tombstone_reason, tier)
         VALUES ('fact', ?, ?, ?, ?, 0.8, datetime('now'), 'forget', 'frozen')`,
        [`Dead ${token} ${i}`, `document ${i} about ${token} unique-${i}`, token, sessionId],
      );
    }
    await db.exec("COMMIT");
    const goldId = await BrainManager.store({
      category: "fact",
      title: `Live ${token}`,
      content: `The only live document about ${token} in this project.`,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });
    expect(await fusionHits(token, goldId)).toBe(true);
  }, 60_000);
});
