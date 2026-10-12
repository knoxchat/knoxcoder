/**
 * MC-54: memory growth budget. Caps live recipes per project and the total blob bytes they pin,
 * evicting the least valuable first. Eviction means `retire`, which frees the blob pins so the
 * normal checkpoint retention can reclaim the bytes.
 */
import type { RecipeStore } from "./RecipeStore.js";
import type { Recipe } from "./types.js";

export interface RecipeBudget {
  maxRecipesPerProject: number;
  /** Total bytes of distinct blobs pinned by live recipes of one project. */
  maxBlobBytesPerProject: number;
}

export const DEFAULT_RECIPE_BUDGET: RecipeBudget = {
  maxRecipesPerProject: 200,
  maxBlobBytesPerProject: 256 * 1024 * 1024,
};

export type BlobSizeFn = (hash: string) => number;

const STATUS_RANK: Record<string, number> = { quarantined: 0, candidate: 1, verified: 2 };

/** Higher is more worth keeping. Status dominates, then track record, then recency. */
export function recipeValue(r: Recipe): number {
  const record = r.stats.ok * 2 - r.stats.reverted * 3 - r.stats.failedVerify * 2 + (r.userAcceptedAt ? 3 : 0) + Math.min(r.captureCount, 5);
  const recency = Date.parse(r.lastReplayedAt ?? r.updatedAt) / 1e13;
  return (STATUS_RANK[r.status] ?? 0) * 1000 + record + (Number.isFinite(recency) ? recency : 0);
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

/** Ids to evict, least valuable first, so each project ends within budget. Pure. */
export function planEviction(recipes: Recipe[], size: BlobSizeFn, budget: RecipeBudget = DEFAULT_RECIPE_BUDGET): string[] {
  const byProject = new Map<string, Recipe[]>();
  for (const r of recipes) {
    if (r.status === "retired") continue;
    (byProject.get(r.projectId) ?? byProject.set(r.projectId, []).get(r.projectId)!).push(r);
  }
  const evict: string[] = [];
  for (const group of byProject.values()) {
    const keep = [...group].sort((a, b) => recipeValue(b) - recipeValue(a) || a.id.localeCompare(b.id));
    while (keep.length > 0 && (keep.length > budget.maxRecipesPerProject || totalBytes(keep, size) > budget.maxBlobBytesPerProject)) {
      evict.push(keep.pop()!.id);
    }
  }
  return evict;
}

export async function enforceRecipeBudget(
  store: RecipeStore,
  size: BlobSizeFn,
  budget: RecipeBudget = DEFAULT_RECIPE_BUDGET,
): Promise<string[]> {
  const live = await store.list({ status: ["candidate", "verified", "quarantined"], limit: 1000 });
  const ids = planEviction(live, size, budget);
  for (const id of ids) await store.retire(id);
  return ids;
}
