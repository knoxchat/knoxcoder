import * as vscode from "vscode";

import type { VsCodeIde } from "../VsCodeIde";
import type { VsCodeWebviewProtocol } from "../webviewProtocol";
import {
  applyDebugAdapterMessage,
  createThrottledRefresher,
  debuggerSubmenuRefreshPayload,
  DEFAULT_SUBMENU_REFRESH_MS,
  type DebugAdapterMessage,
} from "./debugTrackerLogic";

export {
  applyDebugAdapterMessage,
  createThrottledRefresher,
  debuggerSubmenuRefreshPayload,
  DEFAULT_SUBMENU_REFRESH_MS,
  DEBUGGER_CONTEXT_PROVIDER,
} from "./debugTrackerLogic";
export type { DebugAdapterMessage } from "./debugTrackerLogic";

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
    // send (not request): native GUI inbound does not reply, and request()
    // would leak listeners on every step/continue storm.
    void webviewProtocol?.send("refreshSubmenuItems", debuggerSubmenuRefreshPayload());
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
