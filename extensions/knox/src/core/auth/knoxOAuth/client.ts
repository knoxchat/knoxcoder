/**
 * KnoxChat OAuth2 authorization code + PKCE client.
 *
 * Network, PKCE, and the loopback listener stay in Node (extension host).
 * The GUI only polls status over the webview protocol.
 */

import type { KnoxOAuthAccount, KnoxOAuthLoginState } from "../../protocol/knoxOAuth";
import {
  mintTokenEndpoint,
  revokeEndpoint,
  selfRevokeEndpoint,
  tokenEndpoint,
  userinfoEndpoint,
} from "./constants";
import {
  OAuthError,
  currentAuthorizeUrl,
  failHttp,
  mintRequestBody,
  oauthFetch,
  parseMintedToken,
  parseTokenResponse,
  parseUserinfo,
  revokeRequestBody,
  tokenRequestBody,
} from "./http";
import {
  LoopbackError,
  isDenied,
  waitForLoopbackCallback,
  type CallbackPageCopy,
} from "./loopback";
import { generateAuthorizationSecrets } from "./pkce";

export type MintedSession = {
  account: KnoxOAuthAccount;
  apiKey: string;
  refreshToken?: string;
};

export type LoginCallbacks = {
  openBrowser: (url: string) => Promise<void>;
  onState: (state: KnoxOAuthLoginState) => void;
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

export async function loginWithKnoxChat(
  callbacks: LoginCallbacks,
): Promise<MintedSession> {
  const secrets = generateAuthorizationSecrets();
  callbacks.onState("opening_browser");

  const url = currentAuthorizeUrl(secrets);
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

  const tokens = await exchangeAuthorizationCode(code, verifier, signal);
  throwIfAborted(signal);
  const userinfo = await fetchUserinfo(tokens.accessToken, signal);
  throwIfAborted(signal);
  const minted = await mintApiToken(tokens.accessToken, signal);

  const userId = Number.parseInt(userinfo.sub, 10);
  if (!Number.isFinite(userId)) {
    throw new OAuthError("exchange");
  }
  if (!minted.key.trim()) {
    throw new OAuthError("exchange");
  }

  return {
    account: {
      userId,
      username: userinfo.username ?? "",
      tokenId: minted.id,
      connectedAt: Math.floor(Date.now() / 1000),
    },
    apiKey: minted.key,
    refreshToken: tokens.refreshToken?.trim() || undefined,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  signal?: AbortSignal,
) {
  const response = await oauthFetch(
    tokenEndpoint(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenRequestBody(code, verifier)),
    },
    signal,
  );
  const body = await response.text();
  if (!response.ok) {
    throw failHttp(response.status, body, "token exchange");
  }
  try {
    return parseTokenResponse(body);
  } catch {
    throw new OAuthError("exchange");
  }
}

async function fetchUserinfo(accessToken: string, signal?: AbortSignal) {
  const response = await oauthFetch(
    userinfoEndpoint(),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    signal,
  );
  const body = await response.text();
  if (!response.ok) {
    throw failHttp(response.status, body, "userinfo");
  }
  try {
    return parseUserinfo(body);
  } catch {
    throw new OAuthError("exchange");
  }
}

async function mintApiToken(accessToken: string, signal?: AbortSignal) {
  const response = await oauthFetch(
    mintTokenEndpoint(),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mintRequestBody()),
    },
    signal,
  );
  const body = await response.text();
  if (!response.ok) {
    throw failHttp(response.status, body, "mint API key");
  }
  try {
    return parseMintedToken(body);
  } catch {
    throw new OAuthError("exchange");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OAuthError("cancelled");
  }
}

export async function logoutKnoxChat(opts: {
  apiKey?: string;
  refreshToken?: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const apiKey = opts.apiKey?.trim();
  const refresh = opts.refreshToken?.trim();
  if (!apiKey && !refresh) {
    return true;
  }

  const keyOk = apiKey ? await selfRevokeApiKey(apiKey, opts.signal) : true;
  const refreshOk = refresh ? await revokeRefreshToken(refresh, opts.signal) : true;
  return keyOk && refreshOk;
}

async function selfRevokeApiKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await oauthFetch(
      selfRevokeEndpoint(),
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      signal,
    );
    if (response.ok || response.status === 401 || response.status === 404) {
      return true;
    }
    console.warn(`oauth: self-revoke failed (${response.status})`);
    return false;
  } catch (err) {
    console.warn(`oauth: self-revoke failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function revokeRefreshToken(
  token: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await oauthFetch(
      revokeEndpoint(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(revokeRequestBody(token)),
      },
      signal,
    );
    if (response.ok) {
      return true;
    }
    console.warn(`oauth: refresh revoke failed (${response.status})`);
    return false;
  } catch (err) {
    console.warn(
      `oauth: refresh revoke failed: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}
