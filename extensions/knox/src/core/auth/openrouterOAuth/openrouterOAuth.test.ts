import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openRouterKeyLogsUrl,
  openRouterKeySettingsUrl,
  openRouterOAuthDisplayHandle,
  visibleOpenRouterOAuthError,
} from "../../protocol/openrouterOAuth";
import { generateAuthorizationSecrets, s256Challenge } from "../knoxOAuth/pkce";
import { waitForLoopbackCallback } from "../knoxOAuth/loopback";
import {
  clearKnoxChatOAuthSession,
  resolveProviderApiKey,
  setKnoxChatOAuthApiKey,
} from "../knoxOAuth/session";
import { loginWithOpenRouter, logoutOpenRouter } from "./client";
import {
  API_BASE,
  AUTH_URL,
  KEY_LABEL,
  LOOPBACK_PORT,
  PKCE_METHOD,
  REDIRECT_URI,
  authKeysEndpoint,
  deleteKeyEndpoint,
  modelsEndpoint,
  storage,
} from "./constants";
import {
  buildAuthorizeUrl,
  exchangeRequestBody,
  looksLikeSecret,
  mapExchangeError,
  parseErrorMessage,
  parseExchangedKey,
  parseDeletedKey,
  parseKeyInfo,
  hashOpenRouterApiKey,
} from "./http";
import {
  clearOpenRouterOAuthSession,
  resolveOpenRouterApiKey,
  setOpenRouterOAuthApiKey,
} from "./session";

const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("openrouter oauth contract", () => {
  it("locks auth URL, redirect, PKCE method, key label, and storage ids", () => {
    expect(AUTH_URL).toBe("https://openrouter.ai/auth");
    expect(API_BASE).toBe("https://openrouter.ai/api/v1");
    expect(REDIRECT_URI).toBe("http://127.0.0.1:8734/callback");
    expect(LOOPBACK_PORT).toBe(8734);
    expect(PKCE_METHOD).toBe("S256");
    expect(KEY_LABEL).toBe("KnoxCoder");
    expect(authKeysEndpoint()).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(deleteKeyEndpoint("deadbeef")).toBe(
      "https://openrouter.ai/api/v1/keys/deadbeef",
    );
    expect(modelsEndpoint()).toBe("https://openrouter.ai/api/v1/models");
    expect(storage.API_KEY_ITEM).toBe("openrouter_oauth_api_key");
    expect(storage.ACCOUNT_STATE_KEY).toBe("openrouter.oauth.account");
  });
});

describe("openrouter oauth protocol helpers", () => {
  it("uses the key label as the account handle", () => {
    expect(
      openRouterOAuthDisplayHandle({
        label: "KnoxCoder",
        creatorUserId: "user_abcdefghij",
        connectedAt: 0,
      }),
    ).toBe("KnoxCoder");
    expect(
      openRouterOAuthDisplayHandle({
        label: "",
        creatorUserId: "user_abcdefghij",
        connectedAt: 0,
      }),
    ).toBe("user_abc…");
    expect(
      visibleOpenRouterOAuthError({ state: "failed", error: "cancelled" }),
    ).toBeUndefined();
    expect(
      visibleOpenRouterOAuthError({ state: "failed", error: "denied" }),
    ).toBe("denied");
    expect(
      visibleOpenRouterOAuthError({ state: "failed", error: "expired" }),
    ).toBe("expired");
    expect(openRouterKeySettingsUrl("deadbeef")).toBe(
      "https://openrouter.ai/keys/deadbeef",
    );
    expect(openRouterKeyLogsUrl("deadbeef")).toBe(
      "https://openrouter.ai/logs?api_key_hash=deadbeef",
    );
  });
});

describe("authorize url", () => {
  it("includes S256 PKCE, callback, and key_label without client_id or state", () => {
    const secrets = generateAuthorizationSecrets();
    const url = buildAuthorizeUrl(secrets);
    const params = new URL(url).searchParams;
    expect(url.startsWith("https://openrouter.ai/auth?")).toBe(true);
    expect(params.get("callback_url")).toBe(REDIRECT_URI);
    expect(params.get("code_challenge")).toBe(secrets.pkce.challenge);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("key_label")).toBe(KEY_LABEL);
    expect(params.get("client_id")).toBeNull();
    expect(params.get("state")).toBeNull();
    expect(params.get("scope")).toBeNull();
    expect(params.get("response_type")).toBeNull();
    expect(url.toLowerCase()).not.toContain("client_secret");
    expect(url).not.toContain(secrets.pkce.verifier);
    expect(s256Challenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    expect(s256Challenge(secrets.pkce.verifier)).toBe(secrets.pkce.challenge);
  });
});

