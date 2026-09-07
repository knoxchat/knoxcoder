/**
 * Phase 7 startup timing. Grep the Extension Host log for `[knox-startup]`.
 * Durations are milliseconds from `activate()` start unless noted.
 */

const origin = performance.now();
const marks = new Map<string, number>();

export function knoxStartupMark(name: string, extra?: string): void {
  const at = performance.now();
  marks.set(name, at);
  const fromActivate = (at - origin).toFixed(1);
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[knox-startup] ${name}: ${fromActivate}ms (since activate)${suffix}`);
}

export function knoxStartupDuration(from: string, to: string): number | undefined {
  const a = marks.get(from);
  const b = marks.get(to);
  if (a === undefined || b === undefined) {
    return undefined;
  }
  return b - a;
}
