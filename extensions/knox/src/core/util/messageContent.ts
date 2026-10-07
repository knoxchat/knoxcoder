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

const ANTHROPIC_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Convert an image URL (data URI or http(s) URL) to an Anthropic `image` block.
 * The media type comes from the data URI (screenshots are PNG; Anthropic rejects a
 * PNG labelled as JPEG). Unknown or missing types fall back to JPEG.
 */
export function toAnthropicImageSource(url: string | undefined):
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string } {
  const value = url ?? "";
  if (/^https?:\/\//i.test(value)) {
    return { type: "url", url: value };
  }
  const match = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(value);
  const declared = match?.[1]?.toLowerCase() === "image/jpg" ? "image/jpeg" : match?.[1]?.toLowerCase();
  const media_type =
    declared && ANTHROPIC_IMAGE_TYPES.has(declared) ? declared : "image/jpeg";
  const comma = value.indexOf(",");
  return {
    type: "base64",
    media_type,
    data: comma >= 0 ? value.slice(comma + 1) : value,
  };
}
