import { ChatMessage } from "../index.js";
import { countTokens } from "../llm/countTokens.js";
import { renderChatMessage } from "../util/messageContent.js";

/**
 * Token budget calculator and enforcer.
 * Determines how many tokens are available for history and
 * helps distribute the budget across messages.
 */

/**
 * Calculate the token count for a single message.
 */
export function messageTokenCount(
  message: ChatMessage,
  modelName: string,
): number {
  const TOKENS_PER_MESSAGE = 4; // role + framing overhead
  const content = renderChatMessage(message);
  return countTokens(content, modelName) + TOKENS_PER_MESSAGE;
}

/**
 * Calculate total tokens across an array of messages.
 */
export function totalMessageTokens(
  messages: ChatMessage[],
  modelName: string,
): number {
  return messages.reduce(
    (sum, msg) => sum + messageTokenCount(msg, modelName),
    0,
  );
}

/**
 * Calculate the available token budget for conversation history.
 *
 * @param contextLength - Total model context window size
 * @param maxCompletionTokens - Tokens reserved for the response
 * @param functionTokens - Tokens consumed by tool/function definitions
 * @param safetyBuffer - Extra safety margin
 * @param maxHistoryRatio - Maximum fraction of context for history (0-1)
 * @returns Available tokens for message history
 */
export function calculateHistoryBudget(
  contextLength: number,
  maxCompletionTokens: number,
  functionTokens: number,
  safetyBuffer: number,
  maxHistoryRatio: number,
): number {
  const absoluteMax = contextLength - maxCompletionTokens - functionTokens - safetyBuffer;
  const ratioBased = Math.floor(contextLength * maxHistoryRatio);
  // Use the more conservative of the two limits
  return Math.max(0, Math.min(absoluteMax, ratioBased));
}

/**
 * Check whether the current messages exceed the token budget.
 */
export function exceedsBudget(
  messages: ChatMessage[],
  modelName: string,
  budget: number,
): boolean {
  return totalMessageTokens(messages, modelName) > budget;
}

/**
 * Compute a per-message token breakdown for diagnostics / logging.
 */
export function tokenBreakdown(
  messages: ChatMessage[],
  modelName: string,
): Array<{ index: number; role: string; tokens: number }> {
  return messages.map((msg, i) => ({
    index: i,
    role: msg.role,
    tokens: messageTokenCount(msg, modelName),
  }));
}
