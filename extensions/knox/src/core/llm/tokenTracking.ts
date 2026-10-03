/**
 * Token tracking and cost estimation utilities.
 *
 * Pricing resolution order:
 *   1. caller-supplied custom pricing
 *   2. live KnoxChat /v1/models metadata
 *   3. live OpenRouter /api/v1/models metadata
 *   4. the bundled fallback table (`modelPricing.json`)
 * If none match, pricing is unknown and costs are reported as `null`
 * rather than a misleading 0.
 */

import {
  getKnoxChatModelPricingSync,
  getModelPricingFromMetadata,
} from "./knoxChatModels.js";
import { findOpenRouterModelSync } from "./openrouterModels.js";
import pricingTable from "./modelPricing.json";

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
  image?: number;
  cacheReadPer1k?: number;
  cacheWritePer1k?: number;
  webSearch?: number;
}

interface PricingRow {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Table rows are USD per 1M tokens; convert to the per-1K shape used elsewhere. */
function rowToPricing(row: PricingRow): ModelPricing {
  return {
    promptPer1k: row.input / 1000,
    completionPer1k: row.output / 1000,
    ...(row.cacheRead !== undefined ? { cacheReadPer1k: row.cacheRead / 1000 } : {}),
    ...(row.cacheWrite !== undefined ? { cacheWritePer1k: row.cacheWrite / 1000 } : {}),
  };
}

const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = Object.fromEntries(
  Object.entries(pricingTable.models as Record<string, PricingRow>).map(
    ([id, row]) => [id, rowToPricing(row)],
  ),
);

/** Lowercase, drop provider prefix, and turn dots into dashes (claude-sonnet-4.5 -> claude-sonnet-4-5). */
export function normalizePricingModelId(modelName: string): string {
  const bare = modelName.trim().toLowerCase().split("/").pop() ?? "";
  return bare.replace(/\./g, "-");
}

/** Longest-prefix match that only breaks on a `-`, `:` or `@` boundary. */
function lookupTablePricing(modelName: string): ModelPricing | null {
  const id = normalizePricingModelId(modelName);
  let best: string | undefined;
  for (const key of Object.keys(DEFAULT_MODEL_PRICING)) {
    if (!id.startsWith(key)) {
      continue;
    }
    const next = id.charAt(key.length);
    if (next !== "" && next !== "-" && next !== ":" && next !== "@") {
      continue;
    }
    if (best === undefined || key.length > best.length) {
      best = key;
    }
  }
  return best ? DEFAULT_MODEL_PRICING[best] : null;
}

// ── Cost Calculation ─────────────────────────────────────────────────

export interface TokenUsageWithCost {
  model: string;
  promptTokens: number;
  generatedTokens: number;
  /** `null` when pricing for the model is unknown. */
  promptCost: number | null;
  completionCost: number | null;
  totalCost: number | null;
  pricingKnown: boolean;
}

export interface DailyUsageWithCost {
  day: string;
  promptTokens: number;
  generatedTokens: number;
  estimatedCost: number | null;
}

/**
 * Look up pricing for a model name (see the resolution order in the header).
 */
export function getModelPricing(
  modelName: string,
  customPricing?: Record<string, ModelPricing>,
): ModelPricing | null {
  if (customPricing?.[modelName]) {
    return customPricing[modelName];
  }

  const apiPricing = getKnoxChatModelPricingSync(modelName);
  if (apiPricing) {
    return apiPricing;
  }

  const orModel = findOpenRouterModelSync(modelName);
  if (orModel) {
    const orPricing = getModelPricingFromMetadata(orModel);
    if (orPricing) {
      return orPricing;
    }
  }

  // OpenRouter `:free` variants cost nothing.
  if (modelName.toLowerCase().endsWith(":free")) {
    return { promptPer1k: 0, completionPer1k: 0 };
  }

  return lookupTablePricing(modelName);
}

export interface CostResult {
  promptCost: number | null;
  completionCost: number | null;
  totalCost: number | null;
  pricingKnown: boolean;
}

export interface CacheTokenUsage {
  /** Tokens read from the prompt cache (not included in `promptTokens`). */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache (not included in `promptTokens`). */
  cacheWriteTokens?: number;
}

/**
 * Calculate cost for a single request. `promptTokens` means uncached input
 * tokens; cache read/write tokens are priced separately. When a model has no
 * cache rate, cache tokens are billed at the normal input rate.
 * Returns nulls when pricing is unknown.
 */
export function calculateCost(
  modelName: string,
  promptTokens: number,
  generatedTokens: number,
  customPricing?: Record<string, ModelPricing>,
  cache?: CacheTokenUsage,
): CostResult {
  const pricing = getModelPricing(modelName, customPricing);
  if (!pricing) {
    return {
      promptCost: null,
      completionCost: null,
      totalCost: null,
      pricingKnown: false,
    };
  }

  const cacheRead = cache?.cacheReadTokens ?? 0;
  const cacheWrite = cache?.cacheWriteTokens ?? 0;
  const promptCost =
    (promptTokens / 1000) * pricing.promptPer1k +
    (cacheRead / 1000) * (pricing.cacheReadPer1k ?? pricing.promptPer1k) +
    (cacheWrite / 1000) * (pricing.cacheWritePer1k ?? pricing.promptPer1k);
  const completionCost = (generatedTokens / 1000) * pricing.completionPer1k;

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    pricingKnown: true,
  };
}

/** Human-readable cost: "unknown" when pricing is missing. */
export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined || !Number.isFinite(cost)) {
    return "unknown";
  }
  if (cost === 0) {
    return "$0.00";
  }
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/**
 * Enrich per-model token data with cost estimates.
 */
export function enrichWithCost(
  tokensPerModel: Array<{ model: string; promptTokens: number; generatedTokens: number }>,
  customPricing?: Record<string, ModelPricing>,
): TokenUsageWithCost[] {
  return tokensPerModel.map((row) => {
    const cost = calculateCost(row.model, row.promptTokens, row.generatedTokens, customPricing);
    return {
      ...row,
      ...cost,
    };
  });
}

/**
 * Get the bundled fallback pricing table (live API pricing is not included).
 */
export function getAvailableModelPricing(): Record<string, ModelPricing> {
  return { ...DEFAULT_MODEL_PRICING };
}
