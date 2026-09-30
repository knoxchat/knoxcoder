import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearOpenRouterOAuthSession, setOpenRouterOAuthApiKey } from "../auth/openrouterOAuth/session";
import {
  __resetKnoxChatModelsCacheForTests,
  findKnoxChatModelSync,
  seedKnoxChatModelsCache,
} from "./knoxChatModels";
import {
  __resetOpenRouterModelsCacheForTests,
  applyOpenRouterAliasFloorPricing,
  checkOpenRouterToolSupportSync,
  findOpenRouterModelSync,
  getOpenRouterModels,
  hydrateOpenRouterModelsCacheFromDisk,
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MODELS_PERSIST_KEY,
  OPENROUTER_MODELS_URL,
  registerOpenRouterModelsDiskAdapter,
  seedOpenRouterModelsCache,
  shouldEnrichFromOpenRouterApi,
} from "./openrouterModels";

const sampleModel = {
  id: "anthropic/claude-sonnet-4.6",
  name: "Claude Sonnet 4.6",
  supported_parameters: ["tools", "tool_choice"],
};

const createLocalStorageMock = () => {
  const store: Record<string, string> = {};
  return {
    store,
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
  };
};

describe("openrouterModels catalog", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    __resetOpenRouterModelsCacheForTests();
    __resetKnoxChatModelsCacheForTests();
    clearOpenRouterOAuthSession();
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => {
    __resetOpenRouterModelsCacheForTests();
    __resetKnoxChatModelsCacheForTests();
    clearOpenRouterOAuthSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the public OpenRouter /models URL and a separate persist key", () => {
    expect(OPENROUTER_MODELS_URL).toBe("https://openrouter.ai/api/v1/models");
    expect(OPENROUTER_MODELS_PERSIST_KEY).toBe("openrouterModelsCache.v2");
  });

  it("seeds cache and answers sync lookups without touching KnoxChat", () => {
    seedOpenRouterModelsCache([sampleModel]);
    seedKnoxChatModelsCache([{ id: "knox/knox-ms", supported_parameters: ["tools"] }]);

    expect(checkOpenRouterToolSupportSync("anthropic/claude-sonnet-4.6")).toBe(
      true,
    );
    expect(findOpenRouterModelSync("knox/knox-ms")).toBeUndefined();
    expect(findKnoxChatModelSync("anthropic/claude-sonnet-4.6")).toBeUndefined();
  });

  it("persists last-good catalog to openrouterModelsCache.v2", () => {
    seedOpenRouterModelsCache([sampleModel]);
    __resetOpenRouterModelsCacheForTests();

    expect(findOpenRouterModelSync("anthropic/claude-sonnet-4.6")?.id).toBe(
      "anthropic/claude-sonnet-4.6",
    );
    expect(localStorageMock.store[OPENROUTER_MODELS_PERSIST_KEY]).toBeDefined();
    expect(localStorageMock.store.knoxChatModelsCache).toBeUndefined();
  });

  it("hydrates from a registered Node disk adapter when localStorage is empty", () => {
    const catalog = {
      version: 1 as const,
      savedAt: Date.now(),
      models: [sampleModel],
    };
    registerOpenRouterModelsDiskAdapter({
      readSync: () => JSON.stringify(catalog),
      write: async () => {},
    });
    localStorageMock.store = {};

    hydrateOpenRouterModelsCacheFromDisk();
    expect(findOpenRouterModelSync("anthropic/claude-sonnet-4.6")?.id).toBe(
      "anthropic/claude-sonnet-4.6",
    );
  });

  it("omits Bearer when no session key exists", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [sampleModel] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await getOpenRouterModels();
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })
      ?.headers;
    expect(headers?.Authorization).toBeUndefined();
  });

  it("sends Bearer when a session key exists", async () => {
    setOpenRouterOAuthApiKey("sk-or-test-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [sampleModel] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await getOpenRouterModels();
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })
      ?.headers;
    expect(headers?.Authorization).toBe("Bearer sk-or-test-key");
  });

  it("returns curated fallback models when fetch fails and cache is cold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    const models = await getOpenRouterModels();
    expect(models.map((model) => model.id)).toEqual(
      OPENROUTER_FALLBACK_MODELS.map((model) => model.id),
    );
    expect(models.some((model) => model.id === "openai/gpt-4o")).toBe(true);
  });

  it("enriches only OpenRouter providers", () => {
    expect(
      shouldEnrichFromOpenRouterApi({ providerName: "openrouter" }),
    ).toBe(true);
    expect(
      shouldEnrichFromOpenRouterApi({
        providerName: "openai",
        apiBase: "https://openrouter.ai/api/v1/",
      }),
    ).toBe(true);
    expect(
      shouldEnrichFromOpenRouterApi({ providerName: "knoxchat" }),
    ).toBe(false);
  });

  it("copies cheaper ~latest alias pricing onto the alias target from /api/v1/models", () => {
    const models = applyOpenRouterAliasFloorPricing([
      {
        id: "z-ai/glm-5.3-flash",
        name: "Z.ai: GLM 5.3 Flash",
        pricing: {
          prompt: "0.00000015",
          completion: "0.0000005",
          input_cache_read: "0.00000003",
        },
      },
      {
        id: "~z-ai/glm-flash-latest",
        name: "Z.ai: GLM Flash Latest",
        alias_target: {
          name: "Z.ai: GLM 5.3 Flash",
          slug: "z-ai/glm-5.3-flash",
        },
        pricing: {
          prompt: "0.00000002",
          completion: "0.0000002475",
          input_cache_read: "0.00000001",
        },
      },
    ]);

    expect(models.find((model) => model.id === "z-ai/glm-5.3-flash")?.pricing).toEqual({
      prompt: "0.00000002",
      completion: "0.0000002475",
      input_cache_read: "0.00000001",
    });
    expect(
      models.find((model) => model.id === "~z-ai/glm-flash-latest")?.pricing,
    ).toEqual({
      prompt: "0.00000002",
      completion: "0.0000002475",
      input_cache_read: "0.00000001",
    });
  });

  it("applies ~latest alias floor pricing when fetching GET /api/v1/models", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "z-ai/glm-5.3-flash",
            name: "Z.ai: GLM 5.3 Flash",
            pricing: { prompt: "0.00000015", completion: "0.0000005" },
          },
          {
            id: "~z-ai/glm-flash-latest",
            alias_target: { slug: "z-ai/glm-5.3-flash" },
            pricing: { prompt: "0.00000002", completion: "0.0000002475" },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const models = await getOpenRouterModels();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(OPENROUTER_MODELS_URL);
    expect(models.find((model) => model.id === "z-ai/glm-5.3-flash")?.pricing).toEqual({
      prompt: "0.00000002",
      completion: "0.0000002475",
    });
  });

  it("applies ~latest alias floor pricing when seeding the OpenRouter catalog", () => {
    seedOpenRouterModelsCache([
      {
        id: "z-ai/glm-5.3-flash",
        name: "Z.ai: GLM 5.3 Flash",
        pricing: { prompt: "0.00000015", completion: "0.0000005" },
      },
      {
        id: "~z-ai/glm-flash-latest",
        alias_target: { slug: "z-ai/glm-5.3-flash" },
        pricing: { prompt: "0.00000002", completion: "0.0000002475" },
      },
    ]);

    expect(findOpenRouterModelSync("z-ai/glm-5.3-flash")?.pricing).toEqual({
      prompt: "0.00000002",
      completion: "0.0000002475",
    });
  });
});
