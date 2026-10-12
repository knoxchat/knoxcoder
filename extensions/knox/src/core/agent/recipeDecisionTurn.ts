/**
 * Per-turn recipe decision (MC-24): match the user's message against verified
 * recipes, check preconditions, run the `DecisionEngine`, and describe the
 * result as a `recipe_decision` event for the GUI.
 *
 * Pure: the host supplies the recipe list and the workspace probe. Only runs
 * the (cheap) precondition checks when a replayable match exists.
 */

import { scoreDifficulty } from "../context/memory/brain/TaskRouter.js";
import { checkPreconditions, type PreconditionEnv } from "../context/memory/recipes/preconditions.js";
import { bestMatch, type FusionHit } from "../context/memory/recipes/RecipeMatcher.js";
import { isSkillEligible } from "../context/memory/recipes/skillFromRecipe.js";
import type { Recipe } from "../context/memory/recipes/types.js";
import { decide, type AutoReplaySetting, type Decision } from "./decisionEngine.js";
import type { PermissionMode } from "./permissions.js";

export interface RecipeDecisionEvent {
  type: "recipe_decision";
  mode: Decision["mode"];
  why: string;
  needsConfirmation: boolean;
  /** Pre-replay checkpoint; set once a replay applied files (MC-30). */
  undoCheckpointId?: string;
  /** `exact` + `ask`: what the replay would change, for the preview card (MC-35). */
  preview?: string;
  /** `exact` + auto-replay: what happened when the host applied the recipe (MC-30). */
  replay?: {
    status: "applied" | "refused" | "drifted" | "failed_verify" | "failed_apply";
    appliedPaths: string[];
    reason?: string;
  };
  recipe?: {
    id: string;
    title: string;
    uses: number;
    reverts: number;
    score: number;
    /** Verified and replayed enough times to offer "Promote to skill" (MC-42). */
    skillEligible?: boolean;
  };
}

export interface RecipeDecisionDeps {
  /** Verified recipes for this project. */
  listRecipes(): Promise<Recipe[]>;
  env: PreconditionEnv;
  fusionHits?(): Promise<FusionHit[]>;
  /** True when target files changed since capture (MC-36); only asked once a replay is otherwise allowed. */
  isDrifted?(recipe: Recipe): Promise<boolean>;
}

export interface RecipeDecisionArgs {
  message: string;
  projectId: string;
  autoReplay: AutoReplaySetting;
  permissionMode?: PermissionMode;
}

export async function decideRecipeForTurn(
  deps: RecipeDecisionDeps,
  args: RecipeDecisionArgs,
): Promise<RecipeDecisionEvent> {
  const recipes = await deps.listRecipes();
  const match = bestMatch({
    message: args.message,
    recipes,
    projectId: args.projectId,
    fusionHits: deps.fusionHits ? await deps.fusionHits() : undefined,
  });
  const preconditions =
    match?.replayable && args.autoReplay !== "off"
      ? await checkPreconditions(match.recipe.preconditions, deps.env)
      : undefined;
  const drifted =
    match && preconditions?.ok && deps.isDrifted ? await deps.isDrifted(match.recipe).catch(() => true) : undefined;
  const decision = decide({
    match,
    drifted,
    preconditions,
    autoReplay: args.autoReplay,
    permissionMode: args.permissionMode,
    difficulty: scoreDifficulty({ message: args.message }).difficulty,
    // Slot values are not extracted from the message yet (MC-32), so every slot counts as unfilled.
    unfilledSlots: match ? match.recipe.slots.length : 0,
  });
  return {
    type: "recipe_decision",
    mode: decision.mode,
    why: decision.why,
    needsConfirmation: decision.needsConfirmation,
    recipe: match
      ? {
          id: match.recipe.id,
          title: match.recipe.title,
          uses: match.recipe.stats.ok,
          reverts: match.recipe.stats.reverted,
          score: match.score,
          skillEligible: isSkillEligible(match.recipe),
        }
      : undefined,
  };
}
