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
export type AutoReplaySetting = "off" | "ask" | "exact" | "adapt";

/** Adapt planning is opt-in: Automatic stays byte-identical / slotted / merge. */
export function adaptAllowed(setting: AutoReplaySetting): boolean {
  return setting === "adapt" || setting === "ask";
}

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
  /** Slots filled from extras / defaults rather than the chat sentence. */
  guessedSlots?: number;
  /** Slots filled from the new message itself (parameterized exact). */
  slotFilledFromMessage?: number;
  /** Slot values that differ from the captured examples (parameterized exact). */
  parameterizedSlots?: number;
  /** Target files changed since capture (MC-36). */
  drifted?: boolean;
  /** Clean 3-way merge would apply (drifted but mergeable). */
  merged?: boolean;
  /** Reverts counted in the recent window; falls back to the lifetime `stats.reverted`. */
  recentReverts?: number;
  /** How many distinct families cleared the replay threshold. >1 forces ask. */
  competingReplayable?: number;
  /** Disjoint recipes that would run in sequence. >=2 forces ask. */
  composeCount?: number;
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

  const pre = input.preconditions;
  if (pre && !pre.ok) {
    const detail = pre.failures.length
      ? pre.failures.map((f) => f.reason).join("; ")
      : pre.summary || "preconditions failed; replay refused";
    const why =
      match.recipe.scope === "global" ? `global recipe refused (${detail})` : pre.summary || detail;
    return done("suggest", why, match);
  }

  if (!match.replayable || match.score < REPLAY_THRESHOLD) {
    const pct = Math.round(match.fingerprintSimilarity * 100);
    const title = match.recipe.title || match.recipe.intentFingerprint;
    return done(
      "suggest",
      `similar to "${title}", ${pct}% overlap, not reused; using the recipe as a hint`,
      match,
    );
  }

  if (!pre) return done("suggest", "preconditions were not checked; replay refused", match);

  const reverts = input.recentReverts ?? match.recipe.stats.reverted;
  if (reverts > 0) {
    return done("suggest", `recipe was reverted ${reverts}x; never replayed blindly`, match);
  }

  // Replay is allowed. Choose between exact and adapt. Parameterized, merged, and
  // adapted work always ask; only a byte-identical clean replay may auto-apply.
  const unfilled = input.unfilledSlots ?? 0;
  const guessed = input.guessedSlots ?? 0;
  const fromMessage = input.slotFilledFromMessage ?? 0;
  const parameterized = input.parameterizedSlots ?? 0;
  const hasSlots = match.recipe.slots.length > 0;
  const slotsReady = unfilled === 0 && (!hasSlots || fromMessage === match.recipe.slots.length);
  let mode: "exact" | "adapt" = "exact";
  let why = "verified recipe, same intent, preconditions pass";
  let forceConfirm = false;
  if (unfilled > 0) {
    why = `${unfilled} slot${unfilled === 1 ? "" : "s"} need values`;
    forceConfirm = true;
  } else if (guessed > 0) {
    why = "slot values were inferred; confirm before replay";
    forceConfirm = true;
  } else if (parameterized > 0) {
    why = "verified recipe, slots filled from the request, preconditions pass";
    forceConfirm = true;
  } else if (input.merged) {
    why = "target files changed; a clean merge is available";
    forceConfirm = true;
  } else if (input.drifted) {
    if (!adaptAllowed(setting)) {
      return done("suggest", "target files changed; adapt is off, using the recipe as a hint", match);
    }
    mode = "adapt";
    why = "target files changed since the recipe was captured";
  } else if (hasSlots && slotsReady && match.reason === "fingerprint_exact") {
    why = "verified recipe, slots filled from the request, preconditions pass";
  } else if (match.reason !== "fingerprint_exact") {
    if (!adaptAllowed(setting)) {
      return done("suggest", "similar intent; adapt is off, using the recipe as a hint", match);
    }
    mode = "adapt";
    why = "similar intent; recipe needs a small adaptation";
  }

  if (mode === "adapt" && input.difficulty === "hard") {
    return done("suggest", "task is hard; adapting a recipe is too risky, using it as a hint", match);
  }

  if (mode === "adapt") forceConfirm = true;

  const composeCount = input.composeCount ?? 0;
  if (composeCount > 1) {
    forceConfirm = true;
    why = `${why}; ${composeCount} disjoint recipes will run in sequence`;
  }

  const competing = input.competingReplayable ?? 1;
  if (competing > 1) {
    forceConfirm = true;
    why = `${why}; ${competing} recipes match`;
  }

  const commandOnly =
    match.recipe.steps.length > 0 && match.recipe.steps.every((step) => step.kind === "command");
  if (commandOnly) {
    forceConfirm = true;
    why = `${why}; command recipe asks before run`;
  }

  const { stats } = match.recipe;
  const record = `used ${stats.ok}x, ${stats.reverted} reverts`;
  const needsConfirmation = forceConfirm || setting === "ask" || input.permissionMode === "default";
  return done(mode, `${why} (${record})`, match, needsConfirmation);
}
