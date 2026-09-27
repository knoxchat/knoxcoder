/**
 * KN-360: vscode-free KnoxChat OAuth persist/restore.
 *
 * Minted `sk-` keys and refresh tokens live in SecretStorage. Account
 * metadata (never the raw key) is globalState. The host opens the browser;
 * Core owns PKCE + the loopback listener.
 */

import type { KnoxOAuthAccount } from "core/protocol/knoxOAuth";
import { storage } from "core/auth/knoxOAuth";

export const KNOX_OAUTH_STATUS_MESSAGE = "knoxchat/oauth/status" as const;
export const KNOX_OAUTH_START_MESSAGE = "knoxchat/oauth/start" as const;
export const KNOX_OAUTH_CANCEL_MESSAGE = "knoxchat/oauth/cancel" as const;
export const KNOX_OAUTH_SIGN_OUT_MESSAGE = "knoxchat/oauth/signOut" as const;
export const KNOX_OAUTH_UPDATE_MESSAGE = "knoxchat/oauth/update" as const;

export const KNOX_OAUTH_SECRET_KEYS = {
  apiKey: storage.API_KEY_ITEM,
  refreshToken: storage.REFRESH_TOKEN_ITEM,
  account: storage.ACCOUNT_STATE_KEY,
} as const;

export type KnoxOAuthSecretStore = {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type KnoxOAuthAccountStore = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
};

export type KnoxOAuthRestoreResult =
  | { kind: "session"; account: KnoxOAuthAccount; apiKey: string }
  | { kind: "empty" };

export async function restoreKnoxOAuthPersisted(
  secrets: KnoxOAuthSecretStore,
  accounts: KnoxOAuthAccountStore,
): Promise<KnoxOAuthRestoreResult> {
  const account = accounts.get<KnoxOAuthAccount>(storage.ACCOUNT_STATE_KEY);
  const apiKey = await secrets.get(storage.API_KEY_ITEM);
  if (account && apiKey) {
    return { kind: "session", account, apiKey };
  }
  if (account || apiKey) {
    await clearKnoxOAuthPersisted(secrets, accounts);
  }
  return { kind: "empty" };
}

export async function persistKnoxOAuthSession(
  secrets: KnoxOAuthSecretStore,
  accounts: KnoxOAuthAccountStore,
  account: KnoxOAuthAccount,
  apiKey: string,
  refreshToken?: string,
): Promise<void> {
  await secrets.store(storage.API_KEY_ITEM, apiKey);
  if (refreshToken) {
    await secrets.store(storage.REFRESH_TOKEN_ITEM, refreshToken);
  }
  await accounts.update(storage.ACCOUNT_STATE_KEY, account);
}

export async function clearKnoxOAuthPersisted(
  secrets: KnoxOAuthSecretStore,
  accounts: KnoxOAuthAccountStore,
): Promise<void> {
  await secrets.delete(storage.API_KEY_ITEM);
  await secrets.delete(storage.REFRESH_TOKEN_ITEM);
  await accounts.update(storage.ACCOUNT_STATE_KEY, undefined);
}
