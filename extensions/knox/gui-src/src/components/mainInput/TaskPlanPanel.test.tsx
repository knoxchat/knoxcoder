import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatPlanText, type TaskPlan } from "core/tools/planStore";

const SAMPLE: TaskPlan = {
  title: "Build Snake Game with Dioxus 0.8",
  updatedAt: 1,
  steps: [
    { id: "1-create-cargo", title: "Create Cargo.toml", status: "pending" },
    {
      id: "2-write-main",
      title: "Write src/main.rs Snake game logic",
      status: "in_progress",
    },
    { id: "3-add-tests", title: "Add unit tests", status: "done" },
    { id: "4-cargo-check", title: "cargo check / build", status: "pending" },
  ],
};

const { mockState } = vi.hoisted(() => ({
  mockState: {
    history: [] as unknown[],
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      opts?: {
        count?: number;
        remaining?: number;
        total?: number;
        done?: number;
      },
    ) => {
      if (opts?.done != null && opts?.total != null) {
        return `${key}:${opts.done}:${opts.total}`;
      }
      if (opts?.count != null) {
        return `${key}:${opts.count}`;
      }
      if (opts?.remaining != null && opts?.total != null) {
        return `${key}:${opts.remaining}:${opts.total}`;
      }
      return key;
    },
  }),
}));

vi.mock("../../redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        history: mockState.history,
      },
    }),
}));

import { TaskPlanPanel } from "./TaskPlanPanel";

describe("TaskPlanPanel", () => {
  beforeEach(() => {
    mockState.history = [
      {
        message: {
          role: "tool",
          content: formatPlanText(SAMPLE),
          toolCallId: "p1",
          id: "t1",
        },
        contextItems: [
          {
            name: "Plan",
            description: "created",
            content: formatPlanText(SAMPLE),
            id: { providerTitle: "toolCall", itemId: "p1" },
          },
        ],
      },
    ];
  });

  it("hides when there is no plan", () => {
    mockState.history = [];
    const { container } = render(<TaskPlanPanel />);
    expect(container.querySelector("[data-testid=task-plan-panel]")).toBeNull();
  });

  it("shows an attached header with live fraction and a progress bar", () => {
    render(<TaskPlanPanel />);
    const panel = screen.getByTestId("task-plan-panel");
    expect(panel.className).toContain("attached-input-panel");
    expect(screen.getByText("taskPlanTitle")).toBeTruthy();
    expect(screen.getByText("taskPlanFraction:1:4")).toBeTruthy();
    expect(screen.getByTestId("task-plan-progress-bar")).toBeTruthy();
    expect(
      screen.getByTestId("task-plan-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("lists steps when open and collapses on header click", () => {
    render(<TaskPlanPanel />);
    expect(screen.getByText("Build Snake Game with Dioxus 0.8")).toBeTruthy();
    expect(screen.getByText(/Create Cargo.toml/)).toBeTruthy();
    expect(screen.getAllByText(/Write src\/main.rs/).length).toBeGreaterThan(0);
    expect(screen.queryByText("taskPlanStatusPending")).toBeNull();
    expect(screen.queryByText("taskPlanStatusDone")).toBeNull();
    expect(screen.queryByText("taskPlanStatusActive")).toBeNull();
    expect(
      screen.getByTestId("task-plan-step-3-add-tests").getAttribute("data-status"),
    ).toBe("done");
    expect(
      screen.getByTestId("task-plan-step-1-create-cargo").getAttribute("data-status"),
    ).toBe("pending");
    fireEvent.click(screen.getByTestId("task-plan-toggle"));
    expect(
      screen.getByTestId("task-plan-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("dismisses from the header without expanding, then returns after a plan change", () => {
    const { rerender } = render(<TaskPlanPanel />);
    fireEvent.click(screen.getByLabelText("taskPlanDismiss"));
    expect(screen.queryByTestId("task-plan-panel")).toBeNull();

    const updated = {
      ...SAMPLE,
      steps: SAMPLE.steps.map((s) =>
        s.id === "2-write-main" ? { ...s, status: "done" as const } : s,
      ),
    };
    mockState.history = [
      {
        message: {
          role: "tool",
          content: formatPlanText(updated),
          toolCallId: "p2",
          id: "t2",
        },
        contextItems: [
          {
            name: "Plan",
            description: "updated",
            content: formatPlanText(updated),
            id: { providerTitle: "toolCall", itemId: "p2" },
          },
        ],
      },
    ];
    rerender(<TaskPlanPanel />);
    expect(screen.getByTestId("task-plan-panel")).toBeTruthy();
  });
});
