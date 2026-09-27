/**
 * REL-17 — Multi-task mismatch regressions (Sprint A: cases 1–4, 9).
 * Also covers REL-03 / REL-04 acceptance on the sqlite path.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fuseCandidateScore, RECENCY_IMPORTANCE_THETA_MARGIN } from "./RetrievalFusion.js";
import { getFusionWeights } from "./memoryConfigAccess.js";

const testDir = path.join(os.tmpdir(), `brain-mismatch-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;
let PrefrontalCortex: typeof import("./regions/PrefrontalCortex.js").PrefrontalCortex;
let AutoMemory: typeof import("./AutoMemory.js").AutoMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ Hippocampus } = await import("./regions/Hippocampus.js"));
  ({ PrefrontalCortex } = await import("./regions/PrefrontalCortex.js"));
  ({ AutoMemory } = await import("./AutoMemory.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "project");
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
  (BrainManager as any).workingMem = null;
  (BrainManager as any).workingMemSessionId = null;
  (BrainManager as any).activeSessionId = null;
  PrefrontalCortex.resetAll();
}

async function storeAuthAndReadme(sessionId: string): Promise<{ authId: number; readmeId: number }> {
  await BrainManager.trackSession(sessionId, "Mismatch", testDir);
  const authId = await BrainManager.store({
    category: "decision",
    title: "Use JWT refresh with OAuth",
    content: "oauth-jwt-refresh-token-alpha is the auth approach.",
    keywords: "auth, jwt, oauth, refresh",
    session_id: sessionId,
    importance: 0.99,
  });
  const readmeId = await BrainManager.store({
    category: "fact",
    title: "README badge layout",
    content: "readme-badges-shields-beta belong in the docs header.",
    keywords: "readme, badges, shields, docs",
    session_id: sessionId,
    importance: 0.7,
  });
  return { authId, readmeId };
}

describe("REL-17 mismatch suite (Sprint A)", () => {
  it("1. topic switch: oauth memory is omitted on a README query", async () => {
    await reset();
    const sessionId = "mismatch-topic-switch";
    await storeAuthAndReadme(sessionId);

    const result = await MemoryPipeline.runPreTurn({
      message: "update the README badges",
      session_id: sessionId,
      goal: "update the README badges",
    });

    const titles = (result.context?.items ?? []).map((i) => i.title);
    expect(titles).not.toContain("Use JWT refresh with OAuth");
    expect(result.context?.context ?? "").not.toContain("oauth-jwt-refresh-token-alpha");
    expect(result.context?.context ?? "").toContain("readme-badges-shields-beta");
  });

  it("2. continuation: expanded continue still retrieves auth", async () => {
    await reset();
    const sessionId = "mismatch-continue";
    await storeAuthAndReadme(sessionId);
    await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth, login, refresh",
      0,
      2,
      0.9,
    );
    await BrainManager.recordMessage(
      sessionId,
      "user",
      "How should we implement JWT refresh tokens with OAuth?",
      { importance: 0.8 },
    );

    const result = await MemoryPipeline.runPreTurn({
      message: "continue",
      session_id: sessionId,
      goal: "continue",
    });

    expect(result.context?.context ?? "").toContain("oauth-jwt-refresh-token-alpha");
    expect(result.context?.context ?? "").not.toContain("readme-badges-shields-beta");
  });

  it("3. stopwords: ok now do it does not FTS-match everything", async () => {
    await reset();
    const sessionId = "mismatch-stopwords";
    await storeAuthAndReadme(sessionId);

    const result = await MemoryPipeline.runPreTurn({
      message: "ok now do it",
      session_id: sessionId,
      goal: "ok now do it",
    });

    const semanticTitles = (result.context?.items ?? [])
      .filter((i) => i.kind === "semantic")
      .map((i) => i.title);
    expect(semanticTitles).not.toContain("Use JWT refresh with OAuth");
    expect(semanticTitles).not.toContain("README badge layout");
  });

  it("4. min-max: zero-overlap recency+importance stays below θ", () => {
    const theta = 0.6;
    const score = fuseCandidateScore(
      { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
      getFusionWeights("conversational"),
      theta,
    );
    expect(score).toBeLessThan(theta);
    expect(score).toBeLessThanOrEqual(theta - RECENCY_IMPORTANCE_THETA_MARGIN + 1e-9);
  });

  it("9. φ₆ fusion search is invoked once per runPreTurn", async () => {
    await reset();
    const sessionId = "mismatch-fusion-once";
    await storeAuthAndReadme(sessionId);
    const spy = vi.spyOn(RetrievalFusion, "search");

    await MemoryPipeline.runPreTurn({
      message: "update the README badges",
      session_id: sessionId,
      goal: "update the README badges",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("REL-17 mismatch suite (Sprint B / REL-06)", () => {
  it("5. WM flush: attend Task A, then new-task message omits A from buildContext", async () => {
    await reset();
    const sessionId = "mismatch-wm-flush";
    await BrainManager.trackSession(sessionId, "WM flush", testDir);

    const wm = BrainManager.getWorkingMemory();
    wm.add({
      id: "task-a-salient",
      content: "oauth jwt refresh Task A scratchpad",
      source: "user",
      relevance: 0.95,
    });
    expect(wm.buildContext()).toContain("oauth jwt refresh Task A scratchpad");

    const result = await MemoryPipeline.runPreTurn({
      message: "now update the README badges",
      session_id: sessionId,
      goal: "now update the README badges",
    });

    const after = BrainManager.getWorkingMemory();
    expect(after.get("task-a-salient")).toBeUndefined();
    expect(after.buildContext() ?? "").not.toContain("oauth jwt refresh Task A scratchpad");
    expect(result.context?.context ?? "").not.toContain("oauth jwt refresh Task A scratchpad");
  });

  it("continuation keeps WM items for the active topic", async () => {
    await reset();
    const sessionId = "mismatch-wm-continue";
    await BrainManager.trackSession(sessionId, "WM continue", testDir);
    await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth, login, refresh",
      0,
      2,
      0.9,
    );
    await BrainManager.recordMessage(
      sessionId,
      "user",
      "How should we implement JWT refresh tokens with OAuth?",
      { importance: 0.8 },
    );

    const wm = BrainManager.getWorkingMemory();
    wm.add({
      id: "task-a-salient",
      content: "oauth jwt refresh Task A scratchpad",
      source: "user",
      relevance: 0.95,
    });

    await MemoryPipeline.runPreTurn({
      message: "continue",
      session_id: sessionId,
      goal: "continue",
    });

    const after = BrainManager.getWorkingMemory();
    expect(after.get("task-a-salient")).toBeDefined();
    expect(after.buildContext("oauth jwt refresh") ?? "").toContain(
      "oauth jwt refresh Task A scratchpad",
    );
  });
});

describe("REL-17 mismatch suite (Sprint B / REL-07 + REL-10)", () => {
  it("6. goal isolation: extracted title is not C_goal on the next question", async () => {
    await reset();
    const sessionId = "mismatch-goal-isolation";
    await BrainManager.trackSession(sessionId, "Goal isolation", testDir);
    PrefrontalCortex.setGoal("old leftover goal", sessionId);

    await Hippocampus.store({
      category: "decision",
      title: "Decision: use postgres",
      content: "We decided to use postgres for the primary store.",
      keywords: "postgres, database, decision",
      session_id: sessionId,
      importance: 0.95,
    });
    expect(PrefrontalCortex.getGoal(sessionId)).toBe("old leftover goal");
    expect(PrefrontalCortex.getRecentKnowledgeHint(sessionId)).toBe(
      "Decision: use postgres",
    );

    const ask = "how do I style the button?";
    const result = await MemoryPipeline.runPreTurn({
      message: ask,
      session_id: sessionId,
    });

    const ctx = result.context?.context ?? "";
    expect(ctx).toContain("=== Current Task ===");
    expect(ctx).toContain(ask);
    expect(ctx).not.toMatch(/=== Current Task ===\s*Decision: use postgres/);
    expect(PrefrontalCortex.getGoal(sessionId)).toContain("button");
  });

  it("10. unrelated pins do not exhaust budget before a matching fact", async () => {
    await reset();
    const sessionId = "mismatch-pinned-budget";
    await BrainManager.trackSession(sessionId, "Pinned budget", testDir);

    const pinSeeds = [
      { title: "Garden watering schedule", content: "tomato-basil-garden-zeta prefers morning watering.", keywords: "garden, tomato, watering" },
      { title: "Sourdough starter feeding", content: "sourdough-rye-starter-eta is fed twice a week.", keywords: "sourdough, rye, baking" },
      { title: "Bike chain lubrication", content: "bike-chain-wax-theta lasts longer than oil.", keywords: "bike, chain, wax" },
      { title: "Chess opening repertoire", content: "sicilian-najdorf-iota is the preferred black opening.", keywords: "chess, sicilian, najdorf" },
      { title: "Aquarium nitrogen cycle", content: "aquarium-nitrate-kappa needs weekly water changes.", keywords: "aquarium, nitrate, fish" },
    ];
    const pinIds: number[] = [];
    for (const seed of pinSeeds) {
      const id = await BrainManager.store({
        category: "fact",
        ...seed,
        session_id: sessionId,
        importance: 0.99,
      });
      expect(await BrainManager.pinMemory(id)).toBe(true);
      pinIds.push(id);
    }
    expect(new Set(pinIds).size).toBe(5);

    await BrainManager.store({
      category: "fact",
      title: "README badge layout",
      content: "readme-badges-shields-beta belong in the docs header.",
      keywords: "readme, badges, shields, docs",
      session_id: sessionId,
      importance: 0.7,
    });

    const result = await MemoryPipeline.runPreTurn({
      message: "update the README badges",
      session_id: sessionId,
      goal: "update the README badges",
      max_tokens: 800,
    });

    const ctx = result.context?.context ?? "";
    expect(ctx).toContain("readme-badges-shields-beta");
    const pinHits = [...new Set(pinIds)].filter((id) =>
      (result.context?.items ?? []).some((item) => item.id === id),
    );
    expect(pinHits.length).toBeLessThanOrEqual(2);
    expect(result.context?.items.some((i) => i.title === "README badge layout")).toBe(
      true,
    );
  });

  it("7. dedup: extract same decision twice → one row", async () => {
    await reset();
    const sessionId = "mismatch-dedup";
    await BrainManager.trackSession(sessionId, "Dedup", testDir);
    const text = "We decided to use SQLite for the brain storage layer.";
    await AutoMemory.extract(text, "user", sessionId);
    await AutoMemory.extract(text, "user", sessionId);
    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT id FROM brain_semantic WHERE source_session_id = ?",
      [sessionId],
    );
    expect(rows.length).toBe(1);
  });
});

describe("REL-17 mismatch suite (Sprint C / REL-12)", () => {
  async function retrievalCount(id: number): Promise<number> {
    const db = await BrainStore.get();
    const row = (await db.get(
      "SELECT retrieval_count FROM brain_semantic WHERE id = ?",
      [id],
    )) as { retrieval_count: number };
    return row.retrieval_count;
  }

  it("8. retrieval_count: mismatched query does not bump gated-out ids", async () => {
    await reset();
    const sessionId = "mismatch-retrieval-count";
    const { authId, readmeId } = await storeAuthAndReadme(sessionId);
    expect(await retrievalCount(authId)).toBe(0);
    expect(await retrievalCount(readmeId)).toBe(0);

    for (let i = 0; i < 10; i++) {
      await MemoryPipeline.runPreTurn({
        message: "update the README badges",
        session_id: sessionId,
        goal: "update the README badges",
      });
    }

    expect(await retrievalCount(authId)).toBe(0);
    expect(await retrievalCount(readmeId)).toBeGreaterThanOrEqual(1);
  });

  it("LIKE candidate search does not bump retrieval_count", async () => {
    await reset();
    const sessionId = "mismatch-like-no-bump";
    const { authId } = await storeAuthAndReadme(sessionId);
    const hits = await BrainStore.searchSemantic("oauth jwt", undefined, 10);
    expect(hits.some((h) => h.id === authId)).toBe(true);
    expect(await retrievalCount(authId)).toBe(0);
  });

  it("LIKE fallback bumps only assembled items", async () => {
    await reset();
    const sessionId = "mismatch-like-assembled";
    const { authId, readmeId } = await storeAuthAndReadme(sessionId);

    const built = await ContextBuilder.buildDetailed({
      message: "update the README badges",
      session_id: sessionId,
      fusion_hits: [],
    });

    expect(built.items.some((i) => i.id === readmeId)).toBe(true);
    expect(built.items.some((i) => i.id === authId)).toBe(false);
    expect(await retrievalCount(readmeId)).toBe(1);
    expect(await retrievalCount(authId)).toBe(0);
  });
});

describe("REL-03 / REL-04 assembly provenance", () => {
  it("Task A fails the gate on a disjoint Task B query", async () => {
    await reset();
    const sessionId = "rel03-gate-drop";
    const { authId } = await storeAuthAndReadme(sessionId);
    const hits = await RetrievalFusion.search({
      query: "update the README badges",
      limit: 20,
      minScore: 0.6,
      includeEpisodic: false,
    });
    expect(hits.some((h) => h.id === authId)).toBe(false);
  });

  it("pinned items still inject with reason starting with pinned", async () => {
    await reset();
    const sessionId = "rel03-pinned";
    const { authId } = await storeAuthAndReadme(sessionId);
    expect(await BrainManager.pinMemory(authId)).toBe(true);

    const result = await MemoryPipeline.runPreTurn({
      message: "update the README badges",
      session_id: sessionId,
      goal: "update the README badges",
    });

    const pinned = result.context?.items.find((i) => i.id === authId);
    expect(pinned).toBeTruthy();
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.reason.startsWith("pinned")).toBe(true);
  });

  it("injected semantic items use fusion score, not importance", async () => {
    await reset();
    const sessionId = "rel03-fusion-score";
    await storeAuthAndReadme(sessionId);

    const result = await MemoryPipeline.runPreTurn({
      message: "update the README badges",
      session_id: sessionId,
      goal: "update the README badges",
    });

    const readme = result.context?.items.find((i) => i.title === "README badge layout");
    expect(readme).toBeTruthy();
    expect(typeof readme?.score).toBe("number");
    expect(readme?.score).not.toBe(0.7);
    expect(readme!.score!).toBeGreaterThan(0);
    expect(readme!.score!).toBeLessThanOrEqual(1);
    expect(readme?.reason).toMatch(/lexical:/);
    expect(readme?.reason).not.toMatch(/importance/i);
  });

  it("graph entities that fail the gate are omitted", async () => {
    await reset();
    const sessionId = "rel04-graph-gate";
    await BrainManager.trackSession(sessionId, "Graph gate", testDir);
    await BrainManager.addEntity({
      name: "file",
      entity_type: "concept",
      description: "generic filesystem object",
      confidence: 0.9,
    });
    await BrainManager.addEntity({
      name: "AuthService",
      entity_type: "class",
      description: "handles OAuth login tokens",
      confidence: 0.9,
    });

    const built = await ContextBuilder.buildDetailed({
      message: "fix the login button",
      session_id: sessionId,
      include_graph: true,
      include_procedures: false,
      include_patterns: false,
    });

    const entityTitles = built.items.filter((i) => i.kind === "entity").map((i) => i.title);
    expect(entityTitles).not.toContain("file");
  });
});
