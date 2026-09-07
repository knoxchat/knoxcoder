/**
 * Caps how many tool→continue rounds a normal Agent chat turn may run
 * before the next LLM call is forced to text-only (OpenCode `steps` pattern).
 *
 * Counted in session.toolLoopSteps; reset on each new user message.
 * Unset / 0 = unlimited (stop with Cancel). Profile defaults live in
 * `core/config/agentProfile` (HL-12).
 */

import {
  ABSOLUTE_MAX_AGENT_STEPS,
  DEFAULT_AGENT_MAX_STEPS,
  resolveAgentMaxSteps as resolveFromProfile,
  resolveAgentProfile,
  type ResolvedAgentProfile,
} from "core/config/agentProfile";

export {
  ABSOLUTE_MAX_AGENT_STEPS,
  DEFAULT_AGENT_MAX_STEPS,
};

export function resolveAgentMaxSteps(
  raw: unknown,
  profile: unknown = "default",
): number | null {
  const resolved: ResolvedAgentProfile = resolveAgentProfile(profile);
  return resolveFromProfile(raw, resolved);
}

export function shouldDisableToolsForMaxSteps(
  toolLoopSteps: number,
  maxSteps: number | null,
): boolean {
  return maxSteps !== null && toolLoopSteps >= maxSteps;
}

export function buildAgentMaxStepsSummaryInstruction(maxSteps: number): string {
  return [
    `[Agent max steps] You have reached the maximum of ${maxSteps} tool rounds for this turn.`,
    "Do not call any tools.",
    "Summarize what you accomplished, what is still unfinished, and the recommended next steps for the user.",
  ].join(" ");
}
