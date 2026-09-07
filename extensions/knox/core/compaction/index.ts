import { ChatMessage } from "../index.js";
import { countTokens } from "../llm/countTokens.js";
import { renderChatMessage } from "../util/messageContent.js";

import {
  CompactionConfig,
  CompactionResult,
  DEFAULT_COMPACTION_CONFIG,
  LlmCompleteFn,
  SummarizationMethod,
} from "./types.js";
import {
  calculateHistoryBudget,
  messageTokenCount,
  totalMessageTokens,
} from "./tokenBudget.js";
import { deduplicateMessages } from "./deduplicator.js";
import {
  buildConversationSummary,
  heuristicSummarize,
  isConversationSummaryContent,
  isMemoryProtectedContent,
  llmSummarizeConversation,
} from "./summarizer.js";
import { pruneByRelevance } from "./contextPruner.js";
import { adjustBoundaryForToolPairs } from "./toolPairs.js";
import {
  extractDevelopmentLoopState,
  formatDevelopmentLoopState,
  upsertDevelopmentLoopStateMessage,
} from "./loopState.js";

export type {
  CompactionConfig,
  CompactionResult,
  CompactionAppliedEvent,
  LlmCompleteFn,
  SummarizationMethod,
} from "./types.js";
export { DEFAULT_COMPACTION_CONFIG } from "./types.js";
export {
  calculateHistoryBudget,
  totalMessageTokens,
  messageTokenCount,
} from "./tokenBudget.js";
export { deduplicateMessages } from "./deduplicator.js";
export {
  heuristicSummarize,
  buildConversationSummary,
  llmSummarizeConversation,
  CONVERSATION_SUMMARY_MARKER,
  isMemoryProtectedContent,
  isConversationSummaryContent,
} from "./summarizer.js";
export { pruneByRelevance, scoreMessages } from "./contextPruner.js";
export {
  adjustBoundaryForToolPairs,
  expandIndicesWithToolPairs,
} from "./toolPairs.js";
export {
  DEVELOPMENT_LOOP_STATE_MARKER,
  LAST_BUILD_ERRORS_MARKER,
  extractDevelopmentLoopState,
  formatDevelopmentLoopState,
} from "./loopState.js";

function protectLoopState(
  original: ChatMessage[],
  working: ChatMessage[],
): ChatMessage[] {
  const text = formatDevelopmentLoopState(
    extractDevelopmentLoopState(original),
  );
  if (!text) {
    return working;
  }
  return upsertDevelopmentLoopStateMessage(working, text);
}

function extractProtectedSystemMessages(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages.filter((m) => {
    if (m.role !== "system") return false;
    const text = renderChatMessage(m);
    return (
      isMemoryProtectedContent(text) || isConversationSummaryContent(text)
    );
  });
}

function alreadyHasConversationSummary(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "system" &&
      isConversationSummaryContent(renderChatMessage(m)),
  );
}

function buildSummarizedHistory(
  current: ChatMessage[],
  recentMessages: ChatMessage[],
  summaryText: string,
): ChatMessage[] {
  const summaryMessage: ChatMessage = {
    role: "system",
    content: summaryText,
  };

  // Keep default system + memory/plan injects; drop prior conversation summaries
  // (replaced by the new one).
  const protectedSystems = extractProtectedSystemMessages(current).filter(
    (m) => !isConversationSummaryContent(renderChatMessage(m)),
  );

  // Also keep any non-protected system message (e.g. default rules) that sits
  // in the recent window or at the head of the conversation.
  const defaultSystem = current.find((m) => {
    if (m.role !== "system") return false;
    const text = renderChatMessage(m);
    return (
      !isMemoryProtectedContent(text) && !isConversationSummaryContent(text)
    );
  });

  const head: ChatMessage[] = [];
  if (defaultSystem) head.push(defaultSystem);
  for (const m of protectedSystems) {
    if (!head.includes(m)) head.push(m);
  }
  head.push(summaryMessage);

  // Drop duplicate system messages from the recent slice
  const recent = recentMessages.filter((m) => {
    if (m.role !== "system") return true;
    return !head.some(
      (h) =>
        h.role === "system" &&
        renderChatMessage(h) === renderChatMessage(m),
    );
  });

  return [...head, ...recent];
}

function emptyResult(messages: ChatMessage[], modelName: string): CompactionResult {
  return {
    messages: [...messages],
    totalTokens: totalMessageTokens(messages, modelName),
    tokensSaved: 0,
    summarized: false,
    deduplicated: false,
    originalMessageCount: messages.length,
    compactedMessageCount: messages.length,
    summarizationMethod: "none",
  };
}

/**
 * Apply stages 3–4 (relevance prune + aggressive truncation) when still over budget.
 */
