/**
 * vscode-free OpenRouter OAuth persist/restore.
 *
 * The exchanged API key lives in SecretStorage. Account metadata (never the
 * raw key) is globalState. There is no refresh token. Sign-out wipes local
 * state then DELETEs `/api/v1/keys/{hash}` with the minted key (KnoxChat
 * self-revoke equivalent). Restore reuses the same key while still signed in.
 */

import type { OpenRouterOAuthAccount } from "core/protocol/openrouterOAuth";
import { storage } from "core/auth/openrouterOAuth";

export const OPENROUTER_OAUTH_STATUS_MESSAGE = "openrouter/oauth/status" as const;
export const OPENROUTER_OAUTH_START_MESSAGE = "openrouter/oauth/start" as const;
export const OPENROUTER_OAUTH_CANCEL_MESSAGE = "openrouter/oauth/cancel" as const;
export const OPENROUTER_OAUTH_SIGN_OUT_MESSAGE = "openrouter/oauth/signOut" as const;
export const OPENROUTER_OAUTH_UPDATE_MESSAGE = "openrouter/oauth/update" as const;

export const OPENROUTER_OAUTH_SECRET_KEYS = {
  apiKey: storage.API_KEY_ITEM,
  account: storage.ACCOUNT_STATE_KEY,
} as const;

export type OpenRouterOAuthSecretStore = {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type OpenRouterOAuthAccountStore = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
};

export type OpenRouterOAuthRestoreResult =
  | { kind: "session"; account: OpenRouterOAuthAccount; apiKey: string }
  | { kind: "empty" };

export async function restoreOpenRouterOAuthPersisted(
  secrets: OpenRouterOAuthSecretStore,
  accounts: OpenRouterOAuthAccountStore,
): Promise<OpenRouterOAuthRestoreResult> {
  const account = accounts.get<OpenRouterOAuthAccount>(storage.ACCOUNT_STATE_KEY);
  const apiKey = await secrets.get(storage.API_KEY_ITEM);
  if (account && apiKey) {
    return { kind: "session", account, apiKey };
  }
  if (account || apiKey) {
    await clearOpenRouterOAuthPersisted(secrets, accounts);
  }
  return { kind: "empty" };
}

export async function persistOpenRouterOAuthSession(
  secrets: OpenRouterOAuthSecretStore,
  accounts: OpenRouterOAuthAccountStore,
  account: OpenRouterOAuthAccount,
  apiKey: string,
): Promise<void> {
  await secrets.store(storage.API_KEY_ITEM, apiKey);
  await accounts.update(storage.ACCOUNT_STATE_KEY, account);
}

export async function clearOpenRouterOAuthPersisted(
  secrets: OpenRouterOAuthSecretStore,
  accounts: OpenRouterOAuthAccountStore,
): Promise<void> {
  await secrets.delete(storage.API_KEY_ITEM);
  await accounts.update(storage.ACCOUNT_STATE_KEY, undefined);
}
