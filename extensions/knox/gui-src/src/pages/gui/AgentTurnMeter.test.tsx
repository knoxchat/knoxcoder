import { fireEvent, render, screen } from "@testing-library/react";
import { BuiltInToolNames } from "core/tools/builtIn";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setLocalStorageSync, mockState } = vi.hoisted(() => ({
  setLocalStorageSync: vi.fn(),
  mockState: {
    toolLoopSteps: 7,
    history: [] as unknown[],
    agentMaxSteps: undefined as number | undefined,
    agentProfile: undefined as string | undefined,
    autonomousLoop: {
      status: "idle" as "idle" | "running" | "completed" | "cancelled",
      iteration: 0,
      maxIterations: 0,
      goal: undefined as string | undefined,
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.used != null && opts?.max != null) {
        return `${opts.used}/${opts.max} steps`;
      }
      if (opts?.used != null) {
        return `${opts.used} steps`;
      }
      if (opts?.iteration != null && opts?.max != null) {
        return `${opts.iteration}/${opts.max} auto`;
      }
      if (opts?.iteration != null) {
        return `${opts.iteration} auto`;
      }
      if (opts?.count != null) {
        return `${key}:${opts.count}`;
      }
      if (opts?.kind != null) {
        return String(opts.kind);
      }
      return key;
    },
  }),
}));

vi.mock("../../redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        toolLoopSteps: mockState.toolLoopSteps,
        history: mockState.history,
        autonomousLoop: mockState.autonomousLoop,
      },
      config: {
        config: {
          experimental: {
            agentMaxSteps: mockState.agentMaxSteps,
            agentProfile: mockState.agentProfile,
          },
        },
      },
    }),
}));

vi.mock("../../redux/selectors/selectCurrentToolCall", () => ({
  selectCurrentToolCall: () => null,
}));

vi.mock("../../util/localStorage", () => ({
  getLocalStorageSync: () => false,
  setLocalStorageSync,
  LocalStorageKey: { ActivityPanelExpanded: "activityPanelExpanded" },
}));

import { AgentTurnMeter } from "./AgentTurnMeter";

function userItem() {
  return {
    message: {
      role: "user" as const,
      content: "edit the module",
      id: "u1",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
    },
    contextItems: [],
  };
}

function editItem() {
  return {
    message: {
      role: "assistant" as const,
      content: "",
      id: "a1",
      toolCalls: [
        {
          id: "t1",
          type: "function" as const,
          function: {
            name: BuiltInToolNames.EditFile,
            arguments: JSON.stringify({ filepath: "go.mod" }),
          },
        },
      ],
    },
    contextItems: [],
    toolCallStates: [
      {
        toolCallId: "t1",
        status: "done" as const,
        parsedArgs: { filepath: "go.mod" },
        toolCall: {
          id: "t1",
          type: "function" as const,
          function: {
            name: BuiltInToolNames.EditFile,
            arguments: JSON.stringify({ filepath: "go.mod" }),
          },
        },
      },
    ],
  };
}

describe("AgentTurnMeter", () => {
  beforeEach(() => {
    setLocalStorageSync.mockClear();
    mockState.toolLoopSteps = 7;
    mockState.agentMaxSteps = undefined;
    mockState.agentProfile = undefined;
    mockState.autonomousLoop = {
      status: "idle",
      iteration: 0,
      maxIterations: 0,
      goal: undefined,
    };
    mockState.history = [];
  });

  it("hides when there is no turn activity", () => {
    const { container } = render(
      <AgentTurnMeter history={[]} isStreaming={false} />,
    );
    expect(container.querySelector("[data-testid=agent-turn-meter]")).toBeNull();
  });

  it("shows the pixel loader in the meter while streaming", () => {
    render(
      <AgentTurnMeter history={[userItem()]} isStreaming={true} />,
    );
    expect(screen.getByTestId("agent-turn-meter")).toBeTruthy();
    expect(screen.getByTestId("agent-turn-meter-loading")).toBeTruthy();
    expect(screen.getByText("7 steps")).toBeTruthy();
  });

  it("shows used/max when a step cap is configured", () => {
    mockState.agentMaxSteps = 40;
    render(
      <AgentTurnMeter history={[userItem()]} isStreaming={true} />,
    );
    expect(screen.getByText("7/40 steps")).toBeTruthy();
  });

  it("toggles the activity list like memories and jobs", () => {
    const history = [userItem(), editItem()];
    render(<AgentTurnMeter history={history} isStreaming={false} />);

    const toggle = screen.getByTestId("agent-turn-meter-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("go.mod")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(setLocalStorageSync).toHaveBeenCalledWith(
      "activityPanelExpanded",
      true,
    );
  });

  it("keeps the header when collapsed and hides rows via max-height", () => {
    const history = [userItem(), editItem()];
    render(<AgentTurnMeter history={history} isStreaming={false} />);

    expect(screen.getByTestId("agent-turn-meter")).toBeTruthy();
    expect(
      screen.getByTestId("agent-turn-meter-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
    const listWrap = screen.getByTestId("agent-activity-step-list").parentElement
      ?.parentElement;
    expect(listWrap?.style.maxHeight).toBe("0px");
    expect(listWrap?.style.opacity).toBe("0");
  });

  it("exposes a stick-to-bottom scroller for live activity rows", () => {
    const history = [userItem(), editItem()];
    render(<AgentTurnMeter history={history} isStreaming={true} />);

    fireEvent.click(screen.getByTestId("agent-turn-meter-toggle"));
    const scroller = screen.getByTestId("agent-turn-meter-scroll");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.contains(screen.getByTestId("agent-activity-step-list"))).toBe(
      true,
    );
  });

  it("shows the autonomous iteration banner and outer-loop chip", () => {
    mockState.autonomousLoop = {
      status: "running",
      iteration: 3,
      maxIterations: 10,
      goal: "boot panic in mm",
    };
    render(<AgentTurnMeter history={[userItem()]} isStreaming={true} />);
    expect(screen.getByTestId("autonomous-iteration-banner")).toBeTruthy();
    expect(screen.getByTestId("agent-turn-meter-autonomous").textContent).toBe(
      "3/10 auto",
    );
    expect(screen.getByText("boot panic in mm")).toBeTruthy();
  });

  it("shows unlimited outer-loop count when maxIterations is 0", () => {
    mockState.autonomousLoop = {
      status: "running",
      iteration: 3,
      maxIterations: 0,
      goal: "boot panic in mm",
    };
    render(<AgentTurnMeter history={[userItem()]} isStreaming={true} />);
    expect(screen.getByTestId("agent-turn-meter-autonomous").textContent).toBe(
      "3 auto",
    );
  });
});
