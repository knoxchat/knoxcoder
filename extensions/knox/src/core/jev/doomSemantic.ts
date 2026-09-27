/**
 * Semantic doom-loop: same failed strategy, not identical fingerprints.
 *
 * Fail-open to "not a doom loop". Fingerprint `detectDoomLoop` still runs first.
 */

import {
  detectDoomLoop,
  isFailedToolCall,
  type DoomLoopCall,
  type DoomLoopHit,
} from "../agent/doomLoop";
import { createKnoxLogger } from "../util/knoxLog";
import { asNoul } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime, getJevUserMessage } from "./config";
import {
  DOOM_ARGS_MAX_CHARS,
  DOOM_OUTPUT_HEAD_CHARS,
  DOOM_SEMANTIC_MIN_CALLS,
  DOOM_SEMANTIC_WINDOW,
  PROGRESS_MADE_MIN,
  REPEATING_STRATEGY_HIT,
  progressMadeQuestion,
  repeatingFailedStrategyQuestion,
} from "./questions";
import type { JevClient, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function argsPreview(args: unknown): string {
  try {
    return truncate(JSON.stringify(args ?? {}), DOOM_ARGS_MAX_CHARS);
  } catch {
    return "{}";
  }
}

function outputHead(call: DoomLoopCall): string {
  const text =
    call.output ??
    (call.items ?? []).map((item) => item.content ?? "").join("\n");
  return truncate(text, DOOM_OUTPUT_HEAD_CHARS);
}

function sameNameRepeat(window: DoomLoopCall[]): boolean {
  const counts = new Map<string, number>();
  for (const call of window) {
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 2);
}

/** Cheap prefilter so healthy edit→rebuild traces skip the Jev round-trip. */
export function shouldAssessSemanticDoom(calls: DoomLoopCall[]): boolean {
  const window = calls.slice(-DOOM_SEMANTIC_WINDOW);
  if (window.length < DOOM_SEMANTIC_MIN_CALLS) {
    return false;
  }
  const fails = window.filter((call) => isFailedToolCall(call)).length;
  return sameNameRepeat(window) || fails >= 2;
}

function semanticHit(window: DoomLoopCall[]): DoomLoopHit {
  const last = window[window.length - 1];
  return {
    kind: "same_strategy",
    threshold: DOOM_SEMANTIC_MIN_CALLS,
    count: window.length,
    fingerprint: `same_strategy::${window.map((call) => call.name).join(",")}`,
    toolName: last?.name,
  };
}

export async function assessSemanticDoom(input: {
  calls: DoomLoopCall[];
  userMessage?: string;
  runtime?: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}): Promise<DoomLoopHit | null> {
  if (!shouldAssessSemanticDoom(input.calls)) {
    return null;
  }
  const runtime = input.runtime ?? getActiveJevRuntime();
  const client = resolveJevClient(runtime, input.client);
  if (!runtime.enabled || !client) {
    return null;
  }

  const window = input.calls.slice(-DOOM_SEMANTIC_WINDOW);
  const userMessage = truncate(
    input.userMessage?.trim() || getJevUserMessage(),
    4_000,
  );

  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          user_message: userMessage,
          recent_calls: window.map((call) => ({
            name: call.name,
            args: argsPreview(call.args),
            ok: call.ok !== false && !isFailedToolCall(call),
            output_head: outputHead(call),
          })),
        },
        questions: {
          repeating_failed_strategy: repeatingFailedStrategyQuestion(),
          progress_made: progressMadeQuestion(),
        },
      },
      { signal: input.abortSignal, timeoutMs: runtime.timeoutMs },
    );
    const repeating =
      asNoul(result.answers, "repeating_failed_strategy")?.noul ?? 0;
    const progress = asNoul(result.answers, "progress_made")?.noul ?? 1;
    if (repeating >= REPEATING_STRATEGY_HIT && progress < PROGRESS_MADE_MIN) {
      const hit = semanticHit(window);
      log.info(
        `doom same_strategy repeating=${repeating.toFixed(2)} progress=${progress.toFixed(2)} tool=${hit.toolName ?? "-"}`,
      );
      return hit;
    }
    return null;
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `semantic doom failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Fingerprint first. Only ask Jev after a miss.
 * `threshold: null | 0` disables both.
 */
export async function detectDoomLoopWithJev(
  calls: DoomLoopCall[],
  options?: {
    threshold?: number | null;
    userMessage?: string;
    runtime?: JevRuntime;
    client?: JevClient;
    abortSignal?: AbortSignal;
  },
): Promise<DoomLoopHit | null> {
  const fingerprint = detectDoomLoop(calls, { threshold: options?.threshold });
  if (fingerprint) {
    return fingerprint;
  }
  if (options?.threshold === null || options?.threshold === 0) {
    return null;
  }
  return assessSemanticDoom({
    calls,
    userMessage: options?.userMessage,
    runtime: options?.runtime,
    client: options?.client,
    abortSignal: options?.abortSignal,
  });
}
