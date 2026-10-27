/**
 * Host binding for `builtin_recipe` / `@recipe` (P6.1, P6.2, P6.4).
 * List and preview are read-only. Apply uses the existing replayer (callTool).
 * Skill import creates a `candidate` and is never auto-replayed.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { RecipeControlRequest, RecipeControlResult } from "core";
import { isSensitiveSecretFile } from "core/util/redactSecrets";

import type { RecipeReplayHost } from "./recipeReplay";
import { recipesEnabled, workspaceFsPath } from "./recipeCapture";

const MAX_IMPORT_FILE_BYTES = 512 * 1024;

export interface RecipeAgentDeps {
  workspaceDir: string;
  replayHost?: RecipeReplayHost;
}

function unavailable(reason: string): RecipeControlResult {
  return { content: reason, status: "unavailable" };
}

function errorResult(reason: string): RecipeControlResult {
  return { content: reason, status: "error" };
}

export async function handleRecipeControl(
  request: RecipeControlRequest,
  deps: RecipeAgentDeps,
): Promise<RecipeControlResult> {
  if (!recipesEnabled()) {
    return unavailable("Recipes are off. Enable knoxchat.recipes.enabled to list, preview, or apply them.");
  }
  const workspaceDir = deps.workspaceDir;
  if (!workspaceDir) return unavailable("No workspace folder.");

  try {
    switch (request.op) {
      case "list":
        return listOp(workspaceDir, request.query, request.limit);
      case "preview":
        return previewOp(deps, request.recipeId, request.slotValues);
      case "apply":
        return applyOp(deps, request);
      case "import_skill":
        return importSkillOp(deps, request);
      default:
        return errorResult(`Unknown recipe action "${String((request as { op?: string }).op)}".`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

async function listOp(workspaceDir: string, query?: string, limit?: number): Promise<RecipeControlResult> {
  const [{ listRecipes }, { filterRecipesByQuery, formatRecipeAgentList, toRecipeAgentRow }] = await Promise.all([
    import("./recipeList"),
    import("core/context/memory/recipes/agentView"),
  ]);
  const listed = await listRecipes(workspaceDir);
  const { RecipeStore } = await import("core/context/memory/recipes/RecipeStore");
  const { get: getBrainDb } = await import("core/context/memory/brain/store/connection");
  const { hashProjectId } = await import("core/context/memory/brain/projectScope");
  const store = new RecipeStore(await getBrainDb());
  const recipes = await store.listVisibleTo(hashProjectId(workspaceDir), { status: ["verified", "candidate"] });
  const filtered = filterRecipesByQuery(
    recipes.filter((r) => r.status === "verified" || r.status === "candidate"),
    query ?? "",
    Math.max(1, Math.min(limit ?? 12, 30)),
  );
  const rows = filtered.map(toRecipeAgentRow);
  return {
    content: formatRecipeAgentList(rows, listed.lastMatch?.why ? { why: listed.lastMatch.why } : undefined),
    status: "ok",
    recipes: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, files: r.files, slots: r.slots })),
  };
}

async function previewOp(
  deps: RecipeAgentDeps,
  recipeId: string | undefined,
  slotValues?: Record<string, string>,
): Promise<RecipeControlResult> {
  if (!recipeId) return errorResult("preview needs recipe_id.");
  const { RecipeStore } = await import("core/context/memory/recipes/RecipeStore");
  const { get: getBrainDb } = await import("core/context/memory/brain/store/connection");
  const recipe = await new RecipeStore(await getBrainDb()).get(recipeId);
  if (!recipe) return { content: `Recipe ${recipeId} not found.`, status: "refused" };
  const { formatRecipeAgentMeta } = await import("core/context/memory/recipes/agentView");
  if (!deps.replayHost) {
    return {
      content: formatRecipeAgentMeta(recipe),
      status: "ok",
      recipeId: recipe.id,
      title: recipe.title,
    };
  }
  const { previewRecipe } = await import("./recipeReplay");
  const preview = await previewRecipe(deps.replayHost, recipeId, slotValues);
  const text = preview?.text ?? recipe.title;
  return {
    content: formatRecipeAgentMeta(recipe, { preview: text, why: preview?.refusal }),
    status: preview && !preview.allowed ? "refused" : "ok",
    recipeId: recipe.id,
    title: recipe.title,
    preview: text,
  };
}

async function applyOp(deps: RecipeAgentDeps, request: RecipeControlRequest): Promise<RecipeControlResult> {
  if (!request.recipeId) return errorResult("apply needs recipe_id.");
  if (!deps.replayHost) return unavailable("Recipe apply needs the VS Code replay host.");
  const { RecipeStore } = await import("core/context/memory/recipes/RecipeStore");
  const { get: getBrainDb } = await import("core/context/memory/brain/store/connection");
  const recipe = await new RecipeStore(await getBrainDb()).get(request.recipeId);
  if (!recipe) return { content: `Recipe ${request.recipeId} not found.`, status: "refused" };
  if (recipe.status !== "verified") {
    return {
      content: `Recipe "${recipe.title}" is ${recipe.status}, not verified. Imported skills and candidates are never auto-replayed.`,
      status: "refused",
      recipeId: recipe.id,
      title: recipe.title,
    };
  }
  if (request.confirm !== true) {
    const preview = await previewOp(deps, request.recipeId, request.slotValues);
    return {
      ...preview,
      status: "needs_confirm",
      content: `${preview.content}\n\nNothing was written. Call apply again with confirm=true after the user approves, or use the recipe card Apply button.`,
    };
  }
  const { replayRecipe } = await import("./recipeReplay");
  const done = await replayRecipe(deps.replayHost, request.recipeId, {
    slotValues: request.slotValues,
    includePaths: request.includePaths,
  });
  if (!done) return { content: `Recipe ${request.recipeId} could not be applied.`, status: "refused" };
  if (done.status === "applied") {
    return {
      content: `Applied verified recipe "${recipe.title}" id=${recipe.id} to ${done.appliedPaths.length} file(s) through the replayer. Undo restores checkpoint ${done.checkpointId ?? "(none)"}.`,
      status: "applied",
      recipeId: recipe.id,
      title: recipe.title,
    };
  }
  return {
    content: done.failureContext || `Recipe apply ${done.status}: ${done.reason ?? "unknown"}`,
    status: "refused",
    recipeId: recipe.id,
    title: recipe.title,
  };
}

async function importSkillOp(deps: RecipeAgentDeps, request: RecipeControlRequest): Promise<RecipeControlResult> {
  const { parseSkillToCandidate } = await import("core/context/memory/recipes/skillFromRecipe");
  let raw = request.skillContent?.trim() ?? "";
  const root = workspaceFsPath(deps.workspaceDir);
  if (!raw && request.skillPath) {
    const rel = request.skillPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      return { content: "skill_path is outside the workspace.", status: "refused" };
    }
    try {
      raw = await fsp.readFile(abs, "utf8");
    } catch {
      return { content: `Could not read ${request.skillPath}.`, status: "error" };
    }
  }
  if (!raw) return errorResult("import_skill needs skill_path or skill_content.");
  const parsed = parseSkillToCandidate(raw);
  if ("ok" in parsed && parsed.ok === false) {
    return { content: parsed.reason, status: "refused" };
  }
  const sketch = parsed as Exclude<typeof parsed, { ok: false; reason: string }>;
  const { RecipeStore } = await import("core/context/memory/recipes/RecipeStore");
  const { get: getBrainDb } = await import("core/context/memory/brain/store/connection");
  const { hashProjectId } = await import("core/context/memory/brain/projectScope");
  const { intentFingerprint } = await import("core/context/memory/recipes/intentFingerprint");
  const { computeFamilyIdFromRecipe } = await import("core/context/memory/recipes/family");
  const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
  const { registerRecipeBlobPins } = await import("../checkpoints/recipeBlobPins");
  registerRecipeBlobPins();
  const manager = CheckpointManager.getInstance();
  const steps: import("core/context/memory/recipes/types").RecipeStep[] = [];
  for (const rel of sketch.filePaths) {
    if (isSensitiveSecretFile(rel)) continue;
    const abs = path.join(root, rel);
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(abs);
    } catch {
      continue;
    }
    if (bytes.includes(0) || bytes.length > MAX_IMPORT_FILE_BYTES) continue;
    const hash = await manager.pinBlobBytes(bytes);
    steps.push({ kind: "write_file", path: rel, blobHash: hash });
  }
  for (const command of sketch.commands) {
    steps.push({ kind: "command", command });
  }
  if (sketch.verifyCommand && !steps.some((s) => s.kind === "command" && s.command === sketch.verifyCommand)) {
    steps.push({ kind: "command", command: sketch.verifyCommand });
  }
  if (!steps.length) {
    return {
      content: "Skill lists files that are not on disk yet, and has no replayable command. Capture after the work exists, or add a verify command.",
      status: "refused",
    };
  }
  const input = {
    projectId: hashProjectId(deps.workspaceDir),
    title: sketch.title,
    intentText: sketch.intentText,
    intentFingerprint: intentFingerprint(sketch.intentText),
    slots: sketch.slots,
    preconditions: sketch.preconditions.length
      ? sketch.preconditions
      : sketch.filePaths.filter((p) => steps.some((s) => s.path === p)).map((p) => ({ kind: "file_exists", value: p })),
    steps,
    // Do not record an oracle pass. Imported skills stay candidate until a
    // local check actually runs (Verify would otherwise promote on a fake pass).
  };
  const familyId = computeFamilyIdFromRecipe({
    projectId: input.projectId,
    intentText: input.intentText,
    intentFingerprint: input.intentFingerprint,
    slots: input.slots,
    steps: input.steps,
  });
  const store = new RecipeStore(await getBrainDb());
  const created = await store.create({ ...input, familyId });
  await store
    .updateInspector(created.recipe.id, {
      notes: `imported from skill ${sketch.name}; candidate until verified locally`,
    })
    .catch(() => undefined);
  return {
    content: `Imported skill "${sketch.name}" as candidate recipe "${created.recipe.title}" id=${created.recipe.id}. It is not replayable until verified locally.`,
    status: "ok",
    recipeId: created.recipe.id,
    title: created.recipe.title,
  };
}
