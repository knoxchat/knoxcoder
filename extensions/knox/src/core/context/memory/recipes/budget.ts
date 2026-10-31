/**
 * MC-54 / MEM-35: recipe growth budget.
 *
 * Evict/retire by theorem Value = R·U, not the old status / track-record score.
 * Category S₀ = 30 days (workflow). h/u come from replay attribution (MEM-18)
 * plus hint-attribution leaf counts (MEM-39). Retire when
 * Value < θ_arch or the user retires. The 256MB blob pin is the disk valve.
 * Family cap (8) is a pin budget ranked by Value, not a recall score.
 * Leftover `maxRecipesPerProject` is unused (like the clock knobs).
 */
import {
  ARCHIVE_VALUE_THRESHOLD,
  DEFAULT_INITIAL_IMPORTANCE,
  type ValueParams,
  type ValueSource,
  memoryValueFromSource,
  shouldArchiveByValue,
} from "../brain/Value.js";
import { INITIAL_STABILITY } from "../brain/Forgetting.js";
import type { RecipeStore } from "./RecipeStore.js";
import type { Recipe } from "./types.js";

export interface RecipeBudget {
  /**
   * Leftover inventory cap. MEM-35 does not evict by count — Value < θ_arch
   * and the blob-byte budget are the valves.
   */
  maxRecipesPerProject: number;
  /** Total bytes of distinct blobs pinned by live recipes of one project. */
  maxBlobBytesPerProject: number;
}

export const DEFAULT_RECIPE_BUDGET: RecipeBudget = {
  maxRecipesPerProject: 200,
  maxBlobBytesPerProject: 256 * 1024 * 1024,
};

/** Live variants kept per family. Extra snapshots are retired so pins cannot grow without bound. */
export const MAX_FAMILY_VARIANTS = 8;

/** Recipe M₅ uses the workflow S₀ bucket (30 days). */
export const RECIPE_CATEGORY = "workflow";
export const RECIPE_STABILITY_S0 = INITIAL_STABILITY.workflow;

export type BlobSizeFn = (hash: string) => number;

export interface RecipeEvictionOptions {
  nowMs?: number;
  value?: Partial<ValueParams>;
}

