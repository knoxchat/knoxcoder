/**
 * Token tracking and cost estimation utilities.
 *
 * Provides per-model pricing and cost calculation on top of the
 * existing DevDataSqliteDb token tracking.
 */

import { getKnoxChatModelPricingSync } from "./knoxChatModels.js";

// ── Model Pricing (per 1K tokens, USD) ──────────────────────────────

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
  image?: number;
  cacheReadPer1k?: number;
  cacheWritePer1k?: number;
  webSearch?: number;
}

/**
 * Default pricing for common models. Users can override via config.
 * Prices as of early 2025. Updated periodically.
 */
const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { promptPer1k: 0.0025, completionPer1k: 0.01 },
  "gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  "gpt-4-turbo": { promptPer1k: 0.01, completionPer1k: 0.03 },
  "gpt-4": { promptPer1k: 0.03, completionPer1k: 0.06 },
  "gpt-3.5-turbo": { promptPer1k: 0.0005, completionPer1k: 0.0015 },
  "o1": { promptPer1k: 0.015, completionPer1k: 0.06 },
  "o1-mini": { promptPer1k: 0.003, completionPer1k: 0.012 },
  "o3-mini": { promptPer1k: 0.0011, completionPer1k: 0.0044 },

  // Anthropic
  "claude-3-5-sonnet-20241022": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "claude-3-5-sonnet": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "claude-3-5-haiku": { promptPer1k: 0.0008, completionPer1k: 0.004 },
  "claude-3-opus": { promptPer1k: 0.015, completionPer1k: 0.075 },
  "claude-sonnet-4-20250514": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "claude-opus-4-20250514": { promptPer1k: 0.015, completionPer1k: 0.075 },

  // Google
  "gemini-1.5-pro": { promptPer1k: 0.00125, completionPer1k: 0.005 },
  "gemini-1.5-flash": { promptPer1k: 0.000075, completionPer1k: 0.0003 },
  "gemini-2.0-flash": { promptPer1k: 0.0001, completionPer1k: 0.0004 },

  // DeepSeek
  "deepseek-chat": { promptPer1k: 0.00014, completionPer1k: 0.00028 },
  "deepseek-coder": { promptPer1k: 0.00014, completionPer1k: 0.00028 },
};

// ── Cost Calculation ─────────────────────────────────────────────────

export interface TokenUsageWithCost {
  model: string;
  promptTokens: number;
  generatedTokens: number;
  promptCost: number;
  completionCost: number;
  totalCost: number;
}

export interface DailyUsageWithCost {
  day: string;
  promptTokens: number;
  generatedTokens: number;
  estimatedCost: number;
}

/**
 * Look up pricing for a model name. Tries exact match, then prefix match.
 */
export function getModelPricing(
  modelName: string,
  customPricing?: Record<string, ModelPricing>,
): ModelPricing | null {
  // Check custom pricing first
  if (customPricing?.[modelName]) {
    return customPricing[modelName];
  }

  // Prefer live KnoxChat /v1/models pricing when available
  const apiPricing = getKnoxChatModelPricingSync(modelName);
  if (apiPricing) {
    return apiPricing;
  }

  // Exact match
  if (DEFAULT_MODEL_PRICING[modelName]) {
    return DEFAULT_MODEL_PRICING[modelName];
  }

  // Prefix match (e.g., "gpt-4o-2024-08-06" matches "gpt-4o")
  const lower = modelName.toLowerCase();
  for (const [key, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
    if (lower.startsWith(key.toLowerCase())) {
      return pricing;
    }
  }

  return null;
}

/**
 * Calculate cost for a single request.
 */
export function calculateCost(
  modelName: string,
  promptTokens: number,
  generatedTokens: number,
  customPricing?: Record<string, ModelPricing>,
): { promptCost: number; completionCost: number; totalCost: number } {
  const pricing = getModelPricing(modelName, customPricing);
  if (!pricing) {
    return { promptCost: 0, completionCost: 0, totalCost: 0 };
  }

  const promptCost = (promptTokens / 1000) * pricing.promptPer1k;
  const completionCost = (generatedTokens / 1000) * pricing.completionPer1k;

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
  };
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
 * Get available model names that have pricing defined.
 */
export function getAvailableModelPricing(): Record<string, ModelPricing> {
  return { ...DEFAULT_MODEL_PRICING };
}
