import { workspace } from "vscode";

export const KNOX_WORKSPACE_KEY = "knoxchat";

export function getKnoxWorkspaceConfig() {
  return workspace.getConfiguration(KNOX_WORKSPACE_KEY);
}
