import type { BundleRecipe, RejectedRecipe } from "core/context/memory/recipes/bundle";

/**
 * MC-63: verified, command-free recipes of this project, trimmed for a bundle. Pass the result as
 * `recipes` to `exportCheckpoints` / `shareCheckpoints` only after the user agreed to share them.
 */
export async function collectShareableRecipes(workspaceDir: string): Promise<BundleRecipe[]> {
  const [{ RecipeStore }, { get: getBrainDb }, { hashProjectId }, { toBundleRecipe }] = await Promise.all([
    import("core/context/memory/recipes/RecipeStore"),
    import("core/context/memory/brain/store/connection"),
    import("core/context/memory/brain/projectScope"),
    import("core/context/memory/recipes/bundle"),
  ]);
  const store = new RecipeStore(await getBrainDb());
  const recipes = await store.list({ projectId: hashProjectId(workspaceDir), status: "verified" });
  return recipes.map(toBundleRecipe).filter((r): r is BundleRecipe => !!r);
}

/**
 * MC-63: `onRecipes` for `importCheckpoints`. Stores every valid entry as a `candidate` of this
 * project; rejected entries are returned for display and never stored.
 */
export function importBundleRecipes(workspaceDir: string, report?: (result: { created: number; existing: number; rejected: RejectedRecipe[] }) => void) {
  return async (raw: unknown[], blobHashes: ReadonlySet<string>): Promise<void> => {
    const [{ RecipeStore }, { get: getBrainDb }, { hashProjectId }, { parseBundleRecipes }, { registerRecipeBlobPins }] =
      await Promise.all([
        import("core/context/memory/recipes/RecipeStore"),
        import("core/context/memory/brain/store/connection"),
        import("core/context/memory/brain/projectScope"),
        import("core/context/memory/recipes/bundle"),
        import("../checkpoints/recipeBlobPins"),
      ]);
    registerRecipeBlobPins();
    const { inputs, rejected } = parseBundleRecipes(raw, blobHashes, hashProjectId(workspaceDir));
    const store = new RecipeStore(await getBrainDb());
    let created = 0;
    let existing = 0;
    for (const input of inputs) {
      const result = await store.create(input);
      result.created ? created++ : existing++;
    }
    report?.({ created, existing, rejected });
  };
}
