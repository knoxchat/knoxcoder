import { streamSse } from "../../fetch/index.js";
import { OpenAI } from "openai/index";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParams,
  Completion,
  CompletionCreateParams,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
} from "openai/resources/index";
import { AnthropicConfig } from "../types.js";
import {
  chatChunk,
  chatChunkFromDelta,
  customFetch,
  model,
  promptToString,
} from "../util.js";
import { BaseLlmApi } from "./base.js";

export class AnthropicApi implements BaseLlmApi {
  apiBase: string = "https://api.anthropic.com/v1/";

  constructor(protected config: AnthropicConfig) {
    this.apiBase = config.apiBase ?? this.apiBase;
    if (!this.apiBase.endsWith("/")) {
      this.apiBase += "/";
    }
  }

  private getHeaders(accept: string = "application/json"): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: accept,
      "anthropic-version": "2023-06-01",
      "x-api-key": this.config.apiKey,
    };
  }

  private _convertBody(oaiBody: ChatCompletionCreateParams) {
    let stop = undefined;
    if (oaiBody.stop && Array.isArray(oaiBody.stop)) {
      stop = oaiBody.stop.filter((x: string) => x.trim() !== "");
    } else if (typeof oaiBody.stop === "string" && oaiBody.stop.trim() !== "") {
      stop = [oaiBody.stop];
    }

    const anthropicBody = {
      messages: this._convertMessages(
        oaiBody.messages.filter((msg: any) => msg.role !== "system"),
      ),
      system: oaiBody.messages.find((msg: any) => msg.role === "system")
        ?.content,
      top_p: oaiBody.top_p,
      temperature: oaiBody.temperature,
      max_tokens: oaiBody.max_tokens ?? 32000, // max_tokens is required
      model: oaiBody.model,
      stop_sequences: stop,
      stream: oaiBody.stream,
      tools: oaiBody.tools?.map((tool: any) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
      tool_choice: oaiBody.tool_choice
        ? {
            type: "tool",
            name:
              typeof oaiBody.tool_choice === "string"
                ? oaiBody.tool_choice
                : (oaiBody.tool_choice as any)?.function?.name,
          }
        : undefined,
    };

    return anthropicBody;
  }

  private _convertMessages(
    msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): any[] {
    const messages = msgs.map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.tool_call_id,
              content:
                typeof message.content === "string"
                  ? message.content
                  : message.content.map((part) => part.text).join(""),
            },
          ],
        };
      } else if (message.role === "assistant" && message.tool_calls) {
        return {
          role: "assistant",
          content: message.tool_calls.map((toolCall: any) => ({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function?.name,
            input: JSON.parse(toolCall.function?.arguments || "{}"),
          })),
        };
      }

      if (!Array.isArray(message.content)) {
        return message;
      }
      return {
        ...message,
        content: message.content
          .map((part) => {
            if (part.type === "text") {
              if ((part.text?.trim() ?? "") === "") {
                return null;
              }
              return part;
            }
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                // @ts-ignore
                data: part.image_url.url.split(",")[1],
              },
            };
          })
          .filter((x) => x !== null),
      };
    });
    return messages;
  }

  /** Map Completions-API body → Messages API chat body (prompt as user turn). */
  private completionToChatBody(
    body: CompletionCreateParams,
    stream: boolean,
  ): ChatCompletionCreateParams {
    return {
      model: body.model,
      messages: [{ role: "user", content: promptToString(body.prompt) }],
      max_tokens: body.max_tokens ?? 32000,
      temperature: body.temperature ?? undefined,
      top_p: body.top_p ?? undefined,
      stop: body.stop ?? undefined,
      stream,
    };
  }

  private chatToCompletion(chat: ChatCompletion): Completion {
    const finish = chat.choices[0]?.finish_reason;
    const finishReason =
      finish === "length" || finish === "content_filter" || finish === "stop"
        ? finish
        : ("stop" as const);
    return {
      id: chat.id,
      object: "text_completion",
      created: chat.created,
      model: chat.model,
      choices: [
        {
          text: chat.choices[0]?.message?.content ?? "",
          index: 0,
          logprobs: null,
          finish_reason: finishReason,
        },
      ],
      usage: chat.usage,
    };
  }

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    const response = await customFetch(this.config.requestOptions)(
      new URL("messages", this.apiBase),
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(this._convertBody(body)),
        signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Anthropic API ${response.status}: ${text || response.statusText}`,
      );
    }

    const completion = (await response.json()) as any;
    const text =
      completion.content?.find((b: any) => b.type === "text")?.text ??
      completion.content?.[0]?.text ??
      "";
    return {
      id: completion.id,
      object: "chat.completion",
      model: body.model,
      created: Date.now(),
      usage: {
        total_tokens:
          (completion.usage?.input_tokens ?? 0) +
          (completion.usage?.output_tokens ?? 0),
        completion_tokens: completion.usage?.output_tokens ?? 0,
        prompt_tokens: completion.usage?.input_tokens ?? 0,
      },
      choices: [
        {
          logprobs: null,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: text,
            refusal: null,
          },
          index: 0,
        },
      ],
    };
  }

  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
    const response = await customFetch(this.config.requestOptions)(
      new URL("messages", this.apiBase),
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(this._convertBody(body)),
        signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Anthropic API ${response.status}: ${text || response.statusText}`,
      );
    }

    let lastToolUseId: string | undefined;
    let lastToolUseName: string | undefined;
    for await (const value of streamSse(response as any)) {
      // https://docs.anthropic.com/en/api/messages-streaming#event-types
      switch (value.type) {
        case "content_block_start":
          if (value.content_block.type === "tool_use") {
            lastToolUseId = value.content_block.id;
            lastToolUseName = value.content_block.name;
          }
          break;
        case "content_block_delta":
          // https://docs.anthropic.com/en/api/messages-streaming#delta-types
          switch (value.delta.type) {
            case "text_delta":
              yield chatChunk({
                content: value.delta.text,
                model: body.model,
              });
              break;
            case "input_json_delta":
              if (!lastToolUseId || !lastToolUseName) {
                throw new Error("No tool use found");
              }
              yield chatChunkFromDelta({
                model: body.model,
                delta: {
                  tool_calls: [
                    {
                      id: lastToolUseId,
                      type: "function",
                      index: 0,
                      function: {
                        name: lastToolUseName,
                        arguments: value.delta.partial_json,
                      },
                    },
                  ],
                },
              });
              break;
          }
          break;
        case "content_block_stop":
          lastToolUseId = undefined;
          lastToolUseName = undefined;
          break;
        default:
          break;
      }
    }
  }

  /**
   * Anthropic has no Completions API — shim via Messages with the prompt as a user turn.
   */
  async completionNonStream(
    body: CompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<Completion> {
    const chatBody = this.completionToChatBody(
      body,
      false,
    ) as ChatCompletionCreateParamsNonStreaming;
    const chat = await this.chatCompletionNonStream(chatBody, signal);
    return this.chatToCompletion(chat);
  }

  /**
   * Anthropic has no Completions API — shim via streaming Messages.
   */
  async *completionStream(
    body: CompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<Completion, any, unknown> {
    const chatBody = this.completionToChatBody(
      body,
      true,
    ) as ChatCompletionCreateParamsStreaming;
    for await (const chunk of this.chatCompletionStream(chatBody, signal)) {
      const text = chunk.choices[0]?.delta?.content;
      if (text == null || text === "") {
        continue;
      }
      const finish = chunk.choices[0]?.finish_reason;
      const finishReason =
        finish === "length" || finish === "content_filter" || finish === "stop"
          ? finish
          : null;
      yield {
        id: chunk.id || "anthropic-completion",
        object: "text_completion",
        created: chunk.created,
        model: body.model,
        choices: [
          {
            text,
            index: 0,
            logprobs: null,
            finish_reason: finishReason,
          },
        ],
      } as Completion;
    }
  }

  /**
   * List models via Anthropic `GET /v1/models`.
   * https://docs.anthropic.com/en/api/models-list
   */
  async list(): Promise<OpenAI.Models.Model[]> {
    const response = await customFetch(this.config.requestOptions)(
      new URL("models", this.apiBase),
      {
        method: "GET",
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Anthropic models list ${response.status}: ${text || response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      data?: Array<{
        id: string;
        display_name?: string;
        created_at?: string;
        type?: string;
      }>;
    };

    return (json.data ?? []).map((m) =>
      model({
        id: m.id,
        owned_by: "anthropic",
        created: m.created_at
          ? Math.floor(new Date(m.created_at).getTime() / 1000)
          : undefined,
      }),
    );
  }
}
