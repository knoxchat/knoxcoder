import { EventEmitter } from 'events';

import { ToolCall, ContextItem } from 'core';
import * as vscode from 'vscode';
import { FileSystemWatcher } from 'vscode';

// Agent operation types
export enum AgentOperationType {
  TOOL_CALL = 'tool_call',
  FILE_OPERATION = 'file_operation',
  CODE_INTERACTION = 'code_interaction'
}

// Agent operation status
export enum AgentOperationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Agent operation result
export interface AgentOperationResult {
  id: string;
  status: AgentOperationStatus;
  type: AgentOperationType;
  result?: any;
  error?: Error;
  timestamp: number;
}

// File operation types
export enum FileOperationType {
  READ = 'read',
  WRITE = 'write',
  CREATE = 'create',
  DELETE = 'delete',
  RENAME = 'rename'
}

// File operation interface
export interface FileOperation {
  type: FileOperationType;
  uri: vscode.Uri;
  content?: string;
  newUri?: vscode.Uri; // For rename operations
}

export class AgentService {
  private static instance: AgentService;
  private fileWatchers: Map<string, FileSystemWatcher> = new Map();
  private operationHistory: AgentOperationResult[] = [];
  private pendingOperations: Map<string, AgentOperationResult> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  private undoStack: any[] = [];
  private redoStack: any[] = [];

  // Singleton pattern
  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  private constructor() {
    // Initialize the agent service
    console.log('Initializing Agent Service...');
  }

  // Register event handlers
  public on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  // Tool call handling with dynamic model switching support
  public async executeToolCall(toolCall: ToolCall, selectedModelTitle: string, viewReadModelTitle?: string | null, realTimeSearchModelTitle?: string | null, preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch'): Promise<ContextItem[]> {
    const operationId = this.createOperation(AgentOperationType.TOOL_CALL);
    
    try {
      // Set operation status to in progress
      this.updateOperationStatus(operationId, AgentOperationStatus.IN_PROGRESS);
      
      // Execute the tool call through the core messenger
      // Get the extension instance to access the core
      const result = await vscode.commands.executeCommand('knox.callToolDirect', {
        toolCall,
        selectedModelTitle,
        viewReadModelTitle,
        realTimeSearchModelTitle,
        preferredModel
      });
      
      // Set operation status to completed
      this.updateOperationStatus(operationId, AgentOperationStatus.COMPLETED, result);
      
      // Fix: Cast the result as ContextItem[] to match the return type
      return result as ContextItem[];
    } catch (error) {
      // Set operation status to failed
      this.updateOperationStatus(operationId, AgentOperationStatus.FAILED, undefined, error as Error);
      throw error;
    }
  }

  // File operations with undo/redo support
  public async executeFileOperation(operation: FileOperation): Promise<void> {
    const operationId = this.createOperation(AgentOperationType.FILE_OPERATION);
    
    try {
      // Set operation status to in progress
      this.updateOperationStatus(operationId, AgentOperationStatus.IN_PROGRESS);
      
      // Store current state for undo
      if (operation.type === FileOperationType.WRITE || operation.type === FileOperationType.DELETE) {
        try {
          const originalContent = await vscode.workspace.fs.readFile(operation.uri);
          this.undoStack.push({
            type: FileOperationType.WRITE,
            uri: operation.uri,
            content: Buffer.from(originalContent).toString('utf-8')
          });
        } catch (e) {
          // For WRITE and DELETE operations, we need the file to exist
          // If the file doesn't exist, that's an error for these operations
          throw e;
        }
      }
      
      // Execute the file operation
      switch (operation.type) {
        case FileOperationType.READ:
          const content = await vscode.workspace.fs.readFile(operation.uri);
          this.updateOperationStatus(operationId, AgentOperationStatus.COMPLETED, {
            content: Buffer.from(content).toString('utf-8')
          });
          break;
          
        case FileOperationType.WRITE:
          await vscode.workspace.fs.writeFile(operation.uri, Buffer.from(operation.content || ''));
          this.updateOperationStatus(operationId, AgentOperationStatus.COMPLETED);
          break;
          
        case FileOperationType.CREATE:
          await vscode.workspace.fs.writeFile(operation.uri, Buffer.from(operation.content || ''));
          this.updateOperationStatus(operationId, AgentOperationStatus.COMPLETED);
          break;
          
        case FileOperationType.DELETE:
          await vscode.workspace.fs.delete(operation.uri);
          this.updateOperationStatus(operationId, AgentOperationStatus.COMPLETED);
          break;
          
        case FileOperationType.RENAME:
          if (!operation.newUri) {
            throw new Error('New URI is required for rename operations');
          }
          await vscode.workspace.fs.rename(operation.uri, operation.newUri);
          this.updateOperationStatus(operationId, AgentOperationStatus.COMPLETED);
          break;
      }
      
    } catch (error) {
      // Set operation status to failed
      this.updateOperationStatus(operationId, AgentOperationStatus.FAILED, undefined, error as Error);
      throw error;
    }
  }
  
