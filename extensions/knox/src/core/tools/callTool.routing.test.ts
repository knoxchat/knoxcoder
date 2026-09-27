import { describe, expect, it } from "vitest";

import { unimplementedAdvancedTools } from "./definitions/advanced";
import { compositeTools } from "./definitions/composite";
import {
  hasToolImplementation,
  listImplementedToolNames,
} from "./callTool";
import { allAvailableTools, allTools } from "./index";

describe("callTool routing honesty", () => {
  it("lists every default allTools entry as implemented", () => {
    for (const tool of allTools) {
      expect(
        hasToolImplementation(tool.function.name),
        `${tool.function.name} missing callTool impl`,
      ).toBe(true);
    }
  });

  it("lists every allAvailableTools entry as implemented", () => {
    for (const tool of allAvailableTools) {
      expect(
        hasToolImplementation(tool.function.name),
        `${tool.function.name} in allAvailableTools but not routed`,
      ).toBe(true);
    }
  });

  it("routes every composite definition name", () => {
    for (const tool of compositeTools) {
      expect(
        hasToolImplementation(tool.function.name),
        `${tool.function.name} composite missing impl map entry`,
      ).toBe(true);
    }
  });

  it("does not claim unimplemented advanced tools are routable", () => {
    for (const tool of unimplementedAdvancedTools) {
      expect(
        hasToolImplementation(tool.function.name),
        `${tool.function.name} should stay quarantined`,
      ).toBe(false);
    }
  });

  it("listImplementedToolNames covers composites + builtins", () => {
    const names = new Set(listImplementedToolNames());
    expect(names.has("builtin_generate_tests")).toBe(true);
    expect(names.has("composite_smart_edit")).toBe(true);
    expect(names.has("composite_implement_feature")).toBe(true);
    expect(names.has("composite_migrate")).toBe(true);
    expect(names.has("builtin_analyze_code")).toBe(false);
    expect(names.has("builtin_task")).toBe(true);
    expect(names.has("builtin_ask_user")).toBe(true);
    expect(names.has("builtin_git_status")).toBe(true);
    expect(names.has("builtin_git_commit")).toBe(true);
    expect(names.has("builtin_git_blame")).toBe(true);
    expect(names.has("builtin_git_bisect")).toBe(true);
    expect(names.has("builtin_qemu")).toBe(true);
    expect(names.has("builtin_debug")).toBe(true);
    expect(names.has("builtin_kconfig")).toBe(true);
    expect(names.has("builtin_maintainers")).toBe(true);
    expect(names.has("builtin_workspace_checkpoint")).toBe(true);
    expect(names.has("builtin_build")).toBe(true);
    expect(names.has("builtin_pty_start")).toBe(true);
    expect(names.has("builtin_pty_send")).toBe(true);
    expect(names.has("builtin_pty_read")).toBe(true);
    expect(names.has("builtin_plan")).toBe(true);
  });

  it("does not put builtin_debug on the default allTools catalog (HL-46)", () => {
    expect(allTools.some((tool) => tool.function.name === "builtin_debug")).toBe(
      false,
    );
    expect(
      allAvailableTools.some((tool) => tool.function.name === "builtin_debug"),
    ).toBe(true);
  });
});
