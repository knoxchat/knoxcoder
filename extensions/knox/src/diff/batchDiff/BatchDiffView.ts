import * as vscode from 'vscode';

import { BatchDiffEntry, BatchDiffManager, BatchDiffResult } from './BatchDiffManager';

/**
 * BatchDiffView renders a webview panel that shows all pending
 * multi-file diffs in a unified tree view, allowing users to
 * select/deselect individual files and apply or reject all at once.
 */
export class BatchDiffView implements vscode.Disposable {
  private static instance: BatchDiffView;
  private disposables: vscode.Disposable[] = [];
  private batchManager: BatchDiffManager;

  // Tree data provider for the batch diff file list
  private treeDataProvider: BatchDiffTreeDataProvider;
  private treeView: vscode.TreeView<BatchDiffTreeItem> | null = null;

  static getInstance(): BatchDiffView {
    if (!BatchDiffView.instance) {
      BatchDiffView.instance = new BatchDiffView();
    }
    return BatchDiffView.instance;
  }

  private constructor() {
    this.batchManager = BatchDiffManager.getInstance();
    this.treeDataProvider = new BatchDiffTreeDataProvider(this.batchManager);

    this.registerTreeView();
    this.registerCommands();
    this.listenForBatchEvents();
  }

  private registerTreeView(): void {
    this.treeView = vscode.window.createTreeView('knox.batchDiffView', {
      treeDataProvider: this.treeDataProvider,
      canSelectMany: true,
    });
    this.disposables.push(this.treeView);
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand('knox.batchDiff.refresh', () => {
        this.refresh();
      }),
      vscode.commands.registerCommand('knox.batchDiff.toggleFile', (item: BatchDiffTreeItem) => {
        if (item.entry) {
          item.entry.selected = !item.entry.selected;
          this.treeDataProvider.refresh();
        }
      }),
      vscode.commands.registerCommand('knox.batchDiff.selectAll', () => {
        this.treeDataProvider.setAllSelected(true);
      }),
      vscode.commands.registerCommand('knox.batchDiff.deselectAll', () => {
        this.treeDataProvider.setAllSelected(false);
      }),
      vscode.commands.registerCommand('knox.batchDiff.openFile', async (filepath: string) => {
        try {
          const uri = vscode.Uri.file(filepath);
          await vscode.commands.executeCommand('vscode.open', uri);
        } catch {
          // File may not exist
        }
      }),
    );
  }

  private listenForBatchEvents(): void {
    this.disposables.push(
      this.batchManager.onBatchCompleted((result: BatchDiffResult) => {
        this.refresh();
        if (result.failedFiles.length === 0) {
          vscode.window.showInformationMessage(
            `Batch complete: ${result.successFiles}/${result.totalFiles} files processed`,
          );
        }
      }),
    );
  }

  /**
   * Refresh the tree view with current pending diffs.
   */
  public refresh(): void {
    this.treeDataProvider.refresh();
  }

  /**
   * Show the batch diff view panel.
   */
  public show(): void {
    if (this.treeView) {
      this.treeView.reveal(this.treeDataProvider.getFirstItem(), {
        focus: true,
        select: false,
      }).then(undefined, () => {
        // Tree might be empty
      });
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

// ── Tree Data Model ──────────────────────────────────────────────────

class BatchDiffTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: BatchDiffEntry | null,
    public readonly label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);

    if (entry) {
      this.description = `${entry.numDiffs} change(s)`;
      this.tooltip = entry.filepath;
      this.contextValue = entry.selected ? 'batchDiffFile-selected' : 'batchDiffFile-deselected';
      this.iconPath = new vscode.ThemeIcon(
        entry.selected ? 'check' : 'circle-outline',
      );

      // Click opens the file
      this.command = {
        command: 'knox.batchDiff.openFile',
        title: 'Open File',
        arguments: [entry.filepath],
      };
    }
  }
}

class BatchDiffTreeDataProvider implements vscode.TreeDataProvider<BatchDiffTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BatchDiffTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private entries: BatchDiffEntry[] = [];

  constructor(private batchManager: BatchDiffManager) {
    this.loadEntries();
  }

  private loadEntries(): void {
    this.entries = this.batchManager.getPendingFiles();
  }

  refresh(): void {
    this.loadEntries();
    this._onDidChangeTreeData.fire(undefined);
  }

  setAllSelected(selected: boolean): void {
    for (const entry of this.entries) {
      entry.selected = selected;
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getFirstItem(): BatchDiffTreeItem {
    if (this.entries.length > 0) {
      return this.createTreeItem(this.entries[0]);
    }
    return new BatchDiffTreeItem(null, 'No pending diffs', vscode.TreeItemCollapsibleState.None);
  }

  getTreeItem(element: BatchDiffTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BatchDiffTreeItem): BatchDiffTreeItem[] {
    if (element) return []; // No nested items

    if (this.entries.length === 0) {
      return [
        new BatchDiffTreeItem(null, 'No pending diffs', vscode.TreeItemCollapsibleState.None),
      ];
    }

    return this.entries.map((entry) => this.createTreeItem(entry));
  }

  private createTreeItem(entry: BatchDiffEntry): BatchDiffTreeItem {
    const fileName = entry.filepath.split('/').pop() || entry.filepath;
    return new BatchDiffTreeItem(
      entry,
      fileName,
      vscode.TreeItemCollapsibleState.None,
    );
  }
}
