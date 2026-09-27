/**
 * KN-345: vscode CodeAction adapter for Ask Knox.
 * Range expansion and highlightedCode payload live in `quickFix.ts`.
 */

import { EXTENSION_NAME } from "core/config/extensionName";
import * as vscode from "vscode";

import {
  askKnoxQuickFixSpec,
  DISABLE_QUICK_FIX_SETTING,
  isQuickFixProviderEnabled,
  quickFixSurroundingRange,
} from "./quickFix";

class KnoxQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    if (context.diagnostics.length === 0) {
      return [];
    }

    const diagnostic = context.diagnostics[0];
    const surrounding = quickFixSurroundingRange(
      range.start.line,
      range.end.line,
      document.lineCount,
    );
    const spec = askKnoxQuickFixSpec(surrounding, diagnostic.message);

    const quickFix = new vscode.CodeAction(
      spec.title,
      vscode.CodeActionKind.QuickFix,
    );

    quickFix.isPreferred = spec.isPreferred;
    quickFix.command = {
      command: spec.command.command,
      title: spec.command.title,
      arguments: [
        new vscode.Range(
          spec.command.arguments[0].startLine,
          spec.command.arguments[0].startCharacter,
          spec.command.arguments[0].endLine,
          spec.command.arguments[0].endCharacter,
        ),
        spec.command.arguments[1],
      ],
    };

    return [quickFix];
  }
}

export default function registerQuickFixProvider(
  context: vscode.ExtensionContext,
) {
  let provider: vscode.Disposable | undefined;

  const apply = () => {
    provider?.dispose();
    provider = undefined;

    if (
      !isQuickFixProviderEnabled(
        vscode.workspace
          .getConfiguration(EXTENSION_NAME)
          .get<boolean>("disableQuickFix"),
      )
    ) {
      return;
    }

    provider = vscode.languages.registerCodeActionsProvider(
      { language: "*" },
      new KnoxQuickFixProvider(),
      {
        providedCodeActionKinds: KnoxQuickFixProvider.providedCodeActionKinds,
      },
    );
  };

  apply();

  context.subscriptions.push({
    dispose: () => provider?.dispose(),
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(DISABLE_QUICK_FIX_SETTING)) {
        apply();
      }
    }),
  );
}
