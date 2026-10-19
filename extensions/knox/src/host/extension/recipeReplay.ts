import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { ContextItem } from "core";
import { classifyOracleEvent } from "core/context/soul/oracleEvents";
import type { PreviewPorts, ReplayPreview } from "core/context/memory/recipes/replayPreview";
import { replayableCommandProblem } from "core/context/memory/recipes/replayer";
import type { ReplayPorts, ReplayResult } from "core/context/memory/recipes/replayer";
import type { Recipe } from "core/context/memory/recipes/types";
import type { RecipePreviewOutput, RecipeReplayOutput } from "core/protocol/nativeAgent";

/**
 * Host binding for recipe replay (MC-30) and its preview (MC-35).
 *
 * Every write goes through `callTool` (the core `tools/call` path), so permissions, command guard,
 * staged review and per-turn checkpoints apply exactly as they do for the model. This file only
 * reads from disk (hashes, current text) and never writes by itself.
 */

export interface RecipeReplayHost {
  workspaceDir: string;
  /**
   * Key recipes are scoped by: the raw `getWorkspaceDirs()` entry (a URI), which is what capture and
   * matching hash. Defaults to `workspaceDir` when the two are the same string.
   */
  projectDir?: string;
  /** Runs one built-in tool through `tools/call`. Throws when the tool is rejected. */
  callTool(name: string, args: Record<string, unknown>): Promise<ContextItem[]>;
  /** One plain model call (prompt in, text out) for adapt mode. Absent: adapt is not offered. */
  complete?(prompt: string): Promise<string>;
  /** MC-62: fork a `what-if/*` branch at the pre-replay checkpoint of an adapt replay. Default on; `false` disables. */
  whatIfBranch?: boolean;
}

const WRITE_TOOL = "builtin_write_file";
const TERMINAL_TOOL = "builtin_run_terminal_command";
/** Oracle and command steps must finish; this mirrors the verify loop's hard cap. */
const COMMAND_WAIT_MS = 10 * 60 * 1000;

