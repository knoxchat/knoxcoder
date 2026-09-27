import * as assert from "node:assert";

import {
  assertKnoxApiVersion,
  KNOX_API_EVENTS,
  KNOX_API_METHODS,
  KNOX_API_VERSION,
  KNOX_EXECUTE_TOOL_CALL_COMMAND,
  KNOX_EXTENSION_ID,
  KNOX_FOCUS_INPUT_WITHOUT_CLEAR_MESSAGE,
  KNOX_NEW_SESSION_COMMAND,
  KNOX_OPEN_CHAT_COMMAND,
  KNOX_SEND_USER_INPUT_MESSAGE,
  KNOX_TOGGLE_AGENT_MODE_COMMAND,
  planOpenChat,
  toCoreToolCall,
  toPublicContextItems,
  wrapCustomContextProvider,
} from "./knoxPublicApi";

suite("KN-364 public KnoxAPI (getAPI(1))", () => {
  test("version, extension id, and command ids stay Git-style stable", () => {
    assert.strictEqual(KNOX_API_VERSION, 1);
    assert.strictEqual(KNOX_EXTENSION_ID, "vscode.knox");
    assert.strictEqual(KNOX_OPEN_CHAT_COMMAND, "knox.openChat");
    assert.strictEqual(KNOX_NEW_SESSION_COMMAND, "knox.newSession");
    assert.strictEqual(KNOX_TOGGLE_AGENT_MODE_COMMAND, "knox.toggleAgentMode");
    assert.strictEqual(KNOX_EXECUTE_TOOL_CALL_COMMAND, "knox.executeToolCall");
    assert.strictEqual(KNOX_SEND_USER_INPUT_MESSAGE, "userInput");
    assert.strictEqual(
      KNOX_FOCUS_INPUT_WITHOUT_CLEAR_MESSAGE,
      "focusKnoxInputWithoutClear",
    );
    assertKnoxApiVersion(1);
    assert.throws(() => assertKnoxApiVersion(2), /No Knox API version 2 found/);
    assert.throws(() => assertKnoxApiVersion(0), /No Knox API version 0 found/);
  });

  test("exported method and event names match knox.d.ts", () => {
    assert.deepStrictEqual([...KNOX_API_METHODS], [
      "isAgentModeActive",
      "toggleAgentMode",
      "executeToolCall",
      "registerCustomContextProvider",
      "openChat",
      "newSession",
      "handleGuiMessage",
    ]);
    assert.deepStrictEqual([...KNOX_API_EVENTS], [
      "onDidChangeAgentMode",
      "onDidReceiveGuiMessage",
    ]);
  });

  test("openChat without a prompt only focuses; prompt submits userInput", () => {
    assert.deepStrictEqual(planOpenChat(), { kind: "focus" });
    assert.deepStrictEqual(planOpenChat({}), { kind: "focus" });
    assert.deepStrictEqual(planOpenChat({ prompt: "   " }), { kind: "focus" });
    assert.deepStrictEqual(planOpenChat({ prompt: " explain this " }), {
      kind: "focusAndSubmit",
      prompt: "explain this",
    });
  });

  test("public tool calls become Core function tool calls", () => {
    assert.deepStrictEqual(
      toCoreToolCall({
        function: { name: "builtin_read_file", arguments: "{\"filepath\":\"a.ts\"}" },
      }),
      {
        id: "knox-api-builtin_read_file",
        type: "function",
        function: {
          name: "builtin_read_file",
          arguments: "{\"filepath\":\"a.ts\"}",
        },
      },
    );
    assert.strictEqual(
      toCoreToolCall({
        id: "call-1",
        type: "ignored",
        function: { name: "builtin_glob", arguments: "{}" },
      }).id,
      "call-1",
    );
  });

  test("Core context items flatten to the public ContextItem shape", () => {
    assert.deepStrictEqual(toPublicContextItems(undefined), []);
    assert.deepStrictEqual(
      toPublicContextItems([
        {
          name: "a.ts",
          description: "file",
          content: "const x = 1;",
          uri: { type: "file", value: "file:///a.ts" },
        },
        { content: "ok" },
      ]),
      [
        {
          name: "a.ts",
          description: "file",
          content: "const x = 1;",
          uri: { type: "file", value: "file:///a.ts" },
        },
        { name: "", description: "", content: "ok" },
      ],
    );
  });

  test("custom context providers wrap into a host IContextProvider", async () => {
    const wrapped = wrapCustomContextProvider({
      description: { title: "tickets", displayTitle: "Tickets" },
      async getContextItems(query) {
        return [
          {
            name: "T-1",
            description: query,
            content: "fix login",
            uri: { type: "url", value: "https://example.test/T-1" },
          },
        ];
      },
      async loadSubmenuItems() {
        return [{ id: "open", title: "Open tickets" }];
      },
    });
    assert.deepStrictEqual(wrapped.description, {
      title: "tickets",
      displayTitle: "Tickets",
      description: "",
      type: "normal",
    });
    assert.deepStrictEqual(await wrapped.getContextItems("login", {}), [
      {
        name: "T-1",
        description: "login",
        content: "fix login",
        uri: { type: "url", value: "https://example.test/T-1" },
      },
    ]);
    assert.deepStrictEqual(await wrapped.loadSubmenuItems({}), [
      { id: "open", title: "Open tickets", description: "" },
    ]);

    const untitled = wrapCustomContextProvider({
      description: { title: "docs" },
      async getContextItems() {
        return [];
      },
    });
    assert.strictEqual(untitled.description.displayTitle, "docs");
    assert.deepStrictEqual(await untitled.loadSubmenuItems({}), []);
  });
});
