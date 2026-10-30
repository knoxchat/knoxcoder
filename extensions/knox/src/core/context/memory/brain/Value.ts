/**
 * Bounded utility U and Value = R·U (revised Knox-MS Part IV, MEM-13).
 *
 *   U(m) = (h + κ I₀) / (h + u + κ) ∈ [0, 1],  κ = 5
 *   Value(m, t) = R(t, S_m) · U(m) ∈ [0, 1]
 *
 * I₀ is the prior. h / u increment on cited+helpful / correction (MEM-17) and
 * recipe replay ok/revert (MEM-18).
 * Default retrieve skips Value < θ_arch (archive, not DELETE). Value is derived —
 * never a sqlite column.
 */

import {
  type ForgettingParams,
  type StabilitySource,
  daysSince,
  defaultForgettingParams,
  resolveStability,
  retrievability,
} from "./Forgetting.js";
import { getTheoremParams } from "./memoryConfigAccess.js";

export const UTILITY_KAPPA_DEFAULT = 5;
export const ARCHIVE_VALUE_THRESHOLD = 0.05;
export const KAPPA_EPSILON = 1e-9;
export const DEFAULT_INITIAL_IMPORTANCE = 0.5;

export interface ValueParams {
  kappa: number;
  archiveThreshold: number;
  forgetting?: Partial<ForgettingParams>;
}

export interface UtilitySource {
  helpful_count?: number | null;
  unhelpful_count?: number | null;
  i0?: number | null;
  importance_score?: number | null;
}

export interface ValueSource extends UtilitySource, StabilitySource {
  last_accessed_at?: string | null;
  created_at?: string | null;
}

export interface DefaultRetrieveOptions {
  /** User pin overrides archive-by-Value (still respects frozen / tombstone). */
  pinned?: boolean;
}

/** Pure defaults. Live κ / θ_arch come from getValueParams(). */
export function defaultValueParams(): ValueParams {
  return {
    kappa: UTILITY_KAPPA_DEFAULT,
    archiveThreshold: ARCHIVE_VALUE_THRESHOLD,
    forgetting: defaultForgettingParams(),
  };
}

export function getValueParams(): ValueParams {
  try {
    const theorem = getTheoremParams();
    return {
      kappa: theorem.utilityKappa,
      archiveThreshold: theorem.archiveValueThreshold,
      forgetting: {
        ...defaultForgettingParams(),
        F: theorem.forgettingF,
        c: theorem.forgettingC,
      },
    };
  } catch {
    return defaultValueParams();
  }
}

function resolveParams(params?: Partial<ValueParams>): ValueParams {
  const fallback = getValueParams();
  return {
    kappa: params?.kappa ?? fallback.kappa,
    archiveThreshold: params?.archiveThreshold ?? fallback.archiveThreshold,
    forgetting: params?.forgetting ?? fallback.forgetting,
  };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function resolveKappa(kappa: number | null | undefined): number {
  const n = Number(kappa);
  if (!Number.isFinite(n)) return UTILITY_KAPPA_DEFAULT;
  return Math.max(KAPPA_EPSILON, n);
}

export function resolveCount(count: number | null | undefined): number {
  const n = Number(count);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/** I₀ from the stored prior, then leftover importance, then the schema default. */
export function resolveInitialImportance(source?: UtilitySource | null): number {
  if (source?.i0 != null && Number.isFinite(Number(source.i0))) {
    return clamp01(Number(source.i0));
  }
  if (source?.importance_score != null && Number.isFinite(Number(source.importance_score))) {
    return clamp01(Number(source.importance_score));
  }
  return DEFAULT_INITIAL_IMPORTANCE;
}

/**
 * U(m) = (h + κ I₀) / (h + u + κ), clamped to [0, 1].
 * With h = u = 0 this is the I₀ prior.
 */
export function utility(
  helpful: number,
  unhelpful: number,
  initialImportance: number,
  kappa: number = UTILITY_KAPPA_DEFAULT,
): number {
  const h = resolveCount(helpful);
  const u = resolveCount(unhelpful);
  const i0 = clamp01(initialImportance);
  const k = resolveKappa(kappa);
  const denom = h + u + k;
  if (!(denom > 0)) return 0;
  return clamp01((h + k * i0) / denom);
}

export function utilityFromSource(source?: UtilitySource | null, params?: Partial<ValueParams>): number {
  const p = resolveParams(params);
  return utility(
    source?.helpful_count ?? 0,
    source?.unhelpful_count ?? 0,
    resolveInitialImportance(source),
    p.kappa,
  );
}

export function lastAccessAt(source?: ValueSource | null): string | null {
  const last = source?.last_accessed_at;
  if (last != null && String(last).length > 0) return String(last);
  const created = source?.created_at;
  if (created != null && String(created).length > 0) return String(created);
  return null;
}

/** Value(m, t) = R(t, S) · U(m). Missing access time is treated as t = 0 (R = 1). */
export function memoryValue(
  tDays: number,
  stability: number,
  u: number,
  params?: Partial<ValueParams>,
): number {
  const p = resolveParams(params);
  const r = retrievability(tDays, stability, p.forgetting);
  return clamp01(r * clamp01(u));
}

export function memoryValueFromSource(
  source?: ValueSource | null,
  params?: Partial<ValueParams>,
  nowMs: number = Date.now(),
): number {
  const p = resolveParams(params);
  const accessed = lastAccessAt(source);
  const tDays = accessed ? daysSince(accessed, nowMs) : 0;
  const r = retrievability(tDays, resolveStability(source?.stability, source?.category), p.forgetting);
  return clamp01(r * utilityFromSource(source, p));
}

/** Archive (drop from default retrieve) when Value < θ_arch. Never DELETE. */
export function shouldArchiveByValue(
  source?: ValueSource | null,
  params?: Partial<ValueParams>,
  nowMs: number = Date.now(),
): boolean {
  const p = resolveParams(params);
  const threshold = Number.isFinite(Number(p.archiveThreshold))
    ? Number(p.archiveThreshold)
    : ARCHIVE_VALUE_THRESHOLD;
  return memoryValueFromSource(source, p, nowMs) < threshold;
}

export function isDefaultRetrieveValue(
  source?: ValueSource | null,
  options?: DefaultRetrieveOptions,
  params?: Partial<ValueParams>,
  nowMs: number = Date.now(),
): boolean {
  if (options?.pinned) return true;
  return !shouldArchiveByValue(source, params, nowMs);
}

export const Value = {
  UTILITY_KAPPA_DEFAULT,
  ARCHIVE_VALUE_THRESHOLD,
  defaultValueParams,
  getValueParams,
  clamp01,
  resolveKappa,
  resolveCount,
  resolveInitialImportance,
  utility,
  utilityFromSource,
  lastAccessAt,
  memoryValue,
  memoryValueFromSource,
  shouldArchiveByValue,
  isDefaultRetrieveValue,
};
