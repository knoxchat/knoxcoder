/**
 * K-091: last mutating file paths this session/turn, used by the command
 * guard to catch "write a script, then run it".
 */

const LAST_N = 16;

const writesBySession = new Map<string, string[]>();

function keyOf(sessionId?: string): string {
  const trimmed = sessionId?.trim();
  return trimmed && trimmed.length ? trimmed : "anon";
}

export function recordTurnWrites(
  sessionId: string | undefined,
  paths: string[],
): void {
  if (!paths.length) {
    return;
  }
  const key = keyOf(sessionId);
  const cur = writesBySession.get(key) ?? [];
  for (const raw of paths) {
    const path = raw.trim();
    if (path) {
      cur.push(path);
    }
  }
  writesBySession.set(key, cur.slice(-LAST_N));
}

export function recentTurnWrites(sessionId?: string): string[] {
  return [...(writesBySession.get(keyOf(sessionId)) ?? [])];
}

/** Test helper. */
export function resetTurnWrites(sessionId?: string): void {
  if (sessionId === undefined) {
    writesBySession.clear();
    return;
  }
  writesBySession.delete(keyOf(sessionId));
}
