/**
 * MEM-26 — entity resolution + validity intervals in Ω(q).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem26-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let KnowledgeGraph: typeof import("./KnowledgeGraph.js").KnowledgeGraph;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

describe("MEM-26 entity resolution + validity", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ KnowledgeGraph } = await import("./KnowledgeGraph.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
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
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_memory_supersessions");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_graph_edges");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_sessions");
  }

  it("merges TS and TypeScript onto one canonical entity", async () => {
    await reset();
    const tsId = await KnowledgeGraph.addEntity({
      name: "TS",
      entity_type: "technology",
      description: "Short alias",
    });
    const fullId = await KnowledgeGraph.addEntity({
      name: "TypeScript",
      entity_type: "technology",
      description: "Preferred name",
    });
    expect(fullId).toBe(tsId);

    const canonical = await BrainStore.getEntity(fullId);
    expect(canonical?.name).toBe("TypeScript");
    expect(canonical?.canonical_id ?? null).toBeNull();

    const alias = await BrainStore.findEntity("ts", "technology");
    expect(alias).not.toBeNull();
    expect(alias!.canonical_id).toBe(fullId);
    expect(await BrainStore.resolveCanonicalId(alias!.id)).toBe(fullId);

    const cap = await KnowledgeGraph.getCapStatus();
    expect(cap.channel_size).toBe(1);
    expect(cap.entity_count).toBe(1);
    expect(await BrainStore.countEntities()).toBe(2);
  });

  it("query TS seeds the TypeScript node and ranks its memories", async () => {
    await reset();
    const sessionId = "mem26-alias";
    await BrainManager.trackSession(sessionId, "MEM-26 alias", testDir);

    const tsId = await KnowledgeGraph.addEntity({
      name: "TypeScript",
      entity_type: "technology",
      description: "Language",
    });
    const midId = await KnowledgeGraph.addEntity({
      name: "Mem26PprMidReact",
      entity_type: "technology",
      description: "One hop",
    });
    await KnowledgeGraph.addEdge({
      source_entity_id: tsId,
      target_entity_id: midId,
      relationship: "related_to",
      weight: 1,
    });

    const memoryId = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem26PprMidReact wiring",
      content: "Use Mem26PprMidReact next to TypeScript in the graph channel fixture.",
      keywords: "Mem26PprMidReact, TypeScript",
      session_id: sessionId,
    });

    const graph = await KnowledgeGraph.searchMemoriesByPpr("TS");
    expect(graph.get(memoryId) ?? 0).toBeGreaterThan(0);

    const hits = await RetrievalFusion.search({
      query: "TS",
      includeEpisodic: false,
      sessionId,
    });
    expect(hits.some((hit) => hit.id === memoryId && (hit.ranks?.graph ?? 0) >= 1)).toBe(true);
  });

  it("excludes a closed validity interval from Ω(q) but keeps the row queryable", async () => {
    await reset();
    const sessionId = "mem26-valid";
    await BrainManager.trackSession(sessionId, "MEM-26 validity", testDir);

    const liveId = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem26LiveQuartz fact",
      content: "Mem26LiveQuartz is the current formatter.",
      keywords: "Mem26LiveQuartz",
      session_id: sessionId,
    });
    const closedId = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem26ClosedQuartz fact",
      content: "Mem26ClosedQuartz was the old formatter.",
      keywords: "Mem26ClosedQuartz",
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run(
      "UPDATE brain_semantic SET valid_to = datetime('now', '-1 day') WHERE id = ?",
      [closedId],
    );

    const hits = await RetrievalFusion.search({
      query: "Mem26ClosedQuartz Mem26LiveQuartz",
      includeEpisodic: false,
      sessionId,
    });
    const ids = hits.filter((hit) => hit.type === "semantic").map((hit) => hit.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(closedId);

    const row = await BrainStore.getSemanticById(closedId);
    expect(row).not.toBeNull();
    expect(row!.content).toContain("old formatter");
  });

  it("supersede closes valid_to and drops the old fact from recall", async () => {
    await reset();
    const sessionId = "mem26-super";
    await BrainManager.trackSession(sessionId, "MEM-26 supersede", testDir);
    const store = (content: string) =>
      BrainManager.store({
        category: "decision",
        title: "mem26quartz indentation style",
        content,
        keywords: "mem26quartz indentation",
        session_id: sessionId,
        importance: 0.8,
      });
    const oldId = await store("mem26quartz indentation uses tabs everywhere");
    const newId = await store("mem26quartz indentation uses spaces everywhere");
    expect(newId).not.toBe(oldId);

    const db = await BrainStore.get();
    const sup = await db.get<{ new_id: number; valid_to: string | null }>(
      `SELECT s.new_id AS new_id, o.valid_to AS valid_to
       FROM brain_memory_supersessions s
       JOIN brain_semantic o ON o.id = s.old_id
       WHERE s.old_id = ?`,
      [oldId],
    );
    expect(sup?.new_id).toBe(newId);
    expect(sup?.valid_to).toBeTruthy();

    const hits = await RetrievalFusion.search({
      query: "mem26quartz indentation",
      sessionId,
      limit: 5,
      minScore: 0.01,
    });
    const ids = hits.filter((hit) => hit.type === "semantic").map((hit) => hit.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
    expect(await BrainStore.getSemanticById(oldId)).not.toBeNull();
  });

  it("does not walk an expired edge in PPR", async () => {
    await reset();
    const sessionId = "mem26-edge";
    await BrainManager.trackSession(sessionId, "MEM-26 edge", testDir);

    const seed = await KnowledgeGraph.addEntity({
      name: "Mem26EdgeSeedAuth",
      entity_type: "technology",
    });
    const mid = await KnowledgeGraph.addEntity({
      name: "Mem26EdgeMidReact",
      entity_type: "technology",
    });
    const edgeId = await KnowledgeGraph.addEdge({
      source_entity_id: seed,
      target_entity_id: mid,
      relationship: "related_to",
      weight: 1,
    });
    const db = await BrainStore.get();
    await db.run(
      "UPDATE brain_graph_edges SET valid_to = datetime('now', '-1 day') WHERE id = ?",
      [edgeId],
    );

    const memoryId = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem26EdgeMidReact note",
      content: "Mem26EdgeMidReact is only reachable through a graph neighbor.",
      keywords: "Mem26EdgeMidReact",
      session_id: sessionId,
    });

    const graph = await KnowledgeGraph.searchMemoriesByPpr("Mem26EdgeSeedAuth");
    expect(graph.get(memoryId) ?? 0).toBe(0);
  });

  it("keeps a legacy NULL-validity fact in Ω(q)", async () => {
    await reset();
    const sessionId = "mem26-legacy";
    await BrainManager.trackSession(sessionId, "MEM-26 legacy", testDir);
    const id = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem26LegacyNullQuartz",
      content: "Mem26LegacyNullQuartz has no validity bounds.",
      keywords: "Mem26LegacyNullQuartz",
      session_id: sessionId,
    });
    const db = await BrainStore.get();
    await db.run("UPDATE brain_semantic SET valid_from = NULL, valid_to = NULL WHERE id = ?", [id]);

    const hits = await RetrievalFusion.search({
      query: "Mem26LegacyNullQuartz",
      includeEpisodic: false,
      sessionId,
    });
    expect(hits.some((hit) => hit.id === id)).toBe(true);
  });
});
