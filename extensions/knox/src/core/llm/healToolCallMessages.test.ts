import { describe, expect, it } from "vitest";

import { ChatMessage } from "../index.js";
import {
  healToolCallMessages,
  MISSING_TOOL_RESULT,
  shiftChatHistoryMessage,
} from "./healToolCallMessages";

function assistantWithCalls(
  ids: string[],
  content = "working",
): ChatMessage {
  return {
    role: "assistant",
    content,
    toolCalls: ids.map((id, index) => ({
      id,
      type: "function",
      index,
      function: { name: "builtin_read_file", arguments: "{}" },
    })),
  };
}

describe("healToolCallMessages", () => {
  it("inserts missing tool results so every tool_call_id is answered", () => {
    const healed = healToolCallMessages([
      { role: "user", content: "read it" },
      assistantWithCalls(["c1", "c2"]),
      { role: "tool", toolCallId: "c1", content: "file body" },
    ]);
    const tools = healed.filter((m) => m.role === "tool");
    expect(tools.map((m) => (m.role === "tool" ? m.toolCallId : ""))).toEqual([
      "c1",
      "c2",
    ]);
    expect(tools[1] && "content" in tools[1] ? tools[1].content : "").toBe(
      MISSING_TOOL_RESULT,
    );
  });

  it("rewrites orphan tool rows so they are not sent without a parent call", () => {
    const healed = healToolCallMessages([
      { role: "user", content: "hi" },
      { role: "tool", toolCallId: "orphan", content: "error: copy_to_user" },
    ]);
    expect(healed.some((m) => m.role === "tool")).toBe(false);
    expect(JSON.stringify(healed)).toContain("copy_to_user");
  });

  it("assigns ids when the model omitted them", () => {
    const healed = healToolCallMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            type: "function",
            function: { name: "builtin_glob", arguments: "{}" },
          },
        ],
      },
    ]);
    const assistant = healed.find((m) => m.role === "assistant");
    const id =
      assistant && "toolCalls" in assistant
        ? assistant.toolCalls?.[0]?.id
        : undefined;
    expect(id).toMatch(/^call_heal_/);
    expect(healed.some((m) => m.role === "tool" && m.toolCallId === id)).toBe(
      true,
    );
  });

  it("reuses a following tool result id when the assistant omitted ids", () => {
    const healed = healToolCallMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            type: "function",
            function: { name: "builtin_glob", arguments: "{}" },
          },
        ],
      },
      { role: "tool", toolCallId: "stored-id", content: "Cargo.toml" },
    ]);
    const assistant = healed.find((m) => m.role === "assistant");
    const id =
      assistant && "toolCalls" in assistant
        ? assistant.toolCalls?.[0]?.id
        : undefined;
    expect(id).toBe("stored-id");
    const tool = healed.find((m) => m.role === "tool");
    expect(tool && "toolCallId" in tool ? tool.toolCallId : "").toBe("stored-id");
    expect(tool && "content" in tool ? tool.content : "").toBe("Cargo.toml");
  });
});

describe("shiftChatHistoryMessage", () => {
  it("drops an assistant tool-call together with its results", () => {
    const history: ChatMessage[] = [
      assistantWithCalls(["c1"]),
      { role: "tool", toolCallId: "c1", content: "ok" },
      { role: "user", content: "next" },
    ];
    const removed = shiftChatHistoryMessage(history);
    expect(removed.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(history.map((m) => m.role)).toEqual(["user"]);
  });
});
