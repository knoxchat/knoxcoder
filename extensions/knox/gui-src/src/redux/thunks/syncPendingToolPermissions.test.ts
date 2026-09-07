import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

const { callTool, cancelTool } = vi.hoisted(() => ({
  callTool: vi.fn((payload: unknown) => ({
    type: "chat/callTool",
    payload,
  })),
  cancelTool: vi.fn((payload: unknown) => ({
    type: "chat/cancelTool",
    payload,
  })),
}));

vi.mock("./callTool", () => ({ callTool }));
vi.mock("./cancelTool", () => ({ cancelTool }));

import { syncPendingToolPermissions } from "./syncPendingToolPermissions";

function pendingState(name: string, id = "tc-1") {
  return {
    toolCallId: id,
    status: "generated" as const,
    parsedArgs: {},
    toolCall: {
      id,
      type: "function" as const,
      function: { name, arguments: "{}" },
    },
  };
}

describe("syncPendingToolPermissions", () => {
  beforeEach(() => {
    callTool.mockClear();
    cancelTool.mockClear();
    (window as any).workspacePaths = ["/tmp/ws"];
  });

  it("approves a pending call after the list flips it to Auto-Approve", async () => {
    const dispatch = vi.fn((action: any) => {
      if (typeof action === "function") {
        return action(dispatch, getState, {});
      }
      return { unwrap: () => undefined, ...action };
    });
    const getState = vi.fn(() => ({
      session: {
        history: [{ toolCallStates: [pendingState(BuiltInToolNames.CreateNewFile)] }],
        sessionToolAllowlist: [],
      },
      ui: {
        toolSettings: {
          [BuiltInToolNames.CreateNewFile]: "allowedWithoutPermission",
        },
        permissionMode: "default",
      },
      config: { config: { tools: [], experimental: {} } },
    }));

    await syncPendingToolPermissions()(dispatch, getState as any, {} as any);

    expect(callTool).toHaveBeenCalledWith({
      toolCallId: "tc-1",
    });
    expect(cancelTool).not.toHaveBeenCalled();
  });

  it("denies a pending call after the list disables the tool", async () => {
    const dispatch = vi.fn((action: any) => {
      if (typeof action === "function") {
        return action(dispatch, getState, {});
      }
      return { unwrap: () => undefined, ...action };
    });
    const getState = vi.fn(() => ({
      session: {
        history: [{ toolCallStates: [pendingState(BuiltInToolNames.CreateNewFile)] }],
        sessionToolAllowlist: [],
      },
      ui: {
        toolSettings: {
          [BuiltInToolNames.CreateNewFile]: "disabled",
        },
        permissionMode: "default",
      },
      config: { config: { tools: [], experimental: {} } },
    }));

    await syncPendingToolPermissions()(dispatch, getState as any, {} as any);

    expect(cancelTool).toHaveBeenCalledWith({ toolCallId: "tc-1" });
    expect(callTool).not.toHaveBeenCalled();
  });
});
