/**
 * MEM-32 — Budget, Reachability, Losslessness (IMP-01).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem32-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let ContextSections: typeof import("./ContextSections.js").ContextSections;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let SleepConsolidation: typeof import("./SleepConsolidation.js").SleepConsolidation;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let evaluateBudget: typeof import("./invariants.js").evaluateBudget;
let checkReachability: typeof import("./invariants.js").checkReachability;
let checkLosslessness: typeof import("./invariants.js").checkLosslessness;
let checkStoreInvariants: typeof import("./invariants.js").checkStoreInvariants;
let resetInvariantSnapshotForTests: typeof import("./invariants.js").resetInvariantSnapshotForTests;
let AUDIT_BUDGET: typeof import("./invariants.js").AUDIT_BUDGET;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ ContextSections } = await import("./ContextSections.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ SleepConsolidation } = await import("./SleepConsolidation.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({
    evaluateBudget,
    checkReachability,
    checkLosslessness,
    checkStoreInvariants,
    resetInvariantSnapshotForTests,
    AUDIT_BUDGET,
  } = await import("./invariants.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterEach(() => {
  resetInvariantSnapshotForTests();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await RetrievalFusion.rebuildFts5(db);
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_associations");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_entities");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  await db.exec("DELETE FROM brain_audit_log");
  resetInvariantSnapshotForTests();
}

async function insertEmptySemantic(): Promise<number> {
  const db = await BrainStore.get();
  const row = await db.run(
    `INSERT INTO brain_semantic (category, title, content, keywords, importance_score)
     VALUES ('fact', '', '', '', 0.5)`,
  );
  return row.lastID!;
}

/** Drop the FTS index so live rows are no longer FTS-addressable. */
async function dropSemanticFts(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DROP TABLE IF EXISTS brain_semantic_fts");
}

describe("MEM-32 Budget", () => {
  it("evaluateBudget holds only when |C(q)| ≤ W", () => {
    expect(evaluateBudget(0, 0).met).toBe(true);
    expect(evaluateBudget(10, 100).met).toBe(true);
    expect(evaluateBudget(100, 100).met).toBe(true);
    expect(evaluateBudget(101, 100).met).toBe(false);
    expect(evaluateBudget(1, 0).met).toBe(false);
  });

  it("buildContext fails open to empty memory when |C(q)| > W", async () => {
    await reset();
    const emptyPhrase = "No relevant memories found.";
    expect(ContextSections.estimateTokens(emptyPhrase)).toBeGreaterThan(5);

    const built = await ContextBuilder.buildDetailed({
      message: "zzzz no lexical overlap expected",
      w: 5,
      w_out: 1,
    });
    expect(built.context).toBe("");
    expect(built.items).toEqual([]);
    expect(built.budget_invariant_met).toBe(false);
    expect(built.w).toBe(5);

    const entries = await BrainStore.getAuditLog({ action: AUDIT_BUDGET, limit: 5 });
    expect(entries.length).toBeGreaterThan(0);
    const details =
      typeof entries[0].details === "string" ? JSON.parse(entries[0].details) : entries[0].details;
    expect(details.met).toBe(false);
    expect(details.w).toBe(5);
    expect(details.c_use).toBeGreaterThan(5);

    const status = MemoryPipeline.getPhaseStatus();
    expect(status.budget_invariant_met).toBe(false);
    expect(status.cycle_invariant_met).toBe(false);
  });

  it("buildContext keeps inject when |C(q)| ≤ W", async () => {
    await reset();
    const built = await ContextBuilder.buildDetailed({
      message: "zzzz no lexical overlap expected",
      w: 8000,
      w_out: 1024,
    });
    expect(built.budget_invariant_met).toBe(true);
    expect(built.c_use).toBeLessThanOrEqual(8000);
    expect(built.context.length).toBeGreaterThan(0);
    expect(MemoryPipeline.getPhaseStatus().budget_invariant_met).toBe(true);
  });
});

