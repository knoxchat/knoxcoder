/**
 * KN-350: AgentModeManager is one boolean switch that mirrors GUI
 * `session.mode === "agent"`. PROCESSING / ERROR stay "on" so undo
 * keybindings and checkpoint session binding do not drop mid-turn.
 */
export enum AgentModeStatus {
  INACTIVE = "inactive",
  ACTIVE = "active",
  PROCESSING = "processing",
  ERROR = "error",
}

export const AGENT_MODE_CONTEXT_KEY = "knoxAgentModeActive";

export function isAgentModeStatusOn(status: AgentModeStatus | string): boolean {
  return status !== AgentModeStatus.INACTIVE && status !== "inactive";
}
