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
    expect(perMillion("claude-sonnet-5-5-20260928")).toEqual([2, 10]);
    expect(perMillion("anthropic/claude-sonnet-5.5")).toEqual([2, 10]);
    expect(perMillion("claude-opus-5-5")).toEqual([4, 20]);
    expect(perMillion("anthropic/claude-haiku-4.5")).toEqual([1, 5]);
    expect(perMillion("claude-haiku-4-5-20251015")).toEqual([1, 5]);
  });

  it("prices current OpenAI ids and picks the longest prefix", () => {
    expect(perMillion("gpt-6-luna")).toEqual([0.1, 0.5]);
    expect(perMillion("gpt-6-luna-pro")).toEqual([0.1, 0.5]);
    expect(perMillion("openai/gpt-6.1-sol")).toEqual([2, 10]);
    expect(perMillion("gpt-6-sol-2026-09-22")).toEqual([2, 10]);
  });

  it("does not match across a non-boundary prefix", () => {
    // "gpt-6-sol" must not price "gpt-6-solx"; "gpt-6-luna" must not price "gpt-6-lunar".
    expect(getModelPricing("gpt-6-solx")).toBeNull();
    expect(getModelPricing("gpt-6-lunar")).toBeNull();
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
    const cost = calculateCost("claude-sonnet-5-5", 1_000_000, 1_000_000);
    expect(cost.promptCost).toBeCloseTo(2);
    expect(cost.completionCost).toBeCloseTo(10);
    expect(cost.totalCost).toBeCloseTo(12);
  });

  it("prices cache read/write tokens with their own rates", () => {
    const cost = calculateCost("claude-sonnet-5-5", 0, 0, undefined, {
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(cost.totalCost).toBeCloseTo(0.2 + 2.5);
  });

  it("bills cache tokens at the input rate when no cache rate exists", () => {
    const cost = calculateCost(
      "custom-model",
      0,
      0,
      { "custom-model": { promptPer1k: 0.01, completionPer1k: 0.02 } },
      { cacheReadTokens: 1_000_000 },
    );
    expect(cost.totalCost).toBeCloseTo(10);
  });

  it("formats costs", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.0012)).toBe("$0.0012");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(null)).toBe("unknown");
  });

  it("exposes the bundled table in per-1k units", () => {
    expect(getAvailableModelPricing()["gpt-6-luna"].promptPer1k).toBeCloseTo(0.0001);
  });
});
