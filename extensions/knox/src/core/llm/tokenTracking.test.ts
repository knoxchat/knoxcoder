import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetKnoxChatModelsCacheForTests } from "./knoxChatModels";
import {
  __resetOpenRouterModelsCacheForTests,
  seedOpenRouterModelsCache,
} from "./openrouterModels";
import {
  calculateCost,
  enrichWithCost,
  formatCost,
  getAvailableModelPricing,
  getModelPricing,
  normalizePricingModelId,
} from "./tokenTracking";

const perMillion = (id: string) => {
  const p = getModelPricing(id)!;
  return [p.promptPer1k * 1000, p.completionPer1k * 1000];
};

describe("tokenTracking pricing", () => {
  beforeEach(() => {
    __resetKnoxChatModelsCacheForTests();
    __resetOpenRouterModelsCacheForTests();
  });
  afterEach(() => {
    __resetKnoxChatModelsCacheForTests();
    __resetOpenRouterModelsCacheForTests();
  });

  it("normalizes ids", () => {
    expect(normalizePricingModelId("anthropic/Claude-Sonnet-4.5")).toBe(
      "claude-sonnet-4-5",
    );
  });

  it("prices current Anthropic ids, including dated and dotted forms", () => {
    expect(perMillion("claude-sonnet-4-5-20250929")).toEqual([3, 15]);
    expect(perMillion("anthropic/claude-sonnet-4.5")).toEqual([3, 15]);
    expect(perMillion("claude-opus-4-5")).toEqual([5, 25]);
    expect(perMillion("claude-opus-4-1-20250805")).toEqual([15, 75]);
    expect(perMillion("claude-haiku-4-5")).toEqual([1, 5]);
    expect(perMillion("claude-3-5-haiku-20241022")).toEqual([0.8, 4]);
  });

  it("prices current OpenAI ids and picks the longest prefix", () => {
    expect(perMillion("gpt-5")).toEqual([1.25, 10]);
    expect(perMillion("gpt-5-mini-2025-08-07")).toEqual([0.25, 2]);
    expect(perMillion("openai/gpt-4.1-mini")).toEqual([0.4, 1.6]);
    expect(perMillion("gpt-4o-mini-2024-07-18")).toEqual([0.15, 0.6]);
    expect(perMillion("gpt-4o-2024-08-06")).toEqual([2.5, 10]);
    expect(perMillion("o4-mini")).toEqual([1.1, 4.4]);
  });

  it("does not match across a non-boundary prefix", () => {
    // "gpt-4" must not price "gpt-4x-unknown"; "o1" must not price "o1x".
    expect(getModelPricing("gpt-4x-unknown")).toBeNull();
    expect(getModelPricing("o1x")).toBeNull();
  });

  it("prefers OpenRouter metadata over the table", () => {
    seedOpenRouterModelsCache([
      {
        id: "acme/brand-new-model",
        name: "Brand New",
        pricing: {
          prompt: "0.000001",
          completion: "0.000004",
          input_cache_read: "0.0000001",
        },
      },
      {
        id: "anthropic/claude-sonnet-4.5",
        name: "Sonnet",
        pricing: { prompt: "0.000009", completion: "0.000045" },
      },
    ]);
    const brandNew = getModelPricing("acme/brand-new-model")!;
    expect(brandNew.promptPer1k).toBeCloseTo(0.001);
    expect(brandNew.completionPer1k).toBeCloseTo(0.004);
    expect(brandNew.cacheReadPer1k).toBeCloseTo(0.0001);
    expect(getModelPricing("anthropic/claude-sonnet-4.5")!.promptPer1k).toBeCloseTo(
      0.009,
    );
  });

  it("prefers custom pricing over everything", () => {
    const custom = { "gpt-5": { promptPer1k: 1, completionPer1k: 2 } };
    expect(getModelPricing("gpt-5", custom)).toEqual(custom["gpt-5"]);
  });

  it("treats OpenRouter :free variants as free", () => {
    const cost = calculateCost("meta/some-model:free", 1000, 1000);
    expect(cost.pricingKnown).toBe(true);
    expect(cost.totalCost).toBe(0);
  });

  it("reports unknown (null) instead of a wrong number", () => {
    const cost = calculateCost("totally-unknown-model", 1000, 1000);
    expect(cost).toEqual({
      promptCost: null,
      completionCost: null,
      totalCost: null,
      pricingKnown: false,
    });
    expect(formatCost(cost.totalCost)).toBe("unknown");
    expect(enrichWithCost([
      { model: "totally-unknown-model", promptTokens: 1, generatedTokens: 1 },
    ])[0].pricingKnown).toBe(false);
  });

  it("computes plain cost", () => {
    const cost = calculateCost("claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(cost.promptCost).toBeCloseTo(3);
    expect(cost.completionCost).toBeCloseTo(15);
    expect(cost.totalCost).toBeCloseTo(18);
  });

  it("prices cache read/write tokens with their own rates", () => {
    const cost = calculateCost("claude-sonnet-4-5", 0, 0, undefined, {
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(cost.totalCost).toBeCloseTo(0.3 + 3.75);
  });

  it("bills cache tokens at the input rate when no cache rate exists", () => {
    const cost = calculateCost("gpt-4-turbo", 0, 0, undefined, {
      cacheReadTokens: 1_000_000,
    });
    expect(cost.totalCost).toBeCloseTo(10);
  });

  it("formats costs", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.0012)).toBe("$0.0012");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(null)).toBe("unknown");
  });

  it("exposes the bundled table in per-1k units", () => {
    expect(getAvailableModelPricing()["gpt-5"].promptPer1k).toBeCloseTo(0.00125);
  });
});
