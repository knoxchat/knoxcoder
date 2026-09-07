import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LastCompactionState } from "../../redux/slices/sessionSlice";

const { dispatch, setLastCompaction, mockState } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  setLastCompaction: vi.fn((payload: LastCompactionState | null) => ({
    type: "session/setLastCompaction",
    payload,
  })),
  mockState: {
    lastCompaction: null as LastCompactionState | null,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { from?: number; to?: number }) => {
      if (opts?.from != null && opts?.to != null) {
        return `${key}:${opts.from}:${opts.to}`;
      }
      return key;
    },
  }),
}));

vi.mock("../../hooks/useWebviewListener", () => ({
  useWebviewListener: () => undefined,
}));

vi.mock("../../redux/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        lastCompaction: mockState.lastCompaction,
      },
    }),
}));

vi.mock("../../redux/slices/sessionSlice", () => ({
  setLastCompaction,
}));

import { CompactionStatusPanel } from "./CompactionStatusPanel";

const SAMPLE: LastCompactionState = {
  tokensSaved: 1200,
  originalMessageCount: 40,
  compactedMessageCount: 18,
  summarized: true,
  deduplicated: true,
  summarizationMethod: "none",
  summaryText: "Kept the kernel plan and latest gcc errors.",
};

describe("CompactionStatusPanel", () => {
  beforeEach(() => {
    dispatch.mockClear();
    setLastCompaction.mockClear();
    mockState.lastCompaction = { ...SAMPLE };
  });

  it("hides when there is no compaction", () => {
    mockState.lastCompaction = null;
    const { container } = render(<CompactionStatusPanel />);
    expect(
      container.querySelector("[data-testid=compaction-status-panel]"),
    ).toBeNull();
  });

  it("shows an attached header with a left chevron toggle", () => {
    render(<CompactionStatusPanel />);
    const panel = screen.getByTestId("compaction-status-panel");
    expect(panel.className).toContain("attached-input-panel");
    expect(screen.getByText("compactionAppliedTitle")).toBeTruthy();
    expect(screen.getByText("compactionMethodNone")).toBeTruthy();
    expect(
      screen.getByTestId("compaction-status-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("expands details on header click like memories and jobs", () => {
    render(<CompactionStatusPanel />);
    fireEvent.click(screen.getByTestId("compaction-status-toggle"));
    expect(
      screen.getByTestId("compaction-status-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText(/compactionStats:40:18/)).toBeTruthy();
    expect(screen.getByText(/Kept the kernel plan/)).toBeTruthy();
  });

  it("dismisses from the header without toggling", () => {
    render(<CompactionStatusPanel />);
    fireEvent.click(screen.getByLabelText("compactionDismiss"));
    expect(setLastCompaction).toHaveBeenCalledWith(null);
    expect(
      screen.getByTestId("compaction-status-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
