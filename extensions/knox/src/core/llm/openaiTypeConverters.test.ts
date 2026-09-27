import { describe, expect, it } from "vitest";

import {
  fromChatCompletionChunk,
  fromChatResponse,
} from "./openaiTypeConverters";

describe("fromChatCompletionChunk", () => {
  it("keeps tool_calls when the same delta also has content", () => {
    const msg = fromChatCompletionChunk({
      id: "c",
      object: "chat.completion.chunk",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          delta: {
            content: "Let me run that.",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: {
                  name: "builtin_run_terminal_command",
                  arguments: '{"command":"ls"}',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    } as any);

    expect(msg?.role).toBe("assistant");
    expect(msg?.content).toBe("Let me run that.");
    expect(msg && "toolCalls" in msg ? msg.toolCalls : undefined).toHaveLength(1);
    expect(
      msg && "toolCalls" in msg ? msg.toolCalls?.[0]?.function?.name : undefined,
    ).toBe("builtin_run_terminal_command");
  });

  it("keeps tool_calls when reasoning is also present", () => {
    const msg = fromChatCompletionChunk({
      id: "c",
      object: "chat.completion.chunk",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          delta: {
            content: "",
            reasoning: "need the build errors",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "builtin_glob", arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    } as any);

    expect((msg as any)?.reasoning).toBe("need the build errors");
    expect(
      msg && "toolCalls" in msg ? msg.toolCalls?.[0]?.function?.name : undefined,
    ).toBe("builtin_glob");
  });
});

describe("fromChatResponse", () => {
  it("preserves assistant text together with tool calls", () => {
    const msg = fromChatResponse({
      id: "r",
      object: "chat.completion",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Working.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "builtin_read_file", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    } as any);

    expect(msg.content).toBe("Working.");
    expect("toolCalls" in msg ? msg.toolCalls : undefined).toHaveLength(1);
  });
});
