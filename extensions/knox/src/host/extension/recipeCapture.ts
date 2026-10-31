import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { normalizeIntent } from "core/context/soul/turnIntent";
import type { TurnFileChange } from "core/context/memory/recipes/capture";
import type { RecipeCaptureOutcome, RecipeMatchOutcome } from "core/protocol/nativeAgent";

/** Newest soul event id when each chat session's current turn started. */
const turnMarks = new Map<string, number>();
/** Workspace checkpoint current at turn start, so truncated history can still diff. */
const turnStartCheckpoints = new Map<string, string>();
/** User clicked "Don't save" before finishTurn landed. */
const refusedTurns = new Set<string>();
/** Last turn we can offer "Save as recipe" for (checkpoint + intent). */
let lastManualHint: { sessionId: string; userMessage: string; checkpointId?: string } | undefined;

/** Last capture attempt while recipes were on. Shown on the Memory Recipes tab. */
let lastCapture: RecipeCaptureOutcome | undefined;
const CAPTURE_HISTORY_CAP = 10;
let captureHistory: RecipeCaptureOutcome[] = [];

export function lastRecipeCapture(): RecipeCaptureOutcome | undefined {
  return lastCapture;
}

export function lastRecipeCaptures(): RecipeCaptureOutcome[] {
  return captureHistory.slice();
}

/** Last pre-LLM match (including near-miss / no match), for the Recipes tab. */
let lastMatch: RecipeMatchOutcome | undefined;

export function lastRecipeMatch(): RecipeMatchOutcome | undefined {
  return lastMatch;
}

function rememberMatch(event: import("core/agent/recipeDecisionTurn").RecipeDecisionEvent): RecipeMatchOutcome {
  lastMatch = {
    mode: event.mode,
    why: event.why,
    title: event.recipe?.title,
    score: event.recipe?.score,
    replayable: event.matches?.find((m) => m.id === event.recipe?.id)?.replayable ?? false,
    at: new Date().toISOString(),
  };
  void recordMatchAudit(lastMatch);
  return lastMatch;
}

function rememberCapture(outcome: Omit<RecipeCaptureOutcome, "at">): RecipeCaptureOutcome {
  lastCapture = { ...outcome, at: new Date().toISOString() };
  captureHistory = [...captureHistory, lastCapture].slice(-CAPTURE_HISTORY_CAP);
  void recordCaptureAudit(lastCapture);
  return lastCapture;
}

function recordCaptureAudit(outcome: RecipeCaptureOutcome): void {
  void (async () => {
    const { captureAuditEvent } = await import("core/context/memory/recipes/metrics");
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    await CheckpointManager.getInstance().appendAuditEvent(
      captureAuditEvent({ captured: outcome.captured, reason: outcome.reason, recipeId: outcome.recipeId }),
    );
  })().catch(() => undefined);
}

function recordMatchAudit(outcome: RecipeMatchOutcome): void {
  void (async () => {
    const { matchAuditEvent } = await import("core/context/memory/recipes/metrics");
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    await CheckpointManager.getInstance().appendAuditEvent(
      matchAuditEvent({ replayable: outcome.replayable, title: outcome.title, score: outcome.score }),
    );
  })().catch(() => undefined);
}

export function recipesEnabled(): boolean {
  return vscode.workspace.getConfiguration("knoxchat").get<boolean>("recipes.enabled", false);
}

async function latestWorkspaceCheckpointId(sessionId: string): Promise<string | undefined> {
  const { listSoulEvents } = await import("core/context/soul/recordSoulEvent");
  const events = listSoulEvents(sessionId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].workspaceCheckpointId) return events[i].workspaceCheckpointId;
  }
  try {
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    const history = CheckpointManager.getInstance().getCheckpointHistory?.() ?? [];
    const last = history[history.length - 1];
    return last && typeof last.id === "string" ? last.id : undefined;
  } catch {
    return undefined;
  }
}

