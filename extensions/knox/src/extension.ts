/**
 * This is the entry point for the extension.
 */

import "./util/suppressKnownDeprecations";

import { setupCa } from "core/util/ca";
import * as vscode from "vscode";

import { knoxStartupMark } from "./activation/startupMetrics";
import { t, detectAndApplyLanguage } from "./i18n";


async function dynamicImportAndActivate(context: vscode.ExtensionContext) {
  await setupCa();
  detectAndApplyLanguage();
  const { activateExtension } = await import("./activation/activate");
  return await activateExtension(context);
}

export async function activate(context: vscode.ExtensionContext) {
  knoxStartupMark("activateStart");
  try {
    const result = await dynamicImportAndActivate(context);
    knoxStartupMark("activateDone");
    return result;
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
