/**
 * MEM-08 — M₁ / M₂ / graph stay gauges (or a channel), not C_addr storage.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem08-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let KnowledgeGraph: typeof import("./KnowledgeGraph.js").KnowledgeGraph;
let SensoryBuffer: typeof import("./SensoryBuffer.js").SensoryBuffer;
let calculateAddressableMemory: typeof import("./MemoryHierarchy.js").calculateAddressableMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ KnowledgeGraph } = await import("./KnowledgeGraph.js"));
  ({ SensoryBuffer } = await import("./SensoryBuffer.js"));
  ({ calculateAddressableMemory } = await import("./MemoryHierarchy.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_entities");
  await db.exec("DELETE FROM brain_procedures");
  try {
    await db.exec("DELETE FROM brain_recipes");
  } catch {
    // Recipe table may be absent on a stripped fixture.
  }
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  SensoryBuffer.clear("mem08-session");
  BrainManager.getWorkingMemory().clear();
}

describe("MEM-08 buffer and channel gauges", () => {
  it("M1/M2 are buffer gauges and graph is a channel, none of them enter C_addr", async () => {
    await reset();
    await BrainManager.trackSession("mem08-session", "Gauges", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Stored leaf",
      content: "Addressable knowledge that belongs in C_addr as M4.",
      importance: 0.7,
    });

    const hierarchy = await calculateAddressableMemory({
      activeSessionId: "mem08-session",
      workingMemoryTokens: 240,
    });
    const m1 = hierarchy.levels.find((l) => l.id === "M1");
    const m2 = hierarchy.levels.find((l) => l.id === "M2");
    const stores = hierarchy.levels.filter((l) => l.in_c_addr);
    expect(m1?.role).toBe("buffer");
    expect(m1?.in_c_addr).toBe(false);
    expect(m2?.role).toBe("buffer");
    expect(m2?.in_c_addr).toBe(false);
    expect(m2?.tokens).toBe(240);
    expect(stores.every((l) => l.role === "store")).toBe(true);
    expect(hierarchy.c_addr).toBe(
      hierarchy.m3_tokens + hierarchy.m4_tokens + hierarchy.m5_tokens,
    );
    expect(hierarchy.c_addr).toBe(stores.reduce((sum, l) => sum + l.tokens, 0));

    const metrics = await BrainManager.getEffectiveContext();
    expect(metrics.c_addr).toBe(hierarchy.c_addr);
    expect(metrics.graph_role).toBe("channel");
    expect(metrics.graph_is_capacity).toBe(false);
    expect(metrics.graph_channel_size).toBe(metrics.graph_entity_count);
  });

  it("C_addr does not change when the user types into M1", async () => {
    await reset();
    await BrainManager.trackSession("mem08-session", "Typing", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Typing leaf",
      content: "A stored fact that must stay the only C_addr change.",
      importance: 0.6,
    });

    const before = await calculateAddressableMemory({ activeSessionId: "mem08-session" });
    const liveBefore = await BrainManager.getEffectiveContext();
    expect(before.c_addr).toBe(liveBefore.c_addr);

    SensoryBuffer.ingest(
      "mem08-session",
      "the user is typing a long draft that must not become addressable storage",
    );
    expect(SensoryBuffer.estimateBufferedTokens("mem08-session")).toBeGreaterThan(0);

    const after = await calculateAddressableMemory({ activeSessionId: "mem08-session" });
    const liveAfter = await BrainManager.getEffectiveContext();
    expect(after.c_addr).toBe(before.c_addr);
    expect(liveAfter.c_addr).toBe(liveBefore.c_addr);
    expect(after.levels.find((l) => l.id === "M1")?.tokens).toBeGreaterThan(0);
    expect(liveAfter.sensory_buffer_tokens).toBeGreaterThan(0);
    expect(after.levels.find((l) => l.id === "M1")?.in_c_addr).toBe(false);
  });

  it("C_addr does not change when working-memory slots fill", async () => {
    await reset();
    await BrainManager.trackSession("mem08-session", "WM", testDir);
    await BrainManager.store({
      category: "fact",
      title: "WM leaf",
      content: "Stored knowledge used as the C_addr baseline for the WM gauge.",
      importance: 0.6,
    });

    const before = await BrainManager.getEffectiveContext();
    const emptyWm = await calculateAddressableMemory({ workingMemoryTokens: 0 });
    const filledGauge = await calculateAddressableMemory({ workingMemoryTokens: 1800 });
    expect(filledGauge.c_addr).toBe(emptyWm.c_addr);
    expect(filledGauge.levels.find((l) => l.id === "M2")?.tokens).toBe(1800);

    BrainManager.getWorkingMemory().add({
      id: "mem08-slot",
      content: "scratchpad tokens for this call that must not grow C_addr",
      source: "user",
      relevance: 0.9,
    });
    const after = await BrainManager.getEffectiveContext();
    expect(after.c_addr).toBe(before.c_addr);
    expect(after.working_memory_tokens).toBeGreaterThan(0);
    expect(after.memory_levels?.find((l) => l.id === "M2")?.in_c_addr).toBe(false);
  });

  it("C_addr does not change when graph entities are added", async () => {
    await reset();
    await BrainManager.trackSession("mem08-session", "Graph", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Graph leaf",
      content: "A stored fact so C_addr is positive before entities appear.",
      importance: 0.6,
    });

    const before = await BrainManager.getEffectiveContext();
    expect(before.graph_entity_count).toBe(0);
    expect(before.graph_is_capacity).toBe(false);

    await KnowledgeGraph.addEntity({
      name: "Mem08ChannelEntity",
      entity_type: "concept",
      description: "Channel node, not addressable storage",
    });

    const after = await BrainManager.getEffectiveContext();
    const cap = await KnowledgeGraph.getCapStatus();
    expect(after.c_addr).toBe(before.c_addr);
    expect(after.graph_entity_count).toBe(1);
    expect(after.graph_channel_size).toBe(1);
    expect(after.graph_role).toBe("channel");
    expect(after.graph_is_capacity).toBe(false);
    expect(cap.channel_size).toBe(1);
    expect(cap.is_capacity).toBe(false);
    expect(cap.max_entities).toBe(0);
    expect(cap.cap_utilization).toBe(0);
    expect(cap.ppr_alpha).toBeCloseTo(0.15, 5);
    expect(after.c_addr).not.toBe(after.graph_entity_count);
    expect(after.graph_cap_utilization ?? 0).toBe(0);
    expect(after.c_addr).toBe(
      (after.memory_levels ?? [])
        .filter((l) => l.in_c_addr)
        .reduce((sum, l) => sum + l.tokens, 0),
    );
  });
});
