import { EventEmitter } from 'events';

import { ToolCall } from 'core';
import * as vscode from 'vscode';

import { t } from '../i18n';

import { AgentModeManager } from './AgentModeManager';
import { DiagnosticChecker } from './DiagnosticChecker';
import { DiagnosticFixManager } from './DiagnosticFixManager';

/**
 * Types of operations that can be performed in a chat flow
 */
export enum ChatOperationType {
  CODE_GENERATION = 'code_generation',
  FILE_READING = 'file_reading',
  COMMAND_EXECUTION = 'command_execution',
  TOOL_CALL = 'tool_call',
  CONTEXT_GATHERING = 'context_gathering'
}

/**
 * Status of a chat operation
 */
export enum ChatOperationStatus {
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled'
}

/**
 * Represents an operation in the chat flow
 */
export interface ChatOperation {
  id: string;
  type: ChatOperationType;
  status: ChatOperationStatus;
  description: string;
  payload: any;
  result?: any;
  error?: Error;
  timestamp: number;
  timeCompleted?: number;
}

/**
 * Coordinates the flow of operations in agent mode chat
 */
export class ChatFlowCoordinator implements vscode.Disposable {
  private static instance: ChatFlowCoordinator;
  private operationQueue: ChatOperation[] = [];
  private activeOperation: ChatOperation | null = null;
  private eventEmitter = new EventEmitter();
  private disposables: vscode.Disposable[] = [];
  private isProcessing = false;
  private autoScrollEnabled = true;
  private agentModeManager?: AgentModeManager;
  private diagnosticChecker: DiagnosticChecker;
  private diagnosticFixManager: DiagnosticFixManager;
  
  // Autoscroll timeout - used to handle automatic scrolling to latest operation
  private autoScrollTimeout: NodeJS.Timeout | null = null;
  
  // Progress notification
  private progressNotification: vscode.Progress<{ message?: string; increment?: number }> | null = null;
  private progressResolver: (() => void) | null = null;
  
  // Operation timing tracking
  private operationTimings: Map<string, number> = new Map();
  
  // Event emitters
  private _onOperationQueued = new vscode.EventEmitter<ChatOperation>();
  public readonly onOperationQueued = this._onOperationQueued.event;
  
  private _onOperationStarted = new vscode.EventEmitter<ChatOperation>();
  public readonly onOperationStarted = this._onOperationStarted.event;
  
  private _onOperationCompleted = new vscode.EventEmitter<ChatOperation>();
  public readonly onOperationCompleted = this._onOperationCompleted.event;
  
  private _onOperationFailed = new vscode.EventEmitter<{ operation: ChatOperation; error: Error }>();
  public readonly onOperationFailed = this._onOperationFailed.event;
  
  private _onQueueEmpty = new vscode.EventEmitter<void>();
  public readonly onQueueEmpty = this._onQueueEmpty.event;
  
  private _onAutoScrollChanged = new vscode.EventEmitter<boolean>();
  public readonly onAutoScrollChanged = this._onAutoScrollChanged.event;
  
  private _onDiagnosticsFound = new vscode.EventEmitter<{
    filePath: string;
    hasErrors: boolean;
    hasWarnings: boolean;
    fixAttempt: number;
  }>();
  public readonly onDiagnosticsFound = this._onDiagnosticsFound.event;
  
  private _onStreamingUpdate = new vscode.EventEmitter<{ content: string; isComplete: boolean }>();
  public readonly onStreamingUpdate = this._onStreamingUpdate.event;
  
  // Track last emitted content to prevent duplicate events
  private lastEmittedContent = "";
  
