import { describe, expect, it } from "vitest";
import type { Tool } from "..";

import { BuiltInToolNames } from "../tools/builtIn";
import {
  filterPlanModeTools,
  PLAN_MODE_LEAVE_MESSAGE,
  planModeDenyReason,
  taskWouldWrite,
} from "./planMode";

const edit = {
  function: { name: BuiltInToolNames.EditFile },
  readonly: false,
} as Tool;
const read = {
  function: { name: BuiltInToolNames.ReadFile },
  readonly: true,
} as Tool;
const plan = {
  function: { name: BuiltInToolNames.Plan },
  readonly: false,
} as Tool;
const task = {
  function: { name: BuiltInToolNames.Task },
  readonly: false,
} as Tool;
const shell = {
  function: { name: BuiltInToolNames.RunTerminalCommand },
  readonly: false,
} as Tool;

describe("plan mode catalog", () => {
  it("keeps read-only tools plus plan/ask/task", () => {
    const filtered = filterPlanModeTools([edit, read, plan, task, shell]);
    expect(filtered.map((t) => t.function.name)).toEqual([
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.Plan,
      BuiltInToolNames.Task,
    ]);
  });

  it("denies writes and shell", () => {
    expect(planModeDenyReason(edit, {})).toBe(PLAN_MODE_LEAVE_MESSAGE);
    expect(planModeDenyReason(shell, { command: "make" })).toBe(
      PLAN_MODE_LEAVE_MESSAGE,
    );
    expect(planModeDenyReason(read, {})).toBeUndefined();
    expect(planModeDenyReason(plan, { action: "create" })).toBeUndefined();
  });

  it("denies general/isolate task children", () => {
    expect(taskWouldWrite({ profile: "explore" })).toBe(false);
    expect(taskWouldWrite({ profile: "general" })).toBe(true);
    expect(taskWouldWrite({ isolate: true })).toBe(true);
    expect(planModeDenyReason(task, { profile: "general" })).toBe(
      PLAN_MODE_LEAVE_MESSAGE,
    );
  });
});
