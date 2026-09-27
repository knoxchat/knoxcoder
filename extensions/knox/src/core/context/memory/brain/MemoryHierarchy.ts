/**
 * MemoryHierarchy — Knox-MS Part II: 5-level memory model (M₁–M₅).
 *
 * | Level | Name           | Retention | Capacity   | rᵢ   |
 * | M₁    | Sensory Buffer | ~250ms    | streaming  | 1.0  |
 * | M₂    | Working Memory | ~30s      | 30K tokens | 0.5  |
 * | M₃    | Short-Term     | ~1hr      | 50K tokens | 0.2  |
 * | M₄    | Long-Term      | ∞         | ∞          | 0.1  |
 * | M₅    | Procedural     | ∞         | ∞          | 0.05 |
 *
 * C_effective = Σ |Mᵢ| / rᵢ  (IMP-04)
 */

import { BrainStore } from "./BrainStore.js";
import { getCompressionRatios, normalizeCompressionRatio } from "./memoryConfigAccess.js";
import { SensoryBuffer } from "./SensoryBuffer.js";
import type { CompressionRatios } from "./memoryConfigAccess.js";

export type MemoryLevelId = "M1" | "M2" | "M3" | "M4" | "M5";

export interface MemoryLevelSpec {
  id: MemoryLevelId;
  name: string;
  knox_label: string;
  ratio: number;
  retention: string;
  capacity: string;
}

export interface MemoryLevelMetrics {
  id: MemoryLevelId;
  name: string;
  tokens: number;
  ratio: number;
  effective_tokens: number;
}

export interface HierarchyEffectiveResult {
  levels: MemoryLevelMetrics[];
  /** Sum of level effective tokens (M₁–M₅). */
  hierarchy_effective_tokens: number;
  /** SQLite tier token counts (active/hot/warm/cold/frozen). */
  tier_tokens: Record<string, number>;
  compression_ratios: CompressionRatios;
}

/** Knox-MS Part II level definitions (rᵢ from theorem). */
export function getMemoryLevelSpecs(ratios?: CompressionRatios): MemoryLevelSpec[] {
  const r = ratios ?? getCompressionRatios();
  return [
    {
      id: "M1",
      name: "sensory",
      knox_label: "Sensory Buffer",
      ratio: 1.0,
      retention: "~250ms",
      capacity: "streaming",
    },
    {
      id: "M2",
      name: "working",
      knox_label: "Working Memory",
      ratio: 0.5,
      retention: "~30s",
      capacity: "30K tokens",
    },
    {
      id: "M3",
      name: "short_term",
      knox_label: "Short-Term",
      ratio: normalizeCompressionRatio(r.warm),
      retention: "~1hr",
      capacity: "50K tokens",
    },
    {
      id: "M4",
      name: "long_term",
      knox_label: "Long-Term",
      ratio: normalizeCompressionRatio(r.cold),
      retention: "∞",
      capacity: "∞",
    },
    {
      id: "M5",
      name: "procedural",
      knox_label: "Procedural",
      ratio: normalizeCompressionRatio(r.frozen),
      retention: "∞",
      capacity: "∞",
    },
  ];
}

export function levelEffective(tokens: number, ratio: number): number {
  if (tokens <= 0 || ratio <= 0) return 0;
  return tokens / ratio;
}

async function getProcedureTokenEstimate(): Promise<number> {
  const db = await BrainStore.get();
  const row = await db.get(`
    SELECT SUM(
      CAST((LENGTH(name) + LENGTH(description) + LENGTH(steps) + LENGTH(trigger_pattern)) / 4 AS INTEGER)
    ) AS tokens
    FROM brain_procedures
  `);
  return (row as any)?.tokens ?? 0;
}

/**
 * Full Part II C_effective: M₁ (sensory) + M₂ (WM) + M₃–M₅ (SQLite tiers + procedures).
 */
export async function calculateHierarchyEffective(options?: {
  activeSessionId?: string | null;
  workingMemoryTokens?: number;
}): Promise<HierarchyEffectiveResult> {
  const ratios = getCompressionRatios();
  const tierTokens = await BrainStore.getTierTokenCounts();

  const m1Tokens = SensoryBuffer.estimateBufferedTokens(options?.activeSessionId ?? undefined);
  const m2Tokens = options?.workingMemoryTokens ?? 0;

  // M₃ short-term ≈ active + hot (~1hr retention in FiveTierHierarchy)
  const m3Tokens = (tierTokens.active ?? 0) + (tierTokens.hot ?? 0);
  // M₄ long-term ≈ warm + cold
  const m4Tokens = (tierTokens.warm ?? 0) + (tierTokens.cold ?? 0);
  // M₅ procedural ≈ frozen tier + procedure store
  const m5Tokens = (tierTokens.frozen ?? 0) + (await getProcedureTokenEstimate());

  const specs = getMemoryLevelSpecs(ratios);
  const tokenByLevel: Record<MemoryLevelId, number> = {
    M1: m1Tokens,
    M2: m2Tokens,
    M3: m3Tokens,
    M4: m4Tokens,
    M5: m5Tokens,
  };

  const levels: MemoryLevelMetrics[] = specs.map((spec) => {
    const tokens = tokenByLevel[spec.id];
    const ratio = spec.ratio;
    return {
      id: spec.id,
      name: spec.knox_label,
      tokens,
      ratio,
      effective_tokens: levelEffective(tokens, ratio),
    };
  });

  const hierarchy_effective_tokens = levels.reduce((sum, l) => sum + l.effective_tokens, 0);

  return {
    levels,
    hierarchy_effective_tokens,
    tier_tokens: tierTokens,
    compression_ratios: ratios,
  };
}
