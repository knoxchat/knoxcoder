import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { canRunToolInParallel, isAwaitShellKill } from "./toolBatch";
import type { Tool } from "..";

const readTool = {
  function: { name: BuiltInToolNames.ReadFile },
  readonly: true,
} as Tool;

const editTool = {
  function: { name: BuiltInToolNames.EditFile },
  readonly: false,
} as Tool;

const awaitTool = {
  function: { name: BuiltInToolNames.AwaitShell },
  readonly: true,
} as Tool;

describe("toolBatch", () => {
  it("allows consecutive readonly tools and rejects writes", () => {
    expect(canRunToolInParallel(readTool, { filepath: "a.c" })).toBe(true);
    expect(canRunToolInParallel(editTool, { filepath: "a.c" })).toBe(false);
    expect(canRunToolInParallel(undefined, {})).toBe(false);
  });

  it("does not batch await_shell / pty_read kills", () => {
    expect(isAwaitShellKill(BuiltInToolNames.AwaitShell, { kill: true })).toBe(
      true,
    );
    expect(
      isAwaitShellKill(BuiltInToolNames.AwaitShell, '{"kill":true}'),
    ).toBe(true);
    expect(
      canRunToolInParallel(awaitTool, { job_id: "sh_1", kill: true }),
    ).toBe(false);
    expect(canRunToolInParallel(awaitTool, { job_id: "sh_1" })).toBe(true);
  });
});
