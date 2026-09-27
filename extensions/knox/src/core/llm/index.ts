import Handlebars from "handlebars";
import { ModelRole } from "knoxdev-package/config-yaml";
import { fetchwithRequestOptions } from "knoxdev-package/fetch";
import { t } from "../i18n/index.js";
import { findLlmInfo } from "./llmInfo.js";
import {
  BaseLlmApi,
  ChatCompletionCreateParams,
  constructLlmApi,
} from "knoxdev-package/openai-adapters";

import {
  CacheBehavior,
  ChatMessage,
  Chunk,
  CompletionOptions,
  ILLM,
  LLMFullCompletionOptions,
  LLMOptions,
  ModelCapability,
  ModelInstaller,
  PromptLog,
  PromptTemplate,
  RequestOptions,
  TemplateType,
} from "../index.js";
import mergeJson from "../util/merge.js";
import { renderChatMessage } from "../util/messageContent.js";
import { withExponentialBackoff } from "../util/withExponentialBackoff.js";

import {
  autodetectPromptTemplates,
  autodetectTemplateFunction,
  autodetectTemplateType,
  modelSupportsImages,
} from "./autodetect.js";
import {
  CONTEXT_LENGTH_FOR_MODEL,
  DEFAULT_ARGS,
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_TOKENS,
} from "./constants.js";
import {
  compileChatMessages,
  countTokens,
  pruneRawPromptFromTop,
} from "./countTokens.js";
import {
  fromChatCompletionChunk,
  fromChatResponse,
  LlmApiRequestType,
  toChatBody,
  toCompleteBody,
} from "./openaiTypeConverters.js";
import { mapTextToolCallStream } from "./parseTextToolCalls.js";

export class LLMError extends Error {
  constructor(
    message: string,
    public llm: ILLM,
  ) {
    super(message);
  }
}

export function isModelInstaller(provider: any): provider is ModelInstaller {
  return provider && typeof provider.installModel === "function";
}

export abstract class BaseLLM implements ILLM {
  static providerName: string;
  static defaultOptions: Partial<LLMOptions> | undefined = undefined;

  get providerName(): string {
    return (this.constructor as typeof BaseLLM).providerName;
  }

  supportsImages(): boolean {
    return modelSupportsImages(
      this.providerName,
      this.model,
      this.title,
      this.capabilities,
    );
  }

  supportsCompletions(): boolean {
    if (["openai"].includes(this.providerName)) {
      if (
        this._llmOptions.useLegacyCompletionsEndpoint?.valueOf() === false
      ) {
        return false;
      }
    }
    return true;
  }

  supportsPrefill(): boolean {
    return ["anthropic"].includes(this.providerName);
  }

  uniqueId: string;
  model: string;

  title?: string;
  systemMessage?: string;
  contextLength: number;
  maxStopWords?: number | undefined;
  completionOptions: CompletionOptions;
  requestOptions?: RequestOptions;
  template?: TemplateType;
  promptTemplates?: Record<string, PromptTemplate>;
  templateMessages?: (messages: ChatMessage[]) => string;
  writeLog?: (str: string) => Promise<void>;
  llmRequestHook?: (model: string, prompt: string) => any;
  apiKey?: string;

  // knoxProperties
  apiKeyLocation?: string;
  apiBase?: string;

  cacheBehavior?: CacheBehavior;
  capabilities?: ModelCapability;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  roles?: ModelRole[];

  deployment?: string;
  apiVersion?: string;
  apiType?: string;
  region?: string;
  projectId?: string;
  aiGatewaySlug?: string;
  profile?: string | undefined;


  private _llmOptions: LLMOptions;
  protected readonly hasConfiguredContextLength: boolean;
  protected readonly hasConfiguredMaxTokens: boolean;

  protected openaiAdapter?: BaseLlmApi;

