import { ChatMessage, MessageContent, MessagePart } from "../index.js";
import { t } from "../i18n/index.js";
import { renderChatMessage } from "../util/messageContent.js";
import {
  compactMessages,
  type CompactionResult,
} from "../compaction/index.js";
import { TOKEN_BUFFER_FOR_SAFETY } from "./constants.js";

/** Last compaction result from compileChatMessages (for GUI affordances). */
let lastCompactionResult: CompactionResult | null = null;

export function getLastCompactionResult(): CompactionResult | null {
  return lastCompactionResult;
}

export function clearLastCompactionResult(): void {
  lastCompactionResult = null;
}

/**
 * Local context-budget estimate (chars ÷ 4). KnoxChat bills usage at the
 * provider — the extension does not run tiktoken/worker encoders.
 */
const CHARS_PER_CONTEXT_UNIT = 4;

function textToContextUnits(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_CONTEXT_UNIT);
}

function countImageTokens(content: MessagePart): number {
  if (content.type === "imageUrl") {
    return 85;
  }
  throw new Error(t("nonImageContentType"));
}

function countTokens(
  content: MessageContent,
  // modelName kept for call-site compatibility; estimate is model-agnostic
  _modelName = "qwen/qwen3-coder",
): number {
  if (Array.isArray(content)) {
    return content.reduce((acc, part) => {
      if (part.type === "imageUrl") {
        return acc + countImageTokens(part);
      }
      return acc + textToContextUnits(part.text ?? "");
    }, 0);
  }
  return textToContextUnits(content ?? "");
}

function maxCharsForUnits(maxUnits: number): number {
  return Math.max(0, maxUnits * CHARS_PER_CONTEXT_UNIT);
}

function pruneStringFromBottom(
  _modelName: string,
  maxTokens: number,
  prompt: string,
): string {
  const maxChars = maxCharsForUnits(maxTokens);
  if (prompt.length <= maxChars) {
    return prompt;
  }
  return prompt.slice(0, maxChars);
}

function pruneStringFromTop(
  _modelName: string,
  maxTokens: number,
  prompt: string,
): string {
  const maxChars = maxCharsForUnits(maxTokens);
  if (prompt.length <= maxChars) {
    return prompt;
  }
  return prompt.slice(prompt.length - maxChars);
}

function messageHasToolCalls(msg: ChatMessage): boolean {
  return msg.role === "assistant" && !!msg.toolCalls;
}

export function flattenMessages(msgs: ChatMessage[]): ChatMessage[] {
  const flattened: ChatMessage[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    if (
      flattened.length > 0 &&
      flattened[flattened.length - 1].role === msg.role &&
      !messageHasToolCalls(msg) &&
      !messageHasToolCalls(flattened[flattened.length - 1])
    ) {
      flattened[flattened.length - 1].content += `\n\n${msg.content || ""}`;
    } else {
      flattened.push(msg);
    }
  }

  return flattened;
}

function countChatMessageTokens(
  modelName: string,
  chatMessage: ChatMessage,
): number {
  // Doing simpler, safer version of what is here:
  // https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
  // every message follows <|im_start|>{role/name}\n{content}<|end|>\n
  const TOKENS_PER_MESSAGE: number = 4;
  return countTokens(chatMessage.content, modelName) + TOKENS_PER_MESSAGE;
}

function pruneLinesFromTop(
  prompt: string,
  maxTokens: number,
  modelName: string,
): string {
  let totalTokens = countTokens(prompt, modelName);
  const lines = prompt.split("\n");
  while (totalTokens > maxTokens && lines.length > 0) {
    totalTokens -= countTokens(lines.shift()!, modelName);
  }

  return lines.join("\n");
}

function pruneLinesFromBottom(
  prompt: string,
  maxTokens: number,
  modelName: string,
): string {
  let totalTokens = countTokens(prompt, modelName);
  const lines = prompt.split("\n");
  while (totalTokens > maxTokens && lines.length > 0) {
    totalTokens -= countTokens(lines.pop()!, modelName);
  }

  return lines.join("\n");
}

