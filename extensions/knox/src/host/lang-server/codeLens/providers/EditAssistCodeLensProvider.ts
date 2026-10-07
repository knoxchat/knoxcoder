import { findAssistTargets, buildAssistPrompt } from "core/edit/assist/editAssist";
import * as vscode from "vscode";

import { getKnoxWorkspaceConfig } from "../../../util/workspaceConfig";

export const EDIT_ASSIST_RUN_COMMAND = "knox.editAssist.run";
export const EDIT_ASSIST_CODELENS_SETTING = "codeLens";
const MAX_FILE_CHARS = 400_000;
const MAX_DIAGNOSTIC_LENSES = 5;

export function editAssistCodeLensEnabled(): boolean {
  return (
    getKnoxWorkspaceConfig().get<boolean>(
      `editAssist.${EDIT_ASSIST_CODELENS_SETTING}`,
    ) ?? true
  );
}

/**
 * CodeLens that triggers an instruction-based edit on empty files, stub
 * functions, TODO comments and error diagnostics. Each lens runs the same edit
 * path as Cmd+I and ends in a reviewable vertical diff.
 */
export class EditAssistCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor() {}

  refresh() {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (
      !editAssistCodeLensEnabled() ||
      document.uri.scheme !== "file" ||
      document.getText().length > MAX_FILE_CHARS
    ) {
      return [];
    }
    const uri = document.uri.toString();
    const lenses: vscode.CodeLens[] = [];

    for (const t of findAssistTargets(document.getText(), document.languageId)) {
      lenses.push(
        new vscode.CodeLens(new vscode.Range(t.lensLine, 0, t.lensLine, 0), {
          title: t.title,
          command: EDIT_ASSIST_RUN_COMMAND,
          arguments: [{ uri, startLine: t.startLine, endLine: t.endLine, prompt: t.prompt, kind: t.kind }],
        }),
      );
    }

    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .slice(0, MAX_DIAGNOSTIC_LENSES);
    for (const d of diagnostics) {
      const line = d.range.start.line;
      lenses.push(
        new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: "Knox: Fix this error",
          command: EDIT_ASSIST_RUN_COMMAND,
          arguments: [
            {
              uri,
              startLine: Math.max(0, line - 2),
              endLine: Math.min(document.lineCount - 1, d.range.end.line + 2),
              prompt: buildAssistPrompt("diagnostic", { message: d.message }),
              kind: "diagnostic",
            },
          ],
        }),
      );
    }
    return lenses;
  }
}
