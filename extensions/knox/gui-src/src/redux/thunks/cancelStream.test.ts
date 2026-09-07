import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveCurrentSession, runAgentJobAction } = vi.hoisted(() => ({
  saveCurrentSession: vi.fn(() => ({
    type: "session/saveCurrent/fulfilled",
    payload: undefined,
    meta: { requestStatus: "fulfilled" as const },
  })),
  runAgentJobAction: vi.fn((arg: unknown) => ({
    type: "ui/runAgentJobAction/fulfilled",
    payload: undefined,
    meta: { requestStatus: "fulfilled" as const, arg },
  })),
}));

vi.mock("./session", () => ({
  saveCurrentSession,
}));

vi.mock("./agentJobs", () => ({
  runAgentJobAction,
}));

vi.mock("../util/guiToolApproval", () => ({
  rejectGuiLoopWaiters: vi.fn(),
}));

import { cancelStream } from "./cancelStream";

describe("cancelStream", () => {
  beforeEach(() => {
    saveCurrentSession.mockClear();
    runAgentJobAction.mockClear();
  });

  it("posts tools/cancel and kills every background job", async () => {
    const extra = {
      ideMessenger: {
        post: vi.fn(),
        request: vi.fn().mockResolvedValue({ status: "success", content: {} }),
      },
    };
    const dispatched: unknown[] = [];
    const dispatch = vi.fn((action: any) => {
      dispatched.push(action);
      if (typeof action === "function") {
        return action(dispatch, getState, extra);
      }
      return action;
    });
    const getState = vi.fn(() => ({
      session: {
        id: "sess-1",
        codeBlockApplyStates: { states: [] },
      },
    }));

    await cancelStream()(dispatch as any, getState as any, extra as any);

    expect(extra.ideMessenger.post).toHaveBeenCalledWith("tools/cancel", undefined);
    expect(runAgentJobAction).toHaveBeenCalledWith({ action: "killAll" });
  });
});
