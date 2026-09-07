import { fireEvent, render, screen } from "@testing-library/react";
import { Tool } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatch,
  toggleToolSetting,
  removeSessionToolAllowlist,
  syncPendingToolPermissions,
  mockState,
} = vi.hoisted(() => ({
  dispatch: vi.fn((action: unknown) => action),
  toggleToolSetting: vi.fn((name: string) => ({
    type: "ui/toggleToolSetting",
    payload: name,
  })),
  removeSessionToolAllowlist: vi.fn((name: string) => ({
    type: "session/removeSessionToolAllowlist",
    payload: name,
  })),
  syncPendingToolPermissions: vi.fn(() => ({
    type: "chat/syncPendingToolPermissions",
  })),
  mockState: {
    setting: "allowedWithPermission" as string,
    allowlist: [] as string[],
    pendingName: undefined as string | undefined,
    pendingStatus: "generated" as string,
  },
}));

vi.stubGlobal("scrollIntoView", vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../../redux/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      ui: {
        toolSettings: {
          [BuiltInToolNames.CreateNewFile]: mockState.setting,
        },
        permissionMode: "default",
      },
      config: {
        config: {
          experimental: {},
        },
      },
      session: {
        sessionToolAllowlist: mockState.allowlist,
        history: mockState.pendingName
          ? [
              {
                toolCallStates: [
                  {
                    toolCallId: "tc-1",
                    status: mockState.pendingStatus,
                    toolCall: {
                      id: "tc-1",
                      type: "function",
                      function: {
                        name: mockState.pendingName,
                        arguments: "{}",
                      },
                    },
                  },
                ],
              },
            ]
          : [],
      },
    }),
}));

vi.mock("../../../../redux/slices/uiSlice", () => ({
  addTool: (tool: Tool) => ({ type: "ui/addTool", payload: tool }),
  toggleToolSetting,
}));

vi.mock("../../../../redux/slices/sessionSlice", () => ({
  removeSessionToolAllowlist,
}));

vi.mock("../../../../redux/thunks/syncPendingToolPermissions", () => ({
  syncPendingToolPermissions,
}));

vi.mock("../../../../pages/gui/ToolCallDiv/PermissionActionButtons", () => ({
  PermissionActionButtons: ({ toolName }: { toolName: string }) => (
    <div data-testid="row-permission-buttons">{toolName}</div>
  ),
}));

import ToolDropdownItem from "./ToolDropdownItem";

const createFileTool = {
  group: "Files",
  displayTitle: "Create New File",
  function: {
    name: BuiltInToolNames.CreateNewFile,
    description: "create",
    parameters: { type: "object", properties: {} },
  },
} as unknown as Tool;

describe("ToolDropdownItem", () => {
  beforeEach(() => {
    dispatch.mockClear();
    toggleToolSetting.mockClear();
    removeSessionToolAllowlist.mockClear();
    syncPendingToolPermissions.mockClear();
    mockState.setting = "allowedWithPermission";
    mockState.allowlist = [];
    mockState.pendingName = undefined;
    mockState.pendingStatus = "generated";
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows Requires Approval until Always lands on the session list", () => {
    const { rerender } = render(
      <ToolDropdownItem
        tool={createFileTool}
        duplicatesDetected={false}
        excluded={false}
      />,
    );
    expect(screen.getByTestId("tool-permission-badge").textContent).toBe(
      "toolRequiresApproval",
    );

    mockState.allowlist = [BuiltInToolNames.CreateNewFile];
    rerender(
      <ToolDropdownItem
        tool={createFileTool}
        duplicatesDetected={false}
        excluded={false}
      />,
    );
    expect(screen.getByTestId("tool-permission-badge").textContent).toBe(
      "toolAlwaysThisSession",
    );
  });

  it("clears session Always from the list without cycling the saved setting", () => {
    mockState.allowlist = [BuiltInToolNames.CreateNewFile];
    render(
      <ToolDropdownItem
        tool={createFileTool}
        duplicatesDetected={false}
        excluded={false}
      />,
    );

    fireEvent.click(screen.getByTestId("tool-permission-badge"));
    expect(removeSessionToolAllowlist).toHaveBeenCalledWith(
      BuiltInToolNames.CreateNewFile,
    );
    expect(toggleToolSetting).not.toHaveBeenCalled();
  });

  it("hosts the three-button set on the pending row", () => {
    mockState.pendingName = BuiltInToolNames.CreateNewFile;
    render(
      <ToolDropdownItem
        tool={createFileTool}
        duplicatesDetected={false}
        excluded={false}
      />,
    );

    expect(
      screen
        .getByTestId(`tool-permission-row-${BuiltInToolNames.CreateNewFile}`)
        .getAttribute("data-pending"),
    ).toBe("true");
    expect(screen.getByTestId("row-permission-buttons").textContent).toBe(
      BuiltInToolNames.CreateNewFile,
    );
  });
});
