import { isAwaitShellKill } from "core/agent/toolBatch";
import {
  DEFAULT_PERMISSION_MODE,
  FILE_EDIT_TOOLS,
  isSamePermissionTool,
  isToolAutoApproved,
  PERMISSION_MODES,
  resolvePermissionToolName,
  type PermissionMode,
} from "core/agent/permissions";
import { DEFAULT_TOOL_SETTING, ToolSetting } from "./toolPermissionDefaults";

export type { PermissionMode };
export {
  DEFAULT_PERMISSION_MODE,
  FILE_EDIT_TOOLS,
  isAwaitShellKill,
  isSamePermissionTool,
  isToolAutoApproved,
  PERMISSION_MODES,
  resolvePermissionToolName,
};

export function nextPermissionMode(current: PermissionMode): PermissionMode {
  const idx = PERMISSION_MODES.indexOf(current);
  return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length];
}

export type ToolPermissionDisplay =
  | "disabled"
  | "autoApprove"
  | "sessionAlways"
  | "requiresApproval";

export function getToolPermissionDisplay(params: {
  toolName: string;
  toolSettings: Record<string, ToolSetting>;
  sessionAllowlist?: string[];
}): ToolPermissionDisplay {
  const toolName = resolvePermissionToolName(params.toolName);
  const setting = params.toolSettings[toolName] ?? DEFAULT_TOOL_SETTING;
  if (setting === "disabled") {
    return "disabled";
  }
  if (setting === "allowedWithoutPermission") {
    return "autoApprove";
  }
  if (
    params.sessionAllowlist?.some((allowed) =>
      isSamePermissionTool(allowed, toolName),
    )
  ) {
    return "sessionAlways";
  }
  return "requiresApproval";
}
