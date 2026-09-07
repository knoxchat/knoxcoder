/**
 * Ebbinghaus — Unified forgetting-curve math (Knox-MS Part IV).
 *
 * Forgetting curve:
 *   R(t) = R₀ · e^(-λ · t / S(m))     where R₀ = 1.0
 *
 * Memory strength (grows with spaced repetition):
 *   S(m) = S₀ + β · access_count + modifiers(salience, importance)
 *   S_new(m) = S_old(m) + β · 1[accessed(m, t)]
 *
 * Importance evolution:
 *   I(m, t) = I₀(m) · R(t) · (1 + α · access_count(m))
 *
 * Prune when R(t) < θ_prune.
 */

import { getMemoryConfig } from "./memoryConfigAccess.js";

export interface EbbinghausParams {
  /** R₀ — initial retention (always 1.0 in Knox-MS theorem). */
  initialRetention: number;
  /** S₀ — base memory strength. */
  baseStrength: number;
  /** λ — decay rate (~0.03/day ≈ 3% daily decay). */
  lambda: number;
  /** θ_prune — prune threshold. */
  pruneThreshold: number;
  /** Review threshold for spaced repetition surfacing. */
  reviewThreshold: number;
  /** α — strengthening factor per access in I(m,t). */
  strengtheningAlpha: number;
  /** β — additive strength gain per access in S_new(m). */
  repetitionBeta: number;
  salienceWeight: number;
  importanceWeight: number;
}

export function getEbbinghausParams(): EbbinghausParams {
  const cfg = getMemoryConfig();
  return {
    initialRetention: 1.0,
    baseStrength: cfg.ebbinghaus_base_strength,
    lambda: cfg.ebbinghaus_lambda,
    pruneThreshold: cfg.ebbinghaus_prune_threshold,
    reviewThreshold: cfg.ebbinghaus_review_threshold,
    strengtheningAlpha: cfg.ebbinghaus_strengthening_alpha,
    repetitionBeta: cfg.ebbinghaus_repetition_beta,
    salienceWeight: cfg.ebbinghaus_salience_weight,
    importanceWeight: cfg.ebbinghaus_importance_weight,
  };
}

/**
 * Memory strength S(m) — denominator of R(t).
 * Theorem: S_new = S_old + β on each access; salience/importance add modifiers.
 */
export function memoryStrength(
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
): number {
  const p = params ?? getEbbinghausParams();
  const n = Math.max(0, retrievalCount);
  const accessStrength = p.baseStrength + p.repetitionBeta * n;
  const salienceFactor = 1 + p.salienceWeight * Math.max(0, Math.min(1, salience));
  const importanceFactor = 1 + p.importanceWeight * Math.max(0, Math.min(1, importance));
  return Math.max(0.01, accessStrength * salienceFactor * importanceFactor);
}

/** Retention R(t) = R₀ · e^(-λ · t / S) ∈ [0, 1]. */
export function retention(
  lastAccessedAt: string,
  strength: number,
  params?: EbbinghausParams,
): number {
  const p = params ?? getEbbinghausParams();
  const elapsedMs = Date.now() - new Date(lastAccessedAt).getTime();
  const elapsedDays = Math.max(0, elapsedMs / 86400000);
  const s = Math.max(0.01, strength);
  const r = p.initialRetention * Math.exp(-p.lambda * elapsedDays / s);
  return Math.max(0, Math.min(1, r));
}

/** Convenience: R(t) from retrieval metadata. */
export function retentionFromMemory(
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
): number {
  const s = memoryStrength(retrievalCount, salience, importance, params);
  return retention(lastAccessedAt, s, params);
}

/** Whether a memory should be pruned (R < θ_prune). */
export function shouldPrune(
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
): boolean {
  const p = params ?? getEbbinghausParams();
  return retentionFromMemory(lastAccessedAt, retrievalCount, salience, importance, p) < p.pruneThreshold;
}

/**
 * Importance evolution: I(m,t) = I₀ · R(t) · (1 + α · access_count).
 * Used during sleep consolidation decay (NREM-2).
 */
export function importanceEvolution(
  initialImportance: number,
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
): number {
  const p = params ?? getEbbinghausParams();
  const r = retentionFromMemory(lastAccessedAt, retrievalCount, salience, importance, p);
  const accessBoost = 1 + p.strengtheningAlpha * Math.max(0, retrievalCount);
  return Math.max(0.05, initialImportance * r * accessBoost);
}

/** Map retention + access history to decayed importance (delegates to importanceEvolution). */
export function importanceFromRetention(
  currentImportance: number,
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  params?: EbbinghausParams,
): number {
  return importanceEvolution(
    currentImportance,
    lastAccessedAt,
    retrievalCount,
    salience,
    currentImportance,
    params,
  );
}

/**
 * Spaced repetition boost after access: I₀ · (1 + α · n) with R(0) ≈ 1.
 * Returns capped importance score ∈ [0, 1].
 */
export function boostImportanceOnAccess(
  currentImportance: number,
  retrievalCount: number,
  params?: EbbinghausParams,
): number {
  const p = params ?? getEbbinghausParams();
  const n = Math.max(0, retrievalCount);
  const boosted = currentImportance * (1 + p.strengtheningAlpha * n);
  return Math.min(1.0, boosted);
}

/** Strength gain from a single access: ΔS = β. */
export function strengthGainOnAccess(params?: EbbinghausParams): number {
  return (params ?? getEbbinghausParams()).repetitionBeta;
}

export const Ebbinghaus = {
  getEbbinghausParams,
  memoryStrength,
  retention,
  retentionFromMemory,
  shouldPrune,
  importanceEvolution,
  importanceFromRetention,
  boostImportanceOnAccess,
  strengthGainOnAccess,
};
