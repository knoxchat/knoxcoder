import { EventEmitter } from "events";

import { ToolCall, ContextItem } from "core";
import * as vscode from "vscode";
import { FileSystemWatcher } from "vscode";

export enum AgentOperationType {
  TOOL_CALL = "tool_call",
  FILE_OPERATION = "file_operation",
  CODE_INTERACTION = "code_interaction",
}

export enum AgentOperationStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export interface AgentOperationResult {
  id: string;
  status: AgentOperationStatus;
  type: AgentOperationType;
  result?: unknown;
  error?: Error;
  timestamp: number;
}

export enum FileOperationType {
  READ = "read",
  WRITE = "write",
  CREATE = "create",
  DELETE = "delete",
  RENAME = "rename",
}

export interface FileOperation {
  type: FileOperationType;
  uri: vscode.Uri;
  content?: string;
  newUri?: vscode.Uri;
}

/**
 * Leftover host helper (K-080 / K-081). Product tools go through
 * `knox.callToolDirect`. Undo is CommandHistoryService only.
 */
export class AgentService {
  private static instance: AgentService;
  private fileWatchers: Map<string, FileSystemWatcher> = new Map();
  private operationHistory: AgentOperationResult[] = [];
  private pendingOperations: Map<string, AgentOperationResult> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  private constructor() {}

  public on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  public async executeToolCall(
    toolCall: ToolCall,
    selectedModelTitle: string,
    viewReadModelTitle?: string | null,
    realTimeSearchModelTitle?: string | null,
    preferredModel?: "chat" | "viewRead" | "realTimeSearch",
  ): Promise<ContextItem[]> {
    const result = await vscode.commands.executeCommand("knox.callToolDirect", {
      toolCall,
      selectedModelTitle,
      viewReadModelTitle,
      realTimeSearchModelTitle,
      preferredModel,
    });
    if (!Array.isArray(result)) {
      throw new Error(
        "knox.callToolDirect did not return context items (is vscode.knox activated?)",
      );
    }
    return result as ContextItem[];
  }

  /** @deprecated K-081. Mutate files via Core tools/call. */
  public async executeFileOperation(_operation: FileOperation): Promise<void> {
    throw new Error(
      "AgentService.executeFileOperation is removed. Mutate files via Core tools/call (knox.callToolDirect) so CommandHistoryService can undo.",
    );
  }

  /** @deprecated K-081. Use knox.undoLastOperation / CommandHistoryService. */
  public async undo(): Promise<void> {
    throw new Error(
      "AgentService.undo is removed. Use knox.undoLastOperation (CommandHistoryService).",
    );
  }

  /** @deprecated K-081. Use knox.redoLastOperation / CommandHistoryService. */
  public async redo(): Promise<void> {
    throw new Error(
      "AgentService.redo is removed. Use knox.redoLastOperation (CommandHistoryService).",
    );
  }

  public watchFile(uri: vscode.Uri): void {
    if (!this.fileWatchers.has(uri.toString())) {
      const watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
      watcher.onDidChange((changed) => {
        this.eventEmitter.emit("file_changed", changed);
      });
      watcher.onDidCreate((created) => {
        this.eventEmitter.emit("file_created", created);
      });
      watcher.onDidDelete((deleted) => {
        this.eventEmitter.emit("file_deleted", deleted);
      });
      this.fileWatchers.set(uri.toString(), watcher);
    }
  }

  public unwatchFile(uri: vscode.Uri): void {
    const watcher = this.fileWatchers.get(uri.toString());
    if (watcher) {
      watcher.dispose();
      this.fileWatchers.delete(uri.toString());
    }
  }

  public getOperationHistory(): AgentOperationResult[] {
    return [...this.operationHistory];
  }

  public getPendingOperations(): AgentOperationResult[] {
    return Array.from(this.pendingOperations.values());
  }

  public clearOperationHistory(): void {
    this.operationHistory = [];
  }

  public dispose(): void {
    this.fileWatchers.forEach((watcher) => {
      watcher.dispose();
    });
    this.fileWatchers.clear();
    this.eventEmitter.removeAllListeners();
  }
}