describe("MEM-32 Reachability", () => {
  it("a live row with content is reachable", async () => {
    await reset();
    const sessionId = "mem32-reach-ok";
    await BrainManager.trackSession(sessionId, "MEM-32 reach", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Reachable fact",
      content: "This fact is in FTS and the ripgrep corpus.",
      importance: 0.7,
      session_id: sessionId,
    });
    const report = await checkReachability();
    expect(report.met).toBe(true);
    expect(report.live).toBeGreaterThanOrEqual(1);
    expect(report.missing).toBe(0);
    expect(report.via_fts + report.via_ripgrep).toBeGreaterThan(0);
  });

  it("empty content with no FTS/graph/tree is unreachable", async () => {
    await reset();
    const id = await insertEmptySemantic();
    await dropSemanticFts();
    const report = await checkReachability();
    expect(report.met).toBe(false);
    expect(report.missing).toBeGreaterThanOrEqual(1);
    expect(report.missing_ids.some((g) => g.type === "semantic" && g.id === id)).toBe(true);
  });

  it("a tree leaf rescues an otherwise unreachable id", async () => {
    await reset();
    const id = await insertEmptySemantic();
    await dropSemanticFts();
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
       VALUES (NULL, 'leaf', 'semantic', ?, 'pointer', 1)`,
      [String(id)],
    );
    const report = await checkReachability();
    expect(report.met).toBe(true);
    expect(report.via_tree).toBeGreaterThanOrEqual(1);
  });

  it("a graph association rescues an otherwise unreachable id", async () => {
    await reset();
    const a = await insertEmptySemantic();
    const b = await insertEmptySemantic();
    await dropSemanticFts();
    await BrainStore.createAssociation({
      source_type: "semantic",
      source_id: a,
      target_type: "semantic",
      target_id: b,
      relationship: "related",
    });
    const report = await checkReachability();
    expect(report.met).toBe(true);
    expect(report.via_graph).toBeGreaterThanOrEqual(2);
  });

  it("tombstoned rows are not required to be reachable", async () => {
    await reset();
    const sessionId = "mem32-tombstone-reach";
    await BrainManager.trackSession(sessionId, "MEM-32 tombstone", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Forget me",
      content: "tombstone reachability leaf",
      importance: 0.5,
      session_id: sessionId,
    });
    await BrainManager.forget(id);
    const report = await checkReachability();
    expect(report.missing_ids.some((g) => g.id === id)).toBe(false);
    expect(report.met).toBe(true);
  });
});

describe("MEM-32 Losslessness", () => {
  it("a leaf pointing at a live original holds", async () => {
    await reset();
    const sessionId = "mem32-loss-ok";
    await BrainManager.trackSession(sessionId, "MEM-32 loss", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Original leaf",
      content: "original text stays",
      importance: 0.6,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
       VALUES (NULL, 'leaf', 'semantic', ?, 'original text stays', 4)`,
      [String(id)],
    );
    const report = await checkLosslessness();
    expect(report.met).toBe(true);
    expect(report.leaves).toBe(1);
    expect(report.dangling).toBe(0);
  });

  it("a leaf pointing at a tombstone holds", async () => {
    await reset();
    const sessionId = "mem32-loss-tomb";
    await BrainManager.trackSession(sessionId, "MEM-32 loss tomb", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: "Soon gone",
      content: "will be tombstoned",
      importance: 0.5,
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
       VALUES (NULL, 'leaf', 'semantic', ?, 'will be tombstoned', 4)`,
      [String(id)],
    );
    await BrainManager.forget(id);
    const report = await checkLosslessness();
    expect(report.met).toBe(true);
    expect(report.dangling).toBe(0);
  });

  it("a dangling leaf fails Losslessness", async () => {
    await reset();
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
       VALUES (NULL, 'leaf', 'semantic', '999999', 'ghost', 1)`,
    );
    const report = await checkLosslessness();
    expect(report.met).toBe(false);
    expect(report.dangling).toBe(1);
    expect(report.dangling_ids[0]?.leaf_id).toBe("999999");
  });
});

describe("MEM-32 sleep / heal / phase status", () => {
  it("sleep records store invariants", async () => {
    await reset();
    const sessionId = "mem32-sleep";
    await BrainManager.trackSession(sessionId, "MEM-32 sleep", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Sleep invariant fact",
      content: "reachable after sleep",
      importance: 0.8,
      session_id: sessionId,
    });
    const cycle = await SleepConsolidation.runCycle();
    expect(cycle.invariants).toBeDefined();
    expect(cycle.invariants?.met).toBe(true);
    expect(cycle.invariants?.reachability.met).toBe(true);
    expect(cycle.invariants?.losslessness.met).toBe(true);

    const status = MemoryPipeline.getPhaseStatus();
    expect(status.reachability_invariant_met).toBe(true);
    expect(status.losslessness_invariant_met).toBe(true);
    expect(status.cycle_invariant_met).toBe(true);
  });

  it("getHealth reports a dangling leaf and heal check_invariants sees it", async () => {
    await reset();
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
       VALUES (NULL, 'leaf', 'semantic', '888888', 'ghost', 1)`,
    );
    const health = await BrainStore.getHealth();
    expect(health.issues.some((issue) => issue.includes("Losslessness"))).toBe(true);
    expect(health.recommendations.some((r) => r.includes("check_invariants"))).toBe(true);

    const healed = await BrainManager.runHealingAction("check_invariants");
    expect(healed.details).toMatch(/Losslessness: failed/);
    expect(healed.success).toBe(false);
  });

  it("heal rebuilds FTS when reachability only failed the index", async () => {
    await reset();
    const id = await insertEmptySemantic();
    await dropSemanticFts();
    expect((await checkReachability()).met).toBe(false);

    const healed = await BrainManager.runHealingAction("check_invariants");
    expect(healed.details).toMatch(/FTS rebuilt/);
    expect(healed.success).toBe(true);
    const after = await checkReachability();
    expect(after.met).toBe(true);
    expect(after.via_fts).toBeGreaterThanOrEqual(1);
    expect(after.missing_ids.some((g) => g.id === id)).toBe(false);
  });

  it("getPhaseStatus is the AND of the three invariants (IMP-01)", async () => {
    await reset();
    await ContextBuilder.buildDetailed({
      message: "phase status invariants",
      w: 8000,
      w_out: 1024,
    });
    await checkStoreInvariants();
    const status = BrainManager.getPhaseStatus();
    expect(status).toHaveProperty("budget_invariant_met");
    expect(status).toHaveProperty("reachability_invariant_met");
    expect(status).toHaveProperty("losslessness_invariant_met");
    expect(status.budget_invariant_met).toBe(true);
    expect(status.reachability_invariant_met).toBe(true);
    expect(status.losslessness_invariant_met).toBe(true);
    expect(status.cycle_invariant_met).toBe(true);
    expect(status.canonical_order).toHaveLength(8);
  });
});
