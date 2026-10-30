/**
 * MEM-20 — Reciprocal Rank Fusion over channels.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LEXICAL_SCORE_MIN } from "./RelevanceGate.js";
import {
  assignLexicalRanks,
  assignScoreRanks,
  fuseCandidateScore,
  leftoverAdditiveScore,
  rrfScore,
  winningRrfChannel,
  RECENCY_IMPORTANCE_THETA_MARGIN,
  RETRIEVAL_THRESHOLD_DEFAULT,
  RRF_CHANNEL_WEIGHTS_DEFAULT,
  RRF_K0_DEFAULT,
  type FusionResult,
} from "./RetrievalFusion.js";
import { getFusionWeights } from "./memoryConfigAccess.js";

const testDir = path.join(os.tmpdir(), `brain-rrf-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

function stub(id: number, scores: FusionResult["scores"], type: FusionResult["type"] = "semantic"): FusionResult {
  return {
    id,
    type,
    score: 0,
    scores,
    data: { id } as FusionResult["data"],
  };
}

describe("MEM-20 RRF (pure)", () => {
  it("rel = Σ w_s / (k₀ + rank_s); missing channels contribute 0", () => {
    expect(RRF_K0_DEFAULT).toBe(60);
    expect(rrfScore({})).toBe(0);
    expect(rrfScore({ lexical: 1 })).toBeCloseTo(1 / 61, 10);
    expect(rrfScore({ lexical: 2, graph: 1 })).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(rrfScore({ lexical: 1, ripgrep: 1, graph: 1, tree: 1 })).toBeCloseTo(4 / 61, 10);
    expect(rrfScore({ lexical: 0 })).toBe(0);
    expect(rrfScore({ lexical: 1 }, { ...RRF_CHANNEL_WEIGHTS_DEFAULT, lexical: 2 })).toBeCloseTo(2 / 61, 10);
    expect(rrfScore({ lexical: 1 }, RRF_CHANNEL_WEIGHTS_DEFAULT, 10)).toBeCloseTo(1 / 11, 10);
  });

  it("an irrelevant memory with high importance scores 0 (relevance-dominance)", () => {
    expect(
      fuseCandidateScore(
        { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
        { fts5: 0, trigram: 0, graph: 0, recency: 0.5, importance: 0.5 },
        RETRIEVAL_THRESHOLD_DEFAULT,
      ),
    ).toBe(0);
  });

  it("tree-only component scores contribute a channel rank", () => {
    expect(
      fuseCandidateScore({ fts5: 0, trigram: 0, graph: 0, recency: 0, importance: 0, tree: 0.8 }),
    ).toBeCloseTo(1 / 61, 10);
  });

  it("ripgrep-only component scores contribute a channel rank", () => {
    expect(
      fuseCandidateScore({ fts5: 0, trigram: 0, graph: 0, recency: 0, importance: 0, ripgrep: 1.5 }),
    ).toBeCloseTo(1 / 61, 10);
  });

  it("REL-03 lexical floor: graph-only component scores yield rel=0", () => {
    expect(
      fuseCandidateScore(
        { fts5: 0, trigram: 0, graph: 1, recency: 0, importance: 0.99 },
      ),
    ).toBe(0);
    expect(
      fuseCandidateScore(
        { fts5: LEXICAL_SCORE_MIN - 0.01, trigram: 0, graph: 1, recency: 0, importance: 1 },
      ),
    ).toBe(0);
    expect(
      fuseCandidateScore(
        { fts5: LEXICAL_SCORE_MIN, trigram: 0, graph: 0, recency: 0, importance: 0 },
      ),
    ).toBeCloseTo(1 / 61, 10);
  });

  it("lexical ranks are BM25-then-trigram", () => {
    const ranks = assignLexicalRanks([
      stub(1, { fts5: 0, trigram: 0.9, graph: 0, recency: 0, importance: 0 }),
      stub(2, { fts5: 0.8, trigram: 0.1, graph: 0, recency: 0, importance: 0 }),
      stub(3, { fts5: 0.4, trigram: 0.8, graph: 0, recency: 0, importance: 0 }),
      stub(4, { fts5: 0, trigram: 0, graph: 1, recency: 0, importance: 1 }),
    ]);
    expect(ranks.get("semantic:2")).toBe(1);
    expect(ranks.get("semantic:3")).toBe(2);
    expect(ranks.get("semantic:1")).toBe(3);
    expect(ranks.has("semantic:4")).toBe(false);
  });

  it("winning channel is the largest RRF term", () => {
    expect(winningRrfChannel({ lexical: 1 })).toBe("lexical");
    expect(winningRrfChannel({ lexical: 5, graph: 1 })).toBe("graph");
    expect(winningRrfChannel({})).toBeNull();
  });

  it("leftover additive admission still cannot qualify a miss by importance", () => {
    const theta = RETRIEVAL_THRESHOLD_DEFAULT;
    const conversational = getFusionWeights("conversational");
    const leftover = leftoverAdditiveScore(
      { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
      conversational,
      theta,
    );
    expect(leftover).toBeLessThan(theta);
    expect(leftover).toBeLessThanOrEqual(theta - RECENCY_IMPORTANCE_THETA_MARGIN + 1e-9);
    expect(
      fuseCandidateScore(
        { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
        conversational,
        theta,
      ),
    ).toBe(0);
  });

  it("assignScoreRanks is 1-indexed and skips non-positive scores", () => {
    const ranks = assignScoreRanks([
      { key: "semantic:9", score: 0.2 },
      { key: "semantic:3", score: 0.9 },
      { key: "semantic:1", score: 0 },
    ]);
    expect(ranks.get("semantic:3")).toBe(1);
    expect(ranks.get("semantic:9")).toBe(2);
    expect(ranks.has("semantic:1")).toBe(false);
  });
});

describe("MEM-20 RRF search wiring", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
    await BrainStore.saveConfig("retrieval_threshold", "0.35");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_collection_items");
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_associations");
    await db.exec("DELETE FROM brain_graph_edges");
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_sessions");
  }

  it("does not return a disjoint high-importance memory", async () => {
    await reset();
    const sessionId = "mem20-zero-overlap";
    await BrainManager.trackSession(sessionId, "MEM-20 overlap", testDir);
    const id = await BrainManager.store({
      category: "decision",
      title: "Use JWT refresh with OAuth",
      content: "oauth-jwt-refresh-token-alpha is the auth approach.",
      keywords: "auth, jwt, oauth, refresh",
      session_id: sessionId,
      importance: 0.99,
    });

    const results = await RetrievalFusion.search({
      query: "readme-badges-shields-zeta unique docs header",
      limit: 20,
      minScore: 0.35,
      includeEpisodic: false,
    });
    expect(results.some((r) => r.id === id)).toBe(false);
  });

  it("ranks a matching memory by lexical RRF, not importance", async () => {
    await reset();
    const sessionId = "mem20-lexical-rank";
    await BrainManager.trackSession(sessionId, "MEM-20 rank", testDir);
    const needle = "quartzrrfmem20leaf";
    const strongId = await BrainManager.store({
      category: "fact",
      title: `Alpha beta ${needle}`,
      content: `This document is about alpha beta ${needle} specifically.`,
      keywords: `${needle}, alpha, beta`,
      session_id: sessionId,
      importance: 0.2,
    });
    const weakId = await BrainManager.store({
      category: "fact",
      title: `Also ${needle}`,
      content: `Passing mention of ${needle} only.`,
      keywords: needle,
      session_id: sessionId,
      importance: 0.99,
    });

    const hits = await RetrievalFusion.search({
      query: `alpha beta ${needle}`,
      limit: 10,
      includeEpisodic: false,
    });
    const strong = hits.find((h) => h.id === strongId);
    const weak = hits.find((h) => h.id === weakId);
    expect(strong).toBeTruthy();
    expect(weak).toBeTruthy();
    expect(strong!.ranks?.lexical).toBe(1);
    expect(weak!.ranks?.lexical).toBeGreaterThan(1);
    expect(strong!.rel).toBeCloseTo(rrfScore(strong!.ranks ?? {}), 5);
    expect(strong!.rel!).toBeGreaterThan(weak!.rel!);
    expect(strong!.score).toBeCloseTo((strong!.rel ?? 0) * (strong!.priorFactor ?? 1), 5);
    expect(weak!.score).toBeCloseTo((weak!.rel ?? 0) * (weak!.priorFactor ?? 1), 5);
    expect(strong!.channel).toBe("lexical");
  });
});
