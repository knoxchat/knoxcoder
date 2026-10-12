/**
 * Replay metrics for the Dashboard (MC-71). Pure: the host writes one audit event per replay and
 * per revert, and this file turns events into the numbers shown (and the numbers eval runs check).
 *
 * Definitions, kept deliberately conservative:
 * - `llmCallsAvoided`: an `exact` replay that applied. An `adapt` replay still spends one call.
 * - `tokensSaved`: estimated *output* tokens the model would have written for the same files
 *   (4 chars per token, like `estimateTokens`), minus the adapt reply when one was needed.
 *   Input tokens are not counted (see the MC-32 note: they can be higher).
 * - A replay "attempt" is one that touched files: `applied` or `failed_verify`. Refused, drifted
 *   and failed-apply runs changed nothing that stayed, so they are not attempts.
 * - Wrong apply = an attempt that failed verification, or an applied replay the user later reverted.
 */

import type { ReplayResult } from "./replayer.js";

export const RECIPE_REPLAY_ACTION = "recipe_replay" as const;
export const RECIPE_REVERT_ACTION = "recipe_revert" as const;

export interface RecipeMetricEventLike {
  action: string;
  counts?: Record<string, number>;
  details?: Record<string, unknown>;
}

export interface RecipeMetricsSummary {
  attempts: number;
  applied: number;
  failedVerify: number;
  reverted: number;
  llmCallsAvoided: number;
  tokensSaved: number;
  /** 0..1, or 0 when there were no attempts. */
  wrongApplyRate: number;
}

export const emptyRecipeMetrics = (): RecipeMetricsSummary => ({
  attempts: 0,
  applied: 0,
  failedVerify: 0,
  reverted: 0,
  llmCallsAvoided: 0,
  tokensSaved: 0,
  wrongApplyRate: 0,
});

const tokens = (text: string): number => Math.ceil(text.length / 4);

/** Audit event for a finished replay, or undefined when nothing was attempted. */
export function replayAuditEvent(
  result: Pick<ReplayResult, "status" | "recipeId" | "appliedPaths">,
  input: { mode: "exact" | "adapt"; writtenText: readonly string[]; adaptReply?: string },
): { action: typeof RECIPE_REPLAY_ACTION; resourceId: string; outcome: "success" | "failure"; counts: Record<string, number>; details: Record<string, unknown> } | undefined {
  if (result.status !== "applied" && result.status !== "failed_verify") return undefined;
  const applied = result.status === "applied";
  const generated = input.writtenText.reduce((sum, text) => sum + tokens(text), 0);
  const saved = applied ? Math.max(0, generated - (input.adaptReply ? tokens(input.adaptReply) : 0)) : 0;
  return {
    action: RECIPE_REPLAY_ACTION,
    resourceId: result.recipeId,
    outcome: applied ? "success" : "failure",
    counts: {
      files: result.appliedPaths.length,
      llmCallsAvoided: applied && input.mode === "exact" ? 1 : 0,
      tokensSaved: saved,
    },
    details: { status: result.status, mode: input.mode },
  };
}

export function revertAuditEvent(recipeId: string): { action: typeof RECIPE_REVERT_ACTION; resourceId: string; outcome: "success"; details: Record<string, unknown> } {
  return { action: RECIPE_REVERT_ACTION, resourceId: recipeId, outcome: "success", details: { reason: "restore" } };
}

export function summarizeRecipeMetrics(events: readonly RecipeMetricEventLike[]): RecipeMetricsSummary {
  const out = emptyRecipeMetrics();
  for (const event of events) {
    if (event.action === RECIPE_REPLAY_ACTION) {
      const status = event.details?.status;
      if (status === "applied") out.applied += 1;
      else if (status === "failed_verify") out.failedVerify += 1;
      else continue;
      out.llmCallsAvoided += event.counts?.llmCallsAvoided ?? 0;
      out.tokensSaved += event.counts?.tokensSaved ?? 0;
    } else if (event.action === RECIPE_REVERT_ACTION) {
      out.reverted += 1;
    }
  }
  out.attempts = out.applied + out.failedVerify;
  out.wrongApplyRate = out.attempts === 0 ? 0 : Math.min(1, (out.failedVerify + out.reverted) / out.attempts);
  return out;
}
