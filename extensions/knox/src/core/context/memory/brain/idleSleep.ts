/**
 * MEM-74 — φ₇ on schedule and when a scope is idle.
 *
 * The 24h timer still runs (`manager/consolidation.ts`). Idle sleep fires per
 * session after `consolidate_active_session_minutes` with no turn. Not per turn.
 */

import { getTheoremParamsV2 } from "./memoryConfigAccess.js";
import { SleepConsolidation, type SleepCycleResult } from "./SleepConsolidation.js";

const lastActivity = new Map<string, number>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let running = false;

export type IdleSleepTrigger = "timer" | "idle" | "manual";

function idleWindowMs(): number {
  try {
    const minutes = getTheoremParamsV2().activeSessionMinutes;
    return Math.max(1, Math.floor(Number(minutes) || 30)) * 60 * 1000;
  } catch {
    return 30 * 60 * 1000;
  }
}

function clearPending(sessionId: string): void {
  const t = pending.get(sessionId);
  if (t) {
    clearTimeout(t);
    pending.delete(sessionId);
  }
}

/** Record a turn so the idle timer resets. Does not run sleep. */
export function noteScopeActivity(sessionId: string, nowMs: number = Date.now()): void {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return;
  lastActivity.set(sid, nowMs);
  clearPending(sid);
  const wait = idleWindowMs();
  const timer = setTimeout(() => {
    pending.delete(sid);
    void runIdleSleep(sid);
  }, wait);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
  pending.set(sid, timer);
}

export async function runIdleSleep(
  sessionId: string,
  nowMs: number = Date.now(),
): Promise<SleepCycleResult | null> {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  const last = lastActivity.get(sid) ?? 0;
  if (nowMs - last < idleWindowMs() - 25) return null;
  if (running) return null;
  running = true;
  try {
    return await SleepConsolidation.runCycle({ trigger: "idle", sessionId: sid });
  } catch {
    return null;
  } finally {
    running = false;
  }
}

/** Test helper: fire idle sleep when the injected clock is past the window. */
export async function runIdleSleepIfDue(options: {
  sessionId?: string;
  nowMs?: number;
  idleMinutes?: number;
} = {}): Promise<SleepCycleResult | null> {
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.idleMinutes != null
    ? Math.max(0, options.idleMinutes) * 60 * 1000
    : idleWindowMs();
  const ids = options.sessionId
    ? [options.sessionId]
    : [...lastActivity.keys()];
  for (const sid of ids) {
    const last = lastActivity.get(sid) ?? 0;
    if (nowMs - last < windowMs) continue;
    if (running) return null;
    running = true;
    try {
      return await SleepConsolidation.runCycle({ trigger: "idle", sessionId: sid });
    } catch {
      return null;
    } finally {
      running = false;
    }
  }
  return null;
}

export function lastScopeActivity(sessionId: string): number | undefined {
  return lastActivity.get(sessionId);
}

export function resetIdleSleepForTests(): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  lastActivity.clear();
  running = false;
}
