import { createHash } from "node:crypto";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  knoxOAuthAccountPane,
  knoxOAuthDisplayHandle,
  visibleKnoxOAuthError,
} from "../../protocol/knoxOAuth";
import {
  API_TOKEN_NAME,
  CLIENT_ID,
  LOOPBACK_PORT,
  PKCE_METHOD,
  REDIRECT_URI,
  SCOPES,
  applyDebugLocalhostDefaults,
  authorizeUrl,
  apiBase,
} from "./constants";
import { loginWithKnoxChat } from "./client";
import { buildAuthorizeUrl, looksLikeSecret, parseErrorMessage, parseMintedToken, parseTokenResponse, parseUserinfo, tokenRequestBody } from "./http";
import { parseCallbackTarget, waitForLoopbackCallback } from "./loopback";
import { generateAuthorizationSecrets, pkceFromVerifier, s256Challenge } from "./pkce";
import {
  clearKnoxChatOAuthSession,
  resolveKnoxChatApiKey,
  resolveProviderApiKey,
  setKnoxChatOAuthApiKey,
} from "./session";

const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("knox oauth contract", () => {
  it("locks client id, redirect, scopes, and PKCE method", () => {
    expect(CLIENT_ID).toBe("knoxchat");
    expect(REDIRECT_URI).toBe("http://127.0.0.1:8733/callback");
    expect(LOOPBACK_PORT).toBe(8733);
    expect(API_TOKEN_NAME).toBe("KnoxChat");
    expect(PKCE_METHOD).toBe("S256");
    expect(SCOPES).toBe(
      "user:read user:email tokens:read tokens:write usage:read",
    );
  });
});

describe("pkce", () => {
  it("matches RFC 7636 appendix B", () => {
    expect(s256Challenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    expect(pkceFromVerifier(RFC_VERIFIER)?.challenge).toBe(RFC_CHALLENGE);
    expect(createHash("sha256").update(RFC_VERIFIER).digest("base64url")).toBe(
      RFC_CHALLENGE,
    );
  });

  it("rejects invalid verifiers", () => {
    expect(pkceFromVerifier("short")).toBeUndefined();
    expect(pkceFromVerifier("a".repeat(42))).toBeUndefined();
    expect(pkceFromVerifier(`${"a".repeat(42)}+`)).toBeUndefined();
    expect(pkceFromVerifier("a".repeat(43))).toBeDefined();
  });
});

describe("authorize url", () => {
  it("includes PKCE and no secret", () => {
    const secrets = generateAuthorizationSecrets();
    const url = buildAuthorizeUrl(
      "https://knoxstudio.ai/oauth2/authorize",
      secrets,
    );
    const params = new URL(url).searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(params.get("scope")).toBe(SCOPES);
    expect(params.get("state")).toBe(secrets.state);
    expect(params.get("code_challenge")).toBe(secrets.pkce.challenge);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(url.toLowerCase()).not.toContain("client_secret");
    expect(url).not.toContain(secrets.pkce.verifier);
  });
});

describe("callback parse", () => {
  it("reads success and access_denied", () => {
    const ok = parseCallbackTarget("/callback?code=abc&state=xyz");
    expect(ok?.code).toBe("abc");
    expect(ok?.state).toBe("xyz");
    const denied = parseCallbackTarget(
      "/callback?error=access_denied&error_description=User%20denied&state=xyz",
    );
    expect(denied?.error).toBe("access_denied");
    expect(denied?.errorDescription).toBe("User denied");
    expect(parseCallbackTarget("/favicon.ico")).toBeUndefined();
  });
});

describe("response parsers", () => {
  it("unwraps token, userinfo, and mint payloads", () => {
    const tokens = parseTokenResponse(
      '{"success":true,"data":{"access_token":"at","refresh_token":"rt"}}',
    );
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");

    const info = parseUserinfo('{"sub":"9","username":"knox"}');
    expect(info.sub).toBe("9");
    expect(info.username).toBe("knox");

    const minted = parseMintedToken(
      '{"success":true,"data":{"id":42,"key":"sk-abc","name":"KnoxChat"}}',
    );
    expect(minted.id).toBe(42);
    expect(minted.key).toBe("sk-abc");
  });

  it("drops secret-bearing error messages", () => {
    expect(
      parseErrorMessage('{"error_description":"key sk-secret-value leaked"}'),
    ).toBeUndefined();
    expect(parseErrorMessage('{"message":"tokens:write required"}')).toBe(
      "tokens:write required",
    );
    expect(looksLikeSecret("bad code_verifier")).toBe(true);
  });

  it("token request has PKCE and no secret", () => {
    const body = tokenRequestBody("auth-code", "verifier-value");
    expect(body.grant_type).toBe("authorization_code");
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.redirect_uri).toBe(REDIRECT_URI);
    expect(
      Object.prototype.hasOwnProperty.call(body, "client_secret"),
    ).toBe(false);
  });
});

