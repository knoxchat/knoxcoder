import { fireEvent, render, screen } from "@testing-library/react";
import { BuiltInToolNames } from "core/tools/builtIn";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatch,
  addSessionToolAllowlist,
  callTool,
  cancelTool,
  mockState,
} = vi.hoisted(() => ({
  dispatch: vi.fn((action: unknown) => action),
  addSessionToolAllowlist: vi.fn((name: string) => ({
    type: "session/addSessionToolAllowlist",
    payload: name,
  })),
  callTool: vi.fn((payload: unknown) => ({
    type: "chat/callTool",
    payload,
  })),
  cancelTool: vi.fn((payload: unknown) => ({
    type: "chat/cancelTool",
    payload,
  })),
  mockState: {
    status: "generated" as string,
    toolName: "builtin_create_new_file",
    allowlist: [] as string[],
    setting: "allowedWithPermission" as string,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../redux/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        id: "sess-1",
        sessionToolAllowlist: mockState.allowlist,
        autonomousLoop: { status: "idle" },
        history: [
          {
            toolCallStates: [
              {
                toolCallId: "tc-1",
                status: mockState.status,
                toolCall: {
                  id: "tc-1",
                  type: "function",
                  function: { name: mockState.toolName, arguments: "{}" },
                },
              },
            ],
          },
        ],
      },
      ui: {
        toolSettings: {
          [mockState.toolName]: mockState.setting,
        },
        permissionMode: "default",
      },
      config: {
        config: {
          experimental: {},
        },
      },
    }),
}));

vi.mock("../../../redux/slices/sessionSlice", () => ({
  addSessionToolAllowlist,
}));

vi.mock("../../../redux/thunks/callTool", () => ({
  callTool,
}));

vi.mock("../../../redux/thunks/cancelTool", () => ({
  cancelTool,
}));

import { PermissionActionButtons } from "./PermissionActionButtons";

describe("PermissionActionButtons", () => {
  beforeEach(() => {
    dispatch.mockClear();
    addSessionToolAllowlist.mockClear();
    callTool.mockClear();
    cancelTool.mockClear();
    mockState.status = "generated";
    mockState.toolName = "builtin_create_new_file";
    mockState.allowlist = [];
    mockState.setting = "allowedWithPermission";
  });

  it("Always writes the session allowlist then approves the pending call", () => {
    render(
      <PermissionActionButtons toolName={BuiltInToolNames.CreateNewFile} />,
    );

    fireEvent.click(screen.getByText("alwaysThisSession"));

    expect(addSessionToolAllowlist).toHaveBeenCalledWith(
      BuiltInToolNames.CreateNewFile,
    );
    expect(callTool).toHaveBeenCalledWith({ toolCallId: "tc-1" });
  });

  it("does not pop Deny/Always/Approve when the session already Always-allowed the tool", () => {
    mockState.allowlist = [BuiltInToolNames.CreateNewFile];
    render(
      <PermissionActionButtons toolName={BuiltInToolNames.CreateNewFile} />,
    );

    expect(screen.queryByTestId("permission-action-buttons")).toBeNull();
  });

  it("does not render for a different list row than the pending tool", () => {
    render(<PermissionActionButtons toolName={BuiltInToolNames.EditFile} />);
    expect(screen.queryByTestId("permission-action-buttons")).toBeNull();
  });

  it("does not pop Deny/Always/Approve when the tool is Auto-Approve", () => {
    mockState.setting = "allowedWithoutPermission";
    render(
      <PermissionActionButtons toolName={BuiltInToolNames.CreateNewFile} />,
    );
    expect(screen.queryByTestId("permission-action-buttons")).toBeNull();
  });
});
