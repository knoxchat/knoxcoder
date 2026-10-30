/**
 * Ebbinghaus — compatibility facade over power-law forgetting (MEM-12).
 *
 * Live retrievability is the revised Knox-MS curve in Forgetting.ts:
 *   R(t, S) = (1 + F · t / S)^(-c)
 *   F = forgetting_F (default 19/81), c = forgetting_c (default 0.5)
 *   S = max(ε, stability)  — never access-count
 *
 * Leftover until later MEM items (do not use as R or live S):
 *   S(m) = S₀ + β · access_count          (leftover; live S is FSRS in Fsrs.ts)
 *   I(m, t) = I₀ · R(t) · (1 + α · n)     (leftover; live Value is Value.ts)
 *   outcomeFactor                         (leftover fusion modulation; Value is R·U)
 *
 * KN-312: ebbinghaus_lambda remains as a leftover config key.
 */

import {
  type ForgettingParams,
  type StabilitySource,
  defaultForgettingParams,
  initialStability,
  resolveStability,
  retention as powerLawRetention,
  retrievability,
  shouldPruneFromSource,
} from "./Forgetting.js";
import {
  applyFsrs,
  applyFsrsFromSource,
  nextStability,
} from "./Fsrs.js";
import { getEbbinghausConfig, getMemoryConfig, getTheoremParams } from "./memoryConfigAccess.js";

export interface EbbinghausParams {
  /** R₀ — unused by the power-law (R(0)=1). Kept for leftover I(m,t). */
  initialRetention: number;
  /** Leftover S₀ for memoryStrength. Live S is stored stability / FSRS. */
  baseStrength: number;
  /** Leftover exponential λ. Live R uses forgetting_F / forgetting_c. */
  lambda: number;
  /** θ_prune — archive + tombstone when R < θ (age never DELETEs). */
  pruneThreshold: number;
  /** Review threshold for spaced repetition surfacing. */
  reviewThreshold: number;
  /** α — leftover strengthening in I(m,t). Live S uses FSRS on use. */
  strengtheningAlpha: number;
  /** β — leftover strength gain per access. Live S uses FSRS on use. */
  repetitionBeta: number;
  salienceWeight: number;
  importanceWeight: number;
  forgettingF: number;
  forgettingC: number;
}

export function getForgettingParams(): ForgettingParams {
  try {
    const theorem = getTheoremParams();
    const ebbinghaus = getEbbinghausConfig();
    return {
      F: theorem.forgettingF,
      c: theorem.forgettingC,
      pruneThreshold: ebbinghaus.pruneThreshold,
      reviewThreshold: ebbinghaus.reviewThreshold,
    };
  } catch {
    return defaultForgettingParams();
  }
}

export function getEbbinghausParams(): EbbinghausParams {
  const cfg = getMemoryConfig();
  const forget = getForgettingParams();
  return {
    initialRetention: 1.0,
    baseStrength: cfg.ebbinghaus_base_strength,
    lambda: cfg.ebbinghaus_lambda,
    pruneThreshold: forget.pruneThreshold,
    reviewThreshold: forget.reviewThreshold,
    strengtheningAlpha: cfg.ebbinghaus_strengthening_alpha,
    repetitionBeta: cfg.ebbinghaus_repetition_beta,
    salienceWeight: cfg.ebbinghaus_salience_weight,
    importanceWeight: cfg.ebbinghaus_importance_weight,
    forgettingF: forget.F,
    forgettingC: forget.c,
  };
}

function toForgettingParams(params?: EbbinghausParams): ForgettingParams {
  if (!params) return getForgettingParams();
  return {
    F: params.forgettingF,
    c: params.forgettingC,
    pruneThreshold: params.pruneThreshold,
    reviewThreshold: params.reviewThreshold,
  };
}

/**
 * Leftover access-count strength. Live R / S use stored stability and FSRS on use.
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

/**
 * MC-51: outcome-aware strength. Memories recalled before a verified turn gain strength, ones
 * recalled before a revert lose more (wrong memory costs more than a right one earns).
 * Not retrievability R. Recipe Value is R·U from attribution h/u (MEM-18).
 */
export const OUTCOME_VERIFIED_GAIN = 0.05;
export const OUTCOME_REVERT_LOSS = 0.15;
export const OUTCOME_FACTOR_MIN = 0.4;
export const OUTCOME_FACTOR_MAX = 1.3;

export function outcomeFactor(verified: number, reverted: number): number {
  const f = 1 + OUTCOME_VERIFIED_GAIN * Math.max(0, verified) - OUTCOME_REVERT_LOSS * Math.max(0, reverted);
  return Math.max(OUTCOME_FACTOR_MIN, Math.min(OUTCOME_FACTOR_MAX, f));
}

export function outcomeAdjustedStrength(strength: number, verified: number, reverted: number): number {
  return Math.max(0.01, strength * outcomeFactor(verified, reverted));
}

/** Retention R(t, S) = (1 + F · t / S)^(-c) ∈ (0, 1]. `stability` is S. */
export function retention(
  lastAccessedAt: string,
  stability: number,
  params?: EbbinghausParams,
): number {
  return powerLawRetention(lastAccessedAt, stability, toForgettingParams(params));
}

/** Convenience: R(t) from stored stability (or category S₀). Access count is not S. */
export function retentionFromMemory(
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
  source?: StabilitySource,
): number {
  void retrievalCount;
  void salience;
  void importance;
  return powerLawRetention(
    lastAccessedAt,
    resolveStability(source?.stability, source?.category),
    toForgettingParams(params),
  );
}

/** Whether a memory should be archived + tombstoned (R < θ_prune). Age never DELETEs. */
export function shouldPrune(
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
  source?: StabilitySource,
): boolean {
  void retrievalCount;
  void salience;
  void importance;
  return shouldPruneFromSource(lastAccessedAt, source, toForgettingParams(params));
}

/**
 * Leftover importance evolution: I(m,t) = I₀ · R(t) · (1 + α · access_count).
 * Live retrieve uses Value = R·U in Value.ts.
 */
export function importanceEvolution(
  initialImportance: number,
  lastAccessedAt: string,
  retrievalCount: number,
  salience: number = 0.5,
  importance: number = 0.5,
  params?: EbbinghausParams,
  source?: StabilitySource,
): number {
  const p = params ?? getEbbinghausParams();
  const r = retentionFromMemory(lastAccessedAt, retrievalCount, salience, importance, p, source);
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
  source?: StabilitySource,
): number {
  return importanceEvolution(
    currentImportance,
    lastAccessedAt,
    retrievalCount,
    salience,
    currentImportance,
    params,
    source,
  );
}

/**
 * Leftover I(m,t) access boost. Not a retrieve-time update — live S uses FSRS on use.
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

/** Leftover ΔS = β. Live strengthening is FSRS (Fsrs.ts). */
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
  outcomeFactor,
  outcomeAdjustedStrength,
  retrievability,
  initialStability,
  resolveStability,
  nextStability,
  applyFsrs,
  applyFsrsFromSource,
};
