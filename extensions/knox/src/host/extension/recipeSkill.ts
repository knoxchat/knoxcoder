import * as path from "node:path";

import type { RecipePromoteSkillOutput } from "core/protocol/nativeAgent";

/**
 * MC-42: "Promote to skill". Called only after the user chose a destination in the UI, which is the
 * approval. Writes metadata and step descriptions, never file bytes, and never overwrites a skill.
 */
export async function promoteRecipeToSkill(
  workspaceDir: string,
  recipeId: string,
  scope: "project" | "global",
  /** Raw workspace entry recipes are scoped by (capture hashes it); defaults to `workspaceDir`. */
  projectDir: string = workspaceDir,
): Promise<RecipePromoteSkillOutput> {
  const [{ RecipeStore }, { get: getBrainDb }, { buildSkillFromRecipe }, { writeSkillProposal }] = await Promise.all([
    import("core/context/memory/recipes/RecipeStore"),
    import("core/context/memory/brain/store/connection"),
    import("core/context/memory/recipes/skillFromRecipe"),
    import("core/context/memory/recipes/skillWrite"),
  ]);
  const recipe = await new RecipeStore(await getBrainDb()).get(recipeId);
  if (!recipe) return { ok: false, reason: "not_found" };
  if (recipe.scope === "project") {
    const { hashProjectId } = await import("core/context/memory/brain/projectScope");
    if (recipe.projectId !== hashProjectId(projectDir)) return { ok: false, reason: "not_found" };
  }
  const proposal = buildSkillFromRecipe(recipe);
  if (!proposal) return { ok: false, reason: "not_eligible" };
  let skillsDir: string;
  if (scope === "global") {
    const { getGlobalSkillsPath } = await import("core/util/paths");
    skillsDir = getGlobalSkillsPath();
  } else {
    if (!workspaceDir) return { ok: false, reason: "no_workspace" };
    skillsDir = path.join(workspaceDir, "skills");
  }
  const result = writeSkillProposal(proposal, skillsDir);
  return result.ok ? { ok: true, path: result.path } : { ok: false, reason: result.reason };
}
