import * as vscode from "vscode";

/**
 * This fork's vscode.lm surface (TextModelApi*) is declared in
 * `src/vscode-dts/vscode.d.ts` but the Knox host still typechecks against
 * `@types/vscode`. Access the runtime API through this shim.
 */

export type KnoxLmTextPart = { value: string };
export type KnoxLmToolCallPart = { callId: string; name: string; input: object };
export type KnoxLmToolResultPart = {
  callId: string;
  content: Array<KnoxLmTextPart | unknown>;
};

export interface KnoxLmToolResult {
  content: Array<KnoxLmTextPart | unknown>;
}

export interface KnoxLmTool<T = object> {
  invoke(
    options: { input: T; toolInvocationToken: unknown },
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<KnoxLmToolResult>;
  prepareInvocation?(
    options: { input: T },
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<{
    invocationMessage?: string | vscode.MarkdownString;
    confirmationMessages?: { title: string; message: string | vscode.MarkdownString };
  }>;
}

export interface KnoxLmChatInformation {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  tooltip?: string;
  detail?: string;
  capabilities: { imageInput?: boolean; toolCalling?: boolean | number };
}

export interface KnoxLmAssistRequestMessage {
  role: number;
  content: ReadonlyArray<{ value?: string } | unknown>;
  name?: string;
}

export interface KnoxLmAssistProvider {
  readonly onDidChangeTextModelApiChatInformation?: vscode.Event<void>;
  provideTextModelApiChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<KnoxLmChatInformation[]>;
  provideTextModelApiAssistResponse(
    model: KnoxLmChatInformation,
    messages: readonly KnoxLmAssistRequestMessage[],
    options: { toolMode: number; tools?: unknown },
    progress: vscode.Progress<unknown>,
    token: vscode.CancellationToken,
  ): Thenable<void>;
  provideTokenCount(
    model: KnoxLmChatInformation,
    text: string | KnoxLmAssistRequestMessage,
    token: vscode.CancellationToken,
  ): Thenable<number>;
}

export interface KnoxLmApi {
  registerTool?<T>(name: string, tool: KnoxLmTool<T>): vscode.Disposable;
  registerTextModelApiAssistProvider?(
    vendor: string,
    provider: KnoxLmAssistProvider,
  ): vscode.Disposable;
}

type VsCodeCtor = new (...args: never[]) => unknown;

function vscodeExport<T>(name: string): T | undefined {
  return (vscode as unknown as Record<string, T | undefined>)[name];
}

export const TextModelApiAssistMessageRole = {
  User: 1,
  Assistant: 2,
} as const;

export function knoxLm(): KnoxLmApi {
  return ((vscode as unknown as { lm?: KnoxLmApi }).lm ?? {}) as KnoxLmApi;
}

export function createTextPart(value: string): KnoxLmTextPart {
  const Ctor = vscodeExport<new (value: string) => KnoxLmTextPart>("TextModelApiTextPart");
  return Ctor ? new Ctor(value) : { value };
}

export function createToolCallPart(
  callId: string,
  name: string,
  input: object,
): unknown {
  const Ctor = vscodeExport<
    new (callId: string, name: string, input: object) => unknown
  >("TextModelApiToolCallPart");
  if (Ctor) {
    return new Ctor(callId, name, input);
  }
  return { callId, name, input };
}

export function createToolResult(content: KnoxLmTextPart[]): KnoxLmToolResult {
  const Ctor = vscodeExport<new (content: KnoxLmTextPart[]) => KnoxLmToolResult>(
    "TextModelApiToolResult",
  );
  return Ctor ? new Ctor(content) : { content };
}

export function createModelNotFoundError(message: string): Error {
  const Ctor = vscodeExport<{
    NotFound(message?: string): Error;
  }>("TextModelApiError");
  if (Ctor?.NotFound) {
    return Ctor.NotFound(message);
  }
  return new Error(message);
}

export function isTextPart(part: unknown): part is KnoxLmTextPart {
  const Ctor = vscodeExport<VsCodeCtor>("TextModelApiTextPart");
  if (Ctor && part instanceof Ctor) {
    return true;
  }
  return Boolean(
    part &&
      typeof part === "object" &&
      "value" in part &&
      typeof (part as { value: unknown }).value === "string" &&
      !("callId" in part),
  );
}

export function isToolCallPart(part: unknown): part is KnoxLmToolCallPart {
  const Ctor = vscodeExport<VsCodeCtor>("TextModelApiToolCallPart");
  if (Ctor && part instanceof Ctor) {
    return true;
  }
  return Boolean(
    part &&
      typeof part === "object" &&
      typeof (part as { callId?: unknown }).callId === "string" &&
      typeof (part as { name?: unknown }).name === "string" &&
      (part as { input?: unknown }).input !== undefined,
  );
}

export function isToolResultPart(part: unknown): part is KnoxLmToolResultPart {
  const Ctor = vscodeExport<VsCodeCtor>("TextModelApiToolResultPart");
  if (Ctor && part instanceof Ctor) {
    return true;
  }
  return Boolean(
    part &&
      typeof part === "object" &&
      typeof (part as { callId?: unknown }).callId === "string" &&
      Array.isArray((part as { content?: unknown }).content),
  );
}

export function textPartValue(part: unknown): string {
  if (isTextPart(part)) {
    return part.value;
  }
  return "";
}

export function toolResultPartText(part: KnoxLmToolResultPart): string {
  return part.content
    .map((entry) => textPartValue(entry))
    .filter(Boolean)
    .join("");
}
