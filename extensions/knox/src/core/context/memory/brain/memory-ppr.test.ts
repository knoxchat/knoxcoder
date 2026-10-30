/**
 * MEM-25 — hub-damped PPR graph channel over stored rows.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rrfScore } from "./RetrievalFusion.js";

const testDir = path.join(os.tmpdir(), `brain-mem25-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let KnowledgeGraph: typeof import("./KnowledgeGraph.js").KnowledgeGraph;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

describe("MEM-25 graph channel", () => {
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
    await BrainStore.saveConfig("ppr_alpha", "0.15");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_graph_edges");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_sessions");
  }

  it("S_graph is max π and ranks the 1-hop neighbor above the 2-hop leaf", async () => {
    await reset();
    const sessionId = "mem25-ppr";
    await BrainManager.trackSession(sessionId, "MEM-25 PPR", testDir);

    const seed = await KnowledgeGraph.addEntity({
      name: "Mem25PprSeedAuth",
      entity_type: "technology",
      description: "Seed",
    });
    const mid = await KnowledgeGraph.addEntity({
      name: "Mem25PprMidReact",
      entity_type: "technology",
      description: "One hop",
    });
    const leaf = await KnowledgeGraph.addEntity({
      name: "Mem25PprLeafVue",
      entity_type: "technology",
      description: "Two hops",
    });
    await KnowledgeGraph.addEdge({
      source_entity_id: seed,
      target_entity_id: mid,
      relationship: "related_to",
      weight: 1,
    });
    await KnowledgeGraph.addEdge({
      source_entity_id: mid,
      target_entity_id: leaf,
      relationship: "related_to",
      weight: 1,
    });

    const midId = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem25PprMidReact wiring",
      content: "Use Mem25PprMidReact next to Mem25PprSeedAuth in the graph channel fixture.",
      keywords: "Mem25PprMidReact, Mem25PprSeedAuth",
      session_id: sessionId,
    });
    const leafId = await BrainStore.storeSemantic({
      category: "fact",
      title: "Mem25PprLeafVue note",
      content: "Mem25PprLeafVue sits two hops from Mem25PprSeedAuth.",
      keywords: "Mem25PprLeafVue, Mem25PprSeedAuth",
      session_id: sessionId,
    });

    const graph = await KnowledgeGraph.searchMemoriesByPpr("Mem25PprSeedAuth");
    expect(graph.get(midId) ?? 0).toBeGreaterThan(0);
    expect(graph.get(leafId) ?? 0).toBeGreaterThan(0);
    expect(graph.get(midId)!).toBeGreaterThan(graph.get(leafId)!);

    const hits = await RetrievalFusion.search({
      query: "Mem25PprSeedAuth",
      includeEpisodic: false,
      sessionId,
    });
    const midHit = hits.find((h) => h.id === midId);
    const leafHit = hits.find((h) => h.id === leafId);
    expect(midHit?.ranks?.graph).toBeGreaterThanOrEqual(1);
    expect(leafHit?.ranks?.graph).toBeGreaterThanOrEqual(1);
    expect(midHit!.scores.graph).toBeGreaterThan(leafHit!.scores.graph);
    expect(midHit!.rel).toBeCloseTo(rrfScore(midHit!.ranks ?? {}), 5);
  });
});