const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function absolute(host: RecipeReplayHost, rel: string): string {
  const root = path.resolve(host.workspaceDir);
  const abs = path.resolve(root, rel);
  // `isSafeRelPath` already ran in `planReplay`; this is the second line of defence.
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes workspace: ${rel}`);
  return abs;
}

async function readBytes(host: RecipeReplayHost, rel: string): Promise<Buffer | undefined> {
  try {
    return await fsp.readFile(absolute(host, rel));
  } catch {
    return undefined;
  }
}

function terminalOutput(items: ContextItem[]): string {
  return items.map((i) => i.content).join("\n");
}

/** Exit code from the terminal tool's result text, when present. */
function terminalFailed(items: ContextItem[]): boolean {
  const description = items.map((i) => i.description ?? "").join("\n");
  const exit = /exited\s+(\d+)/i.exec(description);
  if (exit && exit[1] !== "0") return true;
  const output = terminalOutput(items);
  const event = classifyOracleEvent(TERMINAL_TOOL, output);
  return Boolean(event && event.kind.endsWith(":fail"));
}

export async function createPreviewPorts(host: RecipeReplayHost): Promise<PreviewPorts> {
  const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
  const manager = CheckpointManager.getInstance();
  return {
    readBlob: (hash) => manager.readBlobBytes(hash),
    currentHash: async (rel) => {
      const bytes = await readBytes(host, rel);
      return bytes ? sha256(bytes) : undefined;
    },
    readCurrent: async (rel) => {
      const bytes = await readBytes(host, rel);
      return bytes ? new TextDecoder("utf-8").decode(bytes) : undefined;
    },
  };
}

export async function createReplayPorts(
  host: RecipeReplayHost,
  whatIf?: { recipeId: string; intent?: string },
): Promise<ReplayPorts & PreviewPorts> {
  const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
  const manager = CheckpointManager.getInstance();
  const preview = await createPreviewPorts(host);
  return {
    ...preview,
    async createCheckpoint(label) {
      const id = await manager.createManualCheckpoint({ description: label, tags: ["pre-replay"] });
      if (!id) throw new Error("could not create the pre-replay checkpoint");
      // Never throws: no branch just means the replay runs on the current line.
      if (whatIf && host.whatIfBranch !== false) {
        await manager.createWhatIfBranch(id, whatIf.recipeId, whatIf.intent).catch(() => null);
      }
      return id;
    },
    async restoreCheckpoint(id) {
      const result = await manager.restoreCheckpoint(id);
      if (!result.success) throw new Error(`restore reported failure for ${result.failedFiles?.length ?? 0} file(s)`);
    },
    async writeFile(rel, content) {
      const text = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
      if (typeof content !== "string" && text.includes("\uFFFD")) {
        return { ok: false, error: "binary files are not replayed" };
      }
      try {
        await host.callTool(WRITE_TOOL, { filepath: rel, contents: text, openAfterWrite: false });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      // Staged review keeps the edit off disk; an unapplied write must not count as applied.
      const onDisk = await readBytes(host, rel);
      if (!onDisk || sha256(onDisk) !== sha256(text)) {
        return { ok: false, error: "write was held for review or changed on the way; nothing was applied" };
      }
      return { ok: true };
    },
    async deleteFile() {
      // No delete tool exists on the normal tool path, and raw `fs` is not allowed here.
      return { ok: false, error: "delete steps are not replayed" };
    },
    async runCommand(command) {
      try {
        const items = await host.callTool(TERMINAL_TOOL, { command, block_until_ms: COMMAND_WAIT_MS });
        return { ok: !terminalFailed(items), output: terminalOutput(items) };
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) };
      }
    },
    async verify(recipe) {
      const command = recipe.oracle?.command;
      if (!command) {
        // No runnable oracle recorded (lsp/user): the recipe's own verification cannot be repeated.
        return { ok: false, detail: "recipe has no command to verify the replay" };
      }
      const problem = replayableCommandProblem(command);
      if (problem) return { ok: false, detail: `oracle command not run: ${problem}` };
      try {
        const items = await host.callTool(TERMINAL_TOOL, { command, block_until_ms: COMMAND_WAIT_MS });
        return terminalFailed(items)
          ? { ok: false, detail: terminalOutput(items).slice(-1500) }
          : { ok: true };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

async function openStore() {
  const [{ RecipeStore }, { get: getBrainDb }] = await Promise.all([
    import("core/context/memory/recipes/RecipeStore"),
    import("core/context/memory/brain/store/connection"),
  ]);
  const db = await getBrainDb();
  return { store: new RecipeStore(db), db };
}

/**
 * MC-82 / MC-90: a recipe id from the webview is not trusted. Project-scope recipes
 * only apply in the project they were captured in (same rule as `RecipeMatcher`).
 */
export async function recipeOutOfHostProject(
  host: RecipeReplayHost,
  recipe: Recipe,
): Promise<boolean> {
  const [{ recipeAppliesInProject }, { hashProjectId }] = await Promise.all([
    import("core/context/memory/recipes/RecipeMatcher"),
    import("core/context/memory/brain/projectScope"),
  ]);
  return !recipeAppliesInProject(
    recipe,
    hashProjectId(host.projectDir ?? host.workspaceDir),
  );
}

async function outOfScope(host: RecipeReplayHost, recipe: Recipe): Promise<boolean> {
  return recipeOutOfHostProject(host, recipe);
}

/** Adapt plans the user has been shown, keyed by recipe id; applied (not re-planned) on approval. */
const pendingAdapts = new Map<string, import("core/context/memory/recipes/adapt").AdaptPlan & { ok: true }>();

/**
 * Adapt mode (MC-32): one model call produces a patch against the saved files. Nothing is applied;
 * the preview text is shown and the plan is kept until `replayRecipe` is called for the same recipe.
 */
export async function planAdaptedRecipe(
  host: RecipeReplayHost,
  recipe: Recipe,
  request: string,
): Promise<{ ok: true; preview: string } | { ok: false; reason: string }> {
  pendingAdapts.delete(recipe.id);
  if (!host.complete) return { ok: false, reason: "no model available for adapt" };
  const [{ planAdapt, previewAdaptPlan }, { formatReplayPreview }, preview] = await Promise.all([
    import("core/context/memory/recipes/adapt"),
    import("core/context/memory/recipes/replayPreview"),
    createPreviewPorts(host),
  ]);
  const ports = { ...preview, complete: host.complete };
  const plan = await planAdapt(recipe, request, ports);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const view = await previewAdaptPlan(recipe, plan, ports);
  if (!view.allowed) return { ok: false, reason: view.refusal ?? "replay refused" };
  if (view.conflicts.length > 0) return { ok: false, reason: `cannot merge: ${view.conflicts.join(", ")}` };
  pendingAdapts.set(recipe.id, plan);
  return { ok: true, preview: formatReplayPreview(view) };
}

export async function previewRecipe(host: RecipeReplayHost, recipeId: string): Promise<RecipePreviewOutput | undefined> {
  const { store } = await openStore();
  const recipe = await store.get(recipeId);
  if (!recipe || (await outOfScope(host, recipe))) return undefined;
  const [{ previewReplay, formatReplayPreview }, ports] = await Promise.all([
    import("core/context/memory/recipes/replayPreview"),
    createPreviewPorts(host),
  ]);
  const preview: ReplayPreview = await previewReplay(recipe, ports);
  return {
    recipeId,
    allowed: preview.allowed,
    refusal: preview.refusal,
    drifted: preview.drifted,
    conflicts: preview.conflicts,
    files: preview.totals.files,
    added: preview.totals.added,
    removed: preview.totals.removed,
    text: formatReplayPreview(preview),
  };
}

/** MC-71: one audit event per replay that touched files, so the Dashboard can count them. Best-effort. */
async function recordReplayMetrics(
  recipe: Recipe,
  result: ReplayResult,
  ports: ReplayPorts,
  adapted: (import("core/context/memory/recipes/adapt").AdaptPlan & { ok: true }) | undefined,
): Promise<void> {
  try {
    const { replayAuditEvent } = await import("core/context/memory/recipes/metrics");
    const decoder = new TextDecoder("utf-8");
    const applied = new Set(result.appliedPaths);
    const writtenText: string[] = [];
    if (adapted) {
      for (const [file, text] of adapted.merged) if (applied.has(file)) writtenText.push(text);
    } else {
      for (const step of recipe.steps) {
        if (step.kind !== "write_file" || !step.path || !step.blobHash || !applied.has(step.path)) continue;
        const bytes = await ports.readBlob(step.blobHash);
        if (bytes !== undefined) writtenText.push(typeof bytes === "string" ? bytes : decoder.decode(bytes));
      }
    }
    const event = replayAuditEvent(result, {
      mode: adapted ? "adapt" : "exact",
      writtenText,
      adaptReply: adapted?.response,
    });
    if (!event) return;
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    await CheckpointManager.getInstance().appendAuditEvent(event);
  } catch (error) {
    console.warn("[Recipes] Could not record replay metrics:", error instanceof Error ? error.message : error);
  }
}

/**
 * Apply a verified recipe with no LLM call. Conflicting drift is never applied (the caller falls
 * back to the model); clean 3-way merges are applied. Records the outcome on the recipe.
 */
export async function replayRecipe(
  host: RecipeReplayHost,
  recipeId: string,
): Promise<RecipeReplayOutput | undefined> {
  const { store, db } = await openStore();
  const recipe: Recipe | null = await store.get(recipeId);
  if (!recipe || (await outOfScope(host, recipe))) return undefined;
  const [{ replayExact, replayFailureContext }, { previewReplay }, { applyReplayResult }, { registerRecipeBlobPins }] =
    await Promise.all([
      import("core/context/memory/recipes/replayer"),
      import("core/context/memory/recipes/replayPreview"),
      import("core/context/memory/recipes/feedback"),
      import("../checkpoints/recipeBlobPins"),
    ]);
  registerRecipeBlobPins();
  const adapted = pendingAdapts.get(recipeId);
  pendingAdapts.delete(recipeId);
  const ports = await createReplayPorts(host, adapted ? { recipeId, intent: recipe.intentFingerprint } : undefined);
  const adapt = adapted ? await import("core/context/memory/recipes/adapt") : undefined;
  const preview = adapted && adapt ? await adapt.previewAdaptPlan(recipe, adapted, ports) : await previewReplay(recipe, ports);
  let result: ReplayResult;
  if (!preview.allowed) {
    result = { status: "refused", recipeId, restored: false, appliedPaths: [], driftedPaths: [], reason: preview.refusal };
  } else if (preview.conflicts.length > 0) {
    result = {
      status: "drifted",
      recipeId,
      restored: false,
      appliedPaths: [],
      driftedPaths: preview.conflicts,
      reason: `files changed since capture and cannot be merged: ${preview.conflicts.join(", ")}`,
    };
  } else {
    result =
      adapted && adapt
        ? await adapt.replayAdaptPlan(recipe, adapted, ports, { merged: preview.merged })
        : await replayExact(recipe, ports, { merged: preview.merged });
  }
  try {
    await applyReplayResult(store, result, {
      demoteMemory: async (memoryId) => {
        const { recordRecallOutcome } = await import("core/context/memory/brain/memoryOutcomes");
        await recordRecallOutcome(db, [memoryId], "reverted");
      },
    });
  } catch (error) {
    console.warn("[Recipes] Could not record replay outcome:", error instanceof Error ? error.message : error);
  }
  await recordReplayMetrics(recipe, result, ports, adapted);
  return {
    status: result.status,
    recipeId,
    checkpointId: result.checkpointId,
    restored: result.restored,
    reason: result.reason,
    appliedPaths: result.appliedPaths,
    failureContext: result.status === "applied" ? undefined : replayFailureContext(result),
  };
}
