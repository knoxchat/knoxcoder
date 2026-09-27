/**
 * KN-362: vscode.lm vendor `knox` + `textModelApiTools` → Core `tools/call`.
 * Conversions stay vscode-free so mocha can assert the protocol mapping.
 */

import type { ChatMessage, ContextItem, Tool, ToolCall } from "core";

export const KNOX_LM_VENDOR = "knox";
export const KNOX_LM_EXECUTE_TOOL_CALL_COMMAND = "knox.executeToolCall";
export const KNOX_LM_TOOLS_CALL_MESSAGE = "tools/call";
export const KNOX_LM_ASSIST_USER_ROLE = 1;
export const KNOX_LM_ASSIST_ASSISTANT_ROLE = 2;
export const KNOX_LM_TOOL_MODE_AUTO = 1;
export const KNOX_LM_TOOL_MODE_REQUIRED = 2;

export type KnoxLmBridgeTextPart = { kind: "text"; value: string };
export type KnoxLmBridgeToolCallPart = {
  kind: "toolCall";
  callId: string;
  name: string;
  input: object;
};
export type KnoxLmBridgeToolResultPart = {
  kind: "toolResult";
  callId: string;
  content: string;
};
export type KnoxLmBridgePart =
  | KnoxLmBridgeTextPart
  | KnoxLmBridgeToolCallPart
  | KnoxLmBridgeToolResultPart;

export type KnoxLmBridgeMessage = {
  role: number;
  parts: KnoxLmBridgePart[];
};

export type KnoxLmBridgeTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

export type KnoxLmToolsCallRequest = {
  toolCall: ToolCall;
  selectedModelTitle: string;
};

export function parseLmToolInput(input: unknown): object {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }
  return {};
}

export function buildToolsCallRequest(args: {
  toolName: string;
  input?: unknown;
  selectedModelTitle: string;
  callId?: string;
}): KnoxLmToolsCallRequest {
  return {
    toolCall: {
      id: args.callId ?? `lm-${args.toolName}`,
      type: "function",
      function: {
        name: args.toolName,
        arguments: JSON.stringify(parseLmToolInput(args.input)),
      },
    },
    selectedModelTitle: args.selectedModelTitle,
  };
}

export function toolsCallInvocation(request: KnoxLmToolsCallRequest): {
  messageType: typeof KNOX_LM_TOOLS_CALL_MESSAGE;
  command: typeof KNOX_LM_EXECUTE_TOOL_CALL_COMMAND;
  data: KnoxLmToolsCallRequest;
} {
  return {
    messageType: KNOX_LM_TOOLS_CALL_MESSAGE,
    command: KNOX_LM_EXECUTE_TOOL_CALL_COMMAND,
    data: request,
  };
}

export function contextItemsToToolResultText(
  items: Array<Pick<ContextItem, "name" | "content">> | undefined,
): string {
  if (!items?.length) {
    return "";
  }
  return items
    .map((item) => {
      const header = item.name ? `${item.name}\n` : "";
      return `${header}${item.content ?? ""}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

export function parseLmAssistTools(tools: unknown): KnoxLmBridgeTool[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const parsed: KnoxLmBridgeTool[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") {
      continue;
    }
    const record = tool as {
      name?: unknown;
      description?: unknown;
      inputSchema?: unknown;
    };
    if (typeof record.name !== "string" || !record.name) {
      continue;
    }
    parsed.push({
      name: record.name,
      description:
        typeof record.description === "string" && record.description
          ? record.description
          : record.name,
      inputSchema:
        record.inputSchema &&
        typeof record.inputSchema === "object" &&
        !Array.isArray(record.inputSchema)
          ? (record.inputSchema as Record<string, unknown>)
          : undefined,
    });
  }
  return parsed;
}

export function lmToolsToCompletionTools(tools: KnoxLmBridgeTool[]): Tool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
    displayTitle: tool.name,
    wouldLikeTo: tool.description,
    isCurrently: tool.description,
    hasAlready: tool.description,
    readonly: true,
    group: "lm",
  }));
}

export function completionOptionsForLmRequest(args: {
  tools?: unknown;
  toolMode?: number;
}): { tools?: Tool[]; toolChoice?: { type: "function"; function: { name: string } } } {
  const tools = lmToolsToCompletionTools(parseLmAssistTools(args.tools));
  if (!tools.length) {
    return {};
  }
  if (args.toolMode === KNOX_LM_TOOL_MODE_REQUIRED && tools[0]) {
    return {
      tools,
      toolChoice: { type: "function", function: { name: tools[0].function.name } },
    };
  }
  return { tools };
}

function joinTextParts(parts: KnoxLmBridgePart[]): string {
  return parts
    .filter((part): part is KnoxLmBridgeTextPart => part.kind === "text")
    .map((part) => part.value)
    .join("");
}

export function lmMessagesToChatMessages(
  messages: readonly KnoxLmBridgeMessage[],
): ChatMessage[] {
  const chat: ChatMessage[] = [];
  for (const message of messages) {
    const toolCalls = message.parts.filter(
      (part): part is KnoxLmBridgeToolCallPart => part.kind === "toolCall",
    );
    const toolResults = message.parts.filter(
      (part): part is KnoxLmBridgeToolResultPart => part.kind === "toolResult",
    );
    const text = joinTextParts(message.parts);

    if (message.role === KNOX_LM_ASSIST_ASSISTANT_ROLE) {
      chat.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length
          ? {
              toolCalls: toolCalls.map((part, index) => ({
                id: part.callId,
                type: "function" as const,
                index,
                function: {
                  name: part.name,
                  arguments: JSON.stringify(parseLmToolInput(part.input)),
                },
              })),
            }
          : {}),
      });
      continue;
    }

    for (const result of toolResults) {
      chat.push({
        role: "tool",
        toolCallId: result.callId,
        content: result.content,
      });
    }
    if (text || !toolResults.length) {
      chat.push({ role: "user", content: text });
    }
  }
  return chat;
}

function parseToolCallArguments(raw: string | undefined): object {
  if (!raw) {
    return {};
  }
  try {
    return parseLmToolInput(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function chatChunkToLmParts(chunk: ChatMessage): KnoxLmBridgePart[] {
  if (chunk.role === "thinking") {
    return [];
  }
  if (chunk.role === "tool") {
    return [{ kind: "toolResult", callId: chunk.toolCallId, content: chunk.content }];
  }
  if (chunk.role !== "assistant") {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    return text ? [{ kind: "text", value: text }] : [];
  }

  const parts: KnoxLmBridgePart[] = [];
  const text = typeof chunk.content === "string" ? chunk.content : "";
  if (text) {
    parts.push({ kind: "text", value: text });
  }
  for (const call of chunk.toolCalls ?? []) {
    if (!call.function?.name) {
      continue;
    }
    parts.push({
      kind: "toolCall",
      callId: call.id ?? `lm-${call.function.name}`,
      name: call.function.name,
      input: parseToolCallArguments(call.function.arguments),
    });
  }
  return parts;
}
