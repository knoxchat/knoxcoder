import * as vscode from "vscode";

/**
 * KN-332: leftover Vite webview constructor is gone.
 * createOrShow opens the native checkpoint-graph editor.
 */
export class CheckpointGraphView {
  private static onUpdated: (() => void) | undefined;
  private static onSelect: ((checkpointId: string) => void) | undefined;

  static setNotifier(handler: (() => void) | undefined): void {
    CheckpointGraphView.onUpdated = handler;
  }

  static setSelectHandler(handler: ((checkpointId: string) => void) | undefined): void {
    CheckpointGraphView.onSelect = handler;
  }

  static createOrShow(_context: vscode.ExtensionContext): void {
    void vscode.commands.executeCommand("workbench.action.knox.openCheckpointGraph");
    void import("./BlameDecorator").then(({ BlameDecorator }) => {
      void BlameDecorator.getInstance().maybeAutoShow();
    });
  }

  static notifyHistoryChanged(): void {
    CheckpointGraphView.onUpdated?.();
  }

  static selectCheckpoint(checkpointId: string): void {
    void vscode.commands.executeCommand("workbench.action.knox.openCheckpointGraph");
    CheckpointGraphView.onSelect?.(checkpointId);
  }
}
