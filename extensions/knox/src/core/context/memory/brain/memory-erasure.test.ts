/**
 * MEM-72 … MEM-75 — archive vs forget, erasure, idle sleep, Active/Frozen.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AUDIT_ARCHIVE, AUDIT_FORGET, TOMBSTONE_REASON } from "./store/tombstone.js";

const testDir = path.join(os.tmpdir(), `brain-mem72-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;
let checkErasure: typeof import("./invariants.js").checkErasure;
let checkReachability: typeof import("./invariants.js").checkReachability;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;
let searchTreeChannel: typeof import("./SummaryTree.js").searchTreeChannel;
let noteScopeActivity: typeof import("./idleSleep.js").noteScopeActivity;
let runIdleSleepIfDue: typeof import("./idleSleep.js").runIdleSleepIfDue;
let resetIdleSleepForTests: typeof import("./idleSleep.js").resetIdleSleepForTests;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
  ({ Hippocampus } = await import("./regions/Hippocampus.js"));
  ({ checkErasure, checkReachability } = await import("./invariants.js"));
  ({ searchTreeChannel } = await import("./SummaryTree.js"));
  ({ noteScopeActivity, runIdleSleepIfDue, resetIdleSleepForTests } = await import("./idleSleep.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterEach(() => {
  resetIdleSleepForTests();
});

afterAll(() => {
  resetIdleSleepForTests();
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_associations");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_entities");
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_audit_log");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  await db.exec("DELETE FROM brain_checkpoints");
}

async function fusionHits(query: string, id: number): Promise<boolean> {
  const hits = await RetrievalFusion.search({
    query,
    includeEpisodic: false,
    limit: 20,
  });
  return hits.some((h) => h.type === "semantic" && h.id === id);
}

async function ftsHas(table: string, token: string, id: number): Promise<boolean> {
  const db = await BrainStore.get();
  try {
    const rows = await db.all(
      `SELECT rowid AS id FROM ${table} WHERE ${table} MATCH ?`,
      [`"${token}"`],
    ) as { id: number }[];
    return rows.some((r) => Number(r.id) === id);
  } catch {
    return false;
  }
}

describe("MEM-72 archive vs forget", () => {
  it("archive keeps content, drops default retrieve, and restores", async () => {
    await reset();
    const sessionId = "mem72-archive";
    const token = "zephyrarchiveleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-72 archive", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Archive this fact",
      content: `Keep the ${token} text after archive.`,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });
    expect(await fusionHits(token, id)).toBe(true);

    const archived = await BrainManager.dispatch("archive", { id });
    expect(archived).toMatch(/archived/i);

    const row = await BrainStore.getSemanticById(id);
    expect(row?.content).toContain(token);
    expect(row?.tombstoned_at).toBeFalsy();
    expect(row?.tier).toBe("frozen");
    expect(await fusionHits(token, id)).toBe(false);

    const audit = await BrainStore.getAuditLog({
      action: AUDIT_ARCHIVE,
      target_type: "semantic",
      target_id: String(id),
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);

    expect(await BrainStore.restoreArchived("semantic", id)).toBe(true);
    const restored = await BrainStore.getSemanticById(id);
    expect(restored?.tier).not.toBe("frozen");
    expect(restored?.content).toContain(token);
    expect(await fusionHits(token, id)).toBe(true);
  });

  it("forget erases and is not reversible; archive is the undo path", async () => {
    await reset();
    const sessionId = "mem72-forget";
    const token = "zephyrforgetleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-72 forget", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Forget this fact",
      content: `Erase the ${token} text after forget.`,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });
    expect(await BrainManager.dispatch("delete", { id })).toMatch(/deleted/i);

    const row = await BrainStore.getSemanticById(id);
    expect(String(row?.content ?? "").trim()).toBe("");
    expect(row?.tombstoned_at).toBeTruthy();
    expect(row?.tombstone_reason).toBe(TOMBSTONE_REASON.forget);
    expect(await fusionHits(token, id)).toBe(false);
    expect(await ftsHas("brain_semantic_fts", token, id)).toBe(false);
    expect(await ftsHas("brain_semantic_fts_frozen", token, id)).toBe(false);
    expect(await BrainStore.restoreTombstoned("semantic", id)).toBe(false);
  });
});

describe("MEM-73 erasure propagation", () => {
  it("planted memory deleted leaves zero hits in indexes, edges, summaries, and snapshots", async () => {
    await reset();
    const sessionId = "mem73-erase";
    const token = "knoxerasureleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-73 erase", testDir);
    const keepId = await BrainManager.store({
      category: "fact",
      title: "Keep companion",
      content: "companion fact stays live after the other is erased",
      keywords: "companion",
      importance: 0.7,
      session_id: sessionId,
    });
    const id = await BrainManager.store({
      category: "fact",
      title: "Erase ZephyrAuthService",
      content: `The ${token} document names ZephyrAuthService only here.`,
      keywords: token,
      importance: 0.8,
      session_id: sessionId,
    });
    await BrainStore.createAssociation({
      source_type: "semantic",
      source_id: id,
      target_type: "semantic",
      target_id: keepId,
      relationship: "related",
      strength: 0.8,
    });
    const { KnowledgeGraph } = await import("./KnowledgeGraph.js");
    await KnowledgeGraph.addEntity({
      name: "ZephyrAuthService",
      entity_type: "concept",
      description: "only evidence is the forgotten leaf",
    });
    await Hippocampus.persistToLongTerm(sessionId, { semantic_count: 2, entity_count: 1 });
    const checkpoint = await BrainManager.createCheckpoint("complete");

    await BrainManager.forget(id);

    const row = await BrainStore.getSemanticById(id);
    expect(String(row?.title ?? "").trim()).toBe("");
    expect(String(row?.content ?? "").trim()).toBe("");
    expect(await fusionHits(token, id)).toBe(false);
    expect(await ftsHas("brain_semantic_fts", token, id)).toBe(false);
    expect(await ftsHas("brain_semantic_fts_frozen", token, id)).toBe(false);

    const db = await BrainStore.get();
    const assoc = await db.get(
      "SELECT * FROM brain_associations WHERE source_id = ? OR target_id = ?",
      [id, id],
    );
    expect(assoc).toBeFalsy();
    const entity = await db.get(
      "SELECT id FROM brain_entities WHERE name = ?",
      ["ZephyrAuthService"],
    );
    expect(entity).toBeFalsy();

    const tree = await db.get<{ text: string | null }>(
      `SELECT text FROM brain_summary_tree WHERE kind = 'leaf' AND leaf_type = 'semantic' AND leaf_id = ?`,
      [String(id)],
    );
    if (tree) expect(String(tree.text ?? "").trim()).toBe("");

    const snapshot = BrainStore.readKnowledgeSnapshot(checkpoint.snapshot_path);
    const snapRow = (snapshot.semantic ?? []).find((m: { id?: number }) => Number(m.id) === id);
    expect(snapRow).toBeTruthy();
    expect(String((snapRow as { content?: string }).content ?? "").trim()).toBe("");

    const erasure = await checkErasure();
    expect(erasure.met).toBe(true);
    expect(erasure.tombstoned).toBeGreaterThanOrEqual(1);

    const audit = await BrainStore.getAuditLog({
      action: AUDIT_FORGET,
      target_type: "semantic",
      target_id: String(id),
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});

describe("MEM-74 idle sleep and φ₇ order", () => {
  it("sleep on the timer reports φ₇ fields and does not DELETE", async () => {
    await reset();
    const sessionId = "mem74-timer";
    await BrainManager.trackSession(sessionId, "MEM-74 timer", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Sleep timer leaf",
      content: "timer sleep keeps this zephyrtimerleafxyz fact",
      keywords: "zephyrtimerleafxyz",
      importance: 0.7,
      session_id: sessionId,
    });
    const cycle = await SleepConsolidation.runCycle({ trigger: "timer" });
    expect(cycle.trigger).toBe("timer");
    expect(cycle.pruned).toBe(0);
    expect(typeof cycle.deduped).toBe("number");
    expect(typeof cycle.contradictions).toBe("number");
    expect(typeof cycle.tree_refreshed).toBe("number");
    expect(cycle.invariants?.erasure.met).toBe(true);
  });

  it("idle sleep runs after the Active window, not per turn", async () => {
    await reset();
    const sessionId = "mem74-idle";
    await BrainManager.trackSession(sessionId, "MEM-74 idle", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Idle sleep leaf",
      content: "idle sleep keeps this zephyridleleafxyz fact",
      keywords: "zephyridleleafxyz",
      importance: 0.6,
      session_id: sessionId,
    });
    const now = Date.now();
    noteScopeActivity(sessionId, now);
    expect(await runIdleSleepIfDue({ sessionId, nowMs: now + 5 * 60 * 1000 })).toBeNull();
    const due = await runIdleSleepIfDue({ sessionId, nowMs: now + 31 * 60 * 1000 });
    expect(due).toBeTruthy();
    expect(due?.trigger).toBe("idle");
    expect(due?.scope).toBe(sessionId);
    expect(due?.pruned).toBe(0);
  });
});

describe("MEM-75 Active window and Frozen tree reachability", () => {
  it("a Frozen memory is still reached by the tree and Reachability", async () => {
    await reset();
    const sessionId = "mem75-frozen-tree";
    const token = "knoxfrozentreeleafxyz";
    await BrainManager.trackSession(sessionId, "MEM-75 frozen tree", testDir);
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(
        await BrainManager.store({
          category: "fact",
          title: i === 7 ? `${token} leaf` : `Pad leaf ${i}`,
          content: i === 7
            ? `Frozen tree document about ${token} unique-frozen`
            : `padding leaf ${i} knoxTreePad${i}`,
          keywords: i === 7 ? token : `pad${i}`,
          importance: 0.7,
          session_id: sessionId,
        }),
      );
    }
    const frozenId = ids[7];
    await Hippocampus.persistToLongTerm(sessionId, { semantic_count: 8, entity_count: 0 });
    expect(await BrainStore.archiveMemories("semantic", [frozenId])).toBe(1);

    const row = await BrainStore.getSemanticById(frozenId);
    expect(row?.tier).toBe("frozen");
    expect(row?.content).toContain(token);
    expect(await fusionHits(token, frozenId)).toBe(false);
    expect(await ftsHas("brain_semantic_fts_frozen", token, frozenId)).toBe(true);

    const treeHits = await searchTreeChannel({ query: token, sessionId, includeEpisodic: false });
    expect(treeHits.some((h) => h.id === frozenId)).toBe(true);

    const reach = await checkReachability();
    expect(reach.missing_ids.some((g) => g.id === frozenId)).toBe(false);
    expect(reach.met).toBe(true);
  });
});
