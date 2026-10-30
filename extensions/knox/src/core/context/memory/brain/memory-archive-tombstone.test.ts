/**
 * MEM-04 — age/retention archive + tombstone instead of DELETE.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AUDIT_TOMBSTONE,
  isLiveRetrieveRow,
  liveRetrieveSql,
} from "./store/tombstone.js";

const testDir = path.join(os.tmpdir(), `brain-mem04-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;
let FiveTierHierarchy: typeof import("./advanced/fiveTierHierarchy.js").FiveTierHierarchy;
let Ebbinghaus: typeof import("./Ebbinghaus.js").Ebbinghaus;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
  ({ FiveTierHierarchy } = await import("./advanced/fiveTierHierarchy.js"));
  ({ Ebbinghaus } = await import("./Ebbinghaus.js"));
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

async function fusionHits(query: string, id: number, type: "episodic" | "semantic"): Promise<boolean> {
  const hits = await RetrievalFusion.search({
    query,
    includeEpisodic: type === "episodic",
    limit: 20,
  });
  return hits.some((h) => h.type === type && h.id === id);
}

describe("MEM-04 live retrieve helpers", () => {
  it("skips frozen and tombstoned rows", () => {
    expect(isLiveRetrieveRow({ tier: "cold", tombstoned_at: null })).toBe(true);
    expect(isLiveRetrieveRow({ tier: "frozen", tombstoned_at: null })).toBe(false);
    expect(isLiveRetrieveRow({ tier: "cold", tombstoned_at: "2020-01-01" })).toBe(false);
    expect(liveRetrieveSql("e")).toBe("(e.tombstoned_at IS NULL AND e.tier != 'frozen')");
  });
});

describe("MEM-04 stop age/retention DELETE", () => {
  it("a cold episodic older than 90d is still SELECTable; default fusion skips it", async () => {
    await reset();
    const sessionId = "mem04-90d";
    const token = "quartzamber90dleaf";
    await BrainManager.trackSession(sessionId, "MEM-04 90d", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      `We still need the ${token} note after ninety days.`,
      12,
      0.2,
    );
    const liveId = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      "Fresh live turn about auth jwt rotating tokens.",
      10,
      0.8,
    );

    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET tier = 'cold', importance_score = 0.2, created_at = datetime('now', '-91 days')
       WHERE id = ?`,
      [id],
    );

    const result = await BrainStore.consolidate();
    expect(result.pruned).toBe(0);

    const row = (await db.get(
      "SELECT id, tier, tombstoned_at, tombstone_reason, content FROM brain_episodic WHERE id = ?",
      [id],
    )) as {
      id: number;
      tier: string;
      tombstoned_at: string | null;
      tombstone_reason: string | null;
      content: string;
    };
    expect(row).toBeTruthy();
    expect(row.content).toContain(token);
    expect(row.tier).toBe("frozen");
    expect(row.tombstoned_at).toBeNull();
    expect(row.tombstone_reason).toBeNull();

    const audit = await BrainStore.getAuditLog({
      action: AUDIT_TOMBSTONE,
      target_type: "episodic",
      target_id: String(id),
    });
    expect(audit.length).toBe(0);

    expect(await fusionHits(token, id, "episodic")).toBe(false);
    expect(await fusionHits("auth jwt rotating", liveId, "episodic")).toBe(true);
  });

  it("NREM decay tombstones a shouldPrune leaf instead of DELETE", async () => {
    await reset();
    const sessionId = "mem04-nrem";
    const token = "nremdecayleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-04 NREM", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      `Cold leftover about ${token} from last year.`,
      10,
      0.2,
    );
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET tier = 'cold', importance_score = 0.2, salience = 0.2,
           created_at = datetime('now', '-500 days')
       WHERE id = ?`,
      [id],
    );
    const aged = (await db.get("SELECT created_at FROM brain_episodic WHERE id = ?", [id])) as {
      created_at: string;
    };
    expect(Ebbinghaus.shouldPrune(aged.created_at, 0, 0.2, 0.2, undefined, { stability: 1, category: "episodic" })).toBe(true);

    const cycle = await SleepConsolidation.runCycle();
    expect(cycle.pruned).toBe(0);

    const row = (await db.get(
      "SELECT id, tombstoned_at, tombstone_reason, tier FROM brain_episodic WHERE id = ?",
      [id],
    )) as { id: number; tombstoned_at: string | null; tombstone_reason: string | null; tier: string };
    expect(row).toBeTruthy();
    expect(row.tombstoned_at).toBeNull();
    expect(row.tombstone_reason).toBeNull();
    expect(row.tier).toBe("frozen");
    expect(await fusionHits(token, id, "episodic")).toBe(false);
  });

  it("five-tier over-age frozen stays frozen and is not tombstoned", async () => {
    await reset();
    const sessionId = "mem04-fivetier";
    const token = "fivetierfrozenleaf";
    await BrainManager.trackSession(sessionId, "MEM-04 five-tier", testDir);
    const id = await BrainStore.addEpisodic(
      sessionId,
      "user_message",
      "user",
      `Deep archive mention of ${token} stays on disk.`,
      10,
      0.05,
    );
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_episodic
       SET tier = 'frozen', importance_score = 0.05,
           created_at = datetime('now', '-400 days')
       WHERE id = ?`,
      [id],
    );

    const result = await FiveTierHierarchy.consolidate();
    expect(result.pruned).toBe(0);

    const row = (await db.get(
      "SELECT id, tombstoned_at, tombstone_reason, tier FROM brain_episodic WHERE id = ?",
      [id],
    )) as { id: number; tombstoned_at: string | null; tombstone_reason: string | null; tier: string };
    expect(row).toBeTruthy();
    expect(row.tier).toBe("frozen");
    expect(row.tombstoned_at).toBeNull();
    expect(row.tombstone_reason).toBeNull();
    expect(await fusionHits(token, id, "episodic")).toBe(false);
  });

  it("expired TTL is not deleted or tombstoned by age/retention paths", async () => {
    await reset();
    const sessionId = "mem04-ttl";
    await BrainManager.trackSession(sessionId, "MEM-04 TTL", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Expired TTL leaf",
      content: "This fact has already expired and waits for MEM-06.",
      keywords: "expiredttlmem04",
      importance: 0.4,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET expires_at = datetime('now', '-1 day') WHERE id = ?`,
      [id],
    );

    await BrainStore.consolidate();
    await SleepConsolidation.runCycle();

    const row = (await db.get(
      "SELECT id, tombstoned_at FROM brain_semantic WHERE id = ?",
      [id],
    )) as { id: number; tombstoned_at: string | null };
    expect(row).toBeTruthy();
    expect(row.tombstoned_at).toBeNull();
  });

  it("pinned semantic is not tombstoned by NREM decay", async () => {
    await reset();
    const sessionId = "mem04-pin";
    await BrainManager.trackSession(sessionId, "MEM-04 pin", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Pinned old fact",
      content: "Pinned quartzpinleaf must survive sleep decay.",
      keywords: "quartzpinleaf",
      importance: 0.2,
      session_id: sessionId,
    });
    expect(await BrainManager.pinMemory(id)).toBe(true);
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic
       SET tier = 'cold', importance_score = 0.2, salience = 0.2, stability = 1,
           last_accessed_at = datetime('now', '-500 days')
       WHERE id = ?`,
      [id],
    );
    const aged = (await db.get(
      "SELECT last_accessed_at FROM brain_semantic WHERE id = ?",
      [id],
    )) as { last_accessed_at: string };
    expect(Ebbinghaus.shouldPrune(aged.last_accessed_at, 0, 0.2, 0.2, undefined, { stability: 1, category: "fact" })).toBe(true);

    await SleepConsolidation.runCycle();

    const row = (await db.get(
      "SELECT tombstoned_at, tier FROM brain_semantic WHERE id = ?",
      [id],
    )) as { tombstoned_at: string | null; tier: string };
    expect(row.tombstoned_at).toBeNull();
    expect(row.tier).not.toBe("frozen");
  });
});
