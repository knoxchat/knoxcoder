/**
 * Jev does not allow, deny, or rewrite tool calls.
 * User approval and agent policy decide whether a tool runs.
 */

export type ToolGateAction = "allow" | "ask" | "deny";

export interface ToolGateResult {
  source: "jev" | "heuristic";
  action: ToolGateAction;
  reason: string;
}

const JEV_TOOL_DENIAL =
  /tool path does not match the request|tool is not relevant to the request|jev-denied|jev_denied|pick a different tool that matches the user request/i;

/** Jev never selects which tools may run. */
export function shouldGateTool(_toolName: string): boolean {
  return false;
}

const ALLOW: ToolGateResult = {
  source: "heuristic",
  action: "allow",
  reason: "Jev does not gate tool calls",
};

export async function gateToolCall(_input?: {
  toolName?: string;
  args?: unknown;
  toolDescription?: string;
  userMessage?: string;
  permissionMode?: string;
  runtime?: unknown;
  client?: unknown;
  abortSignal?: AbortSignal;
}): Promise<ToolGateResult> {
  return ALLOW;
}

/** Recalled text that records an old Jev tool denial. */
export function isJevToolDenialText(text: string): boolean {
  return JEV_TOOL_DENIAL.test(text);
}

/** Drop lines that would tell the model a tool is banned because Jev denied it. */
export function omitJevToolDenialLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isJevToolDenialText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
