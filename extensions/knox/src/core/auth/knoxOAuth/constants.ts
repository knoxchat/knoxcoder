//! Shared OAuth2 + PKCE contract for KnoxStudio.
//!
//! Website and backend copy these **same literals**. Do not generate a second
//! `client_id` or a random redirect port. Must match:
//! `backend/src/services/oauth2.rs` (`KNOXCHAT_*`) and the seed migration.

export const APP_NAME = "KnoxStudio";

/** Public OAuth `client_id`. Seeded in the backend; never a per-install value. */
export const CLIENT_ID = "knoxchat";

/** OAuth application type. Public clients must use PKCE and send no secret. */
export const APP_TYPE = "public";

/** Space-separated scopes requested by KnoxStudio. */
export const SCOPES =
  "user:read user:email tokens:read tokens:write usage:read";

/** Exact redirect URI registered for this client. Loopback only; port is fixed. */
export const REDIRECT_URI = "http://127.0.0.1:8733/callback";

/** Loopback port bound by the editor listener. Do not pick another port on failure. */
export const LOOPBACK_PORT = 8733;

/** Name of the minted `sk-` API token row (rotated on repeat sign-in). */
export const API_TOKEN_NAME = "KnoxStudio";

/** PKCE challenge method. Editor sends `S256` only. */
export const PKCE_METHOD = "S256";

export const USER_AGENT = "KnoxStudio";

const DEFAULT_AUTHORIZE_URL = "https://knoxstudio.ai/oauth2/authorize";
const DEFAULT_API_BASE = "https://api.knoxstudio.ai";

/** Local website consent page (`frontend` `next dev -p 3001`). */
export const LOCAL_AUTHORIZE_URL = "http://localhost:3001/oauth2/authorize";

/** Local backend origin (`backend` `PORT=4000`). */
export const LOCAL_API_BASE = "http://localhost:4000";

export const AUTHORIZE_URL_ENV = "KNOX_OAUTH_AUTHORIZE_URL";
export const API_BASE_ENV = "KNOX_OAUTH_API_BASE";

function envOverride(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function setEnvIfUnset(key: string, value: string): void {
  if (envOverride(key) === undefined) {
    process.env[key] = value;
  }
}

/**
 * Point debug / `make run` at localhost when `KNOX_OAUTH_*` is unset.
 * Release builds keep production defaults. An explicit env value still wins.
 */
export function applyDebugLocalhostDefaults(): void {
  setEnvIfUnset(AUTHORIZE_URL_ENV, LOCAL_AUTHORIZE_URL);
  setEnvIfUnset(API_BASE_ENV, LOCAL_API_BASE);
}

/** Website consent page. Override with `KNOX_OAUTH_AUTHORIZE_URL` in dev. */
export function authorizeUrl(): string {
  return envOverride(AUTHORIZE_URL_ENV) ?? DEFAULT_AUTHORIZE_URL;
}

/** Backend API origin. Override with `KNOX_OAUTH_API_BASE`. */
export function apiBase(): string {
  const value = envOverride(API_BASE_ENV);
  return (value ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

export function tokenEndpoint(): string {
  return `${apiBase()}/api/oauth2/token`;
}

export function userinfoEndpoint(): string {
  return `${apiBase()}/api/oauth2/userinfo`;
}

export function mintTokenEndpoint(): string {
  return `${apiBase()}/api/oauth2/tokens`;
}

export function revokeEndpoint(): string {
  return `${apiBase()}/api/oauth2/revoke`;
}

export function selfRevokeEndpoint(): string {
  return `${apiBase()}/api/token/self`;
}

export const storage = {
  /** Secret storage id for the minted KnoxStudio `sk-` key. */
  API_KEY_ITEM: "knoxchat_oauth_api_key",
  /** Secret storage id for the OAuth refresh token. */
  REFRESH_TOKEN_ITEM: "knoxchat_oauth_refresh",
  /** Global state id for account metadata (never the raw key). */
  ACCOUNT_STATE_KEY: "knoxchat.oauth.account",
} as const;