function pruneRawPromptFromTop(
  modelName: string,
  contextLength: number,
  prompt: string,
  tokensForCompletion: number,
): string {
  const maxTokens =
    contextLength - tokensForCompletion - TOKEN_BUFFER_FOR_SAFETY;
  return pruneStringFromTop(modelName, maxTokens, prompt);
}

function pruneRawPromptFromBottom(
  modelName: string,
  contextLength: number,
  prompt: string,
  tokensForCompletion: number,
): string {
  const maxTokens =
    contextLength - tokensForCompletion - TOKEN_BUFFER_FOR_SAFETY;
  return pruneStringFromBottom(modelName, maxTokens, prompt);
}

function summarize(message: ChatMessage): string {
  return `${renderChatMessage(message).substring(0, 100)}...`;
}

function pruneChatHistory(
  modelName: string,
  chatHistory: ChatMessage[],
  contextLength: number,
  tokensForCompletion: number,
): ChatMessage[] {
  let totalTokens =
    tokensForCompletion +
    chatHistory.reduce((acc, message) => {
      return acc + countChatMessageTokens(modelName, message);
    }, 0);

  // 0. Prune any messages that take up more than 1/3 of the context length
  const longestMessages = [...chatHistory];
  longestMessages.sort((a, b) => b.content.length - a.content.length);

  const longerThanOneThird = longestMessages.filter(
    (message: ChatMessage) =>
      countTokens(message.content, modelName) > contextLength / 3,
  );
  const distanceFromThird = longerThanOneThird.map(
    (message: ChatMessage) =>
      countTokens(message.content, modelName) - contextLength / 3,
  );

  for (let i = 0; i < longerThanOneThird.length; i++) {
    // Prune line-by-line from the top
    const message = longerThanOneThird[i];
    const content = renderChatMessage(message);
    const deltaNeeded = totalTokens - contextLength;
    const delta = Math.min(deltaNeeded, distanceFromThird[i]);
    message.content = pruneStringFromTop(
      modelName,
      countTokens(message.content, modelName) - delta,
      content,
    );
    totalTokens -= delta;
  }

  // 1. Replace beyond last 5 messages with summary
  let i = 0;
  while (totalTokens > contextLength && i < chatHistory.length - 5) {
    const message = chatHistory[0];
    totalTokens -= countTokens(message.content, modelName);
    totalTokens += countTokens(summarize(message), modelName);
    message.content = summarize(message);
    i++;
  }

  // 2. Remove entire messages until the last 5
  while (
    chatHistory.length > 5 &&
    totalTokens > contextLength &&
    chatHistory.length > 0
  ) {
    const message = chatHistory.shift()!;
    totalTokens -= countTokens(message.content, modelName);
  }

  // 3. Truncate message in the last 5, except last 1
  i = 0;
  while (
    totalTokens > contextLength &&
    chatHistory.length > 0 &&
    i < chatHistory.length - 1
  ) {
    const message = chatHistory[i];
    totalTokens -= countTokens(message.content, modelName);
    totalTokens += countTokens(summarize(message), modelName);
    message.content = summarize(message);
    i++;
  }

  // 4. Remove entire messages in the last 5, except last 1
  while (totalTokens > contextLength && chatHistory.length > 1) {
    const message = chatHistory.shift()!;
    totalTokens -= countTokens(message.content, modelName);
  }

  // 5. Truncate last message
  if (totalTokens > contextLength && chatHistory.length > 0) {
    const message = chatHistory[0];
    message.content = pruneRawPromptFromTop(
      modelName,
      contextLength,
      renderChatMessage(message),
      tokensForCompletion,
    );
    totalTokens = contextLength;
  }

  return chatHistory;
}

function messageIsEmpty(message: ChatMessage): boolean {
  if (typeof message.content === "string") {
    return message.content.trim() === "";
  }
  if (Array.isArray(message.content)) {
    return message.content.every(
      (item) => item.type === "text" && item.text?.trim() === "",
    );
  }
  return false;
}

function addSpaceToAnyEmptyMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (messageIsEmpty(message)) {
      message.content = " ";
    }
    return message;
  });
}

