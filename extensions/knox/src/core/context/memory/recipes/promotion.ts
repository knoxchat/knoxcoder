/**
 * Recipe promotion (MC-15): `candidate -> verified`.
 *
 * A candidate is promoted only when an oracle passed AND at least one of:
 *   - the user accepted the diff it came from, or
 *   - the same intent succeeded at least twice (distinct passing captures).
 * Everything else stays a candidate. Replay never uses candidates.
 */

import type { RecipeStore } from "./RecipeStore.js";
import type { Recipe } from "./types.js";

/** Passing captures of one intent needed to promote without a user accept. */
export const PROMOTION_MIN_SUCCESSES = 2;

export type PromotionDecision =
  | { promote: true; reason: "user_accepted" | "repeat_success" }
  | { promote: false; reason: "not_candidate" | "no_oracle" | "awaiting_evidence" };

export function decidePromotion(
  recipe: Pick<Recipe, "status" | "oracle" | "userAcceptedAt">,
  intentSuccesses: number,
): PromotionDecision {
  if (recipe.status !== "candidate") return { promote: false, reason: "not_candidate" };
  if (!recipe.oracle) return { promote: false, reason: "no_oracle" };
  if (recipe.userAcceptedAt) return { promote: true, reason: "user_accepted" };
  if (intentSuccesses >= PROMOTION_MIN_SUCCESSES) return { promote: true, reason: "repeat_success" };
  return { promote: false, reason: "awaiting_evidence" };
}

export interface PromotionResult {
  recipe: Recipe;
  decision: PromotionDecision;
  promoted: boolean;
}

/** Re-read the recipe, decide, and promote when eligible. Safe to call repeatedly. */
export async function promoteIfEligible(store: RecipeStore, id: string): Promise<PromotionResult> {
  const recipe = await store.get(id);
  if (!recipe) throw new Error(`Recipe not found: ${id}`);
  const decision = decidePromotion(recipe, await store.countIntentSuccesses(recipe));
  if (!decision.promote) return { recipe, decision, promoted: false };
  return { recipe: await store.verify(id), decision, promoted: true };
}

/** The user accepted the recipe's diff: record it, then promote if the oracle also passed. */
export async function acceptRecipe(store: RecipeStore, id: string, at?: Date): Promise<PromotionResult> {
  await store.recordUserAccept(id, at);
  return promoteIfEligible(store, id);
}
