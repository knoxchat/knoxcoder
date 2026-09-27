/**
 * Shared KnoxChat OAuth2 status types (webview ↔ extension).
 * Keep this file free of Node APIs so the GUI bundle can import it.
 */

export const KNOXCHAT_OAUTH_ERROR_KINDS = [
  "denied",
  "state_mismatch",
  "port_in_use",
  "timeout",
  "cancelled",
  "bind_failed",
  "open_browser",
  "offline",
  "tls",
  "exchange",
] as const;

export type KnoxOAuthErrorKind = (typeof KNOXCHAT_OAUTH_ERROR_KINDS)[number];

export type KnoxOAuthLoginState =
  | "idle"
  | "opening_browser"
  | "waiting_for_consent"
  | "exchanging"
  | "success"
  | "failed";

export type KnoxOAuthAccount = {
  userId: number;
  username: string;
  tokenId: number;
  connectedAt: number;
};

export type KnoxOAuthStatus = {
  state: KnoxOAuthLoginState;
  error?: KnoxOAuthErrorKind;
  account?: KnoxOAuthAccount;
};

export type KnoxOAuthPane = "in_progress" | "connected" | "disconnected";

const IN_PROGRESS_STATES: KnoxOAuthLoginState[] = [
  "opening_browser",
  "waiting_for_consent",
  "exchanging",
];

export function isKnoxOAuthInProgress(state: KnoxOAuthLoginState): boolean {
  return IN_PROGRESS_STATES.includes(state);
}

export function knoxOAuthDisplayHandle(account: KnoxOAuthAccount): string {
  if (!account.username) {
    return `user ${account.userId}`;
  }
  return `@${account.username}`;
}

export function knoxOAuthAccountPane(
  state: KnoxOAuthLoginState,
  hasAccount: boolean,
): KnoxOAuthPane {
  if (isKnoxOAuthInProgress(state)) {
    return "in_progress";
  }
  if (hasAccount) {
    return "connected";
  }
  return "disconnected";
}

/** Failed kinds that should show in the Add Model form. Cancel is silent. */
export function visibleKnoxOAuthError(
  status: KnoxOAuthStatus,
): Exclude<KnoxOAuthErrorKind, "cancelled"> | undefined {
  if (status.state !== "failed" || !status.error) {
    return undefined;
  }
  if (status.error === "cancelled") {
    return undefined;
  }
  return status.error;
}
