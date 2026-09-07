/**
 * Shared Agent permission rules (GUI chat + `/autonomous` + `runAgentLoop`).
 *
 * Ask/accept/fullAuto live here so headless loops use the same auto-approve
 * decision as the product permission bar.
 */

import { BuiltInToolNames, resolveBuiltInToolName } from "../tools/builtIn";
import { parseToolArgs } from "../tools/postEditVerification";
import {
  evaluateToolPolicy,
  policyBlocksAutoApprove,
  policyForcesAutoApprove,
  resolveConfigAgentPolicy,
  type AgentToolPolicy,
} from "../tools/toolPolicy";

export type PermissionMode = "default" | "acceptEdits" | "fullAuto";

export const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "fullAuto",
];

/** New sessions and missing persisted values start in Auto (YOLO). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "fullAuto";

export type ToolSetting =
  | "allowedWithPermission"
  | "allowedWithoutPermission"
  | "disabled";

export const DEFAULT_TOOL_SETTING: ToolSetting = "allowedWithoutPermission";

export const FILE_EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.GenerateTests,
  "composite_smart_edit",
]);

export function resolvePermissionToolName(
  name: string | undefined | null,
): string {
  return resolveBuiltInToolName(name) || name?.trim() || "";
}

export function isSamePermissionTool(
  left: string | undefined | null,
  right: string | undefined | null,
): boolean {
  const a = resolvePermissionToolName(left);
  const b = resolvePermissionToolName(right);
  return a.length > 0 && a === b;
}

export function isHardPolicyDeny(params: {
  toolName: string;
  args?: unknown;
  policy?: AgentToolPolicy | null;
  policyFromRules?: AgentToolPolicy | null;
  workspaceDirs?: string[];
}): boolean {
  const decision = evaluateToolPolicy({
    toolName: resolvePermissionToolName(params.toolName),
    args: params.args,
    policy: resolveConfigAgentPolicy({
      agentPolicy: params.policy,
      agentPolicyFromRules: params.policyFromRules,
    }),
    workspaceDirs: params.workspaceDirs,
  });
  return decision.action === "deny";
}

export function isToolAutoApproved(params: {
  toolName: string;
  toolSettings: Record<string, ToolSetting>;
  permissionMode: PermissionMode;
  sessionAllowlist?: string[];
  args?: unknown;
  policy?: AgentToolPolicy | null;
  policyFromRules?: AgentToolPolicy | null;
  workspaceDirs?: string[];
}): boolean {
  const toolName = resolvePermissionToolName(params.toolName);
  const setting =
    params.toolSettings[toolName] ??
    params.toolSettings[params.toolName] ??
    DEFAULT_TOOL_SETTING;
  if (setting === "disabled") {
    return false;
  }
  if (toolName === BuiltInToolNames.AskUser) {
    return false;
  }
  if (toolName === BuiltInToolNames.WorkspaceCheckpoint) {
    const parsed = parseToolArgs(params.args) ?? {};
    if (parsed.action === "restore" || parsed.action === "delete") {
      return false;
    }
  }

  const decision = evaluateToolPolicy({
    toolName,
    args: params.args,
    policy: resolveConfigAgentPolicy({
      agentPolicy: params.policy,
      agentPolicyFromRules: params.policyFromRules,
    }),
    workspaceDirs: params.workspaceDirs,
  });
  if (policyBlocksAutoApprove(decision, params.permissionMode)) {
    return false;
  }
  if (policyForcesAutoApprove(decision)) {
    return true;
  }

  if (
    params.sessionAllowlist?.some((allowed) =>
      isSamePermissionTool(allowed, toolName),
    )
  ) {
    return true;
  }
  if (params.permissionMode === "fullAuto") {
    return true;
  }
  if (
    params.permissionMode === "acceptEdits" &&
    FILE_EDIT_TOOLS.has(toolName)
  ) {
    return true;
  }
  return setting === "allowedWithoutPermission";
}
