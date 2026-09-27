import type { Core } from "core/core";
import * as vscode from "vscode";

/**
 * KN-332: leftover Vite webview constructor is gone.
 * createOrShow opens the native Memory editor.
 */
export class MemoryView {
  private static onUpdated: (() => void) | undefined;

  static setNotifier(handler: (() => void) | undefined): void {
    MemoryView.onUpdated = handler;
  }

  static createOrShow(_context: vscode.ExtensionContext, _core: Core): void {
    void vscode.commands.executeCommand("workbench.action.knox.openMemory");
  }

  static notifyMemoryChanged(): void {
    MemoryView.onUpdated?.();
  }
}
