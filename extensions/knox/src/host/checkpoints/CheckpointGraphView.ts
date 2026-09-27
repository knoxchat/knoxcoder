import * as vscode from "vscode";

/**
 * KN-332: leftover Vite webview constructor is gone.
 * createOrShow opens the native checkpoint-graph editor.
 */
export class CheckpointGraphView {
  private static onUpdated: (() => void) | undefined;

  static setNotifier(handler: (() => void) | undefined): void {
    CheckpointGraphView.onUpdated = handler;
  }

  static createOrShow(_context: vscode.ExtensionContext): void {
    void vscode.commands.executeCommand("workbench.action.knox.openCheckpointGraph");
  }

  static notifyHistoryChanged(): void {
    CheckpointGraphView.onUpdated?.();
  }
}