  constructor(_options: LLMOptions) {
    this._llmOptions = _options;
    this.hasConfiguredContextLength = _options.contextLength !== undefined;
    this.hasConfiguredMaxTokens =
      _options.completionOptions?.maxTokens !== undefined;

    // Set default options
    const options = {
      title: (this.constructor as typeof BaseLLM).providerName,
      ...(this.constructor as typeof BaseLLM).defaultOptions,
      ..._options,
    };

    this.model = options.model;
    // Use knoxdev-knox-llm-info package to autodetect certain parameters
    const llmInfo = findLlmInfo(this.model);
    const templateType =
      options.template ?? autodetectTemplateType(options.model);

    this.title = options.title;
    this.uniqueId = options.uniqueId ?? "None";
    this.systemMessage = options.systemMessage;
    this.contextLength =
      options.contextLength ?? llmInfo?.contextLength ?? DEFAULT_CONTEXT_LENGTH;
    this.maxStopWords = options.maxStopWords ?? this.maxStopWords;
    this.completionOptions = {
      ...options.completionOptions,
      model: options.model || "gpt-4",
      maxTokens:
        options.completionOptions?.maxTokens ??
        (llmInfo?.maxCompletionTokens
          ? Math.min(
              llmInfo.maxCompletionTokens,
              // Even if the model has a large maxTokens, we don't want to use that every time,
              // because it takes away from the context length
              this.contextLength / 4,
            )
          : DEFAULT_MAX_TOKENS),
    };
    this.requestOptions = options.requestOptions;
    this.promptTemplates = {
      ...autodetectPromptTemplates(options.model, templateType),
      ...options.promptTemplates,
    };
    this.templateMessages =
      options.templateMessages ??
      autodetectTemplateFunction(
        options.model,
        this.providerName,
        options.template,
      ) ??
      undefined;
    this.writeLog = options.writeLog;
    this.llmRequestHook = options.llmRequestHook;
    this.apiKey = options.apiKey;

    // knoxProperties
    this.apiKeyLocation = options.apiKeyLocation;
    this.apiBase = options.apiBase;

    this.aiGatewaySlug = options.aiGatewaySlug;
    this.cacheBehavior = options.cacheBehavior;

    if (this.apiBase && !this.apiBase.endsWith("/")) {
      this.apiBase = `${this.apiBase}/`;
    }
    this.capabilities = options.capabilities;
    this.supportedParameters = options.supportedParameters;
    this.inputModalities = options.inputModalities;
    this.outputModalities = options.outputModalities;
    this.roles = options.roles;

    this.openaiAdapter = this.createOpenAiAdapter();

  }

  protected createOpenAiAdapter() {
    return constructLlmApi({
      provider: this.providerName as any,
      apiKey: this.apiKey ?? "",
      apiBase: this.apiBase,
      requestOptions: this.requestOptions,
    });
  }

  listModels(): Promise<string[]> {
    return Promise.resolve([]);
  }

  private _compileChatMessages(
    options: CompletionOptions,
    messages: ChatMessage[],
    functions?: any[],
  ) {
    let contextLength = this.contextLength;
    if (
      options.model !== this.model &&
      options.model in CONTEXT_LENGTH_FOR_MODEL
    ) {
      contextLength =
        CONTEXT_LENGTH_FOR_MODEL[options.model] || DEFAULT_CONTEXT_LENGTH;
    }

    return compileChatMessages(
      options.model,
      messages,
      contextLength,
      options.maxTokens ?? DEFAULT_MAX_TOKENS,
      this.supportsImages(),
      undefined,
      functions,
      this.systemMessage,
    );
  }

  /**
   * System message for completion / templated-prompt paths.
   * Already the merged config value (YAML/JSON `rules[]` + `.knoxrules`) set on
   * this LLM at construction. Chat-path merging with DEFAULT_SYSTEM_MESSAGE and
   * per-turn injects happens in `constructMessages` + `compileChatMessages`
   * (see `core/config/rules.ts` merge order).
   */
  private _getSystemMessage(): string | undefined {
    const msg = this.systemMessage?.trim();
    return msg ? msg : undefined;
  }

