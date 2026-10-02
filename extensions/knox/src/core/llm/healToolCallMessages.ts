import { ChatMessage, ToolCallDelta } from "../index.js";

export const MISSING_TOOL_RESULT =
  "This tool call did not produce a result. Continue with another approach.";

function toolCallIds(message: ChatMessage): string[] {
  if (message.role !== "assistant" || !message.toolCalls?.length) {
    return [];
  }
  return message.toolCalls
    .map((call) => call.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function nextToolId(name: string, index: number): string {
  const safe = (name || "tool").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32);
  return `call_heal_${index}_${safe}`;
}

/**
 * OpenAI-compatible APIs reject an assistant `tool_calls` message unless every
 * id has a following `role: tool` result. Compaction, cancel, and stream
 * errors used to drop those pairs. Fill gaps and rewrite orphan tool rows so
 * the next request cannot 400.
 *
 * When the assistant omitted ids, pair leftover results in order so we do not
 * mint new ids that no longer match the stored tool rows.
 */
export function healToolCallMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const raw = messages[i];
    if (!raw) {
      i += 1;
      continue;
    }

    if (raw.role === "assistant" && raw.toolCalls?.length) {
      i += 1;
      const skipped: ChatMessage[] = [];
      const followingTools: ChatMessage[] = [];
      while (i < messages.length) {
        const next = messages[i];
        if (!next) {
          break;
        }
        if (next.role === "tool") {
          followingTools.push(next);
          i += 1;
          continue;
        }
        if (next.role === "thinking") {
          skipped.push(next);
          i += 1;
          continue;
        }
        break;
      }

      const used = new Set<number>();
      const namedCalls = raw.toolCalls
        .map((call, index) => ({ call, index, name: call.function?.name?.trim() }))
        .filter((item): item is { call: ToolCallDelta; index: number; name: string } =>
          Boolean(item.name),
        );

      const matchedById: Array<{ callIndex: number; toolIndex: number }> = [];
      for (const item of namedCalls) {
        const existingId = item.call.id?.trim();
        if (!existingId) {
          continue;
        }
        const toolIndex = followingTools.findIndex(
          (tool, index) =>
            !used.has(index) &&
            tool.role === "tool" &&
            tool.toolCallId === existingId,
        );
        if (toolIndex >= 0) {
          used.add(toolIndex);
          matchedById.push({ callIndex: item.index, toolIndex });
        }
      }
      const byCallIndex = new Map(matchedById.map((row) => [row.callIndex, row.toolIndex]));

      const normalizedCalls: ToolCallDelta[] = [];
      const results: ChatMessage[] = [];

      for (const item of namedCalls) {
        let toolIndex = byCallIndex.get(item.index) ?? -1;
        if (toolIndex < 0 && !item.call.id?.trim()) {
          toolIndex = followingTools.findIndex(
            (tool, index) => !used.has(index) && tool.role === "tool",
          );
          if (toolIndex >= 0) {
            used.add(toolIndex);
          }
        }
        const matched = toolIndex >= 0 ? followingTools[toolIndex] : undefined;
        const id =
          item.call.id?.trim() ||
          (matched?.role === "tool" && matched.toolCallId) ||
          nextToolId(item.name, item.index);

        normalizedCalls.push({
          ...item.call,
          id,
          type: "function",
          function: {
            name: item.name,
            arguments: item.call.function?.arguments || "{}",
          },
        });
        results.push(
          matched?.role === "tool"
            ? { ...matched, toolCallId: id }
            : { role: "tool", toolCallId: id, content: MISSING_TOOL_RESULT },
        );
      }

      if (!normalizedCalls.length) {
        const { toolCalls: _dropped, ...rest } = raw;
        out.push(rest);
        out.push(...followingTools.map(toolToUser));
        out.push(...skipped);
        continue;
      }

      out.push({ ...raw, toolCalls: normalizedCalls });
      out.push(...results);
      for (const [toolIndex, tool] of followingTools.entries()) {
        if (!used.has(toolIndex)) {
          skipped.push(toolToUser(tool));
        }
      }
      out.push(...skipped);
      continue;
    }

    if (raw.role === "tool") {
      out.push(toolToUser(raw));
      i += 1;
      continue;
    }

    out.push(raw);
    i += 1;
  }
  return out;
}

function toolToUser(message: ChatMessage): ChatMessage {
  if (message.role !== "tool") {
    return message;
  }
  const id = message.toolCallId ? ` ${message.toolCallId}` : "";
  const body =
    typeof message.content === "string" ? message.content : "";
  return {
    role: "user",
    content: `[tool_result${id}]\n${body}`.trim(),
  };
}

/**
 * Drop the oldest message, keeping assistant toolCalls glued to their results.
 * Returns every removed row so prune can subtract their tokens.
 */
export function shiftChatHistoryMessage(history: ChatMessage[]): ChatMessage[] {
  if (!history.length) {
    return [];
  }
  const first = history[0];
  if (first.role === "assistant" && first.toolCalls?.length) {
    const ids = new Set(toolCallIds(first));
    const removed: ChatMessage[] = [history.shift()!];
    while (
      history[0]?.role === "tool" &&
      history[0].toolCallId &&
      ids.has(history[0].toolCallId)
    ) {
      removed.push(history.shift()!);
    }
    return removed;
  }
  const dropped = history.shift();
  return dropped ? [dropped] : [];
}
