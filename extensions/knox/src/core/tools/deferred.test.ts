import { describe, expect, it } from "vitest";
import type { Tool } from "..";

import { allAvailableTools, allTools } from ".";
import { BuiltInToolNames } from "./builtIn";
import {
  autoloadDeferredTool,
  estimateToolSchemaTokens,
  runToolSearch,
  searchDeferredTools,
  splitDeferredTools,
} from "./deferred";

const names = (tools: Tool[]) => tools.map((tool) => tool.function.name);

describe("deferred tools (K-021)", () => {
  it("keeps the core set and defers memory, git blame, lsp and systems tools", () => {
    const { active, deferred } = splitDeferredTools(allTools as Tool[]);
    const activeNames = names(active);
    expect(activeNames).toContain(BuiltInToolNames.ReadFile);
    expect(activeNames).toContain(BuiltInToolNames.EditFile);
    expect(activeNames).toContain(BuiltInToolNames.ToolSearch);
    expect(activeNames).toContain(BuiltInToolNames.GitStatus);
    expect(activeNames).toContain(BuiltInToolNames.GitDiff);
    expect(activeNames).toContain(BuiltInToolNames.Recipe);
    expect(activeNames).not.toContain(BuiltInToolNames.Lsp);
    expect(names(deferred)).toContain(BuiltInToolNames.Lsp);
    expect(names(deferred)).toContain(BuiltInToolNames.Memory);
    expect(names(deferred)).toContain(BuiltInToolNames.GitBlame);
    expect(names(deferred)).toContain(BuiltInToolNames.Qemu);
    expect(activeNames).not.toContain(BuiltInToolNames.Memory);
  });

  it("promotes lsp when a language server kind is active", () => {
    const { active, deferred } = splitDeferredTools(allTools as Tool[], {
      lspActive: true,
    });
    expect(names(active)).toContain(BuiltInToolNames.Lsp);
    expect(names(deferred)).not.toContain(BuiltInToolNames.Lsp);
  });

  it("hides composite tools from tool_search unless enabled", () => {
    const hidden = splitDeferredTools(allAvailableTools as Tool[]);
    expect(names(hidden.active).some((name) => name.startsWith("composite_"))).toBe(
      false,
    );
    expect(names(hidden.deferred).some((name) => name.startsWith("composite_"))).toBe(
      false,
    );
    const shown = splitDeferredTools(allAvailableTools as Tool[], {
      enableCompositeTools: true,
    });
    expect(names(shown.deferred)).toContain("composite_smart_edit");
  });

  it("the systems profile keeps its own tools in front", () => {
    const { active } = splitDeferredTools(allTools as Tool[], { systems: true });
    expect(names(active)).toContain(BuiltInToolNames.Qemu);
    expect(names(active)).toContain(BuiltInToolNames.Build);
    expect(names(active)).toContain(BuiltInToolNames.Lsp);
  });

  it("never defers user-defined tools", () => {
    const custom = {
      type: "function",
      function: { name: "my_tool", description: "x", parameters: {} },
    } as unknown as Tool;
    const { active } = splitDeferredTools([...(allTools as Tool[]), custom]);
    expect(names(active)).toContain("my_tool");
  });

  it("keeps default-profile active tool schemas under the K-021 ceiling", () => {
    const all = estimateToolSchemaTokens(allTools as Tool[]);
    const { active } = splitDeferredTools(allTools as Tool[]);
    const now = estimateToolSchemaTokens(active);
    // K-070 shrank deferred `builtin_memory`, so `all` dropped and a hard
    // 50%-of-all ratio is no longer a stable proof. Deferral still has to
    // beat sending everything; 7000 is the regression ceiling.
    expect(now).toBeLessThan(all * 0.6);
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

  it("K-064 autoloads a deferred tool (and aliases) onto the live list", () => {
    const { active, deferred } = splitDeferredTools(allTools as Tool[]);
    const before = active.length;
    const loaded = autoloadDeferredTool("git_blame", deferred, active);
    expect(loaded?.function.name).toBe(BuiltInToolNames.GitBlame);
    expect(active.length).toBe(before + 1);
    expect(names(active)).toContain(BuiltInToolNames.GitBlame);
    expect(autoloadDeferredTool("builtin_git_blame", deferred, active)?.function.name).toBe(
      BuiltInToolNames.GitBlame,
    );
    expect(active.length).toBe(before + 1);
    expect(autoloadDeferredTool("not_a_tool", deferred, active)).toBeUndefined();
  });
});