describe("session key resolution", () => {
  afterEach(() => {
    clearKnoxChatOAuthSession();
  });

  it("prefers an explicit model key over the oauth session", () => {
    setKnoxChatOAuthApiKey("sk-oauth");
    expect(resolveKnoxChatApiKey(" sk-model ")).toBe("sk-model");
    expect(resolveKnoxChatApiKey("")).toBe("sk-oauth");
    expect(resolveKnoxChatApiKey()).toBe("sk-oauth");
  });

  it("does not inject the knoxchat key into other providers", () => {
    setKnoxChatOAuthApiKey("sk-oauth");
    expect(resolveProviderApiKey("openai")).toBeUndefined();
    expect(resolveProviderApiKey("knoxchat")).toBe("sk-oauth");
    expect(resolveProviderApiKey("knoxchat", "sk-model")).toBe("sk-model");
  });
});

describe("account pane", () => {
  it("maps login state onto the add-model pane", () => {
    expect(knoxOAuthAccountPane("idle", false)).toBe("disconnected");
    expect(knoxOAuthAccountPane("waiting_for_consent", false)).toBe(
      "in_progress",
    );
    expect(knoxOAuthAccountPane("success", true)).toBe("connected");
    expect(knoxOAuthAccountPane("failed", true)).toBe("connected");
    expect(knoxOAuthDisplayHandle({ userId: 9, username: "knox", tokenId: 1, connectedAt: 0 })).toBe(
      "@knox",
    );
    expect(
      visibleKnoxOAuthError({ state: "failed", error: "cancelled" }),
    ).toBeUndefined();
    expect(visibleKnoxOAuthError({ state: "failed", error: "denied" })).toBe(
      "denied",
    );
  });
});

describe("debug defaults", () => {
  it("do not override an explicit env", () => {
    const prevA = process.env.KNOX_OAUTH_AUTHORIZE_URL;
    const prevB = process.env.KNOX_OAUTH_API_BASE;
    process.env.KNOX_OAUTH_AUTHORIZE_URL = "https://staging.example/oauth2/authorize";
    process.env.KNOX_OAUTH_API_BASE = "https://api.staging.example";
    try {
      applyDebugLocalhostDefaults();
      expect(authorizeUrl()).toBe("https://staging.example/oauth2/authorize");
      expect(apiBase()).toBe("https://api.staging.example");
    } finally {
      if (prevA === undefined) {
        delete process.env.KNOX_OAUTH_AUTHORIZE_URL;
      } else {
        process.env.KNOX_OAUTH_AUTHORIZE_URL = prevA;
      }
      if (prevB === undefined) {
        delete process.env.KNOX_OAUTH_API_BASE;
      } else {
        process.env.KNOX_OAUTH_API_BASE = prevB;
      }
    }
  });
});

async function fetchUntilOk(url: string, attempts = 50): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      last = response.status;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`loopback not ready: ${String(last)}`);
}

async function waitForLoopbackReady(attempts = 50): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch("http://127.0.0.1:8733/not-callback");
      return;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`loopback listener not bound: ${String(last)}`);
}

