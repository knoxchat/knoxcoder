/**
 * Power-law forgetting (revised Knox-MS Part IV, MEM-12).
 *
 *   R(t, S) = (1 + F · t / S)^(-c)
 *   F = 19/81, c = 0.5
 *   S = max(ε, stability)
 *
 * Category S₀ (days):
 *   episodic: 1
 *   fact / error_fix / code_pattern: 14
 *   preference / workflow: 30
 *   decision / project_context: 60
 *   summary / insight: 14, or inherit when linked as a tree node
 *
 * FSRS strengthen-on-use lives in Fsrs.ts (MEM-14). `outcomeFactor` stays on
 * Ebbinghaus until MEM-18 and is not R.
 */

export const FORGETTING_F_DEFAULT = 19 / 81;
export const FORGETTING_C_DEFAULT = 0.5;
export const STABILITY_EPSILON = 1e-6;
export const DEFAULT_DIFFICULTY = 5;

export type StabilityCategory =
  | "episodic"
  | "fact"
  | "error_fix"
  | "code_pattern"
  | "preference"
  | "workflow"
  | "decision"
  | "project_context"
  | "summary"
  | "insight";

/** Theorem S₀ table (days). Unknown semantic categories use the fact bucket. */
export const INITIAL_STABILITY: Record<StabilityCategory, number> = {
  episodic: 1,
  fact: 14,
  error_fix: 14,
  code_pattern: 14,
  preference: 30,
  workflow: 30,
  decision: 60,
  project_context: 60,
  summary: 14,
  insight: 14,
};

export interface ForgettingParams {
  F: number;
  c: number;
  pruneThreshold: number;
  reviewThreshold: number;
}

export interface StabilitySource {
  stability?: number | null;
  category?: string | null;
}

export interface InitialStabilityOptions {
  inheritStability?: number | null;
  linkedAsTreeNode?: boolean;
}

/** Pure defaults. Live config is applied by Ebbinghaus.getEbbinghausParams. */
export function defaultForgettingParams(): ForgettingParams {
  return {
    F: FORGETTING_F_DEFAULT,
    c: FORGETTING_C_DEFAULT,
    pruneThreshold: 0.1,
    reviewThreshold: 0.5,
  };
}

function resolveParams(params?: Partial<ForgettingParams>): ForgettingParams {
  const fallback = defaultForgettingParams();
  return {
    F: params?.F ?? fallback.F,
    c: params?.c ?? fallback.c,
    pruneThreshold: params?.pruneThreshold ?? fallback.pruneThreshold,
    reviewThreshold: params?.reviewThreshold ?? fallback.reviewThreshold,
  };
}

export function clampStability(stability: number | null | undefined): number {
  const n = Number(stability);
  if (!Number.isFinite(n)) return STABILITY_EPSILON;
  return Math.max(STABILITY_EPSILON, n);
}

export function initialStability(
  category: string | null | undefined,
  options?: InitialStabilityOptions,
): number {
  const cat = String(category ?? "episodic").toLowerCase();
  if ((cat === "summary" || cat === "insight") && options?.linkedAsTreeNode) {
    const inherited = options.inheritStability;
    if (inherited != null && Number.isFinite(Number(inherited)) && Number(inherited) > 0) {
      return clampStability(inherited);
    }
  }
  if (cat === "episodic" || cat === "") return INITIAL_STABILITY.episodic;
  if (Object.prototype.hasOwnProperty.call(INITIAL_STABILITY, cat)) {
    return INITIAL_STABILITY[cat as StabilityCategory];
  }
  return INITIAL_STABILITY.fact;
}

/** Stored S, or category S₀ when the row predates MEM-12. */
export function resolveStability(
  stability: number | null | undefined,
  category?: string | null,
): number {
  if (stability != null && Number.isFinite(Number(stability)) && Number(stability) > 0) {
    return clampStability(stability);
  }
  return initialStability(category);
}

export function insertForgettingFields(
  category: string | null | undefined,
  importance: number,
  options?: InitialStabilityOptions,
): { stability: number; difficulty: number; i0: number } {
  return {
    stability: initialStability(category, options),
    difficulty: DEFAULT_DIFFICULTY,
    i0: importance,
  };
}

export function daysSince(lastAccessedAt: string, nowMs: number = Date.now()): number {
  const t = new Date(lastAccessedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (nowMs - t) / 86_400_000);
}

/**
 * Retrievability R(t, S) = (1 + F · t / S)^(-c) ∈ (0, 1].
 * S is clamped so a missing/zero stability never divides by zero.
 */
export function retrievability(
  tDays: number,
  stability: number,
  params?: Partial<ForgettingParams>,
): number {
  const p = resolveParams(params);
  const t = Math.max(0, tDays);
  const s = clampStability(stability);
  const F = Number.isFinite(p.F) ? Math.max(0, p.F) : FORGETTING_F_DEFAULT;
  const c = Number.isFinite(p.c) ? Math.max(0, p.c) : FORGETTING_C_DEFAULT;
  const r = (1 + (F * t) / s) ** -c;
  if (!Number.isFinite(r)) return 0;
  return Math.max(0, Math.min(1, r));
}

export function retention(
  lastAccessedAt: string,
  stability: number,
  params?: Partial<ForgettingParams>,
): number {
  return retrievability(daysSince(lastAccessedAt), stability, params);
}

export function retentionFromSource(
  lastAccessedAt: string,
  source?: StabilitySource,
  params?: Partial<ForgettingParams>,
): number {
  return retention(lastAccessedAt, resolveStability(source?.stability, source?.category), params);
}

export function shouldPruneFromSource(
  lastAccessedAt: string,
  source?: StabilitySource,
  params?: Partial<ForgettingParams>,
): boolean {
  const p = resolveParams(params);
  return retentionFromSource(lastAccessedAt, source, p) < p.pruneThreshold;
}

export const Forgetting = {
  FORGETTING_F_DEFAULT,
  FORGETTING_C_DEFAULT,
  STABILITY_EPSILON,
  DEFAULT_DIFFICULTY,
  INITIAL_STABILITY,
  defaultForgettingParams,
  clampStability,
  initialStability,
  resolveStability,
  insertForgettingFields,
  daysSince,
  retrievability,
  retention,
  retentionFromSource,
  shouldPruneFromSource,
};
