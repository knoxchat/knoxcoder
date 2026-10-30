/**
 * MEM-21 — Priors modulate relevance: score = rel · (1+η_U U) · (1+η_R R).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyTaskBias,
  applyTopicBias,
  fuseCandidateScore,
  rrfScore,
  TASK_SAME_BOOST,
  TOPIC_OTHER_PENALTY,
  TOPIC_SAME_BOOST,
  type FusionResult,
} from "./RetrievalFusion.js";
import { Value } from "./Value.js";
import type { SemanticMemory } from "./types.js";

const THEOREM = { F: 19 / 81, c: 0.5, pruneThreshold: 0.1, reviewThreshold: 0.5 };
const VALUE = {
  kappa: 5,
  archiveThreshold: 0.05,
  forgetting: THEOREM,
  etaUtility: 0.5,
  etaRetrievability: 0.3,
};

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function stubHit(
  id: number,
  score: number,
  extra: Partial<SemanticMemory> = {},
): FusionResult {
  return {
    id,
    type: "semantic",
    score,
    rel: score,
    scores: { fts5: 0.5, trigram: 0.2, graph: 0, recency: 0.5, importance: 0.5 },
    data: { id, ...extra } as SemanticMemory,
  };
}

describe("MEM-21 prior modulation (pure)", () => {
  it("score = rel · (1 + η_U U) · (1 + η_R R) with factors in [1, 1.95]", () => {
    expect(Value.ETA_UTILITY_DEFAULT).toBe(0.5);
    expect(Value.ETA_RETRIEVABILITY_DEFAULT).toBe(0.3);
    expect(Value.PRIOR_FACTOR_MAX_DEFAULT).toBeCloseTo(1.95, 10);

    expect(Value.priorModulation(0, 0)).toBe(1);
    expect(Value.priorModulation(1, 1)).toBeCloseTo(1.95, 10);
    expect(Value.priorModulation(0.4, 0.8)).toBeCloseTo(1.2 * 1.24, 10);

    const rel = 1 / 61;
    expect(Value.modulateRelevance(rel, 0.4, 0.8)).toBeCloseTo(rel * 1.2 * 1.24, 10);
    expect(Value.modulateRelevance(rel, 1, 1)).toBeCloseTo(rel * 1.95, 10);
    expect(Value.priorModulation(1, 1)).toBeGreaterThanOrEqual(Value.PRIOR_FACTOR_MIN);
    expect(Value.priorModulation(1, 1)).toBeLessThanOrEqual(Value.PRIOR_FACTOR_MAX_DEFAULT);
  });

  it("rel = 0 stays 0 even when U = R = 1 (relevance-dominance)", () => {
    expect(Value.modulateRelevance(0, 1, 1)).toBe(0);
    expect(Value.modulateRelevance(-0.2, 1, 1)).toBe(0);
    expect(Value.modulateRelevance(Number.NaN, 1, 1)).toBe(0);
    expect(
      fuseCandidateScore({ fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 }),
    ).toBe(0);
    expect(Value.modulateRelevance(0, 1, 1) * Value.priorModulation(1, 1)).toBe(0);
  });

  it("negative η cannot invert relevance; U/R outside [0, 1] are clamped", () => {
    expect(Value.priorFactor(-2, 1)).toBe(1);
    expect(Value.priorModulation(2, 2)).toBeCloseTo(1.95, 10);
    expect(Value.priorModulation(-1, -1)).toBe(1);
    expect(Value.modulateRelevance(0.1, 2, 2)).toBeCloseTo(0.1 * 1.95, 10);
  });

  it("modulateRelevanceFromSource uses stored U and R", () => {
    const source = {
      i0: 0.8,
      stability: 1,
      last_accessed_at: daysAgo(1),
      helpful_count: 0,
      unhelpful_count: 0,
    };
    const U = Value.utilityFromSource(source, VALUE);
    const R = Value.retrievabilityFromSource(source, VALUE);
    expect(U).toBeCloseTo(0.8, 10);
    expect(R).toBeCloseTo(0.9, 5);
    expect(Value.modulateRelevanceFromSource(0.2, source, VALUE)).toBeCloseTo(
      0.2 * (1 + 0.5 * U) * (1 + 0.3 * R),
      5,
    );
  });
});

describe("MEM-21 topic/task bias is multiplicative", () => {
  it("same-topic / other-topic scale score and cannot resurrect 0", () => {
    const sessionId = "s1";
    const ranked = applyTopicBias(
      [stubHit(1, 0.7, { topic_id: 10, source_session_id: sessionId }), stubHit(2, 0.7, { topic_id: 20, source_session_id: sessionId })],
      { currentTopicId: 20, sessionId },
    );
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].score).toBeCloseTo(0.7 * (1 + TOPIC_SAME_BOOST), 10);
    expect(ranked[1].id).toBe(1);
    expect(ranked[1].score).toBeCloseTo(0.7 * (1 - TOPIC_OTHER_PENALTY), 10);

    const resurrected = applyTopicBias(
      [stubHit(1, 0, { topic_id: 20, source_session_id: sessionId })],
      { currentTopicId: 20, sessionId },
    );
    expect(resurrected[0].score).toBe(0);
  });

  it("same-task scales score and cannot resurrect 0", () => {
    const ranked = applyTaskBias(
      [stubHit(1, 0.7, { task_id: "task-a" }), stubHit(2, 0.7, { task_id: "task-b" })],
      { currentTaskId: "task-b" },
    );
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].score).toBeCloseTo(0.7 * (1 + TASK_SAME_BOOST), 10);
    expect(ranked[1].score).toBe(0.7);

    const zero = applyTaskBias(
      [stubHit(1, 0, { task_id: "task-b" })],
      { currentTaskId: "task-b" },
    );
    expect(zero[0].score).toBe(0);
  });
});

describe("MEM-21 prior search wiring", () => {
  const testDir = path.join(os.tmpdir(), `brain-mem21-${Date.now()}`);
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

  it("live score is rel · priorFactor and stays 0 on a disjoint high-U memory", async () => {
    await reset();
    const sessionId = "mem21-score";
    const token = "quartzpriormem21leaf";
    await BrainManager.trackSession(sessionId, "MEM-21 score", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: `Alpha beta ${token}`,
      content: `This document is about alpha beta ${token} specifically.`,
      keywords: `${token}, alpha, beta`,
      session_id: sessionId,
      importance: 0.8,
    });

    const hits = await RetrievalFusion.search({
      query: `alpha beta ${token}`,
      limit: 10,
      includeEpisodic: false,
    });
    const hit = hits.find((h) => h.id === id);
    expect(hit).toBeTruthy();
    expect(hit!.rel).toBeCloseTo(rrfScore(hit!.ranks ?? {}), 5);
    expect(hit!.priorFactor).toBeCloseTo(
      Value.priorModulation(hit!.utility ?? 0, hit!.retrievability ?? 0),
      5,
    );
    expect(hit!.score).toBeCloseTo((hit!.rel ?? 0) * (hit!.priorFactor ?? 1), 5);
    expect(hit!.score).toBeGreaterThan(hit!.rel ?? 0);
    expect(hit!.priorFactor).toBeGreaterThanOrEqual(1);
    expect(hit!.priorFactor).toBeLessThanOrEqual(1.95);

    const miss = await RetrievalFusion.search({
      query: "readme-badges-shields-zeta unique docs header",
      limit: 20,
      minScore: 0.35,
      includeEpisodic: false,
    });
    expect(miss.some((r) => r.id === id)).toBe(false);
  });

  it("high U outranks a relevant low-U hit when both match the query", async () => {
    await reset();
    const sessionId = "mem21-utility-rank";
    const token = "quartzpriorutilmem21";
    await BrainManager.trackSession(sessionId, "MEM-21 U rank", testDir);
    const lowId = await BrainManager.store({
      category: "fact",
      title: `Low utility ${token} alpha`,
      content: `Low-utility leaf describing ${token} for prior-modulation ranking.`,
      keywords: `${token}, alpha, lowutil`,
      session_id: sessionId,
      importance: 0.5,
    });
    const highId = await BrainManager.store({
      category: "fact",
      title: `High utility ${token} omega`,
      content: `High-utility leaf describing ${token} for prior-modulation ranking.`,
      keywords: `${token}, omega, highutil`,
      session_id: sessionId,
      importance: 0.5,
    });
    expect(highId).not.toBe(lowId);

    const db = await BrainStore.get();
    await db.run("UPDATE brain_semantic SET helpful_count = 20, unhelpful_count = 0 WHERE id = ?", [highId]);
    await db.run("UPDATE brain_semantic SET helpful_count = 0, unhelpful_count = 20 WHERE id = ?", [lowId]);

    const hits = await RetrievalFusion.search({
      query: token,
      limit: 10,
      includeEpisodic: false,
    });
    const high = hits.find((h) => h.id === highId);
    const low = hits.find((h) => h.id === lowId);
    expect(high).toBeTruthy();
    expect(low).toBeTruthy();
    expect(high!.utility!).toBeGreaterThan(low!.utility!);
    expect(high!.score).toBeGreaterThan(low!.score);
  });

  it("older R reduces the prior factor of an otherwise identical hit", async () => {
    await reset();
    const sessionId = "mem21-R";
    const token = "quartzpriorrmem21leaf";
    await BrainManager.trackSession(sessionId, "MEM-21 R", testDir);
    const freshId = await BrainManager.store({
      category: "fact",
      title: `Fresh ${token}`,
      content: `Fresh document about ${token} for retrievability.`,
      keywords: token,
      session_id: sessionId,
      importance: 0.8,
    });
    const staleId = await BrainManager.store({
      category: "fact",
      title: `Stale ${token}`,
      content: `Stale document about ${token} for retrievability.`,
      keywords: token,
      session_id: sessionId,
      importance: 0.8,
    });
    const db = await BrainStore.get();
    await db.run("UPDATE brain_semantic SET last_accessed_at = ? WHERE id = ?", [daysAgo(43), staleId]);

    const hits = await RetrievalFusion.search({
      query: token,
      limit: 10,
      includeEpisodic: false,
    });
    const fresh = hits.find((h) => h.id === freshId);
    const stale = hits.find((h) => h.id === staleId);
    expect(fresh).toBeTruthy();
    expect(stale).toBeTruthy();
    expect(fresh!.retrievability!).toBeGreaterThan(stale!.retrievability!);
    expect(fresh!.priorFactor!).toBeGreaterThan(stale!.priorFactor!);
  });
});
