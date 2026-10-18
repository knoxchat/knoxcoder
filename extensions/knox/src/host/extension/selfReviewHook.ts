import * as vscode from "vscode";

const HOOK_NAME = "recipe-self-review";

function enabled(): boolean {
  const cfg = vscode.workspace.getConfiguration("knoxchat");
  return cfg.get<boolean>("selfImprove.enabled", false) && cfg.get<boolean>("recipes.enabled", false);
}

/**
 * MC-40 / MC-41: after each sleep consolidation cycle, review recorded failures and reverts and
 * apply the safe memory updates. Off unless both `knoxchat.selfImprove.enabled` and
 * `knoxchat.recipes.enabled` are on. Safe to call more than once.
 */
export async function registerSelfReviewHook(): Promise<() => void> {
  const [{ registerSleepCycleHook }, { runSelfReview }, { RecipeStore }, { get: getBrainDb }, { BrainManager }] =
    await Promise.all([
      import("core/context/memory/brain/SleepConsolidation"),
      import("core/context/memory/recipes/selfReviewApply"),
      import("core/context/memory/recipes/RecipeStore"),
      import("core/context/memory/brain/store/connection"),
      import("core/context/memory/brain/BrainManager"),
    ]);
  const offBudget = registerSleepCycleHook("recipe-budget", async () => {
    const db = await getBrainDb();
    const { runRecipeMaintenance } = await import(
      "core/context/memory/recipes/budget"
    );
    const { evicted, purged } = await runRecipeMaintenance(new RecipeStore(db));
    if (evicted.length || purged) {
      console.info(
        `[Recipes] budget evicted ${evicted.length}, purged ${purged} stale rows`,
      );
    }
  });
  const offReview = registerSleepCycleHook(HOOK_NAME, async () => {
    if (!enabled()) return;
    const db = await getBrainDb();
    const { events, report } = await runSelfReview(db, {
      store: new RecipeStore(db),
      storeMemory: (memory) => BrainManager.store(memory),
    });
    if (report.errorFixes || report.quarantined.length || report.merged.length) {
      console.info(
        `[SelfReview] ${events} events: ${report.errorFixes} error_fix, ${report.quarantined.length} quarantined, ${report.merged.length} merged`,
      );
    }
  });
  return () => {
    offBudget();
    offReview();
  };
}
