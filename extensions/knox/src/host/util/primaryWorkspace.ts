import * as vscode from "vscode";

import { orderFoldersActiveFirst } from "./workspaceRoots";

/** Workspace folders with the one owning the active editor file first. */
export function orderedWorkspaceFolders(): vscode.WorkspaceFolder[] {
  const editor = vscode.window.activeTextEditor;
  return orderFoldersActiveFirst(
    (vscode.workspace.workspaceFolders ?? []).map((f) => ({ fsPath: f.uri.fsPath, folder: f })),
    editor?.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined,
  ).map((entry) => entry.folder);
}

/** Primary root for multi-root workspaces (active file's folder, else first). */
export function primaryWorkspaceFsPath(): string | undefined {
  return orderedWorkspaceFolders()[0]?.uri.fsPath;
}
