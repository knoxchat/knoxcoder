import { ConfigHandler } from "core/config/ConfigHandler";
import * as vscode from "vscode";

import { t } from "./i18n";
import { getTheme } from "./util/getTheme";
import { affectsGuiTheme, colorsFromConvertedTheme } from "./util/guiTheme";
import { getNonce, useKnoxViteDevServer } from "./util/vscode";
import { applyKnoxWebviewOptions, renderKnoxWebviewHtml } from "./webviewHtml";
import { VsCodeWebviewProtocol } from "./webviewProtocol";
import {
  WEBVIEW_HEARTBEAT_INTERVAL_MS,
  applyWatchdogFocus,
  applyWatchdogHeartbeat,
  applyWatchdogReload,
  applyWatchdogUserReload,
  applyWatchdogViewReady,
  applyWatchdogVisibility,
  decideWebviewWatchdog,
  initialWebviewWatchdogState,
  type WebviewWatchdogState,
} from "./webviewWatchdog";

import type { FileEdit } from "core";

export class KnoxGUIWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "knoxchat.knoxGUIView";
  public webviewProtocol: VsCodeWebviewProtocol;

  public get isReady(): boolean {
    return !!this.webview;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._webviewView = webviewView;
    this._webview = webviewView.webview;
    this._watchdogState = applyWatchdogViewReady(
      this._watchdogState,
      Date.now(),
      webviewView.visible,
      vscode.window.state.focused,
    );
    this._showingPlaceholder = false;
    this._visibilityListener?.dispose();
    this._visibilityListener = webviewView.onDidChangeVisibility(() => {
      this._watchdogState = applyWatchdogVisibility(
        this._watchdogState,
        this._webviewView?.visible ?? false,
        Date.now(),
      );
      this.recoverPlaceholderIfWatched();
    });
    webviewView.webview.html = this.getSidebarContent(
      this.extensionContext,
      webviewView,
    );
  }

  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;
  private _themeListener?: vscode.Disposable;
  private _colorThemeListener?: vscode.Disposable;
  private _didPushGuiTheme = false;
  private _visibilityListener?: vscode.Disposable;
  private _windowStateListener?: vscode.Disposable;
  private _watchdogTimer?: ReturnType<typeof setInterval>;
  private _watchdogState: WebviewWatchdogState = initialWebviewWatchdogState();
  private _showingPlaceholder = false;

  get isVisible() {
    return this._webviewView?.visible;
  }

  get webview() {
    return this._webview;
  }

  public resetWebviewProtocolWebview(): void {
    if (this._webview) {
      this.webviewProtocol.webview = this._webview;
    } else {
      console.warn("No webview found when resetting");
    }
  }

  constructor(
    private readonly configHandlerPromise: Promise<ConfigHandler>,
    private readonly windowId: string,
    private readonly extensionContext: vscode.ExtensionContext,
  ) {
    this.webviewProtocol = new VsCodeWebviewProtocol(
      (async () => {
        const configHandler = await this.configHandlerPromise;
        return configHandler.reloadConfig();
      }).bind(this),
    );
    this.webviewProtocol.on("knox/heartbeat", () => {
      this._watchdogState = applyWatchdogHeartbeat(
        this._watchdogState,
        Date.now(),
      );
      this._showingPlaceholder = false;
      this.pushGuiThemeOnce();
    });
    this._themeListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (affectsGuiTheme((key) => e.affectsConfiguration(key))) {
        this.pushGuiTheme();
      }
    });
    this._colorThemeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      this.pushGuiTheme();
    });
    this.webviewProtocol.on("knox/reloadWebview", () => {
      this.reloadSidebar("user");
    });
    this._watchdogState = {
      ...this._watchdogState,
      focused: vscode.window.state.focused,
    };
    this._windowStateListener = vscode.window.onDidChangeWindowState(
      (windowState) => {
        this._watchdogState = applyWatchdogFocus(
          this._watchdogState,
          windowState.focused,
          Date.now(),
        );
        this.recoverPlaceholderIfWatched();
      },
    );
    this._watchdogTimer = setInterval(() => {
      this.onWatchdogTick();
    }, WEBVIEW_HEARTBEAT_INTERVAL_MS);
  }

  /** KN-370: native GUI inbound `setTheme` / `setColors` (no webview required). */
  private pushGuiTheme(): void {
    const theme = getTheme();
    this.webviewProtocol.send("setTheme", { theme });
    const colors = colorsFromConvertedTheme(theme);
    if (colors) {
      this.webviewProtocol.send("setColors", colors);
    }
    this._didPushGuiTheme = true;
  }

  private pushGuiThemeOnce(): void {
    if (this._didPushGuiTheme) {
      return;
    }
    this.pushGuiTheme();
  }

  private recoverPlaceholderIfWatched(): void {
    if (
      this._showingPlaceholder &&
      (this._webviewView?.visible ?? false) &&
      vscode.window.state.focused
    ) {
      this.reloadSidebar("user");
    }
  }

  private onWatchdogTick(): void {
    if (
      this.extensionContext.extensionMode === vscode.ExtensionMode.Development
    ) {
      return;
    }
    const now = Date.now();
    const decision = decideWebviewWatchdog(this._watchdogState, now);
    if (decision === "ok") {
      return;
    }
    if (decision === "give-up") {
      this.showCrashPlaceholder();
      return;
    }
    this.reloadSidebar("stale");
  }

  private reloadSidebar(reason: "stale" | "user"): void {
    const view = this._webviewView;
    if (!view) {
      return;
    }
    const now = Date.now();
    this._watchdogState =
      reason === "user"
        ? applyWatchdogUserReload(this._watchdogState, now, view.visible)
        : applyWatchdogReload(this._watchdogState, now);
    this._showingPlaceholder = false;
    view.webview.html = this.getSidebarContent(
      this.extensionContext,
      view,
    );
  }

  private showCrashPlaceholder(): void {
    const view = this._webviewView;
    if (!view || this._showingPlaceholder) {
      return;
    }
    this._showingPlaceholder = true;
    view.webview.html = this.getCrashPlaceholderHtml();
  }

  private getCrashPlaceholderHtml(): string {
    const nonce = getNonce();
    const title = t("webview.rendererStopped");
    const action = t("webview.reloadKnox");
    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Knox</title>
        <style>
          body {
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            color: var(--vscode-foreground, #ccc);
            background: var(--vscode-sideBar-background, #1e1e1e);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 16px;
            text-align: center;
            box-sizing: border-box;
          }
          button {
            margin-top: 12px;
            background: #159994;
            color: #fff;
            border: 0;
            border-radius: 4px;
            padding: 8px 14px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <p>${title}</p>
        <button id="reload">${action}</button>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          document.getElementById("reload").addEventListener("click", () => {
            vscode.postMessage({
              messageType: "knox/reloadWebview",
              messageId: "knox-reload",
              data: {}
            });
          });
        </script>
      </body>
    </html>`;
  }

  getSidebarContent(
    context: vscode.ExtensionContext | undefined,
    panel: vscode.WebviewPanel | vscode.WebviewView,
    page: string | undefined = undefined,
    edits: FileEdit[] | undefined = undefined,
    isFullScreen = false,
  ): string {
    const extensionUri = this.extensionContext.extensionUri;
    applyKnoxWebviewOptions(panel.webview, extensionUri);

    this.webviewProtocol.webview = panel.webview;

    return renderKnoxWebviewHtml({
      extensionUri,
      webview: panel.webview,
      inDevelopmentMode: useKnoxViteDevServer(context),
      windowId: this.windowId,
      isFullScreen,
      page,
      edits,
    });
  }
}
