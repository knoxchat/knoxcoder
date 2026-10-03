import { ChatHistoryItem, ChatMessage, MessagePart } from "../";
import { normalizeToMessageParts } from "../util/messageContent";
import { hydrateAssistantTextToolCalls, looksLikeTextToolCall } from "./parseTextToolCalls";
import { formatPlanInject, formatPlanInjectFromHistory } from "../tools/planStore";
import { formatCodebaseCardInject } from "../context/codebaseCard";
import { formatRustPolicyInject } from "../context/rustPolicy";
import { formatSerialContextInject } from "../context/serialContext";
import { buildSystemPrompt, type SystemPromptOptions } from "./systemPrompt";

/**
 * Chat history → model messages.
 *
 * Merge order with the rest of the stack (see `core/config/rules.ts`):
 * 1) The default system prompt (`systemPrompt.ts`)
 * 2) GUI per-turn inject (memory) merged into the leading system msg
 * 3) Config / `.knoxrules` via `LLM.systemMessage` in `compileChatMessages`
 * 4) Optional suggested-skills hint in `llmStreamChat`
 * 5) Slash prompt `<system>` only when that command runs
 */

const CANCELED_TOOL_CALL_MESSAGE =
  "This tool call was cancelled by the user. You should clarify next steps, as they don't wish for you to use this tool.";

function historyToolStates(item: ChatHistoryItem) {
  if (item.toolCallStates?.length) {
    return item.toolCallStates;
  }
  return item.toolCallState ? [item.toolCallState] : [];
}

function isFullyCanceledToolTurn(item: ChatHistoryItem): boolean {
  const states = historyToolStates(item);
  return states.length > 0 && states.every((state) => state.status === "canceled");
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
  }
  return "";
}

/** Strip leaked DSML/XML tool markup so it is not replayed to the model. */
function sanitizeAssistantMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant") {
    return message;
  }
  const text = messageText(message);
  if (!looksLikeTextToolCall(text) && !message.toolCalls?.length) {
    return message;
  }
  const { content, toolCalls } = hydrateAssistantTextToolCalls(
    text,
    message.toolCalls ?? [],
  );
  if (content === text && toolCalls === message.toolCalls) {
    return message;
  }
  const next: ChatMessage = {
    ...message,
    content,
  };
  if (toolCalls.length) {
    next.toolCalls = toolCalls;
  } else {
    delete (next as { toolCalls?: unknown }).toolCalls;
  }
  return next;
}

export function constructMessages(
  history: ChatHistoryItem[],
  sessionId?: string | null,
  promptOptions?: SystemPromptOptions,
): ChatMessage[] {
  const filteredHistory = history.filter(
    (item) => item.message.role !== "system",
  );
  const msgs: ChatMessage[] = [];

  msgs.push({
    role: "system",
    content: buildSystemPrompt(promptOptions),
  });

  // Prompt-cache friendly order: stable blocks first (byte-identical across turns),
  // volatile blocks (plan, serial tail) last so they never invalidate the prefix.
  const codebaseCard = formatCodebaseCardInject();
  if (codebaseCard) {
    msgs.push({
      role: "system",
      content: codebaseCard,
    });
  }

  const rustPolicy = formatRustPolicyInject();
  if (rustPolicy) {
    msgs.push({
      role: "system",
      content: rustPolicy,
    });
  }

  const plan =
    formatPlanInject(sessionId) || formatPlanInjectFromHistory(filteredHistory);
  if (plan) {
    msgs.push({
      role: "system",
      content: plan,
    });
  }

  const serial = formatSerialContextInject();
  if (serial) {
    msgs.push({
      role: "system",
      content: serial,
    });
  }

  for (let i = 0; i < filteredHistory.length; i++) {
    const historyItem = filteredHistory[i];

    if (historyItem.message.role === "user") {
      // Gather context items for user messages
      let content = normalizeToMessageParts(historyItem.message);

      const ctxItems = historyItem.contextItems.map((ctxItem) => {
        return { type: "text", text: `${ctxItem.content}\n` } as MessagePart;
      });

      content = [...ctxItems, ...content];
      msgs.push({
        ...historyItem.message,
        content,
      });
    } else if (isFullyCanceledToolTurn(historyItem)) {
      // Entire assistant tool turn was canceled (walk toolCallStates, not only primary).
      msgs.push({
        ...historyItem.message,
        content: CANCELED_TOOL_CALL_MESSAGE,
      });
    } else {
      msgs.push(sanitizeAssistantMessage(historyItem.message));
    }
  }

  // Remove the "id" from all of the messages
  return msgs.map((msg) => {
    const { id, ...rest } = msg as any;
    return rest;
  });
}
