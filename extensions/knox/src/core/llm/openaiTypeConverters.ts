import {
  Chat,
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionUserMessageParam,
  CompletionCreateParams,
} from "openai/resources/index";

import {
  ChatMessage,
  CompletionOptions,
  MessageContent,
  TextMessagePart,
} from "..";

export function toChatMessage(
  message: ChatMessage,
): ChatCompletionMessageParam {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }
  if (message.role === "system") {
    return {
      role: "system",
      content: message.content,
    };
  }

  if (message.role === "assistant") {
    const msg: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content:
        typeof message.content === "string"
          ? message.content || " "
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part as TextMessagePart), // can remove with newer typescript version
    };

    if (message.toolCalls) {
      msg.tool_calls = message.toolCalls.map((toolCall) => ({
        id: toolCall.id!,
        type: toolCall.type!,
        function: {
          name: toolCall.function?.name!,
          arguments: toolCall.function?.arguments!,
        },
      }));
    }
    return msg;
  } else {
    if (typeof message.content === "string") {
      return {
        role: "user",
        content: message.content ?? " ",
      };
    }

    // If no multi-media is in the message, just send as text
    // for compatibility with OpenAI-"compatible" servers
    // that don't support multi-media format
    return {
      role: "user",
      content: !message.content.some((item) => item.type !== "text")
        ? message.content
            .map((item) => (item as TextMessagePart).text)
            .join("") || " "
        : message.content.map((part) => {
            if (part.type === "imageUrl") {
              return {
                type: "image_url" as const,
                image_url: {
                  url: part.imageUrl.url,
                  detail: "auto" as const,
                },
              };
            }
            return part;
          }),
    };
  }
}

export function toChatBody(
  messages: ChatMessage[],
  options: CompletionOptions,
): ChatCompletionCreateParams {
  const params: ChatCompletionCreateParams = {
    messages: messages.map(toChatMessage),
    model: options.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    top_p: options.topP,
    frequency_penalty: options.frequencyPenalty,
    presence_penalty: options.presencePenalty,
    stream: options.stream ?? true,
    stop: options.stop,
    prediction: options.prediction,
    tool_choice: options.toolChoice,
  };

  // Pass through API/sidecar effort values as-is (including "none").
  if (
    typeof options.reasoningEffort === "string" &&
    options.reasoningEffort.length > 0
  ) {
    (params as any).reasoning_effort = options.reasoningEffort;
  }

  if (options.webSearch !== undefined) {
    // KnoxChat Claude-style flag; perplexity uses web_search_options (filtered by supported_parameters)
    (params as any).web_search = options.webSearch;
    if (options.webSearch) {
      (params as any).web_search_options = { search_context_size: "medium" };
    }
  }

  if (options.tools?.length) {
    params.tools = options.tools.map((tool) => ({
      type: tool.type,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
      },
    }));
  }

  return params;
}

export function toCompleteBody(
  prompt: string,
  options: CompletionOptions,
): CompletionCreateParams {
  return {
    prompt,
    model: options.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    top_p: options.topP,
    frequency_penalty: options.frequencyPenalty,
    presence_penalty: options.presencePenalty,
    stream: options.stream ?? true,
    stop: options.stop,
  };
}

export function fromChatResponse(response: ChatCompletion): ChatMessage {
  const message = response.choices[0].message;
  const toolCalls = message.tool_calls?.filter((tc) => tc.type === "function");
  return {
    role: "assistant",
    content: message.content ?? "",
    ...(toolCalls?.length ? { toolCalls } : {}),
  };
}

function mapToolCallDeltas(toolCalls: any[] | undefined) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) {
    return undefined;
  }
  return toolCalls.map((tool_call: any) => ({
    id: tool_call.id,
    type: tool_call.type,
    index: tool_call.index,
    function: {
      name: tool_call.function?.name,
      arguments: tool_call.function?.arguments,
    },
  }));
}

export function fromChatCompletionChunk(
  chunk: ChatCompletionChunk,
): ChatMessage | undefined {
  const delta = chunk.choices?.[0]?.delta;

  // Extract knox_ms_meta from chunk if present (Knox MS model responses)
  const knoxMsMeta = (chunk as any).knox_ms_meta;

  // Handle reasoning content from KnoxChat API (include_reasoning parameter)
  // Support both 'reasoning' and 'reasoning_content' fields (for deepseek-reasoner compatibility)
  const reasoningValue =
    (delta as any)?.reasoning ?? (delta as any)?.reasoning_content;
  const hasReasoning =
    reasoningValue !== undefined &&
    reasoningValue !== null &&
    typeof reasoningValue === "string" &&
    reasoningValue.length > 0 &&
    reasoningValue !== "null";
  const content =
    typeof delta?.content === "string" ? delta.content : "";
  const toolCalls = mapToolCallDeltas(delta?.tool_calls);

  if (hasReasoning || content || toolCalls || knoxMsMeta) {
    const msg: any = {
      role: "assistant",
      content,
    };
    if (hasReasoning) {
      msg.reasoning = reasoningValue;
    }
    if (toolCalls) {
      msg.toolCalls = toolCalls;
    }
    if (knoxMsMeta) {
      msg.knoxMsMeta = knoxMsMeta;
    }
    return msg;
  }

  return undefined;
}

export type LlmApiRequestType =
  | "chat"
  | "streamChat"
  | "complete"
  | "streamComplete"
  | "list";