describe("exchange parsers", () => {
  it("reads { key } from the auth/keys JSON", () => {
    expect(parseExchangedKey('{"key":"sk-or-v1-abc"}')).toBe("sk-or-v1-abc");
    expect(parseExchangedKey('{"data":{"key":"sk-or-v1-nested"}}')).toBe(
      "sk-or-v1-nested",
    );
    expect(() => parseExchangedKey("{}")).toThrow(/missing key/);
  });

  it("reads GET /key label and creator_user_id", () => {
    const info = parseKeyInfo(
      '{"data":{"label":"KnoxCoder","creator_user_id":"user_abc"}}',
    );
    expect(info.label).toBe("KnoxCoder");
    expect(info.creatorUserId).toBe("user_abc");
  });

  it("drops secret-bearing error messages", () => {
    expect(
      parseErrorMessage('{"error_description":"key sk-or-v1-secret leaked"}'),
    ).toBeUndefined();
    expect(
      parseErrorMessage('{"message":"Invalid code_challenge_method"}'),
    ).toBe("Invalid code_challenge_method");
    expect(looksLikeSecret("bad code_verifier")).toBe(true);
    expect(looksLikeSecret("sk-or-v1-abc")).toBe(true);
  });

  it("exchange body has PKCE and no secret", () => {
    const body = exchangeRequestBody("auth-code", "verifier-value");
    expect(body.code).toBe("auth-code");
    expect(body.code_verifier).toBe("verifier-value");
    expect(body.code_challenge_method).toBe("S256");
    expect(
      Object.prototype.hasOwnProperty.call(body, "client_secret"),
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "client_id")).toBe(false);
  });

  it("maps expired 403 onto expired and other failures onto exchange", () => {
    expect(
      mapExchangeError(
        403,
        '{"error":{"message":"Authorization code expired"}}',
      ),
    ).toBe("expired");
    expect(
      mapExchangeError(
        400,
        '{"error":{"message":"Invalid code_challenge_method"}}',
      ),
    ).toBe("exchange");
    expect(mapExchangeError(405, "")).toBe("exchange");
  });

  it("hashes a fixture API key to a stable SHA-256 hex", () => {
    expect(hashOpenRouterApiKey("sk-or-v1-test")).toBe(
      "ea3c6d86042520298bfbda076e3abd13fc98b17835dd1dabd43f83bcff4f9971",
    );
    expect(hashOpenRouterApiKey("sk-or-v1-abc")).toBe(
      "128cd81d318f4aa7afb42db5b15496cfded945cdde7e630e81e45fd98779268e",
    );
  });

  it("reads DELETE /keys/{hash} { deleted: true }", () => {
    expect(parseDeletedKey('{"deleted":true}')).toBe(true);
    expect(parseDeletedKey("true")).toBe(true);
    expect(parseDeletedKey("")).toBe(true);
    expect(parseDeletedKey('{"deleted":false}')).toBe(false);
  });
});

