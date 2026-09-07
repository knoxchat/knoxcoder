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
 * CommandHistoryService provides enhanced undo/redo with file-content snapshots.
 * Snapshots are recorded from Core tools/call via IDE.captureMutatingToolBefore /
 * recordMutatingToolAfter (GUI chat + agent share one path).
 */
export class CommandHistoryService implements vscode.Disposable {
  private static instance: CommandHistoryService;
  private disposables: vscode.Disposable[] = [];

  private undoStack: OperationRecord[] = [];
  private redoStack: OperationRecord[] = [];
  private readonly maxHistorySize = 100;

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
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand("knox.enhancedUndo", async () => {
        return await this.undo();
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand("knox.enhancedRedo", async () => {
        return await this.redo();
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand("knox.showOperationHistory", () => {
        this.showOperationHistory();
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand("knox.clearOperationHistory", () => {
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
    if (snapshotsEqual(before, after)) {
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
    const pairs = params.pairs.filter((p) => !snapshotsEqual(p.before, p.after));
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
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const op = this.undoStack[i];
      if (
        op.context.filePath === filePath ||
        pathsLikelyMatch(op.context.filePath, filePath)
      ) {
        const after = await captureFileSnapshot(filePath);
        op.after = after;
        op.redo = async () => {
          await restoreFileSnapshot(after);
        };
        return;
      }
    }
  }

  public async recordOperation(operation: OperationRecord): Promise<void> {
    this.redoStack = [];
    this.undoStack.push(operation);

    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this._onOperationRecorded.fire(operation);
    this.updateStatusBar();
  }

  public async undo(): Promise<boolean> {
    const operation = this.undoStack.pop();
    if (!operation) {
      vscode.window.showInformationMessage(t("history.nothingToUndo"));
      return false;
    }

    const statusMessage = vscode.window.setStatusBarMessage(
      t("history.undoing", { description: operation.description }),
    );

    try {
      await operation.undo();
      this.redoStack.push(operation);
      this._onUndoPerformed.fire(operation);
      this.updateStatusBar();
      vscode.window.showInformationMessage(
        t("history.undid", { description: operation.description }),
      );
      return true;
    } catch (error) {
      // Put the operation back so the user can retry
      this.undoStack.push(operation);
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
    const operation = this.redoStack.pop();
    if (!operation) {
      vscode.window.showInformationMessage(t("history.nothingToRedo"));
      return false;
    }

    const statusMessage = vscode.window.setStatusBarMessage(
      t("history.redoing", { description: operation.description }),
    );

    try {
      await operation.redo();
      this.undoStack.push(operation);
      this._onRedoPerformed.fire(operation);
      this.updateStatusBar();
      vscode.window.showInformationMessage(
        t("history.redid", { description: operation.description }),
      );
      return true;
    } catch (error) {
      this.redoStack.push(operation);
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
    const items = this.undoStack
      .map((op, index) => ({
        label: `${this.undoStack.length - index}. ${op.description}`,
        description: new Date(op.timestamp).toLocaleTimeString(),
        detail: summarizeSnapshotChange(op),
        operation: op,
      }))
      .reverse();

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
        const details = {
          id: selected.operation.id,
          description: selected.operation.description,
          timestamp: selected.operation.timestamp,
          toolName: selected.operation.context.toolName,
          filePath: selected.operation.context.filePath,
          args: selected.operation.context.args,
          beforeExisted: selected.operation.before?.content !== null,
          afterExisted: selected.operation.after?.content !== null,
          beforeBytes: selected.operation.before?.content?.byteLength ?? 0,
          afterBytes: selected.operation.after?.content?.byteLength ?? 0,
        };
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
      "knoxCanUndo",
      this.undoStack.length > 0,
    );
    void vscode.commands.executeCommand(
      "setContext",
      "knoxCanRedo",
      this.redoStack.length > 0,
    );
  }

  public clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.updateStatusBar();
    vscode.window.showInformationMessage(t("history.cleared"));
  }

  public getUndoStack(): readonly OperationRecord[] {
    return [...this.undoStack];
  }

  public getRedoStack(): readonly OperationRecord[] {
    return [...this.redoStack];
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.undoStack = [];
    this.redoStack = [];
    this._onUndoPerformed.dispose();
    this._onRedoPerformed.dispose();
    this._onOperationRecorded.dispose();
  }
}

function snapshotsEqual(
  a: FileContentSnapshot,
  b: FileContentSnapshot,
): boolean {
  if (a.content === null && b.content === null) {
    return true;
  }
  if (a.content === null || b.content === null) {
    return false;
  }
  if (a.content.byteLength !== b.content.byteLength) {
    return false;
  }
  for (let i = 0; i < a.content.byteLength; i++) {
    if (a.content[i] !== b.content[i]) {
      return false;
    }
  }
  return true;
}

function pathsLikelyMatch(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const norm = (p: string) =>
    p
      .replace(/^file:\/\//, "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

function summarizeSnapshotChange(op: OperationRecord): string {
  const before = op.before?.content;
  const after = op.after?.content;
  if (before === null || before === undefined) {
    if (after === null || after === undefined) {
      return t("history.changeNone");
    }
    return t("history.changeCreated", { bytes: String(after.byteLength) });
  }
  if (after === null || after === undefined) {
    return t("history.changeDeleted", { bytes: String(before.byteLength) });
  }
  return t("history.changeModified", {
    before: String(before.byteLength),
    after: String(after.byteLength),
  });
}
