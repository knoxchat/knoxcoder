import * as vscode from "vscode";

import type { VsCodeIde } from "../VsCodeIde";
import type { VsCodeWebviewProtocol } from "../webviewProtocol";
import {
  applyDebugAdapterMessage,
  createThrottledRefresher,
  DEFAULT_SUBMENU_REFRESH_MS,
  type DebugAdapterMessage,
} from "./debugTrackerLogic";

export {
  applyDebugAdapterMessage,
  createThrottledRefresher,
  DEFAULT_SUBMENU_REFRESH_MS,
};
export type { DebugAdapterMessage };

/** Threads currently stopped in any active debug session (threadId → stopped). */
export const threadStopped: Map<number, boolean> = new Map();

export type RegisterDebugTrackerOptions = {
  /** Debounce for `@debugger` submenu refresh (default 300ms). */
  refreshDebounceMs?: number;
};

/**
 * Track DAP stopped/continued/thread events so `@debugger` can list paused
 * threads. Submenu refresh is debounced — the previous always-on refresh on
 * every adapter message caused UI jank during stepping.
 */
export function registerDebugTracker(
  webviewProtocol: VsCodeWebviewProtocol,
  _ide: VsCodeIde,
  options?: RegisterDebugTrackerOptions,
): vscode.Disposable {
  const refresher = createThrottledRefresher(() => {
    void webviewProtocol?.request("refreshSubmenuItems", {
      providers: ["debugger"],
    });
  }, options?.refreshDebounceMs ?? DEFAULT_SUBMENU_REFRESH_MS);

  const factoryDisposable = vscode.debug.registerDebugAdapterTrackerFactory(
    "*",
    {
      createDebugAdapterTracker(_session: vscode.DebugSession) {
        return {
          onWillStopSession() {
            const hadEntries = threadStopped.size > 0;
            threadStopped.clear();
            if (hadEntries) {
              refresher.schedule();
            }
          },
          onDidSendMessage(message: unknown) {
            if (
              applyDebugAdapterMessage(
                threadStopped,
                message as DebugAdapterMessage,
              )
            ) {
              refresher.schedule();
            }
          },
        };
      },
    },
  );

  return {
    dispose() {
      refresher.dispose();
      factoryDisposable.dispose();
      threadStopped.clear();
    },
  };
}
