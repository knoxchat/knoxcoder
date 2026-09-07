import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";
import { formatPlanText, type TaskPlan } from "core/tools/planStore";

import {
  collectLatestTaskPlan,
  isTaskPlanUpdating,
  isVisibleTaskPlanPeekItem,
  taskPlanFingerprint,
} from "./taskPlan";

const SAMPLE: TaskPlan = {
  title: "Build Snake Game with Dioxus 0.8",
  updatedAt: 1,
  steps: [
    { id: "1-create-cargo", title: "Create Cargo.toml", status: "pending" },
    { id: "2-write-main", title: "Write src/main.rs", status: "in_progress" },
    { id: "3-add-tests", title: "Add unit tests", status: "done" },
  ],
};

function planToolItem(content: string, description = "created") {
  return {
    message: { role: "tool" as const, content, toolCallId: "p1", id: "t1" },
    contextItems: [
      {
        name: "Plan",
        description,
        content,
        id: { providerTitle: "toolCall", itemId: "p1" },
      },
    ],
  };
}

describe("collectLatestTaskPlan", () => {
  it("reads the newest formatted plan from tool output", () => {
    const history = [
      {
        message: { role: "user" as const, content: "build snake", id: "u" },
        contextItems: [],
      },
      planToolItem(formatPlanText(SAMPLE)),
    ];
    const plan = collectLatestTaskPlan(history);
    expect(plan?.title).toBe(SAMPLE.title);
    expect(plan?.steps.map((s) => s.status)).toEqual([
      "pending",
      "in_progress",
      "done",
    ]);
  });

  it("hides after a later clear", () => {
    const history = [
      planToolItem(formatPlanText(SAMPLE)),
      planToolItem("Task Execution Plan cleared.", "cleared"),
    ];
    expect(collectLatestTaskPlan(history)).toBeUndefined();
  });
});

describe("isTaskPlanUpdating", () => {
  it("is true while builtin_plan is in flight", () => {
    const history = [
      {
        message: {
          role: "assistant" as const,
          content: "",
          id: "a",
          toolCalls: [
            {
              id: "p2",
              type: "function" as const,
              function: { name: BuiltInToolNames.Plan, arguments: "{}" },
            },
          ],
        },
        contextItems: [],
        toolCallStates: [
          {
            toolCallId: "p2",
            status: "calling" as const,
            parsedArgs: { action: "complete" },
            toolCall: {
              id: "p2",
              type: "function" as const,
              function: { name: BuiltInToolNames.Plan, arguments: "{}" },
            },
          },
        ],
      },
    ];
    expect(isTaskPlanUpdating(history)).toBe(true);
  });
});

describe("isVisibleTaskPlanPeekItem", () => {
  it("keeps errors in the stream and hides successful plan dumps", () => {
    expect(
      isVisibleTaskPlanPeekItem({
        name: "Plan",
        description: "created",
        content: formatPlanText(SAMPLE),
      }),
    ).toBe(false);
    expect(
      isVisibleTaskPlanPeekItem({
        name: "Plan",
        description: "error",
        content: "No plan step matching 9.",
      }),
    ).toBe(true);
  });
});

describe("taskPlanFingerprint", () => {
  it("changes when a step status changes", () => {
    const next = {
      ...SAMPLE,
      steps: SAMPLE.steps.map((s) =>
        s.id === "2-write-main" ? { ...s, status: "done" as const } : s,
      ),
    };
    expect(taskPlanFingerprint(next)).not.toBe(taskPlanFingerprint(SAMPLE));
  });
});
