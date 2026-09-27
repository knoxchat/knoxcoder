import { describe, expect, it, vi } from "vitest";
import type { ILLM, Tool, ToolExtras } from "../../../index.js";

import { executeAutonomousStep, filterAutonomousCatalog } from "./AutonomousExecutor";
import {
  compactAutonomousArgs,
  compactAutonomousOutput,
  truncateAutonomousText,
} from "./autonomousEvents";
import { BuiltInToolNames } from "../../../tools/builtIn";
import { createScriptedLlm } from "../../../eval/harness";

describe("autonomous event payloads", () => {
  it("truncates long args and tool output", () => {
    expect(truncateAutonomousText("x".repeat(10), 8)).toContain("truncated");
    const args = compactAutonomousArgs({ blob: "y".repeat(8_000) });
    expect(args._truncated).toBe(true);
    const items = compactAutonomousOutput(
      Array.from({ length: 12 }, (_, i) => ({
        name: `n${i}`,
        description: "d",
        content: "z".repeat(10),
      })),
    );
    expect(items).toHaveLength(8);
  });
});

describe("autonomous catalog", () => {
  it("drops ask_user so the loop cannot block on a GUI question", () => {
    const catalog = filterAutonomousCatalog([
      { function: { name: BuiltInToolNames.ReadFile } } as Tool,
      { function: { name: BuiltInToolNames.AskUser } } as Tool,
    ]);
    expect(catalog.map((tool) => tool.function.name)).toEqual([
      BuiltInToolNames.ReadFile,
    ]);
  });
});

describe("autonomous tool stream events", () => {
  it("emits tool_start then tool_end around executeTool", async () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const llm = createScriptedLlm([
      {
        toolCalls: [
          {
            name: BuiltInToolNames.ReadFile,
            args: { filepath: "mm/filemap.c" },
          },
        ],
      },
      { content: "read filemap\n[GOAL_COMPLETE]" },
    ]);
    const readTool = {
      function: { name: BuiltInToolNames.ReadFile },
      readonly: true,
    } as Tool;

    await executeAutonomousStep(
      llm as unknown as ILLM,
      {
        iteration: 1,
        goal: "read filemap",
        memoryContext: "",
        maxIterations: 2,
        sessionId: "sess-stream",
        previousResults: [],
      },
      undefined,
      undefined,
      {
        catalog: [readTool],
        extras: {
          ide: {} as ToolExtras["ide"],
          llm: llm as unknown as ToolExtras["llm"],
          fetch: (async () => new Response()) as ToolExtras["fetch"],
        },
        executeTool: async () => [
          { name: "file", description: "ok", content: "copy_to_user" },
        ],
        onEvent: (type, data) => events.push({ type, data }),
      },
    );

    expect(events.map((event) => event.type)).toEqual([
      "autonomous:tool_start",
      "autonomous:tool_end",
      "autonomous:assistant",
    ]);
    expect(events[0]?.data.name).toBe(BuiltInToolNames.ReadFile);
    expect(events[1]?.data.ok).toBe(true);
    expect(JSON.stringify(events[1]?.data.output)).toContain("copy_to_user");
  });

  it("emits tool_ask and skips execute when the user denies", async () => {
    const { resolveAutonomousToolApproval } = await import(
      "../../../agent/autonomousApproval.js"
    );
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const llm = createScriptedLlm([
      {
        toolCalls: [
          {
            name: BuiltInToolNames.EditFile,
            args: { filepath: "a.c", old_string: "x", new_string: "y" },
          },
        ],
      },
      { content: "denied the edit\n[GOAL_COMPLETE]" },
    ]);
    const editTool = {
      function: { name: BuiltInToolNames.EditFile },
      readonly: false,
    } as Tool;
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "patched" },
    ]);

    const running = executeAutonomousStep(
      llm as unknown as ILLM,
      {
        iteration: 1,
        goal: "edit a.c",
        memoryContext: "",
        maxIterations: 2,
        sessionId: "sess-ask",
        previousResults: [],
      },
      undefined,
      undefined,
      {
        catalog: [editTool],
        extras: {
          ide: {} as ToolExtras["ide"],
          llm: llm as unknown as ToolExtras["llm"],
          fetch: (async () => new Response()) as ToolExtras["fetch"],
        },
        executeTool,
        permission: {
          mode: "default",
          toolSettings: {
            [BuiltInToolNames.EditFile]: "allowedWithPermission",
          },
          sessionAllowlist: [],
        },
        onEvent: (type, data) => events.push({ type, data }),
      },
    );

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "autonomous:tool_ask")).toBe(
        true,
      );
    });
    const ask = events.find((event) => event.type === "autonomous:tool_ask");
    expect(
      resolveAutonomousToolApproval({
        sessionId: "sess-ask",
        callId: String(ask?.data.call_id),
        allow: false,
      }),
    ).toBe(true);
    await running;
    expect(executeTool).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toContain("autonomous:tool_end");
  });
});