  private _templatePromptLikeMessages(prompt: string): string {
    if (!this.templateMessages) {
      return prompt;
    }

    const msgs: ChatMessage[] = [{ role: "user", content: prompt }];

    const systemMessage = this._getSystemMessage();
    if (systemMessage) {
      msgs.unshift({ role: "system", content: systemMessage });
    }

    return this.templateMessages(msgs);
  }

  private _compilePromptForLog(
    prompt: string,
    completionOptions: CompletionOptions,
  ): string {
    const completionOptionsLog = JSON.stringify(
      {
        contextLength: this.contextLength,
        ...completionOptions,
      },
      null,
      2,
    );

    let requestOptionsLog = "";
    if (this.requestOptions) {
      requestOptionsLog = JSON.stringify(this.requestOptions, null, 2);
    }

    return (
      "##### Completion options #####\n" +
      completionOptionsLog +
      (requestOptionsLog
        ? "\n\n##### Request options #####\n" + requestOptionsLog
        : "") +
      "\n\n##### Prompt #####\n" +
      prompt
    );
  }

  private _logTokensGenerated(
    _model: string,
    _prompt: string,
    _completion: string,
  ) {
    // Usage billing is tracked by KnoxChat at the provider — no local token log.
  }

  fetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Custom Node.js fetch
    const customFetch = async (input: URL | RequestInfo, init: any) => {
      try {
        const resp = await fetchwithRequestOptions(
          new URL(input as any),
          { ...init },
          { ...this.requestOptions },
        );

        // Error mapping to be more helpful
        if (!resp.ok) {
          let text = await resp.text();
          if (resp.status === 404 && !resp.url.includes("/v1")) {
            const error = JSON.parse(text)?.error?.replace(/"/g, "'");
            let model = error?.match(/model '(.*)' not found/)?.[1];
            if (model && resp.url.match("127.0.0.1:11434")) {
              text = `The model "${model}" was not found.`;
              throw new LLMError(text, this); // No need to add HTTP status details
            } else if (text.includes("/api/chat")) {
              text = "The /api/chat endpoint was not found.";
            } else {
              text =
                "This may mean that you forgot to add '/v1' to the end of your 'apiBase' in config.json.";
            }
          } else if (
            resp.status === 404 &&
            resp.url.includes("api.openai.com")
          ) {
            text =
              "You may need to add pre-paid credits before using the OpenAI API.";
          }
          throw new Error(
            `HTTP ${resp.status} ${resp.statusText} from ${resp.url}\n\n${text}`,
          );
        }

        return resp;
      } catch (e: any) {
        // Errors to ignore
        if (e.message.includes("/api/tags")) {
          throw new Error(t("errorFetchingTags", { message: e.message }));
        } else if (e.message.includes("/api/show")) {
          throw new Error(
            `HTTP ${e.response.status} ${e.response.statusText} from ${e.response.url}\n\n${e.response.body}`,
          );
        } else {
          if (e.name !== "AbortError") {
            // Don't pollute console with abort errors. Check on name instead of instanceof, to avoid importing node-fetch here
            console.debug(
              `${e.message}\n\nCode: ${e.code}\nError number: ${e.errno}\nSyscall: ${e.erroredSysCall}\nType: ${e.type}\n\n${e.stack}`,
            );
          }

        }
        //if e instance of LLMError, rethrow
        if (e instanceof LLMError) {
          throw e;
        }
        throw new Error(e.message);
      }
    };
    return withExponentialBackoff<Response>(
      () => customFetch(url, init) as any,
      5,
      0.5,
    );
  }

