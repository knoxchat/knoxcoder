import { OpenAI } from "openai/index";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  Completion,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  Model,
} from "openai/resources/index";
import { z } from "zod";
import { OpenAIConfigSchema } from "../types.js";
import { customFetch } from "../util.js";
import { BaseLlmApi } from "./base.js";

export class OpenAIApi implements BaseLlmApi {
  openai: OpenAI;
  apiBase: string = "https://api.openai.com/v1/";

  constructor(protected config: z.infer<typeof OpenAIConfigSchema>) {
    this.apiBase = config.apiBase ?? this.apiBase;
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: this.apiBase,
      fetch: customFetch(config.requestOptions) as any,
    });
  }

  /**
   * True for bare OpenAI o-series IDs (o1, o3, o4…), not `openai/gpt-*`
   * KnoxChat model IDs which also start with "o".
   */
  private isOpenAIReasoningSeriesModel(model?: string): boolean {
    if (!model) {
      return false;
    }
    const bare = model.includes("/") ? model.split("/").pop()! : model;
    return /^(o1|o3|o4)(-|$)/i.test(bare);
  }

  modifyChatBody<T extends ChatCompletionCreateParams>(body: T): T {
    // Bare OpenAI o-series models only (never openai/gpt-* via KnoxChat)
    if (this.isOpenAIReasoningSeriesModel(body.model)) {
      // a) use max_completion_tokens instead of max_tokens
      body.max_completion_tokens = body.max_tokens;
      body.max_tokens = undefined;

      // b) use "developer" message role rather than "system"
      body.messages = body.messages.map((message) => {
        if (message.role === "system") {
          return { ...message, role: "developer" } as any;
        }
        return message;
      });
    }
    return body;
  }

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    const response = await this.openai.chat.completions.create(
      this.modifyChatBody(body),
      {
        signal,
      },
    );
    return response;
  }
  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
    const response = await this.openai.chat.completions.create(
      this.modifyChatBody(body),
      {
        signal,
      },
    );
    for await (const result of response) {
      yield result;
    }
  }
  async completionNonStream(
    body: CompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<Completion> {
    const response = await this.openai.completions.create(body, { signal });
    return response;
  }
  async *completionStream(
    body: CompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<Completion, any, unknown> {
    const response = await this.openai.completions.create(body, { signal });
    for await (const result of response) {
      yield result;
    }
  }

  async list(): Promise<Model[]> {
    return (await this.openai.models.list()).data;
  }
}
