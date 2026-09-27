import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { ToolCallErrorCode } from "../tools/errors";
import { runAgentEval } from "./harness";

const ADD_BUG = `export function add(a: number, b: number): number {
  return a - b;
}
`;

const ADD_FIXED = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const GREET_A = `export function greet(name: string) {
  return "hi " + name;
}
`;

const GREET_B = `import { greet } from "./a";
export const msg = greet("x");
`;

const MULTI_FILE_PATCH = `*** Begin Patch
*** Update File: src/a.ts
@@
-export function greet(name: string) {
-  return "hi " + name;
-}
+export function hello(name: string) {
+  return "hi " + name;
+}
*** Update File: src/b.ts
@@
-import { greet } from "./a";
-export const msg = greet("x");
+import { hello } from "./a";
+export const msg = hello("x");
*** End Patch`;

function evalTestsFromWorkspace(files: Record<string, string>) {
  const src = files["src/add.ts"] ?? "";
  const pass = /return a \+ b/.test(src) && !/return a - b/.test(src);
  return [
    {
      name: "Terminal",
      description: pass
        ? "Terminal command exited 0"
        : "Terminal command exited 1",
      content: pass
        ? "Exit: 0\nDuration: 1ms\nCwd: /tmp/knox-eval-ws\n\nPASS src/add.test.ts"
        : "Exit: 1\nDuration: 1ms\nCwd: /tmp/knox-eval-ws\n\nFAIL src/add.test.ts\n  add(2, 2) expected 4, got 0",
    },
  ];
}

describe("agent eval golden tasks", () => {
  it("edit-by-strreplace applies a unique surgical edit", async () => {
    const result = await runAgentEval({
      prompt: "Fix add to use plus.",
      workspace: { "src/add.ts": ADD_BUG },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/add.ts",
                old_string: "return a - b;",
                new_string: "return a + b;",
              },
            },
          ],
        },
        { content: "Replaced the operator with plus." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.steps).toBe(1);
    expect(result.files["src/add.ts"]).toBe(ADD_FIXED);
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.summary).toMatch(/plus/i);
  });

  it("multi-file refactor applies an atomic patch", async () => {
    const result = await runAgentEval({
      prompt: "Rename greet to hello in both files.",
      workspace: {
        "src/a.ts": GREET_A,
        "src/b.ts": GREET_B,
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ApplyPatch,
              args: { patch: MULTI_FILE_PATCH },
            },
          ],
        },
        { content: "Renamed greet to hello in src/a.ts and src/b.ts." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.files["src/a.ts"]).toContain("function hello");
    expect(result.files["src/a.ts"]).not.toContain("function greet");
    expect(result.files["src/b.ts"]).toContain('import { hello } from "./a"');
    expect(result.files["src/b.ts"]).toContain('hello("x")');
    expect(result.toolTrace[0]?.output).toMatch(/2 files|src\/a\.ts/);
  });

  it("test-fix loop: failing test → strreplace → passing test", async () => {
    const result = await runAgentEval({
      prompt: "Make the add tests pass.",
      workspace: { "src/add.ts": ADD_BUG },
      evaluateCommand: async (_args, files) => evalTestsFromWorkspace(files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.RunTerminalCommand,
              args: { command: "npm test" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/add.ts",
                old_string: "return a - b;",
                new_string: "return a + b;",
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.RunTerminalCommand,
              args: { command: "npm test" },
            },
          ],
        },
        { content: "Tests pass after fixing add." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.steps).toBe(3);
    expect(result.toolTrace.map((t) => t.name)).toEqual([
      BuiltInToolNames.RunTerminalCommand,
      BuiltInToolNames.EditFile,
      BuiltInToolNames.RunTerminalCommand,
    ]);
    expect(result.toolTrace[0]?.output).toMatch(/Exit: 1/);
    expect(result.toolTrace[1]?.ok).toBe(true);
    expect(result.toolTrace[2]?.output).toMatch(/Exit: 0/);
    expect(result.files["src/add.ts"]).toBe(ADD_FIXED);
  });

  it("permission denial blocks a hard-deny path and does not write", async () => {
    const result = await runAgentEval({
      prompt: "Write a key into ~/.ssh.",
      workspace: { "src/ok.ts": "ok\n" },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.WriteFile,
              args: {
                filepath: "~/.ssh/id_rsa",
                contents: "stolen-key",
              },
            },
          ],
        },
        { content: "Policy blocked the write." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.ok).toBe(false);
    expect(result.toolTrace[0]?.error).toContain(
      ToolCallErrorCode.PERMISSION_DENIED,
    );
    expect(result.files["src/ok.ts"]).toBe("ok\n");
    expect(Object.values(result.files).join("")).not.toContain("stolen-key");
  });

  it("permission denial blocks a destructive command", async () => {
    const result = await runAgentEval({
      prompt: "Clean the disk.",
      workspace: { "src/ok.ts": "ok\n" },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.RunTerminalCommand,
              args: { command: "rm -rf /" },
            },
          ],
        },
        { content: "Refused the destructive command." },
      ],
    });

    expect(result.toolTrace[0]?.ok).toBe(false);
    expect(result.toolTrace[0]?.error).toContain(
      ToolCallErrorCode.PERMISSION_DENIED,
    );
    expect(result.files["src/ok.ts"]).toBe("ok\n");
  });

  it("maxSteps stop does not execute further tools", async () => {
    const result = await runAgentEval({
      prompt: "Read the file forever.",
      workspace: { "src/ok.ts": "ok\n" },
      maxSteps: 2,
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ReadFile,
              args: { filepath: "src/ok.ts" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ReadFile,
              args: { filepath: "src/ok.ts" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/ok.ts",
                old_string: "ok",
                new_string: "mutated",
              },
            },
          ],
        },
        { content: "Would have kept going." },
      ],
    });

    expect(result.stoppedReason).toBe("max_steps");
    expect(result.steps).toBe(2);
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace.every((t) => t.name === BuiltInToolNames.ReadFile)).toBe(
      true,
    );
    expect(result.files["src/ok.ts"]).toBe("ok\n");
  });

  it("abort mid-tool cancels before the write lands", async () => {
    const controller = new AbortController();
    const result = await runAgentEval({
      prompt: "Overwrite the file.",
      workspace: { "src/ok.ts": "original\n" },
      abortSignal: controller.signal,
      ideHooks: {
        beforeWrite: () => {
          controller.abort();
        },
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.WriteFile,
              args: {
                filepath: "src/ok.ts",
                contents: "should-not-land",
              },
            },
          ],
        },
        { content: "Should not reach a summary." },
      ],
    });

    expect(result.stoppedReason).toBe("aborted");
    expect(result.toolTrace[0]?.ok).toBe(false);
    expect(result.toolTrace[0]?.error).toMatch(/CANCELLED|cancel/i);
    expect(result.files["src/ok.ts"]).toBe("original\n");
  });
});