  /**
   * Emit a streaming update event
   * This is called when Redux dispatches streamUpdate actions in Agent Mode
   */
  public emitStreamingUpdate(content: string, isComplete: boolean = false): void {
    // Only emit if content has changed (to prevent duplicate events from loops)
    if (content !== this.lastEmittedContent || isComplete) {
      this.lastEmittedContent = content;
      this._onStreamingUpdate.fire({ content, isComplete });
      
      // Reset tracking when streaming completes
      if (isComplete) {
        this.lastEmittedContent = "";
      }
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ChatFlowCoordinator {
    if (!ChatFlowCoordinator.instance) {
      ChatFlowCoordinator.instance = new ChatFlowCoordinator();
    }
    return ChatFlowCoordinator.instance;
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Initialize diagnostic services
    this.diagnosticChecker = DiagnosticChecker.getInstance();
    this.diagnosticFixManager = DiagnosticFixManager.getInstance();
    
    // Register command to toggle auto-scroll
    this.disposables.push(
      vscode.commands.registerCommand('knox.toggleAutoScroll', () => {
        this.autoScrollEnabled = !this.autoScrollEnabled;
        this._onAutoScrollChanged.fire(this.autoScrollEnabled);
      })
    );
    
    // Register command to manually scroll to latest operation
    this.disposables.push(
      vscode.commands.registerCommand('knox.scrollToLatestOperation', () => {
        this.scrollToLatestOperation();
      })
    );
    
    // Register keybinding for manual scroll (works even when auto-scroll is off)
    this.disposables.push(
      vscode.commands.registerCommand('knox.viewNextOperation', () => {
        this.viewNextOperation();
      })
    );
    
    // Register keybinding for viewing previous operation
    this.disposables.push(
      vscode.commands.registerCommand('knox.viewPreviousOperation', () => {
        this.viewPreviousOperation();
      })
    );
    
    // Listen for diagnostics fix manager events
    this.diagnosticFixManager.onFixAttemptStarted(filePath => {
      console.log(`Starting fix attempt for ${filePath}`);
    });
    
    this.diagnosticFixManager.onFixAttemptCompleted(result => {
      console.log(`Fix attempt completed for ${result.filePath}: ${result.success ? 'Success' : 'Failed'}`);
      if (result.issues.length > 0) {
        console.log(`Remaining issues: ${result.issues.length}`);
      }
    });
  }

  /**
   * Set the AgentModeManager instance
   */
  public setAgentModeManager(manager: AgentModeManager): void {
    this.agentModeManager = manager;
  }

  /**
   * Queue a new operation
   */
  public queueOperation(type: ChatOperationType, description: string, payload: any): string {
    const id = `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const operation: ChatOperation = {
      id,
      type,
      status: ChatOperationStatus.QUEUED,
      description,
      payload,
      timestamp: Date.now()
    };
    
    this.operationQueue.push(operation);
    this._onOperationQueued.fire(operation);
    
    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processNextOperation();
    }
    
    return id;
  }
  
  /**
   * Process the next operation in the queue
   */
  private async processNextOperation(): Promise<void> {
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // Get the next operation
      const operation = this.operationQueue.shift()!;
      this.activeOperation = operation;
      
      // Update status
      operation.status = ChatOperationStatus.IN_PROGRESS;
      
      // Show progress notification
      this.showProgressNotification();
      
      // Fire event
      this._onOperationStarted.fire(operation);
      
      // Start timing
      this.operationTimings.set(operation.id, Date.now());
      
      // Process based on operation type
      switch (operation.type) {
        case ChatOperationType.CODE_GENERATION:
          await this.processCodeGeneration(operation);
          break;
        case ChatOperationType.FILE_READING:
          await this.processFileReading(operation);
          break;
        case ChatOperationType.COMMAND_EXECUTION:
          await this.processCommandExecution(operation);
          break;
        case ChatOperationType.TOOL_CALL:
          await this.processToolCall(operation);
          break;
        case ChatOperationType.CONTEXT_GATHERING:
          await this.processContextGathering(operation);
          break;
        default:
          throw new Error(`Unknown operation type: ${operation.type}`);
      }
      
      // Auto-scroll if enabled
      if (this.autoScrollEnabled) {
        this.scrollToLatestOperation();
      }
    } catch (error) {
      console.error('Error processing operation:', error);
    } finally {
      this.isProcessing = false;
      this.activeOperation = null;
      
      // Close progress notification
      this.closeProgressNotification();
      
      // Process next operation if any
      if (this.operationQueue.length > 0) {
        this.processNextOperation();
      } else {
        // Queue is empty
        this._onQueueEmpty.fire();
      }
    }
  }
  
  /**
   * Show progress notification for current operations
   */
  private showProgressNotification(): void {
    // If we already have a progress notification, just update the message
    if (this.progressNotification) {
      const opText = this.getOperationDescription(this.activeOperation!);
      this.progressNotification.report({ message: opText });
      return;
    }
    
    // Create a new progress notification
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('agent.progressTitle'),
      cancellable: true
    }, (progress, token) => {
      // Store the progress object
      this.progressNotification = progress;
      
      // Initial message
      const opText = this.getOperationDescription(this.activeOperation!);
      progress.report({ message: opText });
      
      // Handle cancellation
      token.onCancellationRequested(() => {
        this.cancelAllOperations();
      });
      
      // Return a promise that resolves when all operations are done
      return new Promise<void>(resolve => {
        this.progressResolver = resolve;
      });
    });
  }
  
  /**
   * Close the progress notification
   */
  private closeProgressNotification(): void {
    if (this.progressResolver) {
      this.progressResolver();
      this.progressResolver = null;
      this.progressNotification = null;
    }
  }
  
  /**
   * Get a user-friendly description of an operation
   */
  private getOperationDescription(operation: ChatOperation): string {
    const description = operation.description;
    switch (operation.type) {
      case ChatOperationType.CODE_GENERATION:
        return t("agent.op.generatingCode", { description });
      case ChatOperationType.FILE_READING:
        return t("agent.op.readingFile", { description });
      case ChatOperationType.COMMAND_EXECUTION:
        return t("agent.op.runningCommand", { description });
      case ChatOperationType.TOOL_CALL:
        return t("agent.op.executingTool", { description });
      case ChatOperationType.CONTEXT_GATHERING:
        return t("agent.op.gatheringContext", { description });
      default:
        return description;
    }
  }
  
  /**
   * Process code generation operation
   */
  private async processCodeGeneration(operation: ChatOperation): Promise<void> {
    // Code generation operations are typically handled by editing files
    // The payload should contain the file path and the code to generate
    const { filePath, code, openFileAfter } = operation.payload;
    
    if (!filePath || !code) {
      throw new Error('Invalid code generation payload: filePath and code are required');
    }
    
    // Create a URI for the file
    const uri = vscode.Uri.file(filePath);
    
    // Create or update the file
    try {
      // Check if file exists
      let fileExists = false;
      try {
        await vscode.workspace.fs.stat(uri);
        fileExists = true;
      } catch (e) {
        fileExists = false;
      }
      
      // Write the file
      await vscode.workspace.fs.writeFile(uri, Buffer.from(code));
      
      // Set the operation result
      operation.result = {
        success: true,
        filePath,
        fileExists,
        created: !fileExists
      };
      
      // Open the file if requested
      if (openFileAfter) {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
      }
    } catch (e) {
      throw new Error(`Failed to write file ${filePath}: ${(e as Error).message}`);
    }
  }
  
  /**
   * Process file reading operation
   */
  private async processFileReading(operation: ChatOperation): Promise<void> {
    // The payload should contain the file path
    const { filePath } = operation.payload;
    
    if (!filePath) {
      throw new Error('Invalid file reading payload: filePath is required');
    }
    
    // Create a URI for the file
    const uri = vscode.Uri.file(filePath);
    
    // Read the file
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      
      // Set the operation result
      operation.result = {
        content: Buffer.from(content).toString('utf-8'),
        filePath
      };
    } catch (e) {
      throw new Error(`Failed to read file ${filePath}: ${(e as Error).message}`);
    }
  }
  
  /**
   * Process command execution operation
   */
  private async processCommandExecution(operation: ChatOperation): Promise<void> {
    // The payload should contain the command to execute
    const { command, cwd, showOutput } = operation.payload;
    
    if (!command) {
      throw new Error('Invalid command execution payload: command is required');
    }
    
    // Execute the command using the terminal
    try {
      // Create a terminal for the command
      const terminal = vscode.window.createTerminal({
        name: t('agent.commandName', { command }),
        cwd: cwd || undefined
      });
      
      // Show the terminal if requested
      if (showOutput) {
        terminal.show();
      }
      
      // Execute the command
      terminal.sendText(command);
      
      // Set the operation result
      operation.result = {
        command,
        cwd: cwd || 'workspace root',
        terminalId: terminal.processId
      };
      
      // Give the command a moment to start
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      throw new Error(`Failed to execute command ${command}: ${(e as Error).message}`);
    }
  }
  
  /**
   * Process tool call operation with dynamic model switching support
   */
  private async processToolCall(operation: ChatOperation): Promise<void> {
    // The payload should contain the tool call details
    const { toolCall, selectedModelTitle, viewReadModelTitle, realTimeSearchModelTitle, preferredModel } = operation.payload;
    
    if (!toolCall || !selectedModelTitle) {
      throw new Error('Invalid tool call payload: toolCall and selectedModelTitle are required');
    }

    // If viewReadModelTitle is not provided, get the current one from configuration
    let effectiveViewReadModelTitle = viewReadModelTitle;
    if (!effectiveViewReadModelTitle) {
      try {
        effectiveViewReadModelTitle = await vscode.commands.executeCommand('knox.getCurrentViewReadModel') as string | null;
        if (effectiveViewReadModelTitle) {
          console.log(`[Agent Mode] Retrieved View/Read model from config: ${effectiveViewReadModelTitle}`);
        } else {
          console.log(`[Agent Mode] No View/Read model configured`);
        }
      } catch (error) {
        console.warn('Failed to get current View/Read model:', error);
        effectiveViewReadModelTitle = null;
      }
    } else {
      console.log(`[Agent Mode] Using provided View/Read model: ${effectiveViewReadModelTitle}`);
    }
    
    // If realTimeSearchModelTitle is not provided, get the current one from configuration
    let effectiveRealTimeSearchModelTitle = realTimeSearchModelTitle;
    if (!effectiveRealTimeSearchModelTitle) {
      try {
        effectiveRealTimeSearchModelTitle = await vscode.commands.executeCommand('knox.getCurrentRealTimeSearchModel') as string | null;
        if (effectiveRealTimeSearchModelTitle) {
          console.log(`[Agent Mode] Retrieved RealTimeSearch model from config: ${effectiveRealTimeSearchModelTitle}`);
        } else {
          console.log(`[Agent Mode] No RealTimeSearch model configured`);
        }
      } catch (error) {
        console.warn('Failed to get current RealTimeSearch model:', error);
        effectiveRealTimeSearchModelTitle = null;
      }
    } else {
      console.log(`[Agent Mode] Using provided RealTimeSearch model: ${effectiveRealTimeSearchModelTitle}`);
    }
    
    console.log(`[Agent Mode] Processing tool call with preferredModel: ${preferredModel || 'auto'}`);
    
    // Execute via Core tools/call (post-edit verification runs on that shared path).
    try {
      const result = await this.agentModeManager!.executeToolCall(
        toolCall,
        selectedModelTitle,
        effectiveViewReadModelTitle,
        effectiveRealTimeSearchModelTitle,
      );

      operation.result = {
        ...operation.result,
        contextItems: result,
        toolName: toolCall.function.name,
        success: true
      };
    } catch (e) {
      // Enhanced error handling
      const error = e as Error;
      
      // Record failure in result
      operation.result = {
        contextItems: [],
        toolName: toolCall.function.name,
        success: false,
        errorMessage: error.message,
        errorStack: error.stack
      };
      
      // Create a more informative error message
      let errorMessage = `Failed to execute tool call ${toolCall.function.name}: ${error.message}`;
      
      // Add hints for specific errors
      if (error.message.includes('ENOENT')) {
        errorMessage += ' (File or directory not found)';
      } else if (error.message.includes('EACCES')) {
        errorMessage += ' (Permission denied)';
      } else if (error.message.includes('JSON')) {
        errorMessage += ' (Invalid JSON in tool arguments)';
      }
      
      throw new Error(errorMessage);
    }
  }
  
  /**
   * Process context gathering operation
   */
  private async processContextGathering(operation: ChatOperation): Promise<void> {
    try {
      // Check if this is a structured reasoning task
      if (operation.payload.analysis && operation.payload.task) {
        // We already have task analysis results from the ReasoningEngine
        const analysis = operation.payload.analysis;
        const task = operation.payload.task;
        
        // Gather relevant files based on the task
        const relevantFiles: string[] = [];
        
        // Log the structured analysis
        console.log(`Processing task: ${task}`);
        console.log(`Complexity: ${analysis.estimatedComplexity}`);
        console.log(`Steps: ${analysis.steps.length}`);
        
        // Set the result with structured analysis data
        operation.result = {
          task,
          analysis: analysis.analysis,
          steps: analysis.steps,
          complexity: analysis.estimatedComplexity,
          relevantFiles
        };
      } else {
        // For other context gathering operations, gather basic workspace info
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const activeEditor = vscode.window.activeTextEditor;
        
        // Set basic context result
        operation.result = {
          workspaceInfo: {
            folders: workspaceFolders.map(folder => folder.uri.fsPath),
            activeFile: activeEditor?.document.uri.fsPath || null
          },
          contextSize: Math.floor(Math.random() * 1000) + 100
        };
      }
    } catch (error) {
      console.error('Error in processContextGathering:', error);
      // Set a basic result when error occurs
      operation.result = {
        error: (error as Error).message,
        contextSize: 0
      };
    }
  }
  
  /**
   * Cancel all operations
   */
  public cancelAllOperations(): void {
    // Mark active operation as canceled
    if (this.activeOperation) {
      this.activeOperation.status = ChatOperationStatus.CANCELED;
    }
    
    // Clear operation queue
    this.operationQueue = [];
    
    // Reset processing flag
    this.isProcessing = false;
    
    // Close progress notification
    this.closeProgressNotification();
  }
  
  /**
   * Scroll to the latest operation
   */
  public scrollToLatestOperation(): void {
    // Clear any existing auto-scroll timeout
    if (this.autoScrollTimeout) {
      clearTimeout(this.autoScrollTimeout);
      this.autoScrollTimeout = null;
    }
    
    // Delay auto-scroll slightly to allow UI to update
    this.autoScrollTimeout = setTimeout(() => {
      // We need to post a message to the webview to scroll to the latest operation
      // This would be implemented in the webview/UI layer
      vscode.commands.executeCommand('knox.scrollToLatestAgentOperation');
      this.autoScrollTimeout = null;
    }, 100);
  }
  
  /**
   * View the next operation in the history
   */
  public viewNextOperation(): void {
    // This would be implemented in the webview/UI layer
    vscode.commands.executeCommand('knox.viewNextAgentOperation');
  }
  
  /**
   * View the previous operation in the history
   */
  public viewPreviousOperation(): void {
    // This would be implemented in the webview/UI layer
    vscode.commands.executeCommand('knox.viewPreviousAgentOperation');
  }
  
  /**
   * Toggle auto-scroll
   */
  public toggleAutoScroll(): void {
    vscode.commands.executeCommand('knox.toggleAutoScroll');
  }
  
  /**
   * Get active operation
   */
  public getActiveOperation(): ChatOperation | null {
    return this.activeOperation;
  }
  
  /**
   * Get operation queue
   */
  public getOperationQueue(): ChatOperation[] {
    return [...this.operationQueue];
  }
  
  /**
   * Check if auto-scroll is enabled
   */
  public isAutoScrollEnabled(): boolean {
    return this.autoScrollEnabled;
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    // Cancel any pending operations
    this.cancelAllOperations();
    
    // Clear any auto-scroll timeout
    if (this.autoScrollTimeout) {
      clearTimeout(this.autoScrollTimeout);
      this.autoScrollTimeout = null;
    }
    
    // Dispose all disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    
    // Dispose event emitters
    this._onOperationQueued.dispose();
    this._onOperationStarted.dispose();
    this._onOperationCompleted.dispose();
    this._onOperationFailed.dispose();
    this._onQueueEmpty.dispose();
    this._onAutoScrollChanged.dispose();
    this._onDiagnosticsFound.dispose();
    this._onStreamingUpdate.dispose();
    
    // Dispose diagnostic services
    this.diagnosticChecker.dispose();
    this.diagnosticFixManager.dispose();
  }
} 