import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { BuiltInToolNames } from "./builtIn";
import { MEMORY_PRODUCT_ACTIONS, memoryTool } from "./definitions/memory";
import { allAvailableTools, allTools } from "./index";

describe("memory tool family (K-021 / K-070)", () => {
  it("exposes one builtin_memory instead of five tools", () => {
    for (const list of [allTools, allAvailableTools]) {
      const names = list.map((t) => t.function.name);
      expect(names).toContain(BuiltInToolNames.Memory);
      for (const legacy of [
        "builtin_memory_graph",
        "builtin_memory_sessions",
        "builtin_memory_manage",
        "builtin_memory_learn",
      ]) {
        expect(names).not.toContain(legacy);
      }
    }
  });

  it("advertises only the product action set", () => {
    const enumValues = (memoryTool.function.parameters as { properties: { action: { enum: string[] } } })
      .properties.action.enum;
    expect((memoryTool.function.description ?? "").length).toBeLessThan(1500);
    expect(enumValues.length).toBeLessThanOrEqual(12);
    expect(enumValues).toEqual([...MEMORY_PRODUCT_ACTIONS]);
    expect(memoryTool.function.description).toMatch(/durable facts and decisions only/i);
    for (const banned of [
      "heal",
      "five_tier_consolidate",
      "get_cache_stats",
      "root_cause_analysis",
    ]) {
      expect(enumValues).not.toContain(banned);
      expect(JSON.stringify(memoryTool.function)).not.toContain(banned);
    }
  });
});

describe("product memory store + recall (K-070)", () => {
  const testDir = path.join(os.tmpdir(), `knox-memory-catalog-${Date.now()}`);
  let memoryImpl: typeof import("./implementations/memory").memoryImpl;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ memoryImpl } = await import("./implementations/memory"));
    const { BrainStore } = await import("../context/memory/brain/BrainStore.js");
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("stores a decision and recalls it", async () => {
    const extras = {
      ide: {} as never,
      llm: undefined,
    } as never;
    const stored = await memoryImpl(
      {
        action: "store",
        category: "decision",
        title: "Auth uses JWT",
        content: "The reports API validates JWT expiry on every request.",
      },
      extras,
    );
    expect(stored[0]?.content).toMatch(/stored successfully/i);

    const recalled = await memoryImpl(
      {
        action: "recall",
        query: "Auth uses JWT",
        include_episodic: false,
      },
      extras,
    );
    expect(recalled[0]?.content).toMatch(/JWT/i);
  });

  it("refuses admin actions without dispatching", async () => {
    const extras = {
      ide: {} as never,
      llm: undefined,
    } as never;
    const { BrainManager } = await import("../context/memory/brain/BrainManager.js");
    const dispatch = vi.spyOn(BrainManager, "dispatch");
    try {
      for (const action of ["heal", "export", "run_pipeline"] as const) {
        const result = await memoryImpl({ action }, extras);
        expect(result[0]?.content).toMatch(/not available on builtin_memory/i);
        expect(result[0]?.content).toMatch(/brain\/\*/i);
      }
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
    }
  });
});
