import { afterEach, describe, expect, it } from "vitest";

import {
  applyJevConfig,
  getActiveJevRuntime,
  jevCanCallNetwork,
  jevSystemOneUrl,
  mapJevModel,
  mergeJevConfigWithFallback,
  normalizeJevBaseUrl,
  pickKnoxChatJevFallback,
  resolveJevApiKey,
  resolveJevRuntime,
} from "./config";
import { clearKnoxChatOAuthSession } from "../auth/knoxOAuth/session";
import { clearOpenRouterOAuthSession } from "../auth/openrouterOAuth/session";

afterEach(() => {
  clearKnoxChatOAuthSession();
  clearOpenRouterOAuthSession();
  applyJevConfig();
});

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

  it("keeps OpenRouter System One at https://openrouter.ai/api", () => {
    expect(normalizeJevBaseUrl("https://openrouter.ai")).toBe(
      "https://openrouter.ai/api",
    );
    expect(normalizeJevBaseUrl("https://openrouter.ai/api")).toBe(
      "https://openrouter.ai/api",
    );
    expect(normalizeJevBaseUrl("https://openrouter.ai/api/")).toBe(
      "https://openrouter.ai/api",
    );
    expect(normalizeJevBaseUrl("https://openrouter.ai/api/v1")).toBe(
      "https://openrouter.ai/api",
    );
    expect(normalizeJevBaseUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api",
    );
    expect(jevSystemOneUrl("https://openrouter.ai/api/v1")).toBe(
      "https://openrouter.ai/api/v1/systemone",
    );
  });
});

describe("mapJevModel", () => {
  it("defaults OpenRouter to typesafe/jev-1.14", () => {
    expect(mapJevModel("", "openrouter")).toBe("typesafe/jev-1.14");
    expect(mapJevModel("jev-1.14", "openrouter")).toBe("typesafe/jev-1.14");
    expect(mapJevModel("jev-1.14.0", "openrouter")).toBe("typesafe/jev-1.14");
    expect(mapJevModel("jev-latest", "openrouter")).toBe("~typesafe/jev-latest");
    expect(mapJevModel("typesafe/jev-1.14", "openrouter")).toBe(
      "typesafe/jev-1.14",
    );
    expect(mapJevModel("jev-1.13.0", "openrouter")).toBe("typesafe/jev-1.13");
  });

  it("keeps KnoxStudio bare ids", () => {
    expect(mapJevModel("jev-1.13.0", "knoxchat")).toBe("jev-1.13.0");
    expect(mapJevModel("typesafe/jev-1.14", "knoxchat")).toBe("jev-1.14");
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
      provider: "knoxchat",
    });
  });

  it("returns empty when no knoxchat or openrouter key exists", () => {
    expect(
      pickKnoxChatJevFallback([
        { providerName: "anthropic", apiKey: "sk-ant" },
      ]),
    ).toEqual({ apiKey: "", provider: "knoxchat" });
  });

  it("falls back to the KnoxChat OAuth session key", async () => {
    const { setKnoxChatOAuthApiKey } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-oauth");
    expect(pickKnoxChatJevFallback([])).toEqual({
      apiKey: "sk-oauth",
      provider: "knoxchat",
    });
  });

  it("uses the selected OpenRouter model key", () => {
    expect(
      pickKnoxChatJevFallback([
        {
          providerName: "openrouter",
          apiKey: "sk-or-v1-chat",
          apiBase: "https://openrouter.ai/api/v1/",
        },
        { providerName: "knoxchat", apiKey: "sk-knox" },
      ]),
    ).toEqual({
      apiKey: "sk-or-v1-chat",
      provider: "openrouter",
    });
  });

  it("keeps OpenRouter as the provider when the selected model has no key yet", async () => {
    const { setKnoxChatOAuthApiKey } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-knox-oauth");
    expect(
      pickKnoxChatJevFallback([
        {
          providerName: "openrouter",
          apiKey: "",
          apiBase: "https://openrouter.ai/api/v1/",
        },
      ]),
    ).toEqual({
      apiKey: "",
      provider: "openrouter",
    });
  });

  it("falls back to the OpenRouter OAuth session when no Knox key exists", async () => {
    const { setOpenRouterOAuthApiKey } = await import(
      "../auth/openrouterOAuth/session"
    );
    setOpenRouterOAuthApiKey("sk-or-oauth");
    expect(pickKnoxChatJevFallback([])).toEqual({
      apiKey: "sk-or-oauth",
      provider: "openrouter",
    });
  });
});

