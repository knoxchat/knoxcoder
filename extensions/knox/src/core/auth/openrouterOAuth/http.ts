/**
 * HTTP helpers for OpenRouter PKCE authorize + key exchange.
 * Never log `sk-` keys, PKCE verifiers, or the raw authorization `code`.
 */

import type { KnoxOAuthErrorKind } from "../../protocol/knoxOAuth";
import type { OpenRouterOAuthErrorKind } from "../../protocol/openrouterOAuth";
import { createHash } from "node:crypto";
import type { AuthorizationSecrets } from "../knoxOAuth/pkce";
import {
  AUTH_URL,
  KEY_LABEL,
  PKCE_METHOD,
  REDIRECT_URI,
  USER_AGENT,
  attributionHeaders,
} from "./constants";

const HTTP_TIMEOUT_MS = 30_000;
const ERROR_MESSAGE_MAX = 200;

export class OAuthError extends Error {
  constructor(readonly kind: OpenRouterOAuthErrorKind) {
    super(kind);
    this.name = "OAuthError";
  }
}

export function queryEncode(value: string): string {
  return encodeURIComponent(value);
}

/**
 * OpenRouter authorize URL. No `client_id`, scopes, or CSRF `state`
 * (their docs omit `state`; PKCE binds the later exchange).
 */
export function buildAuthorizeUrl(secrets: AuthorizationSecrets): string {
  const query = [
    `callback_url=${queryEncode(REDIRECT_URI)}`,
    `code_challenge=${queryEncode(secrets.pkce.challenge)}`,
    `code_challenge_method=${queryEncode(PKCE_METHOD)}`,
    `key_label=${queryEncode(KEY_LABEL)}`,
  ].join("&");
  return `${AUTH_URL}?${query}`;
}

export function exchangeRequestBody(code: string, verifier: string) {
  return {
    code,
    code_verifier: verifier,
    code_challenge_method: PKCE_METHOD,
  };
}

export type KeyInfo = {
  label?: string;
  creatorUserId?: string;
};

function unwrapApiData(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const data = (value as { data?: unknown }).data;
  if (data !== undefined && data !== null) {
    return data;
  }
  return value;
}

/** SHA-256 hex of the minted API key. Used for OpenRouter settings/logs URLs and DELETE `/keys/{hash}`. */
export function hashOpenRouterApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/** Documented `DELETE /keys/{hash}` success body is `{ deleted: true }`. */
export function parseDeletedKey(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed || trimmed === "true") {
    return true;
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value === true) {
      return true;
    }
    if (value && typeof value === "object") {
      return (value as { deleted?: unknown }).deleted === true;
    }
  } catch {
    return true;
  }
  return false;
}

export function parseExchangedKey(body: string): string {
  const value = JSON.parse(body) as unknown;
  const inner = unwrapApiData(value) as { key?: unknown };
  if (typeof inner?.key !== "string" || !inner.key.trim()) {
    throw new Error("exchange response was missing key");
  }
  return inner.key;
}

export function parseKeyInfo(body: string): KeyInfo {
  const value = JSON.parse(body) as unknown;
  const inner = unwrapApiData(value) as {
    label?: unknown;
    creator_user_id?: unknown;
  };
  return {
    label: typeof inner?.label === "string" ? inner.label : undefined,
    creatorUserId:
      typeof inner?.creator_user_id === "string"
        ? inner.creator_user_id
        : undefined,
  };
}

export function looksLikeSecret(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("sk-") ||
    lower.includes("code_verifier") ||
    lower.includes("refresh_token") ||
    lower.includes("access_token")
  );
}

export function parseErrorMessage(body: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record.error_description,
    record.message,
    record.error && typeof record.error === "object"
      ? (record.error as { message?: unknown }).message
      : undefined,
    typeof record.error === "string" ? record.error : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed || looksLikeSecret(trimmed)) {
      continue;
    }
    return trimmed.length > ERROR_MESSAGE_MAX
      ? `${trimmed.slice(0, ERROR_MESSAGE_MAX)}…`
      : trimmed;
  }
  return undefined;
}

export function mapFetchError(err: unknown): KnoxOAuthErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("timeout")) {
    return "timeout";
  }
  if (
    lower.includes("tls") ||
    lower.includes("certificate") ||
    lower.includes("ssl")
  ) {
    return "tls";
  }
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return "offline";
  }
  return "offline";
}

/** Map OpenRouter `/auth/keys` failures onto the shared OAuth error table. */
export function mapExchangeError(
  status: number,
  body: string,
): OpenRouterOAuthErrorKind {
  const message = parseErrorMessage(body);
  const haystack = (
    message ?? (looksLikeSecret(body) ? "" : body)
  ).toLowerCase();
  if (status === 403 && haystack.includes("expired")) {
    return "expired";
  }
  return "exchange";
}

export async function oauthFetch(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...attributionHeaders(),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new OAuthError(mapFetchError(err));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

export function failHttp(status: number, body: string, step: string): OAuthError {
  const message = parseErrorMessage(body);
  if (message) {
    console.warn(`oauth: ${step} failed (${status}): ${message}`);
  } else {
    console.warn(`oauth: ${step} failed (${status})`);
  }
  return new OAuthError(mapExchangeError(status, body));
}
