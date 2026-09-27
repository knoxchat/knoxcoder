/**
 * This is the entry point for the extension.
 */

import "./util/suppressKnownDeprecations";

import { setupCa } from "core/util/ca";
import * as vscode from "vscode";

import {
  shouldSkipMarketplaceActivation,
} from "./activation/marketplaceConflict";
import { isKnoxWebHost } from "./activation/remoteNativeAddons";
import { t, detectAndApplyLanguage } from "./i18n";
import { initGuiLanguage } from "./i18n/guiLanguage";


async function dynamicImportAndActivate(context: vscode.ExtensionContext) {
  const knoxOutput = vscode.window.createOutputChannel("Knox");
  context.subscriptions.push(knoxOutput);
  knoxOutput.appendLine("Knox extension activating.");
  await setupCa();
  detectAndApplyLanguage();
  initGuiLanguage(context.globalState);
  const { activateExtension } = await import("./activation/activate");
  const result = await activateExtension(context);
  knoxOutput.appendLine("Knox extension activated.");
  return result;
}

export async function activate(context: vscode.ExtensionContext) {
  if (
    shouldSkipMarketplaceActivation({
      thisExtensionId: context.extension.id,
      builtinPresent: Boolean(vscode.extensions.getExtension("vscode.knox")),
    })
  ) {
    return undefined;
  }
  // KN-365: sqlite/pty are Node addons — never activate in vscode-web.
  if (isKnoxWebHost(vscode.env.uiKind, vscode.UIKind.Web)) {
    detectAndApplyLanguage();
    void vscode.window.showErrorMessage(t("ext.desktopOnly"));
    return undefined;
  }
  try {
    return await dynamicImportAndActivate(context);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    const errorStack = e instanceof Error ? e.stack : undefined;
    console.error("Error activating extension: ", e);
    console.error("Error message: ", errorMessage);
    console.error("Error stack: ", errorStack);
    
    // Create output channel and log the error there for visibility
    const outputChannel = vscode.window.createOutputChannel("Knox Activation Error");
    outputChannel.appendLine(`Error activating Knox extension:`);
    outputChannel.appendLine(`Message: ${errorMessage}`);
    if (errorStack) {
      outputChannel.appendLine(`Stack: ${errorStack}`);
    }
    outputChannel.show();
    
    vscode.window
      .showWarningMessage(t("ext.activationError", { message: errorMessage }), t("ext.viewLogs"), t("ext.retry"))
      .then((selection) => {
        if (selection === t("ext.viewLogs")) {
          vscode.commands.executeCommand("knoxchat.viewLogs");
        } else if (selection === t("ext.retry")) {
          // Reload VS Code window
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  }
}

export async function deactivate() {
  // Extension teardown is handled by VsCodeExtension / agent disposables.
}
