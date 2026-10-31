/**
 * Memory tiers from R and Value only (revised Knox-MS Part IV, MEM-15).
 *
 *   Active  = in current session working memory
 *   Hot     = R ≥ 0.9
 *   Warm    = 0.7 ≤ R < 0.9
 *   Cold    = 0.3 ≤ R < 0.7
 *   Frozen  = R < 0.3 or Value < θ_arch
 *   Deleted = tombstone (MEM-06) — not a stored tier
 *
 * Clock knobs (`hot_to_warm_hours`, `warm_to_cold_days`, `cold_prune_days`)
 * are unused leftovers. Recompute on sleep and on attribution, not on a clock.
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
import type { MemoryTier } from "./types.js";
import {
  type ValueParams,
  type ValueSource,
  ARCHIVE_VALUE_THRESHOLD,
  lastAccessAt,
  memoryValueFromSource,
} from "./Value.js";

export const TIER_R_HOT = 0.9;
export const TIER_R_WARM = 0.7;
export const TIER_R_COLD = 0.3;

export const MEMORY_TIERS: readonly MemoryTier[] = ["active", "hot", "warm", "cold", "frozen"];

export const TIER_RANK: Record<MemoryTier, number> = {
  frozen: 0,
  cold: 1,
  warm: 2,
  hot: 3,
  active: 4,
};

export type StoredMemoryTier = MemoryTier;
export type RankedMemoryTier = Exclude<MemoryTier, "active">;

export interface TierParams {
  archiveThreshold: number;
  forgetting?: Partial<ForgettingParams>;
  value?: Partial<ValueParams>;
}

export interface ClassifyTierOptions {
  /** Current-session WM holds this leaf → Active. */
  inWorkingMemory?: boolean;
  /** Pin overrides archive-by-Value; never store Frozen. */
  pinned?: boolean;
}

export interface WorkingMemoryLeafRef {
  kind: "semantic" | "episodic";
  id: number;
}

export interface WorkingMemoryTierItem {
  id?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Pure defaults. Live θ_arch / F / c come from getTierParams(). */
export function defaultTierParams(): TierParams {
  return {
    archiveThreshold: ARCHIVE_VALUE_THRESHOLD,
    forgetting: defaultForgettingParams(),
  };
}

export function getTierParams(): TierParams {
  try {
    const theorem = getTheoremParams();
    return {
      archiveThreshold: theorem.archiveValueThreshold,
      forgetting: {
        ...defaultForgettingParams(),
        F: theorem.forgettingF,
        c: theorem.forgettingC,
      },
    };
  } catch {
    return defaultTierParams();
  }
}

function resolveParams(params?: Partial<TierParams>): TierParams {
  const fallback = getTierParams();
  return {
    archiveThreshold: params?.archiveThreshold ?? fallback.archiveThreshold,
    forgetting: params?.forgetting ?? fallback.forgetting,
    value: params?.value,
  };
}

export function isMemoryTier(value: string | null | undefined): value is MemoryTier {
  return value === "active" || value === "hot" || value === "warm" || value === "cold" || value === "frozen";
}

export function parseMemoryTier(value: string | null | undefined): MemoryTier | null {
  return isMemoryTier(value) ? value : null;
}

export function archiveThresholdOf(params?: Partial<TierParams>): number {
  const n = Number(resolveParams(params).archiveThreshold);
  return Number.isFinite(n) ? n : ARCHIVE_VALUE_THRESHOLD;
}

/**
 * Ranked tier from R and Value. Active is not decided here.
 * Frozen wins when R < 0.3 or Value < θ_arch.
 */
export function classifyRankedTier(
  r: number,
  value: number,
  archiveThreshold: number = ARCHIVE_VALUE_THRESHOLD,
): RankedMemoryTier {
  const retr = Number.isFinite(r) ? r : 0;
  const val = Number.isFinite(value) ? value : 0;
  const theta = Number.isFinite(archiveThreshold) ? archiveThreshold : ARCHIVE_VALUE_THRESHOLD;
  if (retr < TIER_R_COLD || val < theta) return "frozen";
  if (retr >= TIER_R_HOT) return "hot";
  if (retr >= TIER_R_WARM) return "warm";
  return "cold";
}

/** Classify a just-written leaf (t≈0) so INSERT does not rely on DEFAULT 'hot'. */
export function classifyInsertTier(
  source: {
    importance_score?: number | null;
    i0?: number | null;
    stability?: number | null;
    category?: string | null;
  },
  nowMs: number = Date.now(),
): MemoryTier {
  return classifyMemoryTier(
    {
      importance_score: source.importance_score,
      i0: source.i0,
      stability: source.stability,
      category: source.category,
      helpful_count: 0,
      unhelpful_count: 0,
    },
    undefined,
    undefined,
    nowMs,
  );
}

export function classifyMemoryTier(
  source?: ValueSource | null,
  options?: ClassifyTierOptions,
  params?: Partial<TierParams>,
  nowMs: number = Date.now(),
): MemoryTier {
  if (options?.inWorkingMemory) return "active";
  const p = resolveParams(params);
  const r = retrievabilityFromSource(source, p.forgetting, nowMs);
  const value = memoryValueFromSource(source, {
    archiveThreshold: p.archiveThreshold,
    forgetting: p.forgetting,
    kappa: p.value?.kappa,
  }, nowMs);
  const ranked = classifyRankedTier(r, value, archiveThresholdOf(p));
  if (options?.pinned && ranked === "frozen") return "cold";
  return ranked;
}

export function retrievabilityFromSource(
  source?: StabilitySource & Pick<ValueSource, "last_accessed_at" | "created_at"> | null,
  params?: Partial<ForgettingParams>,
  nowMs: number = Date.now(),
): number {
  const accessed = lastAccessAt(source);
  const tDays = accessed ? daysSince(accessed, nowMs) : 0;
  return retrievability(tDays, resolveStability(source?.stability, source?.category), params);
}

export function memoryRefKey(kind: "semantic" | "episodic", id: number): string {
  return `${kind}:${id}`;
}

function positiveInt(value: unknown): number | null {
  const n = Math.trunc(Number(value));
  return n > 0 ? n : null;
}

function kindOf(value: unknown): "semantic" | "episodic" | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "semantic" || raw === "episodic") return raw;
  return null;
}

