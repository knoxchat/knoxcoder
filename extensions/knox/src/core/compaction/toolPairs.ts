import { ChatMessage } from "../index.js";

/**
 * Helpers to keep assistant toolCalls ↔ tool result messages atomic
 * during compaction (summarize / prune).
 */

function toolCallIdsFromMessage(message: ChatMessage): string[] {
  if (message.role !== "assistant" || !message.toolCalls?.length) return [];
  return message.toolCalls
    .map((tc) => tc.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function toolResultId(message: ChatMessage): string | undefined {
  return message.role === "tool" ? message.toolCallId : undefined;
}

/**
 * Move a summarize/prune boundary so it never splits a tool-call pair.
 *
 * Messages at indices `[0, boundary)` are treated as "old" (summarizable);
 * `[boundary, length)` are "recent" (kept verbatim).
 *
 * Rules:
 * 1. If the first recent message is a tool result, pull the boundary back to
 *    include its assistant tool-call message in recent.
 * 2. If the last old message is an assistant with toolCalls whose results
 *    start at `boundary`, pull the assistant into recent as well.
 */
export function adjustBoundaryForToolPairs(
  messages: ChatMessage[],
  boundary: number,
): number {
  if (boundary <= 0 || boundary >= messages.length) return boundary;

  let b = boundary;

  // Rule 1: tool result at boundary → include its assistant call in recent
  while (b > 0 && messages[b]?.role === "tool") {
    const toolCallId = toolResultId(messages[b]);
    if (!toolCallId) break;

    let found = -1;
    for (let i = b - 1; i >= 0; i--) {
      if (toolCallIdsFromMessage(messages[i]).includes(toolCallId)) {
        found = i;
        break;
      }
      if (messages[i].role === "user") break;
    }
    if (found < 0) break;
    b = found;
  }

  // Rule 2: assistant with toolCalls just before boundary, results after →
  // keep the whole pair in recent
  if (b > 0 && b < messages.length) {
    const prev = messages[b - 1];
    const ids = new Set(toolCallIdsFromMessage(prev));
    const nextId = toolResultId(messages[b]);
    if (ids.size > 0 && nextId && ids.has(nextId)) {
      b = b - 1;
    }
  }

  return Math.max(0, Math.min(messages.length, b));
}

/**
 * Expand a set of indices to include complete tool-call pairs.
 * Used when pruning so we never leave an orphan tool result or call.
 */
export function expandIndicesWithToolPairs(
  messages: ChatMessage[],
  indices: Set<number>,
): Set<number> {
  const expanded = new Set(indices);
  let changed = true;

  while (changed) {
    changed = false;
    for (const index of Array.from(expanded)) {
      const msg = messages[index];
      if (!msg) continue;

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const ids = new Set(toolCallIdsFromMessage(msg));
        for (let j = index + 1; j < messages.length; j++) {
          const nextId = toolResultId(messages[j]);
          if (!nextId) break;
          if (ids.has(nextId) && !expanded.has(j)) {
            expanded.add(j);
            changed = true;
          }
        }
      }

      const resultId = toolResultId(msg);
      if (resultId) {
        for (let i = index - 1; i >= 0; i--) {
          if (toolCallIdsFromMessage(messages[i]).includes(resultId)) {
            if (!expanded.has(i)) {
              expanded.add(i);
              changed = true;
            }
            break;
          }
          if (messages[i].role === "user") break;
        }
      }
    }
  }

  return expanded;
}