function finishOverBudget(
  current: ChatMessage[],
  modelName: string,
  budget: number,
  cfg: CompactionConfig,
  totalSaved: number,
  didSummarize: boolean,
  didDedup: boolean,
  originalCount: number,
  summaryText: string | undefined,
  summarizationMethod: SummarizationMethod,
): CompactionResult {
  let working = current;
  let saved = totalSaved;

  const pruneResult = pruneByRelevance(
    working,
    modelName,
    budget,
    Math.min(cfg.preserveRecentCount, 4),
  );

  if (pruneResult.tokensSaved > 0) {
    working = pruneResult.messages;
    saved += pruneResult.tokensSaved;
  }

  let currentTokens = totalMessageTokens(working, modelName);
  if (currentTokens > budget && working.length > 2) {
    for (let i = 0; i < working.length - 1; i++) {
      if (working[i].role === "system") continue;
      const text = renderChatMessage(working[i]);
      if (isMemoryProtectedContent(text) || isConversationSummaryContent(text)) {
        continue;
      }

      const msgTokens = messageTokenCount(working[i], modelName);
      if (msgTokens > cfg.summarizationThreshold) {
        const summary = heuristicSummarize(working[i], 200);
        const savedTokens = msgTokens - countTokens(summary, modelName) - 4;
        if (savedTokens > 20) {
          working[i] = { ...working[i], content: summary };
          saved += savedTokens;
          currentTokens -= savedTokens;
        }
      }

      if (currentTokens <= budget) break;
    }
  }

  currentTokens = totalMessageTokens(working, modelName);

  return {
    messages: working,
    totalTokens: currentTokens,
    tokensSaved: saved,
    summarized: didSummarize,
    deduplicated: didDedup,
    originalMessageCount: originalCount,
    compactedMessageCount: working.length,
    summaryText,
    summarizationMethod,
  };
}

/**
 * Main context compaction pipeline (synchronous / heuristic).
 *
 * Runs a multi-stage compaction on the message history:
 *
 * Stage 1: Deduplication — remove repeated file contents
 * Stage 2: Summarization — compress old messages into summaries
 * Stage 3: Relevance pruning — remove least-relevant messages
 * Stage 4: Final pruning — if still over budget, aggressive truncation
 *
 * The pipeline preserves:
 * - System messages (always) and pinned memory / plan injects
 * - The last N messages (configurable via preserveRecentCount)
 * - Tool call ↔ tool result pairs
 */
export function compactMessages(
  messages: ChatMessage[],
  modelName: string,
  contextLength: number,
  maxCompletionTokens: number,
  functionTokens: number = 0,
  safetyBuffer: number = 350,
  config: Partial<CompactionConfig> = {},
): CompactionResult {
  const cfg: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...config };

  if (!cfg.enabled || messages.length === 0) {
    return emptyResult(messages, modelName);
  }

  const budget = calculateHistoryBudget(
    contextLength,
    maxCompletionTokens,
    functionTokens,
    safetyBuffer,
    cfg.maxHistoryRatio,
  );

  let current = messages.map((m) => ({ ...m }));
  let totalSaved = 0;
  let didSummarize = false;
  let didDedup = false;
  let summaryText: string | undefined;
  let summarizationMethod: SummarizationMethod = "none";
  const originalCount = messages.length;

  // --- Stage 1: Deduplication ---
  if (cfg.deduplicateFileContents) {
    const dedupResult = deduplicateMessages(current, modelName);
    if (dedupResult.tokensSaved > 0) {
      current = dedupResult.messages;
      totalSaved += dedupResult.tokensSaved;
      didDedup = true;
    }
  }

  let currentTokens = totalMessageTokens(current, modelName);
  if (currentTokens <= budget) {
    return {
      messages: current,
      totalTokens: currentTokens,
      tokensSaved: totalSaved,
      summarized: didSummarize,
      deduplicated: didDedup,
      originalMessageCount: originalCount,
      compactedMessageCount: current.length,
      summarizationMethod,
    };
  }

  // Pin compile/plan/job facts before old tool logs are folded away (HL-16).
  current = protectLoopState(messages, current);

  // --- Stage 2: Summarize old messages (heuristic) ---
  // Skip if a prior pass already inserted a conversation summary.
  if (!alreadyHasConversationSummary(current)) {
    const preserveCount = Math.min(cfg.preserveRecentCount, current.length);
    let boundary = current.length - preserveCount;
    boundary = adjustBoundaryForToolPairs(current, boundary);
    const oldCount = boundary;

    if (oldCount > 2) {
      const oldMessages = current.slice(0, oldCount);
      const recentMessages = current.slice(oldCount);

      const text = buildConversationSummary(
        oldMessages,
        cfg.maxSummaryTokens * 4,
      );

      const summaryMessage: ChatMessage = {
        role: "system",
        content: text,
      };

      const oldTokens = oldMessages.reduce(
        (sum, m) => sum + messageTokenCount(m, modelName),
        0,
      );
      const summaryTokens = messageTokenCount(summaryMessage, modelName);
      const saved = oldTokens - summaryTokens;

      if (saved > 0) {
        current = buildSummarizedHistory(current, recentMessages, text);
        current = protectLoopState(messages, current);
        totalSaved += saved;
        didSummarize = true;
        summaryText = text;
        summarizationMethod = "heuristic";
      }
    }
  }

  currentTokens = totalMessageTokens(current, modelName);
  if (currentTokens <= budget) {
    return {
      messages: current,
      totalTokens: currentTokens,
      tokensSaved: totalSaved,
      summarized: didSummarize,
      deduplicated: didDedup,
      originalMessageCount: originalCount,
      compactedMessageCount: current.length,
      summaryText,
      summarizationMethod,
    };
  }

  return finishOverBudget(
    current,
    modelName,
    budget,
    cfg,
    totalSaved,
    didSummarize,
    didDedup,
    originalCount,
    summaryText,
    summarizationMethod,
  );
}

