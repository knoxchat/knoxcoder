import type { Session } from "../index.js";

/**
 * K-043: a stored session cannot grow without bound. When its JSON exceeds the cap, the largest
 * strings (tool output, pasted files) in the OLDEST messages are shortened to head + tail with a
 * marker, until it fits. No message is removed, and recent messages stay intact.
 */

export const STORED_SESSION_MAX_BYTES = 20_000_000;
const KEEP_CHARS = 2_000;
const MIN_SHRINK_CHARS = 8_000;
export const SESSION_TRUNCATION_MARKER = "\n[… truncated to keep the saved session small …]\n";

function shrinkString(value: string): string {
  if (value.length <= MIN_SHRINK_CHARS) {
    return value;
  }
  return value.slice(0, KEEP_CHARS) + SESSION_TRUNCATION_MARKER + value.slice(-KEEP_CHARS);
}

function shrinkValue(value: unknown): unknown {
  if (typeof value === "string") {
    return shrinkString(value);
  }
  if (Array.isArray(value)) {
    return value.map(shrinkValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, shrinkValue(inner)]),
    );
  }
  return value;
}

export function capSessionForStorage(
  session: Session,
  maxBytes = STORED_SESSION_MAX_BYTES,
): { session: Session; shrunk: number; bytes: number } {
  const sizeOf = (item: unknown) => Buffer.byteLength(JSON.stringify(item) ?? "");
  const sizes = session.history.map(sizeOf);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= maxBytes) {
    return { session, shrunk: 0, bytes: total };
  }
  const history = session.history.slice();
  let shrunk = 0;
  for (let i = 0; i < history.length && total > maxBytes; i++) {
    if (sizes[i] <= MIN_SHRINK_CHARS) {
      continue;
    }
    const next = shrinkValue(history[i]) as (typeof history)[number];
    const nextSize = sizeOf(next);
    if (nextSize < sizes[i]) {
      total -= sizes[i] - nextSize;
      history[i] = next;
      shrunk++;
    }
  }
  return { session: { ...session, history }, shrunk, bytes: total };
}
