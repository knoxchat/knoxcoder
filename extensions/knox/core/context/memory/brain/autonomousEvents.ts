/**
 * Compact payloads for live `/autonomous` tool cards in Agent chat.
 */

import type { ContextItem } from "../../../index.js";

export const AUTONOMOUS_EVENT_MAX_CHARS = 4_000;
export const AUTONOMOUS_EVENT_MAX_ITEMS = 8;

export function truncateAutonomousText(
  value: string,
  max = AUTONOMOUS_EVENT_MAX_CHARS,
): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n…(truncated)`;
}

export function compactAutonomousArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const raw = JSON.stringify(args);
    if (raw.length <= AUTONOMOUS_EVENT_MAX_CHARS) {
      return args;
    }
    return { _truncated: true, preview: raw.slice(0, AUTONOMOUS_EVENT_MAX_CHARS) };
  } catch {
    return {};
  }
}

export function compactAutonomousOutput(output: ContextItem[]): ContextItem[] {
  return output.slice(0, AUTONOMOUS_EVENT_MAX_ITEMS).map((item) => ({
    ...item,
    content: truncateAutonomousText(item.content ?? ""),
  }));
}
