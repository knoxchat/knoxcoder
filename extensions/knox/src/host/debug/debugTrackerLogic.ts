/**
 * KN-353: vscode-free DAP tracker helpers for `@debugger`.
 * Distinct from Agent `builtin_debug` (launch/attach/step).
 * Kept free of vscode imports so mocha unit tests can run without the host.
 */

export type DebugAdapterMessage = {
  type?: string;
  event?: string;
  body?: {
    threadId?: number | string;
    allThreadsStopped?: boolean;
    /** DAP `continued` event field */
    allThreadsContinued?: boolean;
    reason?: string;
  };
};

export const DEFAULT_SUBMENU_REFRESH_MS = 300;

/** `@debugger` context-provider title (integration, never a default mention). */
export const DEBUGGER_CONTEXT_PROVIDER = "debugger";

export function debuggerSubmenuRefreshPayload(): {
  providers: [typeof DEBUGGER_CONTEXT_PROVIDER];
} {
  return { providers: [DEBUGGER_CONTEXT_PROVIDER] };
}

export function isThreadPaused(
  threadStopped: Map<number, boolean>,
  threadId: number,
): boolean {
  return threadStopped.get(threadId) === true;
}

export function pausedThreadIds(
  threadStopped: Map<number, boolean>,
): number[] {
  const ids: number[] = [];
  for (const [id, stopped] of threadStopped) {
    if (stopped) {
      ids.push(id);
    }
  }
  ids.sort((a, b) => a - b);
  return ids;
}

export function preferredDebugThreadId(
  threadStopped: Map<number, boolean>,
  fallback = 1,
): number {
  return pausedThreadIds(threadStopped)[0] ?? fallback;
}

export function filterPausedThreads<T extends { id: number }>(
  threads: T[],
  threadStopped: Map<number, boolean>,
): T[] {
  return threads
    .filter((thread) => isThreadPaused(threadStopped, thread.id))
    .sort((a, b) => a.id - b.id);
}

/**
 * Apply a Debug Adapter Protocol event to the stopped-thread map.
 * Returns true when the map changed (callers should refresh the @debugger submenu).
 */
export function applyDebugAdapterMessage(
  threadStopped: Map<number, boolean>,
  message: DebugAdapterMessage,
): boolean {
  if (message.type !== "event" || !message.event) {
    return false;
  }

  const body = message.body ?? {};
  let changed = false;

  const setStopped = (threadId: number, stopped: boolean) => {
    if (threadStopped.get(threadId) !== stopped) {
      threadStopped.set(threadId, stopped);
      changed = true;
    }
  };

  switch (message.event) {
    case "stopped":
    case "continued": {
      const isStopped = message.event === "stopped";
      if (typeof body.threadId !== "undefined") {
        setStopped(Number(body.threadId), isStopped);
      }

      if (body.allThreadsStopped) {
        for (const key of threadStopped.keys()) {
          setStopped(key, true);
        }
      }

      if (body.allThreadsContinued === true) {
        for (const key of threadStopped.keys()) {
          setStopped(key, false);
        }
      }
      return changed;
    }

    case "thread": {
      const threadId = Number(body.threadId);
      if (Number.isNaN(threadId)) {
        return false;
      }
      if (body.reason === "exited") {
        if (threadStopped.has(threadId)) {
          threadStopped.delete(threadId);
          changed = true;
        }
      } else if (body.reason === "started") {
        if (threadStopped.get(threadId) !== false) {
          threadStopped.set(threadId, false);
          changed = true;
        }
      }
      return changed;
    }

    default:
      return false;
  }
}

/**
 * Leading-edge coalesce: at most one refresh per `waitMs`, deferred to the
 * trailing edge so rapid step/continue storms become a single submenu update.
 */
export function createThrottledRefresher(
  refresh: () => void,
  waitMs: number = DEFAULT_SUBMENU_REFRESH_MS,
): { schedule: () => void; flush: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  return {
    schedule() {
      pending = true;
      if (timer !== undefined) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) {
          pending = false;
          refresh();
        }
      }, waitMs);
    },
    flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (pending) {
        pending = false;
        refresh();
      }
    },
    dispose() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = false;
    },
  };
}
