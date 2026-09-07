import { ToolCall, ContextItem } from "core";
import { setRipgrepAppRoot } from "core/tools/ripgrep";
import { setTreeSitterAssetRoot } from "core/util/treeSitter";
import * as vscode from "vscode";

import { activateAgentMode } from "../agent";
import { VsCodeExtension } from "../extension/VsCodeExtension";
import registerQuickFixProvider from "../lang-server/codeActions";
import { installHostNativePty } from "../util/installNativePty";
import { KNOX_MARKETPLACE_EXTENSION_ID } from "../util/vscode";

import { VsCodeKnoxApi } from "./api";
import setupInlineTips from "./InlineTipManager";

function warnIfMarketplaceKnoxActive(): void {
  const marketplace = vscode.extensions.getExtension(KNOX_MARKETPLACE_EXTENSION_ID);
  if (marketplace?.isActive) {
    console.warn(
      `[knox] ${KNOX_MARKETPLACE_EXTENSION_ID} is active alongside vscode.knox; the marketplace copy should be disabled by the product.`,
    );
  }
}

export async function activateExtension(context: vscode.ExtensionContext) {
  const { knoxStartupMark } = await import("./startupMetrics");
  knoxStartupMark("activateExtension");
  warnIfMarketplaceKnoxActive();
  setRipgrepAppRoot(vscode.env.appRoot);
  setTreeSitterAssetRoot(context.extensionPath);
  // Product node-pty only — never copy pty into the extension (T5.2).
  installHostNativePty(context);
  registerQuickFixProvider();
  setupInlineTips(context);

  const vscodeExtension = new VsCodeExtension(context);
  knoxStartupMark("vscodeExtensionConstructed");

  const agentModeDisposable = activateAgentMode(context);
  context.subscriptions.push(agentModeDisposable);
  knoxStartupMark("agentCommandsRegistered");

  // Legacy alias for users who remapped the old keybinding command id
  context.subscriptions.push(
    vscode.commands.registerCommand('knox.toggleAgentModeCommand', () => {
      return vscode.commands.executeCommand('knox.toggleAgentMode');
    })
  );

  if (!context.globalState.get("hasBeenInstalled")) {
    context.globalState.update("hasBeenInstalled", true);
  }

  const api = new VsCodeKnoxApi(vscodeExtension);
  
  interface AgentModeAPI {
    isAgentModeActive: () => Promise<boolean>;
    toggleAgentMode: () => Promise<void>;
    executeToolCall: (toolCall: ToolCall, selectedModelTitle: string) => Promise<ContextItem[]>;
  }
  
  const knoxPublicApi = {
    registerCustomContextProvider: api.registerCustomContextProvider.bind(api),
    agentMode: {
      isAgentModeActive: () => {
        return vscode.commands.executeCommand<boolean>('knox.isAgentModeActive');
      },
      toggleAgentMode: () => {
        return vscode.commands.executeCommand<void>('knox.toggleAgentMode');
      },
      executeToolCall: (toolCall: ToolCall, selectedModelTitle: string) => {
        return vscode.commands.executeCommand<ContextItem[]>('knox.executeToolCall', { toolCall, selectedModelTitle });
      }
    } as AgentModeAPI
  };

  return process.env.NODE_ENV === "test"
    ? {
        ...knoxPublicApi,
        extension: vscodeExtension,
      }
    : knoxPublicApi;
}
