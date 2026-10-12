/**
 * Replay feedback (MC-34). Outcomes of a replay flow back into the recipe and
 * the memory that describes it:
 *
 *   ok            recorded once the replay verified
 *   failedVerify  recorded by `applyReplayResult` when verification failed
 *   reverted      the user restored/reverted/edited the result in the window
 *
 * `reverted` counts quarantine a recipe at `QUARANTINE_REVERTS` and demote the
 * linked memory (via an injected callback to keep this module DB-agnostic).
 */

import type { RecipeStore } from "./RecipeStore.js";
import type { ReplayResult } from "./replayer.js";
import type { Recipe } from "./types.js";

/** Reverts at or above this quarantine the recipe. One revert is enough: wrong replay is worse than slow. */
export const QUARANTINE_REVERTS = 1;
/** Failed verifications at or above this quarantine the recipe. */
export const QUARANTINE_FAILED_VERIFY = 2;
/** A user change to replayed files within this window counts as a revert. */
export const REVERT_WINDOW_MS = 10 * 60 * 1000;

export interface FeedbackHooks {
  /** Demote the linked memory (mismatch_count++ / lower strength). */
  demoteMemory?: (memoryId: number, recipe: Recipe) => Promise<void>;
}

export function shouldQuarantine(stats: Recipe["stats"]): boolean {
  return stats.reverted >= QUARANTINE_REVERTS || stats.failedVerify >= QUARANTINE_FAILED_VERIFY;
}

async function quarantineIfNeeded(store: RecipeStore, recipe: Recipe, hooks: FeedbackHooks): Promise<Recipe> {
  if (recipe.status !== "verified" || !shouldQuarantine(recipe.stats)) return recipe;
  const next = await store.quarantine(recipe.id);
  if (next.memoryId != null) await hooks.demoteMemory?.(next.memoryId, next);
  return next;
}

/** Record the result of `replayExact`. Refused/drifted replays are not outcomes. */
export async function applyReplayResult(
  store: RecipeStore,
  result: ReplayResult,
  hooks: FeedbackHooks = {},
): Promise<Recipe | null> {
  if (!result.outcome) return null;
  const recipe = await store.recordReplay(result.recipeId, result.outcome);
  return quarantineIfNeeded(store, recipe, hooks);
}

/** Whether a user restore/edit at `at` counts as reverting a replay finished at `replayedAt`. */
export function isWithinRevertWindow(replayedAt: string | undefined, at: Date, windowMs = REVERT_WINDOW_MS): boolean {
  if (!replayedAt) return false;
  const elapsed = at.getTime() - Date.parse(replayedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= windowMs;
}

/**
 * The user reverted, restored, or edited a replayed result. Ignored outside
 * the window. Moves an `ok` into `reverted` so the recipe is not credited with
 * a success it did not earn.
 */
export async function recordRevert(
  store: RecipeStore,
  recipeId: string,
  at: Date = new Date(),
  hooks: FeedbackHooks = {},
): Promise<Recipe | null> {
  const recipe = await store.get(recipeId);
  if (!recipe || !isWithinRevertWindow(recipe.lastReplayedAt, at)) return null;
  const updated = await store.recordRevert(recipeId);
  return quarantineIfNeeded(store, updated, hooks);
}

/**
 * Recipes whose replay a restore of `restoredFiles` at `at` undid (MC-34): replayed inside the
 * revert window and writing at least one of the restored files.
 */
export function recipesRevertedByRestore(recipes: readonly Recipe[], restoredFiles: readonly string[], at: Date = new Date()): Recipe[] {
  if (restoredFiles.length === 0) return [];
  const files = new Set(restoredFiles.map((f) => f.replace(/\\/g, "/")));
  return recipes.filter(
    (r) =>
      isWithinRevertWindow(r.lastReplayedAt, at) &&
      r.steps.some((s) => s.path && files.has(s.path.replace(/\\/g, "/"))),
  );
}
