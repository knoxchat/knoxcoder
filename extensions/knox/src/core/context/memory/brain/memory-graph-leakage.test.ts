/**
 * REL-11 — Graph / entity leakage.
 * Common-noun entities (`file`, `config`) must not LIKE-match the world.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GRAPH_COMMON_NOUN_DENYLIST,
  hasGraphExpandableTokens,
  isCommonNounEntityName,
  queryMentionsEntity,
  shouldJoinEntityToMemories,
} from "./GraphRetrieval.js";

const testDir = path.join(os.tmpdir(), `brain-graph-leak-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let KnowledgeGraph: typeof import("./KnowledgeGraph.js").KnowledgeGraph;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let PrefrontalCortex: typeof import("./regions/PrefrontalCortex.js").PrefrontalCortex;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ KnowledgeGraph } = await import("./KnowledgeGraph.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ PrefrontalCortex } = await import("./regions/PrefrontalCortex.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
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

describe("REL-11 graph helpers (pure)", () => {
  it("denylists common nouns and treats them as leaky names", () => {
    for (const name of ["file", "user", "config", "error", "memory", "test", "data"]) {
      expect(GRAPH_COMMON_NOUN_DENYLIST.has(name)).toBe(true);
      expect(isCommonNounEntityName(name)).toBe(true);
    }
    expect(isCommonNounEntityName("AuthService")).toBe(false);
  });

  it("skips graph expansion when the query has no entity-like tokens", () => {
    expect(hasGraphExpandableTokens("continue")).toBe(false);
    expect(hasGraphExpandableTokens("ok now do it")).toBe(false);
    expect(hasGraphExpandableTokens("fix the login button")).toBe(true);
    expect(hasGraphExpandableTokens("wire AuthService")).toBe(true);
  });

  it("does not join denylisted neighbors unless the query names them", () => {
    expect(shouldJoinEntityToMemories("fix the login button", "file")).toBe(false);
    expect(shouldJoinEntityToMemories("update the config file", "file")).toBe(true);
    expect(shouldJoinEntityToMemories("wire AuthService", "AuthService")).toBe(true);
    expect(queryMentionsEntity("fix the login button", "file")).toBe(false);
    expect(queryMentionsEntity("wire AuthService", "AuthService")).toBe(true);
  });
});

describe("REL-11 graph / entity leakage (sqlite)", () => {
  it("query 'fix the login button' does not inject memories that only matched entity 'file'", async () => {
    await reset();
    const sessionId = "rel11-file-leak";
    await BrainManager.trackSession(sessionId, "Graph leak", testDir);

    const fileId = await BrainManager.addEntity({
      name: "file",
      entity_type: "file",
      description: "generic filesystem object used by login forms",
      confidence: 0.99,
    });
    const authId = await BrainManager.addEntity({
      name: "AuthService",
      entity_type: "class",
      description: "handles OAuth login tokens",
      confidence: 0.99,
    });
    await BrainManager.addEdge({
      source_entity_id: authId,
      target_entity_id: fileId,
      relationship: "uses",
      weight: 1,
    });

    const fileMemId = await BrainManager.store({
      category: "fact",
      title: "Filename helper",
      content: "profile filename utilities live in src/fileloader.ts",
      keywords: "file, filename, profile, loader",
      session_id: sessionId,
      importance: 0.99,
    });
    await BrainManager.store({
      category: "code_pattern",
      title: "AuthService OAuth flow",
      content: "AuthService exchanges oauth codes for login tokens.",
      keywords: "AuthService, oauth, login",
      session_id: sessionId,
      importance: 0.9,
    });

    const entities = await KnowledgeGraph.searchEntities("fix the login button", undefined, 20);
    expect(entities.map((e) => e.name)).not.toContain("file");

    const built = await ContextBuilder.buildDetailed({
      message: "fix the login button",
      session_id: sessionId,
      include_graph: true,
      include_procedures: false,
      include_patterns: false,
    });
    const entityTitles = built.items.filter((i) => i.kind === "entity").map((i) => i.title);
    expect(entityTitles).not.toContain("file");
    expect(built.items.some((i) => i.id === fileMemId && i.kind === "semantic")).toBe(false);

    const fusion = await RetrievalFusion.search({
      query: "fix the login button",
      sessionId,
      includeEpisodic: false,
    });
    expect(fusion.some((r) => r.id === fileMemId)).toBe(false);
  });

  it("query mentioning AuthService still expands that entity", async () => {
    await reset();
    const sessionId = "rel11-auth-expand";
    await BrainManager.trackSession(sessionId, "Auth expand", testDir);

    await BrainManager.addEntity({
      name: "file",
      entity_type: "file",
      description: "generic filesystem object",
      confidence: 0.99,
    });
    await BrainManager.addEntity({
      name: "AuthService",
      entity_type: "class",
      description: "handles OAuth login tokens",
      confidence: 0.99,
    });
    await BrainManager.store({
      category: "code_pattern",
      title: "AuthService OAuth flow",
      content: "AuthService exchanges oauth codes for login tokens.",
      keywords: "AuthService, oauth, login",
      session_id: sessionId,
      importance: 0.95,
    });

    const entities = await KnowledgeGraph.searchEntities("wire AuthService tokens", undefined, 20);
    expect(entities.map((e) => e.name)).toContain("AuthService");
    expect(entities.map((e) => e.name)).not.toContain("file");

    const built = await ContextBuilder.buildDetailed({
      message: "how does AuthService issue tokens?",
      session_id: sessionId,
      include_graph: true,
      include_procedures: false,
      include_patterns: false,
    });
    const entityTitles = built.items.filter((i) => i.kind === "entity").map((i) => i.title);
    expect(entityTitles).toContain("AuthService");
    expect(entityTitles).not.toContain("file");

    const result = await MemoryPipeline.runPreTurn({
      message: "how does AuthService issue tokens?",
      session_id: sessionId,
      goal: "how does AuthService issue tokens?",
    });
    const titles = (result.context?.items ?? []).map((i) => i.title);
    expect(titles).toContain("AuthService OAuth flow");
    expect(titles).not.toContain("Filename helper");
  });
});
