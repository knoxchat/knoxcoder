import {
  getLocalStorageSync,
  setLocalStorageSync,
} from "./localStorage";

const LAST_ACTIVE_SESSION_KEY_PREFIX = "knoxchat:lastActiveSession";

export type LastActiveSessionState = {
  workspace: string;
  sessionId: string;
  isEmpty: boolean;
  updatedAt: number;
};

function getWorkspaceKey(workspace: string) {
  return `${LAST_ACTIVE_SESSION_KEY_PREFIX}:${workspace || "global"}`;
}

export function getLastActiveSessionState(
  workspace: string,
): LastActiveSessionState | undefined {
  const value = getLocalStorageSync(getWorkspaceKey(workspace));

  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (value.workspace !== workspace || typeof value.sessionId !== "string") {
    return undefined;
  }

  return value as LastActiveSessionState;
}

export function setLastActiveSessionState({
  workspace,
  sessionId,
  isEmpty,
}: Omit<LastActiveSessionState, "updatedAt">) {
  setLocalStorageSync(getWorkspaceKey(workspace), {
    workspace,
    sessionId,
    isEmpty,
    updatedAt: Date.now(),
  });
}