function chatMessageIsEmpty(message: ChatMessage): boolean {
  switch (message.role) {
    case "system":
    case "user":
      return (
        typeof message.content === "string" && message.content.trim() === ""
      );
    case "assistant":
      return (
        typeof message.content === "string" &&
        message.content.trim() === "" &&
        !message.toolCalls
      );
    case "thinking":
    case "tool":
      return false;
  }
}

function compileChatMessages(
  modelName: string,
  msgs: ChatMessage[] | undefined,
  contextLength: number,
  maxTokens: number,
  supportsImages: boolean,
  prompt: string | undefined = undefined,
  functions: any[] | undefined = undefined,
  systemMessage: string | undefined = undefined,
): ChatMessage[] {
  // Collect every non-empty system message (default system + memory/plan inject).
  // Previously only msgs[0] was preserved, so mid-list injects were silently dropped.
  const systemParts: string[] = [];
  if (msgs) {
    for (const msg of msgs) {
      if (msg.role === "system" && !chatMessageIsEmpty(msg)) {
        const part = renderChatMessage(msg).trim();
        if (part) {
          systemParts.push(part);
        }
      }
    }
  }

  let msgsCopy = msgs
    ? msgs
      .map((msg) => ({ ...msg }))
      .filter((msg) => !chatMessageIsEmpty(msg) && msg.role !== "system")
    : [];

  msgsCopy = addSpaceToAnyEmptyMessages(msgsCopy);

  if (prompt) {
    const promptMsg: ChatMessage = {
      role: "user",
      content: prompt,
    };
    msgsCopy.push(promptMsg);
  }

  if (
    (systemMessage && systemMessage.trim() !== "") ||
    systemParts.length > 0
  ) {
    let content = systemParts.join("\n\n");
    if (systemMessage && systemMessage.trim() !== "") {
      const shouldAddNewLines = content !== "";
      if (shouldAddNewLines) {
        content += "\n\n";
      }
      content += systemMessage;
    }
    const systemChatMsg: ChatMessage = {
      role: "system",
      content,
    };
    // Insert as second to last
    // Later moved to top, but want second-priority to last user message
    msgsCopy.splice(-1, 0, systemChatMsg);
  }

  let functionTokens = 0;
  if (functions) {
    for (const func of functions) {
      functionTokens += countTokens(JSON.stringify(func), modelName);
    }
  }

  if (maxTokens + functionTokens + TOKEN_BUFFER_FOR_SAFETY >= contextLength) {
    throw new Error(
      `maxTokens (${maxTokens}) is too close to contextLength (${contextLength}), which doesn't leave room for response. Try increasing the contextLength parameter of the model in your config.json.`,
    );
  }

  // If images not supported, convert MessagePart[] to string
  if (!supportsImages) {
    for (const msg of msgsCopy) {
      if ("content" in msg && Array.isArray(msg.content)) {
        const content = renderChatMessage(msg);
        msg.content = content;
      }
    }
  }

  // Run context compaction before the legacy pruning pass
  const compactionResult = compactMessages(
    msgsCopy,
    modelName,
    contextLength,
    maxTokens,
    functionTokens,
    TOKEN_BUFFER_FOR_SAFETY,
  );
  lastCompactionResult = compactionResult;
  if (compactionResult.tokensSaved > 0) {
    console.log(
      `[Compaction] Reduced context budget ~${compactionResult.tokensSaved} units ` +
      `(dedup: ${compactionResult.deduplicated}, summarized: ${compactionResult.summarized}, ` +
      `${compactionResult.originalMessageCount} → ${compactionResult.compactedMessageCount} messages)`,
    );
    msgsCopy = compactionResult.messages;
  }

  const history = pruneChatHistory(
    modelName,
    msgsCopy,
    contextLength,
    functionTokens + maxTokens + TOKEN_BUFFER_FOR_SAFETY,
  );

  if (history.length >= 2 && history[history.length - 2].role === "system") {
    const movedSystemMessage = history.splice(-2, 1)[0];
    history.unshift(movedSystemMessage);
  }

  const flattenedHistory = flattenMessages(history);

  return flattenedHistory;
}

export {
  compileChatMessages,
  countTokens,
  pruneLinesFromBottom,
  pruneLinesFromTop,
  pruneRawPromptFromTop,
  pruneStringFromBottom,
  pruneStringFromTop,
};