/**
 * Async compaction pipeline with optional LLM summarization.
 *
 * When `useLlmSummarization` is true and `llmComplete` is provided, Stage 2
 * uses the LLM (with latency/input budget caps) and falls back to the
 * heuristic summarizer on timeout or failure.
 */
export async function compactMessagesAsync(
  messages: ChatMessage[],
  modelName: string,
  contextLength: number,
  maxCompletionTokens: number,
  functionTokens: number = 0,
  safetyBuffer: number = 350,
  config: Partial<CompactionConfig> = {},
  llmComplete?: LlmCompleteFn,
): Promise<CompactionResult> {
  const cfg: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...config };

  if (!cfg.enabled || messages.length === 0) {
    return emptyResult(messages, modelName);
  }

  // If LLM summarization is not requested or no completer, use sync path.
  if (!cfg.useLlmSummarization || !llmComplete) {
    return compactMessages(
      messages,
      modelName,
      contextLength,
      maxCompletionTokens,
      functionTokens,
      safetyBuffer,
      cfg,
    );
  }

  const budget = calculateHistoryBudget(
    contextLength,
    maxCompletionTokens,
    functionTokens,
    safetyBuffer,
    cfg.maxHistoryRatio,
  );

  let current = messages.map((m) => ({ ...m }));
  let totalSaved = 0;
  let didSummarize = false;
  let didDedup = false;
  let summaryText: string | undefined;
  let summarizationMethod: SummarizationMethod = "none";
  const originalCount = messages.length;

  if (cfg.deduplicateFileContents) {
    const dedupResult = deduplicateMessages(current, modelName);
    if (dedupResult.tokensSaved > 0) {
      current = dedupResult.messages;
      totalSaved += dedupResult.tokensSaved;
      didDedup = true;
    }
  }

  let currentTokens = totalMessageTokens(current, modelName);
  if (currentTokens <= budget) {
    return {
      messages: current,
      totalTokens: currentTokens,
      tokensSaved: totalSaved,
      summarized: false,
      deduplicated: didDedup,
      originalMessageCount: originalCount,
      compactedMessageCount: current.length,
      summarizationMethod: "none",
    };
  }

  current = protectLoopState(messages, current);

  if (!alreadyHasConversationSummary(current)) {
    const preserveCount = Math.min(cfg.preserveRecentCount, current.length);
    let boundary = current.length - preserveCount;
    boundary = adjustBoundaryForToolPairs(current, boundary);
    const oldCount = boundary;

    if (oldCount > 2) {
      const oldMessages = current.slice(0, oldCount);
      const recentMessages = current.slice(oldCount);

      let text =
        (await llmSummarizeConversation(oldMessages, {
          complete: llmComplete,
          modelName,
          maxSummaryTokens: cfg.maxSummaryTokens,
          maxInputTokens: cfg.llmSummarizationMaxInputTokens,
          timeoutMs: cfg.llmSummarizationTimeoutMs,
        })) ?? null;

      if (text) {
        summarizationMethod = "llm";
      } else {
        text = buildConversationSummary(
          oldMessages,
          cfg.maxSummaryTokens * 4,
        );
        summarizationMethod = "heuristic";
      }

      const summaryMessage: ChatMessage = {
        role: "system",
        content: text,
      };
      const oldTokens = oldMessages.reduce(
        (sum, m) => sum + messageTokenCount(m, modelName),
        0,
      );
      const summaryTokens = messageTokenCount(summaryMessage, modelName);
      const saved = oldTokens - summaryTokens;

      if (saved > 0) {
        current = buildSummarizedHistory(current, recentMessages, text);
        current = protectLoopState(messages, current);
        totalSaved += saved;
        didSummarize = true;
        summaryText = text;
      } else {
        summarizationMethod = "none";
      }
    }
  }

  currentTokens = totalMessageTokens(current, modelName);
  if (currentTokens <= budget) {
    return {
      messages: current,
      totalTokens: currentTokens,
      tokensSaved: totalSaved,
      summarized: didSummarize,
      deduplicated: didDedup,
      originalMessageCount: originalCount,
      compactedMessageCount: current.length,
      summaryText,
      summarizationMethod,
    };
  }

  return finishOverBudget(
    current,
    modelName,
    budget,
    cfg,
    totalSaved,
    didSummarize,
    didDedup,
    originalCount,
    summaryText,
    summarizationMethod,
  );
}