  private _parseCompletionOptions(options: LLMFullCompletionOptions) {
    const log = options.log ?? true;
    const raw = options.raw ?? false;
    options.log = undefined;

    const completionOptions: CompletionOptions = mergeJson(
      this.completionOptions,
      options,
    );

    return { completionOptions, logEnabled: log, raw };
  }

  protected async _prepareCompletionOptions(
    completionOptions: CompletionOptions,
  ): Promise<CompletionOptions> {
    return completionOptions;
  }

  private _formatChatMessages(messages: ChatMessage[]): string {
    const msgsCopy = messages ? messages.map((msg) => ({ ...msg })) : [];
    let formatted = "";
    for (const msg of msgsCopy) {
      let contentToShow = "";
      if (msg.role === "tool") {
        contentToShow = msg.content;
      } else if (msg.role === "assistant" && msg.toolCalls) {
        contentToShow = msg.toolCalls
          ?.map(
            (toolCall) =>
              `${toolCall.function?.name}(${toolCall.function?.arguments})`,
          )
          .join("\n");
      } else if ("content" in msg) {
        if (Array.isArray(msg.content)) {
          msg.content = renderChatMessage(msg);
        }
        contentToShow = msg.content;
      }

      formatted += `<${msg.role}>\n${contentToShow}\n\n`;
    }
    return formatted;
  }

  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [];

  private shouldUseOpenAIAdapter(requestType: LlmApiRequestType) {
    return (
      this.useOpenAIAdapterFor.includes(requestType) ||
      this.useOpenAIAdapterFor.includes("*")
    );
  }

  async *streamComplete(
    _prompt: string,
    signal: AbortSignal,
    options: LLMFullCompletionOptions = {},
  ) {
    let { completionOptions, logEnabled, raw } =
      this._parseCompletionOptions(options);
    completionOptions = await this._prepareCompletionOptions(completionOptions);

    let prompt = pruneRawPromptFromTop(
      completionOptions.model,
      this.contextLength,
      _prompt,
      completionOptions.maxTokens ?? DEFAULT_MAX_TOKENS,
    );

    if (!raw) {
      prompt = this._templatePromptLikeMessages(prompt);
    }

    if (logEnabled) {
      if (this.writeLog) {
        await this.writeLog(
          this._compilePromptForLog(prompt, completionOptions),
        );
      }
      if (this.llmRequestHook) {
        this.llmRequestHook(completionOptions.model, prompt);
      }
    }

    let completion = "";
    try {
      if (this.shouldUseOpenAIAdapter("streamComplete") && this.openaiAdapter) {
        if (completionOptions.stream === false) {
          // Stream false
          const response = await this.openaiAdapter.completionNonStream(
            { ...toCompleteBody(prompt, completionOptions), stream: false },
            signal,
          );
          completion = response.choices[0]?.text ?? "";
          yield completion;
        } else {
          // Stream true
          for await (const chunk of this.openaiAdapter.completionStream(
            {
              ...toCompleteBody(prompt, completionOptions),
              stream: true,
            },
            signal,
          )) {
            const content = chunk.choices[0]?.text ?? "";
            completion += content;
            yield content;
          }
        }
      } else {
        for await (const chunk of this._streamComplete(
          prompt,
          signal,
          completionOptions,
        )) {
          completion += chunk;
          yield chunk;
        }
      }
    } finally {
      this._logTokensGenerated(completionOptions.model, prompt, completion);

      if (logEnabled && this.writeLog) {
        await this.writeLog(`Completion:\n${completion}\n\n`);
      }
    }

    return {
      modelTitle: this.title ?? completionOptions.model,
      prompt,
      completion,
      completionOptions,
    };
  }

