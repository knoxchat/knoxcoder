import { describe, expect, it, vi } from "vitest";

import { HookExec, HookRunner } from "../hooks/hooks";

import { executeToolWithMiddleware } from "./middleware";

const tool: any = {
  type: "function",
  displayTitle: "t",
  function: { name: "builtin_read_file", parameters: { type: "object", required: ["filepath"], properties: { filepath: { type: "string" } } } },
};
const extras: any = { ide: { getWorkspaceDirs: async () => [] } };
const opts = { retry: false as const, timeout: false as const, circuitBreaker: false as const, logging: false };
const res = (stdout: string, code = 0, stderr = "") => ({ code, stdout, stderr, timedOut: false });

describe("middleware hooks (K-023)", () => {
  it("PreToolUse deny prevents execution", async () => {
    const exec: HookExec = async () => res("", 2, "not allowed");
    const run = vi.fn();
    await expect(
      executeToolWithMiddleware(run, tool, { filepath: "a" }, extras, { ...opts, hooks: new HookRunner({ PreToolUse: [{ command: "x" }] }, { exec }) }),
    ).rejects.toThrow(/not allowed/);
    expect(run).not.toHaveBeenCalled();
  });

  it("PreToolUse can modify args, PostToolUse injects context", async () => {
    const exec: HookExec = async (cmd) =>
      cmd === "pre" ? res('{"updatedArgs":{"filepath":"b.ts"}}') : res("remember to run tests");
    const run = vi.fn().mockResolvedValue([{ name: "n", description: "d", content: "ok" }]);
    const out = await executeToolWithMiddleware(run, tool, { filepath: "a.ts" }, extras, {
      ...opts,
      hooks: new HookRunner({ PreToolUse: [{ command: "pre" }], PostToolUse: [{ command: "post" }] }, { exec }),
    });
    expect(run.mock.calls[0][1]).toEqual({ filepath: "b.ts" });
    expect(out.at(-1)?.content).toBe("remember to run tests");
  });
});
