/**
 * New-session permission default.
 *
 * Auto (YOLO) is the product default. Checkpoints restore the tree if a turn
 * goes wrong. `knoxchat.permissionDefault` (`auto` / `edits`) and a saved
 * permission-bar mode for the folder still win. Legacy `ask` is treated as Auto.
 */

import type { IDE, IdeSettings } from "../index.js";

import type { PermissionMode } from "./permissions";

export type PermissionDefaultSetting = "auto" | "edits";
export type PermissionDefaultReason = "saved" | "setting" | "default";

export interface SessionPermissionResolution {
  mode: PermissionMode;
  reason: PermissionDefaultReason;
}

export function permissionModeFromSetting(
  setting: string | null | undefined,
): PermissionMode {
  if (setting === "edits") {
    return "acceptEdits";
  }
  return "fullAuto";
}

export function resolveDefaultPermissionMode(opts: {
  savedMode?: PermissionMode | null;
  setting?: string | null;
}): SessionPermissionResolution {
  if (opts.savedMode === "acceptEdits" || opts.savedMode === "fullAuto") {
    return { mode: opts.savedMode, reason: "saved" };
  }
  if (opts.setting === "auto" || opts.setting === "edits") {
    return {
      mode: permissionModeFromSetting(opts.setting),
      reason: "setting",
    };
  }
  return { mode: "fullAuto", reason: "default" };
}

export function resolveWorkspacePermissionMode(
  _workspaceDir: string | undefined,
  opts?: {
    savedMode?: PermissionMode | null;
    setting?: string | null;
  },
): SessionPermissionResolution {
  return resolveDefaultPermissionMode({
    savedMode: opts?.savedMode,
    setting: opts?.setting,
  });
}

export async function attachSessionPermission(
  serialized: {
    config?: {
      experimental?: {
        sessionPermission?: SessionPermissionResolution;
        permissionDefault?: PermissionDefaultSetting;
      };
    };
  },
  ide: Pick<IDE, "getIdeSettings">,
): Promise<void> {
  if (!serialized.config) {
    return;
  }
  const settings: IdeSettings = await ide.getIdeSettings().catch(() => ({}));
  const sessionPermission = resolveDefaultPermissionMode({
    setting: settings.permissionDefault,
  });
  const permissionDefault =
    settings.permissionDefault === "edits" ||
    settings.permissionDefault === "auto"
      ? settings.permissionDefault
      : undefined;
  serialized.config.experimental = {
    ...serialized.config.experimental,
    sessionPermission,
    ...(permissionDefault ? { permissionDefault } : {}),
  };
}
