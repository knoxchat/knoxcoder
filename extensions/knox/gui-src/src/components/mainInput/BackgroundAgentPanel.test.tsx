import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBackgroundJob } from "core/protocol/agentJobs";

const { dispatch, toggleJobsPanel, runAgentJobAction, mockState } = vi.hoisted(
  () => ({
    dispatch: vi.fn(),
    toggleJobsPanel: vi.fn(() => ({ type: "ui/toggleJobsPanel" })),
    runAgentJobAction: vi.fn((payload: unknown) => ({
      type: "ui/runAgentJobAction",
      payload,
    })),
    mockState: {
      mode: "agent" as "chat" | "agent",
      jobsPanelOpen: true,
      jobs: [
        {
          id: "sh_1",
          kind: "shell" as const,
          title: "cargo build",
          status: "exited" as const,
          exitCode: 0,
          output: "Finished `dev` profile",
          startedAt: 1,
          endedAt: 2,
        },
      ] as AgentBackgroundJob[],
    },
  }),
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; code?: string | number }) => {
      if (opts?.count != null) {
        return `${key}:${opts.count}`;
      }
      if (opts?.code != null) {
        return `${key}:${opts.code}`;
      }
      return key;
    },
  }),
}));

vi.mock("../../redux/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        mode: mockState.mode,
        history: [],
        lastInjectedMemories: [],
      },
      ui: {
        backgroundJobs: mockState.jobs,
        jobsPanelOpen: mockState.jobsPanelOpen,
      },
    }),
}));

vi.mock("../../redux/slices/uiSlice", () => ({
  toggleJobsPanel,
}));

vi.mock("../../redux/thunks/agentJobs", () => ({
  runAgentJobAction,
}));

vi.mock("../../redux/util/backgroundJobs", async () => {
  const actual = await vi.importActual<
    typeof import("../../redux/util/backgroundJobs")
  >("../../redux/util/backgroundJobs");
  return {
    ...actual,
    collectRunningTaskJobs: () => [],
  };
});

import { BackgroundAgentPanel } from "./BackgroundAgentPanel";

describe("BackgroundAgentPanel", () => {
  beforeEach(() => {
    dispatch.mockClear();
    toggleJobsPanel.mockClear();
    runAgentJobAction.mockClear();
    mockState.mode = "agent";
    mockState.jobsPanelOpen = true;
    mockState.jobs = [
      {
        id: "sh_1",
        kind: "shell",
        title: "cargo build",
        status: "exited",
        exitCode: 0,
        output: "Finished `dev` profile",
        startedAt: 1,
        endedAt: 2,
      },
    ];
  });

  it("hides when there are no jobs", () => {
    mockState.jobs = [];
    const { container } = render(<BackgroundAgentPanel />);
    expect(container.querySelector("[data-testid=agent-jobs-panel]")).toBeNull();
  });

  it("toggles the list like files changed", () => {
    render(<BackgroundAgentPanel />);
    expect(screen.getByText("jobsCount:1")).toBeTruthy();
    expect(screen.getByText("cargo build")).toBeTruthy();
    fireEvent.click(screen.getByTestId("agent-jobs-toggle"));
    expect(toggleJobsPanel).toHaveBeenCalled();
  });

  it("keeps the header when collapsed and hides row details via max-height", () => {
    mockState.jobsPanelOpen = false;
    render(<BackgroundAgentPanel />);
    expect(screen.getByTestId("agent-jobs-panel")).toBeTruthy();
    expect(screen.getByTestId("agent-jobs-toggle").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("expands command output on title click", () => {
    render(<BackgroundAgentPanel />);
    fireEvent.click(screen.getByText("cargo build"));
    expect(screen.getByTestId("agent-job-log-sh_1").textContent).toContain(
      "Finished",
    );
  });

  it("lets the user kill a running core task job", () => {
    mockState.jobs = [
      {
        id: "task_child_1",
        kind: "task",
        title: "[general] resolve conflicts",
        status: "running",
        startedAt: 1,
      },
    ];
    render(<BackgroundAgentPanel />);
    fireEvent.click(screen.getByText("jobsKill"));
    expect(runAgentJobAction).toHaveBeenCalledWith({
      action: "kill",
      jobId: "task_child_1",
    });
  });
});
