/**
 * Shared OpenRouter OAuth status types (webview ↔ extension).
 * Keep this file free of Node APIs so the GUI bundle can import it.
 *
 * Error kinds match KnoxChat so GUI i18n stays one table.
 */

import type { KnoxOAuthErrorKind, KnoxOAuthLoginState } from "./knoxOAuth";
import {
  KNOXCHAT_OAUTH_ERROR_KINDS,
  isKnoxOAuthInProgress,
  knoxOAuthAccountPane,
  type KnoxOAuthPane,
} from "./knoxOAuth";

export type OpenRouterOAuthErrorKind = KnoxOAuthErrorKind | "expired";
export type OpenRouterOAuthLoginState = KnoxOAuthLoginState;
export type OpenRouterOAuthPane = KnoxOAuthPane;

export const OPENROUTER_OAUTH_ERROR_KINDS = [
  ...KNOXCHAT_OAUTH_ERROR_KINDS,
  "expired",
] as const;

export type OpenRouterOAuthAccount = {
  label: string;
  creatorUserId?: string;
  keyHash?: string;
  connectedAt: number;
};

export type OpenRouterOAuthStatus = {
  state: OpenRouterOAuthLoginState;
  error?: OpenRouterOAuthErrorKind;
  account?: OpenRouterOAuthAccount;
};

export function isOpenRouterOAuthInProgress(
  state: OpenRouterOAuthLoginState,
): boolean {
  return isKnoxOAuthInProgress(state);
}

export function openRouterOAuthDisplayHandle(
  account: OpenRouterOAuthAccount,
): string {
  const label = account.label.trim();
  if (label) {
    return label;
  }
  const id = account.creatorUserId?.trim();
  if (id) {
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
  }
  return "OpenRouter";
}

export function openRouterOAuthAccountPane(
  state: OpenRouterOAuthLoginState,
  hasAccount: boolean,
): OpenRouterOAuthPane {
  return knoxOAuthAccountPane(state, hasAccount);
}

/** Failed kinds that should show in Configure Provider. Cancel is silent. */
export function visibleOpenRouterOAuthError(
  status: OpenRouterOAuthStatus,
): Exclude<OpenRouterOAuthErrorKind, "cancelled"> | undefined {
  if (status.state !== "failed" || !status.error || status.error === "cancelled") {
    return undefined;
  }
  return status.error;
}

export function openRouterKeySettingsUrl(keyHash: string): string {
  return `https://openrouter.ai/keys/${encodeURIComponent(keyHash)}`;
}

export function openRouterKeyLogsUrl(keyHash: string): string {
  return `https://openrouter.ai/logs?api_key_hash=${encodeURIComponent(keyHash)}`;
}
