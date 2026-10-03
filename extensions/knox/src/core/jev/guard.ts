/**
 * Transparency + latency protection for Jev calls (K-007).
 *
 * Wraps a JevClient with:
 *  - a hard per-call budget (gates 800 ms, everything else 2 s) enforced with a race,
 *    so a blackholed network never adds more than the budget to a chat turn;
 *  - a circuit breaker: after N consecutive failures Jev is skipped for M minutes
 *    (calls reject immediately and callers fail open to their heuristics);
 *  - an in-memory activity log + listeners so the host can show a status bar
 *    indicator and an output channel.
 *
 * What is sent: only the `state` (user message, recent turn summaries, tool names
 * and truncated assistant text) and the question set. No file contents are sent.
 */
import { createKnoxLogger } from "../util/knoxLog";
import { JevClientError } from "./errors";
import type {
  JevClient,
  JevSystemOneRequest,
  JevSystemOneResult,
} from "./types";

const log = createKnoxLogger("jev");

export type JevCallPurpose = "gate" | "route" | "score";

export const JEV_GATE_BUDGET_MS = 800;
export const JEV_DEFAULT_BUDGET_MS = 2_000;
export const JEV_BREAKER_FAILURES = 3;
export const JEV_BREAKER_COOLDOWN_MS = 5 * 60_000;
const JEV_LOG_MAX = 200;

export type JevLogOutcome = "ok" | "error" | "timeout" | "skipped";

export interface JevLogEntry {
  at: number;
  purpose: JevCallPurpose | "unspecified";
  questions: string[];
  outcome: JevLogOutcome;
  ms: number;
  error?: string;
}

export interface JevActivityState {
  inFlight: number;
  breakerOpenUntil: number;
  consecutiveFailures: number;
  lastCallAt?: number;
}

export interface JevGuardOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export function budgetForPurpose(
  purpose: JevCallPurpose | undefined,
  requested?: number,
): number {
  const cap = purpose === "gate" ? JEV_GATE_BUDGET_MS : JEV_DEFAULT_BUDGET_MS;
  return requested && requested > 0 ? Math.min(requested, cap) : cap;
}

const entries: JevLogEntry[] = [];
const listeners = new Set<(entry: JevLogEntry, state: JevActivityState) => void>();
const stateListeners = new Set<(state: JevActivityState) => void>();
const state: JevActivityState = {
  inFlight: 0,
  breakerOpenUntil: 0,
  consecutiveFailures: 0,
};

export function getJevActivityState(): JevActivityState {
  return { ...state };
}

export function getJevLogEntries(): JevLogEntry[] {
  return entries.slice();
}

export function onJevLog(
  listener: (entry: JevLogEntry, state: JevActivityState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onJevActivity(
  listener: (state: JevActivityState) => void,
): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function resetJevGuardForTests(): void {
  entries.length = 0;
  state.inFlight = 0;
  state.breakerOpenUntil = 0;
  state.consecutiveFailures = 0;
  state.lastCallAt = undefined;
}

export function formatJevLogEntry(entry: JevLogEntry): string {
  const time = new Date(entry.at).toISOString();
  const tail = entry.error ? ` ${entry.error}` : "";
  return `${time} ${entry.outcome} ${entry.purpose} ${entry.ms}ms [${entry.questions.join(",")}]${tail}`;
}

function emitState(): void {
  const snapshot = getJevActivityState();
  for (const listener of stateListeners) {
    try {
      listener(snapshot);
    } catch {
      // listeners must never break a Jev call
    }
  }
}

function record(entry: JevLogEntry): void {
  entries.push(entry);
  if (entries.length > JEV_LOG_MAX) {
    entries.splice(0, entries.length - JEV_LOG_MAX);
  }
  const snapshot = getJevActivityState();
  for (const listener of listeners) {
    try {
      listener(entry, snapshot);
    } catch {
      // ignore
    }
  }
  log.debug(formatJevLogEntry(entry));
}

export function wrapJevClientWithGuard(
  inner: JevClient,
  options: JevGuardOptions = {},
): JevClient {
  const threshold = options.failureThreshold ?? JEV_BREAKER_FAILURES;
  const cooldownMs = options.cooldownMs ?? JEV_BREAKER_COOLDOWN_MS;
  const now = options.now ?? Date.now;

  return {
    async systemOne(
      request: JevSystemOneRequest,
      callOptions?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        purpose?: JevCallPurpose;
      },
    ): Promise<JevSystemOneResult> {
      const purpose = callOptions?.purpose;
      const questions = Object.keys(request.questions ?? {});
      const base = {
        purpose: purpose ?? ("unspecified" as const),
        questions,
      };
      const startedAt = now();

      if (state.breakerOpenUntil > startedAt) {
        const error = `circuit open for ${Math.ceil((state.breakerOpenUntil - startedAt) / 1000)}s more`;
        record({ ...base, at: startedAt, outcome: "skipped", ms: 0, error });
        throw new JevClientError(`Jev skipped: ${error}`);
      }

      const budget = budgetForPurpose(purpose, callOptions?.timeoutMs);
      const controller = new AbortController();
      const onUserAbort = () => controller.abort(callOptions?.signal?.reason);
      if (callOptions?.signal?.aborted) {
        onUserAbort();
      } else {
        callOptions?.signal?.addEventListener("abort", onUserAbort, { once: true });
      }

      state.inFlight++;
      state.lastCallAt = startedAt;
      emitState();

      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const hardStop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new JevClientError(`Jev exceeded ${budget}ms budget`));
        }, budget);
      });

      try {
        const result = await Promise.race([
          inner.systemOne(request, {
            signal: controller.signal,
            timeoutMs: budget,
          }),
          hardStop,
        ]);
        state.consecutiveFailures = 0;
        record({ ...base, at: startedAt, outcome: "ok", ms: now() - startedAt });
        return result;
      } catch (error) {
        const userAborted = callOptions?.signal?.aborted === true && !timedOut;
        const message = error instanceof Error ? error.message : String(error);
        if (!userAborted) {
          state.consecutiveFailures++;
          if (state.consecutiveFailures >= threshold) {
            state.breakerOpenUntil = now() + cooldownMs;
            state.consecutiveFailures = 0;
            log.warn(
              `Jev circuit opened after ${threshold} consecutive failures; skipping for ${Math.round(cooldownMs / 60_000)} min`,
            );
          }
        }
        record({
          ...base,
          at: startedAt,
          outcome: timedOut || /timed out|budget/i.test(message) ? "timeout" : "error",
          ms: now() - startedAt,
          error: message.slice(0, 200),
        });
        throw error;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        callOptions?.signal?.removeEventListener("abort", onUserAbort);
        state.inFlight--;
        emitState();
      }
    },
  };
}