/** `startNativeTurn`: remember where this turn's soul events begin. No-op when recipes are off. */
export async function markRecipeTurnStart(sessionId: string): Promise<void> {
  if (!recipesEnabled() || !sessionId) return;
  const { listSoulEvents } = await import("core/context/soul/recordSoulEvent");
  const events = listSoulEvents(sessionId);
  turnMarks.set(sessionId, events.length ? events[events.length - 1].episodicId : 0);
  const checkpointId = await latestWorkspaceCheckpointId(sessionId);
  if (checkpointId) turnStartCheckpoints.set(sessionId, checkpointId);
  else turnStartCheckpoints.delete(sessionId);
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
 * Worked example for suggest / failed exact / adapt-without-preview. Exact that already
 * applied files does not need a hint (the turn ends without a model call).
 */
async function buildHint(
  event: import("core/agent/recipeDecisionTurn").RecipeDecisionEvent,
  recipes: import("core/context/memory/recipes/types").Recipe[],
  workspaceDir?: string,
): Promise<string | undefined> {
  const [{ buildRecipeHint, buildRecipeStub }, { CheckpointManager }, { LAST_RECIPE_DECISION_MARKER, formatRecipeDecisionLoopLine }] =
    await Promise.all([
      import("core/context/memory/recipes/recipeHint"),
      import("../checkpoints/CheckpointManager"),
      import("core/compaction/loopState"),
    ]);
  const loop = formatRecipeDecisionLoopLine({
    mode: event.needsConfirmation ? "preview" : event.mode,
    title: event.recipe?.title ?? event.matches?.[0]?.title,
    id: event.recipe?.id ?? event.matches?.[0]?.id,
    why: event.why,
  });
  const loopLine = `${LAST_RECIPE_DECISION_MARKER}: ${loop}`;
  const id = event.recipe?.id ?? event.matches?.[0]?.id;
  const recipe = id ? recipes.find((r) => r.id === id) : undefined;
  if (!recipe) return loopLine;
  try {
    const { MemoryPipeline } = await import("core/context/memory/brain/MemoryPipeline");
    MemoryPipeline.noteRecipeInject(recipe, "recipe-hint");
  } catch {
    // Attribution is best-effort; the cite token still lands in the hint.
  }
  const manager = CheckpointManager.getInstance();
  const stub = buildRecipeStub(recipe, { why: event.why });
  if (event.mode === "generate") return `${loopLine}\n${stub}`;
  const root = workspaceDir ? workspaceFsPath(workspaceDir) : "";
  const full = await buildRecipeHint(recipe, (hash) => manager.readBlobBytes(hash), undefined, {
    why: event.why,
    readCurrent: root
      ? async (rel) => {
          try {
            return await fsp.readFile(path.join(root, rel), "utf8");
          } catch {
            return undefined;
          }
        }
      : undefined,
  });
  return `${loopLine}\n${stub}\n\n${full}`;
}

function slotFillContext(rawWorkspaceDir: string): {
  extra: import("core/context/memory/recipes/slots").SlotFillExtra;
  openPaths: string[];
} {
  const workspaceDir = workspaceFsPath(rawWorkspaceDir);
  const paths: string[] = [];
  const identifiers: string[] = [];
  for (const editor of vscode.window.visibleTextEditors) {
    const rel = path.relative(workspaceDir, editor.document.uri.fsPath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    paths.push(rel);
    const base = path.basename(rel, path.extname(rel));
    if (base && /^[A-Za-z0-9_@][A-Za-z0-9_@./-]*$/.test(base) && base.length <= 120) identifiers.push(base);
  }
  const active = vscode.window.activeTextEditor;
  if (active && !active.selection.isEmpty) {
    const sel = active.document.getText(active.selection).trim();
    if (sel && sel.length <= 120 && /^[A-Za-z0-9_@][A-Za-z0-9_@./-]*$/.test(sel)) identifiers.push(sel);
  }
  return { extra: { paths, identifiers }, openPaths: paths };
}

function slotValuesFromEvent(
  event: import("core/agent/recipeDecisionTurn").RecipeDecisionEvent,
): Record<string, string> | undefined {
  if (!event.slots?.length) return undefined;
  const values: Record<string, string> = {};
  for (const slot of event.slots) {
    if (slot.value) values[slot.name] = slot.value;
  }
  return Object.keys(values).length ? values : undefined;
}

/**
 * `startNativeTurn` (MC-24): decide exact / adapt / suggest / generate for this
 * message. Returns undefined when recipes are off or anything fails, so the
 * normal agent loop is never affected.
 */
export async function decideRecipeAtTurnStart(
  input: { userMessage: string; permissionMode?: "default" | "acceptEdits" | "fullAuto" },
  workspaceDir: string,
  replayHost?: import("./recipeReplay").RecipeReplayHost,
): Promise<{ event: import("core/agent/recipeDecisionTurn").RecipeDecisionEvent; hint?: string } | undefined> {
  if (!recipesEnabled() || !input.userMessage?.trim()) return undefined;
  try {
    const [{ decideRecipeForTurn }, { RecipeStore }, { get: getBrainDb }, { hashProjectId, getProjectSessionIds }, { RECIPE_CHANNEL_CANDIDATE_CAP }] =
      await Promise.all([
        import("core/agent/recipeDecisionTurn"),
        import("core/context/memory/recipes/RecipeStore"),
        import("core/context/memory/brain/store/connection"),
        import("core/context/memory/brain/projectScope"),
        import("core/context/memory/recipes/types"),
      ]);
    const projectId = hashProjectId(workspaceDir);
    const store = new RecipeStore(await getBrainDb());
    const setting = vscode.workspace.getConfiguration("knoxchat").get<string>("recipes.autoReplay", "off");
    const autoReplay =
      setting === "ask" || setting === "exact" || setting === "adapt"
        ? (setting as "ask" | "exact" | "adapt")
        : "off";
    const replay = replayHost ? await import("./recipeReplay") : undefined;
    const slotCtx = slotFillContext(workspaceDir);
    const event = await decideRecipeForTurn(
      {
        searchRecipes: async (query, fusionHits) =>
          store.searchVisibleTo(projectId, {
            query,
            status: "verified",
            memoryIds: fusionHits?.map((h) => h.memoryId),
            mentionedPaths: [...(slotCtx.openPaths ?? []), ...(slotCtx.extra.paths ?? [])],
            limit: RECIPE_CHANNEL_CANDIDATE_CAP,
          }),
        env: workspacePreconditionEnv(workspaceDir),
        fusionHits: async () => {
          try {
            const { RetrievalFusion } = await import("core/context/memory/brain/RetrievalFusion");
            const projectSessionIds = await getProjectSessionIds(undefined, workspaceDir);
            const hits = await RetrievalFusion.search({
              query: input.userMessage,
              category: "workflow",
              includeEpisodic: false,
              limit: 8,
              projectSessionIds,
              workspaceDir,
            });
            return hits
              .filter((h) => h.type === "semantic")
              .map((h) => ({ memoryId: h.id, score: h.score }));
          } catch {
            return [];
          }
        },
        previewDrift:
          replay && replayHost
            ? async (recipe) => {
                const { previewReplay, driftAction } = await import("core/context/memory/recipes/replayPreview");
                const preview = await previewReplay(recipe, await replay.createPreviewPorts(replayHost));
                return { drifted: preview.drifted, merged: driftAction(preview) === "merge" };
              }
            : undefined,
      },
      {
        message: input.userMessage,
        projectId,
        autoReplay,
        permissionMode: input.permissionMode,
        slotExtra: slotCtx.extra,
        openPaths: slotCtx.openPaths,
      },
    );
    let failureContext: string | undefined;
    if (replay && replayHost && event.compose?.recipes.length) {
      event.needsConfirmation = true;
      const parts = event.preview ? [event.preview] : [];
      const files: import("core/agent/recipeDecisionTurn").RecipeFilePrompt[] = [];
      for (const child of event.compose.recipes) {
        const previewed = await replay.previewRecipe(replayHost, child.id);
        if (previewed?.text) parts.push(`### ${child.title}\n${previewed.text}`);
        for (const entry of previewed?.entries ?? []) {
          files.push({ path: entry.path, action: entry.action, included: !entry.extra, extra: entry.extra });
        }
      }
      event.preview = parts.join("\n\n");
      event.files = files;
    } else if (replay && replayHost && event.mode === "exact" && event.recipe) {
      const slotValues = slotValuesFromEvent(event);
      if (event.needsConfirmation) {
        const previewed = await replay.previewRecipe(replayHost, event.recipe.id, slotValues);
        event.preview = [event.preview, previewed?.text].filter(Boolean).join("\n\n") || previewed?.text;
        event.files = (previewed?.entries ?? []).map((entry) => ({
          path: entry.path,
          action: entry.action,
          included: !entry.extra,
          extra: entry.extra,
        }));
      } else {
        const done = await replay.replayRecipe(replayHost, event.recipe.id, { slotValues });
        if (done) {
          event.replay = { status: done.status, appliedPaths: done.appliedPaths, reason: done.reason };
          if (done.status === "applied") {
            event.undoCheckpointId = done.checkpointId;
            event.whatIfBranch = done.whatIfBranch;
            rememberMatch(event);
            return { event };
          }
          // Did not land: fall back to the model, with the failure and the recipe as context.
          event.mode = "suggest";
          event.why = `replay ${done.status}; continuing with the model`;
          failureContext = done.failureContext;
        }
      }
    }
    const hintId = event.recipe?.id ?? event.matches?.[0]?.id;
    const hintRecipe = hintId ? await store.get(hintId) : null;
    if (replay && replayHost && event.mode === "adapt" && event.recipe && !event.compose) {
      // MC-32: one model call plans the change; the user always sees the diff before anything is written.
      const recipe = hintRecipe?.id === event.recipe.id ? hintRecipe : await store.get(event.recipe.id);
      const planned = recipe ? await replay.planAdaptedRecipe(replayHost, recipe, input.userMessage).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e) })) : undefined;
      if (planned?.ok) {
        event.needsConfirmation = true;
        event.preview = [event.preview, planned.preview].filter(Boolean).join("\n\n");
        event.files = planned.files;
      } else if (planned) {
        event.mode = "suggest";
        event.why = `could not adapt the recipe (${planned.reason}); using it as a hint`;
      }
    }
    rememberMatch(event);
    const hint = await buildHint(event, hintRecipe ? [hintRecipe] : [], workspaceDir);
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
    const binary = a.encoding === "base64" || Boolean(a.content?.includes("\0"));
    const text = binary || a.encoding === "base64" ? "" : a.content;
    changes.push({
      path,
      hash: a.hash,
      baseHash: b?.hash,
      hasSecret: text ? containsSecret(text) : false,
      content: text || undefined,
      binary,
      byteLength: text ? Buffer.byteLength(text) : a.encoding === "base64" ? 1 : undefined,
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
  input: {
    sessionId: string;
    userMessage: string;
    turnTools?: Array<{ name: string; status: string; args?: unknown }>;
    allowCommandRecipes?: boolean;
    includePaths?: string[];
  },
  workspaceDir: string,
): Promise<RecipeCaptureOutcome | undefined> {
  if (!recipesEnabled()) return undefined;
  if (!input.sessionId) return rememberCapture({ captured: false, reason: "no_session" });
  if (refusedTurns.has(input.sessionId)) {
    refusedTurns.delete(input.sessionId);
    turnMarks.delete(input.sessionId);
    turnStartCheckpoints.delete(input.sessionId);
    return rememberCapture({ captured: false, reason: "user_refused" });
  }
  const mark = turnMarks.get(input.sessionId);
  const turnStartCheckpointId = turnStartCheckpoints.get(input.sessionId);
  turnMarks.delete(input.sessionId);
  turnStartCheckpoints.delete(input.sessionId);
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
    const verifyCommand = vscode.workspace.getConfiguration("knoxchat").get<string>("verifyCommand", "")?.trim();
    const allowCommandRecipes = input.allowCommandRecipes === true;

    // Pins first, so the blobs behind the recipe are protected from the moment it exists.
    registerRecipeBlobPins();

    const events = listSoulEvents(input.sessionId).map((e) => ({
      episodicId: e.episodicId,
      kind: e.kind,
      toolName: e.toolName,
      files: e.files,
      workspaceCheckpointId: e.workspaceCheckpointId,
      oracle: e.oracle,
      summary: e.summary,
      command: typeof e.metadata?.command === "string" ? e.metadata.command : undefined,
    }));
    const { BrainStore } = await import("core/context/memory/brain/BrainStore");
    const result = await captureRecipeFromTurn(
      {
        store: new RecipeStore(await getBrainDb()),
        storeMemory: (memory) => BrainManager.store(memory),
        memoryExists: async (id) => (await BrainStore.getSemanticById(id)) != null,
        env: workspacePreconditionEnv(workspaceDir),
        readBlob: (hash) => CheckpointManager.getInstance().readBlobBytes(hash),
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
        turnStartCheckpointId,
        turnTools: input.turnTools,
        allowCommandRecipes,
        includePaths: input.includePaths,
        verifyCommand,
      },
    );
    lastManualHint = {
      sessionId: input.sessionId,
      userMessage: input.userMessage,
      checkpointId: result.captured ? result.recipe.sourceCheckpointIds[0] : turnStartCheckpointId,
    };
    if (result.captured) {
      console.info(
        `[Recipes] ${result.created ? "Captured" : "Already had"} candidate ${result.recipe.id.slice(0, 8)} (${result.recipe.steps.length} steps)`,
      );
      return rememberCapture({
        captured: true,
        created: result.created,
        recipeId: result.recipe.id,
        title: result.recipe.title,
        status: result.recipe.status,
      });
    }
    console.info(`[Recipes] Not captured: ${result.reason}`);
    return rememberCapture({ captured: false, reason: result.reason });
  } catch (error) {
    console.warn("[Recipes] Capture failed:", error instanceof Error ? error.message : error);
    return rememberCapture({ captured: false, reason: "error" });
  }
}

