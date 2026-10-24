import * as vscode from "vscode";

import {
  applyBrainEnabledSetting,
  applyBrainWorkspaceEnabledSetting,
} from "core/context/memory/brain/store/dbSafety";

export interface MemoryBrainSettings {
  enabled: boolean;
  workspaceEnabled: boolean;
}

export function readMemoryBrainSettings(): MemoryBrainSettings {
  const cfg = vscode.workspace.getConfiguration("knoxchat");
  return {
    enabled: cfg.get<boolean>("memoryBrain.enabled", true) !== false,
    workspaceEnabled: cfg.get<boolean>("memoryBrain.workspaceEnabled", true) !== false,
  };
}

export async function writeMemoryBrainSettings(
  patch: Partial<MemoryBrainSettings>,
): Promise<MemoryBrainSettings> {
  const cfg = vscode.workspace.getConfiguration("knoxchat");
  if (typeof patch.enabled === "boolean") {
    await cfg.update("memoryBrain.enabled", patch.enabled, vscode.ConfigurationTarget.Global);
  }
  if (typeof patch.workspaceEnabled === "boolean") {
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await cfg.update("memoryBrain.workspaceEnabled", patch.workspaceEnabled, target);
  }
  const next = readMemoryBrainSettings();
  applyBrainEnabledSetting(next.enabled);
  applyBrainWorkspaceEnabledSetting(next.workspaceEnabled);
  return next;
}
