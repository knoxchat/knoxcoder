/**
 * MEM-16 — stop strengthening on mere retrieval / inject.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-inject-no-s-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
let memoryImpl: typeof import("../../../tools/implementations/memory.js").memoryImpl;

const AGED = "2020-01-15T12:00:00.000Z";
const TOKEN = "quartzmem16injectleaf";

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  ({ memoryImpl } = await import("../../../tools/implementations/memory.js"));

  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "global");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_sessions");
}

async function semanticState(id: number): Promise<{
  stability: number;
  difficulty: number;
  importance_score: number;
  retrieval_count: number;
  inject_count: number;
  last_accessed_at: string;
}> {
  const db = await BrainStore.get();
  const row = await db.get<{
    stability: number;
    difficulty: number;
    importance_score: number;
    retrieval_count: number;
    inject_count: number;
    last_accessed_at: string;
  }>(
    "SELECT stability, difficulty, importance_score, retrieval_count, inject_count, last_accessed_at FROM brain_semantic WHERE id = ?",
    [id],
  );
  if (!row) throw new Error(`missing semantic ${id}`);
  return row;
}

async function storeFact(sessionId: string): Promise<number> {
  await BrainManager.trackSession(sessionId, "MEM-16 inject", testDir);
  const id = await BrainManager.store({
    category: "fact",
    title: `Login ${TOKEN} oauth jwt refresh`,
    content: `The ${TOKEN} oauth-jwt-refresh service stores login facts for the session module.`,
    keywords: `${TOKEN}, oauth, jwt, refresh, login`,
    importance: 0.99,
    session_id: sessionId,
  });
  const db = await BrainStore.get();
  await db.run("UPDATE brain_semantic SET last_accessed_at = ? WHERE id = ?", [AGED, id]);
  return id;
}

const extras = { ide: {} as never, llm: undefined } as never;

describe("MEM-16 retrieve / inject do not strengthen", () => {
  it("injecting the same fact 100 times does not raise S, I, or retrieval_count", async () => {
    await reset();
    const id = await storeFact("mem16-hundred");
    const before = await semanticState(id);
    expect(before.stability).toBe(14);
    expect(before.difficulty).toBe(5);
    expect(before.retrieval_count).toBe(0);
    expect(before.inject_count).toBe(0);

    const query = `${TOKEN} oauth jwt refresh login`;
    for (let i = 0; i < 100; i++) {
      const built = await ContextBuilder.buildDetailed({
        message: query,
        session_id: "mem16-hundred",
      });
      expect(built.items.some((item) => item.id === id)).toBe(true);
    }

    const after = await semanticState(id);
    expect(after.stability).toBe(14);
    expect(after.difficulty).toBe(5);
    expect(after.importance_score).toBeCloseTo(0.99, 5);
    expect(after.retrieval_count).toBe(0);
    expect(after.last_accessed_at).toBe(AGED);
    expect(after.inject_count).toBeGreaterThanOrEqual(100);
  });

  it("fusion retrieve below θ still does not write S or retrieval_count", async () => {
    await reset();
    const id = await storeFact("mem16-fusion");
    for (let i = 0; i < 20; i++) {
      await RetrievalFusion.search({
        query: TOKEN,
        includeEpisodic: false,
        limit: 10,
      });
    }
    const after = await semanticState(id);
    expect(after.stability).toBe(14);
    expect(after.retrieval_count).toBe(0);
    expect(after.last_accessed_at).toBe(AGED);
    expect(after.importance_score).toBeCloseTo(0.99, 5);
  });

  it("builtin_memory recall and build_context do not call leftover boost or raise S", async () => {
    await reset();
    const id = await storeFact("mem16-builtin");

    const recalled = await memoryImpl(
      {
        action: "recall",
        query: `${TOKEN} oauth jwt refresh login`,
        include_episodic: false,
        session_id: "mem16-builtin",
      },
      extras,
    );
    expect(recalled[0]?.content).toMatch(new RegExp(TOKEN, "i"));

    const built = await memoryImpl(
      {
        action: "build_context",
        query: `${TOKEN} oauth jwt refresh login`,
        session_id: "mem16-builtin",
      },
      extras,
    );
    expect(built[0]?.content).toMatch(new RegExp(TOKEN, "i"));

    const row = await semanticState(id);
    expect(row.stability).toBe(14);
    expect(row.difficulty).toBe(5);
    expect(row.importance_score).toBeCloseTo(0.99, 5);
    expect(row.retrieval_count).toBe(0);
    expect(row.last_accessed_at).toBe(AGED);
    expect(row.inject_count).toBeGreaterThanOrEqual(1);
  });

  it("ContextBuilder inject and backlog search leave S and retrieval_count alone", async () => {
    await reset();
    const id = await storeFact("mem16-context");

    for (let i = 0; i < 20; i++) {
      const built = await ContextBuilder.buildDetailed({
        message: `${TOKEN} oauth jwt refresh login`,
        session_id: "mem16-context",
      });
      expect(built.items.some((item) => item.id === id)).toBe(true);
    }

    const afterInject = await semanticState(id);
    expect(afterInject.stability).toBe(14);
    expect(afterInject.retrieval_count).toBe(0);
    expect(afterInject.last_accessed_at).toBe(AGED);
    expect(afterInject.inject_count).toBeGreaterThanOrEqual(1);

    await BrainManager.searchBacklogs({
      query: `${TOKEN} oauth jwt refresh login`,
      include_semantic: true,
      include_episodic: false,
      limit: 10,
    });
    const afterSearch = await semanticState(id);
    expect(afterSearch.stability).toBe(14);
    expect(afterSearch.retrieval_count).toBe(0);
    expect(afterSearch.last_accessed_at).toBe(AGED);
    expect(afterSearch.inject_count).toBe(afterInject.inject_count);
  });
});
