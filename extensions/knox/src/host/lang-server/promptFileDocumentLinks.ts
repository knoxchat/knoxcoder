import * as vscode from "vscode";

import { collectPromptFileAtMentions } from "./promptFileAtMentions";

class PromptFileDocumentLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    for (const mention of collectPromptFileAtMentions(document.getText())) {
      const target = await resolveMentionToUri(mention.token, document);
      if (!target) {
        continue;
      }
      const range = new vscode.Range(
        document.positionAt(mention.start),
        document.positionAt(mention.end),
      );
      links.push(new vscode.DocumentLink(range, target));
    }
    return links;
  }
}

async function resolveMentionToUri(
  token: string,
  document: vscode.TextDocument,
): Promise<vscode.Uri | undefined> {
  const candidates: vscode.Uri[] = [
    vscode.Uri.joinPath(document.uri, "..", token),
  ];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(vscode.Uri.joinPath(folder.uri, token));
  }

  for (const uri of candidates) {
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export function registerPromptFileDocumentLinkProvider(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { language: "promptLanguage" },
      new PromptFileDocumentLinkProvider(),
    ),
  );
}
