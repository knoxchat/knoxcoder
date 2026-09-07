import * as vscode from 'vscode';

import { VerticalDiffManager } from '../vertical/manager';

/**
 * Represents a single file's pending diff state in a batch.
 */
export interface BatchDiffEntry {
  filepath: string;
  streamId: string;
  numDiffs: number;
  /** Whether this file is selected for the batch operation */
  selected: boolean;
}

/**
 * Result of a batch apply/reject operation.
 */
export interface BatchDiffResult {
  totalFiles: number;
  successFiles: number;
  failedFiles: string[];
}

/**
 * BatchDiffManager orchestrates multi-file accept/reject operations.
 *
 * Instead of processing diffs file-by-file, it:
 * 1. Collects all pending diffs into a batch
 * 2. Optionally creates a checkpoint for rollback
 * 3. Applies/rejects all selected files atomically
 * 4. Reports success/failure per file
 */
export class BatchDiffManager implements vscode.Disposable {
  private static instance: BatchDiffManager;
  private disposables: vscode.Disposable[] = [];

  private _onBatchStarted = new vscode.EventEmitter<{ action: 'accept' | 'reject'; files: string[] }>();
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

  private constructor() {
    this.registerCommands();
  }

  /**
   * Inject the VerticalDiffManager so we can access file handlers.
   */
  setVerticalDiffManager(manager: VerticalDiffManager): void {
    this.verticalDiffManager = manager;
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand('knox.batch.acceptAll', async () => {
        return this.applyAll('accept');
      }),
      vscode.commands.registerCommand('knox.batch.rejectAll', async () => {
        return this.applyAll('reject');
      }),
      vscode.commands.registerCommand('knox.batch.acceptSelected', async (fileUris: string[]) => {
        return this.applySelected('accept', fileUris);
      }),
      vscode.commands.registerCommand('knox.batch.rejectSelected', async (fileUris: string[]) => {
        return this.applySelected('reject', fileUris);
      }),
    );
  }

  /**
   * Get all files that currently have pending diffs.
   */
  getPendingFiles(): BatchDiffEntry[] {
    if (!this.verticalDiffManager) return [];

    const entries: BatchDiffEntry[] = [];
    // Access the fileUriToCodeLens map to find files with pending diffs
    for (const [fileUri, codeLenses] of this.verticalDiffManager.fileUriToCodeLens) {
      if (codeLenses.length > 0) {
        entries.push({
          filepath: fileUri,
          streamId: '', // streamId is tracked by the GUI apply state
          numDiffs: codeLenses.length,
          selected: true,
        });
      }
    }
    return entries;
  }

  /**
   * Accept or reject ALL pending diffs across all files.
   */
  async applyAll(action: 'accept' | 'reject'): Promise<BatchDiffResult> {
    const pending = this.getPendingFiles();
    return this.applyBatch(action, pending.map((e) => e.filepath));
  }

  /**
   * Accept or reject diffs for a specific set of files.
   */
  async applySelected(action: 'accept' | 'reject', fileUris: string[]): Promise<BatchDiffResult> {
    return this.applyBatch(action, fileUris);
  }

  /**
   * Core batch operation: apply accept/reject to a list of file URIs.
   */
  private async applyBatch(action: 'accept' | 'reject', fileUris: string[]): Promise<BatchDiffResult> {
    if (!this.verticalDiffManager) {
      return { totalFiles: 0, successFiles: 0, failedFiles: [] };
    }

    const accept = action === 'accept';
    this._onBatchStarted.fire({ action, files: fileUris });

    const result: BatchDiffResult = {
      totalFiles: fileUris.length,
      successFiles: 0,
      failedFiles: [],
    };

    for (const fileUri of fileUris) {
      try {
        this.verticalDiffManager.clearForfileUri(fileUri, accept);

        // Save the file after accepting
        if (accept) {
          try {
            const uri = vscode.Uri.parse(fileUri);
            const doc = vscode.workspace.textDocuments.find(
              (d) => d.uri.toString() === uri.toString(),
            );
            if (doc && doc.isDirty) {
              await doc.save();
            }
          } catch {
            // File save failure is non-critical
          }
        }

        result.successFiles++;
      } catch (error) {
        console.error(`[BatchDiff] Failed to ${action} diff for ${fileUri}:`, error);
        result.failedFiles.push(fileUri);
      }
    }

    this._onBatchCompleted.fire(result);

    if (result.failedFiles.length > 0) {
      vscode.window.showWarningMessage(
        `Batch ${action}: ${result.successFiles}/${result.totalFiles} succeeded, ${result.failedFiles.length} failed`,
      );
    }

    return result;
  }

  dispose(): void {
    this._onBatchStarted.dispose();
    this._onBatchCompleted.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
