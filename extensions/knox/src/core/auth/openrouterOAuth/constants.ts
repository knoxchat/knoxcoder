/**
 * OpenRouter PKCE contract for KnoxCoder.
 *
 * OpenRouter is a one-shot PKCE flow (no `client_id`, scopes, or refresh
 * token). Loopback stays on 8734 so KnoxStudio can keep 8733.
 *
 * @see https://openrouter.ai/docs/guides/overview/auth/oauth
 */

import {
  OPENROUTER_APP_NAME,
  OPENROUTER_APP_URL,
  openRouterAttributionHeaders,
} from "../../../pkg/fetch/openrouterAttribution.js";

export const APP_NAME = OPENROUTER_APP_NAME;

/** Public repo URL used as OpenRouter app attribution (`HTTP-Referer`). */
export const APP_URL = OPENROUTER_APP_URL;

/** Headers OpenRouter uses to title generations as KnoxCoder instead of Unknown. */
export function attributionHeaders(): Record<string, string> {
  return openRouterAttributionHeaders();
}

/** Consent page. No registered client; PKCE binds the exchange. */
export const AUTH_URL = "https://openrouter.ai/auth";

/** OpenRouter API origin including `/api/v1`. No trailing slash. */
export const API_BASE = "https://openrouter.ai/api/v1";

/** Loopback port for the OpenRouter callback. KnoxStudio stays on 8733. */
export const LOOPBACK_PORT = 8734;

/** HTTP `callback_url` sent to OpenRouter and bound by the editor listener. */
export const REDIRECT_URI = "http://127.0.0.1:8734/callback";

/** PKCE challenge method. Editor sends `S256` only. */
export const PKCE_METHOD = "S256";

/** Prefills the minted API key label in the OpenRouter dashboard. */
export const KEY_LABEL = "KnoxCoder";

export const USER_AGENT = "KnoxCoder";

export function authKeysEndpoint(): string {
  return `${API_BASE}/auth/keys`;
}

export function currentKeyEndpoint(): string {
  return `${API_BASE}/key`;
}

/**
 * DELETE a user-controlled key by SHA-256 hash of the plaintext key.
 * Sign-out authenticates with the minted OAuth key itself (KnoxChat
 * `DELETE /api/token/self` equivalent).
 *
 * @see https://openrouter.ai/docs/api/api-reference/api-keys/delete-an-api-key
 */
export function deleteKeyEndpoint(hash: string): string {
  return `${API_BASE}/keys/${encodeURIComponent(hash)}`;
}

/** Public OpenRouter catalog. Bearer is optional. */
export function modelsEndpoint(): string {
  return `${API_BASE}/models`;
}

export const storage = {
  /** Secret storage id for the exchanged OpenRouter API key. */
  API_KEY_ITEM: "openrouter_oauth_api_key",
  /** Global state id for account metadata (never the raw key). */
  ACCOUNT_STATE_KEY: "openrouter.oauth.account",
} as const;
