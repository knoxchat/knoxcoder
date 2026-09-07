import { EXTENSION_NAME } from "core/config/extensionName";
import * as vscode from "vscode";

class KnoxQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    if (context.diagnostics.length === 0) {
      return [];
    }

    const diagnostic = context.diagnostics[0];

    const quickFix = new vscode.CodeAction(
      "Ask Knox",
      vscode.CodeActionKind.QuickFix,
    );

    quickFix.isPreferred = false;

    const surroundingRange = new vscode.Range(
      Math.max(0, range.start.line - 3),
      0,
      Math.min(document.lineCount, range.end.line + 3),
      0,
    );

    quickFix.command = {
      command: "knoxchat.quickFix",
      title: "Knox Quick Fix",
      arguments: [surroundingRange, diagnostic.message],
    };

    return [quickFix];
  }
}

export default function registerQuickFixProvider() {
  const isDisabled =
    !!vscode.workspace
      .getConfiguration(EXTENSION_NAME)
      .get<boolean>("disableQuickFix") === true;

  if (isDisabled) {
    return;
  }

  // In your extension's activate function:
  vscode.languages.registerCodeActionsProvider(
    { language: "*" },
    new KnoxQuickFixProvider(),
    {
      providedCodeActionKinds: KnoxQuickFixProvider.providedCodeActionKinds,
    },
  );
}