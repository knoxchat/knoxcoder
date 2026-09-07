import { AssistantChatMessage, ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";

import sessionReducer, {
  hydrateLastAssistant,
  mergeAssistantText,
  streamUpdate,
  submitEditorAndInitAtIndex,
} from "./sessionSlice";

function assistantItems(history: ChatHistoryItem[]) {
  return history.filter(
    (item): item is ChatHistoryItem & { message: AssistantChatMessage } =>
      item.message.role === "assistant",
  );
}

const REPLY =
  "The `cargo info` shows the pre-release. Let me check the latest stable release";

const TOOL_CALL = {
  id: "call_1",
  type: "function" as const,
  function: {
    name: "builtin_run_terminal_command",
    arguments: '{"command":"cargo info dioxus"}',
  },
};

function sessionWithAssistantPlaceholder() {
  return sessionReducer(
    sessionReducer(undefined, { type: "unknown" }),
    submitEditorAndInitAtIndex({
      index: 0,
      editorState: { type: "doc", content: [] },
    }),
  );
}

describe("mergeAssistantText", () => {
  it("ignores a repeated snapshot of the same sentence", () => {
    expect(mergeAssistantText(REPLY, REPLY)).toBe(REPLY);
  });

  it("replaces with a longer snapshot instead of concatenating", () => {
    expect(mergeAssistantText("Hello", "Hello world")).toBe("Hello world");
  });

  it("appends a true delta", () => {
    expect(mergeAssistantText("Hello", " world")).toBe("Hello world");
  });
});

describe("streamUpdate tool-call split", () => {
  it("does not copy the streamed reply onto the new tool-call item", () => {
    let state = sessionWithAssistantPlaceholder();
    state = sessionReducer(
      state,
      streamUpdate([
        { role: "assistant", content: "", reasoning: "check crates.io" } as any,
      ]),
    );
    state = sessionReducer(
      state,
      streamUpdate([{ role: "assistant", content: REPLY }]),
    );
    state = sessionReducer(
      state,
      streamUpdate([
        {
          role: "assistant",
          content: REPLY,
          toolCalls: [TOOL_CALL],
        },
      ]),
    );

    const assistants = assistantItems(state.history);
    expect(assistants).toHaveLength(2);
    expect(assistants[0].message.content).toBe(REPLY);
    expect(assistants[0].reasoning?.text).toBe("check crates.io");
    expect(assistants[1].message.content).toBe("");
    expect(assistants[1].message.toolCalls?.[0]?.id).toBe("call_1");
  });

  it("hydrateLastAssistant keeps text on the pre-tool assistant", () => {
    let state = sessionWithAssistantPlaceholder();
    state = sessionReducer(
      state,
      streamUpdate([{ role: "assistant", content: REPLY }]),
    );
    state = sessionReducer(
      state,
      streamUpdate([
        {
          role: "assistant",
          content: "",
          toolCalls: [TOOL_CALL],
        },
      ]),
    );
    state = sessionReducer(
      state,
      hydrateLastAssistant({
        role: "assistant",
        content: REPLY,
        toolCalls: [TOOL_CALL],
      }),
    );

    const assistants = assistantItems(state.history);
    expect(assistants[0].message.content).toBe(REPLY);
    expect(assistants[1].message.content).toBe("");
    expect(assistants[1].message.toolCalls?.[0]?.function?.name).toBe(
      "builtin_run_terminal_command",
    );
  });

  it("does not concatenate when the same reply chunk arrives twice", () => {
    let state = sessionWithAssistantPlaceholder();
    state = sessionReducer(
      state,
      streamUpdate([{ role: "assistant", content: REPLY }]),
    );
    state = sessionReducer(
      state,
      streamUpdate([{ role: "assistant", content: REPLY }]),
    );

    const assistant = state.history.find(
      (item) => item.message.role === "assistant",
    );
    expect(assistant?.message.content).toBe(REPLY);
  });

  it("hydrateLastAssistant still writes content onto an unsplit tool item", () => {
    let state = sessionWithAssistantPlaceholder();
    state = sessionReducer(
      state,
      streamUpdate([
        {
          role: "assistant",
          content: REPLY,
          toolCalls: [TOOL_CALL],
        },
      ]),
    );
    state = sessionReducer(
      state,
      hydrateLastAssistant({
        role: "assistant",
        content: REPLY,
        toolCalls: [TOOL_CALL],
      }),
    );

    const assistants = assistantItems(state.history);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].message.content).toBe(REPLY);
    expect(assistants[0].message.toolCalls?.[0]?.id).toBe("call_1");
  });
});
