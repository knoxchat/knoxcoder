/**
 * Recipe composition (P4.6): a larger request that matches two (or three)
 * disjoint verified recipes may run them in sequence. Each child keeps its own
 * checkpoint and oracle; a failure aborts the rest. Never compose until every
 * child is verified and slot-free. The caller always shows the plan first.
 */

import type { RecipeMatch } from "./RecipeMatcher.js";
import type { Recipe } from "./types.js";

export const COMPOSE_MAX_CHILDREN = 3;

export interface ComposeChild {
  id: string;
  title: string;
  paths: string[];
}

export interface ComposePlan {
  recipes: ComposeChild[];
  why: string;
}

export function recipeWritePaths(recipe: Pick<Recipe, "steps">): string[] {
  return recipe.steps.filter((s) => s.kind === "write_file" && s.path).map((s) => s.path!);
}

export function pathsDisjoint(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.every((p) => !set.has(p));
}

/** Greedy by matcher order: keep replayable, verified, slot-free children whose files do not overlap. */
export function planCompose(matches: readonly RecipeMatch[]): ComposePlan | undefined {
  const replayable = matches.filter(
    (m) => m.replayable && m.recipe.status === "verified" && m.recipe.slots.length === 0,
  );
  if (replayable.length < 2) return undefined;
  const chosen: RecipeMatch[] = [];
  for (const match of replayable) {
    const paths = recipeWritePaths(match.recipe);
    if (!paths.length) continue;
    if (chosen.every((c) => pathsDisjoint(recipeWritePaths(c.recipe), paths))) {
      chosen.push(match);
    }
    if (chosen.length >= COMPOSE_MAX_CHILDREN) break;
  }
  if (chosen.length < 2) return undefined;
  return {
    recipes: chosen.map((m) => ({
      id: m.recipe.id,
      title: m.recipe.title,
      paths: recipeWritePaths(m.recipe),
    })),
    why: `${chosen.length} disjoint recipes cover this request`,
  };
}

export function formatComposePreview(plan: ComposePlan): string {
  return [
    `Will run ${plan.recipes.length} recipes in sequence:`,
    ...plan.recipes.map((r, i) => `${i + 1}. ${r.title} (${r.paths.join(", ")})`),
    "Each has its own checkpoint and check. A failure stops the rest.",
  ].join("\n");
}
