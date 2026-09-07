import { ChatHistoryItem, ContextItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import {
  parsePlanText,
  PLAN_CLEARED_TEXT,
  TASK_EXECUTION_PLAN_MARKER,
  type TaskPlan,
} from "core/tools/planStore";

import { getHistoryToolStates } from "./index";

const PLAN_OUTPUT_DESCRIPTIONS = new Set([
  "created",
  "updated",
  "listed",
  "cleared",
  "empty",
  "error",
]);

export function isTaskPlanContextItem(
  item: Pick<ContextItem, "name" | "content" | "description">,
): boolean {
  if (item.content?.includes(TASK_EXECUTION_PLAN_MARKER)) {
    return true;
  }
  if (item.content?.includes(PLAN_CLEARED_TEXT)) {
    return true;
  }
  return item.name === "Plan" && PLAN_OUTPUT_DESCRIPTIONS.has(item.description);
}

export function isVisibleTaskPlanPeekItem(
  item: Pick<ContextItem, "name" | "content" | "description">,
): boolean {
  if (!isTaskPlanContextItem(item)) {
    return true;
  }
  // Keep parse/tool errors in the stream; the durable plan lives above the input.
  return item.description === "error";
}

export function taskPlanFingerprint(plan: TaskPlan): string {
  return `${plan.title}|${plan.steps.map((step) => `${step.id}:${step.status}`).join(",")}`;
}

function contentOf(item: ChatHistoryItem): string {
  const message = item.message;
  if (message.role === "tool" && typeof message.content === "string") {
    return message.content;
  }
  return "";
}

function isClearedPlanContent(
  item: Pick<ContextItem, "name" | "content" | "description">,
): boolean {
  if (item.description === "cleared") {
    return true;
  }
  return Boolean(item.content?.includes(PLAN_CLEARED_TEXT));
}

export interface TaskPlanSnapshot {
  plan: TaskPlan;
  historyIndex: number;
}

/** Latest session plan from builtin_plan tool output, or undefined when cleared/absent. */
export function collectLatestTaskPlanSnapshot(
  history: ChatHistoryItem[],
): TaskPlanSnapshot | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    for (const ctx of item.contextItems ?? []) {
      if (!isTaskPlanContextItem(ctx)) {
        continue;
      }
      if (isClearedPlanContent(ctx)) {
        return undefined;
      }
      const parsed = parsePlanText(ctx.content);
      if (parsed) {
        return { plan: parsed, historyIndex: i };
      }
    }
    const content = contentOf(item);
    if (content.includes(PLAN_CLEARED_TEXT)) {
      return undefined;
    }
    const parsed = parsePlanText(content);
    if (parsed) {
      return { plan: parsed, historyIndex: i };
    }
  }
  return undefined;
}

export function collectLatestTaskPlan(
  history: ChatHistoryItem[],
): TaskPlan | undefined {
  return collectLatestTaskPlanSnapshot(history)?.plan;
}

export function isTaskPlanUpdating(history: ChatHistoryItem[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const states = getHistoryToolStates(history[i]);
    for (let j = states.length - 1; j >= 0; j--) {
      const state = states[j];
      if (state.toolCall?.function?.name !== BuiltInToolNames.Plan) {
        continue;
      }
      return (
        state.status === "generating" ||
        state.status === "generated" ||
        state.status === "calling"
      );
    }
  }
  return false;
}