  async complete(
    _prompt: string,
    signal: AbortSignal,
    options: LLMFullCompletionOptions = {},
  ) {
    let { completionOptions, logEnabled, raw } =
      this._parseCompletionOptions(options);
    completionOptions = await this._prepareCompletionOptions(completionOptions);

    let prompt = pruneRawPromptFromTop(
      completionOptions.model,
      this.contextLength,
      _prompt,
      completionOptions.maxTokens ?? DEFAULT_MAX_TOKENS,
    );

    if (!raw) {
      prompt = this._templatePromptLikeMessages(prompt);
    }

    if (logEnabled) {
      if (this.writeLog) {
        await this.writeLog(
          this._compilePromptForLog(prompt, completionOptions),
        );
      }
      if (this.llmRequestHook) {
        this.llmRequestHook(completionOptions.model, prompt);
      }
    }

    let completion: string;
    if (this.shouldUseOpenAIAdapter("complete") && this.openaiAdapter) {
      const result = await this.openaiAdapter.completionNonStream(
        {
          ...toCompleteBody(prompt, completionOptions),
          stream: false,
        },
        signal,
      );
      completion = result.choices[0].text;
    } else {
      completion = await this._complete(prompt, signal, completionOptions);
    }

    this._logTokensGenerated(completionOptions.model, prompt, completion);

    if (logEnabled && this.writeLog) {
      await this.writeLog(`Completion:\n${completion}\n\n`);
    }

    return completion;
  }

