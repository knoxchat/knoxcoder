import * as vscode from "vscode";

import {
  editorToSuggestions,
  onDidChangeSuggestions,
  SuggestionRanges,
} from "../../../suggestions";
import { getMetaKeyLabel } from "../../../util/util";
import { suggestionCodeLensSpecs } from "../codeLensSpecs";

export class SuggestionsCodeLensProvider implements vscode.CodeLensProvider {
  onDidChangeCodeLenses: vscode.Event<void> = onDidChangeSuggestions;

  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const suggestions = editorToSuggestions.get(document.uri.toString());
    if (!suggestions) {
      return [];
    }

    const hint = `(${getMetaKeyLabel()}⇧⏎/${getMetaKeyLabel()}⇧⌫ Accept/Reject All)`;
    return suggestionCodeLensSpecs(
      suggestions.map((suggestion) => ({
        oldStartLine: suggestion.oldRange.start.line,
        newEndLine: suggestion.newRange.end.line,
        suggestion,
      })),
      hint,
    ).map((spec) => {
      const suggestion = spec.command.arguments?.[0] as
        | SuggestionRanges
        | undefined;
      const range = suggestion
        ? new vscode.Range(suggestion.oldRange.start, suggestion.newRange.end)
        : new vscode.Range(spec.startLine, 0, spec.endLine, 0);
      return new vscode.CodeLens(range, spec.command);
    });
  }
}
