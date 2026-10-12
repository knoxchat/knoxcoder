import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { normalizeIntent } from "core/context/soul/turnIntent";
import type { TurnFileChange } from "core/context/memory/recipes/capture";

/** Newest soul event id when each chat session's current turn started. */
const turnMarks = new Map<string, number>();

export function recipesEnabled(): boolean {
  return vscode.workspace.getConfiguration("knoxchat").get<boolean>("recipes.enabled", false);
}

/** `startNativeTurn`: remember where this turn's soul events begin. No-op when recipes are off. */
export async function markRecipeTurnStart(sessionId: string): Promise<void> {
  if (!recipesEnabled() || !sessionId) return;
  const { listSoulEvents } = await import("core/context/soul/recordSoulEvent");
  const events = listSoulEvents(sessionId);
  turnMarks.set(sessionId, events.length ? events[events.length - 1].episodicId : 0);
}

/** `getWorkspaceDirs()` returns URIs (`file:///...`); file access needs the filesystem path. */
export function workspaceFsPath(dir: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(dir) ? vscode.Uri.parse(dir).fsPath : dir;
}

function workspacePreconditionEnv(rawWorkspaceDir: string): import("core/context/memory/recipes/preconditions").PreconditionEnv {
  const workspaceDir = workspaceFsPath(rawWorkspaceDir);
  const abs = (rel: string) => path.join(workspaceDir, rel);
  return {
    rootEntries: () => fsp.readdir(workspaceDir).catch(() => []),
    readText: (rel) => fsp.readFile(abs(rel), "utf8").catch(() => undefined),
    exists: (rel) => fsp.access(abs(rel)).then(() => true, () => false),
    dirtyPaths: (paths) =>
      new Promise((resolve) => {
        execFile(
          "git",
          ["status", "--porcelain", "--", ...paths],
          { cwd: workspaceDir, timeout: 5000 },
          (err, stdout) => {
            if (err) return resolve(undefined);
            const dirty = stdout
              .split("\n")
              .filter(Boolean)
              .map((l) => l.slice(3).trim());
            resolve(paths.filter((p) => dirty.some((d) => d === p || d.startsWith(`${p}/`))));
          },
        );
      }),
  };
}

/**
 * Until host-side replay is bound to the tool path, every non-`generate` decision (including
 * `exact`) reaches the model as a worked example, so a match always helps and never skips safety.
 */
async function buildHint(
  event: import("core/agent/recipeDecisionTurn").RecipeDecisionEvent,
  recipes: import("core/context/memory/recipes/types").Recipe[],
): Promise<string | undefined> {
  if (event.mode === "generate" || !event.recipe) return undefined;
  const recipe = recipes.find((r) => r.id === event.recipe!.id);
  if (!recipe) return undefined;
  const [{ buildRecipeHint }, { CheckpointManager }] = await Promise.all([
    import("core/context/memory/recipes/recipeHint"),
    import("../checkpoints/CheckpointManager"),
  ]);
  const manager = CheckpointManager.getInstance();
  return buildRecipeHint(recipe, (hash) => manager.readBlobBytes(hash));
}

/**
 * `startNativeTurn` (MC-24): decide exact / adapt / suggest / generate for this
 * message. Returns undefined when recipes are off or anything fails, so the
 * normal agent loop is never affected.
 */
