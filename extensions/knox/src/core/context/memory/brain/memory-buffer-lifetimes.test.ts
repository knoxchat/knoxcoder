/**
 * MEM-33 — M₁/M₂ lifetimes are turn / call / session.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem33-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let SensoryBuffer: typeof import("./SensoryBuffer.js").SensoryBuffer;
let WorkingMemory: typeof import("./WorkingMemory.js").WorkingMemory;
let CURRENT_TURN_SLOT_ID: typeof import("./WorkingMemory.js").CURRENT_TURN_SLOT_ID;
let getMemoryLevelSpecs: typeof import("./MemoryHierarchy.js").getMemoryLevelSpecs;
let getWorkingMemoryOptions: typeof import("./memoryConfigAccess.js").getWorkingMemoryOptions;
let getMemoryInjectHardCap: typeof import("./memoryConfigAccess.js").getMemoryInjectHardCap;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ SensoryBuffer } = await import("./SensoryBuffer.js"));
  ({ WorkingMemory, CURRENT_TURN_SLOT_ID } = await import("./WorkingMemory.js"));
  ({ getMemoryLevelSpecs } = await import("./MemoryHierarchy.js"));
  ({ getWorkingMemoryOptions, getMemoryInjectHardCap } = await import("./memoryConfigAccess.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("MEM-33 buffer lifetimes", () => {
  it("publishes turn / call / session lifetimes on the hierarchy", () => {
    const specs = getMemoryLevelSpecs();
    expect(specs.find((s) => s.id === "M1")?.lifetime).toBe("turn");
    expect(specs.find((s) => s.id === "M2")?.lifetime).toBe("call");
    expect(specs.find((s) => s.id === "M3")?.lifetime).toBe("session");
    expect(specs.find((s) => s.id === "M4")?.lifetime).toBe("stored");
    expect(specs.find((s) => s.id === "M5")?.lifetime).toBe("stored");
    expect(specs.find((s) => s.id === "M1")?.retention).toBe("one turn");
    expect(specs.find((s) => s.id === "M2")?.retention).toBe("one call");
  });

  it("keeps M1 chunks until the turn boundary when debounce is 0", async () => {
    const sessionId = "mem33-turn";
    const flushed: string[] = [];
    SensoryBuffer.clear(sessionId);
    SensoryBuffer.setFlushHandler(sessionId, (text) => flushed.push(text));
    SensoryBuffer.ingest(sessionId, "editor draft about oauth");

    expect(SensoryBuffer.getStats(sessionId).lifetime).toBe("turn");
    expect(SensoryBuffer.estimateBufferedTokens(sessionId)).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(flushed).toHaveLength(0);

    SensoryBuffer.flushOnTurnBoundary(sessionId, "send the turn");
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toContain("editor draft about oauth");
    expect(SensoryBuffer.estimateBufferedTokens(sessionId)).toBeGreaterThan(0);
    SensoryBuffer.clear(sessionId);
  });

  it("optional sensory_buffer_ms still debounces when set", async () => {
    const sessionId = "mem33-debounce";
    const flushed: string[] = [];
    await BrainStore.saveConfig("sensory_buffer_ms", "40");
    SensoryBuffer.clear(sessionId);
    SensoryBuffer.setFlushHandler(sessionId, (text) => flushed.push(text));
    SensoryBuffer.ingest(sessionId, "debounced chunk");

    await new Promise((r) => setTimeout(r, 80));
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toContain("debounced chunk");
    await BrainStore.saveConfig("sensory_buffer_ms", "0");
    SensoryBuffer.clear(sessionId);
  });

  it("does not evict M2 on a wall clock when TTL is 0", () => {
    const wm = new WorkingMemory({
      maxSlots: 4,
      tokenBudget: 2000,
      ttlSeconds: 0,
      decayRatePerSecond: 0,
    });
    wm.add({
      id: "keep-session",
      content: "session attended scratch",
      source: "semantic",
      relevance: 0.9,
    });
    const item = wm.get("keep-session");
    expect(item).toBeDefined();
    item!.added_at = Date.now() - 120_000;
    expect(wm.getAll()).toHaveLength(1);
    expect(wm.getStats().lifetime).toBe("call");
    expect(wm.getStats().ttl_seconds).toBe(0);
  });

  it("drops call-scoped scratch but keeps session-attended slots", () => {
    const wm = new WorkingMemory({
      maxSlots: 5,
      tokenBudget: 2000,
      ttlSeconds: 0,
      decayRatePerSecond: 0,
    });
    wm.add({
      id: CURRENT_TURN_SLOT_ID,
      content: "this call user text",
      source: "user",
      relevance: 0.8,
    });
    wm.add({
      id: "tool-1",
      content: "tool result for this call",
      source: "tool",
      relevance: 0.7,
    });
    wm.add({
      id: "session-slot",
      content: "attended fact from this session",
      source: "semantic",
      relevance: 0.9,
    });

    wm.flushOnCallBoundary();
    expect(wm.get(CURRENT_TURN_SLOT_ID)).toBeUndefined();
    expect(wm.get("tool-1")).toBeUndefined();
    expect(wm.get("session-slot")?.content).toContain("attended fact");
  });

  it("does not treat the M2 scratchpad budget as W_mem or a 30K cap", async () => {
    await BrainStore.saveConfig("working_memory_token_budget", "50000");
    const opts = getWorkingMemoryOptions();
    expect(opts.tokenBudget).toBe(50_000);
    expect(opts.ttlSeconds).toBe(0);
    expect(opts.tokenBudget).not.toBe(getMemoryInjectHardCap());
    expect(opts.maxSlots).toBe(BrainStore.getConfig().working_memory_max_slots);
    await BrainStore.saveConfig("working_memory_token_budget", "0");
    BrainManager.getWorkingMemory();
  });
});
