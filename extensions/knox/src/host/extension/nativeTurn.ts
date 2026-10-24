import type {
  NativeFinishTurnInput,
  NativeStartTurnInput,
  NativeStartTurnOutput,
  RecipeCaptureOutcome,
} from "core/protocol/nativeAgent";
import {
  extractSoulFiles,
  formatSettledToolSummary,
} from "core/context/soul/extractToolFiles";

import { turnIntents } from "core/context/soul/turnIntent";

import { labelTurnCheckpoints } from "./turnLabels";
import { captureRecipeAfterTurn, decideRecipeAtTurnStart, markRecipeTurnStart } from "./recipeCapture";

export interface MemoryPostTurnInput {
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  toolSummary?: string;
  title?: string;
  workspaceDir?: string;
}

const DEFAULT_MEMORY_BUILD_TIMEOUT_MS = 5000;
const DEFAULT_TRACK_SESSION_TIMEOUT_MS = 1500;

/** `streamThunkWrapper.tsx` collectTurnToolSummary. */
export function nativeTurnToolSummary(
  tools: NativeFinishTurnInput["turnTools"],
): string {
  return formatSettledToolSummary(
    tools.map((tool) => ({
      name: tool.name,
      status: tool.status,
      files: extractSoulFiles(tool.name, tool.args),
      ok: tool.status === "done",
    })),
  );
}

/**
 * `streamResponse.ts`: read brain timeouts, await trackSession (bounded) so
 * working-memory restore finishes before buildContext, record the user turn.
 */
export async function startNativeTurn(
  input: NativeStartTurnInput,
  workspaceDir: string,
  replayHost?: import("./recipeReplay").RecipeReplayHost,
): Promise<NativeStartTurnOutput> {
  let memoryBuildTimeoutMs = DEFAULT_MEMORY_BUILD_TIMEOUT_MS;
  // MC-61: remember what was asked, so turn checkpoints record the intent.
  turnIntents.begin(input.sessionId, input.userMessage);
  try {
    const { BrainManager } = await import("core/context/memory/brain/BrainManager");
    const { BrainStore } = await import("core/context/memory/brain/BrainStore");
    await BrainStore.get();
    const config = BrainStore.getConfig() as {
      memory_build_timeout_ms?: number;
      memory_track_session_timeout_ms?: number;
    };
    if (typeof config.memory_build_timeout_ms === "number") {
      memoryBuildTimeoutMs = config.memory_build_timeout_ms;
    }
    const trackTimeout =
      typeof config.memory_track_session_timeout_ms === "number"
        ? config.memory_track_session_timeout_ms
        : DEFAULT_TRACK_SESSION_TIMEOUT_MS;
    await Promise.race([
      BrainManager.trackSession(input.sessionId, input.title, workspaceDir),
      new Promise((resolve) => setTimeout(resolve, trackTimeout)),
    ]);
    if (input.userMessage) {
      void Promise.resolve(
        BrainManager.recordMessage(input.sessionId, "user", input.userMessage),
      ).catch(() => {});
    }
  } catch {
    // Memory tracking is best-effort
  }
  // Recipes (MC-14): note where this turn's tool events begin. No-op unless enabled.
  // Awaited so capture at finishTurn can filter soul events for this turn.
  await markRecipeTurnStart(input.sessionId).catch(() => {});
  // Recipes (MC-24): pre-LLM decision. Omitted entirely when the flag is off.
  const recipe = await decideRecipeAtTurnStart(input, workspaceDir, replayHost);
  if (!recipe) return { memoryBuildTimeoutMs };
  return recipe.hint
    ? { memoryBuildTimeoutMs, recipeDecision: recipe.event, recipeHint: recipe.hint }
    : { memoryBuildTimeoutMs, recipeDecision: recipe.event };
}

/** `memory/postTurn` handler body. */
export async function runMemoryPostTurn(
  data: MemoryPostTurnInput,
  notifyMemoryChanged: () => void,
): Promise<{ success: boolean; stored: number }> {
  try {
    const { runPostTurnWrite } = await import(
      "core/context/memory/brain/postTurnWrite"
    );
    const result = await runPostTurnWrite(data);
    if (!result.skipped) {
      notifyMemoryChanged();
    }
    return { success: result.success, stored: result.stored };
  } catch (error) {
    console.warn("[Memory] Failed post-turn write:", error);
    return { success: false, stored: 0 };
  }
}

/**
 * `streamThunkWrapper.tsx` outermost exit: record the assistant turn, then
 * post-turn memory for substantial turns (the pipeline applies the threshold).
 */
export async function finishNativeTurn(
  input: NativeFinishTurnInput,
  workspaceDir: string,
  notifyMemoryChanged: () => void,
): Promise<RecipeCaptureOutcome | undefined> {
  if (input.assistantMessage) {
    try {
      const { BrainManager } = await import("core/context/memory/brain/BrainManager");
      void Promise.resolve(
        BrainManager.recordMessage(input.sessionId, "assistant", input.assistantMessage),
      ).catch(() => {});
    } catch {
      // Memory recording is best-effort
    }
  }
  // MC-60: semantic label for the checkpoints this turn created.
  void labelTurnCheckpoints(input.sessionId, input.turnTools);
  // Recipes (MC-14): silent capture of verified work. No-op unless enabled.
  // Awaited so the Recipes tab refresh sees the new row (or the skip reason).
  const captured = await captureRecipeAfterTurn(
    { sessionId: input.sessionId, userMessage: input.userMessage },
    workspaceDir,
  );
  if (captured !== undefined) {
    notifyMemoryChanged();
  }
  const toolSummary = nativeTurnToolSummary(input.turnTools);
  if (!input.userMessage && !input.assistantMessage && !toolSummary) {
    return captured;
  }
  void runMemoryPostTurn(
    {
      sessionId: input.sessionId,
      userMessage: input.userMessage,
      assistantMessage: input.assistantMessage,
      toolSummary: toolSummary || undefined,
      title: input.title,
      workspaceDir,
    },
    notifyMemoryChanged,
  );
  return captured;
}
