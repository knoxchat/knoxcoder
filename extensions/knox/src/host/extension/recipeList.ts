import { isSkillEligible } from "core/context/memory/recipes/skillFromRecipe";
import type { RecipeListItem, RecipeListOutput, RecipeSetStatusOutput } from "core/protocol/nativeAgent";
import { lastRecipeCapture } from "./recipeCapture";

/** MC-70: host side of the Memory page "Recipes" tab. Reads and status moves only; nothing is replayed here. */

async function openStore() {
  const [{ RecipeStore }, { get: getBrainDb }, { hashProjectId }] = await Promise.all([
    import("core/context/memory/recipes/RecipeStore"),
    import("core/context/memory/brain/store/connection"),
    import("core/context/memory/brain/projectScope"),
  ]);
  return { store: new RecipeStore(await getBrainDb()), hashProjectId };
}

export async function listRecipes(workspaceDir: string): Promise<RecipeListOutput> {
  const { store, hashProjectId } = await openStore();
  const recipes = await store.listVisibleTo(hashProjectId(workspaceDir));
  const rows: RecipeListItem[] = recipes.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    scope: r.scope,
    uses: r.stats.replays,
    ok: r.stats.ok,
    reverted: r.stats.reverted,
    failedVerify: r.stats.failedVerify,
    files: r.steps.filter((s) => s.kind !== "command").length,
    oracleKind: r.oracle?.kind,
    sourceCheckpointIds: r.sourceCheckpointIds,
    lastReplayedAt: r.lastReplayedAt,
    updatedAt: r.updatedAt,
    skillEligible: isSkillEligible(r),
  }));
  return { recipes: rows, lastCapture: lastRecipeCapture() };
}

const RECIPE_STATUS_MOVES = ["retired", "quarantined", "candidate", "verified"] as const;

export async function setRecipeStatus(
  workspaceDir: string,
  recipeId: string,
  status: (typeof RECIPE_STATUS_MOVES)[number],
): Promise<RecipeSetStatusOutput> {
  if (!(RECIPE_STATUS_MOVES as readonly string[]).includes(status)) return { ok: false, reason: "not_allowed" };
  const { store, hashProjectId } = await openStore();
  const recipe = await store.get(recipeId);
  // A recipe id from the webview is not trusted: another project's recipe looks like a missing one.
  if (!recipe || (recipe.scope === "project" && recipe.projectId !== hashProjectId(workspaceDir))) {
    return { ok: false, reason: "not_found" };
  }
  try {
    await store.transition(recipeId, status);
    return { ok: true };
  } catch {
    return { ok: false, reason: "not_allowed" };
  }
}
