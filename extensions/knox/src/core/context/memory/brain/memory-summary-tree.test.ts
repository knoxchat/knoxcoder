/**
 * MEM-24 — summary tree + beam search.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rrfScore } from "./RetrievalFusion.js";
import {
  isTreeReady,
  scoreTreeText,
  TREE_BEAM_DEFAULT,
  TREE_BRANCHING_DEFAULT,
} from "./SummaryTree.js";

const testDir = path.join(os.tmpdir(), `brain-mem24-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let insertTreeLeaf: typeof import("./SummaryTree.js").insertTreeLeaf;
let ingestSessionLeaves: typeof import("./SummaryTree.js").ingestSessionLeaves;
let maxChildCount: typeof import("./SummaryTree.js").maxChildCount;
let searchTreeChannel: typeof import("./SummaryTree.js").searchTreeChannel;
let treeBeamStatus: typeof import("./SummaryTree.js").treeBeamStatus;

describe("MEM-24 tree (pure)", () => {
  it("defaults are b=8 and B=4", () => {
    expect(TREE_BRANCHING_DEFAULT).toBe(8);
    expect(TREE_BEAM_DEFAULT).toBe(4);
    expect(isTreeReady(7, 8)).toBe(false);
    expect(isTreeReady(8, 8)).toBe(true);
  });

  it("scores nodes by lexical overlap, not embeddings", () => {
    expect(scoreTreeText("knoxTreeBeamToken", "notes about knoxTreeBeamToken in auth")).toBeGreaterThan(
      scoreTreeText("knoxTreeBeamToken", "unrelated grocery list"),
    );
    expect(scoreTreeText("AuthService", "wire AuthService in the container")).toBeGreaterThan(0);
    expect(scoreTreeText("readme badges", "oauth jwt refresh")).toBe(0);
  });
});

describe("MEM-24 tree insertion + beam", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ Hippocampus } = await import("./regions/Hippocampus.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
    ({
      insertTreeLeaf,
      ingestSessionLeaves,
      maxChildCount,
      searchTreeChannel,
      treeBeamStatus,
    } = await import("./SummaryTree.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_summary_tree");
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_sessions");
    await BrainStore.reloadConfig();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  }

  it("keeps every node at ≤ b children and promotes when the root is full", async () => {
    await reset();
    const sessionId = "mem24-branch";
    await BrainManager.trackSession(sessionId, "MEM-24 branch", testDir);
    const db = await BrainStore.get();
    for (let i = 0; i < 5; i++) {
      const id = await BrainStore.storeSemantic({
        category: "fact",
        title: `Leaf ${i} knoxTreeBranch${i}`,
        content: `branching leaf ${i} knoxTreeBranchToken unique-${i}`,
        keywords: `branch, leaf${i}`,
        session_id: sessionId,
      });
      await insertTreeLeaf(
        { type: "semantic", id, text: `branching leaf ${i} knoxTreeBranchToken` },
        { sessionId, db, branching: 2 },
      );
    }
    expect(await maxChildCount(sessionId, { db })).toBeLessThanOrEqual(2);
    const nodes = (await db.all(
      "SELECT id, parent_id FROM brain_summary_tree WHERE kind = 'node'",
    )) as { id: number; parent_id: number | null }[];
    expect(nodes.some((n) => n.parent_id == null)).toBe(true);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to flat FTS when the tree has fewer than b leaves", async () => {
    await reset();
    const sessionId = "mem24-small";
    const token = "knoxTreeSmallToken";
    await BrainManager.trackSession(sessionId, "MEM-24 small", testDir);
    for (let i = 0; i < 3; i++) {
      await BrainStore.storeSemantic({
        category: "fact",
        title: `${token} ${i}`,
        content: `document ${i} about ${token} unique-${i}`,
        keywords: `${token}, leaf${i}`,
        session_id: sessionId,
      });
    }
    await Hippocampus.persistToLongTerm(sessionId, { semantic_count: 3, entity_count: 0 });
    const status = await treeBeamStatus({ query: token, sessionId });
    expect(status.ready).toBe(false);
    expect(status.leafCount).toBeGreaterThanOrEqual(3);
    expect(status.leafCount).toBeLessThan(8);
    expect(status.epsilonB).toBeNull();
    expect(await searchTreeChannel({ query: token, sessionId })).toEqual([]);

    const hits = await RetrievalFusion.search({
      query: token,
      includeEpisodic: false,
      sessionId,
    });
    expect(hits.some((h) => h.ranks?.tree != null)).toBe(false);
    expect(hits.some((h) => (h.scores.tree ?? 0) > 0)).toBe(false);
  });

  it("φ₅ ingest inserts leaves and fusion assigns a tree rank once ready", async () => {
    await reset();
    const sessionId = "mem24-ready";
    const token = "knoxTreeReadyToken";
    await BrainManager.trackSession(sessionId, "MEM-24 ready", testDir);
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(
        await BrainStore.storeSemantic({
          category: "fact",
          title: `${token} leaf ${i}`,
          content: `Stored text ${i} mentions ${token} for the summary tree unique-${i}.`,
          keywords: `${token}, leaf${i}`,
          session_id: sessionId,
        }),
      );
    }
    const first = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 8,
      entity_count: 0,
    });
    expect(first.compressed).toBeGreaterThanOrEqual(8);
    const again = await Hippocampus.persistToLongTerm(sessionId, {
      semantic_count: 8,
      entity_count: 0,
    });
    expect(again.compressed).toBe(0);

    const db = await BrainStore.get();
    expect(await maxChildCount(sessionId, { db })).toBeLessThanOrEqual(8);
    const original = await db.get<{ content: string }>(
      "SELECT content FROM brain_semantic WHERE id = ?",
      [ids[0]],
    );
    expect(original?.content).toContain(token);

    const status = await treeBeamStatus({ query: token, sessionId });
    expect(status.ready).toBe(true);
    expect(status.epsilonB).toBeNull();

    const channel = await searchTreeChannel({ query: token, sessionId, includeEpisodic: false });
    expect(channel.some((h) => ids.includes(h.id))).toBe(true);

    const hits = await RetrievalFusion.search({
      query: token,
      includeEpisodic: false,
      sessionId,
    });
    const hit = hits.find((h) => ids.includes(h.id));
    expect(hit).toBeTruthy();
    expect(hit!.ranks?.tree).toBeGreaterThanOrEqual(1);
    expect(hit!.rel).toBeCloseTo(rrfScore(hit!.ranks ?? {}), 5);
  });

  it("beam prefers the matching branch among B·b scored children", async () => {
    await reset();
    const sessionId = "mem24-beam";
    await BrainManager.trackSession(sessionId, "MEM-24 beam", testDir);
    const db = await BrainStore.get();
    let targetId = 0;
    for (let i = 0; i < 8; i++) {
      const token = i === 0 ? "knoxTreeUniqueOmega" : "knoxTreeFillerAlpha";
      const id = await BrainStore.storeSemantic({
        category: "fact",
        title: `Beam ${i} ${token}`,
        content: `branch ${i} is about ${token} unique-${i}`,
        keywords: `${token}, leaf${i}`,
        session_id: sessionId,
      });
      if (i === 0) targetId = id;
      await insertTreeLeaf(
        { type: "semantic", id, text: `branch ${i} is about ${token}` },
        { sessionId, db, branching: 8 },
      );
    }
    const hits = await searchTreeChannel({
      query: "knoxTreeUniqueOmega",
      sessionId,
      includeEpisodic: false,
      branching: 8,
      beam: 4,
    });
    expect(hits[0]?.id).toBe(targetId);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("does not resurrect a disjoint high-importance memory", async () => {
    await reset();
    const sessionId = "mem24-miss";
    await BrainManager.trackSession(sessionId, "MEM-24 miss", testDir);
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(
        await BrainStore.storeSemantic({
          category: "decision",
          title: `JWT ${i} leafidx${i}`,
          content: `oauth-jwt-refresh-token-omega leaf ${i} leafidx${i}`,
          keywords: `auth, jwt, oauth, leaf${i}`,
          session_id: sessionId,
          importance: 0.99,
        }),
      );
    }
    await ingestSessionLeaves(sessionId);
    const hits = await RetrievalFusion.search({
      query: "readme-badges-shields-zeta unique docs header",
      includeEpisodic: false,
      sessionId,
      minScore: 0.35,
    });
    expect(hits.some((h) => ids.includes(h.id))).toBe(false);
  });
});
