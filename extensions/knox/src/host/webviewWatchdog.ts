export const WEBVIEW_HEARTBEAT_INTERVAL_MS = 5_000;
export const WEBVIEW_HEARTBEAT_STALE_MS = 30_000;
export const WEBVIEW_STARTUP_STALE_MS = 45_000;
export const WEBVIEW_MAX_RELOADS = 2;
export const WEBVIEW_RELOAD_DECAY_MS = 60_000;

export type WebviewWatchdogDecision = "ok" | "reload" | "give-up";

export type WebviewWatchdogState = {
  visible: boolean;
  focused: boolean;
  lastHeartbeatAt: number | null;
  viewReadyAt: number | null;
  reloadCount: number;
  backoffUntil: number;
  healthySince: number | null;
};

export function initialWebviewWatchdogState(): WebviewWatchdogState {
  return {
    visible: false,
    focused: true,
    lastHeartbeatAt: null,
    viewReadyAt: null,
    reloadCount: 0,
    backoffUntil: 0,
    healthySince: null,
  };
}

/**
 * Missed heartbeats while the sidebar is hidden or the VS Code window is in
 * the background are not a crash — Chromium throttles/freezes webview timers.
 */
export function decideWebviewWatchdog(
  state: WebviewWatchdogState,
  now: number,
): WebviewWatchdogDecision {
  if (!state.visible || !state.focused || state.viewReadyAt == null) {
    return "ok";
  }
  if (now < state.backoffUntil) {
    return "ok";
  }
  const last = state.lastHeartbeatAt ?? state.viewReadyAt;
  const staleMs =
    state.lastHeartbeatAt == null
      ? WEBVIEW_STARTUP_STALE_MS
      : WEBVIEW_HEARTBEAT_STALE_MS;
  if (now - last < staleMs) {
    return "ok";
  }
  if (state.reloadCount >= WEBVIEW_MAX_RELOADS) {
    return "give-up";
  }
  return "reload";
}

export function applyWatchdogHeartbeat(
  state: WebviewWatchdogState,
  now: number,
): WebviewWatchdogState {
  const healthySince = state.healthySince ?? now;
  const reloadCount =
    now - healthySince >= WEBVIEW_RELOAD_DECAY_MS ? 0 : state.reloadCount;
  return {
    ...state,
    lastHeartbeatAt: now,
    healthySince,
    reloadCount,
  };
}

export function applyWatchdogViewReady(
  state: WebviewWatchdogState,
  now: number,
  visible: boolean,
  focused: boolean = state.focused,
): WebviewWatchdogState {
  return {
    ...state,
    visible,
    focused,
    viewReadyAt: now,
    lastHeartbeatAt: null,
    healthySince: null,
    backoffUntil: now + WEBVIEW_HEARTBEAT_INTERVAL_MS,
  };
}

function resumeAfterBackground(
  state: WebviewWatchdogState,
  now: number,
  patch: Partial<Pick<WebviewWatchdogState, "visible" | "focused">>,
): WebviewWatchdogState {
  return {
    ...state,
    ...patch,
    lastHeartbeatAt: null,
    viewReadyAt: now,
    healthySince: null,
    backoffUntil: Math.max(
      state.backoffUntil,
      now + WEBVIEW_HEARTBEAT_INTERVAL_MS,
    ),
  };
}

export function applyWatchdogVisibility(
  state: WebviewWatchdogState,
  visible: boolean,
  now: number,
): WebviewWatchdogState {
  if (visible && !state.visible && state.focused) {
    return resumeAfterBackground(state, now, { visible: true });
  }
  return { ...state, visible };
}

export function applyWatchdogFocus(
  state: WebviewWatchdogState,
  focused: boolean,
  now: number,
): WebviewWatchdogState {
  if (focused && !state.focused && state.visible) {
    return resumeAfterBackground(state, now, { focused: true });
  }
  return { ...state, focused };
}

export function applyWatchdogReload(
  state: WebviewWatchdogState,
  now: number,
): WebviewWatchdogState {
  const reloadCount = state.reloadCount + 1;
  const backoffMs = WEBVIEW_HEARTBEAT_INTERVAL_MS * 2 ** reloadCount;
  return {
    ...state,
    reloadCount,
    lastHeartbeatAt: null,
    viewReadyAt: now,
    healthySince: null,
    backoffUntil: now + backoffMs,
  };
}

export function applyWatchdogUserReload(
  state: WebviewWatchdogState,
  now: number,
  visible: boolean,
): WebviewWatchdogState {
  return {
    ...initialWebviewWatchdogState(),
    visible,
    focused: state.focused,
    viewReadyAt: now,
    backoffUntil: now + WEBVIEW_HEARTBEAT_INTERVAL_MS,
  };
}
