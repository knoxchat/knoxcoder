/**
 * DecisionEngine (MC-23): the pre-LLM decision point. Given a recipe match and
 * the state around it, pick one of
 *
 *   exact    apply from blobs, no LLM call
 *   adapt    one small LLM call returning only the delta
 *   suggest  inject the recipe as a worked example; the model still generates
 *   generate normal agent loop
 *
 * Pure and ordered from safest to riskiest: every rule can only move the
 * decision toward `suggest`/`generate`, never toward more automation.
 * "Wrong replay is worse than slow generation."
 */

import type { RecipeMatch } from "../context/memory/recipes/RecipeMatcher.js";
import { MIN_MATCH_SCORE, REPLAY_THRESHOLD } from "../context/memory/recipes/RecipeMatcher.js";
import type { PreconditionResult } from "../context/memory/recipes/preconditions.js";
import type { TaskDifficulty } from "../context/memory/brain/TaskRouter.js";
import type { PermissionMode } from "./permissions.js";

export type DecisionMode = "exact" | "adapt" | "suggest" | "generate";
export type AutoReplaySetting = "off" | "ask" | "exact";

export interface DecisionInput {
  /** Best match from `RecipeMatcher`; undefined when nothing matched. */
  match?: RecipeMatch;
  /** Result of `checkPreconditions`; undefined means not checked yet (treated as not ok for replay). */
  preconditions?: PreconditionResult;
  difficulty?: TaskDifficulty;
  permissionMode?: PermissionMode;
  /** `knoxchat.recipes.autoReplay`. Defaults to `off`. */
  autoReplay?: AutoReplaySetting;
  /** Slots that still need values from the user's message. */
  unfilledSlots?: number;
  /** Target files changed since capture (MC-36). */
  drifted?: boolean;
  /** Reverts counted in the recent window; falls back to the lifetime `stats.reverted`. */
  recentReverts?: number;
}

export interface Decision {
  mode: DecisionMode;
  /** One line for logs and the GUI (MC-24/25). */
  why: string;
  recipeId?: string;
  /** Exact/adapt would apply files: ask the user first (autoReplay=ask, or permission mode `default`). */
  needsConfirmation: boolean;
}

function done(mode: DecisionMode, why: string, match?: RecipeMatch, needsConfirmation = false): Decision {
  return { mode, why, recipeId: match?.recipe.id, needsConfirmation };
}

export function decide(input: DecisionInput): Decision {
  const { match } = input;
  if (!match) return done("generate", "no verified recipe matches this task");
  if (match.recipe.status !== "verified") return done("generate", `recipe is ${match.recipe.status}, not verified`);
  if (match.score < MIN_MATCH_SCORE) return done("generate", `match score ${match.score} is too low`);

  const setting = input.autoReplay ?? "off";
  if (setting === "off") return done("suggest", "auto-replay is off; using the recipe as a hint", match);
  if (!match.replayable || match.score < REPLAY_THRESHOLD) {
    return done("suggest", `match score ${match.score} is below the replay threshold; using the recipe as a hint`, match);
  }

  const pre = input.preconditions;
  if (!pre) return done("suggest", "preconditions were not checked; replay refused", match);
  if (!pre.ok) return done("suggest", pre.summary || "preconditions failed; replay refused", match);

  const reverts = input.recentReverts ?? match.recipe.stats.reverted;
  if (reverts > 0) {
    return done("suggest", `recipe was reverted ${reverts}x; never replayed blindly`, match);
  }

  // Replay is allowed. Choose between exact and adapt.
  const unfilled = input.unfilledSlots ?? 0;
  let mode: "exact" | "adapt" = "exact";
  let why = "verified recipe, same intent, preconditions pass";
  if (match.reason !== "fingerprint_exact") {
    mode = "adapt";
    why = "similar intent; recipe needs a small adaptation";
  } else if (unfilled > 0) {
    mode = "adapt";
    why = `${unfilled} slot${unfilled === 1 ? "" : "s"} need values`;
  } else if (input.drifted) {
    mode = "adapt";
    why = "target files changed since the recipe was captured";
  }

  if (mode === "adapt" && input.difficulty === "hard") {
    return done("suggest", "task is hard; adapting a recipe is too risky, using it as a hint", match);
  }

  const { stats } = match.recipe;
  const record = `used ${stats.ok}x, ${stats.reverted} reverts`;
  const needsConfirmation = setting === "ask" || input.permissionMode === "default";
  return done(mode, `${why} (${record})`, match, needsConfirmation);
}
