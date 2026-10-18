/**
 * User-facing Plan mode (P2.1): read-only explore + builtin_plan until Execute.
 * Not a fourth permission; Ask/Edits/Auto still apply when the user executes.
 */

import type { Tool } from "..";
import { BuiltInToolNames } from "../tools/builtIn";

export const PLAN_MODE_LEAVE_MESSAGE = "leave Plan mode to execute";

const PLAN_MODE_EXTRA = new Set<string>([
  BuiltInToolNames.Plan,
  BuiltInToolNames.AskUser,
  BuiltInToolNames.Task,
  BuiltInToolNames.ToolSearch,
]);

function argRecord(args?: Record<string, unknown>): Record<string, unknown> {
  return args && typeof args === "object" ? args : {};
}

function childWouldWrite(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const child = raw as Record<string, unknown>;
  if (child.isolate === true) {
    return true;
  }
  return String(child.profile ?? "") === "general";
}

/** general / isolate children write; explore and review stay read-only. */
export function taskWouldWrite(args?: Record<string, unknown>): boolean {
  const rec = argRecord(args);
  if (rec.isolate === true) {
    return true;
  }
  if (String(rec.profile ?? "explore") === "general") {
    return true;
  }
  const children = Array.isArray(rec.children) ? rec.children : [];
  return children.some(childWouldWrite);
}

export function isPlanModeCatalogTool(tool: Tool): boolean {
  const name = tool.function.name;
  return tool.readonly === true || PLAN_MODE_EXTRA.has(name);
}

export function filterPlanModeTools(tools: Tool[]): Tool[] {
  return tools.filter(isPlanModeCatalogTool);
}

export function planModeDenyReason(
  tool: Tool,
  args?: Record<string, unknown>,
): string | undefined {
  if (!isPlanModeCatalogTool(tool)) {
    return PLAN_MODE_LEAVE_MESSAGE;
  }
  if (tool.function.name === BuiltInToolNames.Task && taskWouldWrite(args)) {
    return PLAN_MODE_LEAVE_MESSAGE;
  }
  return undefined;
}
