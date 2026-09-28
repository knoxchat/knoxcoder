import type { Core } from "core/core";
import * as vscode from "vscode";

const REFRESH_DEBOUNCE_MS = 500;

/**
 * KN-332: leftover Vite webview constructor is gone.
 * createOrShow opens the native Memory editor.
 */
export class MemoryView {
  private static onUpdated: (() => void) | undefined;
  private static refreshTimer: ReturnType<typeof setTimeout> | undefined;

  static setNotifier(handler: (() => void) | undefined): void {
    MemoryView.onUpdated = handler;
    if (!handler && MemoryView.refreshTimer) {
      clearTimeout(MemoryView.refreshTimer);
      MemoryView.refreshTimer = undefined;
    }
  }

  static createOrShow(_context: vscode.ExtensionContext, _core: Core): void {
    void vscode.commands.executeCommand("workbench.action.knox.openMemory");
  }

  /** Bursts of memory writes collapse into one `memoryViewUpdated` after 500 ms. */
  static notifyMemoryChanged(): void {
    if (MemoryView.refreshTimer) {
      clearTimeout(MemoryView.refreshTimer);
    }
    MemoryView.refreshTimer = setTimeout(() => {
      MemoryView.refreshTimer = undefined;
      MemoryView.onUpdated?.();
    }, REFRESH_DEBOUNCE_MS);
  }
}
