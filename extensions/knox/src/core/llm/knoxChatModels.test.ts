import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetKnoxChatModelsCacheForTests,
  checkKnoxChatWebSearchSupportSync,
  deriveEnrichedModelParams,
  findKnoxChatModelSync,
  formatModelPricingPerMillion,
  getModelPricingFromMetadata,
  hydrateKnoxChatModelsCacheFromDisk,
  KNOX_CHAT_MODELS_URL,
  modelSupportsWebSearchFromMetadata,
  registerKnoxChatModelsDiskAdapter,
  seedKnoxChatModelsCache,
  type KnoxChatModelMetadata,
} from "./knoxChatModels";
import {
  getReasoningEffortConfigFromMetadata,
  resolveReasoningEffortConfigForModel,
} from "./reasoningEffortConfig";

const sampleModel = (
  overrides: Partial<KnoxChatModelMetadata> = {},
): KnoxChatModelMetadata => ({
  id: "openai/gpt-test",
  supported_parameters: ["tools", "reasoning_effort"],
  pricing: {
    prompt: "0.000001",
    completion: "0.000002",
    web_search: "10.00",
  },
  pricing_in_display_units: false,
  ...overrides,
});

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

describe("knoxChatModels cache + capabilities", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    __resetKnoxChatModelsCacheForTests();
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => {
    __resetKnoxChatModelsCacheForTests();
    vi.unstubAllGlobals();
  });

  it("returns undefined from sync helpers when cache is cold", () => {
    expect(checkKnoxChatWebSearchSupportSync("openai/gpt-test")).toBeUndefined();
    expect(findKnoxChatModelSync("openai/gpt-test")).toBeUndefined();
  });

  it("seeds cache and answers sync lookups", () => {
    seedKnoxChatModelsCache([
      sampleModel({
        id: "anthropic/claude-opus-5",
        supported_parameters: ["tools"],
        pricing: {
          prompt: "0.000015",
          completion: "0.000075",
          web_search: "10.00",
        },
      }),
    ]);

    expect(checkKnoxChatWebSearchSupportSync("anthropic/claude-opus-5")).toBe(
      true,
    );
    expect(
      modelSupportsWebSearchFromMetadata(
        findKnoxChatModelSync("anthropic/claude-opus-5")!,
      ),
    ).toBe(true);
  });

  it("persists last-good catalog to localStorage on seed", () => {
    seedKnoxChatModelsCache([sampleModel({ id: "openai/gpt-persist" })]);
    __resetKnoxChatModelsCacheForTests();

    expect(findKnoxChatModelSync("openai/gpt-persist")?.id).toBe(
      "openai/gpt-persist",
    );
  });

  it("hydrates from a registered Node disk adapter when localStorage is empty", () => {
    const catalog = {
      version: 1 as const,
      savedAt: Date.now(),
      models: [sampleModel({ id: "openai/gpt-from-disk" })],
    };
    registerKnoxChatModelsDiskAdapter({
      readSync: () => JSON.stringify(catalog),
      write: async () => {},
    });
    // Drop browser store so hydrate falls through to the disk adapter.
    localStorageMock.store = {};

    hydrateKnoxChatModelsCacheFromDisk();
    expect(findKnoxChatModelSync("openai/gpt-from-disk")?.id).toBe(
      "openai/gpt-from-disk",
    );
  });

  it("derives pricing and capabilities from metadata", () => {
    const enriched = deriveEnrichedModelParams(
      sampleModel({
        supported_parameters: ["tools", "tool_choice", "reasoning_effort"],
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
      }),
    );
    expect(enriched.capabilities.tools).toBe(true);
    expect(enriched.capabilities.reasoning).toBe(true);
    expect(enriched.capabilities.uploadImage).toBe(true);
    expect(enriched.capabilities.webSearch).toBe(true);
    expect(enriched.pricing?.promptPer1k).toBeCloseTo(0.001);
    expect(enriched.pricing?.webSearch).toBe(10);
  });

  it("uses the interactive /v1/models catalog URL", () => {
    expect(KNOX_CHAT_MODELS_URL).toBe(
      "https://api.knoxstudio.ai/v1/models?interactive=true",
    );
  });

  it("converts display-unit ($/1M) prices to per-1K for cost math", () => {
    const pricing = getModelPricingFromMetadata(
      sampleModel({
        pricing: {
          prompt: "10.00",
          completion: "50.00",
          web_search: "10.00",
        },
        pricing_in_display_units: true,
      }),
    );
    expect(pricing?.promptPer1k).toBeCloseTo(0.01);
    expect(pricing?.completionPer1k).toBeCloseTo(0.05);
    expect(formatModelPricingPerMillion(pricing!)).toEqual({
      badge: "$10/50",
      title: "$10 / $50 per 1M tokens",
    });
  });

  it("formats fractional $/1M prices without 1K rounding errors", () => {
    const pricing = getModelPricingFromMetadata(
      sampleModel({
        pricing: {
          prompt: "5.00",
          completion: "25.00",
        },
        pricing_in_display_units: true,
      }),
    );
    expect(formatModelPricingPerMillion(pricing!).badge).toBe("$5/25");
  });
});

describe("reasoning effort resolution", () => {
  beforeEach(() => {
    __resetKnoxChatModelsCacheForTests();
  });

  it("prefers API reasoning.supported_efforts over sidecar", () => {
    const metadata = sampleModel({
      id: "openai/gpt-5.4",
      reasoning: {
        supported_efforts: ["low", "high"],
        default_effort: "high",
      },
    });
    const config = getReasoningEffortConfigFromMetadata(metadata);
    expect(config).toEqual({ allowed: ["low", "high"], default: "high" });
  });

  it("uses versioned sidecar when API has no reasoning object", () => {
    seedKnoxChatModelsCache([
      sampleModel({
        id: "openai/gpt-5.4",
        supported_parameters: ["reasoning", "reasoning_effort"],
      }),
    ]);
    const config = resolveReasoningEffortConfigForModel({
      modelId: "openai/gpt-5.4",
    });
    expect(config?.allowed).toContain("xhigh");
    expect(config?.default).toBe("none");
  });

  it("falls back to gateway default for unknown effort models", () => {
    const config = resolveReasoningEffortConfigForModel({
      modelId: "vendor/new-model-no-sidecar",
      supportedParameters: ["reasoning_effort"],
    });
    expect(config?.allowed).toContain("medium");
    expect(config?.default).toBe("medium");
  });

  it("hides effort UI when only reasoning/include_reasoning are advertised", () => {
    seedKnoxChatModelsCache([
      sampleModel({
        id: "google/gemma-4-31b-it",
        supported_parameters: [
          "include_reasoning",
          "reasoning",
          "temperature",
          "tools",
        ],
      }),
    ]);
    expect(
      resolveReasoningEffortConfigForModel({
        modelId: "google/gemma-4-31b-it",
      }),
    ).toBeNull();
    expect(
      resolveReasoningEffortConfigForModel({
        modelId: "google/gemma-4-31b-it",
        supportedParameters: ["reasoning", "include_reasoning"],
      }),
    ).toBeNull();
  });

  it("does not use sidecar alone without reasoning_effort in /v1/models", () => {
    seedKnoxChatModelsCache([
      sampleModel({
        id: "anthropic/claude-sonnet-4.6",
        supported_parameters: ["tools", "temperature", "max_tokens"],
      }),
    ]);
    expect(
      resolveReasoningEffortConfigForModel({
        modelId: "anthropic/claude-sonnet-4.6",
      }),
    ).toBeNull();
  });
});
