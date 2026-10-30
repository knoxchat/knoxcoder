/**
 * MEM-23 — ripgrep channel search wiring.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveRipgrepBinary } from "../../../tools/ripgrep.js";
import { rrfScore } from "./RetrievalFusion.js";

const testDir = path.join(os.tmpdir(), `brain-mem23-${Date.now()}`);
const workspaceDir = path.join(testDir, "workspace");
const rg = resolveRipgrepBinary();

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let calculateAddressableMemory: typeof import("./MemoryHierarchy.js").calculateAddressableMemory;

describe.skipIf(!rg)("MEM-23 ripgrep search wiring", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "src", "auth.ts"),
      "export function knoxRgFileTokenAlpha() { return true; }\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspaceDir, "secret.txt"),
      "knoxRgIgnoredTokenOmega should stay ignored\n",
      "utf8",
    );
    fs.writeFileSync(path.join(workspaceDir, ".knoxignore"), "secret.txt\n", "utf8");
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
    ({ calculateAddressableMemory } = await import("./MemoryHierarchy.js"));
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
    await db.exec("DELETE FROM brain_collection_items");
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_associations");
    await db.exec("DELETE FROM brain_graph_edges");
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_sessions");
    await BrainStore.reloadConfig();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  }

  it("ranks a corpus identifier hit on the ripgrep channel", async () => {
    await reset();
    const sessionId = "mem23-corpus";
    const token = "knoxRgCorpusTokenAlpha";
    await BrainManager.trackSession(sessionId, "MEM-23 corpus", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: `Leaf ${token}`,
      content: `Stored text mentions ${token} exactly once.`,
      keywords: token,
      session_id: sessionId,
      importance: 0.4,
    });

    const before = await calculateAddressableMemory();
    const hits = await RetrievalFusion.search({
      query: token,
      includeEpisodic: false,
      sessionId,
    });
    const after = await calculateAddressableMemory();
    const hit = hits.find((h) => h.id === id);
    expect(hit).toBeTruthy();
    expect(hit!.ranks?.ripgrep).toBe(1);
    expect(hit!.scores.ripgrep).toBeGreaterThan(0);
    expect(hit!.rel).toBeCloseTo(rrfScore(hit!.ranks ?? {}), 5);
    expect(after.c_addr).toBe(before.c_addr);
  });

  it("maps a project-file hit to a memory about that path", async () => {
    await reset();
    await BrainStore.saveConfig("memory_scope", "project");
    const sessionId = "mem23-file";
    await BrainManager.trackSession(sessionId, "MEM-23 files", workspaceDir);
    await BrainManager.addEntity({
      name: "src/auth.ts",
      entity_type: "file",
      description: "Auth module",
      confidence: 0.9,
    });
    const id = await BrainManager.store({
      category: "decision",
      title: "JWT lives in src/auth.ts",
      content: "We changed src/auth.ts last week for session tokens.",
      keywords: "src/auth.ts, jwt",
      session_id: sessionId,
      importance: 0.5,
    });

    const hits = await RetrievalFusion.search({
      query: "knoxRgFileTokenAlpha",
      includeEpisodic: false,
      sessionId,
      workspaceDir,
    });
    const hit = hits.find((h) => h.id === id);
    expect(hit).toBeTruthy();
    expect(hit!.ranks?.ripgrep).toBeGreaterThanOrEqual(1);
    expect(hit!.channel === "ripgrep" || (hit!.ranks?.ripgrep ?? 0) >= 1).toBe(true);
  });

  it("does not map hits from .knoxignore'd files", async () => {
    await reset();
    await BrainStore.saveConfig("memory_scope", "project");
    const sessionId = "mem23-ignore";
    await BrainManager.trackSession(sessionId, "MEM-23 ignore", workspaceDir);
    await BrainManager.addEntity({
      name: "secret.txt",
      entity_type: "file",
      description: "Ignored secret",
      confidence: 0.9,
    });
    const id = await BrainManager.store({
      category: "fact",
      title: "Do not leak secret.txt",
      content: "secret.txt holds ignored notes.",
      keywords: "secret.txt",
      session_id: sessionId,
      importance: 0.99,
    });

    const hits = await RetrievalFusion.search({
      query: "knoxRgIgnoredTokenOmega",
      includeEpisodic: false,
      sessionId,
      workspaceDir,
      minScore: 0.35,
    });
    expect(hits.some((h) => h.id === id)).toBe(false);
  });

  it("still drops a disjoint high-importance memory (REL-03)", async () => {
    await reset();
    const sessionId = "mem23-miss";
    await BrainManager.trackSession(sessionId, "MEM-23 miss", testDir);
    const id = await BrainManager.store({
      category: "decision",
      title: "Use JWT refresh with OAuth",
      content: "oauth-jwt-refresh-token-omega is the auth approach.",
      keywords: "auth, jwt, oauth, refresh",
      session_id: sessionId,
      importance: 0.99,
    });
    const hits = await RetrievalFusion.search({
      query: "readme-badges-shields-zeta unique docs header",
      includeEpisodic: false,
      minScore: 0.35,
    });
    expect(hits.some((h) => h.id === id)).toBe(false);
  });
});
