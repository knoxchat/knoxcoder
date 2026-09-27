import * as vscode from "vscode";

import {
  collectConfigYamlUsesLinks,
} from "./configYaml";

export class ConfigYamlDocumentLinkProvider
  implements vscode.DocumentLinkProvider
{
  provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const lines: string[] = [];
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      lines.push(document.lineAt(lineIndex).text);
    }
    return collectConfigYamlUsesLinks(lines).map((link) => {
      const range = new vscode.Range(
        link.line,
        link.start,
        link.line,
        link.end,
      );
      return new vscode.DocumentLink(range, vscode.Uri.parse(link.href));
    });
  }
  resolveDocumentLink(
    link: vscode.DocumentLink,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentLink> {
    return link;
  }
}
