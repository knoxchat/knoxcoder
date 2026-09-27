/**
 * HTTP helpers for KnoxChat OAuth token exchange / mint / revoke.
 * Never log `sk-` keys, PKCE verifiers, or refresh tokens.
 */

import type { KnoxOAuthErrorKind } from "../../protocol/knoxOAuth";
import {
  API_TOKEN_NAME,
  CLIENT_ID,
  PKCE_METHOD,
  REDIRECT_URI,
  SCOPES,
  USER_AGENT,
  authorizeUrl,
} from "./constants";
import type { AuthorizationSecrets } from "./pkce";

const HTTP_TIMEOUT_MS = 30_000;
const ERROR_MESSAGE_MAX = 200;

export class OAuthError extends Error {
  constructor(readonly kind: KnoxOAuthErrorKind) {
    super(kind);
    this.name = "OAuthError";
  }
}

export function queryEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "%20");
}

export function buildAuthorizeUrl(
  authorizeEndpoint: string,
  secrets: AuthorizationSecrets,
): string {
  const query = [
    `response_type=code`,
    `client_id=${queryEncode(CLIENT_ID)}`,
    `redirect_uri=${queryEncode(REDIRECT_URI)}`,
    `scope=${queryEncode(SCOPES)}`,
    `state=${queryEncode(secrets.state)}`,
    `code_challenge=${queryEncode(secrets.pkce.challenge)}`,
    `code_challenge_method=${queryEncode(PKCE_METHOD)}`,
  ].join("&");
  return joinQuery(authorizeEndpoint, query);
}

export function currentAuthorizeUrl(secrets: AuthorizationSecrets): string {
  return buildAuthorizeUrl(authorizeUrl(), secrets);
}

function joinQuery(endpoint: string, query: string): string {
  if (endpoint.includes("?")) {
    if (endpoint.endsWith("?") || endpoint.endsWith("&")) {
      return `${endpoint}${query}`;
    }
    return `${endpoint}&${query}`;
  }
  return `${endpoint}?${query}`;
}

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
};

export type UserInfo = {
  sub: string;
  username?: string;
};

export type MintedToken = {
  id: number;
  key: string;
};

export function tokenRequestBody(code: string, verifier: string) {
  return {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  };
}

export function mintRequestBody() {
  return {
    name: API_TOKEN_NAME,
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
  };
}

export function revokeRequestBody(token: string) {
  return {
    token,
    token_type_hint: "refresh_token",
    client_id: CLIENT_ID,
  };
}

export function unwrapApiData(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const data = (value as { data?: unknown }).data;
  if (data !== undefined && data !== null) {
    return data;
  }
  return value;
}

export function parseTokenResponse(body: string): TokenResponse {
  const value = JSON.parse(body) as unknown;
  const inner = unwrapApiData(value) as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  if (typeof inner?.access_token !== "string" || !inner.access_token) {
    throw new Error("token response was missing access_token");
  }
  return {
    accessToken: inner.access_token,
    refreshToken:
      typeof inner.refresh_token === "string" ? inner.refresh_token : undefined,
  };
}

export function parseUserinfo(body: string): UserInfo {
  const value = JSON.parse(body) as unknown;
  const inner = unwrapApiData(value) as { sub?: unknown; username?: unknown };
  if (typeof inner?.sub !== "string" || !inner.sub.trim()) {
    throw new Error("userinfo was missing sub");
  }
  return {
    sub: inner.sub,
    username: typeof inner.username === "string" ? inner.username : undefined,
  };
}

export function parseMintedToken(body: string): MintedToken {
  const value = JSON.parse(body) as unknown;
  const inner = unwrapApiData(value) as { id?: unknown; key?: unknown };
  if (typeof inner?.id !== "number" || typeof inner.key !== "string" || !inner.key.trim()) {
    throw new Error("mint response was invalid");
  }
  return { id: inner.id, key: inner.key };
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

export function failHttp(
  status: number,
  body: string,
  step: string,
): OAuthError {
  const message = parseErrorMessage(body);
  if (message) {
    console.warn(`oauth: ${step} failed (${status}): ${message}`);
  } else {
    console.warn(`oauth: ${step} failed (${status})`);
  }
  return new OAuthError("exchange");
}