describe("loopback listener", () => {
  it("cancels an already-aborted wait without binding", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      waitForLoopbackCallback({
        expectedState: "st",
        signal: abort.signal,
        timeoutMs: 2_000,
        page: { lang: "en", title: "KnoxChat", body: "close" },
      }),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("cancels a live wait after the listener is bound", async () => {
    const abort = new AbortController();
    const wait = waitForLoopbackCallback({
      expectedState: "st",
      signal: abort.signal,
      timeoutMs: 4_000,
      page: { lang: "en", title: "KnoxChat", body: "close" },
    });
    const cancelled = expect(wait).rejects.toMatchObject({ kind: "cancelled" });
    await waitForLoopbackReady();
    abort.abort();
    await cancelled;
  });

  it("rejects when 8733 is already bound", async () => {
    const blocker = await new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer();
      server.once("error", reject);
      server.listen(LOOPBACK_PORT, "127.0.0.1", () => resolve(server));
    });
    try {
      await expect(
        waitForLoopbackCallback({
          expectedState: "st",
          signal: new AbortController().signal,
          timeoutMs: 1_000,
          page: { lang: "en", title: "KnoxChat", body: "close" },
        }),
      ).rejects.toMatchObject({ kind: "port_in_use" });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("accepts a matching /callback", async () => {
    const ok = waitForLoopbackCallback({
      expectedState: "xyz",
      signal: new AbortController().signal,
      timeoutMs: 4_000,
      page: { lang: "en", title: "KnoxChat", body: "Returning." },
    });
    const response = await fetchUntilOk(
      "http://127.0.0.1:8733/callback?code=abc&state=xyz",
    );
    expect(await response.text()).toContain("Returning.");
    await expect(ok).resolves.toMatchObject({ code: "abc", state: "xyz" });
  });

  it("rejects a state mismatch", async () => {
    const mismatch = waitForLoopbackCallback({
      expectedState: "expected",
      signal: new AbortController().signal,
      timeoutMs: 4_000,
      page: { lang: "en", title: "KnoxChat", body: "close" },
    });
    const rejected = expect(mismatch).rejects.toMatchObject({
      kind: "state_mismatch",
    });
    await fetchUntilOk("http://127.0.0.1:8733/callback?code=abc&state=other");
    await rejected;
  });
});

describe("loginWithKnoxChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the host browser, exchanges PKCE, and mints the API key", async () => {
    const originalFetch = globalThis.fetch;
    const requestUrl = (input: RequestInfo | URL): string => {
      if (typeof input === "string") {
        return input;
      }
      if (input instanceof URL) {
        return input.href;
      }
      return input.url;
    };
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.startsWith("http://127.0.0.1:8733/")) {
          return originalFetch(input, init);
        }
        if (url.includes("/api/oauth2/tokens")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { id: 42, key: "sk-abc", name: "KnoxChat" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/oauth2/token")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            code_verifier?: string;
            client_secret?: string;
          };
          expect(body.code_verifier).toBeTruthy();
          expect(body.client_secret).toBeUndefined();
          return new Response(
            JSON.stringify({
              success: true,
              data: { access_token: "at", refresh_token: "rt" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/oauth2/userinfo")) {
          return new Response(JSON.stringify({ sub: "9", username: "knox" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    );

    let authorize = "";
    const states: string[] = [];
    const abort = new AbortController();
    const login = loginWithKnoxChat({
      openBrowser: async (url) => {
        authorize = url;
      },
      onState: (state) => {
        states.push(state);
      },
      page: { lang: "en", title: "KnoxChat", body: "Returning." },
      signal: abort.signal,
    });

    for (let i = 0; i < 50 && !authorize; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const state = new URL(authorize).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(authorize).toContain("code_challenge");
    expect(authorize.toLowerCase()).not.toContain("client_secret");
    await waitForLoopbackReady();
    await fetchUntilOk(
      `http://127.0.0.1:8733/callback?code=auth-code&state=${state}`,
    );
    const session = await login;
    expect(session.apiKey).toBe("sk-abc");
    expect(session.refreshToken).toBe("rt");
    expect(session.account).toMatchObject({ userId: 9, username: "knox" });
    expect(states).toContain("opening_browser");
    expect(states).toContain("waiting_for_consent");
    expect(states).toContain("exchanging");
  });

  it("maps a failed openBrowser to open_browser", async () => {
    await expect(
      loginWithKnoxChat({
        openBrowser: async () => {
          throw new Error("blocked");
        },
        onState: () => undefined,
        page: { lang: "en", title: "KnoxChat", body: "close" },
      }),
    ).rejects.toMatchObject({ kind: "open_browser" });
  });
});
