import { machineIdSync } from "node-machine-id";
import * as URI from "core/util/uriApi";
import * as vscode from "vscode";

export function translate(range: vscode.Range, lines: number): vscode.Range {
  return new vscode.Range(
    range.start.line + lines,
    range.start.character,
    range.end.line + lines,
    range.end.character,
  );
}

export function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** Builtin in KnoxCoder first, then the marketplace VSIX id. */
export const KNOX_EXTENSION_IDS = ["vscode.knox", "knoxchat.knoxchat"] as const;

export function getKnoxExtension(): vscode.Extension<unknown> | undefined {
  for (const id of KNOX_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(id);
    if (extension) {
      return extension;
    }
  }
  return undefined;
}

export function getExtensionUri(): vscode.Uri {
  const extension = getKnoxExtension();
  if (!extension) {
    throw new Error(
      `Knox extension is not present (tried ${KNOX_EXTENSION_IDS.join(", ")})`,
    );
  }
  return extension.extensionUri;
}

/**
 * Vite HMR is for F5-debugging the marketplace VSIX. The in-tree builtin
 * (`vscode.knox`) always loads `gui/assets` from disk, even under
 * `scripts/code.sh` (ExtensionMode.Development).
 */
export function useKnoxViteDevServer(
  context?: vscode.ExtensionContext,
): boolean {
  return (
    context?.extensionMode === vscode.ExtensionMode.Development &&
    context.extension.id === "knoxchat.knoxchat"
  );
}

export function getViewColumnOfFile(
  uri: vscode.Uri,
): vscode.ViewColumn | undefined {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        (tab?.input as any)?.uri &&
        URI.equal((tab.input as any).uri, uri.toString())
      ) {
        return tabGroup.viewColumn;
      }
    }
  }
  return undefined;
}

export function getRightViewColumn(): vscode.ViewColumn {
  // When you want to place in the rightmost panel if there is already more than one, otherwise use Beside
  let column = vscode.ViewColumn.Beside;
  const columnOrdering = [
    vscode.ViewColumn.One,
    vscode.ViewColumn.Beside,
    vscode.ViewColumn.Two,
    vscode.ViewColumn.Three,
    vscode.ViewColumn.Four,
    vscode.ViewColumn.Five,
    vscode.ViewColumn.Six,
    vscode.ViewColumn.Seven,
    vscode.ViewColumn.Eight,
    vscode.ViewColumn.Nine,
  ];
  for (const tabGroup of vscode.window.tabGroups.all) {
    if (
      columnOrdering.indexOf(tabGroup.viewColumn) >
      columnOrdering.indexOf(column)
    ) {
      column = tabGroup.viewColumn;
    }
  }
  return column;
}

let showTextDocumentInProcess = false;

export function openEditorAndRevealRange(
  uri: vscode.Uri,
  range?: vscode.Range,
  viewColumn?: vscode.ViewColumn,
  preview?: boolean,
): Promise<vscode.TextEditor> {
  return new Promise((resolve, _) => {
    vscode.workspace.openTextDocument(uri).then(async (doc) => {
      try {
        // An error is thrown mysteriously if you open two documents in parallel, hence this
        while (showTextDocumentInProcess) {
          await new Promise((resolve) => {
            setInterval(() => {
              resolve(null);
            }, 200);
          });
        }
        showTextDocumentInProcess = true;
        vscode.window
          .showTextDocument(doc, {
            viewColumn: getViewColumnOfFile(uri) || viewColumn,
            preview,
          })
          .then((editor) => {
            if (range) {
              editor.revealRange(range);
            }
            resolve(editor);
            showTextDocumentInProcess = false;
          });
      } catch (err) {
        console.log(err);
      }
    });
  });
}

export function getUniqueId() {
  const id = vscode.env.machineId;
  if (id === "someValue.machineId") {
    return machineIdSync();
  }
  return vscode.env.machineId;
}
