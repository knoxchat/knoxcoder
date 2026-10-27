import { isSkillEligible } from "core/context/memory/recipes/skillFromRecipe";
import type {
  RecipeListItem,
  RecipeListOutput,
  RecipePatchInput,
  RecipePatchOutput,
  RecipeSetStatusOutput,
} from "core/protocol/nativeAgent";
import { lastRecipeCapture, lastRecipeCaptures, lastRecipeMatch } from "./recipeCapture";

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
  let recipes = await store.listVisibleTo(hashProjectId(workspaceDir));
  try {
    const [{ linkRecipeMemory }, { BrainManager }, { BrainStore }] = await Promise.all([
      import("core/context/memory/recipes/memoryLink"),
      import("core/context/memory/brain/BrainManager"),
      import("core/context/memory/brain/BrainStore"),
    ]);
    const relinked = [];
    for (const recipe of recipes) {
      if (recipe.status !== "verified" || recipe.memoryId == null) {
        relinked.push(recipe);
        continue;
      }
      relinked.push(
        await linkRecipeMemory(store, recipe, (memory) => BrainManager.store(memory), async (id) =>
          (await BrainStore.getSemanticById(id)) != null,
        ).catch(() => recipe),
      );
    }
    recipes = relinked;
  } catch {
    // Listing still works if memory is unavailable.
  }
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
    oracleCommand: r.oracle?.command,
    sourceCheckpointIds: r.sourceCheckpointIds,
    lastReplayedAt: r.lastReplayedAt,
    updatedAt: r.updatedAt,
    skillEligible: isSkillEligible(r),
    intentText: r.intentText,
    intentFingerprint: r.intentFingerprint,
    familyId: r.familyId,
    slots: r.slots,
    slotValues: r.slotValues,
    preconditions: r.preconditions,
    steps: r.steps.map((s) => ({ kind: s.kind, ...(s.path ? { path: s.path } : {}), ...(s.command ? { command: s.command } : {}) })),
    memoryId: r.memoryId,
    sourceSessionId: r.sourceSessionId,
    pinned: r.pinned === true,
    notes: r.notes || undefined,
    captureCount: r.captureCount,
  }));
  const lastCaptures = lastRecipeCaptures();
  return { recipes: rows, lastCapture: lastRecipeCapture(), lastCaptures, lastMatch: lastRecipeMatch() };
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
    if (status === "verified") {
      const { acceptRecipe } = await import("core/context/memory/recipes/promotion");
      await acceptRecipe(store, recipeId);
      return { ok: true };
    }
    await store.transition(recipeId, status);
    return { ok: true };
  } catch {
    return { ok: false, reason: "not_allowed" };
  }
}

function patchReason(error: unknown): RecipePatchOutput["reason"] {
  const message = error instanceof Error ? error.message : String(error);
  if (/consent/i.test(message)) return "needs_consent";
  if (/precondition/i.test(message)) return "needs_precondition";
  if (/not found/i.test(message)) return "not_found";
  return "not_allowed";
}

/** P5 inspector writes: title/notes/pin, slots/preconditions, promote or demote scope. */
export async function patchRecipe(workspaceDir: string, input: RecipePatchInput): Promise<RecipePatchOutput> {
  const recipeId = typeof input.recipeId === "string" ? input.recipeId : "";
  if (!recipeId) return { ok: false, reason: "not_found" };
  const { store, hashProjectId } = await openStore();
  const recipe = await store.get(recipeId);
  if (!recipe || (recipe.scope === "project" && recipe.projectId !== hashProjectId(workspaceDir))) {
    return { ok: false, reason: "not_found" };
  }
  try {
    if (input.scope === "global") {
      await store.promoteToGlobal(recipeId, { consent: input.consent === true });
    } else if (input.scope === "project") {
      await store.demoteToProject(recipeId);
    }
    if (input.title !== undefined || input.notes !== undefined || input.pinned !== undefined) {
      await store.updateInspector(recipeId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      });
    }
    if (input.slots !== undefined || input.userPreconditions !== undefined) {
      await store.updateProcedure(recipeId, {
        ...(input.slots !== undefined ? { slots: input.slots } : {}),
        ...(input.userPreconditions !== undefined ? { userPreconditions: input.userPreconditions } : {}),
      });
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: patchReason(error) };
  }
}

/** User accepted a diff: promote any candidate that wrote this file and already has an oracle. */
export async function acceptCandidateRecipesForFile(workspaceDir: string, fileUri: string): Promise<void> {
  const vscode = await import("vscode");
  const { recipesEnabled, workspaceFsPath } = await import("./recipeCapture");
  if (!recipesEnabled()) return;
  const path = await import("node:path");
  const root = workspaceFsPath(workspaceDir);
  let rel: string;
  try {
    const fsPath = /^[a-z][a-z0-9+.-]*:\/\//i.test(fileUri) ? vscode.Uri.parse(fileUri).fsPath : fileUri;
    rel = path.relative(root, fsPath).replace(/\\/g, "/");
  } catch {
    return;
  }
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  const { store, hashProjectId } = await openStore();
  const { acceptRecipe } = await import("core/context/memory/recipes/promotion");
  const recipes = await store.list({ projectId: hashProjectId(workspaceDir), status: "candidate" });
  for (const recipe of recipes) {
    if (recipe.oracle && recipe.steps.some((s) => s.path === rel)) {
      await acceptRecipe(store, recipe.id).catch(() => undefined);
    }
  }
}
