import * as vscode from "vscode";

import { t } from "../i18n";

import { CommandHistoryService } from "./CommandHistoryService";
import {
  captureFileSnapshot,
  FileContentSnapshot,
  resolveFileUri,
} from "./fileSnapshots";
import {
  buildExtractInterfacePrompt,
  buildExtractMethodPrompt,
  defaultExtractInterfacePath,
  DEFAULT_EXTRACT_ACCESSIBILITY,
  llmCompletionText,
  movedImportRewrite,
  parseExtractInterfaceResult,
  rewriteImportsAfterMove,
  stripCodeFences,
  escapeRegExp,
} from "./refactoring";
import { LLM_COMPLETE_COMMAND } from "./diagnostics";

/**
 * KN-355: vscode adapter over `refactoring.ts`.
 *
 * LSP rename (`vscode.executeDocumentRenameProvider`) plus extract method /
 * interface via `knox.llmComplete`. Command registration lives in
 * `activateAgentMode`. Distinct from the unimplemented `builtin_refactor` stub.
 */
export class RefactoringService implements vscode.Disposable {
  private static instance: RefactoringService | undefined;
  private disposables: vscode.Disposable[] = [];

  private _onRefactoringCompleted = new vscode.EventEmitter<{
    type: string;
    filePaths: string[];
    success: boolean;
  }>();
  public readonly onRefactoringCompleted = this._onRefactoringCompleted.event;

  public static getInstance(): RefactoringService {
    if (!RefactoringService.instance) {
      RefactoringService.instance = new RefactoringService();
    }
    return RefactoringService.instance;
  }

  private constructor() {}