export async function decideRecipeAtTurnStart(
  input: { userMessage: string },
  workspaceDir: string,
  replayHost?: import("./recipeReplay").RecipeReplayHost,
): Promise<{ event: import("core/agent/recipeDecisionTurn").RecipeDecisionEvent; hint?: string } | undefined> {
  if (!recipesEnabled() || !input.userMessage?.trim()) return undefined;
  try {
    const [{ decideRecipeForTurn }, { RecipeStore }, { get: getBrainDb }, { hashProjectId }] = await Promise.all([
      import("core/agent/recipeDecisionTurn"),
      import("core/context/memory/recipes/RecipeStore"),
      import("core/context/memory/brain/store/connection"),
      import("core/context/memory/brain/projectScope"),
    ]);
    const projectId = hashProjectId(workspaceDir);
    const store = new RecipeStore(await getBrainDb());
    const setting = vscode.workspace.getConfiguration("knoxchat").get<string>("recipes.autoReplay", "off");
    const autoReplay = setting === "ask" || setting === "exact" ? setting : "off";
    const recipes = await store.list({ projectId, status: "verified" });
    const replay = replayHost ? await import("./recipeReplay") : undefined;
    const event = await decideRecipeForTurn(
      {
        listRecipes: async () => recipes,
        env: workspacePreconditionEnv(workspaceDir),
        isDrifted:
          replay && replayHost
            ? async (recipe) => {
                const { previewReplay } = await import("core/context/memory/recipes/replayPreview");
                return (await previewReplay(recipe, await replay.createPreviewPorts(replayHost))).drifted;
              }
            : undefined,
      },
      { message: input.userMessage, projectId, autoReplay },
    );
    let failureContext: string | undefined;
    if (replay && replayHost && event.mode === "exact" && event.recipe) {
      if (event.needsConfirmation) {
        event.preview = (await replay.previewRecipe(replayHost, event.recipe.id))?.text;
      } else {
        const done = await replay.replayRecipe(replayHost, event.recipe.id);
        if (done) {
          event.replay = { status: done.status, appliedPaths: done.appliedPaths, reason: done.reason };
          if (done.status === "applied") {
            event.undoCheckpointId = done.checkpointId;
            return { event };
          }
          // Did not land: fall back to the model, with the failure and the recipe as context.
          event.mode = "suggest";
          event.why = `replay ${done.status}; continuing with the model`;
          failureContext = done.failureContext;
        }
      }
    }
    if (replay && replayHost && event.mode === "adapt" && event.recipe) {
      // MC-32: one model call plans the change; the user always sees the diff before anything is written.
      const recipe = recipes.find((r) => r.id === event.recipe!.id);
      const planned = recipe ? await replay.planAdaptedRecipe(replayHost, recipe, input.userMessage).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e) })) : undefined;
      if (planned?.ok) {
        event.needsConfirmation = true;
        event.preview = planned.preview;
      } else if (planned) {
        event.mode = "suggest";
        event.why = `could not adapt the recipe (${planned.reason}); using it as a hint`;
      }
    }
    const hint = await buildHint(event, recipes);
    return { event, hint: [failureContext, hint].filter(Boolean).join("\n\n") || undefined };
  } catch (error) {
    console.warn("[Recipes] Decision failed:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

interface ResolvedState {
  content: string;
  encoding: string;
  hash?: string;
}

/**
 * Files that differ between two reconstructed checkpoint states, by blob hash.
 * Returns undefined when a changed file has no blob hash (legacy inline
 * content): a recipe must point at a blob, so such a turn is not captured.
 */
export function diffCheckpointStates(
  before: ReadonlyMap<string, ResolvedState>,
  after: ReadonlyMap<string, ResolvedState>,
  containsSecret: (text: string) => boolean,
): TurnFileChange[] | undefined {
  const changes: TurnFileChange[] = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const path of [...paths].sort()) {
    const b = before.get(path);
    const a = after.get(path);
    if (b && a && b.hash && b.hash === a.hash) continue;
    if (!a) {
      changes.push({ path, deleted: true, baseHash: b?.hash });
      continue;
    }
    if (!a.hash) return undefined;
    const text = a.encoding === "base64" ? "" : a.content;
    changes.push({
      path,
      hash: a.hash,
      baseHash: b?.hash,
      hasSecret: text ? containsSecret(text) : false,
    });
  }
  return changes;
}

/**
 * `finishNativeTurn`: when recipes are on and the turn qualifies, take an
 * "after" checkpoint and store a `candidate` recipe. Never throws; never
 * changes agent behaviour.
 */
export async function captureRecipeAfterTurn(
  input: { sessionId: string; userMessage: string },
  workspaceDir: string,
): Promise<void> {
  if (!recipesEnabled() || !input.sessionId) return;
  const mark = turnMarks.get(input.sessionId);
  turnMarks.delete(input.sessionId);
  try {
    const [{ captureRecipeFromTurn }, { RecipeStore }, { listSoulEvents }, { get: getBrainDb }] =
      await Promise.all([
        import("core/context/memory/recipes/capture"),
        import("core/context/memory/recipes/RecipeStore"),
        import("core/context/soul/recordSoulEvent"),
        import("core/context/memory/brain/store/connection"),
      ]);
    const { hashProjectId } = await import("core/context/memory/brain/projectScope");
    const { containsSecret } = await import("core/util/redactSecrets");
    const { BrainManager } = await import("core/context/memory/brain/BrainManager");
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    const { registerRecipeBlobPins } = await import("../checkpoints/recipeBlobPins");

    // Pins first, so the blobs behind the recipe are protected from the moment it exists.
    registerRecipeBlobPins();

    const events = listSoulEvents(input.sessionId);
    const result = await captureRecipeFromTurn(
      {
        store: new RecipeStore(await getBrainDb()),
        storeMemory: (memory) => BrainManager.store(memory),
        async diffAgainst(baseCheckpointId) {
          const manager = CheckpointManager.getInstance();
          const afterCheckpointId = await manager.createManualCheckpoint({
            description: "Recipe capture",
            tags: ["recipe-capture"],
            intent: normalizeIntent(input.userMessage) || undefined,
          });
          if (!afterCheckpointId) return undefined;
          const [before, after] = await Promise.all([
            manager.reconstructStateAtCheckpoint(baseCheckpointId),
            manager.reconstructStateAtCheckpoint(afterCheckpointId),
          ]);
          if (!before || !after) return undefined;
          const changes = diffCheckpointStates(before, after, containsSecret);
          return changes ? { afterCheckpointId, changes } : undefined;
        },
      },
      {
        events,
        markEpisodicId: mark,
        sessionId: input.sessionId,
        projectId: hashProjectId(workspaceDir),
        userMessage: input.userMessage,
      },
    );
    if (result.captured) {
      console.info(
        `[Recipes] ${result.created ? "Captured" : "Already had"} candidate ${result.recipe.id.slice(0, 8)} (${result.recipe.steps.length} steps)`,
      );
    }
  } catch (error) {
    console.warn("[Recipes] Capture failed:", error instanceof Error ? error.message : error);
  }
}
