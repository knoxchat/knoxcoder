import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IDE, Tool } from "..";
import type { SoulEvent } from "../context/soul/types";

const recorded: SoulEvent[] = [];

vi.mock("../context/soul/recordSoulEvent.js", () => ({
  recordSoulEvent: vi.fn(async (event: SoulEvent) => {
    recorded.push(event);
    return 1;
  }),
}));

import { executeToolWithSoulHooks } from "./mutatingToolHooks";

const editTool = { function: { name: "builtin_edit_file" } } as Tool;

function ide(verify: () => Promise<unknown[]>): IDE {
  return {
    ensureTurnCheckpoint: vi.fn(async () => "cp-1"),
    runPreRiskyCheckpoint: vi.fn(async () => undefined),
    captureMutatingToolBefore: vi.fn(async () => "b1"),
    recordMutatingToolAfter: vi.fn(async () => undefined),
    runPostEditVerification: vi.fn(verify),
  } as unknown as IDE;
}

async function runEdit(verify: () => Promise<unknown[]>) {
  await executeToolWithSoulHooks({
    tool: editTool,
    toolName: "builtin_edit_file",
    rawArgs: { filepath: "src/a.ts", old_string: "x", new_string: "y" },
    ide: ide(verify),
    sessionId: "s1",
    turnId: "t1",
    execute: async () => [{ name: "edit", description: "ok", content: "updated" }],
  });
  return recorded[recorded.length - 1];
}

describe("soul events carry the structured oracle (MC-13)", () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  it("records a passing LSP oracle with the checkpoint id", async () => {
    const event = await runEdit(async () => [
      {
        name: "Auto-Verification Result",
        description: "",
        content: "Auto-verification: no diagnostics.",
      },
    ]);
    expect(event.kind).toBe("tool_success");
    expect(event.workspaceCheckpointId).toBe("cp-1");
    expect(event.oracle).toEqual({ kind: "lsp", passed: true });
  });

  it("records a failing oracle", async () => {
    const event = await runEdit(async () => [
      {
        name: "Auto-Verification Result",
        description: "",
        content:
          "Auto-verification: 1 diagnostic issue(s) detected but could not be auto-fixed: Line 1: bad",
      },
    ]);
    expect(event.oracle).toMatchObject({ kind: "lsp", passed: false });
  });

  it("leaves oracle undefined when verification produced nothing", async () => {
    const event = await runEdit(async () => []);
    expect(event.kind).toBe("tool_success");
    expect(event.oracle).toBeUndefined();
  });
});