function resolveNow(options?: RecipeEvictionOptions): number {
  const n = Number(options?.nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

function finiteCount(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

/** Replay ok (MEM-18) plus hint-attribution leaf h (MEM-39). */
export function recipeHelpfulCount(r: Recipe): number {
  return (finiteCount(r.helpfulCount) ?? 0) + Math.max(0, r.stats.ok);
}

/** Replay revert / failedVerify (MEM-18) plus hint-attribution leaf u (MEM-39). */
export function recipeUnhelpfulCount(r: Recipe): number {
  return (finiteCount(r.unhelpfulCount) ?? 0) + Math.max(0, r.stats.reverted + r.stats.failedVerify);
}

export function recipeValueSource(r: Recipe): ValueSource {
  return {
    category: RECIPE_CATEGORY,
    stability: r.stability ?? RECIPE_STABILITY_S0,
    i0: r.i0 ?? DEFAULT_INITIAL_IMPORTANCE,
    helpful_count: recipeHelpfulCount(r),
    unhelpful_count: recipeUnhelpfulCount(r),
    last_accessed_at: r.lastReplayedAt ?? r.updatedAt ?? r.createdAt,
    created_at: r.createdAt,
  };
}

export function recipeMemoryValue(
  r: Recipe,
  nowMs: number = Date.now(),
  params?: Partial<ValueParams>,
): number {
  return memoryValueFromSource(recipeValueSource(r), params, nowMs);
}

export function shouldRetireRecipeByValue(
  r: Recipe,
  nowMs: number = Date.now(),
  params?: Partial<ValueParams>,
): boolean {
  if (r.status === "retired" || r.pinned) return false;
  return shouldArchiveByValue(recipeValueSource(r), params, nowMs);
}

function compareByTheoremValue(a: Recipe, b: Recipe, nowMs: number, params?: Partial<ValueParams>): number {
  const dv = recipeMemoryValue(b, nowMs, params) - recipeMemoryValue(a, nowMs, params);
  if (Math.abs(dv) > 1e-12) return dv;
  return a.id.localeCompare(b.id);
}

export function recipeBlobHashes(r: Recipe): string[] {
  const hashes = new Set<string>();
  for (const s of r.steps) {
    if (s.blobHash) hashes.add(s.blobHash);
    if (s.baseBlobHash) hashes.add(s.baseBlobHash);
  }
  return [...hashes];
}

function totalBytes(recipes: Recipe[], size: BlobSizeFn): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of recipes) {
    for (const h of recipeBlobHashes(r)) {
      if (seen.has(h)) continue;
      seen.add(h);
      n += Math.max(0, size(h));
    }
  }
  return n;
}

function popLowestValue(keep: Recipe[]): Recipe {
  let idx = -1;
  for (let i = keep.length - 1; i >= 0; i--) {
    if (!keep[i].pinned) {
      idx = i;
      break;
    }
  }
  if (idx < 0) idx = keep.length - 1;
  return keep.splice(idx, 1)[0];
}

/** Ids to evict, least valuable first, so each project ends within the disk budget. Pure. */
export function planEviction(
  recipes: Recipe[],
  size: BlobSizeFn,
  budget: RecipeBudget = DEFAULT_RECIPE_BUDGET,
  options?: RecipeEvictionOptions,
): string[] {
  const nowMs = resolveNow(options);
  const params = options?.value;
  const byProject = new Map<string, Recipe[]>();
  for (const r of recipes) {
    if (r.status === "retired") continue;
    (byProject.get(r.projectId) ?? byProject.set(r.projectId, []).get(r.projectId)!).push(r);
  }
  const evict: string[] = [];
  for (const group of byProject.values()) {
    const keep: Recipe[] = [];
    for (const r of group) {
      if (shouldRetireRecipeByValue(r, nowMs, params)) evict.push(r.id);
      else keep.push(r);
    }
    keep.sort((a, b) => compareByTheoremValue(a, b, nowMs, params));
    while (keep.length > 0 && totalBytes(keep, size) > budget.maxBlobBytesPerProject) {
      evict.push(popLowestValue(keep).id);
    }
  }
  return evict;
}

export async function enforceRecipeBudget(
  store: RecipeStore,
  size: BlobSizeFn,
  budget: RecipeBudget = DEFAULT_RECIPE_BUDGET,
  options?: RecipeEvictionOptions,
): Promise<string[]> {
  const live = await store.listLive({ status: ["candidate", "verified", "quarantined"] });
  const ids = planEviction(live, size, budget, options);
  for (const id of ids) await store.retire(id);
  return ids;
}

/** Retire the lowest-Value extra variants of one family (pin budget, not recall). */
export function planFamilyVariantEviction(
  recipes: Recipe[],
  cap = MAX_FAMILY_VARIANTS,
  options?: RecipeEvictionOptions,
): string[] {
  const nowMs = resolveNow(options);
  const params = options?.value;
  const byFamily = new Map<string, Recipe[]>();
  for (const r of recipes) {
    if (r.status === "retired" || !r.familyId) continue;
    (byFamily.get(r.familyId) ?? byFamily.set(r.familyId, []).get(r.familyId)!).push(r);
  }
  const evict: string[] = [];
  for (const group of byFamily.values()) {
    if (group.length <= cap) continue;
    const keep = [...group].sort((a, b) => compareByTheoremValue(a, b, nowMs, params));
    evict.push(...keep.slice(cap).map((r) => r.id));
  }
  return evict;
}

export async function enforceFamilyVariantCap(
  store: RecipeStore,
  familyId: string,
  cap = MAX_FAMILY_VARIANTS,
  options?: RecipeEvictionOptions,
): Promise<string[]> {
  if (!familyId) return [];
  const members = await store.listLive({ familyId, status: ["candidate", "verified", "quarantined"] });
  const ids = planFamilyVariantEviction(members, cap, options);
  for (const id of ids) await store.retire(id);
  return ids;
}

export async function enforceAllFamilyVariantCaps(
  store: RecipeStore,
  cap = MAX_FAMILY_VARIANTS,
  options?: RecipeEvictionOptions,
): Promise<string[]> {
  const live = await store.listLive({ status: ["candidate", "verified", "quarantined"] });
  const ids = planFamilyVariantEviction(live, cap, options);
  for (const id of ids) await store.retire(id);
  return ids;
}

/** Sleep / session-end scheduler: family pin cap, Value / disk budget, then purge old rows. */
export async function runRecipeMaintenance(
  store: RecipeStore,
  size: BlobSizeFn = () => 0,
  options?: RecipeEvictionOptions,
): Promise<{ evicted: string[]; purged: number }> {
  const familyEvicted = await enforceAllFamilyVariantCaps(store, MAX_FAMILY_VARIANTS, options);
  const evicted = [...familyEvicted, ...(await enforceRecipeBudget(store, size, DEFAULT_RECIPE_BUDGET, options))];
  const purged = await store.purgeStale();
  return { evicted, purged };
}

export { ARCHIVE_VALUE_THRESHOLD };
