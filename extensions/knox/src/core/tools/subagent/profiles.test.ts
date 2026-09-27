import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../builtIn";
import {
  resolveSubagentMaxSteps,
  resolveSubagentProfile,
  subagentSystemPrompt,
  toolsForSubagentProfile,
} from "./profiles";

describe("subagent profiles", () => {
  it("defaults to explore", () => {
    expect(resolveSubagentProfile(undefined)).toBe("explore");
    expect(resolveSubagentProfile("nope")).toBe("explore");
    expect(resolveSubagentProfile("general")).toBe("general");
  });

  it("clamps max steps", () => {
    expect(resolveSubagentMaxSteps("explore", undefined)).toBe(12);
    expect(resolveSubagentMaxSteps("general", 99)).toBe(40);
    expect(resolveSubagentMaxSteps("review", 3)).toBe(3);
    expect(resolveSubagentMaxSteps("explore", undefined, { systems: true })).toBe(
      40,
    );
    expect(resolveSubagentMaxSteps("general", 999, { systems: true })).toBe(200);
  });

  it("explore/review are readonly and never nest task/ask_user", () => {
    const catalog = [
      { function: { name: BuiltInToolNames.ReadFile }, readonly: true },
      { function: { name: BuiltInToolNames.EditFile }, readonly: false },
      { function: { name: BuiltInToolNames.Task }, readonly: false },
      { function: { name: BuiltInToolNames.AskUser }, readonly: false },
      { function: { name: BuiltInToolNames.ViewDiff }, readonly: true },
      { function: { name: BuiltInToolNames.Memory }, readonly: false },
      { function: { name: BuiltInToolNames.MemoryManage }, readonly: false },
    ] as any;

    const explore = toolsForSubagentProfile("explore", catalog).map(
      (tool) => tool.function.name,
    );
    expect(explore).toEqual([
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.ViewDiff,
      BuiltInToolNames.Memory,
    ]);

    const general = toolsForSubagentProfile("general", catalog).map(
      (tool) => tool.function.name,
    );
    expect(general).toEqual([
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.EditFile,
      BuiltInToolNames.ViewDiff,
      BuiltInToolNames.Memory,
      BuiltInToolNames.MemoryManage,
    ]);

    const rustReview = toolsForSubagentProfile("rust-review", catalog).map(
      (tool) => tool.function.name,
    );
    expect(rustReview).toEqual(explore);
    expect(
      toolsForSubagentProfile("rust-borrowck", catalog).map(
        (tool) => tool.function.name,
      ),
    ).toEqual(explore);
  });

  it("rust-review / rust-borrowck / rust-architect prompts carry the mandate", () => {
    expect(subagentSystemPrompt("rust-review")).toMatch(/adversarial/i);
    expect(subagentSystemPrompt("rust-review")).toMatch(/unwrap/);
    expect(subagentSystemPrompt("rust-borrowck")).toMatch(/ownership/);
    expect(subagentSystemPrompt("rust-borrowck")).toMatch(/mem::take/);
    expect(subagentSystemPrompt("rust-architect")).toMatch(/ADR|builtin_plan/);
    expect(resolveSubagentProfile("rust-architect")).toBe("rust-architect");
  });
});
