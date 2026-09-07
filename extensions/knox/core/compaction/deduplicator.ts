import { ChatMessage } from "../index.js";
import { renderChatMessage } from "../util/messageContent.js";
import { countTokens } from "../llm/countTokens.js";
import { ContentFingerprint } from "./types.js";

/**
 * Deduplicates repeated file contents and large code blocks
 * that appear verbatim across multiple messages in a conversation.
 *
 * Common scenario: the user sends a file via @file, the assistant echoes it,
 * then the user sends it again in a follow-up. The duplicate content wastes
 * context tokens.
 */

/**
 * Simple hash function for content fingerprinting.
 * Uses a fast DJB2-style hash — not cryptographic, just for dedup matching.
 */
function hashContent(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Normalize whitespace for comparison purposes.
 */
function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Extract large content blocks (code fences, file contents) from a message.
 * Returns array of { raw, normalized, start, end } for each block.
 */
function extractContentBlocks(
  text: string,
  minLength: number = 200,
): Array<{ raw: string; normalized: string; start: number; end: number }> {
  const blocks: Array<{
    raw: string;
    normalized: string;
    start: number;
    end: number;
  }> = [];

  // Match fenced code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match[0].length >= minLength) {
      blocks.push({
        raw: match[0],
        normalized: normalizeForComparison(match[0]),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Match file-content-style blocks (lines starting with line numbers or large blocks)
  // If no code blocks found but message is very large, treat whole content as a block
  if (blocks.length === 0 && text.length >= minLength * 2) {
    blocks.push({
      raw: text,
      normalized: normalizeForComparison(text),
      start: 0,
      end: text.length,
    });
  }

  return blocks;
}

/**
 * Deduplicate repeated content blocks across messages.
 *
 * Strategy:
 * - Scan messages oldest → newest, fingerprinting large content blocks
 * - When a duplicate is found in a later message, replace it with a
 *   short reference: "[Previously shown content — see above]"
 * - Only dedup exact (normalized) matches above the size threshold
 * - Never modify the system message or the last user message
 *
 * @param messages - Chat message array (will be shallow-copied)
 * @param modelName - Model name for token counting
 * @param minBlockTokens - Minimum tokens in a block to consider for dedup (default: 100)
 * @returns New message array with duplicates replaced, and tokens saved
 */
export function deduplicateMessages(
  messages: ChatMessage[],
  modelName: string,
  minBlockTokens: number = 100,
): { messages: ChatMessage[]; tokensSaved: number } {
  const fingerprints = new Map<string, ContentFingerprint>();
  const result: ChatMessage[] = messages.map((m) => ({ ...m }));
  let tokensSaved = 0;

  const lastIndex = result.length - 1;

  for (let i = 0; i < result.length; i++) {
    const msg = result[i];

    // Never touch system messages or the final message
    if (msg.role === "system" || i === lastIndex) {
      continue;
    }

    const content = renderChatMessage(msg);
    const blocks = extractContentBlocks(content);

    for (const block of blocks) {
      const blockTokens = countTokens(block.raw, modelName);
      if (blockTokens < minBlockTokens) {
        continue;
      }

      const hash = hashContent(block.normalized);

      if (fingerprints.has(hash)) {
        // Duplicate found — replace with reference
        const replacement = "[Previously shown content — see above]";
        const newContent = content.slice(0, block.start) +
          replacement +
          content.slice(block.end);

        // Only replace if it actually saves tokens
        const saved = blockTokens - countTokens(replacement, modelName);
        if (saved > 20) {
          result[i] = { ...msg, content: newContent };
          tokensSaved += saved;
        }
      } else {
        fingerprints.set(hash, {
          hash,
          firstSeenIndex: i,
          tokenCount: blockTokens,
        });
      }
    }
  }

  return { messages: result, tokensSaved };
}