  // Undo last operation
  public async undo(): Promise<void> {
    const lastOperation = this.undoStack.pop();
    if (lastOperation) {
      // Store current state for redo
      try {
        const currentContent = await vscode.workspace.fs.readFile(lastOperation.uri);
        this.redoStack.push({
          type: FileOperationType.WRITE,
          uri: lastOperation.uri,
          content: Buffer.from(currentContent).toString('utf-8')
        });
      } catch (e) {
        // File might have been deleted
        this.redoStack.push({
          type: FileOperationType.DELETE,
          uri: lastOperation.uri
        });
      }
      
      // Execute the undo operation
      await this.executeFileOperation(lastOperation);
      
      // Notify that an undo operation was performed
      this.eventEmitter.emit('undo', lastOperation);
    }
  }
  
  // Redo last undone operation
  public async redo(): Promise<void> {
    const lastUndoneOperation = this.redoStack.pop();
    if (lastUndoneOperation) {
      // Store current state for undo
      try {
        const currentContent = await vscode.workspace.fs.readFile(lastUndoneOperation.uri);
        this.undoStack.push({
          type: FileOperationType.WRITE,
          uri: lastUndoneOperation.uri,
          content: Buffer.from(currentContent).toString('utf-8')
        });
      } catch (e) {
        // File might have been deleted
        this.undoStack.push({
          type: FileOperationType.DELETE,
          uri: lastUndoneOperation.uri
        });
      }
      
      // Execute the redo operation
      await this.executeFileOperation(lastUndoneOperation);
      
      // Notify that a redo operation was performed
      this.eventEmitter.emit('redo', lastUndoneOperation);
    }
  }
  
  // Watch file for changes
  public watchFile(uri: vscode.Uri): void {
    if (!this.fileWatchers.has(uri.toString())) {
      const watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
      
      watcher.onDidChange((uri) => {
        this.eventEmitter.emit('file_changed', uri);
      });
      
      watcher.onDidCreate((uri) => {
        this.eventEmitter.emit('file_created', uri);
      });
      
      watcher.onDidDelete((uri) => {
        this.eventEmitter.emit('file_deleted', uri);
      });
      
      this.fileWatchers.set(uri.toString(), watcher);
    }
  }
  
  // Stop watching file
  public unwatchFile(uri: vscode.Uri): void {
    const watcher = this.fileWatchers.get(uri.toString());
    if (watcher) {
      watcher.dispose();
      this.fileWatchers.delete(uri.toString());
    }
  }
  
  // Get operation history
  public getOperationHistory(): AgentOperationResult[] {
    return [...this.operationHistory];
  }
  
  // Get pending operations
  public getPendingOperations(): AgentOperationResult[] {
    return Array.from(this.pendingOperations.values());
  }
  
  // Clear operation history
  public clearOperationHistory(): void {
    this.operationHistory = [];
  }
  
  // Create a new operation and add it to pending operations
  private createOperation(type: AgentOperationType): string {
    const id = `operation-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const operation: AgentOperationResult = {
      id,
      status: AgentOperationStatus.PENDING,
      type,
      timestamp: Date.now()
    };
    
    this.pendingOperations.set(id, operation);
    return id;
  }
  
  // Update operation status
  private updateOperationStatus(id: string, status: AgentOperationStatus, result?: any, error?: Error): void {
    const operation = this.pendingOperations.get(id);
    if (operation) {
      operation.status = status;
      if (result) {operation.result = result;}
      if (error) {operation.error = error;}
      
      // If operation is complete or failed, move it to history
      if (status === AgentOperationStatus.COMPLETED || status === AgentOperationStatus.FAILED || status === AgentOperationStatus.CANCELLED) {
        this.operationHistory.push(operation);
        this.pendingOperations.delete(id);
      }
      
      // Emit event for operation status change
      this.eventEmitter.emit('operation_status_changed', operation);
    }
  }
  
  // Clean up resources
  public dispose(): void {
    // Dispose all file watchers
    this.fileWatchers.forEach((watcher) => {
      watcher.dispose();
    });
    
    this.fileWatchers.clear();
    this.eventEmitter.removeAllListeners();
  }
} 