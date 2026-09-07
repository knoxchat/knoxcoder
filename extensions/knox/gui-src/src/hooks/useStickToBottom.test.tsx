import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStickToBottom } from "./useStickToBottom";

function mockScrollerMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
}

function InteractiveHarness({ startRows }: { startRows: number }) {
  const [rows, setRows] = useState(startRows);
  const { scrollRef } = useStickToBottom({
    follow: true,
    contentKey: rows,
    resetKey: true,
  });
  return (
    <div>
      <button type="button" onClick={() => setRows((n) => n + 1)}>
        add
      </button>
      <div
        ref={scrollRef}
        data-testid="scroller"
        style={{ height: 80, overflow: "auto" }}
      >
        <div style={{ height: rows * 40 }}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} style={{ height: 40 }}>
              row {i}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

describe("useStickToBottom", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pins to the bottom while following new rows", () => {
    const { getByTestId, getByText } = render(
      <InteractiveHarness startRows={5} />,
    );
    const scroller = getByTestId("scroller");
    const metrics = { scrollHeight: 200, clientHeight: 80 };
    mockScrollerMetrics(scroller, metrics);

    metrics.scrollHeight = 240;
    fireEvent.click(getByText("add"));

    expect(scroller.scrollTop).toBe(240);
  });

  it("stops following after the user scrolls up", () => {
    const { getByTestId, getByText } = render(
      <InteractiveHarness startRows={6} />,
    );
    const scroller = getByTestId("scroller");
    const metrics = { scrollHeight: 240, clientHeight: 80 };
    mockScrollerMetrics(scroller, metrics);

    scroller.scrollTop = 160;
    fireEvent.scroll(scroller);
    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);

    metrics.scrollHeight = 280;
    fireEvent.click(getByText("add"));

    expect(scroller.scrollTop).toBe(40);
  });

  it("resumes following after the user scrolls back to the bottom", () => {
    const { getByTestId, getByText } = render(
      <InteractiveHarness startRows={6} />,
    );
    const scroller = getByTestId("scroller");
    const metrics = { scrollHeight: 240, clientHeight: 80 };
    mockScrollerMetrics(scroller, metrics);

    scroller.scrollTop = 20;
    fireEvent.scroll(scroller);
    scroller.scrollTop = 160;
    fireEvent.scroll(scroller);

    metrics.scrollHeight = 320;
    fireEvent.click(getByText("add"));

    expect(scroller.scrollTop).toBe(320);
  });

  it("pauses on wheel-up the same way chat streaming does", () => {
    const { getByTestId, getByText } = render(
      <InteractiveHarness startRows={6} />,
    );
    const scroller = getByTestId("scroller");
    const metrics = { scrollHeight: 240, clientHeight: 80 };
    mockScrollerMetrics(scroller, metrics);
    scroller.scrollTop = 160;

    fireEvent.wheel(scroller, { deltaY: -24 });

    metrics.scrollHeight = 280;
    fireEvent.click(getByText("add"));

    expect(scroller.scrollTop).toBe(160);
  });
});
