import type {
  NativeFinishTurnInput,
  NativeStartTurnInput,
  NativeStartTurnOutput,
} from "core/protocol/nativeAgent";
import {
  extractSoulFiles,
  formatSettledToolSummary,
} from "core/context/soul/extractToolFiles";

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
): Promise<NativeStartTurnOutput> {
  let memoryBuildTimeoutMs = DEFAULT_MEMORY_BUILD_TIMEOUT_MS;
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
  return { memoryBuildTimeoutMs };
}

/** `memory/postTurn` handler body. */
export async function runMemoryPostTurn(
  data: MemoryPostTurnInput,
  notifyMemoryChanged: () => void,
): Promise<{ success: boolean; stored: number }> {
  try {
    const { BrainManager } = await import("core/context/memory/brain/BrainManager");
    const { BrainStore } = await import("core/context/memory/brain/BrainStore");
    const { MemoryPipeline } = await import("core/context/memory/brain/MemoryPipeline");
    const sessionId = data.sessionId;
    const userMessage = data.userMessage?.trim() ?? "";
    const assistantMessage = data.assistantMessage?.trim() ?? "";
    const toolSummary = data.toolSummary?.trim() ?? "";
    const extractable = [userMessage, assistantMessage]
      .filter(Boolean)
      .join("\n\n");
    const toolLooksLikeFix =
      toolSummary.length > 0 &&
      /fix|solved|resolved|the issue was|the problem was|the solution/i.test(
        toolSummary,
      );
    await BrainStore.get();
    const minChars = BrainStore.getConfig().post_turn_min_chars ?? 80;
    if (
      (!extractable || extractable.length < minChars) &&
      !(toolLooksLikeFix && toolSummary.length >= minChars)
    ) {
      return { success: true, stored: 0 };
    }
    await BrainManager.trackSession(
      sessionId,
      data.title?.trim() || "Chat session",
      data.workspaceDir ?? "",
    );
    const pipelineResult = await MemoryPipeline.runPostTurn({
      message: assistantMessage || userMessage,
      session_id: sessionId,
      role: "assistant",
      turn_content: extractable || undefined,
      user_message: userMessage || undefined,
      assistant_message: assistantMessage || undefined,
      tool_summary: toolSummary || undefined,
    });
    const stored =
      (pipelineResult.extracted?.semantic_count ?? 0) +
      (pipelineResult.extracted?.entity_count ?? 0);
    if (extractable.length > 400) {
      await BrainManager.llmPostActionMemory(
        userMessage.substring(0, 500) || "chat turn",
        assistantMessage.substring(0, 2000) || "",
        sessionId,
      ).catch(() => {});
    }
    notifyMemoryChanged();
    return { success: true, stored };
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
): Promise<void> {
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
  const toolSummary = nativeTurnToolSummary(input.turnTools);
  if (!input.userMessage && !input.assistantMessage && !toolSummary) {
    return;
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
}
