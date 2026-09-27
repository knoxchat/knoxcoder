import { describe, expect, it } from "vitest";
import type { ILLM, ToolExtras } from "..";

import { executeAutonomousStep } from "../context/memory/brain/AutonomousExecutor";
import { BuiltInToolNames } from "../tools/builtIn";
import { callTool } from "../tools/callTool";
import { editFileTool } from "../tools";
import {
  createEvalIde,
  createScriptedLlm,
  DEFAULT_EVAL_CATALOG,
  snapshotFiles,
} from "./harness";

const ADD_BUG = `export function add(a: number, b: number): number {
  return a - b;
}
`;

const ADD_FIXED = `export function add(a: number, b: number): number {
  return a + b;
}
`;

describe("HL-02 autonomous uses Agent tools", () => {
  it("/autonomous fix the add() test runs edit_file then terminal", async () => {
    const { ide, store } = createEvalIde({ "src/add.ts": ADD_BUG });
    const llm = createScriptedLlm([
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
      { content: "add() tests pass.\n[GOAL_COMPLETE]" },
    ]);

    const extras = {
      ide,
      llm: llm as unknown as ToolExtras["llm"],
      fetch: (async () => new Response()) as ToolExtras["fetch"],
      tool: editFileTool,
    };

    const step = await executeAutonomousStep(
      llm as unknown as ILLM,
      {
        iteration: 1,
        goal: "fix the add() test",
        memoryContext: "",
        maxIterations: 3,
        sessionId: "eval-autonomous",
        previousResults: [],
      },
      undefined,
      undefined,
      {
        catalog: DEFAULT_EVAL_CATALOG,
        extras,
        executeTool: async (tool, args) => {
          if (tool.function.name === BuiltInToolNames.RunTerminalCommand) {
            const src = snapshotFiles(store)["src/add.ts"] ?? "";
            const pass = /return a \+ b/.test(src) && !/return a - b/.test(src);
            return [
              {
                name: "Terminal",
                description: pass
                  ? "Terminal command exited 0"
                  : "Terminal command exited 1",
                content: pass
                  ? "Exit: 0\nPASS src/add.test.ts"
                  : "Exit: 1\nFAIL src/add.test.ts",
              },
            ];
          }
          return callTool(
            tool,
            args,
            { ...extras, tool },
            {
              retry: false,
              timeout: false,
              circuitBreaker: false,
              logging: false,
            },
          );
        },
      },
    );

    expect(snapshotFiles(store)["src/add.ts"]).toBe(ADD_FIXED);
    expect(step.result).toContain(BuiltInToolNames.EditFile);
    expect(step.result).toContain(BuiltInToolNames.RunTerminalCommand);
    expect(step.done).toBe(true);
    expect(step.result).toMatch(/GOAL_COMPLETE/i);
  });
});
