import * as vscode from "vscode";

export type UserCorrectionKind = "rejected_diff" | "edited_after_apply" | "not_this";

const EDIT_GRACE_MS = 2000;

/**
 * P7.1: persist a `user_correction` soul event so sleep self-review can quarantine or
 * write an `error_fix`. Best-effort; never throws.
 */
export async function recordUserCorrection(input: {
  kind: UserCorrectionKind;
  files?: string[];
  recipeId?: string;
  text?: string;
}): Promise<void> {
  try {
    if (!vscode.workspace.getConfiguration("knoxchat").get<boolean>("recipes.enabled", false)) return;
    const [{ recordSoulEvent }, { BrainManager }] = await Promise.all([
      import("core/context/soul/recordSoulEvent"),
      import("core/context/memory/brain/BrainManager"),
    ]);
    const sessionId = BrainManager.getActiveSessionId();
    if (!sessionId) return;
    const summary =
      input.text ??
      (input.kind === "rejected_diff"
        ? "rejected diff"
        : input.kind === "edited_after_apply"
          ? "edited after apply"
          : "not this");
    await recordSoulEvent({
      sessionId,
      kind: "user_correction",
      files: input.files ?? [],
      ok: false,
      summary,
      metadata: {
        correction: input.kind,
        ...(input.recipeId ? { recipeId: input.recipeId } : {}),
      },
    });
  } catch (error) {
    console.warn("[Recipes] User correction was not recorded:", error instanceof Error ? error.message : error);
  }
}

/** Skip / "Don't save" / "not this" on a known recipe. */
export async function recordRecipeNotThis(recipeId?: string, title?: string): Promise<void> {
  await recordUserCorrection({
    kind: "not_this",
    recipeId,
    text: title ? `not this: skipped recipe "${title}"` : "not this",
  });
}

/**
 * A save of a recently replayed file (after a short grace so the replay write itself is ignored)
 * is a user correction, not an immediate revert.
 */
export async function recordEditAfterApply(savedFiles: string[]): Promise<void> {
  try {
    if (!vscode.workspace.getConfiguration("knoxchat").get<boolean>("recipes.enabled", false)) return;
    if (savedFiles.length === 0) return;
    const [{ RecipeStore }, { get: getBrainDb }, { isWithinRevertWindow }] = await Promise.all([
      import("core/context/memory/recipes/RecipeStore"),
      import("core/context/memory/brain/store/connection"),
      import("core/context/memory/recipes/feedback"),
    ]);
    const store = new RecipeStore(await getBrainDb());
    const now = new Date();
    const files = new Set(savedFiles.map((f) => f.replace(/\\/g, "/")));
    const hit = (await store.list({ status: "verified", limit: 1000 })).filter((r) => {
      if (!isWithinRevertWindow(r.lastReplayedAt, now)) return false;
      const elapsed = now.getTime() - Date.parse(r.lastReplayedAt!);
      if (!Number.isFinite(elapsed) || elapsed < EDIT_GRACE_MS) return false;
      return r.steps.some((s) => s.path && files.has(s.path.replace(/\\/g, "/")));
    });
    for (const recipe of hit) {
      await recordUserCorrection({
        kind: "edited_after_apply",
        files: savedFiles,
        recipeId: recipe.id,
        text: `edited after apply: ${savedFiles[0] ?? recipe.title}`,
      });
    }
  } catch (error) {
    console.warn("[Recipes] Edit-after-apply feedback failed:", error instanceof Error ? error.message : error);
  }
}

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
      await recordRevert(store, recipe.id, now);
    }
  } catch (error) {
    console.warn("[Recipes] Restore feedback failed:", error instanceof Error ? error.message : error);
  }
}
