/**
 * T1 post-turn write: LLM is the primary extractor when available;
 * heuristic AutoMemory runs only when the LLM stored nothing.
 * Both writers go through storeSemanticDeduped if they run.
 */
import { AutoMemory } from "./AutoMemory.js";
import { MemoryPipeline } from "./MemoryPipeline.js";

export interface PostTurnWriteInput {
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  toolSummary?: string;
  title?: string;
  workspaceDir?: string;
}

export interface PostTurnWriteResult {
  success: boolean;
  stored: number;
  skipped: boolean;
  llm_used: boolean;
  heuristic_used: boolean;
}

function emptyWriteResult(skipped: boolean): PostTurnWriteResult {
  return { success: true, stored: 0, skipped, llm_used: false, heuristic_used: false };
}

export async function runPostTurnWrite(
  data: PostTurnWriteInput,
): Promise<PostTurnWriteResult> {
  const { BrainManager } = await import("./BrainManager.js");
  const { BrainStore } = await import("./BrainStore.js");

  const userMessage = data.userMessage?.trim() ?? "";
  const assistantMessage = data.assistantMessage?.trim() ?? "";
  const toolSummary = data.toolSummary?.trim() ?? "";
  const extractable = [userMessage, assistantMessage].filter(Boolean).join("\n\n");

  await BrainStore.get();
  const minChars = BrainStore.getConfig().post_turn_min_chars ?? 80;
  if (
    AutoMemory.shouldSkipPostTurnExtract({
      userMessage,
      assistantMessage,
      toolSummary,
      minChars,
    })
  ) {
    return emptyWriteResult(true);
  }

  await BrainManager.trackSession(
    data.sessionId,
    data.title?.trim() || "Chat session",
    data.workspaceDir ?? "",
  );

  const llmResult = await BrainManager.llmPostActionMemory(
    userMessage.substring(0, 500) || "chat turn",
    [assistantMessage, toolSummary].filter(Boolean).join("\n").substring(0, 2000),
    data.sessionId,
  ).catch(() => ({
    memories_created: 0,
    entities_created: 0,
    patterns_recorded: 0,
    llm_used: false,
  }));

  const llmStored = llmResult.memories_created ?? 0;
  if (llmStored > 0) {
    return {
      success: true,
      stored: llmStored,
      skipped: false,
      llm_used: Boolean(llmResult.llm_used),
      heuristic_used: false,
    };
  }

  const pipelineResult = await MemoryPipeline.runPostTurn({
    message: assistantMessage || userMessage,
    session_id: data.sessionId,
    role: "assistant",
    turn_content: extractable || undefined,
    user_message: userMessage || undefined,
    assistant_message: assistantMessage || undefined,
    tool_summary: toolSummary || undefined,
  });

  const heuristicStored =
    (pipelineResult.extracted?.semantic_count ?? 0) +
    (pipelineResult.extracted?.entity_count ?? 0);

  return {
    success: true,
    stored: heuristicStored,
    skipped: false,
    llm_used: Boolean(llmResult.llm_used),
    heuristic_used: true,
  };
}
