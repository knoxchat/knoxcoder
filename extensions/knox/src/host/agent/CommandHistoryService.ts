import * as vscode from "vscode";

import { t } from "../i18n";

import { ChatOperationType } from "./ChatFlowCoordinator";
import {
  captureFileSnapshot,
  extractMutatingFilePath,
  FileContentSnapshot,
  isMutatingTool,
  parseToolArguments,
  restoreFileSnapshot,
} from "./fileSnapshots";
import {
  buildOperationHistoryPickItems,
  changedSnapshotPairs,
  CLEAR_OPERATION_HISTORY_COMMAND,
  describeSnapshotChange,
  ENHANCED_REDO_COMMAND,
  ENHANCED_UNDO_COMMAND,
  findLatestOperationIndexForPath,
  formatSnapshotChangeDetail,
  KNOX_CAN_REDO_CONTEXT_KEY,
  KNOX_CAN_UNDO_CONTEXT_KEY,
  OPERATION_HISTORY_MAX_SIZE,
  operationHistoryInspectPayload,
  OperationHistoryStack,
  SHOW_OPERATION_HISTORY_COMMAND,
  snapshotBytesEqual,
} from "./operationHistory";

/**
 * Represents a record of an operation for undo/redo purposes
 */
export interface OperationRecord {
  id: string;
  type: ChatOperationType;
  description: string;
  timestamp: number;
  context: {
    toolName: string;
    args: Record<string, unknown> | null;
    filePath?: string;
  };
  before: FileContentSnapshot | null;
  after: FileContentSnapshot | null;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * KN-351: vscode adapter for file-byte undo/redo.
 * Snapshots are recorded from Core tools/call via IDE.captureMutatingToolBefore /
 * recordMutatingToolAfter (GUI chat + agent share one path).
 */
export class CommandHistoryService implements vscode.Disposable {
  private static instance: CommandHistoryService;
  private disposables: vscode.Disposable[] = [];

  private readonly stack = new OperationHistoryStack<OperationRecord>(
    OPERATION_HISTORY_MAX_SIZE,
  );

  private _onUndoPerformed = new vscode.EventEmitter<OperationRecord>();
  public readonly onUndoPerformed = this._onUndoPerformed.event;

  private _onRedoPerformed = new vscode.EventEmitter<OperationRecord>();
  public readonly onRedoPerformed = this._onRedoPerformed.event;

  private _onOperationRecorded = new vscode.EventEmitter<OperationRecord>();
  public readonly onOperationRecorded = this._onOperationRecorded.event;

  public static getInstance(): CommandHistoryService {
    if (!CommandHistoryService.instance) {
      CommandHistoryService.instance = new CommandHistoryService();
    }
    return CommandHistoryService.instance;
  }