  /**
   * Rename a symbol using the language server rename provider.
   */
  public async renameSymbol(
    oldName: string,
    newName: string,
    filePaths: string[] = [],
  ): Promise<boolean> {
    try {
      if (!oldName?.trim() || !newName?.trim()) {
        throw new Error(t("refactoring.missingNames"));
      }

      const location = await this.findSymbolLocation(oldName, filePaths);
      if (!location) {
        throw new Error(t("refactoring.symbolNotFound", { name: oldName }));
      }

      const workspaceEdit =
        await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
          "vscode.executeDocumentRenameProvider",
          location.uri,
          location.position,
          newName,
        );

      if (!workspaceEdit) {
        throw new Error(t("refactoring.renameProviderUnavailable"));
      }

      const success = await this.applyWorkspaceEditWithUndo(
        workspaceEdit,
        `rename_symbol: ${oldName} → ${newName}`,
        "rename_symbol",
        location.uri.fsPath,
        { oldName, newName, filePaths },
      );

      this._onRefactoringCompleted.fire({
        type: "rename_symbol",
        filePaths: this.urisFromEdit(workspaceEdit).map((u) => u.fsPath),
        success,
      });

      return success;
    } catch (error) {
      console.error("Error renaming symbol:", error);
      vscode.window.showErrorMessage(
        t("refactoring.errorRename", { message: (error as Error).message }),
      );
      this._onRefactoringCompleted.fire({
        type: "rename_symbol",
        filePaths,
        success: false,
      });
      return false;
    }
  }

  /**
   * Extract a line range into a new method via LLM rewrite of the file.
   */
  public async extractMethod(
    filePath: string,
    startLine: number,
    endLine: number,
    methodName: string,
    accessibility?: string,
  ): Promise<boolean> {
    try {
      const uri = resolveFileUri(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const range = new vscode.Range(
        new vscode.Position(startLine - 1, 0),
        new vscode.Position(
          endLine - 1,
          document.lineAt(endLine - 1).text.length,
        ),
      );
      const selectedText = document.getText(range);
      if (!selectedText.trim()) {
        throw new Error(t("refactoring.emptySelection"));
      }

      const access = accessibility || DEFAULT_EXTRACT_ACCESSIBILITY;
      const rewritten = await this.llmComplete(
        buildExtractMethodPrompt({
          languageId: document.languageId,
          accessibility: access,
          methodName,
          startLine,
          endLine,
          selectedText,
          fileText: document.getText(),
        }),
      );
      const newContent = stripCodeFences(rewritten);
      if (!newContent.trim()) {
        throw new Error(t("refactoring.emptyLlmResult"));
      }

      const success = await this.writeFileWithUndo(
        uri,
        newContent,
        `extract_method: ${methodName}`,
        "extract_method",
        { filePath, startLine, endLine, methodName, accessibility: access },
      );

      this._onRefactoringCompleted.fire({
        type: "extract_method",
        filePaths: [uri.fsPath],
        success,
      });
      return success;
    } catch (error) {
      console.error("Error extracting method:", error);
      vscode.window.showErrorMessage(
        t("refactoring.errorExtractMethod", {
          message: (error as Error).message,
        }),
      );
      this._onRefactoringCompleted.fire({
        type: "extract_method",
        filePaths: [filePath],
        success: false,
      });
      return false;
    }
  }

  /**
   * Move a file on disk and optionally rewrite relative import strings that
   * referenced the old path.
   */
  public async moveFile(
    sourcePath: string,
    targetPath: string,
    updateImports: boolean = true,
  ): Promise<boolean> {
    try {
      const sourceUri = resolveFileUri(sourcePath);
      const targetUri = resolveFileUri(targetPath);

      const beforeSource = await captureFileSnapshot(sourceUri.fsPath);
      if (beforeSource.content === null) {
        throw new Error(t("refactoring.sourceMissing", { path: sourcePath }));
      }
      const beforeTarget = await captureFileSnapshot(targetUri.fsPath);

      const targetDir = vscode.Uri.joinPath(targetUri, "..");
      await vscode.workspace.fs.createDirectory(targetDir);
      await vscode.workspace.fs.rename(sourceUri, targetUri, {
        overwrite: false,
      });

      const pairs: Array<{
        before: FileContentSnapshot;
        after: FileContentSnapshot;
      }> = [
        {
          before: beforeSource,
          after: await captureFileSnapshot(sourceUri.fsPath),
        },
        {
          before: beforeTarget,
          after: await captureFileSnapshot(targetUri.fsPath),
        },
      ];

      if (updateImports) {
        const importPairs = await this.updateImportPathsAfterMove(
          sourceUri.fsPath,
          targetUri.fsPath,
        );
        pairs.push(...importPairs);
      }

      await CommandHistoryService.getInstance().recordManualMutation({
        description: `move_file: ${sourcePath} → ${targetPath}`,
        toolName: "move_file",
        filePath: targetUri.fsPath,
        args: { sourcePath, targetPath, updateImports },
        pairs,
      });

      this._onRefactoringCompleted.fire({
        type: "move_file",
        filePaths: [sourceUri.fsPath, targetUri.fsPath],
        success: true,
      });
      return true;
    } catch (error) {
      console.error("Error moving file:", error);
      vscode.window.showErrorMessage(
        t("refactoring.errorMoveFile", { message: (error as Error).message }),
      );
      this._onRefactoringCompleted.fire({
        type: "move_file",
        filePaths: [sourcePath, targetPath],
        success: false,
      });
      return false;
    }
  }

  /**
   * Extract a TypeScript/JavaScript interface from a class via LLM.
   */
  public async extractInterface(
    filePath: string,
    className: string,
    interfaceName: string,
    targetPath?: string,
  ): Promise<boolean> {
    try {
      const sourceUri = resolveFileUri(filePath);
      const document = await vscode.workspace.openTextDocument(sourceUri);
      const interfaceUri = resolveFileUri(
        targetPath ||
          defaultExtractInterfacePath(sourceUri.fsPath, interfaceName),
      );

      const raw = await this.llmComplete(
        buildExtractInterfacePrompt({
          languageId: document.languageId,
          className,
          interfaceName,
          interfacePath: interfaceUri.fsPath,
          fileText: document.getText(),
        }),
      );
      const parsed = parseExtractInterfaceResult(raw);
      if (!parsed) {
        throw new Error(t("refactoring.emptyLlmResult"));
      }

      const pairs: Array<{
        before: FileContentSnapshot;
        after: FileContentSnapshot;
      }> = [];

      const sourceOk = await this.writeFileWithUndo(
        sourceUri,
        parsed.updatedSource,
        `extract_interface: ${interfaceName} (source)`,
        "extract_interface",
        { filePath, className, interfaceName, targetPath },
        pairs,
        false,
      );
      if (!sourceOk) {
        throw new Error(
          t("refactoring.errorExtractInterface", { message: "source write failed" }),
        );
      }

      if (
        parsed.interfaceFile.trim() &&
        interfaceUri.fsPath !== sourceUri.fsPath
      ) {
        await this.writeFileWithUndo(
          interfaceUri,
          parsed.interfaceFile,
          `extract_interface: ${interfaceName}`,
          "extract_interface",
          { filePath, className, interfaceName, targetPath },
          pairs,
          false,
        );
      }

      await CommandHistoryService.getInstance().recordManualMutation({
        description: `extract_interface: ${className} → ${interfaceName}`,
        toolName: "extract_interface",
        filePath: sourceUri.fsPath,
        args: { filePath, className, interfaceName, targetPath },
        pairs,
      });

      this._onRefactoringCompleted.fire({
        type: "extract_interface",
        filePaths:
          interfaceUri.fsPath !== sourceUri.fsPath
            ? [sourceUri.fsPath, interfaceUri.fsPath]
            : [sourceUri.fsPath],
        success: true,
      });
      return true;
    } catch (error) {
      console.error("Error extracting interface:", error);
      vscode.window.showErrorMessage(
        t("refactoring.errorExtractInterface", {
          message: (error as Error).message,
        }),
      );
      this._onRefactoringCompleted.fire({
        type: "extract_interface",
        filePaths: targetPath ? [filePath, targetPath] : [filePath],
        success: false,
      });
      return false;
    }
  }

  private async findSymbolLocation(
    symbolName: string,
    filePaths: string[],
  ): Promise<{ uri: vscode.Uri; position: vscode.Position } | undefined> {
    try {
      const symbols =
        (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          symbolName,
        )) ?? [];
      const exact = symbols.find((s) => s.name === symbolName);
      if (exact?.location) {
        return {
          uri: exact.location.uri,
          position: exact.location.range.start,
        };
      }
    } catch {
      // fall through to file scan
    }

    const candidates =
      filePaths.length > 0
        ? filePaths.map((p) => resolveFileUri(p))
        : await vscode.workspace.findFiles(
            "**/*.{ts,tsx,js,jsx,py,go,java,cs,rs}",
            "**/node_modules/**",
            40,
          );

    for (const uri of candidates) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const match = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`).exec(
          text,
        );
        if (!match || match.index === undefined) {
          continue;
        }
        return { uri, position: doc.positionAt(match.index) };
      } catch {
        // try next file
      }
    }
    return undefined;
  }

  private async applyWorkspaceEditWithUndo(
    edit: vscode.WorkspaceEdit,
    description: string,
    toolName: string,
    primaryPath: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    const uris = this.urisFromEdit(edit);
    const befores = new Map<string, FileContentSnapshot>();
    for (const uri of uris) {
      befores.set(uri.toString(), await captureFileSnapshot(uri.fsPath));
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return false;
    }

    const pairs: Array<{
      before: FileContentSnapshot;
      after: FileContentSnapshot;
    }> = [];
    for (const uri of uris) {
      const before = befores.get(uri.toString());
      if (!before) {
        continue;
      }
      pairs.push({
        before,
        after: await captureFileSnapshot(uri.fsPath),
      });
    }

    await CommandHistoryService.getInstance().recordManualMutation({
      description,
      toolName,
      filePath: primaryPath,
      args,
      pairs,
    });
    return true;
  }

  private urisFromEdit(edit: vscode.WorkspaceEdit): vscode.Uri[] {
    const entries = edit.entries();
    return entries.map(([uri]) => uri);
  }

  private async writeFileWithUndo(
    uri: vscode.Uri,
    content: string,
    description: string,
    toolName: string,
    args: Record<string, unknown>,
    accumulatePairs?: Array<{
      before: FileContentSnapshot;
      after: FileContentSnapshot;
    }>,
    recordImmediately = true,
  ): Promise<boolean> {
    const before = await captureFileSnapshot(uri.fsPath);
    const dir = vscode.Uri.joinPath(uri, "..");
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    const after = await captureFileSnapshot(uri.fsPath);
    const pair = { before, after };
    if (accumulatePairs) {
      accumulatePairs.push(pair);
    }
    if (recordImmediately) {
      await CommandHistoryService.getInstance().recordManualMutation({
        description,
        toolName,
        filePath: uri.fsPath,
        args,
        pairs: [pair],
      });
    }
    return true;
  }

  private async updateImportPathsAfterMove(
    sourcePath: string,
    targetPath: string,
  ): Promise<Array<{ before: FileContentSnapshot; after: FileContentSnapshot }>> {
    const pairs: Array<{
      before: FileContentSnapshot;
      after: FileContentSnapshot;
    }> = [];
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(targetPath),
    );
    if (!workspaceFolder) {
      return pairs;
    }

    const rewrite = movedImportRewrite(
      workspaceFolder.uri.fsPath,
      sourcePath,
      targetPath,
    );
    if (!rewrite) {
      return pairs;
    }

    const files = await vscode.workspace.findFiles(
      "**/*.{ts,tsx,js,jsx}",
      "**/node_modules/**",
      200,
    );

    for (const uri of files) {
      if (uri.fsPath === targetPath) {
        continue;
      }
      let text: string;
      try {
        text = (await vscode.workspace.openTextDocument(uri)).getText();
      } catch {
        continue;
      }

      const updated = rewriteImportsAfterMove(text, rewrite);
      if (updated === text) {
        continue;
      }

      const before = await captureFileSnapshot(uri.fsPath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, "utf8"));
      pairs.push({
        before,
        after: await captureFileSnapshot(uri.fsPath),
      });
    }

    return pairs;
  }

  private async llmComplete(prompt: string): Promise<string> {
    const result = await vscode.commands.executeCommand<string>(
      LLM_COMPLETE_COMMAND,
      { prompt, title: "default" },
    );
    const text = llmCompletionText(result);
    if (!text) {
      throw new Error(t("refactoring.llmUnavailable"));
    }
    return text;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this._onRefactoringCompleted.dispose();
    if (RefactoringService.instance === this) {
      RefactoringService.instance = undefined;
    }
  }
}