async function previousCheckpointId(checkpointId: string): Promise<string | undefined> {
  const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
  const history = CheckpointManager.getInstance().getCheckpointHistory();
  const idx = history.findIndex((cp) => cp.id === checkpointId);
  if (idx > 0) return history[idx - 1]?.id;
  return undefined;
}

/**
 * P3.4: save a recipe from a checkpoint / selected files. Still requires an
 * oracle or explicit user accept.
 */
export async function saveRecipeManually(
  workspaceDir: string,
  input: {
    intent?: string;
    checkpointId?: string;
    paths?: string[];
    userAccepted?: boolean;
    sessionId?: string;
  },
): Promise<RecipeCaptureOutcome> {
  if (!recipesEnabled()) return rememberCapture({ captured: false, reason: "disabled" });
  const intent = (input.intent ?? lastManualHint?.userMessage ?? "").trim();
  if (!intent) return rememberCapture({ captured: false, reason: "no_intent" });
  const sessionId = input.sessionId || lastManualHint?.sessionId || "manual";
  const checkpointId = input.checkpointId || lastManualHint?.checkpointId;
  if (!checkpointId) return rememberCapture({ captured: false, reason: "no_checkpoint" });
  const baseId = await previousCheckpointId(checkpointId);
  if (!baseId || baseId === checkpointId) return rememberCapture({ captured: false, reason: "no_changes" });
  try {
    const [{ captureRecipeFromTurn }, { RecipeStore }, { get: getBrainDb }, { hashProjectId }, { containsSecret }] =
      await Promise.all([
        import("core/context/memory/recipes/capture"),
        import("core/context/memory/recipes/RecipeStore"),
        import("core/context/memory/brain/store/connection"),
        import("core/context/memory/brain/projectScope"),
        import("core/util/redactSecrets"),
      ]);
    const { BrainManager } = await import("core/context/memory/brain/BrainManager");
    const { BrainStore } = await import("core/context/memory/brain/BrainStore");
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    const { registerRecipeBlobPins } = await import("../checkpoints/recipeBlobPins");
    registerRecipeBlobPins();
    const manager = CheckpointManager.getInstance();
    const [before, after] = await Promise.all([
      manager.reconstructStateAtCheckpoint(baseId),
      manager.reconstructStateAtCheckpoint(checkpointId),
    ]);
    if (!before || !after) return rememberCapture({ captured: false, reason: "no_changes" });
    const changes = diffCheckpointStates(before, after, containsSecret);
    if (!changes) return rememberCapture({ captured: false, reason: "no_changes" });
    const oracle = input.userAccepted
      ? { kind: "user" as const, passed: true }
      : undefined;
    if (!oracle) return rememberCapture({ captured: false, reason: "no_oracle" });
    const verifyCommand = vscode.workspace.getConfiguration("knoxchat").get<string>("verifyCommand", "")?.trim();
    const result = await captureRecipeFromTurn(
      {
        store: new RecipeStore(await getBrainDb()),
        storeMemory: (memory) => BrainManager.store(memory),
        memoryExists: async (id) => (await BrainStore.getSemanticById(id)) != null,
        env: workspacePreconditionEnv(workspaceDir),
        readBlob: (hash) => manager.readBlobBytes(hash),
        async diffAgainst() {
          return { afterCheckpointId: checkpointId, changes };
        },
      },
      {
        events: [
          {
            episodicId: 1,
            kind: "tool_success",
            toolName: "builtin_edit_file",
            files: changes.map((c) => c.path),
            workspaceCheckpointId: baseId,
            oracle: verifyCommand ? { ...oracle, command: verifyCommand } : oracle,
          },
        ],
        markEpisodicId: 0,
        sessionId,
        projectId: hashProjectId(workspaceDir),
        userMessage: intent,
        turnStartCheckpointId: baseId,
        allowCommandRecipes: true,
        includePaths: input.paths,
        verifyCommand,
      },
    );
    if (result.captured) {
      if (input.userAccepted) {
        const { acceptRecipe } = await import("core/context/memory/recipes/promotion");
        await acceptRecipe(new RecipeStore(await getBrainDb()), result.recipe.id).catch(() => undefined);
      }
      const stored = (await new RecipeStore(await getBrainDb()).get(result.recipe.id)) ?? result.recipe;
      return rememberCapture({
        captured: true,
        created: result.created,
        recipeId: stored.id,
        title: stored.title,
        status: stored.status,
      });
    }
    return rememberCapture({ captured: false, reason: result.reason });
  } catch (error) {
    console.warn("[Recipes] Manual save failed:", error instanceof Error ? error.message : error);
    return rememberCapture({ captured: false, reason: "error" });
  }
}

/** P3.5: don't remember the last captured recipe, or skip the in-flight turn. */
export async function refuseLastRecipe(workspaceDir: string, sessionId?: string): Promise<RecipeCaptureOutcome> {
  if (sessionId) refusedTurns.add(sessionId);
  const last = lastRecipeCapture();
  if (last?.captured && last.recipeId) {
    try {
      const { setRecipeStatus } = await import("./recipeList");
      await setRecipeStatus(workspaceDir, last.recipeId, "retired");
    } catch {
      // retiring is best-effort; the skip reason is still recorded
    }
    void import("./recipeFeedback")
      .then(({ recordRecipeNotThis }) => recordRecipeNotThis(last.recipeId, last.title))
      .catch(() => undefined);
  }
  return rememberCapture({ captured: false, reason: "user_refused" });
}
