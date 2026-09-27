import { ChatMessage } from "../index.js";

/**
 * Configuration for the context compaction system.
 */
export interface CompactionConfig {
  /** Whether compaction is enabled (default: true) */
  enabled: boolean;

  /** Maximum percentage of context window to use for history (0-1, default: 0.7) */
  maxHistoryRatio: number;

  /** Number of recent messages to always keep verbatim (default: 6) */
  preserveRecentCount: number;

  /** Minimum token count in a message to be a candidate for summarization (default: 200) */
  summarizationThreshold: number;

  /** Whether to deduplicate repeated file contents across messages (default: true) */
  deduplicateFileContents: boolean;

  /** Maximum tokens for a single summary block (default: 300) */
  maxSummaryTokens: number;

  /** Whether to use LLM for summarization (true) or heuristic (false) */
  useLlmSummarization: boolean;

  /** Max ms to wait for LLM summarization before falling back to heuristic (default: 8000) */
  llmSummarizationTimeoutMs: number;

  /** Max tokens of conversation text sent to the summarizer LLM (default: 6000) */
  llmSummarizationMaxInputTokens: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  maxHistoryRatio: 0.7,
  preserveRecentCount: 6,
  summarizationThreshold: 200,
  deduplicateFileContents: true,
  maxSummaryTokens: 300,
  useLlmSummarization: false,
  llmSummarizationTimeoutMs: 8000,
  llmSummarizationMaxInputTokens: 6000,
};

export type SummarizationMethod = "heuristic" | "llm" | "none";

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** The compacted message history */
  messages: ChatMessage[];

  /** Total tokens after compaction */
  totalTokens: number;

  /** Tokens saved by compaction */
  tokensSaved: number;

  /** Whether summarization was applied */
  summarized: boolean;

  /** Whether deduplication was applied */
  deduplicated: boolean;

  /** Number of messages before compaction */
  originalMessageCount: number;

  /** Number of messages after compaction */
  compactedMessageCount: number;

  /** Summary text when summarization ran */
  summaryText?: string;

  /** Which summarization method produced the summary */
  summarizationMethod?: SummarizationMethod;
}

/**
 * Payload sent to the GUI when compaction runs for a chat turn.
 */
export interface CompactionAppliedEvent {
  tokensSaved: number;
  originalMessageCount: number;
  compactedMessageCount: number;
  summarized: boolean;
  deduplicated: boolean;
  summarizationMethod: SummarizationMethod;
  summaryText?: string;
}

/**
 * A scored message for relevance-based pruning.
 */
export interface ScoredMessage {
  index: number;
  message: ChatMessage;
  relevanceScore: number;
  tokenCount: number;
  isProtected: boolean;
}

/**
 * Signature for a content fingerprint used in deduplication.
 */
export interface ContentFingerprint {
  hash: string;
  firstSeenIndex: number;
  tokenCount: number;
}

/**
 * Optional LLM completion callback for async compaction.
 */
export type LlmCompleteFn = (
  prompt: string,
  signal: AbortSignal,
) => Promise<string>;
