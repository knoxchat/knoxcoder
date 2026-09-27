import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  Completion,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  Model,
} from "openai/resources/index";

/**
 * OpenAI-shaped adapter contract.
 * Chat + legacy completions + model list. FIM/autocomplete is not part of the product.
 */
export interface BaseLlmApi {
  // Chat, no stream
  chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion>;

  // Chat, stream
  chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk>;

  // Completion, no stream (may be shimmed via chat Messages API)
  completionNonStream(
    body: CompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<Completion>;

  // Completion, stream (may be shimmed via chat Messages API)
  completionStream(
    body: CompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<Completion>;

  // List Models
  list(): Promise<Model[]>;
}
