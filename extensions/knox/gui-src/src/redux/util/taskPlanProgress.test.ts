import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";
import { formatPlanText, type TaskPlan } from "core/tools/planStore";

import {
  applyLivePlanProgress,
  extractPathHints,
  scoreStepEvent,
  stepIntent,
} from "./taskPlanProgress";

const SNAKE: TaskPlan = {
  title: "Snake game with Dioxus 0.8",
  updatedAt: 1,
  steps: [
    {
      id: "1-cargo",
      title: "Create snake/Cargo.toml with dioxus 0.8 deps",
      status: "pending",
    },
    {
      id: "2-main",
      title: "Write snake/src/main.rs game logic + UI",
      status: "pending",
    },
    { id: "3-css", title: "Add style.css", status: "pending" },
    {
      id: "4-check",
      title: "cargo check / build to verify",
      status: "pending",
    },
  ],
};

function planHistoryItem(plan: TaskPlan) {
  const content = formatPlanText(plan);
  return {
    message: {
      role: "tool" as const,
      content,
      toolCallId: "plan-1",
      id: "t-plan",
    },
    contextItems: [
      {
        name: "Plan",
        description: "created",
        content,
        id: { providerTitle: "toolCall", itemId: "plan-1" },
      },
    ],
  };
}

function fileTool(
  name: string,
  filepath: string,
  status: "calling" | "done" | "canceled" = "done",
  id = filepath,
) {
  return {
    message: {
      role: "assistant" as const,
      content: "",
      id,
      toolCalls: [
        {
          id,
          type: "function" as const,
          function: { name, arguments: JSON.stringify({ filepath }) },
        },
      ],
    },
    contextItems: [],
    toolCallStates: [
      {
        toolCallId: id,
        status,
        parsedArgs: { filepath },
        toolCall: {
          id,
          type: "function" as const,
          function: { name, arguments: JSON.stringify({ filepath }) },
        },
      },
    ],
  };
}

function shellTool(
  command: string,
  status: "calling" | "done" = "done",
  id = command,
) {
  return {
    message: {
      role: "assistant" as const,
      content: "",
      id,
      toolCalls: [
        {
          id,
          type: "function" as const,
          function: {
            name: BuiltInToolNames.RunTerminalCommand,
            arguments: JSON.stringify({ command }),
          },
        },
      ],
    },
    contextItems: [],
    toolCallStates: [
      {
        toolCallId: id,
        status,
        parsedArgs: { command },
        toolCall: {
          id,
          type: "function" as const,
          function: {
            name: BuiltInToolNames.RunTerminalCommand,
            arguments: JSON.stringify({ command }),
          },
        },
      },
    ],
  };
}

describe("extractPathHints / stepIntent", () => {
  it("picks file paths and ignores version numbers", () => {
    expect(
      extractPathHints("Create snake/Cargo.toml with dioxus 0.8.0-alpha.1"),
    ).toEqual(["snake/Cargo.toml"]);
    expect(stepIntent("Create snake/Cargo.toml with dioxus 0.8 deps")).toBe(
      "write",
    );
    expect(stepIntent("cargo check / build to verify")).toBe("shell");
    expect(stepIntent("Add unit tests for game logic")).toBe("test");
  });
});

describe("scoreStepEvent", () => {
  it("scores Cargo.toml writes onto the cargo step, not main.rs", () => {
    const cargo = SNAKE.steps[0];
    const main = SNAKE.steps[1];
    const event = {
      kind: "edit" as const,
      toolName: BuiltInToolNames.CreateNewFile,
      path: "snake/Cargo.toml",
      running: false,
      failed: false,
    };
    expect(scoreStepEvent(cargo, event)).toBeGreaterThan(
      scoreStepEvent(main, event),
    );
    expect(scoreStepEvent(cargo, event)).toBeGreaterThanOrEqual(8);
  });
});

describe("applyLivePlanProgress", () => {
  it("marks a created file done and a later write in progress", () => {
    const history = [
      planHistoryItem(SNAKE),
      fileTool(BuiltInToolNames.CreateNewFile, "snake/Cargo.toml"),
      fileTool(BuiltInToolNames.WriteFile, "snake/src/main.rs", "calling"),
    ];
    const live = applyLivePlanProgress(SNAKE, history, 0);
    expect(live.steps.map((s) => s.status)).toEqual([
      "done",
      "in_progress",
      "pending",
      "pending",
    ]);
    expect(live.doneCount).toBe(1);
    expect(live.remaining).toBe(3);
    expect(live.current?.id).toBe("2-main");
    expect(live.updating).toBe(true);
  });

  it("does not complete a write step from a mere file read", () => {
    const history = [
      planHistoryItem(SNAKE),
      fileTool(BuiltInToolNames.ReadFile, "snake/Cargo.toml"),
    ];
    const live = applyLivePlanProgress(SNAKE, history, 0);
    expect(live.steps[0].status).toBe("pending");
  });

  it("matches cargo check onto the verify step", () => {
    const history = [
      planHistoryItem(SNAKE),
      fileTool(BuiltInToolNames.CreateNewFile, "snake/Cargo.toml"),
      shellTool("cd snake && cargo check"),
    ];
    const live = applyLivePlanProgress(SNAKE, history, 0);
    expect(live.steps[0].status).toBe("done");
    expect(live.steps[3].status).toBe("done");
  });

  it("does not mark done when the matching tool failed", () => {
    const history = [
      planHistoryItem(SNAKE),
      {
        ...fileTool(BuiltInToolNames.CreateNewFile, "snake/Cargo.toml"),
        toolCallStates: [
          {
            toolCallId: "snake/Cargo.toml",
            status: "done" as const,
            parsedArgs: { filepath: "snake/Cargo.toml" },
            output: [
              {
                name: "Tool Call Error",
                description: "error",
                content: 'Tool call "builtin_create_new_file" failed',
              },
            ],
            toolCall: {
              id: "snake/Cargo.toml",
              type: "function" as const,
              function: {
                name: BuiltInToolNames.CreateNewFile,
                arguments: "{}",
              },
            },
          },
        ],
      },
    ];
    const live = applyLivePlanProgress(SNAKE, history, 0);
    expect(live.steps[0].status).toBe("pending");
  });
});