/** Parse a WM slot into a stored leaf when the slot points at one. */
export function workingMemoryLeafRef(item?: WorkingMemoryTierItem | null): WorkingMemoryLeafRef | null {
  if (!item) return null;
  const meta = item.metadata ?? {};
  const metaKind = kindOf(meta.memory_type ?? meta.kind ?? meta.mem_type);
  const metaId = positiveInt(meta.memory_id ?? meta.mem_id ?? meta.id);
  if (metaKind && metaId) return { kind: metaKind, id: metaId };

  const rawId = String(item.id ?? "").trim();
  const prefixed = /^(semantic|episodic):(\d+)$/i.exec(rawId);
  if (prefixed) {
    return { kind: prefixed[1].toLowerCase() as "semantic" | "episodic", id: Number(prefixed[2]) };
  }

  const sourceKind = kindOf(item.source);
  const bareId = positiveInt(rawId);
  if (sourceKind && bareId) return { kind: sourceKind, id: bareId };
  return null;
}

export function workingMemoryActiveKeys(items: Iterable<WorkingMemoryTierItem>): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    const ref = workingMemoryLeafRef(item);
    if (ref) keys.add(memoryRefKey(ref.kind, ref.id));
  }
  return keys;
}

export function isActiveMemory(
  kind: "semantic" | "episodic",
  id: number,
  active: ReadonlySet<string>,
): boolean {
  return active.has(memoryRefKey(kind, id));
}

export function tierChangedKind(from: MemoryTier, to: MemoryTier): "promoted" | "demoted" | "same" {
  const delta = TIER_RANK[to] - TIER_RANK[from];
  if (delta > 0) return "promoted";
  if (delta < 0) return "demoted";
  return "same";
}

export const Tiers = {
  TIER_R_HOT,
  TIER_R_WARM,
  TIER_R_COLD,
  MEMORY_TIERS,
  TIER_RANK,
  defaultTierParams,
  getTierParams,
  isMemoryTier,
  parseMemoryTier,
  archiveThresholdOf,
  classifyRankedTier,
  classifyInsertTier,
  classifyMemoryTier,
  retrievabilityFromSource,
  memoryRefKey,
  workingMemoryLeafRef,
  workingMemoryActiveKeys,
  isActiveMemory,
  tierChangedKind,
  memoryValueFromSource,
};
