import * as vscode from "vscode";

import { t } from "../../i18n";
import { VerticalDiffManager } from "../vertical/manager";

import {
  applyBatch,
  batchActionForKind,
  collectPendingFiles,
  emptyBatchDiffResult,
  fileUrisForBatch,
  pendingFilesPayload,
  type BatchDiffAction,
  type BatchDiffEntry,
  type BatchDiffHost,
  type BatchDiffKind,
  type BatchDiffResult,
} from "./batchDiff";

export type { BatchDiffEntry, BatchDiffResult } from "./batchDiff";

/**
 * KN-344: vscode adapter for batch multi-file accept/reject.
 *
 * Commands are registered from `commands.ts` (activation) so they exist
 * before the first `batch/*` protocol message. This class owns VerticalDiff
 * wiring, dirty-file save, and user-facing failure toasts.
 */
export class BatchDiffManager implements vscode.Disposable {
  private static instance: BatchDiffManager;

  private _onBatchStarted = new vscode.EventEmitter<{
    action: BatchDiffAction;
    files: string[];
  }>();
  public readonly onBatchStarted = this._onBatchStarted.event;

  private _onBatchCompleted = new vscode.EventEmitter<BatchDiffResult>();
  public readonly onBatchCompleted = this._onBatchCompleted.event;

  private verticalDiffManager: VerticalDiffManager | null = null;

  static getInstance(): BatchDiffManager {
    if (!BatchDiffManager.instance) {
      BatchDiffManager.instance = new BatchDiffManager();
    }
    return BatchDiffManager.instance;
  }

  private constructor() {}

  setVerticalDiffManager(manager: VerticalDiffManager): void {
    this.verticalDiffManager = manager;
  }

  getPendingFiles(): BatchDiffEntry[] {
    if (!this.verticalDiffManager) {
      return [];
    }
    return collectPendingFiles(this.verticalDiffManager.fileUriToCodeLens);
  }

  pendingFilesPayload(): {
    files: Array<{ filepath: string; numDiffs: number; selected: boolean }>;
  } {
    return pendingFilesPayload(this.getPendingFiles());
  }

  async applyAll(action: BatchDiffAction): Promise<BatchDiffResult> {
    return this.applyKind(
      action === "accept" ? "acceptAll" : "rejectAll",
    );
  }

  async applySelected(
    action: BatchDiffAction,
    fileUris: string[],
  ): Promise<BatchDiffResult> {
    return this.applyKind(
      action === "accept" ? "acceptSelected" : "rejectSelected",
      fileUris,
    );
  }

  async applyKind(
    kind: BatchDiffKind,
    selected?: string[],
  ): Promise<BatchDiffResult> {
    if (!this.verticalDiffManager) {
      return emptyBatchDiffResult();
    }
    const action = batchActionForKind(kind);
    const fileUris = fileUrisForBatch(kind, this.getPendingFiles(), selected);
    return this.runBatch(action, fileUris);
  }

  private async runBatch(
    action: BatchDiffAction,
    fileUris: string[],
  ): Promise<BatchDiffResult> {
    const manager = this.verticalDiffManager;
    if (!manager) {
      return emptyBatchDiffResult();
    }

    this._onBatchStarted.fire({ action, files: fileUris });

    const host: BatchDiffHost = {
      clearForFile: (fileUri, accept) => manager.clearForfileUri(fileUri, accept),
      saveIfDirty: (fileUri) => this.saveIfDirty(fileUri),
    };

    const result = await applyBatch(host, action, fileUris);
    this._onBatchCompleted.fire(result);

    if (result.failedFiles.length > 0) {
      vscode.window.showWarningMessage(
        t("diff.batchPartialFailure", {
          action,
          success: result.successFiles,
          total: result.totalFiles,
          failed: result.failedFiles.length,
        }),
      );
    }

    return result;
  }

  private async saveIfDirty(fileUri: string): Promise<void> {
    try {
      const uri = fileUri.includes("://")
        ? vscode.Uri.parse(fileUri)
        : vscode.Uri.file(fileUri);
      const doc = vscode.workspace.textDocuments.find(
        (d) =>
          d.uri.toString() === uri.toString() || d.uri.fsPath === uri.fsPath,
      );
      if (doc?.isDirty) {
        await doc.save();
      }
    } catch {
      // File save failure is non-critical
    }
  }

  dispose(): void {
    this._onBatchStarted.dispose();
    this._onBatchCompleted.dispose();
  }
}
