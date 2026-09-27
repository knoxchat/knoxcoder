/**
 * REL-05 — Topic as a retrieval dimension.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyTopicBias,
  TOPIC_OTHER_PENALTY,
  TOPIC_SAME_BOOST,
  type FusionResult,
} from "./RetrievalFusion.js";
import type { SemanticMemory } from "./types.js";

const testDir = path.join(os.tmpdir(), `brain-topic-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let AutoMemory: typeof import("./AutoMemory.js").AutoMemory;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ AutoMemory } = await import("./AutoMemory.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
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
  AutoMemory.resetTopicTracking();
  (BrainManager as any).workingMem = null;
  (BrainManager as any).workingMemSessionId = null;
  (BrainManager as any).activeSessionId = null;
}

function stubHit(
  id: number,
  score: number,
  topicId: number | null,
  sessionId: string,
): FusionResult {
  return {
    id,
    type: "semantic",
    score,
    scores: { fts5: 0.5, trigram: 0.2, graph: 0, recency: 0.5, importance: 0.5 },
    data: {
      id,
      topic_id: topicId,
      source_session_id: sessionId,
    } as SemanticMemory,
  };
}

describe("REL-05 applyTopicBias (pure)", () => {
  it("ranks the current topic above another topic in the same session given equal scores", () => {
    const sessionId = "s1";
    const ranked = applyTopicBias(
      [stubHit(1, 0.7, 10, sessionId), stubHit(2, 0.7, 20, sessionId)],
      { currentTopicId: 20, sessionId },
    );
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].score).toBeCloseTo(0.7 + TOPIC_SAME_BOOST);
    expect(ranked[1].id).toBe(1);
    expect(ranked[1].score).toBeCloseTo(0.7 - TOPIC_OTHER_PENALTY);
    expect(ranked[1].score).toBeGreaterThan(0);
  });

  it("does not drop other-topic candidates", () => {
    const ranked = applyTopicBias(
      [stubHit(1, 0.05, 10, "s1")],
      { currentTopicId: 20, sessionId: "s1" },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(0);
  });
});

describe("REL-05 topic tagging and retrieval", () => {
  it("new semantic rows from a session with a topic have topic_id set", async () => {
    await reset();
    const sessionId = "rel05-tag";
    await BrainManager.trackSession(sessionId, "Topic tag", testDir);
    const topicId = await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth",
      0,
      2,
      0.9,
    );

    const memId = await BrainManager.store({
      category: "decision",
      title: "Use JWT refresh with OAuth",
      content: "oauth-jwt-refresh-token-alpha is the auth approach.",
      keywords: "auth, jwt, oauth, refresh",
      session_id: sessionId,
      importance: 0.9,
    });

    const row = await BrainStore.getSemanticById(memId);
    expect(row?.topic_id).toBe(topicId);
  });

  it("extract attaches the current topic_id", async () => {
    await reset();
    const sessionId = "rel05-extract";
    await BrainManager.trackSession(sessionId, "Extract tag", testDir);
    const topicId = await BrainStore.addSessionTopic(
      sessionId,
      "Storage",
      "sqlite, brain, storage",
      0,
      1,
      0.8,
    );

    const result = await AutoMemory.extract(
      "I decided to use SQLite for the brain storage layer going forward.",
      "user",
      sessionId,
    );
    expect(result.semantic_count).toBeGreaterThan(0);

    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT topic_id FROM brain_semantic WHERE source_session_id = ?",
      [sessionId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.topic_id === topicId)).toBe(true);
  });

  it("after a shift, Task B ranks above Task A given equal lexical overlap", async () => {
    await reset();
    const sessionId = "rel05-rank";
    await BrainManager.trackSession(sessionId, "Topic rank", testDir);

    const topicA = await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth",
      0,
      2,
      0.9,
    );
    const memA = await BrainManager.store({
      category: "fact",
      title: "quasarhandbook token for oauth",
      content: "quasarhandbook appears in the oauth jwt handbook.",
      keywords: "quasarhandbook, oauth, jwt",
      session_id: sessionId,
      topic_id: topicA,
      importance: 0.9,
    });

    const topicB = await BrainStore.addSessionTopic(
      sessionId,
      "README",
      "readme, badges, docs",
      3,
      5,
      0.9,
    );
    const memB = await BrainManager.store({
      category: "fact",
      title: "quasarhandbook token for readme",
      content: "quasarhandbook appears in the readme badges handbook.",
      keywords: "quasarhandbook, readme, badges",
      session_id: sessionId,
      topic_id: topicB,
      importance: 0.9,
    });

    const hits = await RetrievalFusion.search({
      query: "quasarhandbook",
      sessionId,
      currentTopicId: topicB,
      limit: 10,
      includeEpisodic: false,
    });

    const ids = hits.map((h) => h.id);
    expect(ids).toContain(memA);
    expect(ids).toContain(memB);
    expect(ids.indexOf(memB)).toBeLessThan(ids.indexOf(memA));
    const scoreB = hits.find((h) => h.id === memB)!.score;
    const scoreA = hits.find((h) => h.id === memA)!.score;
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it("session history still returns browseable topics", async () => {
    await reset();
    const sessionId = "rel05-history";
    await BrainManager.trackSession(sessionId, "History topics", testDir);
    await BrainStore.addSessionTopic(sessionId, "Auth", "oauth, jwt", 0, 2, 0.8);
    await BrainStore.addSessionTopic(sessionId, "Docs", "readme, badges", 3, 5, 0.8);

    const history = await BrainManager.getSessionHistoryFull(sessionId);
    expect(history.topics.map((t) => t.topic)).toEqual(["Auth", "Docs"]);
  });

  it("cheap per-turn shift opens a new topic on disjoint content words", async () => {
    await reset();
    const sessionId = "rel05-cheap-shift";
    await BrainManager.trackSession(sessionId, "Cheap shift", testDir);
    await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth, refresh",
      0,
      2,
      0.9,
    );

    const related = await AutoMemory.detectTopicShift(
      sessionId,
      "user",
      "How should we implement JWT refresh tokens with OAuth?",
      3,
    );
    expect(related).toBeNull();

    const shifted = await AutoMemory.detectTopicShift(
      sessionId,
      "user",
      "now update the README badges for the documentation site",
      4,
    );
    expect(shifted).toBeTruthy();
    expect(shifted!.topic.toLowerCase()).toMatch(/readme|badge|documentation/);

    const topics = await BrainStore.getSessionTopics(sessionId);
    expect(topics.length).toBeGreaterThanOrEqual(2);
  });

  it("skips a Task A session summary on a disjoint Task B query", async () => {
    await reset();
    const sessionId = "rel05-summary";
    await BrainManager.trackSession(sessionId, "Summary gate", testDir);
    await BrainStore.addSessionTopic(
      sessionId,
      "README",
      "readme, badges, docs",
      3,
      5,
      0.9,
    );
    await BrainStore.updateSession(sessionId, {
      summary: "We settled on oauth jwt refresh tokens for the auth service.",
    });

    const built = await ContextBuilder.buildDetailed({
      message: "update the README badges",
      session_id: sessionId,
    });
    expect(built.context).not.toContain("Current Session Context");
    expect(built.items.some((i) => i.title === "Current session summary")).toBe(false);
  });

  it("full mode still injects a session summary without query overlap (REL-10)", async () => {
    await reset();
    const sessionId = "rel10-summary-full";
    await BrainManager.trackSession(sessionId, "Summary full", testDir);
    await BrainStore.updateSession(sessionId, {
      summary: "We settled on oauth jwt refresh tokens for the auth service.",
    });

    const built = await ContextBuilder.buildDetailed({
      message: "update the README badges",
      session_id: sessionId,
      memory_mode: "full",
    });
    expect(built.context).toContain("Current Session Context");
    expect(built.items.some((i) => i.title === "Current session summary")).toBe(true);
  });

  it("TOPIC_WINDOW_SIZE is 4", () => {
    expect(AutoMemory.TOPIC_WINDOW_SIZE).toBe(4);
  });
});
