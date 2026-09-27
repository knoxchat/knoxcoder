import { describe, expect, it, vi } from "vitest";

import type { ContextItem, IDE, Tool } from "..";

import { executeToolWithSoulHooks } from "./mutatingToolHooks";

function mockIde(overrides: Partial<IDE> = {}): IDE {
  return {
    ensureTurnCheckpoint: vi.fn(async () => "cp-turn-1"),
    runPreRiskyCheckpoint: vi.fn(async () => undefined),
    captureMutatingToolBefore: vi.fn(async () => "before-1"),
    recordMutatingToolAfter: vi.fn(async () => undefined),
    runPostEditVerification: vi.fn(async () => []),
    ...overrides,
  } as unknown as IDE;
}

const editTool = {
  function: { name: "builtin_edit_file" },
} as Tool;

describe("executeToolWithSoulHooks", () => {
  it("creates a turn checkpoint and undo snapshots for mutating tools", async () => {
    const ide = mockIde();
    const items: ContextItem[] = [
      { name: "edit", description: "ok", content: "updated" },
    ];
    const result = await executeToolWithSoulHooks({
      tool: editTool,
      toolName: "builtin_edit_file",
      rawArgs: { filepath: "src/a.ts", old_string: "x", new_string: "y" },
      ide,
      sessionId: "sess-1",
      turnId: "turn-1",
      execute: async () => items,
    });

    expect(result[0]).toEqual(items[0]);
    expect(result.some((item) => item.content.includes("checkpoint=cp-turn-1"))).toBe(
      true,
    );
    expect(ide.ensureTurnCheckpoint).toHaveBeenCalledWith({
      sessionId: "sess-1",
      turnId: "turn-1",
      toolName: "builtin_edit_file",
    });
    expect(ide.captureMutatingToolBefore).toHaveBeenCalled();
    expect(ide.recordMutatingToolAfter).toHaveBeenCalledWith(
      expect.objectContaining({ beforeId: "before-1", commit: true }),
    );
  });

  it("creates a turn checkpoint for git commit without post-edit verify", async () => {
    const ide = mockIde();
    await executeToolWithSoulHooks({
      tool: { function: { name: "builtin_git_commit" } } as Tool,
      toolName: "builtin_git_commit",
      rawArgs: { message: "wip" },
      ide,
      sessionId: "sess-1",
      turnId: "turn-1",
      execute: async () => [
        { name: "git", description: "ok", content: "committed" },
      ],
    });
    expect(ide.ensureTurnCheckpoint).toHaveBeenCalled();
    expect(ide.runPostEditVerification).not.toHaveBeenCalled();
  });

  it("creates a turn checkpoint for shell without post-edit verify", async () => {
    const ide = mockIde();
    await executeToolWithSoulHooks({
      tool: { function: { name: "builtin_run_terminal_command" } } as Tool,
      toolName: "builtin_run_terminal_command",
      rawArgs: { command: "echo hi" },
      ide,
      sessionId: "sess-1",
      turnId: "turn-1",
      execute: async () => [
        { name: "terminal", description: "ok", content: "hi" },
      ],
    });
    expect(ide.ensureTurnCheckpoint).toHaveBeenCalled();
    expect(ide.runPostEditVerification).not.toHaveBeenCalled();
  });

  it("appends compile-oracle output after an edit when buildVerify is set", async () => {
    const ide = mockIde();
    const run = vi.fn(async () => [
      {
        name: "Build",
        description: "exited 1",
        content:
          "Exit: 1\nsrc/foo.c:2:3: error: implicit declaration of function 'bar'\n",
      },
    ]);
    const result = await executeToolWithSoulHooks({
      tool: editTool,
      toolName: "builtin_edit_file",
      rawArgs: { filepath: "src/foo.c", old_string: "a", new_string: "b" },
      ide,
      sessionId: "sess-build",
      turnId: "turn-1",
      buildVerify: { command: "make", maxIterations: 8, run },
      execute: async () => [
        { name: "edit", description: "ok", content: "updated" },
      ],
    });
    expect(run).toHaveBeenCalledWith("make");
    expect(ide.runPostEditVerification).not.toHaveBeenCalled();
    expect(result.some((item) => item.name === "Build diagnostics")).toBe(true);
    expect(result.map((item) => item.content).join("\n")).toContain("src/foo.c:2:3");
  });

  it("discards the before snapshot when execute throws", async () => {
    const ide = mockIde();
    await expect(
      executeToolWithSoulHooks({
        tool: editTool,
        toolName: "builtin_edit_file",
        rawArgs: { filepath: "src/a.ts" },
        ide,
        sessionId: "sess-1",
        turnId: "turn-1",
        execute: async () => {
          throw new Error("no match");
        },
      }),
    ).rejects.toThrow("no match");

    expect(ide.recordMutatingToolAfter).toHaveBeenCalledWith(
      expect.objectContaining({ commit: false }),
    );
  });

  it("skips LSP verify for a .c edit and tells the model to use builtin_build", async () => {
    const ide = mockIde();
    const result = await executeToolWithSoulHooks({
      tool: editTool,
      toolName: "builtin_edit_file",
      rawArgs: { filepath: "mm/foo.c", old_string: "a", new_string: "b" },
      ide,
      sessionId: "sess-c",
      turnId: "turn-1",
      execute: async () => [
        { name: "edit", description: "ok", content: "updated" },
      ],
    });
    expect(ide.runPostEditVerification).not.toHaveBeenCalled();
    expect(result.map((item) => item.content).join("\n")).toContain(
      "builtin_build",
    );
  });

  it("skips LSP for .rs without rust-analyzer and points at cargo check", async () => {
    const ide = mockIde();
    const result = await executeToolWithSoulHooks({
      tool: editTool,
      toolName: "builtin_edit_file",
      rawArgs: { filepath: "src/lib.rs", old_string: "a", new_string: "b" },
      ide,
      sessionId: "sess-rs",
      turnId: "turn-1",
      execute: async () => [
        { name: "edit", description: "ok", content: "updated" },
      ],
    });
    expect(ide.runPostEditVerification).not.toHaveBeenCalled();
    expect(result.map((item) => item.content).join("\n")).toMatch(
      /rust-analyzer/,
    );
    expect(result.map((item) => item.content).join("\n")).toContain(
      "builtin_build",
    );
  });
});
