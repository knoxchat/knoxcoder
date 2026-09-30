/**
 * OpenRouter PKCE client.
 *
 * Network, PKCE, and the loopback listener stay in Node (extension host).
 * The GUI only polls status over the webview protocol.
 */

import type { OpenRouterOAuthAccount, OpenRouterOAuthLoginState } from "../../protocol/openrouterOAuth";
import {
  LoopbackError,
  isDenied,
  waitForLoopbackCallback,
  type CallbackPageCopy,
} from "../knoxOAuth/loopback";
import { generateAuthorizationSecrets } from "../knoxOAuth/pkce";
import {
  KEY_LABEL,
  LOOPBACK_PORT,
  authKeysEndpoint,
  currentKeyEndpoint,
  deleteKeyEndpoint,
} from "./constants";
import {
  OAuthError,
  buildAuthorizeUrl,
  exchangeRequestBody,
  failHttp,
  looksLikeSecret,
  oauthFetch,
  parseExchangedKey,
  parseErrorMessage,
  parseKeyInfo,
  hashOpenRouterApiKey,
  parseDeletedKey,
  type KeyInfo,
} from "./http";

export type MintedSession = {
  account: OpenRouterOAuthAccount;
  apiKey: string;
};

export type LoginCallbacks = {
  openBrowser: (url: string) => Promise<void>;
  onState: (state: OpenRouterOAuthLoginState) => void;
  page: CallbackPageCopy;
  signal?: AbortSignal;
};

function mapLoopbackError(err: LoopbackError): OAuthError {
  switch (err.kind) {
    case "port_in_use":
      return new OAuthError("port_in_use");
    case "timeout":
      return new OAuthError("timeout");
    case "state_mismatch":
      return new OAuthError("state_mismatch");
    case "cancelled":
      return new OAuthError("cancelled");
    default:
      return new OAuthError("bind_failed");
  }
}

export async function loginWithOpenRouter(
  callbacks: LoginCallbacks,
): Promise<MintedSession> {
  const secrets = generateAuthorizationSecrets();
  callbacks.onState("opening_browser");

  const url = buildAuthorizeUrl(secrets);
  try {
    await callbacks.openBrowser(url);
  } catch {
    throw new OAuthError("open_browser");
  }

  callbacks.onState("waiting_for_consent");
  let callback;
  try {
    callback = await waitForLoopbackCallback({
      expectedState: secrets.state,
      requireState: false,
      port: LOOPBACK_PORT,
      signal: callbacks.signal ?? new AbortController().signal,
      page: callbacks.page,
    });
  } catch (err) {
    if (err instanceof LoopbackError) {
      throw mapLoopbackError(err);
    }
    throw new OAuthError("bind_failed");
  }

  if (isDenied(callback)) {
    throw new OAuthError("denied");
  }
  if (callback.error) {
    console.warn(`oauth: callback error=${callback.error}`);
    throw new OAuthError("exchange");
  }
  const code = callback.code?.trim();
  if (!code) {
    throw new OAuthError("exchange");
  }

  callbacks.onState("exchanging");
  return await completeAuthorization(code, secrets.pkce.verifier, callbacks.signal);
}

async function completeAuthorization(
  code: string,
  verifier: string,
  signal?: AbortSignal,
): Promise<MintedSession> {
  throwIfAborted(signal);

  const apiKey = await exchangeAuthorizationCode(code, verifier, signal);
  throwIfAborted(signal);
  const info = await fetchKeyInfo(apiKey, signal);

  if (!apiKey.trim()) {
    throw new OAuthError("exchange");
  }

  return {
    account: {
      label: safeLabel(info?.label),
      creatorUserId: info?.creatorUserId,
      keyHash: hashOpenRouterApiKey(apiKey),
      connectedAt: Math.floor(Date.now() / 1000),
    },
    apiKey,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await oauthFetch(
    authKeysEndpoint(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exchangeRequestBody(code, verifier)),
    },
    signal,
  );
  const body = await response.text();
  if (!response.ok) {
    throw failHttp(response.status, body, "key exchange");
  }
  try {
    return parseExchangedKey(body);
  } catch {
    throw new OAuthError("exchange");
  }
}

async function fetchKeyInfo(
  apiKey: string,
  signal?: AbortSignal,
): Promise<KeyInfo | undefined> {
  try {
    const response = await oauthFetch(
      currentKeyEndpoint(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      signal,
    );
    if (!response.ok) {
      return undefined;
    }
    return parseKeyInfo(await response.text());
  } catch {
    return undefined;
  }
}

function safeLabel(label?: string): string {
  const trimmed = label?.trim();
  if (trimmed && !looksLikeSecret(trimmed)) {
    return trimmed;
  }
  return KEY_LABEL;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OAuthError("cancelled");
  }
}

export type LogoutOptions = {
  apiKey?: string;
  keyHash?: string;
  signal?: AbortSignal;
};

/**
 * Remote delete of the minted OpenRouter key via
 * `DELETE /api/v1/keys/{sha256(key)}`.
 *
 * PKCE returns a user-controlled inference key, not a management key.
 * OpenRouter only confirms deletion with `{ deleted: true }`. 401/403/404
 * mean this key cannot delete (do not treat as already-revoked — that hid
 * the leftover "OAuth: KnoxCoder" row on the keys page).
 *
 * @see https://openrouter.ai/docs/api/api-reference/api-keys/delete-an-api-key
 */
export async function logoutOpenRouter(
  opts: LogoutOptions,
): Promise<boolean> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    return true;
  }
  const hash = opts.keyHash?.trim() || hashOpenRouterApiKey(apiKey);
  try {
    const response = await oauthFetch(
      deleteKeyEndpoint(hash),
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      opts.signal,
    );
    const body = await response.text();
    if (response.ok && parseDeletedKey(body)) {
      return true;
    }
    const message = parseErrorMessage(body);
    console.warn(
      message
        ? `oauth: openrouter delete-key failed (${response.status}): ${message}`
        : `oauth: openrouter delete-key failed (${response.status})`,
    );
    return false;
  } catch (err) {
    console.warn(
      `oauth: openrouter delete-key failed: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}
