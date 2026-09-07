import { describe, expect, it } from "vitest";

import sessionReducer, {
  clearDanglingMessages,
  submitEditorAndInitAtIndex,
} from "./sessionSlice";

function userItem(content: string, id = "u1") {
  return {
    message: { role: "user" as const, content, id },
    contextItems: [],
    editorState: { type: "doc", content: [] },
  };
}

function assistantItem(
  content: string,
  opts?: {
    id?: string;
    toolStatus?: "generating" | "generated" | "calling" | "done" | "canceled";
  },
) {
  const id = opts?.id ?? "a1";
  const base: any = {
    message: {
      role: "assistant" as const,
      content,
      id,
      ...(opts?.toolStatus
        ? {
            toolCalls: [
              {
                id: "tc1",
                type: "function",
                function: { name: "builtin_create_new_file", arguments: "{}" },
              },
            ],
          }
        : {}),
    },
    contextItems: [],
  };
  if (opts?.toolStatus) {
    base.toolCallState = {
      status: opts.toolStatus,
      toolCallId: "tc1",
      parsedArgs: {},
      toolCall: {
        id: "tc1",
        type: "function",
        function: { name: "builtin_create_new_file", arguments: "{}" },
      },
    };
  }
  return base;
}

function toolItem(content: string) {
  return {
    message: {
      role: "tool" as const,
      content,
      id: "t1",
      toolCallId: "tc1",
    },
    contextItems: [],
  };
}

describe("clearDanglingMessages", () => {
  it("rolls empty user+assistant pair back into the editor", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      history: [userItem("hello"), assistantItem("")] as any,
    };

    state = sessionReducer(state, clearDanglingMessages());
    expect(state.history).toHaveLength(0);
    expect(state.mainEditorContentTrigger).toBeDefined();
  });

  it("keeps prior tool result and drops empty trailing assistant", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      history: [
        userItem("do it"),
        assistantItem("working", { toolStatus: "done" }),
        toolItem("ok"),
        assistantItem(""),
      ] as any,
    };

    state = sessionReducer(state, clearDanglingMessages());
    expect(state.history).toHaveLength(3);
    expect(state.history.at(-1)?.message.role).toBe("tool");
  });

  it("cancels generating tool call when assistant already has content", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      history: [
        userItem("edit"),
        assistantItem("I'll edit", { toolStatus: "generating" }),
      ] as any,
    };

    state = sessionReducer(state, clearDanglingMessages());
    expect(state.history).toHaveLength(2);
    expect(state.history[1].toolCallState?.status).toBe("canceled");
  });

  it("cancels mid-flight calling tool so UI is not left dangling", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      history: [
        userItem("run it"),
        assistantItem("Running terminal", { toolStatus: "calling" }),
      ] as any,
    };

    state = sessionReducer(state, clearDanglingMessages());
    expect(state.history).toHaveLength(2);
    expect(state.history[1].toolCallState?.status).toBe("canceled");
  });

  it("cancels generated-but-not-started tool on abort", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      history: [
        userItem("edit"),
        assistantItem("I'll edit", { toolStatus: "generated" }),
      ] as any,
    };

    state = sessionReducer(state, clearDanglingMessages());
    expect(state.history[1].toolCallState?.status).toBe("canceled");
  });

  it("cancels a calling tool even after a sibling tool result", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    const taskState = {
      status: "calling" as const,
      toolCallId: "task1",
      parsedArgs: { prompt: "resolve conflicts", profile: "general" },
      toolCall: {
        id: "task1",
        type: "function" as const,
        function: { name: "builtin_task", arguments: "{}" },
      },
    };
    const grepState = {
      status: "done" as const,
      toolCallId: "grep1",
      parsedArgs: {},
      toolCall: {
        id: "grep1",
        type: "function" as const,
        function: { name: "builtin_grep_search", arguments: "{}" },
      },
    };
    state = {
      ...state,
      history: [
        userItem("go"),
        {
          message: {
            role: "assistant" as const,
            content: "working",
            id: "a1",
            toolCalls: [taskState.toolCall, grepState.toolCall],
          },
          contextItems: [],
          toolCallStates: [taskState, grepState],
          toolCallState: taskState,
        },
        toolItem("grep ok"),
      ] as any,
    };

    state = sessionReducer(state, clearDanglingMessages());
    expect(state.history[1].toolCallStates?.[0]?.status).toBe("canceled");
    expect(state.history[1].toolCallStates?.[1]?.status).toBe("done");
  });
});

describe("submitEditorAndInitAtIndex checkpoint index", () => {
  it("points curCheckpointIndex at the new user message", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = sessionReducer(
      state,
      submitEditorAndInitAtIndex({
        index: 0,
        editorState: { type: "doc", content: [] },
      }),
    );
    expect(state.history).toHaveLength(2);
    expect(state.curCheckpointIndex).toBe(0);
    expect(state.history[0].checkpoint).toEqual({});
  });

  it("stays on the resubmitted user index even with longer history", () => {
    let state = sessionReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      history: [
        userItem("a", "u0"),
        assistantItem("b", { id: "a0" }),
        userItem("c", "u1"),
        assistantItem("d", { id: "a1" }),
      ] as any,
    };
    state = sessionReducer(
      state,
      submitEditorAndInitAtIndex({
        index: 2,
        editorState: { type: "doc", content: [] },
      }),
    );
    expect(state.curCheckpointIndex).toBe(2);
    expect(state.history).toHaveLength(4); // truncated + new assistant
  });
});
