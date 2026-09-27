import { ILLM } from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { countTokens } from "core/llm/countTokens";
import * as vscode from "vscode";

import {
  chatChunkToLmParts,
  completionOptionsForLmRequest,
  KNOX_LM_VENDOR,
  lmMessagesToChatMessages,
  type KnoxLmBridgeMessage,
  type KnoxLmBridgePart,
} from "./knoxLmBridge";
import {
  createModelNotFoundError,
  createTextPart,
  createToolCallPart,
  isToolCallPart,
  isToolResultPart,
  knoxLm,
  textPartValue,
  toolResultPartText,
  type KnoxLmAssistProvider,
  type KnoxLmAssistRequestMessage,
  type KnoxLmChatInformation,
} from "./lmApi";

/**
 * KN-362: KnoxChat / configured models as a `vscode.lm` assist provider
 * (`vendor: knox`). Tool calls stay on the caller; registered
 * `textModelApiTools` execute through Core `tools/call`.
 */
export class KnoxTextModelApiAssistProvider
  implements KnoxLmAssistProvider, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTextModelApiChatInformation = this._onDidChange.event;

  constructor(private readonly configHandler: ConfigHandler) {
    this.configHandler.onConfigUpdate(() => this._onDidChange.fire());
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  async provideTextModelApiChatInformation(
    _options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<KnoxLmChatInformation[]> {
    const { config } = await this.configHandler.loadConfig();
    const models = config?.modelsByRole?.chat?.length
      ? config.modelsByRole.chat
      : (config?.models ?? []);
    return models.map((model) => this.toInformation(model));
  }

  async provideTextModelApiAssistResponse(
    model: KnoxLmChatInformation,
    messages: readonly KnoxLmAssistRequestMessage[],
    options: { toolMode: number; tools?: unknown },
    progress: vscode.Progress<unknown>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const llm = await this.resolveLlm(model.id);
    const abort = new AbortController();
    const cancel = token.onCancellationRequested(() => abort.abort());
    try {
      for await (const chunk of llm.streamChat(
        lmMessagesToChatMessages(messages.map(toBridgeMessage)),
        abort.signal,
        completionOptionsForLmRequest(options),
      )) {
        if (token.isCancellationRequested) {
          break;
        }
        for (const part of chatChunkToLmParts(chunk)) {
          const reported = toProgressPart(part);
          if (reported !== undefined) {
            progress.report(reported);
          }
        }
      }
    } finally {
      cancel.dispose();
    }
  }

  async provideTokenCount(
    model: KnoxLmChatInformation,
    text: string | KnoxLmAssistRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return countTokens(text, model.id);
    }
    return countTokens(
      text.content.map((part) => textPartValue(part)).join(""),
      model.id,
    );
  }

  private toInformation(model: ILLM): KnoxLmChatInformation {
    return {
      id: model.title ?? model.model,
      name: model.title ?? model.model,
      family: model.model,
      version: model.uniqueId ?? "1",
      maxInputTokens: model.contextLength,
      maxOutputTokens: model.completionOptions?.maxTokens ?? 4096,
      tooltip: `${model.providerName} / ${model.model}`,
      detail: model.providerName,
      capabilities: {
        imageInput: Boolean(model.supportsImages()),
        toolCalling: true,
      },
    };
  }

  private async resolveLlm(modelId: string): Promise<ILLM> {
    try {
      return await this.configHandler.llmFromTitle(modelId);
    } catch {
      const { config } = await this.configHandler.loadConfig();
      const fallback = config?.selectedModelByRole?.chat ?? config?.models?.[0];
      if (!fallback) {
        throw createModelNotFoundError(
          `No Knox model configured (looked up ${modelId}).`,
        );
      }
      return fallback;
    }
  }
}

export function registerKnoxAssistProvider(
  _context: vscode.ExtensionContext,
  configHandler: ConfigHandler,
): vscode.Disposable {
  const lm = knoxLm();
  const register = lm.registerTextModelApiAssistProvider?.bind(lm);
  if (typeof register !== "function") {
    return { dispose() {} };
  }
  const provider = new KnoxTextModelApiAssistProvider(configHandler);
  return vscode.Disposable.from(provider, register(KNOX_LM_VENDOR, provider));
}

function toBridgeMessage(message: KnoxLmAssistRequestMessage): KnoxLmBridgeMessage {
  const parts: KnoxLmBridgePart[] = [];
  for (const part of message.content) {
    if (isToolCallPart(part)) {
      parts.push({
        kind: "toolCall",
        callId: part.callId,
        name: part.name,
        input: part.input,
      });
      continue;
    }
    if (isToolResultPart(part)) {
      parts.push({
        kind: "toolResult",
        callId: part.callId,
        content: toolResultPartText(part),
      });
      continue;
    }
    const value = textPartValue(part);
    if (value) {
      parts.push({ kind: "text", value });
    }
  }
  return { role: message.role, parts };
}

function toProgressPart(part: KnoxLmBridgePart): unknown | undefined {
  if (part.kind === "text") {
    return createTextPart(part.value);
  }
  if (part.kind === "toolCall") {
    return createToolCallPart(part.callId, part.name, part.input);
  }
  return undefined;
}
