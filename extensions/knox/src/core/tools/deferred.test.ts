import { describe, expect, it } from "vitest";
import type { Tool } from "..";

import { allTools } from ".";
import { BuiltInToolNames } from "./builtIn";
import {
  estimateToolSchemaTokens,
  runToolSearch,
  searchDeferredTools,
  splitDeferredTools,
} from "./deferred";

const names = (tools: Tool[]) => tools.map((tool) => tool.function.name);

describe("deferred tools (K-021)", () => {
  it("keeps the core set and defers memory, git and systems tools", () => {
    const { active, deferred } = splitDeferredTools(allTools as Tool[]);
    const activeNames = names(active);
    expect(activeNames).toContain(BuiltInToolNames.ReadFile);
    expect(activeNames).toContain(BuiltInToolNames.EditFile);
    expect(activeNames).toContain(BuiltInToolNames.ToolSearch);
    expect(names(deferred)).toContain(BuiltInToolNames.Memory);
    expect(names(deferred)).toContain(BuiltInToolNames.GitBlame);
    expect(names(deferred)).toContain(BuiltInToolNames.Qemu);
    expect(activeNames).not.toContain(BuiltInToolNames.Memory);
  });

  it("the systems profile keeps its own tools in front", () => {
    const { active } = splitDeferredTools(allTools as Tool[], { systems: true });
    expect(names(active)).toContain(BuiltInToolNames.Qemu);
    expect(names(active)).toContain(BuiltInToolNames.Build);
  });

  it("never defers user-defined tools", () => {
    const custom = {
      type: "function",
      function: { name: "my_tool", description: "x", parameters: {} },
    } as unknown as Tool;
    const { active } = splitDeferredTools([...(allTools as Tool[]), custom]);
    expect(names(active)).toContain("my_tool");
  });

  it("cuts tool-schema tokens by at least 50% on the default profile", () => {
    const all = estimateToolSchemaTokens(allTools as Tool[]);
    const { active } = splitDeferredTools(allTools as Tool[]);
    const now = estimateToolSchemaTokens(active);
    expect(now).toBeLessThanOrEqual(all * 0.5);
    // Regression ceiling: raise it only on purpose.
    expect(now).toBeLessThan(7000);
  });

  it("finds tools by exact name, short name and keyword", () => {
    const { deferred } = splitDeferredTools(allTools as Tool[]);
    expect(
      names(searchDeferredTools(deferred, { names: ["git_blame", "builtin_qemu"] })),
    ).toEqual([BuiltInToolNames.GitBlame, BuiltInToolNames.Qemu]);
    expect(
      names(searchDeferredTools(deferred, { query: "git blame" }))[0],
    ).toBe(BuiltInToolNames.GitBlame);
    expect(searchDeferredTools(deferred, { query: "zzzz" })).toEqual([]);
  });

  it("runToolSearch adds matches to the live list once", () => {
    const { active, deferred } = splitDeferredTools(allTools as Tool[]);
    const before = active.length;
    const first = runToolSearch({ names: ["builtin_git_log"] }, deferred, active);
    expect(active.length).toBe(before + 1);
    expect(first[0].content).toContain("Loaded: builtin_git_log");
    const second = runToolSearch({ names: ["builtin_git_log"] }, deferred, active);
    expect(active.length).toBe(before + 1);
    expect(second[0].content).toContain("Already available");
    const none = runToolSearch({ query: "zzzz" }, deferred, active);
    expect(none[0].content).toContain("No tool matched");
  });
});
