/**
 * Reasoning effort as OpenRouter / KnoxStudio document it
 * (https://openrouter.ai/docs/api_reference/parameters#reasoning-effort):
 *
 *   `reasoning_effort` is one of xhigh, high, medium, low, minimal, none.
 *
 * `max` is not a `reasoning_effort` value. It is a `verbosity` level (xhigh and max exist for
 * Claude Opus-class models, where `verbosity` maps to Anthropic `output_config.effort`). So a
 * UI/sidecar effort of "max" is sent as `reasoning_effort: "xhigh"` plus `verbosity: "max"`,
 * and anything outside both sets is dropped instead of being forwarded to fail upstream.
 */

/** Documented `reasoning_effort` values, lowest to highest. */
export const REASONING_EFFORT_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];

/** `max` is selectable for some models but travels as `verbosity`. */
export const REASONING_EFFORT_MAX = "max";

export function isReasoningEffortLevel(
  value: string,
): value is ReasoningEffortLevel {
  return (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);
}

export interface ReasoningRequestParams {
  reasoning_effort?: ReasoningEffortLevel;
  verbosity?: "max";
}

/** Map a selected effort to request fields. Empty object when the value is unusable. */
export function reasoningRequestParams(
  effort: string | undefined | null,
): ReasoningRequestParams {
  const value = (effort ?? "").trim().toLowerCase();
  if (!value) {
    return {};
  }
  if (isReasoningEffortLevel(value)) {
    return { reasoning_effort: value };
  }
  if (value === REASONING_EFFORT_MAX) {
    return { reasoning_effort: "xhigh", verbosity: "max" };
  }
  return {};
}
