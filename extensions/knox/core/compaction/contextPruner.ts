import { ChatMessage } from "../index.js";
import { renderChatMessage } from "../util/messageContent.js";
import { ScoredMessage } from "./types.js";
import { messageTokenCount } from "./tokenBudget.js";
import { expandIndicesWithToolPairs } from "./toolPairs.js";
import {
  isConversationSummaryContent,
  isMemoryProtectedContent,
} from "./summarizer.js";

/**
 * Relevance-based context pruner.
 *
 * Scores each message by how relevant it is to the current conversation,
 * then prunes the lowest-scored messages first when the context budget
 * is exceeded.
 *
 * Scoring factors:
 *  - Recency (newer = higher score)
 *  - Role importance (system > last user > tool results > assistant > older user)
 *  - Content overlap with the latest user message (keyword matching)
 *  - Presence of code blocks (code-heavy messages score higher in coding context)
 *  - Tool call messages (keep tool calls + their results together)
 */

/**
 * Extract keywords from a message for relevance matching.
 * Strips common words and returns unique significant tokens.
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "because", "but", "and", "or", "if", "while", "that", "this", "it",
    "i", "you", "he", "she", "we", "they", "me", "him", "her", "us",
    "them", "my", "your", "his", "its", "our", "their", "what", "which",
    "who", "whom", "please", "also", "like", "get", "make", "know",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return new Set(words);
}

/**
 * Calculate keyword overlap between two sets.
 * Returns a 0-1 score.
 */
function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) overlap++;
  }
  return overlap / Math.min(a.size, b.size);
}

/**
 * Score all messages for relevance.
 *
 * @param messages - Full message array
 * @param modelName - Model name for token counting
 * @param preserveRecentCount - Number of recent messages to protect from pruning
 * @returns Array of scored messages
 */
export function scoreMessages(
  messages: ChatMessage[],
  modelName: string,
  preserveRecentCount: number,
): ScoredMessage[] {
  const total = messages.length;
  if (total === 0) return [];

  // Extract keywords from the last user message for relevance scoring
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user");
  const queryKeywords = lastUserMessage
    ? extractKeywords(renderChatMessage(lastUserMessage))
    : new Set<string>();

  // Build a set of tool call IDs to keep tool call/result pairs together
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.id) toolCallIds.add(tc.id);
      }
    }
  }

  return messages.map((message, index) => {
    const isRecent = index >= total - preserveRecentCount;
    const content = renderChatMessage(message);
    const isSystem = message.role === "system";
    const isProtectedSystem =
      isSystem &&
      (isMemoryProtectedContent(content) ||
        isConversationSummaryContent(content));
    const isLast = index === total - 1;

    // Protected messages are never pruned
    const isProtected = isSystem || isProtectedSystem || isLast || isRecent;

    let score = 0;

    // 1. Recency score (0 to 0.4)
    score += (index / Math.max(total - 1, 1)) * 0.4;

    // 2. Role importance (0 to 0.25)
    switch (message.role) {
      case "system":
        score += 0.25;
        break;
      case "user":
        score += isLast ? 0.25 : 0.15;
        break;
      case "assistant":
        score += message.toolCalls ? 0.2 : 0.1;
        break;
      case "tool":
        // Tool results paired with recent assistant tool calls score higher
        if ("toolCallId" in message && toolCallIds.has(message.toolCallId)) {
          score += 0.18;
        } else {
          score += 0.08;
        }
        break;
      case "thinking":
        score += 0.05;
        break;
    }

    // 3. Content relevance to current query (0 to 0.25)
    if (queryKeywords.size > 0) {
      const msgKeywords = extractKeywords(renderChatMessage(message));
      score += keywordOverlap(queryKeywords, msgKeywords) * 0.25;
    }

    // 4. Code content bonus (0 to 0.1)
    if (content.includes("```") || content.includes("function ") || content.includes("class ")) {
      score += 0.1;
    }

    return {
      index,
      message,
      relevanceScore: Math.min(1, score),
      tokenCount: messageTokenCount(message, modelName),
      isProtected,
    };
  });
}

/**
 * Prune messages based on relevance scores to fit within a token budget.
 *
 * Strategy:
 * 1. Score all messages
 * 2. Sort non-protected messages by score (ascending = least relevant first)
 * 3. Remove lowest-scored messages until within budget
 * 4. Return remaining messages in original order
 *
 * @param messages - Full message array
 * @param modelName - Model name for token counting
 * @param tokenBudget - Maximum tokens allowed
 * @param preserveRecentCount - Number of recent messages to always keep
 * @returns Pruned message array
 */
export function pruneByRelevance(
  messages: ChatMessage[],
  modelName: string,
  tokenBudget: number,
  preserveRecentCount: number,
): { messages: ChatMessage[]; tokensSaved: number } {
  const scored = scoreMessages(messages, modelName, preserveRecentCount);

  let currentTokens = scored.reduce((sum, s) => sum + s.tokenCount, 0);
  if (currentTokens <= tokenBudget) {
    return { messages: [...messages], tokensSaved: 0 };
  }

  // Sort non-protected by score ascending (remove least relevant first)
  const removable = scored
    .filter((s) => !s.isProtected)
    .sort((a, b) => a.relevanceScore - b.relevanceScore);

  const removedIndices = new Set<number>();
  let tokensSaved = 0;

  for (const item of removable) {
    if (currentTokens <= tokenBudget) break;
    if (removedIndices.has(item.index)) continue;

    const batch = expandIndicesWithToolPairs(
      messages,
      new Set([item.index]),
    );
    // Never remove protected messages via pair expansion
    for (const idx of Array.from(batch)) {
      if (scored[idx]?.isProtected) {
        batch.delete(idx);
      }
    }
    if (batch.size === 0) continue;

    for (const idx of batch) {
      if (removedIndices.has(idx)) continue;
      removedIndices.add(idx);
      const tokens = scored[idx]?.tokenCount ?? 0;
      currentTokens -= tokens;
      tokensSaved += tokens;
    }
  }

  const result = messages.filter((_, i) => !removedIndices.has(i));
  return { messages: result, tokensSaved };
}
