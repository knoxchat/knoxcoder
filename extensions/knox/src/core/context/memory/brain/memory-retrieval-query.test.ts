/**
 * REL-01 — Query hygiene and follow-up expansion.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFts5Query,
  contentWords,
  detectIntent,
  expandRetrievalQuery,
  pickLastSubstantialTurn,
} from "./RetrievalQuery.js";

describe("REL-01 RetrievalQuery (pure)", () => {
  it("strips stopwords including continuation filler", () => {
    expect(contentWords("ok now do it")).toEqual([]);
    expect(contentWords("now update the README")).toEqual(["update", "readme"]);
    expect(contentWords("continue")).toEqual([]);
    expect(contentWords("We decided to use JWT refresh tokens")).toEqual([
      "decided",
      "use",
      "jwt",
      "refresh",
      "tokens",
    ]);
  });

  it("detects continuation vs new task", () => {
    expect(detectIntent("continue")).toBe("continuation");
    expect(detectIntent("ok")).toBe("continuation");
    expect(detectIntent("yes please")).toBe("continuation");
    expect(detectIntent("keep going")).toBe("continuation");
    expect(detectIntent("now update the README")).toBe("new_task");
    expect(detectIntent("ok, now fix the README")).toBe("new_task");
    expect(detectIntent("Implement OAuth login")).toBe("new_task");
    expect(detectIntent("new question: how do I style the button?")).toBe("new_task");
    expect(detectIntent("new question: continue")).toBe("new_task");
    expect(
      detectIntent("also add jwt rotation", "auth, jwt, oauth, login", 0.15),
    ).toBe("continuation");
  });

  it("does not put now* in the FTS query for README follow-ups", () => {
    const expanded = expandRetrievalQuery({ message: "now update the README" });
    expect(expanded.intent).toBe("new_task");
    expect(expanded.retrievalQuery).toBe("update readme");
    expect(expanded.fts5Query).toBeTruthy();
    expect(expanded.fts5Query).not.toMatch(/\bnow\*/i);
    expect(expanded.fts5Query).toMatch(/update\*/);
    expect(expanded.fts5Query).toMatch(/readme\*/);
    expect(expanded.fts5Query).toContain("AND");
  });

  it("ANDs content words and never ORs stopwords", () => {
    const fts = buildFts5Query("ok now update the README please");
    expect(fts).toBe("update* AND readme*");
    expect(fts).not.toContain("ok");
    expect(fts).not.toContain("now");
    expect(fts).not.toContain("please");
  });

  it("quotes hyphenated FTS terms (valid MATCH syntax)", () => {
    const fts = buildFts5Query("build-cache invalidation");
    expect(fts).toContain('"build-cache"');
    expect(fts).toContain("invalidation*");
    expect(fts).toContain("AND");
  });

  it("expands continuation with topic + last substantial turn", () => {
    const expanded = expandRetrievalQuery({
      message: "continue",
      topicKeywords: "auth, jwt, oauth",
      lastSubstantialTurn: "How should we implement JWT refresh tokens?",
    });
    expect(expanded.intent).toBe("continuation");
    expect(expanded.contentWords).toEqual(
      expect.arrayContaining(["auth", "jwt", "oauth", "refresh", "tokens"]),
    );
    expect(expanded.retrievalQuery).not.toMatch(/\bcontinue\b/);
    expect(expanded.fts5Query).not.toMatch(/\bcontinue\*/);
    expect(expanded.fts5Query).not.toContain("AND");
  });

  it("does not mix last turn into a new-task query", () => {
    const expanded = expandRetrievalQuery({
      message: "now update the README badges",
      topicKeywords: "auth, jwt, oauth",
      lastSubstantialTurn: "How should we implement JWT refresh tokens?",
    });
    expect(expanded.intent).toBe("new_task");
    expect(expanded.contentWords).toEqual(["update", "readme", "badges"]);
    expect(expanded.retrievalQuery).not.toContain("jwt");
    expect(expanded.retrievalQuery).not.toContain("oauth");
  });

  it("picks last substantial turn and skips pure continuations", () => {
    const picked = pickLastSubstantialTurn(
      ["continue", "ok", "How should we implement JWT refresh tokens?", "hi"],
      "continue",
    );
    expect(picked).toContain("JWT refresh");
  });

  it("ORs synonym extras outside the AND clause", () => {
    const fts = buildFts5Query("auth jwt", {
      useAnd: true,
      extraOrTerms: ["login", "signin"],
    });
    expect(fts).toMatch(/^\(auth\* AND jwt\*\) OR login\* OR signin\*$/);
  });
});

describe("REL-01 pipeline wiring", () => {
  const testDir = path.join(os.tmpdir(), `brain-rel01-${Date.now()}`);
  let BrainManager: typeof import("./BrainManager.js").BrainManager;
  let BrainStore: typeof import("./BrainStore.js").BrainStore;
  let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "project");
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
  }

  it("continue after an auth turn retrieves auth, not README", async () => {
    await reset();
    const sessionId = "rel01-continue-auth";
    await BrainManager.trackSession(sessionId, "REL-01 Auth", testDir);
    await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth, login, refresh",
      0,
      2,
      0.9,
    );
    await BrainManager.store({
      category: "decision",
      title: "Use JWT refresh with OAuth",
      content: "oauth-jwt-refresh-token-alpha is the auth approach.",
      keywords: "auth, jwt, oauth, refresh",
      session_id: sessionId,
      importance: 0.85,
    });
    await BrainManager.store({
      category: "fact",
      title: "README badge layout",
      content: "readme-badges-shields-beta belong in the docs header.",
      keywords: "readme, badges, shields, docs",
      session_id: sessionId,
      importance: 0.85,
    });
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

    const ctx = result.context?.context ?? "";
    expect(ctx).toContain("oauth-jwt-refresh-token-alpha");
    expect(ctx).not.toContain("readme-badges-shields-beta");
  });

  it("now update the README does not search now* and keeps C_goal as the user ask", async () => {
    await reset();
    const sessionId = "rel01-readme-switch";
    await BrainManager.trackSession(sessionId, "REL-01 README", testDir);
    await BrainStore.addSessionTopic(
      sessionId,
      "Authentication",
      "auth, jwt, oauth",
      0,
      1,
      0.9,
    );
    await BrainManager.store({
      category: "decision",
      title: "Use JWT refresh with OAuth",
      content: "oauth-jwt-refresh-token-alpha is the auth approach.",
      keywords: "auth, jwt, oauth",
      session_id: sessionId,
      importance: 0.9,
    });
    await BrainManager.store({
      category: "fact",
      title: "README badge layout",
      content: "readme-badges-shields-beta belong in the docs header.",
      keywords: "readme, badges, update",
      session_id: sessionId,
      importance: 0.7,
    });
    await BrainManager.recordMessage(
      sessionId,
      "user",
      "How should we implement JWT refresh tokens with OAuth?",
      { importance: 0.8 },
    );

    const userAsk = "now update the README badges";
    const result = await MemoryPipeline.runPreTurn({
      message: userAsk,
      session_id: sessionId,
      goal: userAsk,
    });

    const ctx = result.context?.context ?? "";
    expect(ctx).toContain("=== Current Task ===");
    expect(ctx).toContain(userAsk);
    expect(ctx).toContain("readme-badges-shields-beta");
    expect(ctx).not.toContain("oauth-jwt-refresh-token-alpha");

    const goalItem = result.context?.items.find((i) => i.kind === "goal");
    expect(goalItem?.title).toMatch(/Current task/);
  });
});

