import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   dots   — same wavefront, circular cells
 *   orbit  — a comet lapping the grid perimeter
 *
 * Paired with a shimmering label and a live elapsed timer
 * in mono tabular figures. Reduced motion freezes the grid
 * to its dim state; the timer still ticks.
 * ───────────────────────────────────────────────────────── */

export type LoadingVariant = "drive" | "dots" | "orbit";

export interface LoadingStateProps {
  label?: string;
  variant?: LoadingVariant;
  /** Epoch ms when work began. Falls back to mount time. */
  startedAt?: number;
  className?: string;
  testId?: string;
}

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<
  LoadingVariant,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  drive: { delays: chevron, dur: 650, round: false },
  dots: { delays: chevron, dur: 650, round: true },
  orbit: { delays: orbit, dur: 950, round: false },
};

export function formatElapsed(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0.0s";
  }
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m ${(totalSeconds % 60).toFixed(1)}s`;
}

function useElapsed(startedAt?: number) {
  const originRef = useRef(startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt != null && Number.isFinite(startedAt)) {
      originRef.current = startedAt;
    }
  }, [startedAt]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  return formatElapsed(Math.max(0, (now - originRef.current) / 1000));
}

export default function LoadingState({
  label = "Working",
  variant = "drive",
  startedAt,
  className,
  testId = "sent-message-loading-state",
}: LoadingStateProps) {
  const elapsed = useElapsed(startedAt);
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.drive;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`${label} ${elapsed}`}
      data-testid={testId}
      className={cn("knox-loading-state flex w-fit items-center gap-2.5", className)}
    >
      <span
        aria-hidden
        className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]"
        style={{ ["--knox-pixel-dur" as string]: `${dur}ms` }}
      >
        {delays.map((d, i) => (
          <span
            key={i}
            data-pixel
            className={cn(
              "knox-loading-pixel size-[4px] bg-knoxcyan",
              round ? "rounded-full" : "rounded-[1px]",
            )}
            style={{
              opacity: d === null ? 0.07 : 0.16,
              animation:
                d === null
                  ? "none"
                  : `knox-pixel-on var(--knox-pixel-dur) ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        data-shimmer
        className="knox-loading-label bg-clip-text font-medium text-transparent"
      >
        {label}
      </span>
      <span className="text-secgray font-mono tabular-nums tracking-tight">
        {elapsed}
      </span>
    </span>
  );
}
