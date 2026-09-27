import {
  ChatMessage,
  ContextItem,
  MessageContent,
  MessagePart,
  TextMessagePart,
} from "../index";

export function stripImages(messageContent: MessageContent): string {
  if (messageContent == null) {
    return "";
  }
  if (typeof messageContent === "string") {
    return messageContent;
  }
  if (!Array.isArray(messageContent)) {
    if (
      typeof messageContent === "object" &&
      "text" in (messageContent as { text?: unknown })
    ) {
      const text = (messageContent as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    }
    return "";
  }

  return messageContent
    .filter(
      (part) =>
        part &&
        part.type === "text" &&
        typeof (part as TextMessagePart).text === "string",
    )
    .map((part) => (part as TextMessagePart).text)
    .join("\n");
}

export function renderChatMessage(message: ChatMessage): string {
  switch (message?.role) {
    case "user":
    case "assistant":
    case "thinking":
    case "system":
      return stripImages(message.content);
    case "tool":
      return message.content;
    default:
      return "";
  }
}

export function renderContextItems(contextItems: ContextItem[]): string {
  return contextItems.map((item) => item.content).join("\n\n");
}

export function getImageParts(messageContent: MessageContent): string[] {
  if (typeof messageContent === "string") {
    return [];
  }

  return messageContent
    .filter((part) => part.type === "imageUrl")
    .map((part) => part.imageUrl?.url || "")
    .filter(Boolean);
}

export function normalizeToMessageParts(message: ChatMessage): MessagePart[] {
  switch (message.role) {
    case "user":
    case "assistant":
    case "thinking":
    case "system":
      return Array.isArray(message.content)
        ? message.content
        : [{ type: "text", text: message.content }];
    case "tool":
      return [{ type: "text", text: message.content }];
  }
}
