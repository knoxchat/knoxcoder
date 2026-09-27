import * as vscode from "vscode";

import { VerticalDiffCodeLens } from "../../../diff/vertical/manager";
import {
  verticalPerLineCodeLensSpecs,
} from "../codeLensSpecs";

export class VerticalDiffCodeLensProvider implements vscode.CodeLensProvider {
  private _eventEmitter: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();

  onDidChangeCodeLenses: vscode.Event<void> = this._eventEmitter.event;

  public refresh(): void {
    this._eventEmitter.fire();
  }

  constructor(
    private readonly editorToVerticalDiffCodeLens: Map<
      string,
      VerticalDiffCodeLens[]
    >,
  ) {}

  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const uri = document.uri.toString();
    const blocks = this.editorToVerticalDiffCodeLens.get(uri);
    if (!blocks) {
      return [];
    }

    return verticalPerLineCodeLensSpecs(uri, blocks).map(
      (spec) =>
        new vscode.CodeLens(
          new vscode.Range(spec.startLine, 0, spec.endLine, 0),
          spec.command,
        ),
    );
  }
}
