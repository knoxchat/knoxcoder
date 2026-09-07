import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const {
  dispatch,
  setSessionMode,
  setPermissionMode,
  toggleJobsPanel,
  runAgentWorktree,
  mockState,
} = vi.hoisted(() => ({
  dispatch: vi.fn(),
  setSessionMode: vi.fn((mode: string) => ({
    type: "session/setMode",
    payload: mode,
  })),
  setPermissionMode: vi.fn((mode: string) => ({
    type: "ui/setPermissionMode",
    payload: mode,
  })),
  toggleJobsPanel: vi.fn(() => ({ type: "ui/toggleJobsPanel" })),
  runAgentWorktree: vi.fn((action: string) => ({
    type: "ui/runAgentWorktree",
    payload: action,
  })),
  mockState: {
    mode: "chat" as "chat" | "agent",
    isStreaming: false,
    permissionMode: "default" as "default" | "acceptEdits" | "fullAuto",
    worktree: { enabled: false, busy: false },
    jobsPanelOpen: false,
    runningJobs: 0,
    agentSupported: true,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}));

vi.mock("core/llm/autodetect", () => ({
  modelSupportsTools: () => mockState.agentSupported,
}));

vi.mock("../../redux/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        id: "sess-test",
        mode: mockState.mode,
        isStreaming: mockState.isStreaming,
        history: [],
      },
      ui: {
        permissionMode: mockState.permissionMode,
        worktree: mockState.worktree,
        backgroundJobs: [],
        jobsPanelOpen: mockState.jobsPanelOpen,
      },
      config: { defaultModelTitle: "test" },
    }),
}));

vi.mock("../../redux/slices/configSlice", () => ({
  selectDefaultModel: () => ({ title: "test", provider: "openai" }),
}));

vi.mock("../../redux/slices/sessionSlice", () => ({
  selectCurrentMode: (state: { session: { mode: string } }) => state.session.mode,
}));

vi.mock("../../redux/slices/uiSlice", () => ({
  cyclePermissionMode: () => ({ type: "ui/cyclePermissionMode" }),
  setPermissionMode,
  toggleJobsPanel,
}));

vi.mock("../../redux/thunks/agentWorktree", () => ({
  runAgentWorktree,
}));

vi.mock("../../redux/thunks/setSessionMode", () => ({
  setSessionMode,
}));

vi.mock("../../redux/thunks/syncPendingToolPermissions", () => ({
  syncPendingToolPermissions: () => ({
    type: "chat/syncPendingToolPermissions",
  }),
}));

vi.mock("../../redux/util/backgroundJobs", () => ({
  collectRunningTaskJobs: () => [],
  mergeBackgroundJobs: () => [],
  countRunningJobs: () => mockState.runningJobs,
}));

import ModeSelect from "./ModeSelect";

describe("ModeSelect", () => {
  beforeEach(() => {
    dispatch.mockClear();
    setSessionMode.mockClear();
    setPermissionMode.mockClear();
    toggleJobsPanel.mockClear();
    runAgentWorktree.mockClear();
    Object.assign(mockState, {
      mode: "chat",
      isStreaming: false,
      permissionMode: "default",
      worktree: { enabled: false, busy: false },
      jobsPanelOpen: false,
      runningJobs: 0,
      agentSupported: true,
    });
  });

  it("keeps Chat and Agent visible without overflowing agent extras", () => {
    render(<ModeSelect />);

    expect(screen.getByText("chat")).toBeTruthy();
    expect(screen.getByText("agent")).toBeTruthy();
    expect(screen.queryByText("worktreeChip")).toBeNull();
    expect(screen.queryByText("jobsChip")).toBeNull();
    expect(screen.queryByTestId("agent-options-trigger")).toBeNull();
  });

  it("opens an Agent dropdown for permission, worktree, and jobs", async () => {
    mockState.mode = "agent";
    mockState.runningJobs = 2;

    render(<ModeSelect />);

    expect(screen.queryByText("worktreeChip")).toBeNull();
    fireEvent.click(screen.getByTestId("agent-options-trigger"));

    expect(await screen.findByText("permissionModeGroup")).toBeTruthy();
    expect(screen.getByText("permissionModeAsk")).toBeTruthy();
    expect(screen.getByText("permissionModeEdits")).toBeTruthy();
    expect(screen.getByText("permissionModeAuto")).toBeTruthy();
    expect(screen.getByText("worktreeChip")).toBeTruthy();
    expect(screen.getByText("jobsChipCount:2")).toBeTruthy();
  });

  it("selects a permission mode from the Agent dropdown", async () => {
    mockState.mode = "agent";

    render(<ModeSelect />);
    fireEvent.click(screen.getByTestId("agent-options-trigger"));
    fireEvent.click(await screen.findByText("permissionModeAuto"));

    expect(setPermissionMode).toHaveBeenCalledWith("fullAuto");
    expect(dispatch).toHaveBeenCalled();
  });
});
