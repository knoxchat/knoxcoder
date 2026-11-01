import * as vscode from "vscode";

/**
 * Native router, not a webview. createOrShow opens the History editor
 * the same way MemoryView and CheckpointGraphView do.
 */
export class HistoryView {
  static createOrShow(): void {
    void vscode.commands.executeCommand("workbench.action.knox.openHistory");
  }
}