describe("session key resolution", () => {
  afterEach(() => {
    clearOpenRouterOAuthSession();
    clearKnoxChatOAuthSession();
  });

  it("prefers an explicit model key over the oauth session", () => {
    setOpenRouterOAuthApiKey("sk-or-oauth");
    expect(resolveOpenRouterApiKey(" sk-or-model ")).toBe("sk-or-model");
    expect(resolveOpenRouterApiKey("")).toBe("sk-or-oauth");
    expect(resolveOpenRouterApiKey()).toBe("sk-or-oauth");
  });

  it("injects the openrouter session key the same way llmFromDescription does", () => {
    setOpenRouterOAuthApiKey("sk-or-oauth");
    // llmFromDescription / modelConfigToBaseLLM call:
    //   resolveProviderApiKey(desc.provider, desc.apiKey)
    expect(resolveProviderApiKey("openrouter", undefined)).toBe("sk-or-oauth");
    expect(resolveProviderApiKey("openrouter", "")).toBe("sk-or-oauth");
    expect(resolveProviderApiKey("openrouter", "  ")).toBe("sk-or-oauth");
  });

  it("lets an explicit openrouter model key win over the session", () => {
    setOpenRouterOAuthApiKey("sk-or-oauth");
    expect(resolveProviderApiKey("openrouter", " sk-or-model ")).toBe(
      "sk-or-model",
    );
  });

  it("does not inject the openrouter key into other providers", () => {
    setOpenRouterOAuthApiKey("sk-or-oauth");
    expect(resolveProviderApiKey("openai")).toBeUndefined();
    expect(resolveProviderApiKey("knoxchat")).toBeUndefined();
    expect(resolveProviderApiKey("openai", "sk-openai")).toBe("sk-openai");
  });

  it("keeps knoxchat and openrouter session keys isolated", () => {
    setKnoxChatOAuthApiKey("sk-knox");
    setOpenRouterOAuthApiKey("sk-or-oauth");
    expect(resolveProviderApiKey("knoxchat")).toBe("sk-knox");
    expect(resolveProviderApiKey("openrouter")).toBe("sk-or-oauth");
    expect(resolveProviderApiKey("openai")).toBeUndefined();
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

async function waitForLoopbackReady(
  port = LOOPBACK_PORT,
  attempts = 50,
): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/not-callback`);
      return;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`loopback listener not bound: ${String(last)}`);
}

describe("openrouter loopback", () => {
  it("accepts a /callback without state on 8734", async () => {
    const ok = waitForLoopbackCallback({
      expectedState: "generated-csrf",
      requireState: false,
      port: LOOPBACK_PORT,
      signal: new AbortController().signal,
      timeoutMs: 4_000,
      page: { lang: "en", title: "KnoxCoder", body: "Returning." },
    });
    const response = await fetchUntilOk(
      "http://127.0.0.1:8734/callback?code=abc",
    );
    expect(await response.text()).toContain("Returning.");
    await expect(ok).resolves.toMatchObject({ code: "abc" });
  });

  it("still rejects a mismatched state when OpenRouter echoes one", async () => {
    const mismatch = waitForLoopbackCallback({
      expectedState: "expected",
      requireState: false,
      port: LOOPBACK_PORT,
      signal: new AbortController().signal,
      timeoutMs: 4_000,
      page: { lang: "en", title: "KnoxCoder", body: "close" },
    });
    const rejected = expect(mismatch).rejects.toMatchObject({
      kind: "state_mismatch",
    });
    await fetchUntilOk(
      "http://127.0.0.1:8734/callback?code=abc&state=other",
    );
    await rejected;
  });
});

describe("loginWithOpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the host browser, exchanges PKCE for { key }, and reads the label", async () => {
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
        if (url.startsWith("http://127.0.0.1:8734/")) {
          return originalFetch(input, init);
        }
        if (url.includes("/api/v1/auth/keys")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            code?: string;
            code_verifier?: string;
            code_challenge_method?: string;
            client_secret?: string;
          };
          expect(body.code).toBe("auth-code");
          expect(body.code_verifier).toBeTruthy();
          expect(body.code_challenge_method).toBe("S256");
          expect(body.client_secret).toBeUndefined();
          return new Response(JSON.stringify({ key: "sk-or-v1-abc" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/key") || url.endsWith("/api/v1/key/")) {
          return new Response(
            JSON.stringify({
              data: { label: "KnoxCoder", creator_user_id: "user_abc" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    );

    let authorize = "";
    const states: string[] = [];
    const abort = new AbortController();
    const login = loginWithOpenRouter({
      openBrowser: async (url) => {
        authorize = url;
      },
      onState: (state) => {
        states.push(state);
      },
      page: { lang: "en", title: "KnoxCoder", body: "Returning." },
      signal: abort.signal,
    });

    for (let i = 0; i < 50 && !authorize; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const params = new URL(authorize).searchParams;
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("callback_url")).toBe(REDIRECT_URI);
    expect(params.get("key_label")).toBe(KEY_LABEL);
    expect(params.get("state")).toBeNull();
    expect(authorize.toLowerCase()).not.toContain("client_secret");
    await waitForLoopbackReady();
    await fetchUntilOk("http://127.0.0.1:8734/callback?code=auth-code");
    const session = await login;
    expect(session.apiKey).toBe("sk-or-v1-abc");
    expect(session.account).toMatchObject({
      label: "KnoxCoder",
      creatorUserId: "user_abc",
      keyHash: hashOpenRouterApiKey("sk-or-v1-abc"),
    });
    expect(states).toContain("opening_browser");
    expect(states).toContain("waiting_for_consent");
    expect(states).toContain("exchanging");
  });

  it("maps a failed openBrowser to open_browser", async () => {
    await expect(
      loginWithOpenRouter({
        openBrowser: async () => {
          throw new Error("blocked");
        },
        onState: () => undefined,
        page: { lang: "en", title: "KnoxCoder", body: "close" },
      }),
    ).rejects.toMatchObject({ kind: "open_browser" });
  });
});

describe("logoutOpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when there is no key to delete", async () => {
    expect(await logoutOpenRouter({})).toBe(true);
  });

  it("DELETEs /keys/{hash} with the minted key and treats { deleted: true } as success", async () => {
    const apiKey = "sk-or-v1-abc";
    const hash = hashOpenRouterApiKey(apiKey);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        expect(url).toBe(`https://openrouter.ai/api/v1/keys/${hash}`);
        expect(init?.method).toBe("DELETE");
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe(`Bearer ${apiKey}`);
        expect(headers.get("HTTP-Referer")).toBe(
          "https://github.com/knoxchat/knoxcoder",
        );
        expect(headers.get("X-OpenRouter-Title")).toBe("KnoxCoder");
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    expect(await logoutOpenRouter({ apiKey })).toBe(true);
  });

  it("uses the stored keyHash in the DELETE path when provided", async () => {
    const apiKey = "sk-or-v1-abc";
    const keyHash = "deadbeef";
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        expect(url).toBe(`https://openrouter.ai/api/v1/keys/${keyHash}`);
        expect(init?.method).toBe("DELETE");
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      },
    );
    expect(await logoutOpenRouter({ apiKey, keyHash })).toBe(true);
  });

  it("returns false on 401/403/404 so the host can warn (not Knox-style already-revoked)", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    expect(await logoutOpenRouter({ apiKey: "sk-or-v1-abc" })).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("forbidden", { status: 403 }));
    expect(await logoutOpenRouter({ apiKey: "sk-or-v1-abc" })).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await logoutOpenRouter({ apiKey: "sk-or-v1-abc" })).toBe(false);
  });
});
