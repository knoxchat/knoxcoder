import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

import {
  activityAnchorId,
  buildAgentActivitySteps,
  classifyToolKind,
  collectTurnPromptLogs,
  currentActivityStep,
  estimateTokensFromPromptLogs,
  findLastUserIndex,
  formatDurationMs,
  formatTokenCount,
  mapToolStatus,
  summarizeActivity,
  toolStepDetail,
  turnElapsedMs,
  visibleActivitySteps,
} from "./agentActivity";

function toolState(
  name: string,
  status: "generating" | "generated" | "calling" | "done" | "canceled",
  args: Record<string, unknown> = {},
  id = name,
  output?: Array<{ name: string; description: string; content: string }>,
) {
  return {
    toolCallId: id,
    status,
    parsedArgs: args,
    toolCall: {
      id,
      type: "function" as const,
      function: { name, arguments: JSON.stringify(args) },
    },
    output,
  };
}

function user(id = "u1") {
  return {
    message: { role: "user" as const, content: "do the thing", id },
    contextItems: [],
  };
}

function assistantTools(states: ReturnType<typeof toolState>[], id = "a1") {
  return {
    message: {
      role: "assistant" as const,
      content: "",
      id,
      toolCalls: states.map((s) => s.toolCall),
    },
    contextItems: [],
    toolCallStates: states,
    toolCallState: states[0],
  };
}

describe("classifyToolKind", () => {
  it("maps reads, edits, search, git, task, ask", () => {
    expect(classifyToolKind(BuiltInToolNames.ReadFile)).toBe("read");
    expect(classifyToolKind(BuiltInToolNames.Glob)).toBe("read");
    expect(classifyToolKind(BuiltInToolNames.EditFile)).toBe("edit");
    expect(classifyToolKind(BuiltInToolNames.ApplyPatch)).toBe("edit");
    expect(classifyToolKind(BuiltInToolNames.ExactSearch)).toBe("search");
    expect(classifyToolKind(BuiltInToolNames.GitStatus)).toBe("git");
    expect(classifyToolKind(BuiltInToolNames.GitBlame)).toBe("git");
    expect(classifyToolKind(BuiltInToolNames.GitBisect)).toBe("git");
    expect(classifyToolKind(BuiltInToolNames.Task)).toBe("task");
    expect(
      classifyToolKind(BuiltInToolNames.PtyStart, {
        command: "qemu-system-x86_64 -kernel bzImage",
      }),
    ).toBe("shell");
    expect(classifyToolKind(BuiltInToolNames.AskUser)).toBe("ask");
    expect(classifyToolKind(BuiltInToolNames.WorkspaceCheckpoint)).toBe("edit");
    expect(
      classifyToolKind(BuiltInToolNames.Build, {
        action: "check",
        extraArgs: "--release",
      }),
    ).toBe("shell");
    expect(
      classifyToolKind(BuiltInToolNames.Build, { action: "test" }),
    ).toBe("test");
  });

  it("treats generate_tests and test-runner shell as test", () => {
    expect(classifyToolKind(BuiltInToolNames.GenerateTests)).toBe("test");
    expect(
      classifyToolKind(BuiltInToolNames.RunTerminalCommand, {
        command: "pnpm test",
      }),
    ).toBe("test");
    expect(
      classifyToolKind(BuiltInToolNames.RunTerminalCommand, {
        command: "cd packages/core && npx vitest run",
      }),
    ).toBe("test");
    expect(
      classifyToolKind(BuiltInToolNames.RunTerminalCommand, {
        command: "git commit -m 'add tests'",
      }),
    ).toBe("shell");
  });
});

