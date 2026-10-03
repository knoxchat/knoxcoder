import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import { memoryTool } from "./definitions/memory";
import { allAvailableTools, allTools } from "./index";

describe("memory tool family (K-021)", () => {
  it("exposes one builtin_memory instead of five tools", () => {
    for (const list of [allTools, allAvailableTools]) {
    const names = list.map((t) => t.function.name);
    expect(names).toContain(BuiltInToolNames.Memory);
    for (const legacy of [
      BuiltInToolNames.MemoryGraph,
      BuiltInToolNames.MemorySessions,
      BuiltInToolNames.MemoryManage,
      BuiltInToolNames.MemoryLearn,
    ]) {
      expect(names).not.toContain(legacy);
    }
    }
  });

  it("keeps the memory description short and covers sub-tool actions", () => {
    const enumValues = (memoryTool.function.parameters as any).properties.action
      .enum as string[];
    expect((memoryTool.function.description ?? "").length).toBeLessThan(1500);
    for (const a of ["add_entity", "search_backlogs", "learn_pattern", "heal"]) {
      expect(enumValues).toContain(a);
    }
  });
});
