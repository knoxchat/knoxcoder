import { describe, expect, it } from "vitest";

import {
  applyJevConfig,
  getActiveJevRuntime,
  jevCanCallNetwork,
  mergeJevConfigWithFallback,
  normalizeJevBaseUrl,
  pickKnoxChatJevFallback,
  resolveJevApiKey,
  resolveJevRuntime,
} from "./config";

describe("normalizeJevBaseUrl", () => {
  it("strips trailing slashes and /v1", () => {
    expect(normalizeJevBaseUrl("https://api.knoxstudio.ai")).toBe(
      "https://api.knoxstudio.ai",
    );
    expect(normalizeJevBaseUrl("https://api.knoxstudio.ai/")).toBe(
      "https://api.knoxstudio.ai",
    );
    expect(normalizeJevBaseUrl("https://api.knoxstudio.ai/v1")).toBe(
      "https://api.knoxstudio.ai",
    );
    expect(normalizeJevBaseUrl("https://api.knoxstudio.ai/v1/")).toBe(
      "https://api.knoxstudio.ai",
    );
    expect(normalizeJevBaseUrl("https://api.knoxstudio.ai/api/v1")).toBe(
      "https://api.knoxstudio.ai",
    );
  });
});

describe("pickKnoxChatJevFallback", () => {
  it("prefers the first knoxchat model with a key", () => {
    expect(
      pickKnoxChatJevFallback([
        { providerName: "openai", apiKey: "sk-openai" },
        { providerName: "knoxchat", apiKey: "", apiBase: "https://api.knoxstudio.ai/v1/" },
        {
          providerName: "knoxchat",
          apiKey: " sk-knox ",
          apiBase: "https://other.example/v1/",
        },
      ]),
    ).toEqual({
      apiKey: "sk-knox",
    });
  });

  it("returns empty when no knoxchat key exists", () => {
    expect(
      pickKnoxChatJevFallback([
        { providerName: "anthropic", apiKey: "sk-ant" },
      ]),
    ).toEqual({ apiKey: "" });
  });

  it("falls back to the KnoxChat OAuth session key", async () => {
    const { setKnoxChatOAuthApiKey, clearKnoxChatOAuthSession } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-oauth");
    try {
      expect(pickKnoxChatJevFallback([])).toEqual({ apiKey: "sk-oauth" });
    } finally {
      clearKnoxChatOAuthSession();
    }
  });
});

describe("mergeJevConfigWithFallback", () => {
  it("inherits the knoxchat key and always uses api.knoxstudio.ai", () => {
    const merged = mergeJevConfigWithFallback(
      { enabled: true },
      { apiKey: "sk-knox" },
    );
    expect(merged).toEqual({
      enabled: true,
      apiKey: "sk-knox",
      baseUrl: "https://api.knoxstudio.ai",
    });
    const runtime = resolveJevRuntime(merged);
    expect(runtime.apiKey).toBe("sk-knox");
    expect(runtime.baseUrl).toBe("https://api.knoxstudio.ai");
    expect(runtime.enabled).toBe(true);
  });

  it("keeps an explicit YAML key but ignores a custom host", () => {
    const merged = mergeJevConfigWithFallback(
      {
        enabled: true,
        apiKey: "sk-jev-only",
        baseUrl: "https://api.typesafe.ai",
      },
      { apiKey: "sk-knox" },
    );
    expect(merged?.apiKey).toBe("sk-jev-only");
    expect(merged?.baseUrl).toBe("https://api.knoxstudio.ai");
  });

  it("does not route a TypeSafe key to api.typesafe.ai", () => {
    const merged = mergeJevConfigWithFallback(
      { enabled: true, apiKey: "ts-legacy" },
      { apiKey: "sk-knox" },
    );
    expect(merged?.apiKey).toBe("ts-legacy");
    expect(merged?.baseUrl).toBe("https://api.knoxstudio.ai");
    expect(resolveJevRuntime(merged).baseUrl).toBe("https://api.knoxstudio.ai");
  });

  it("does not invent a jev block when yaml is missing", () => {
    expect(
      mergeJevConfigWithFallback(undefined, { apiKey: "sk-knox" }),
    ).toBeUndefined();
  });
});

describe("resolveJevApiKey / live OAuth session", () => {
  it("uses the KnoxChat OAuth session when yaml has no key", async () => {
    const { setKnoxChatOAuthApiKey, clearKnoxChatOAuthSession } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-oauth");
    try {
      expect(resolveJevApiKey()).toBe("sk-oauth");
      const runtime = resolveJevRuntime({ enabled: true });
      expect(runtime.apiKey).toBe("sk-oauth");
      expect(jevCanCallNetwork(runtime)).toBe(true);

      applyJevConfig({ enabled: true });
      expect(getActiveJevRuntime().enabled).toBe(true);
      expect(getActiveJevRuntime().apiKey).toBe("sk-oauth");
    } finally {
      clearKnoxChatOAuthSession();
      applyJevConfig();
    }
  });

  it("prefers an explicit jev.apiKey over the OAuth session", async () => {
    const { setKnoxChatOAuthApiKey, clearKnoxChatOAuthSession } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-oauth");
    try {
      expect(resolveJevApiKey({ apiKey: " sk-jev-only " })).toBe("sk-jev-only");
    } finally {
      clearKnoxChatOAuthSession();
    }
  });

  it("does not treat a stale empty snapshot as a missing session", async () => {
    const { setKnoxChatOAuthApiKey, clearKnoxChatOAuthSession } = await import(
      "../auth/knoxOAuth/session"
    );
    applyJevConfig({ enabled: true });
    expect(getActiveJevRuntime().apiKey).toBe("");
    setKnoxChatOAuthApiKey("sk-oauth-later");
    try {
      expect(getActiveJevRuntime().apiKey).toBe("sk-oauth-later");
      expect(jevCanCallNetwork(getActiveJevRuntime())).toBe(true);
    } finally {
      clearKnoxChatOAuthSession();
      applyJevConfig();
    }
  });
});
