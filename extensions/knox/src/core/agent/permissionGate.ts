/**
 * One permission decision for a pending tool call, shared by the chat turn
 * runner (K-010) and `/autonomous`: hard policy deny, auto-approve by mode and
 * settings, else ask the user and wait on the approval registry.
 */

import { ToolCallError, ToolCallErrorCode } from "../tools/errors";
import type { AgentToolPolicy } from "../tools/toolPolicy";
import { recentTurnWrites } from "../tools/turnWrites";
import { waitForAutonomousToolApproval } from "./autonomousApproval";
import {
  isHardPolicyDeny,
  isToolAutoApproved,
  type PermissionMode,
  type ToolSetting,
} from "./permissions";

export interface PermissionGateConfig {
  mode: PermissionMode;
  toolSettings: Record<string, ToolSetting>;
  /** Mutated when the user picks "always allow". */
  sessionAllowlist: string[];
  policy?: AgentToolPolicy | null;
  policyFromRules?: AgentToolPolicy | null;
  workspaceDirs?: string[];
  /**
   * Background / unattended runs cannot wait on a permission card. After
   * auto-approve, remaining tools are denied instead of prompting.
   */
  unattended?: boolean;
}

export interface ResolveToolPermissionOptions {
  permission: PermissionGateConfig;
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  abortSignal?: AbortSignal;
  /** Only evaluated when the user has to be asked. */
  callId: () => string;
  /** Render the permission card. */
  onAsk: (callId: string) => void | Promise<void>;
}

export async function resolveToolPermission(
  options: ResolveToolPermissionOptions,
): Promise<"allow" | "deny"> {
  const { permission, toolName, args, abortSignal } = options;
  const recentWrites = recentTurnWrites(options.sessionId);
  const policyInput = {
    toolName,
    args,
    policy: permission.policy,
    policyFromRules: permission.policyFromRules,
    workspaceDirs: permission.workspaceDirs,
    permissionMode: permission.mode,
    recentWrites,
  };
  if (isHardPolicyDeny(policyInput)) {
    return "deny";
  }
  if (
    isToolAutoApproved({
      ...policyInput,
      toolSettings: permission.toolSettings,
      permissionMode: permission.mode,
      sessionAllowlist: permission.sessionAllowlist,
    })
  ) {
    return "allow";
  }
  if (permission.unattended) {
    return "deny";
  }
  const callId = options.callId();
  await options.onAsk(callId);
  const decision = await waitForAutonomousToolApproval({
    sessionId: options.sessionId,
    callId,
    abortSignal,
  });
  if (abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "cancelled",
      toolName,
      retryable: false,
    });
  }
  if (decision.always && !permission.sessionAllowlist.includes(toolName)) {
    permission.sessionAllowlist.push(toolName);
  }
  return decision.allow ? "allow" : "deny";
}
