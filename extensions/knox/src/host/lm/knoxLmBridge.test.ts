import * as assert from "node:assert";

import {
  buildToolsCallRequest,
  chatChunkToLmParts,
  completionOptionsForLmRequest,
  contextItemsToToolResultText,
  KNOX_LM_ASSIST_ASSISTANT_ROLE,
  KNOX_LM_ASSIST_USER_ROLE,
  KNOX_LM_EXECUTE_TOOL_CALL_COMMAND,
  KNOX_LM_TOOL_MODE_AUTO,
  KNOX_LM_TOOL_MODE_REQUIRED,
  KNOX_LM_TOOLS_CALL_MESSAGE,
  KNOX_LM_VENDOR,
  lmMessagesToChatMessages,
  parseLmAssistTools,
  parseLmToolInput,
  toolsCallInvocation,
} from "./knoxLmBridge";

suite("KN-362 vscode.lm tools/call bridge", () => {
  test("vendor, command, and protocol message stay stable", () => {
    assert.strictEqual(KNOX_LM_VENDOR, "knox");
    assert.strictEqual(KNOX_LM_EXECUTE_TOOL_CALL_COMMAND, "knox.executeToolCall");
    assert.strictEqual(KNOX_LM_TOOLS_CALL_MESSAGE, "tools/call");
  });

  test("LM invoke builds a Core tools/call payload", () => {
    const request = buildToolsCallRequest({
      toolName: "builtin_read_file",
      input: { filepath: "src/a.ts" },
      selectedModelTitle: "Mock",
      callId: "lm-read-1",
    });
    assert.deepStrictEqual(toolsCallInvocation(request), {
      messageType: "tools/call",
      command: "knox.executeToolCall",
      data: {
        toolCall: {
          id: "lm-read-1",
          type: "function",
          function: {
            name: "builtin_read_file",
            arguments: JSON.stringify({ filepath: "src/a.ts" }),
          },
        },
        selectedModelTitle: "Mock",
      },
    });
  });

  test("non-object LM input becomes empty arguments", () => {
    assert.deepStrictEqual(parseLmToolInput(undefined), {});
    assert.deepStrictEqual(parseLmToolInput("x"), {});
    assert.deepStrictEqual(parseLmToolInput(["a"]), {});
    const request = buildToolsCallRequest({
      toolName: "builtin_glob",
      input: undefined,
      selectedModelTitle: "default",
    });
    assert.strictEqual(request.toolCall.function.arguments, "{}");
    assert.strictEqual(request.toolCall.id, "lm-builtin_glob");
  });

  test("context items flatten to a tool result string", () => {
    assert.strictEqual(contextItemsToToolResultText(undefined), "");
    assert.strictEqual(
      contextItemsToToolResultText([
        { name: "a.ts", content: "const x = 1;" },
        { name: "", content: "ok" },
      ]),
      "a.ts\nconst x = 1;\n\nok",
    );
  });

  test("assist messages map user text, assistant tool calls, and tool results", () => {
    const messages = lmMessagesToChatMessages([
      {
        role: KNOX_LM_ASSIST_USER_ROLE,
        parts: [{ kind: "text", value: "read a.ts" }],
      },
      {
        role: KNOX_LM_ASSIST_ASSISTANT_ROLE,
        parts: [
          { kind: "text", value: "ok" },
          {
            kind: "toolCall",
            callId: "c1",
            name: "builtin_read_file",
            input: { filepath: "a.ts" },
          },
        ],
      },
      {
        role: KNOX_LM_ASSIST_USER_ROLE,
        parts: [{ kind: "toolResult", callId: "c1", content: "export const x = 1;" }],
      },
    ]);
    assert.deepStrictEqual(messages, [
      { role: "user", content: "read a.ts" },
      {
        role: "assistant",
        content: "ok",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            index: 0,
            function: {
              name: "builtin_read_file",
              arguments: JSON.stringify({ filepath: "a.ts" }),
            },
          },
        ],
      },
      { role: "tool", toolCallId: "c1", content: "export const x = 1;" },
    ]);
  });

  test("stream chunks become LM text and tool-call parts", () => {
    assert.deepStrictEqual(
      chatChunkToLmParts({ role: "assistant", content: "hi" }),
      [{ kind: "text", value: "hi" }],
    );
    assert.deepStrictEqual(
      chatChunkToLmParts({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "c2",
            function: {
              name: "builtin_glob",
              arguments: JSON.stringify({ pattern: "*.ts" }),
            },
          },
        ],
      }),
      [
        {
          kind: "toolCall",
          callId: "c2",
          name: "builtin_glob",
          input: { pattern: "*.ts" },
        },
      ],
    );
    assert.deepStrictEqual(chatChunkToLmParts({ role: "thinking", content: "..." }), []);
  });

  test("request tools become Core completion tools and Required pins the first", () => {
    const tools = parseLmAssistTools([
      {
        name: "builtin_read_file",
        description: "Read a file",
        inputSchema: { type: "object" },
      },
      { name: "" },
      "skip",
    ]);
    assert.deepStrictEqual(tools, [
      {
        name: "builtin_read_file",
        description: "Read a file",
        inputSchema: { type: "object" },
      },
    ]);
    const auto = completionOptionsForLmRequest({
      tools,
      toolMode: KNOX_LM_TOOL_MODE_AUTO,
    });
    assert.strictEqual(auto.tools?.[0]?.function.name, "builtin_read_file");
    assert.strictEqual(auto.toolChoice, undefined);
    const required = completionOptionsForLmRequest({
      tools: [{ name: "builtin_glob", description: "Glob" }],
      toolMode: KNOX_LM_TOOL_MODE_REQUIRED,
    });
    assert.deepStrictEqual(required.toolChoice, {
      type: "function",
      function: { name: "builtin_glob" },
    });
    assert.deepStrictEqual(completionOptionsForLmRequest({}), {});
  });
});
