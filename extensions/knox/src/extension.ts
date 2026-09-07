/**
 * This is the entry point for the extension.
 */

import "./util/suppressKnownDeprecations";

import * as vscode from "vscode";

import { knoxStartupMark } from "./activation/startupMetrics";
import { t, detectAndApplyLanguage } from "./i18n";

const KNOX_GUI_VIEW_TYPE = "knoxchat.knoxGUIView";

/**
 * System CA import (`mac-ca`) can stall under hardened runtime / keychain
 * access in notarized macOS builds. Never block the sidebar on it.
 */
function scheduleSetupCa(): void {
  setTimeout(() => {
    void import("core/util/ca").then(({ setupCa }) => setupCa());
  }, 0);
}

function activationFailureHtml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Knox</title>
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
          code { user-select: text; }
        </style>
      </head>
      <body>
        <h1>Knox failed to activate</h1>
        <p>The sidebar host loaded, but the extension did not finish starting.</p>
        <p><code>${escaped}</code></p>
        <p>Open <strong>Knox Activation Error</strong> in the Output panel for the stack.</p>
      </body>
    </html>`;
}

/**
 * If Core/sqlite fails before VsCodeExtension registers the view, the workbench
 * otherwise waits forever on the webview resolver (infinite loading bar).
 */
function tryRegisterFallbackWebview(
  context: vscode.ExtensionContext,
  message: string,
): void {
  try {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        KNOX_GUI_VIEW_TYPE,
        {
          resolveWebviewView(webviewView) {
            webviewView.webview.options = { enableScripts: true };
            webviewView.webview.html = activationFailureHtml(message);
          },
        },
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
    );
  } catch (err) {
    console.warn("[knox] fallback webview not registered:", err);
  }
}

async function dynamicImportAndActivate(context: vscode.ExtensionContext) {
  scheduleSetupCa();
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

    const outputChannel = vscode.window.createOutputChannel("Knox Activation Error");
    outputChannel.appendLine(`Error activating Knox extension:`);
    outputChannel.appendLine(`Message: ${errorMessage}`);
    if (errorStack) {
      outputChannel.appendLine(`Stack: ${errorStack}`);
    }
    outputChannel.show();

    tryRegisterFallbackWebview(context, errorMessage);

    vscode.window
      .showWarningMessage(t("ext.activationError", { message: errorMessage }), t("ext.viewLogs"), t("ext.retry"))
      .then((selection) => {
        if (selection === t("ext.viewLogs")) {
          vscode.commands.executeCommand("knoxchat.viewLogs");
        } else if (selection === t("ext.retry")) {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  }
}

export async function deactivate() {
  // Extension teardown is handled by VsCodeExtension / agent disposables.
}