  private constructor() {
    this.registerCommands();
    this.updateStatusBar();
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand(ENHANCED_UNDO_COMMAND, async () => {
        return await this.undo();
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand(ENHANCED_REDO_COMMAND, async () => {
        return await this.redo();
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand(SHOW_OPERATION_HISTORY_COMMAND, () => {
        this.showOperationHistory();
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand(CLEAR_OPERATION_HISTORY_COMMAND, () => {
        this.clearHistory();
      }),
    );
  }

  /**
   * After a tool finishes, pair before/after snapshots and record undo/redo.
   */
  public recordCompletedToolCall(
    toolCall: any,
    before: FileContentSnapshot | null,
    after: FileContentSnapshot | null,
  ): void {
    const toolName = toolCall?.function?.name;
    if (typeof toolName !== "string" || !isMutatingTool(toolName)) {
      return;
    }

    const args = parseToolArguments(toolCall?.function?.arguments);
    const filePath = extractMutatingFilePath(toolName, args);
    if (!filePath || !before || !after) {
      return;
    }

    // Skip no-op mutations (failed/no-change edits).
    if (snapshotBytesEqual(before, after)) {
      return;
    }

    const description = `${toolName}: ${filePath}`;
    const beforeSnapshot = before;
    const afterSnapshot = after;

    const operation: OperationRecord = {
      id: `tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: ChatOperationType.TOOL_CALL,
      description,
      timestamp: Date.now(),
      context: {
        toolName,
        args,
        filePath,
      },
      before: beforeSnapshot,
      after: afterSnapshot,
      undo: async () => {
        await restoreFileSnapshot(beforeSnapshot);
      },
      redo: async () => {
        await restoreFileSnapshot(afterSnapshot);
      },
    };

    void this.recordOperation(operation);
  }

  /**
   * Record a multi-file mutation performed outside tool-call execution
   * (e.g. LSP rename / WorkspaceEdit) so undo/redo still works.
   */
  public async recordManualMutation(params: {
    description: string;
    toolName: string;
    filePath: string;
    args?: Record<string, unknown> | null;
    pairs: Array<{ before: FileContentSnapshot; after: FileContentSnapshot }>;
  }): Promise<void> {
    const pairs = changedSnapshotPairs(params.pairs);
    if (pairs.length === 0) {
      return;
    }

    const operation: OperationRecord = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: ChatOperationType.TOOL_CALL,
      description: params.description,
      timestamp: Date.now(),
      context: {
        toolName: params.toolName,
        args: params.args ?? null,
        filePath: params.filePath,
      },
      before: pairs[0].before,
      after: pairs[0].after,
      undo: async () => {
        // Restore in reverse so dependent files unwind cleanly
        for (let i = pairs.length - 1; i >= 0; i--) {
          await restoreFileSnapshot(pairs[i].before);
        }
      },
      redo: async () => {
        for (const pair of pairs) {
          await restoreFileSnapshot(pair.after);
        }
      },
    };

    await this.recordOperation(operation);
  }

  /**
   * Refresh the after-snapshot for the most recent operation on a path
   * (e.g. after auto-verification rewrites the file).
   */
  public async refreshAfterSnapshotForPath(filePath: string): Promise<void> {
    const index = findLatestOperationIndexForPath(
      this.stack.undoStack,
      filePath,
    );
    if (index < 0) {
      return;
    }
    const op = this.stack.undoStack[index];
    const after = await captureFileSnapshot(filePath);
    op.after = after;
    op.redo = async () => {
      await restoreFileSnapshot(after);
    };
  }

  public async recordOperation(operation: OperationRecord): Promise<void> {
    this.stack.record(operation);
    this._onOperationRecorded.fire(operation);
    this.updateStatusBar();
  }

  public async undo(): Promise<boolean> {
    const operation = this.stack.takeUndo();
    if (!operation) {
      vscode.window.showInformationMessage(t("history.nothingToUndo"));
      return false;
    }

    const statusMessage = vscode.window.setStatusBarMessage(
      t("history.undoing", { description: operation.description }),
    );

    try {
      await operation.undo();
      this.stack.commitUndo(operation);
      this._onUndoPerformed.fire(operation);
      this.updateStatusBar();
      vscode.window.showInformationMessage(
        t("history.undid", { description: operation.description }),
      );
      return true;
    } catch (error) {
      // Put the operation back so the user can retry
      this.stack.restoreUndo(operation);
      console.error("Error during undo:", error);
      vscode.window.showErrorMessage(
        t("history.failedUndo", { message: (error as Error).message }),
      );
      return false;
    } finally {
      statusMessage.dispose();
    }
  }

  public async redo(): Promise<boolean> {
    const operation = this.stack.takeRedo();
    if (!operation) {
      vscode.window.showInformationMessage(t("history.nothingToRedo"));
      return false;
    }

    const statusMessage = vscode.window.setStatusBarMessage(
      t("history.redoing", { description: operation.description }),
    );

    try {
      await operation.redo();
      this.stack.commitRedo(operation);
      this._onRedoPerformed.fire(operation);
      this.updateStatusBar();
      vscode.window.showInformationMessage(
        t("history.redid", { description: operation.description }),
      );
      return true;
    } catch (error) {
      this.stack.restoreRedo(operation);
      console.error("Error during redo:", error);
      vscode.window.showErrorMessage(
        t("history.failedRedo", { message: (error as Error).message }),
      );
      return false;
    } finally {
      statusMessage.dispose();
    }
  }

  private showOperationHistory(): void {
    const items = buildOperationHistoryPickItems(this.stack.undoStack, {
      detail: (op) =>
        formatSnapshotChangeDetail(describeSnapshotChange(op), t),
    });

    if (items.length === 0) {
      vscode.window.showInformationMessage(t("history.noOperations"));
      return;
    }

    void vscode.window
      .showQuickPick(items, {
        placeHolder: t("history.operationHistory"),
        matchOnDescription: true,
        matchOnDetail: true,
      })
      .then((selected) => {
        if (!selected) {
          return;
        }
        const details = operationHistoryInspectPayload(selected.operation);
        void vscode.workspace
          .openTextDocument({
            content: JSON.stringify(details, null, 2),
            language: "json",
          })
          .then((doc) => vscode.window.showTextDocument(doc));
      });
  }

  private updateStatusBar(): void {
    void vscode.commands.executeCommand(
      "setContext",
      KNOX_CAN_UNDO_CONTEXT_KEY,
      this.stack.canUndo(),
    );
    void vscode.commands.executeCommand(
      "setContext",
      KNOX_CAN_REDO_CONTEXT_KEY,
      this.stack.canRedo(),
    );
  }

  public clearHistory(): void {
    this.stack.clear();
    this.updateStatusBar();
    vscode.window.showInformationMessage(t("history.cleared"));
  }

  public getUndoStack(): readonly OperationRecord[] {
    return [...this.stack.undoStack];
  }

  public getRedoStack(): readonly OperationRecord[] {
    return [...this.stack.redoStack];
  }

  public canUndo(): boolean {
    return this.stack.canUndo();
  }

  public canRedo(): boolean {
    return this.stack.canRedo();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.stack.clear();
    this._onUndoPerformed.dispose();
    this._onRedoPerformed.dispose();
    this._onOperationRecorded.dispose();
  }
}
