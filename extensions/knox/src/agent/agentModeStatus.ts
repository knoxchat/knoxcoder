import { AgentModeStatus } from "./AgentModeManager";

/**
 * Extension agent features (checkpoints, undo keybindings, file watchers)
 * are on for any non-inactive status, including processing / transient error.
 */
export function isAgentModeStatusOn(status: AgentModeStatus | string): boolean {
  return status !== AgentModeStatus.INACTIVE && status !== "inactive";
}