  async chat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: LLMFullCompletionOptions = {},
  ) {
    let completion = "";
    for await (const chunk of this.streamChat(messages, signal, options)) {
      completion += chunk.content;
    }
    return { role: "assistant" as const, content: completion };
  }

  protected modifyChatBody(
    body: ChatCompletionCreateParams,
  ): ChatCompletionCreateParams {
    return body;
  }

  private _modifyCompletionOptions(
    completionOptions: CompletionOptions,
  ): CompletionOptions {
    // As of 01/14/25 streaming is currently not available with o1
    // See these threads:
    // - https://github.com/knoxdev/knox/issues/3698
    // - https://community.openai.com/t/streaming-support-for-o1-o1-2024-12-17-resulting-in-400-unsupported-value/1085043
    // Bare legacy o1 only — never openai/* KnoxChat IDs
    const bareModel = completionOptions.model.includes("/")
      ? completionOptions.model.split("/").pop()!
      : completionOptions.model;
    if (bareModel === "o1") {
      completionOptions.stream = false;
    }

    return completionOptions;
  }

  async *streamChat(
    _messages: ChatMessage[],
    signal: AbortSignal,
    options: LLMFullCompletionOptions = {},
  ): AsyncGenerator<ChatMessage, PromptLog> {
    let { completionOptions, logEnabled } =
      this._parseCompletionOptions(options);

    completionOptions = await this._prepareCompletionOptions(completionOptions);
    completionOptions = this._modifyCompletionOptions(completionOptions);

    const messages = this._compileChatMessages(completionOptions, _messages);

    const prompt = this.templateMessages
      ? this.templateMessages(messages)
      : this._formatChatMessages(messages);
    if (logEnabled) {
      if (this.writeLog) {
        await this.writeLog(
          this._compilePromptForLog(prompt, completionOptions),
        );
      }
      if (this.llmRequestHook) {
        this.llmRequestHook(completionOptions.model, prompt);
      }
    }

    let thinking = "";
    let completion = "";
    const extra = { citations: null as string[] | null };

    const rawChunks = async function* (this: BaseLLM): AsyncGenerator<ChatMessage> {
      if (this.templateMessages) {
        for await (const chunk of this._streamComplete(
          prompt,
          signal,
          completionOptions,
        )) {
          yield { role: "assistant", content: chunk };
        }
        return;
      }

      if (this.shouldUseOpenAIAdapter("streamChat") && this.openaiAdapter) {
        let body = toChatBody(messages, completionOptions);
        body = this.modifyChatBody(body) as any;

        if (completionOptions.stream === false) {
          const response = await this.openaiAdapter.chatCompletionNonStream(
            { ...body, stream: false },
            signal,
          );
          yield fromChatResponse(response as any);
          return;
        }

        const stream = this.openaiAdapter.chatCompletionStream(
          {
            ...body,
            stream: true,
          },
          signal,
        );
        for await (const chunk of stream) {
          const result = fromChatCompletionChunk(chunk as any);
          if (result) {
            yield result;
          }
          if (
            !extra.citations &&
            (chunk as any).citations &&
            Array.isArray((chunk as any).citations)
          ) {
            extra.citations = (chunk as any).citations;
          }
        }
        return;
      }

      for await (const chunk of this._streamChat(
        messages,
        signal,
        completionOptions,
      )) {
        yield chunk;
      }
    }.bind(this);

    try {
      // Convert leaked DSML / XML / Hermes tool markup into structured
      // toolCalls so the agent loop executes them instead of printing tags.
      for await (const chunk of mapTextToolCallStream(rawChunks())) {
        if (chunk.role === "assistant") {
          completion +=
            typeof chunk.content === "string"
              ? chunk.content
              : renderChatMessage(chunk);
        }
        if (chunk.role === "thinking") {
          thinking +=
            typeof chunk.content === "string" ? chunk.content : "";
        }
        yield chunk;
      }
    } catch (error) {
      console.log(error);
      throw error;
    }

    this._logTokensGenerated(completionOptions.model, prompt, completion);

    if (logEnabled && this.writeLog) {
      if (thinking) {
        await this.writeLog(`Thinking:\n${thinking}\n\n`);
      }

      await this.writeLog(`Completion:\n${completion}\n\n`);

      if (extra.citations) {
        await this.writeLog(
          `Citations:\n${extra.citations.map((c, i) => `${i + 1}: ${c}`).join("\n")}\n\n`,
        );
      }
    }

    return {
      modelTitle: this.title ?? completionOptions.model,
      prompt,
      completion,
      completionOptions,
    };
  }



  protected async *_streamComplete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    throw new Error(t("notImplemented"));
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    if (!this.templateMessages) {
      throw new Error(
        "You must either implement templateMessages or _streamChat",
      );
    }

    for await (const chunk of this._streamComplete(
      this.templateMessages(messages),
      signal,
      options,
    )) {
      yield { role: "assistant", content: chunk };
    }
  }

  protected async _complete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ) {
    let completion = "";
    for await (const chunk of this._streamComplete(prompt, signal, options)) {
      completion += chunk;
    }
    return completion;
  }


  countTokens(text: string): number {
    return countTokens(text, this.model);
  }

  protected collectArgs(options: CompletionOptions): any {
    return {
      ...DEFAULT_ARGS,
      // model: this.model,
      ...options,
    };
  }

  public renderPromptTemplate(
    template: PromptTemplate,
    history: ChatMessage[],
    otherData: Record<string, string>,
    canPutWordsInModelsMouth = false,
  ): string | ChatMessage[] {
    if (typeof template === "string") {
      const data: any = {
        history: history,
        ...otherData,
      };
      if (history.length > 0 && history[0].role === "system") {
        data.system_message = history.shift()!.content;
      }

      const compiledTemplate = Handlebars.compile(template);
      return compiledTemplate(data);
    }
    const rendered = template(history, {
      ...otherData,
      supportsCompletions: this.supportsCompletions() ? "true" : "false",
      supportsPrefill: this.supportsPrefill() ? "true" : "false",
    });
    if (
      typeof rendered !== "string" &&
      rendered[rendered.length - 1]?.role === "assistant" &&
      !canPutWordsInModelsMouth
    ) {
      // Some providers don't allow you to put words in the model's mouth
      // So we have to manually compile the prompt template and use
      // raw /completions, not /chat/completions
      const templateMessages = autodetectTemplateFunction(
        this.model,
        this.providerName,
        autodetectTemplateType(this.model),
      );
      if (templateMessages) {
        return templateMessages(rendered);
      }
    }
    return rendered;
  }
}
