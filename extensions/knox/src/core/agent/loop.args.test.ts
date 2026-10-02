import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Tool, ToolExtras } from "..";

import { BuiltInToolNames } from "../tools/builtIn";
import { ToolCallErrorCode } from "../tools/errors";
import { parseToolArgsChecked, runAgentLoop } from "./loop";

describe("parseToolArgsChecked", () => {
  it("passes valid JSON and empty input through", () => {
    expect(parseToolArgsChecked('{"a":1}', "t")).toEqual({ args: { a: 1 } });
    expect(parseToolArgsChecked("", "t")).toEqual({ args: {} });
    expect(parseToolArgsChecked(undefined, "t")).toEqual({ args: {} });
  });

  it("repairs recoverable malformed JSON", () => {
    expect(parseToolArgsChecked("{'filepath': 'a.ts',}", "t").args).toEqual({ filepath: "a.ts" });
    expect(parseToolArgsChecked('```json\n{"x": 2}\n```', "t").args).toEqual({ x: 2 });
  });

  it("reports InvalidJson instead of silently returning {}", () => {
    const { args, error } = parseToolArgsChecked("not json at all", "builtin_edit_file");
    expect(args).toEqual({});
    expect(error?.code).toBe(ToolCallErrorCode.ARGUMENT_PARSE_ERROR);
    expect(error?.context.category).toBe("InvalidJson");
  });
});

describe("runAgentLoop with unrecoverable arguments", () => {
  it("does not execute the tool and tells the model the JSON was invalid", async () => {
    const tool = { function: { name: BuiltInToolNames.ReadFile }, readonly: true } as Tool;
    let turn = 0;
    const seen: ChatMessage[][] = [];
    const extras = {
      llm: {
        streamChat: async function* (messages: ChatMessage[]) {
          seen.push([...messages]);
          if (turn++ === 0) {
            yield {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: BuiltInToolNames.ReadFile, arguments: "<<garbage>>" },
                },
              ],
            } as ChatMessage;
          } else {
            yield { role: "assistant", content: "done" } as ChatMessage;
          }
        },
      } as unknown as ToolExtras["llm"],
    };
    const executeTool = vi.fn();
    const result = await runAgentLoop({
      extras,
      messages: [{ role: "user", content: "read" }],
      tools: [tool],
      compact: false,
      executeTool,
    });
    expect(executeTool).not.toHaveBeenCalled();
    const toolMsg = seen[1].find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg?.content)).toMatch(/ARGUMENT_PARSE_ERROR/);
    expect(JSON.stringify(toolMsg?.content)).toMatch(/not a valid JSON object/);
    expect(result.stoppedReason).toBe("completed");
  });
});

describe("parseToolArgsChecked truncation", () => {
  it("flags a repaired call that lost a required param as cut off", () => {
    const tool = {
      function: { name: "builtin_write_file", parameters: { type: "object", required: ["filepath", "contents"], properties: {} } },
    } as unknown as Tool;
    const { error } = parseToolArgsChecked('{"contents": "abc"', "builtin_write_file", tool);
    expect(error?.code).toBe(ToolCallErrorCode.ARGUMENT_PARSE_ERROR);
    expect(error?.context.truncated).toBe(true);
  });
});
