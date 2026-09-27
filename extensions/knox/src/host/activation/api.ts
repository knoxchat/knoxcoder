import { IContextProvider } from "core";
import * as vscode from "vscode";

import {
  isAgentModeActive,
} from "../agent";
import {
  KNOX_EXECUTE_TOOL_CALL_COMMAND,
  KNOX_NEW_SESSION_COMMAND,
  KNOX_OPEN_CHAT_COMMAND,
  KNOX_TOGGLE_AGENT_MODE_COMMAND,
  toCoreToolCall,
  toPublicContextItems,
  wrapCustomContextProvider,
} from "./knoxPublicApi";

import type { VsCodeExtension } from "../extension/VsCodeExtension";
import type {
  API,
  ContextItem,
  CustomContextProvider,
  KnoxGuiMessage,
  OpenChatOptions,
  ToolCall,
} from "../../api/knox";

/**
 * KN-364: version-1 KnoxAPI (Git analog: `ApiImpl` in api1.ts).
 * Types come from `src/api/knox.d.ts` — the file other extensions copy.
 */
export class KnoxApiImpl implements API {
  readonly onDidReceiveGuiMessage: vscode.Event<KnoxGuiMessage>;

  constructor(
    private readonly vscodeExtension: VsCodeExtension,
    readonly onDidChangeAgentMode: vscode.Event<boolean>,
  ) {
    this.onDidReceiveGuiMessage = vscodeExtension.onDidSendGuiMessage;
  }

  isAgentModeActive(): Thenable<boolean> {
    return Promise.resolve(isAgentModeActive());
  }

  toggleAgentMode(): Thenable<void> {
    return vscode.commands.executeCommand<void>(KNOX_TOGGLE_AGENT_MODE_COMMAND);
  }

  async executeToolCall(
    toolCall: ToolCall,
    selectedModelTitle: string,
  ): Promise<ContextItem[]> {
    const items = await vscode.commands.executeCommand<
      Array<{
        name?: string;
        description?: string;
        content?: string;
        uri?: { type?: string; value?: string };
      }>
    >(KNOX_EXECUTE_TOOL_CALL_COMMAND, {
      toolCall: toCoreToolCall(toolCall),
      selectedModelTitle,
    });
    return toPublicContextItems(items);
  }

  registerCustomContextProvider(provider: CustomContextProvider): void {
    this.vscodeExtension.registerCustomContextProvider(
      wrapCustomContextProvider(provider) as IContextProvider,
    );
  }

  openChat(options?: OpenChatOptions): Thenable<void> {
    return vscode.commands.executeCommand<void>(KNOX_OPEN_CHAT_COMMAND, options);
  }

  newSession(): Thenable<void> {
    return vscode.commands.executeCommand<void>(KNOX_NEW_SESSION_COMMAND);
  }

  handleGuiMessage(message: KnoxGuiMessage): Thenable<void> {
    return this.vscodeExtension.receiveNativeGuiMessage(message);
  }
}