describe("mergeJevConfigWithFallback", () => {
  it("inherits the knoxchat key and uses api.knoxstudio.ai", () => {
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
    expect(runtime.provider).toBe("knoxchat");
    expect(runtime.model).toBe("jev-1.13.0");
    expect(runtime.enabled).toBe(true);
  });

  it("routes OpenRouter fallback to openrouter.ai/api and typesafe/jev-1.14", () => {
    const merged = mergeJevConfigWithFallback(
      { enabled: true },
      { apiKey: "sk-or-v1-chat", provider: "openrouter" },
    );
    expect(merged).toEqual({
      enabled: true,
      apiKey: "sk-or-v1-chat",
      baseUrl: "https://openrouter.ai/api",
    });
    const runtime = resolveJevRuntime(merged);
    expect(runtime.provider).toBe("openrouter");
    expect(runtime.baseUrl).toBe("https://openrouter.ai/api");
    expect(runtime.model).toBe("typesafe/jev-1.14");
    expect(runtime.apiKey).toBe("sk-or-v1-chat");
  });

  it("keeps an explicit YAML key but ignores a TypeSafe host", () => {
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

  it("lets the selected OpenRouter model beat a leftover Knox yaml baseUrl", () => {
    const merged = mergeJevConfigWithFallback(
      {
        enabled: true,
        baseUrl: "https://api.knoxstudio.ai",
      },
      { apiKey: "sk-or-v1-chat", provider: "openrouter" },
    );
    expect(merged?.apiKey).toBe("sk-or-v1-chat");
    expect(merged?.baseUrl).toBe("https://openrouter.ai/api");
    expect(resolveJevRuntime(merged).model).toBe("typesafe/jev-1.14");
  });

  it("routes an sk-or- YAML key to OpenRouter even if fallback is Knox", () => {
    const merged = mergeJevConfigWithFallback(
      { enabled: true, apiKey: "sk-or-v1-jev" },
      { apiKey: "sk-knox", provider: "knoxchat" },
    );
    expect(merged?.apiKey).toBe("sk-or-v1-jev");
    expect(merged?.baseUrl).toBe("https://openrouter.ai/api");
    expect(resolveJevRuntime(merged).model).toBe("typesafe/jev-1.14");
  });

  it("does not invent a jev block when yaml is missing", () => {
    expect(
      mergeJevConfigWithFallback(undefined, { apiKey: "sk-knox" }),
    ).toBeUndefined();
  });
});

describe("resolveJevApiKey / live OAuth session", () => {
  it("uses the KnoxChat OAuth session when yaml has no key", async () => {
    const { setKnoxChatOAuthApiKey } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-oauth");
    expect(resolveJevApiKey()).toBe("sk-oauth");
    const runtime = resolveJevRuntime({ enabled: true });
    expect(runtime.apiKey).toBe("sk-oauth");
    expect(runtime.provider).toBe("knoxchat");
    expect(jevCanCallNetwork(runtime)).toBe(true);

    applyJevConfig({ enabled: true });
    expect(getActiveJevRuntime().enabled).toBe(true);
    expect(getActiveJevRuntime().apiKey).toBe("sk-oauth");
  });

  it("uses the OpenRouter OAuth session when Knox is not signed in", async () => {
    const { setOpenRouterOAuthApiKey } = await import(
      "../auth/openrouterOAuth/session"
    );
    setOpenRouterOAuthApiKey("sk-or-oauth");
    expect(resolveJevApiKey()).toBe("sk-or-oauth");
    const runtime = resolveJevRuntime({ enabled: true });
    expect(runtime.apiKey).toBe("sk-or-oauth");
    expect(runtime.provider).toBe("openrouter");
    expect(runtime.baseUrl).toBe("https://openrouter.ai/api");
    expect(runtime.model).toBe("typesafe/jev-1.14");
    expect(jevCanCallNetwork(runtime)).toBe(true);
  });

  it("prefers an explicit jev.apiKey over the OAuth session", async () => {
    const { setKnoxChatOAuthApiKey } = await import(
      "../auth/knoxOAuth/session"
    );
    setKnoxChatOAuthApiKey("sk-oauth");
    expect(resolveJevApiKey({ apiKey: " sk-jev-only " })).toBe("sk-jev-only");
  });

  it("does not treat a stale empty snapshot as a missing session", async () => {
    const { setKnoxChatOAuthApiKey } = await import(
      "../auth/knoxOAuth/session"
    );
    applyJevConfig({ enabled: true });
    expect(getActiveJevRuntime().apiKey).toBe("");
    setKnoxChatOAuthApiKey("sk-oauth-later");
    expect(getActiveJevRuntime().apiKey).toBe("sk-oauth-later");
    expect(jevCanCallNetwork(getActiveJevRuntime())).toBe(true);
  });

  it("picks up a late OpenRouter sign-in when no Knox key exists", async () => {
    const { setOpenRouterOAuthApiKey } = await import(
      "../auth/openrouterOAuth/session"
    );
    applyJevConfig({ enabled: true });
    expect(getActiveJevRuntime().apiKey).toBe("");
    expect(getActiveJevRuntime().provider).toBe("knoxchat");
    setOpenRouterOAuthApiKey("sk-or-later");
    expect(getActiveJevRuntime().apiKey).toBe("sk-or-later");
    expect(getActiveJevRuntime().provider).toBe("openrouter");
    expect(getActiveJevRuntime().model).toBe("typesafe/jev-1.14");
  });
});