describe("toolStepDetail", () => {
  it("uses basename for paths and truncates commands", () => {
    expect(
      toolStepDetail(BuiltInToolNames.EditFile, {
        filepath: "src/redux/util/agentActivity.ts",
      }),
    ).toBe("agentActivity.ts");
    expect(
      toolStepDetail(BuiltInToolNames.RunTerminalCommand, {
        command: "ls -la",
      }),
    ).toBe("ls -la");
    expect(
      toolStepDetail(BuiltInToolNames.ApplyPatch, {
        patch: "*** Begin Patch\n*** Update File: gui/src/pages/gui/Chat.tsx\n",
      }),
    ).toBe("Chat.tsx");
    expect(
      toolStepDetail(BuiltInToolNames.WorkspaceCheckpoint, {
        action: "diff",
        checkpoint_id: "cp_550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toBe("cp_550e8400-e29…");
    expect(
      toolStepDetail(BuiltInToolNames.Build, {
        action: "check",
        extraArgs: "--release",
      }),
    ).toBe("check --release");
  });
});

describe("mapToolStatus / anchors", () => {
  it("maps tool statuses and sanitizes ids", () => {
    expect(mapToolStatus("calling")).toBe("running");
    expect(mapToolStatus("generated")).toBe("pending");
    expect(mapToolStatus("done")).toBe("done");
    expect(activityAnchorId("tool:abc:1")).toBe("agent-activity-tool_abc_1");
  });
});

describe("buildAgentActivitySteps", () => {
  it("walks thinking → tools → reply for one user turn", () => {
    const history = [
      user(),
      {
        message: { role: "thinking" as const, content: "plan", id: "t1" },
        contextItems: [],
      },
      assistantTools([
        toolState(BuiltInToolNames.ReadFile, "done", {
          filepath: "a.ts",
        }, "r1"),
        toolState(BuiltInToolNames.EditFile, "calling", {
          filepath: "b.ts",
        }, "e1"),
      ]),
      {
        message: { role: "tool" as const, content: "ok", id: "out", toolCallId: "r1" },
        contextItems: [],
      },
      {
        message: { role: "assistant" as const, content: "done", id: "final" },
        contextItems: [],
      },
      user("u2"),
    ];

    const steps = buildAgentActivitySteps(history as any, 0, {
      inProgress: true,
    });
    expect(steps.map((s) => [s.kind, s.status, s.detail])).toEqual([
      ["thinking", "done", undefined],
      ["read", "done", "a.ts"],
      ["edit", "running", "b.ts"],
      ["reply", "done", undefined],
    ]);
    expect(findLastUserIndex(history as any)).toBe(5);
    expect(buildAgentActivitySteps(history as any, 5)).toEqual([]);
  });

  it("includes assistant reasoning as thinking", () => {
    const history = [
      user(),
      {
        message: { role: "assistant" as const, content: "", id: "a" },
        contextItems: [],
        reasoning: { active: true, text: "hmm", startAt: 1 },
      },
    ];
    const steps = buildAgentActivitySteps(history as any, 0);
    expect(steps).toEqual([
      {
        id: "reasoning:a",
        kind: "thinking",
        status: "running",
        historyIndex: 1,
      },
    ]);
  });

  it("returns empty for a non-user index", () => {
    expect(buildAgentActivitySteps([user()] as any, 1)).toEqual([]);
  });

  it("attaches a workspace checkpoint id from the soul stamp", () => {
    const history = [
      user(),
      assistantTools([
        toolState(
          BuiltInToolNames.EditFile,
          "done",
          { filepath: "b.ts" },
          "e1",
          [{ name: "soul", description: "checkpoint", content: "[soul checkpoint=cp-turn-1]" }],
        ),
      ]),
    ];
    const steps = buildAgentActivitySteps(history as any, 0);
    expect(steps[0].workspaceCheckpointId).toBe("cp-turn-1");
  });

  it("marks trailing thinking as running only while the turn is in progress", () => {
    const history = [
      user(),
      {
        message: { role: "thinking" as const, content: "…", id: "t1" },
        contextItems: [],
      },
    ];
    expect(buildAgentActivitySteps(history as any, 0)[0].status).toBe("done");
    expect(
      buildAgentActivitySteps(history as any, 0, { inProgress: true })[0]
        .status,
    ).toBe("running");
  });
});

describe("summarize / visible / current", () => {
  it("counts kinds and hides older steps when collapsed", () => {
    const steps = [
      { id: "1", kind: "thinking" as const, status: "done" as const, historyIndex: 0 },
      { id: "2", kind: "read" as const, status: "done" as const, historyIndex: 1 },
      { id: "3", kind: "edit" as const, status: "running" as const, historyIndex: 2 },
      { id: "4", kind: "test" as const, status: "pending" as const, historyIndex: 3 },
    ];
    expect(summarizeActivity(steps)).toEqual({
      thinking: 1,
      reads: 1,
      searches: 0,
      edits: 1,
      tests: 1,
      other: 0,
      running: true,
    });
    expect(currentActivityStep(steps)?.id).toBe("3");
    const collapsed = visibleActivitySteps(steps, false, 2);
    expect(collapsed.hiddenCount).toBe(2);
    expect(collapsed.visible.map((s) => s.id)).toEqual(["3", "4"]);
  });
});

describe("turn meter helpers", () => {
  it("estimates tokens from prompt logs and formats counts", () => {
    expect(
      estimateTokensFromPromptLogs([
        {
          modelTitle: "m",
          completionOptions: { model: "m" },
          prompt: "abcd",
          completion: "efgh",
        },
      ]),
    ).toBe(2);
    expect(formatTokenCount(420)).toBe("420");
    expect(formatTokenCount(4200)).toBe("4.2k");
    expect(formatTokenCount(42_000)).toBe("42k");
    expect(formatTokenCount(1_356_000)).toBe("1.4m");
  });

  it("collects prompt logs for the current turn only", () => {
    const history = [
      {
        ...user(),
        promptLogs: [
          {
            modelTitle: "m",
            completionOptions: { model: "m" },
            prompt: "aa",
            completion: "bb",
          },
        ],
      },
      {
        message: { role: "assistant" as const, content: "x", id: "a" },
        contextItems: [],
        promptLogs: [
          {
            modelTitle: "m",
            completionOptions: { model: "m" },
            prompt: "cc",
            completion: "dd",
          },
        ],
      },
      user("u2"),
    ];
    const logs = collectTurnPromptLogs(history as any, 0);
    expect(logs).toHaveLength(2);
    expect(collectTurnPromptLogs(history as any, 2)).toHaveLength(0);
  });

  it("formats duration and measures turn elapsed time", () => {
    expect(formatDurationMs(1500)).toBe("1s");
    expect(formatDurationMs(65_000)).toBe("1m 5s");
    expect(formatDurationMs(3_600_000)).toBe("1h");

    const start = "2026-08-16T00:00:00.000Z";
    const mid = "2026-08-16T00:00:10.000Z";
    const history = [
      {
        message: { role: "user" as const, content: "hi", id: "u", createdAt: start },
        contextItems: [],
      },
      {
        message: {
          role: "assistant" as const,
          content: "ok",
          id: "a",
          createdAt: mid,
        },
        contextItems: [],
      },
    ];
    expect(turnElapsedMs(history as any, 0, Date.parse(mid), false)).toBe(10_000);
    expect(
      turnElapsedMs(history as any, 0, Date.parse(start) + 25_000, true),
    ).toBe(25_000);
  });
});
