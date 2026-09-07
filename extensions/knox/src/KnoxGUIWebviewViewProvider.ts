import * as fs from "node:fs";

import { ConfigHandler } from "core/config/ConfigHandler";
import * as vscode from "vscode";

import { getTheme } from "./util/getTheme";
import { getExtensionVersion } from "./util/util";
import { getExtensionUri, getNonce, getUniqueId } from "./util/vscode";
import { VsCodeWebviewProtocol } from "./webviewProtocol";

import type { FileEdit } from "core";

/**
 * Vite HMR is opt-in (`KNOX_GUI_VITE=1` or `knoxchat.debugViteGui`).
 * Default path is the extension's packaged `gui/assets` (KnoxCoder native).
 */
function useViteDevGui(): boolean {
  if (process.env.KNOX_GUI_VITE === "1") {
    return true;
  }
  return (
    vscode.workspace.getConfiguration("knoxchat").get<boolean>("debugViteGui") ===
    true
  );
}

function guiAssetsPresent(extensionUri: vscode.Uri): boolean {
  try {
    return fs.existsSync(
      vscode.Uri.joinPath(extensionUri, "gui/assets/index.js").fsPath,
    );
  } catch {
    return false;
  }
}

export class KnoxGUIWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "knoxchat.knoxGUIView";
  public webviewProtocol: VsCodeWebviewProtocol;
  private readonly _onDidResolve = new vscode.EventEmitter<void>();
  readonly onDidResolve = this._onDidResolve.event;

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
    webviewView.webview.html = this.getSidebarContent(
      this.extensionContext,
      webviewView,
    );
    void import("./activation/startupMetrics").then(({ knoxStartupMark }) => {
      knoxStartupMark("resolveWebviewView");
    });
    const paintListener = webviewView.webview.onDidReceiveMessage((msg: { messageType?: string; data?: { t?: number } }) => {
      if (msg?.messageType === "knox/guiFirstPaint") {
        const webviewMs = msg.data?.t;
        void import("./activation/startupMetrics").then(({ knoxStartupMark }) => {
          knoxStartupMark(
            "guiFirstPaint",
            webviewMs !== undefined
              ? `(webview clock ${webviewMs.toFixed(1)}ms)`
              : undefined,
          );
        });
        paintListener.dispose();
      }
    });
    this._onDidResolve.fire();
  }

  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;

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

  sendMainUserInput(input: string) {
    this.webview?.postMessage({
      type: "userInput",
      input,
    });
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
  }

  getSidebarContent(
    context: vscode.ExtensionContext | undefined,
    panel: vscode.WebviewPanel | vscode.WebviewView,
    page: string | undefined = undefined,
    edits: FileEdit[] | undefined = undefined,
    isFullScreen = false,
  ): string {
    const extensionUri = getExtensionUri();
    const vscMediaUrl: string = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui"))
      .toString();

    const viteDevGui = useViteDevGui();
    const hasGuiAssets = guiAssetsPresent(extensionUri);

    let scriptUri = "";
    let styleMainUri = "";
    if (viteDevGui) {
      scriptUri = "http://localhost:5173/src/main.tsx";
      styleMainUri = "http://localhost:5173/src/index.css";
    } else if (hasGuiAssets) {
      scriptUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.js"))
        .toString();
      styleMainUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.css"))
        .toString();
    }

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "gui"),
        vscode.Uri.joinPath(extensionUri, "assets"),
      ],
      enableCommandUris: true,
      portMapping: [
        {
          webviewPort: 65433,
          extensionHostPort: 65433,
        },
      ],
    };

    const nonce = getNonce();

    const currentTheme = getTheme();
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("workbench.colorTheme") ||
        e.affectsConfiguration("window.autoDetectColorScheme") ||
        e.affectsConfiguration("window.autoDetectHighContrast") ||
        e.affectsConfiguration("workbench.preferredDarkColorTheme") ||
        e.affectsConfiguration("workbench.preferredLightColorTheme") ||
        e.affectsConfiguration("workbench.preferredHighContrastColorTheme") ||
        e.affectsConfiguration("workbench.preferredHighContrastLightColorTheme")
      ) {
        // Send new theme to GUI to update embedded Monaco themes
        this.webviewProtocol?.request("setTheme", { theme: getTheme() });
      }
    });

    this.webviewProtocol.webview = panel.webview;

    if (!viteDevGui && !hasGuiAssets) {
      return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Knox</title>
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
        </style>
      </head>
      <body>
        <h1>Knox</h1>
        <p>Sidebar host is active. GUI assets have not been built yet (<code>gui/assets/index.js</code>).</p>
      </body>
    </html>`;
    }

    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script>const vscode = acquireVsCodeApi();</script>
        <link href="${styleMainUri}" rel="stylesheet">

        <title>Knox</title>
      </head>
      <body>
        <div id="root"></div>

        ${
          viteDevGui
            ? `<script type="module">
          import RefreshRuntime from "http://localhost:5173/@react-refresh"
          RefreshRuntime.injectIntoGlobalHook(window)
          window.$RefreshReg$ = () => {}
          window.$RefreshSig$ = () => (type) => type
          window.__vite_plugin_react_preamble_installed__ = true
          </script>`
            : ""
        }

        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        <script nonce="${nonce}">
          window.addEventListener("load", function () {
            try {
              vscode.postMessage({
                messageType: "knox/guiFirstPaint",
                messageId: "knox-startup-paint",
                data: { t: performance.now() },
              });
            } catch (e) {}
          });
        </script>

        <script>localStorage.setItem("ide", '"vscode"')</script>
        <script>localStorage.setItem("extensionVersion", '"${getExtensionVersion()}"')</script>
        <script>window.windowId = "${this.windowId}"</script>
        <script>window.vscMachineId = "${getUniqueId()}"</script>
        <script>window.vscMediaUrl = "${vscMediaUrl}"</script>
        <script>window.ide = "vscode"</script>
        <script>window.fullColorTheme = ${JSON.stringify(currentTheme)}</script>
        <script>window.colorThemeName = "dark-plus"</script>
        <script>window.workspacePaths = ${JSON.stringify(
          vscode.workspace.workspaceFolders?.map((folder) =>
            folder.uri.toString(),
          ) || [],
        )}</script>
        <script>window.isFullScreen = ${isFullScreen}</script>

        ${
          edits
            ? `<script>window.edits = ${JSON.stringify(edits)}</script>`
            : ""
        }
        ${page ? `<script>window.location.pathname = "${page}"</script>` : ""}
      </body>
    </html>`;
  }
}
