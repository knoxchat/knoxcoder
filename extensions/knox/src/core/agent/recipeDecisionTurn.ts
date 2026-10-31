/**
 * Per-turn recipe decision (MC-24): match the user's message against verified
 * recipes, check preconditions, run the `DecisionEngine`, and describe the
 * result as a `recipe_decision` event for the GUI.
 *
 * Pure: the host supplies the recipe list and the workspace probe. Only runs
 * the (cheap) precondition checks when a replayable match exists.
 */

import { scoreDifficulty } from "../context/memory/brain/TaskRouter.js";
import { formatComposePreview, planCompose, type ComposePlan } from "../context/memory/recipes/compose.js";
import { recentRevertCount } from "../context/memory/recipes/feedback.js";
import { checkPreconditions, type PreconditionEnv } from "../context/memory/recipes/preconditions.js";
import { matchRecipes, type FusionHit, type RecipeMatch } from "../context/memory/recipes/RecipeMatcher.js";
import { isSkillEligible } from "../context/memory/recipes/skillFromRecipe.js";
import { fillSlotsFromMessage, type SlotFillExtra } from "../context/memory/recipes/slots.js";
import type { Recipe, RecipeSlot } from "../context/memory/recipes/types.js";
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
  /** Top-k matches (family-collapsed). Present even when the best is only a near-miss. */
  matches?: RecipeMatchSummary[];
  /** Slot values for parameterized exact; the ask card shows unfilled ones. */
  slots?: RecipeSlotPrompt[];
  /** Files this apply would touch; the ask card can uncheck them (one-off). */
  files?: RecipeFilePrompt[];
  /** Disjoint recipes to run in sequence. Always shown before apply. */
  compose?: ComposePlan;
  /** Adapt `what-if/*` branch, set after an adapt replay applied files. */
  whatIfBranch?: string;
}

export interface RecipeMatchSummary {
  id: string;
  title: string;
  score: number;
  replayable: boolean;
}

export interface RecipeSlotPrompt {
  name: string;
  kind: RecipeSlot["kind"];
  value?: string;
  examples?: string[];
  /** True when a value came from the message, extras, or a default. */
  filled: boolean;
  source?: "message" | "extra" | "default";
}

export interface RecipeFilePrompt {
  path: string;
  action: string;
  /** Recipe files start checked; extra adapt files start unchecked. */
  included: boolean;
  extra?: boolean;
}

export interface RecipeDecisionDeps {
  /**
   * Test / leftover seam that already has Ω(q) candidates.
   * Live recall should set `searchRecipes` (MEM-34) instead of listing.
   */
  listRecipes?(): Promise<Recipe[]>;
  /** Recipe channel over Ω(q). Preferred over `listRecipes`. */
  searchRecipes?(query: string, fusionHits?: readonly FusionHit[]): Promise<Recipe[]>;
  env: PreconditionEnv;
  fusionHits?(): Promise<FusionHit[]>;
  /** True when target files changed since capture (MC-36); only asked once a replay is otherwise allowed. */
  isDrifted?(recipe: Recipe): Promise<boolean>;
  /** Prefer this over `isDrifted` so a clean merge can stay exact (with ask). */
  previewDrift?(recipe: Recipe): Promise<{ drifted: boolean; merged: boolean }>;
}

export interface RecipeDecisionArgs {
  message: string;
  projectId: string;
  autoReplay: AutoReplaySetting;
  permissionMode?: PermissionMode;
  slotExtra?: SlotFillExtra;
  openPaths?: readonly string[];
}

