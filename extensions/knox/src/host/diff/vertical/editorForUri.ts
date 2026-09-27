import * as URI from "core/util/uriApi";
import * as vscode from "vscode";

/** Visible editor for `fileUri`, preferring the active split of that document. */
export function findEditorForUri(
  fileUri: string,
): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && URI.equal(active.document.uri.toString(), fileUri)) {
    return active;
  }
  return vscode.window.visibleTextEditors.find((editor) =>
    URI.equal(editor.document.uri.toString(), fileUri),
  );
}

export function isFileVisible(fileUri: string): boolean {
  return Boolean(findEditorForUri(fileUri));
}

export async function showEditorForUri(
  fileUri: string,
): Promise<vscode.TextEditor | undefined> {
  const existing = findEditorForUri(fileUri);
  if (existing) {
    return existing;
  }
  try {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(fileUri),
    );
    return await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  } catch {
    return vscode.window.activeTextEditor;
  }
}
