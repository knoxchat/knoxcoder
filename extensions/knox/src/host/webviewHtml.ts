import type { FileEdit } from "core";
import * as vscode from "vscode";

import { getTheme } from "./util/getTheme";
import { getExtensionVersion } from "./util/util";
import { getNonce, getUniqueId } from "./util/vscode";
import { WEBVIEW_HEARTBEAT_INTERVAL_MS } from "./webviewWatchdog";

export function applyKnoxWebviewOptions(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, "gui"),
      vscode.Uri.joinPath(extensionUri, "assets"),
    ],
    enableCommandUris: true,
  };
}

/**
 * HTML for the Knox GUI bundle. `knoxView` selects a dedicated page
 * (the checkpoint graph or memory) instead of the chat composer.
 */
export function renderKnoxWebviewHtml(options: {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  inDevelopmentMode: boolean;
  windowId: string;
  isFullScreen?: boolean;
  page?: string;
  edits?: FileEdit[];
  knoxView?: "checkpoint-graph" | "memory";
  /** Editor panels cannot read the sidebar's localStorage language. */
  language?: "en" | "zh";
}): string {
  const {
    extensionUri,
    webview,
    windowId,
    isFullScreen = false,
    page,
    edits,
    knoxView,
    language,
  } = options;

  const vscMediaUrl = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui"))
    .toString();

  // KP-041: native pane is the product path. Never ship the leftover Vite refresh URL.
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.js"))
    .toString();
  const styleMainUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.css"))
    .toString();

  const nonce = getNonce();
  const currentTheme = getTheme();

  return `<!DOCTYPE html>
    <html lang="${language ?? "en"}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const knoxHeartbeat = () => {
            vscode.postMessage({
              messageType: "knox/heartbeat",
              messageId: "knox-heartbeat",
              data: { t: Date.now() }
            });
          };
          knoxHeartbeat();
          setInterval(knoxHeartbeat, ${WEBVIEW_HEARTBEAT_INTERVAL_MS});
        </script>
        <link href="${styleMainUri}" rel="stylesheet">

        <title>Knox</title>
      </head>
      <body>
        <div id="root"></div>

        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>

        <script>localStorage.setItem("ide", '"vscode"')</script>
        <script>localStorage.setItem("extensionVersion", '"${getExtensionVersion()}"')</script>
        <script>window.windowId = "${windowId}"</script>
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
          knoxView
            ? `<script>window.knoxView = ${JSON.stringify(knoxView)}</script>`
            : ""
        }
        ${
          language
            ? `<script>window.knoxLanguage = ${JSON.stringify(language)}</script>`
            : ""
        }

        ${
          edits
            ? `<script>window.edits = ${JSON.stringify(edits)}</script>`
            : ""
        }
        ${page ? `<script>window.location.pathname = "${page}"</script>` : ""}
      </body>
    </html>`;
}
