import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

const { streamResponseAfterToolCall } = vi.hoisted(() => ({
  streamResponseAfterToolCall: vi.fn((arg: unknown) => ({
    type: "chat/streamAfterToolCall/fulfilled",
    payload: undefined,
    meta: { requestStatus: "fulfilled" as const },
    arg,
  })),
}));

vi.mock("./streamResponseAfterToolCall", () => ({
  streamResponseAfterToolCall,
}));

import { callTool } from "./callTool";

function toolState(status: "generated" | "calling" | "canceled" | "done") {
  return {
    toolCallId: "tc1",
    status,
    parsedArgs: { command: "cargo check 2>&1", background: true },
    toolCall: {
      id: "tc1",
      type: "function" as const,
      function: {
        name: BuiltInToolNames.RunTerminalCommand,
        arguments: JSON.stringify({
          command: "cargo check 2>&1",
          background: true,
        }),
      },
    },
  };
}

describe("callTool unexpected abort", () => {
  beforeEach(() => {
    streamResponseAfterToolCall.mockClear();
    (window as any).workspacePaths = ["/tmp/ws"];
  });

  function setup(opts: {
    toolsCall: () => Promise<{ status: string; error?: string; content?: unknown }>;
    afterSetCalling?: (state: { status: string }) => void;
    toolLoopSteps?: number;
    agentMaxSteps?: number;
  }) {
    const live = toolState("generated");
    const getState = vi.fn(() => ({
      session: {
        id: "sess-1",
        history: [
          {
            message: { role: "user", content: "fix it", id: "u1" },
            contextItems: [],
          },
          {
            message: { role: "assistant", content: "", id: "a1" },
            contextItems: [],
            toolCallState: live,
            toolCallStates: [live],
          },
        ],
        toolLoopSteps: opts.toolLoopSteps ?? 0,
        sessionToolAllowlist: [],
      },
      config: {
        defaultModelTitle: "DeepSeek",
        config: {
          models: [{ title: "DeepSeek" }],
          tools: [],
          experimental: {
            ...(typeof opts.agentMaxSteps === "number"
              ? { agentMaxSteps: opts.agentMaxSteps }
              : {}),
          },
          selectedModelByRole: {
            chat: null,
            apply: null,
            edit: null,
            summarize: null,
            viewRead: null,
            realTimeSearch: null,
          },
        },
      },
    }));

    const dispatched: unknown[] = [];
    const extra = {
      ideMessenger: {
        request: vi.fn(async (route: string) => {
          if (route === "tools/call") {
            return opts.toolsCall();
          }
          return { status: "success", content: {} };
        }),
      },
    };

    const dispatch = vi.fn(async (action: any) => {
      dispatched.push(action);
      if (typeof action === "function") {
        return action(dispatch, getState, extra);
      }
      if (action?.type === "session/setCalling") {
        live.status = "calling";
        opts.afterSetCalling?.(live);
      }
      if (action?.type === "session/cancelToolCall") {
        live.status = "canceled";
      }
      if (action?.type === "session/acceptToolCall") {
        live.status = "done";
      }
      return action;
    });

    return { live, dispatch, getState, extra, dispatched };
  }

  it("resumes the model when Core aborts but the user did not hit Stop", async () => {
    const { dispatch, getState, extra, live } = setup({
      toolsCall: async () => ({
        status: "error",
        error: 'Tool "builtin_run_terminal_command" cancelled',
      }),
    });

    await callTool({ toolCallId: "tc1" })(dispatch, getState as any, extra as any);

    expect(streamResponseAfterToolCall).toHaveBeenCalledTimes(1);
    const arg = streamResponseAfterToolCall.mock.calls[0]?.[0] as {
      toolOutput: Array<{ content: string }>;
    };
    expect(arg.toolOutput[0]?.content).toMatch(/did not hit Stop/i);
    expect(live.status).toBe("done");
  });

  it("does not resume when the user hits Stop during the tool", async () => {
    const { dispatch, getState, extra, live } = setup({
      toolsCall: async () => {
        live.status = "canceled";
        return { status: "error", error: "Tool cancelled" };
      },
    });

    await callTool({ toolCallId: "tc1" })(dispatch, getState as any, extra as any);

    expect(streamResponseAfterToolCall).not.toHaveBeenCalled();
    expect(live.status).toBe("canceled");
  });

  it("marks a failed edit as done so the agent can continue", async () => {
    const { dispatch, getState, extra, live } = setup({
      toolsCall: async () => ({
        status: "error",
        error: 'old_string not found in "style.css"',
      }),
    });

    await callTool({ toolCallId: "tc1" })(dispatch, getState as any, extra as any);

    expect(streamResponseAfterToolCall).toHaveBeenCalledTimes(1);
    expect(live.status).toBe("done");
    const arg = streamResponseAfterToolCall.mock.calls[0]?.[0] as {
      toolOutput: Array<{ content: string }>;
    };
    expect(arg.toolOutput[0]?.content).toMatch(/old_string not found/i);
  });

  it("lets runAgentLoop own max-steps when skipContinue is set", async () => {
    const blocked = setup({
      toolsCall: async () => ({
        status: "success",
        content: { contextItems: [] },
      }),
      toolLoopSteps: 40,
      agentMaxSteps: 40,
    });
    await callTool({ toolCallId: "tc1" })(
      blocked.dispatch,
      blocked.getState as any,
      blocked.extra as any,
    );
    expect(blocked.extra.ideMessenger.request).not.toHaveBeenCalledWith(
      "tools/call",
      expect.anything(),
    );
    expect(blocked.live.status).toBe("canceled");

    const allowed = setup({
      toolsCall: async () => ({
        status: "success",
        content: { contextItems: [] },
      }),
      toolLoopSteps: 40,
      agentMaxSteps: 40,
    });
    await callTool({ toolCallId: "tc1", skipContinue: true })(
      allowed.dispatch,
      allowed.getState as any,
      allowed.extra as any,
    );
    expect(allowed.extra.ideMessenger.request).toHaveBeenCalledWith(
      "tools/call",
      expect.objectContaining({ sessionId: "sess-1" }),
    );
  });
});
