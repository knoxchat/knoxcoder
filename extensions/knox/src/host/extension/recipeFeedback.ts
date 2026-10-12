import * as vscode from "vscode";

/**
 * MC-34: a workspace restore that undoes a recently replayed recipe counts as a revert. The recipe
 * is quarantined and its memory demoted (see `recordRevert`). Best-effort; never throws.
 */
export async function recordRestoreFeedback(restoredFiles: string[]): Promise<void> {
  try {
    if (!vscode.workspace.getConfiguration("knoxchat").get<boolean>("recipes.enabled", false)) return;
    const [{ RecipeStore }, { get: getBrainDb }, { recipesRevertedByRestore, recordRevert }] = await Promise.all([
      import("core/context/memory/recipes/RecipeStore"),
      import("core/context/memory/brain/store/connection"),
      import("core/context/memory/recipes/feedback"),
    ]);
    const db = await getBrainDb();
    const store = new RecipeStore(db);
    const now = new Date();
    const hit = recipesRevertedByRestore(await store.list({ status: "verified", limit: 1000 }), restoredFiles, now);
    const [{ revertAuditEvent }, { CheckpointManager }] = await Promise.all([
      import("core/context/memory/recipes/metrics"),
      import("../checkpoints/CheckpointManager"),
    ]);
    for (const recipe of hit) {
      void CheckpointManager.getInstance().appendAuditEvent(revertAuditEvent(recipe.id)).catch(() => undefined);
      await recordRevert(store, recipe.id, now, {
        demoteMemory: async (memoryId) => {
          const { recordRecallOutcome } = await import("core/context/memory/brain/memoryOutcomes");
          await recordRecallOutcome(db, [memoryId], "reverted");
        },
      });
    }
  } catch (error) {
    console.warn("[Recipes] Restore feedback failed:", error instanceof Error ? error.message : error);
  }
}
