import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { LIVE_EVAL_CATALOG, SYSTEMS_EVAL_CATALOG, runAgentEval } from "./harness";
import { LIVE_TASKS } from "./liveTasks";

function autoloadTask(id: string) {
  const task = LIVE_TASKS.find((entry) => entry.id === id);
  if (!task) {
    throw new Error(`missing live task ${id}`);
  }
  return task;
}

describe("K-100 live tasks scripted autoload", () => {
  it.each(["node-autoload-blame", "mini-c-autoload-blame", "mini-rust-autoload-blame"] as const)(
    "%s autoloads git_blame on the chat-turn path",
    async (id) => {
      const task = autoloadTask(id);
      const result = await runAgentEval({
        prompt: task.prompt,
        workspace: task.workspace,
        catalog: id === "node-autoload-blame" ? LIVE_EVAL_CATALOG : SYSTEMS_EVAL_CATALOG,
        viaChatTurn: true,
        deferTools: true,
        ideHooks: task.ideHooks,
        evaluateCommand: task.evaluateCommand,
        script: [
          {
            toolCalls: [
              {
                name: BuiltInToolNames.GitBlame,
                args: { filepath: id.startsWith("mini-c") ? "add.c" : id.startsWith("mini-rust") ? "src/lib.rs" : "src/add.ts" },
              },
            ],
          },
          {
            toolCalls: [
              {
                name: BuiltInToolNames.EditFile,
                args: id.startsWith("mini-c")
                  ? { filepath: "add.c", old_string: "return a - b;", new_string: "return a + b;" }
                  : id.startsWith("mini-rust")
                    ? { filepath: "src/lib.rs", old_string: "a - b", new_string: "a + b" }
                    : { filepath: "src/add.ts", old_string: "return a - b;", new_string: "return a + b;" },
              },
            ],
          },
          ...(task.evaluateCommand
            ? [
                {
                  toolCalls: [
                    {
                      name: BuiltInToolNames.RunTerminalCommand,
                      args: { command: id.startsWith("mini-rust") ? "cargo test" : "make test" },
                    },
                  ],
                },
              ]
            : []),
          { content: "fixed." },
        ],
      });
      expect(result.toolTrace[0]?.name).toBe(BuiltInToolNames.GitBlame);
      expect(result.toolTrace[0]?.ok).toBe(true);
      expect(task.check(result).pass).toBe(true);
    },
  );
});
