/**
 * REL-02 — Absolute fusion scores (no per-query BM25 min-max).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  detectFusionProfile,
  fusionWeightsAreSafe,
  FUSION_WEIGHT_PROFILES,
  getFusionWeights,
} from "./memoryConfigAccess.js";
import {
  fuseCandidateScore,
  normalizeBm25,
  RECENCY_IMPORTANCE_THETA_MARGIN,
} from "./RetrievalFusion.js";

describe("REL-02 absolute BM25 + fusion cap (pure)", () => {
  it("maps BM25 independently of other hits (not min-max)", () => {
    expect(normalizeBm25(0)).toBe(0);
    expect(normalizeBm25(-1)).toBe(0);
    const weak = normalizeBm25(0.15);
    const strong = normalizeBm25(2.5);
    expect(weak).toBeGreaterThan(0);
    expect(weak).toBeLessThan(0.2);
    expect(strong).toBeGreaterThan(0.9);
    expect(strong).toBeLessThanOrEqual(1);
    // Same raw always the same — a lone weak hit is not stretched to 1.0
    expect(normalizeBm25(0.15)).toBe(weak);
    expect(weak).not.toBeCloseTo(1, 1);
  });

  it("a high-importance memory with zero overlap scores below θ", () => {
    const theta = 0.6;
    const conversational = getFusionWeights("conversational");
    const score = fuseCandidateScore(
      { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
      conversational,
      theta,
    );
    expect(score).toBeLessThan(theta);
    expect(score).toBeLessThanOrEqual(theta - RECENCY_IMPORTANCE_THETA_MARGIN + 1e-9);
  });

  it("caps recency+importance so they cannot clear θ alone even with heavy weights", () => {
    const theta = 0.6;
    const heavyRi = {
      fts5: 0.1,
      trigram: 0.1,
      graph: 0.1,
      recency: 0.4,
      importance: 0.4,
    };
    const zeroLexical = fuseCandidateScore(
      { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
      heavyRi,
      theta,
    );
    expect(zeroLexical).toBeLessThan(theta);
    expect(zeroLexical).toBeCloseTo(theta - RECENCY_IMPORTANCE_THETA_MARGIN, 5);

    const withLexical = fuseCandidateScore(
      { fts5: 0.8, trigram: 0, graph: 0, recency: 1, importance: 1 },
      heavyRi,
      theta,
    );
    expect(withLexical).toBeGreaterThan(theta);
  });

  it("REL-11: graph cannot lift a zero-lexical candidate over θ", () => {
    const theta = 0.6;
    const heavyGraph = {
      fts5: 0.1,
      trigram: 0.1,
      graph: 0.9,
      recency: 0.15,
      importance: 0.15,
    };
    const score = fuseCandidateScore(
      { fts5: 0, trigram: 0, graph: 1, recency: 1, importance: 1 },
      heavyGraph,
      theta,
    );
    expect(score).toBeLessThan(theta);

    const withLexicalFloor = fuseCandidateScore(
      { fts5: 0.3, trigram: 0, graph: 1, recency: 0.5, importance: 0.5 },
      heavyGraph,
      theta,
    );
    expect(withLexicalFloor).toBeGreaterThan(score);
  });
});

describe("REL-09 fusion weight safety (pure)", () => {
  const theta = 0.6;

  it("every profile has w_recency + w_importance < retrieval_threshold", () => {
    for (const profile of FUSION_WEIGHT_PROFILES) {
      const weights = getFusionWeights(profile);
      expect(fusionWeightsAreSafe(weights, theta)).toBe(true);
      expect(weights.recency + weights.importance).toBeLessThan(theta);
      const zeroOverlap = fuseCandidateScore(
        { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
        weights,
        theta,
      );
      expect(zeroOverlap).toBeLessThan(theta);
    }
  });

  it("conversational recency is lowered and fts5 is raised", () => {
    const conversational = getFusionWeights("conversational");
    expect(conversational.recency).toBeLessThanOrEqual(0.15);
    expect(conversational.fts5).toBeGreaterThanOrEqual(0.40);
    expect(conversational.recency + conversational.importance).toBeLessThan(theta);
  });

  it("continuation ranks recency higher within a gated (lexical) set", () => {
    const continuation = getFusionWeights("continuation");
    expect(continuation.recency).toBeGreaterThan(getFusionWeights("conversational").recency);
    const recent = fuseCandidateScore(
      { fts5: 0.8, trigram: 0, graph: 0, recency: 1, importance: 0.5 },
      continuation,
      theta,
    );
    const stale = fuseCandidateScore(
      { fts5: 0.8, trigram: 0, graph: 0, recency: 0.2, importance: 0.5 },
      continuation,
      theta,
    );
    expect(recent).toBeGreaterThan(stale);
  });

  it("detects continuation even after REL-01 query expansion", () => {
    expect(detectFusionProfile("continue")).toBe("continuation");
    expect(
      detectFusionProfile("oauth jwt refresh", {
        intent: "continuation",
        originalQuery: "continue",
      }),
    ).toBe("continuation");
  });

  it("does not treat a short task message as factual importance boost", () => {
    expect(detectFusionProfile("use sqlite for the brain")).toBe("default");
    expect(detectFusionProfile("What is JWT?")).toBe("factual");
    const factual = getFusionWeights("factual");
    const defaults = getFusionWeights("default");
    expect(factual.importance).toBeLessThanOrEqual(defaults.importance);
  });

  it("classifies procedural from the original message, not the stripped query", () => {
    expect(
      detectFusionProfile("install docker", {
        originalQuery: "How to install docker",
      }),
    ).toBe("procedural");
  });
});

describe("REL-02 fusion search wiring", () => {
  const testDir = path.join(os.tmpdir(), `brain-rel02-${Date.now()}`);
  let BrainManager: typeof import("./BrainManager.js").BrainManager;
  let BrainStore: typeof import("./BrainStore.js").BrainStore;
  let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

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
    await BrainStore.saveConfig("retrieval_threshold", "0.6");
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
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_sessions");
  }

  it("does not inject a disjoint high-importance memory at θ", async () => {
    await reset();
    const sessionId = "rel02-zero-overlap";
    await BrainManager.trackSession(sessionId, "REL-02 overlap", testDir);
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
      minScore: 0.6,
      includeEpisodic: false,
    });
    expect(results.some((r) => r.id === id)).toBe(false);
  });

  it("gives the same document comparable fts5 scores across candidate-set sizes", async () => {
    await reset();
    const sessionId = "rel02-set-size";
    await BrainManager.trackSession(sessionId, "REL-02 set size", testDir);
    const needle = "rel02targetneedle";
    const targetId = await BrainManager.store({
      category: "fact",
      title: `Target ${needle}`,
      content: `This document is about ${needle} specifically.`,
      keywords: needle,
      session_id: sessionId,
      importance: 0.5,
    });

    const first = await RetrievalFusion.search({
      query: needle,
      limit: 20,
      includeEpisodic: false,
    });
    const firstHit = first.find((r) => r.id === targetId);
    expect(firstHit).toBeTruthy();
    // Lone hit must not collapse to 0 (old min-max when max===min).
    expect(firstHit!.scores.fts5).toBeGreaterThan(0);

    for (let i = 0; i < 12; i++) {
      await BrainManager.store({
        category: "fact",
        title: `Filler ${i} ${needle}`,
        content: `Filler document ${i} also mentions ${needle} in passing.`,
        keywords: needle,
        session_id: sessionId,
        importance: 0.5,
      });
    }

    const second = await RetrievalFusion.search({
      query: needle,
      limit: 20,
      includeEpisodic: false,
    });
    const secondHit = second.find((r) => r.id === targetId);
    expect(secondHit).toBeTruthy();
    expect(secondHit!.scores.fts5).toBeCloseTo(firstHit!.scores.fts5, 2);
  });
});