export async function decideRecipeForTurn(
  deps: RecipeDecisionDeps,
  args: RecipeDecisionArgs,
): Promise<RecipeDecisionEvent> {
  const fusionHits = deps.fusionHits ? await deps.fusionHits() : undefined;
  const recipes = deps.searchRecipes
    ? await deps.searchRecipes(args.message, fusionHits)
    : (await deps.listRecipes?.()) ?? [];
  const matches = matchRecipes({
    message: args.message,
    recipes,
    projectId: args.projectId,
    fusionHits,
    openPaths: args.openPaths,
    mentionedPaths: args.slotExtra?.paths,
  });
  const match: RecipeMatch | undefined = matches[0];
  const compose = planCompose(matches);
  const replayableCount = matches.filter((m) => m.replayable).length;
  const fill = match
    ? fillSlotsFromMessage(match.recipe.slots, args.message, {
        extra: args.slotExtra,
        defaults: {
          ...Object.fromEntries(match.recipe.slots.flatMap((s) => (s.examples?.[0] ? [[s.name, s.examples[0]]] : []))),
          ...(match.recipe.slotValues ?? {}),
        },
      })
    : { values: {}, unfilled: 0, fromMessage: 0, guessed: {} };
  const preconditionsToCheck =
    match && fill.unfilled === 0 && match.recipe.slots.length
      ? match.recipe.preconditions.map((p) => {
          let value = p.value;
          for (const slot of match.recipe.slots) {
            const from = match.recipe.slotValues?.[slot.name];
            const to = fill.values[slot.name];
            if (from && to && from !== to) value = value.split(from).join(to);
          }
          return { ...p, value };
        })
      : match?.recipe.preconditions;
  const preconditions =
    match && args.autoReplay !== "off" && (match.replayable || match.recipe.scope === "global")
      ? await checkPreconditions(preconditionsToCheck ?? [], deps.env)
      : undefined;
  let drifted: boolean | undefined;
  let merged: boolean | undefined;
  if (match && preconditions?.ok) {
    if (deps.previewDrift) {
      const state = await deps.previewDrift(match.recipe).catch(() => ({ drifted: true, merged: false }));
      drifted = state.drifted;
      merged = state.merged;
    } else if (deps.isDrifted) {
      drifted = await deps.isDrifted(match.recipe).catch(() => true);
    }
  }
  const parameterizedSlots = match
    ? match.recipe.slots.filter((s) => {
        const filled = fill.values[s.name];
        if (!filled) return false;
        const captured = match.recipe.slotValues?.[s.name];
        return !captured || captured !== filled;
      }).length
    : 0;
  const decision = decide({
    match,
    drifted,
    merged,
    preconditions,
    autoReplay: args.autoReplay,
    permissionMode: args.permissionMode,
    difficulty: scoreDifficulty({ message: args.message }).difficulty,
    unfilledSlots: fill.unfilled,
    guessedSlots: Object.keys(fill.guessed).length,
    slotFilledFromMessage: fill.fromMessage,
    parameterizedSlots,
    recentReverts: match ? recentRevertCount(match.recipe) : undefined,
    competingReplayable: compose ? 1 : replayableCount,
    composeCount: compose?.recipes.length,
  });
  const slots: RecipeSlotPrompt[] | undefined = match?.recipe.slots.length
    ? match.recipe.slots.map((s) => ({
        name: s.name,
        kind: s.kind,
        value: fill.values[s.name],
        examples: s.examples,
        filled: Boolean(fill.values[s.name]),
        source: fill.guessed[s.name]
          ? args.slotExtra && extraHas(args.slotExtra, fill.guessed[s.name])
            ? "extra"
            : "default"
          : fill.values[s.name]
            ? "message"
            : undefined,
      }))
    : undefined;
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
    matches: matches.length
      ? matches.map((m) => ({
          id: m.recipe.id,
          title: m.recipe.title,
          score: m.score,
          replayable: m.replayable,
        }))
      : undefined,
    slots,
    compose: decision.mode === "exact" || decision.mode === "adapt" ? compose : undefined,
    preview:
      (decision.mode === "exact" || decision.mode === "adapt") && compose
        ? formatComposePreview(compose)
        : undefined,
  };
}

function extraHas(extra: SlotFillExtra, value: string): boolean {
  const key = value.toLowerCase();
  return [...(extra.paths ?? []), ...(extra.identifiers ?? []), ...(extra.packages ?? [])].some(
    (v) => v.toLowerCase() === key,
  );
}
