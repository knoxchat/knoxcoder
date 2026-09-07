import {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from "openai/resources/index";

import {
  ChatMessage,
  CompletionOptions,
  LLMOptions,
  Tool,
} from "../../index.js";
import { renderChatMessage } from "../../util/messageContent.js";
import { BaseLLM } from "../index.js";
import {
  getMetadataContextLength,
  getMetadataMaxCompletionTokens,
  isOpenAIReasoningSeriesModel,
  modelSupportsParameter,
  modelSupportsWebSearchFromMetadata,
  seedKnoxChatModelsCache,
  shouldEnrichFromKnoxChatApi,
  type KnoxChatModelMetadata,
} from "../knoxChatModels.js";
import {
  fromChatCompletionChunk,
  LlmApiRequestType,
  toChatBody,
} from "../openaiTypeConverters.js";
import { streamSse } from "../stream.js";

const NON_CHAT_MODELS = [
  "text-davinci-002",
  "text-davinci-003",
  "code-davinci-002",
  "text-ada-001",
  "text-babbage-001",
  "text-curie-001",
  "davinci",
  "curie",
  "babbage",
  "ada",
];

const CHAT_ONLY_MODELS = [
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-0613",
  "gpt-3.5-turbo-16k",
  "gpt-4",
  "gpt-4-turbo",
  "gpt-4o",
  "gpt-35-turbo-16k",
  "gpt-35-turbo-0613",
  "gpt-35-turbo",
  "gpt-5",
  "gpt-4o-mini",
  "o1-preview",
  "o1-mini",
  "o3-mini",
];

type OpenAICompatibleModelMetadata = KnoxChatModelMetadata;

const MODEL_METADATA_CACHE_DURATION = 24 * 60 * 60 * 1000;
const modelMetadataCache = new Map<
  string,
  {
    timestamp: number;
    models?: OpenAICompatibleModelMetadata[];
    promise?: Promise<OpenAICompatibleModelMetadata[]>;
  }
>();

/** Maps request body keys → API supported_parameters names for filtering. */
const MODEL_PARAMETER_BODY_KEYS: [string, string][] = [
  ["max_tokens", "max_tokens"],
  ["max_completion_tokens", "max_completion_tokens"],
  ["temperature", "temperature"],
  ["top_p", "top_p"],
  ["top_k", "top_k"],
  ["frequency_penalty", "frequency_penalty"],
  ["presence_penalty", "presence_penalty"],
  ["repetition_penalty", "repetition_penalty"],
  ["min_p", "min_p"],
  ["stop", "stop"],
  ["tools", "tools"],
  ["tool_choice", "tool_choice"],
  ["response_format", "response_format"],
  ["seed", "seed"],
  ["logprobs", "logprobs"],
  ["top_logprobs", "top_logprobs"],
  ["logit_bias", "logit_bias"],
  ["reasoning", "reasoning"],
  ["reasoning_effort", "reasoning_effort"],
  ["include_reasoning", "include_reasoning"],
  ["structured_outputs", "structured_outputs"],
  ["verbosity", "verbosity"],
  ["web_search", "web_search"],
  ["web_search_options", "web_search_options"],
  ["prediction", "prediction"],
  ["parallel_tool_calls", "parallel_tool_calls"],
  // Knox MS / memory-system parameters (also injected via extraBodyProperties)
  ["session_id", "session_id"],
  ["memory_mode", "memory_mode"],
  ["project_id", "project_id"],
];

const formatMessageForO1 = (messages: ChatCompletionMessageParam[]) => {
  return messages?.map((message: any) => {
    if (message?.role === "system") {
      return {
        ...message,
        role: "user",
      };
    }

    return message;
  });
};

class OpenAI extends BaseLLM {
  public useLegacyCompletionsEndpoint: boolean | undefined = undefined;
  private activeModelMetadata: OpenAICompatibleModelMetadata | undefined;

  constructor(options: LLMOptions) {
    super(options);
    this.useLegacyCompletionsEndpoint = options.useLegacyCompletionsEndpoint;
  }

  static providerName = "openai";
  static defaultOptions: Partial<LLMOptions> | undefined = {
    apiBase: "https://api.openai.com/v1/",
  };

  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [
    "chat",
    "list",
    "streamChat",
  ];

  protected _convertModelName(model: string): string {
    return model;
  }

  private isO3orO1Model(model?: string): boolean {
    // Prefer live supported_parameters when available
    if (this.activeModelMetadata?.supported_parameters?.length) {
      return modelSupportsParameter(
        this.activeModelMetadata.supported_parameters,
        "max_completion_tokens",
      ) && !modelSupportsParameter(
        this.activeModelMetadata.supported_parameters,
        "max_tokens",
      );
    }
    return isOpenAIReasoningSeriesModel(model);
  }

  protected supportsPrediction(model: string): boolean {
    if (
      modelSupportsParameter(
        this.activeModelMetadata?.supported_parameters,
        "prediction",
      )
    ) {
      return true;
    }
    const SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-4o"];
    return SUPPORTED_MODELS.some((m) => model.includes(m));
  }

  private convertTool(tool: Tool): any {
    return {
      type: tool.type,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
      },
    };
  }

  protected extraBodyProperties(): Record<string, any> {
    return {};
  }

  private shouldLoadModelMetadata(): boolean {
    if (!this.apiBase) {
      return false;
    }

    try {
      const host = new URL(this.apiBase).host;
      return this.providerName === "knoxchat" || host !== "api.openai.com";
    } catch {
      return false;
    }
  }

  /** Prefer live /models metadata over persisted config for KnoxChat hosts. */
  private shouldPreferLiveModelMetadata(): boolean {
    if (this.providerName === "knoxchat") {
      return true;
    }

    try {
      const host = this.apiBase ? new URL(this.apiBase).host : "";
      return host.includes("knox.chat");
    } catch {
      return false;
    }
  }

  private async listModelMetadata(): Promise<OpenAICompatibleModelMetadata[]> {
    if (!this.shouldLoadModelMetadata()) {
      return [];
    }

    const endpoint = this._getEndpoint("models");
    const endpointUrl = endpoint.toString();
    const cacheKey = `${endpointUrl}::${this.apiKey ?? ""}`;
    const now = Date.now();
    const cached = modelMetadataCache.get(cacheKey);

    if (cached && now - cached.timestamp < MODEL_METADATA_CACHE_DURATION) {
      if (cached.models) {
        return cached.models;
      }
      if (cached.promise) {
        return cached.promise;
      }
    }

    const promise = this.fetch(endpoint, {
      method: "GET",
      headers: this._getHeaders(),
    })
      .then(async (response) => {
        const data = await response.json();
        return Array.isArray(data?.data) ? data.data : [];
      })
      .catch((error) => {
        console.debug(
          `Unable to load model metadata from ${endpointUrl}:`,
          error,
        );
        return [];
      });

    modelMetadataCache.set(cacheKey, { timestamp: now, promise });
    const models = await promise;
    modelMetadataCache.set(cacheKey, { timestamp: Date.now(), models });

    // Keep the shared KnoxChat cache in sync for autodetect / pricing / UI
    if (
      shouldEnrichFromKnoxChatApi({
        providerName: this.providerName,
        apiBase: this.apiBase,
      })
    ) {
      seedKnoxChatModelsCache(models);
    }

    return models;
  }

  private async getModelMetadata(
    model: string,
  ): Promise<OpenAICompatibleModelMetadata | undefined> {
    const models = await this.listModelMetadata();
    return models.find((metadata) => {
      return metadata.id === model || metadata.root === model;
    });
  }

  protected async _prepareCompletionOptions(
    options: CompletionOptions,
  ): Promise<CompletionOptions> {
    const metadata = await this.getModelMetadata(options.model);
    this.activeModelMetadata = metadata;

    if (!metadata) {
      return options;
    }

    const nextOptions = { ...options };
    const preferLive = this.shouldPreferLiveModelMetadata();
    const contextLength = getMetadataContextLength(metadata);
    // Prefer live API metadata for KnoxChat hosts (and knox.chat apiBase),
    // including when config previously persisted a stale contextLength.
    if (
      contextLength !== undefined &&
      (!this.hasConfiguredContextLength || preferLive)
    ) {
      this.contextLength = contextLength;
    }

    const maxCompletionTokens = getMetadataMaxCompletionTokens(metadata);
    const finiteContextCap = Number.isFinite(this.contextLength)
      ? Math.floor(this.contextLength / 4)
      : undefined;

    if (
      (!this.hasConfiguredMaxTokens || preferLive) &&
      maxCompletionTokens
    ) {
      nextOptions.maxTokens =
        finiteContextCap !== undefined
          ? Math.min(maxCompletionTokens, finiteContextCap)
          : maxCompletionTokens;
    } else if (
      !this.hasConfiguredMaxTokens &&
      finiteContextCap !== undefined &&
      nextOptions.maxTokens &&
      nextOptions.maxTokens > finiteContextCap
    ) {
      nextOptions.maxTokens = finiteContextCap;
    }

    return nextOptions;
  }

  protected getMaxStopWords(): number {
    const url = new URL(this.apiBase!);

    if (this.maxStopWords !== undefined) {
      return this.maxStopWords;
    } else if (
      url.host === "api.openai.com"
    ) {
      return 4;
    } else {
      return Infinity;
    }
  }

  protected _convertArgs(
    options: CompletionOptions,
    messages: ChatMessage[],
  ): ChatCompletionCreateParams {
    const finalOptions = toChatBody(messages, options);
    return this.finalizeChatBody(finalOptions);
  }

  private applySupportedModelParameters(
    body: ChatCompletionCreateParams,
  ): ChatCompletionCreateParams {
    const supportedParameters = this.activeModelMetadata?.supported_parameters;
    if (!supportedParameters?.length) {
      return body;
    }

    const supported = new Set(supportedParameters);
    const filteredBody: any = { ...body };

    if (
      filteredBody.max_tokens !== undefined &&
      !supported.has("max_tokens") &&
      supported.has("max_completion_tokens")
    ) {
      filteredBody.max_completion_tokens = filteredBody.max_tokens;
      delete filteredBody.max_tokens;
    }

    // Web search may be advertised via pricing.web_search rather than supported_parameters
    const allowsWebSearch =
      supported.has("web_search") ||
      supported.has("web_search_options") ||
      (this.activeModelMetadata
        ? modelSupportsWebSearchFromMetadata(this.activeModelMetadata)
        : false);

    for (const [bodyKey, parameterName] of MODEL_PARAMETER_BODY_KEYS) {
      if (filteredBody[bodyKey] === undefined) {
        continue;
      }
      if (
        (parameterName === "web_search" ||
          parameterName === "web_search_options") &&
        allowsWebSearch
      ) {
        continue;
      }
      if (!supported.has(parameterName)) {
        delete filteredBody[bodyKey];
      }
    }

    // Prefer the parameter name the model actually lists
    if (filteredBody.web_search !== undefined) {
      if (
        !supported.has("web_search") &&
        supported.has("web_search_options")
      ) {
        if (filteredBody.web_search_options === undefined) {
          filteredBody.web_search_options = {
            search_context_size: "medium",
          };
        }
        delete filteredBody.web_search;
      } else if (
        supported.has("web_search") &&
        !supported.has("web_search_options")
      ) {
        delete filteredBody.web_search_options;
      }
    }

    if (!filteredBody.tools?.length) {
      delete filteredBody.tool_choice;
      delete filteredBody.parallel_tool_calls;
    }

    return filteredBody;
  }

  private finalizeChatBody(
    body: ChatCompletionCreateParams,
  ): ChatCompletionCreateParams {
    body.stop = body.stop?.slice(0, this.getMaxStopWords());

    const supported = this.activeModelMetadata?.supported_parameters;
    const usesMaxCompletionTokensOnly =
      this.isO3orO1Model(body.model) ||
      (modelSupportsParameter(supported, "max_completion_tokens") &&
        !modelSupportsParameter(supported, "max_tokens"));

    // Bare OpenAI o-series / max_completion_tokens-only models
    if (usesMaxCompletionTokensOnly || isOpenAIReasoningSeriesModel(body.model)) {
      if (body.max_tokens !== undefined && body.max_completion_tokens === undefined) {
        body.max_completion_tokens = body.max_tokens;
        body.max_tokens = undefined;
      }

      if (isOpenAIReasoningSeriesModel(body.model)) {
        // Legacy o1/o3 bare IDs don't support system message
        body.messages = formatMessageForO1(body.messages);
      }
    }

    // Disable streaming only for bare "o1" (or when stream is explicitly unsupported)
    if (
      body.model === "o1" ||
      (supported?.length &&
        !modelSupportsParameter(supported, "stream") &&
        isOpenAIReasoningSeriesModel(body.model) &&
        body.model.replace(/^.*\//, "").startsWith("o1"))
    ) {
      body.stream = false;
    }

    if (body.prediction && this.supportsPrediction(body.model)) {
      if (body.presence_penalty) {
        body.presence_penalty = undefined;
      }
      if (body.frequency_penalty) {
        body.frequency_penalty = undefined;
      }
      body.max_completion_tokens = undefined;
    } else {
      body.prediction = undefined;
    }

    if (body.tools?.length) {
      // Allow independent reads in one turn (P2.1). Writes still run sequentially.
      body.parallel_tool_calls = true;
    }

    // Auto-enable include_reasoning when the model supports it and
    // the request already asks for reasoning / reasoning_effort.
    const filteredExtras: Record<string, any> = {};
    if (
      modelSupportsParameter(supported, "include_reasoning") &&
      (body as any).reasoning_effort !== undefined
    ) {
      filteredExtras.include_reasoning = true;
    }

    return {
      ...this.applySupportedModelParameters(body),
      ...filteredExtras,
      ...this.extraBodyProperties(),
    } as ChatCompletionCreateParams;
  }

  protected _getHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "api-key": this.apiKey ?? "",
    };
  }

  protected async _complete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): Promise<string> {
    let completion = "";
    for await (const chunk of this._streamChat(
      [{ role: "user", content: prompt }],
      signal,
      options,
    )) {
      completion += chunk.content;
    }

    return completion;
  }

  protected _getEndpoint(
    endpoint: "chat/completions" | "completions" | "models",
  ) {
    if (!this.apiBase) {
      throw new Error(
        "No API base URL provided. Please set the 'apiBase' option in config.json",
      );
    }

    return new URL(endpoint, this.apiBase);
  }

  protected async *_streamComplete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    for await (const chunk of this._streamChat(
      [{ role: "user", content: prompt }],
      signal,
      options,
    )) {
      yield renderChatMessage(chunk);
    }
  }

  protected modifyChatBody(
    body: ChatCompletionCreateParams,
  ): ChatCompletionCreateParams {
    return this.finalizeChatBody(body);
  }

  protected async *_legacystreamComplete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const args: any = this._convertArgs(options, []);
    args.prompt = prompt;
    args.messages = undefined;

    const response = await this.fetch(this._getEndpoint("completions"), {
      method: "POST",
      headers: this._getHeaders(),
      body: JSON.stringify({
        ...args,
        stream: true,
        ...this.extraBodyProperties(),
      }),
      signal,
    });

    for await (const value of streamSse(response)) {
      if (value.choices?.[0]?.text && value.finish_reason !== "eos") {
        yield value.choices[0].text;
      }
    }
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    if (
      !CHAT_ONLY_MODELS.includes(options.model) &&
      this.supportsCompletions() &&
      (NON_CHAT_MODELS.includes(options.model) ||
        this.useLegacyCompletionsEndpoint ||
        options.raw)
    ) {
      for await (const content of this._legacystreamComplete(
        renderChatMessage(messages[messages.length - 1]),
        signal,
        options,
      )) {
        yield {
          role: "assistant",
          content,
        };
      }
      return;
    }

    const body = this._convertArgs(options, messages);

    const response = await this.fetch(this._getEndpoint("chat/completions"), {
      method: "POST",
      headers: this._getHeaders(),
      body: JSON.stringify({
        ...body,
        ...this.extraBodyProperties(),
      }),
      signal,
    });

    // Handle non-streaming response
    if (body.stream === false) {
      const data = await response.json();
      yield data.choices[0].message;
      return;
    }

    for await (const value of streamSse(response)) {
      const chunk = fromChatCompletionChunk(value);
      if (chunk) {
        yield chunk;
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.fetch(this._getEndpoint("models"), {
      method: "GET",
      headers: this._getHeaders(),
    });

    const data = await response.json();
    return data.data.map((m: any) => m.id);
  }

}

export default OpenAI;
