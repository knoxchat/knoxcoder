import { ToolCall, ContextItem } from 'core';
import * as vscode from 'vscode';

import { t } from '../i18n';

import { AgentService, AgentOperationStatus } from './AgentService';
import { ChatFlowCoordinator, ChatOperationType } from './ChatFlowCoordinator';
import { CodeIntelligenceService, CodeSuggestion } from './CodeIntelligenceService';
import { ReasoningEngine, TaskAnalysisResult } from './ReasoningEngine';
import { ShadowWorkspaceManager } from './ShadowWorkspaceManager';

// Agent mode status
export enum AgentModeStatus {
  INACTIVE = 'inactive',
  ACTIVE = 'active',
  PROCESSING = 'processing',
  ERROR = 'error'
}

export class AgentModeManager implements vscode.Disposable {
  private static instance: AgentModeManager;
  private disposables: vscode.Disposable[] = [];
  private agentService: AgentService;
  private codeIntelligenceService: CodeIntelligenceService;
  private chatFlowCoordinator: ChatFlowCoordinator;
  private reasoningEngine: ReasoningEngine;
  private shadowWorkspaceManager: ShadowWorkspaceManager;
  private status: AgentModeStatus = AgentModeStatus.INACTIVE;
  private activeFileWatchers: Map<string, vscode.Disposable> = new Map();
  /** GUI `session.id` — same identity as Memory Brain. */
  private boundSessionId: string | null = null;
  
  // Event emitters
  private _onStatusChanged = new vscode.EventEmitter<AgentModeStatus>();
  public readonly onStatusChanged = this._onStatusChanged.event;
  
  private _onSuggestionsAvailable = new vscode.EventEmitter<{ uri: vscode.Uri, suggestions: CodeSuggestion[] }>();
  public readonly onSuggestionsAvailable = this._onSuggestionsAvailable.event;
  
  // Fired after a tool call finishes (status / diagnostics listeners).
  // Undo snapshots are recorded on the Core tools/call path via IDE hooks.
  private _onToolCallExecuted = new vscode.EventEmitter<{
    toolCall: any;
    result: any;
  }>();
  public readonly onToolCallExecuted = this._onToolCallExecuted.event;
  
  // Streaming event emitter for real-time content updates
  private _onStreamingUpdate = new vscode.EventEmitter<{ content: string, isComplete: boolean }>();
  public readonly onStreamingUpdate = this._onStreamingUpdate.event;

  // Singleton pattern
  public static getInstance(): AgentModeManager {
    if (!AgentModeManager.instance) {
      AgentModeManager.instance = new AgentModeManager();
    }
    return AgentModeManager.instance;
  }

  private constructor() {
    // Initialize services
    this.agentService = AgentService.getInstance();
    this.codeIntelligenceService = CodeIntelligenceService.getInstance();
    // Get ChatFlowCoordinator first
    this.chatFlowCoordinator = ChatFlowCoordinator.getInstance();
    // Initialize the reasoning engine
    this.reasoningEngine = ReasoningEngine.getInstance();
    // Initialize the shadow workspace manager
    this.shadowWorkspaceManager = ShadowWorkspaceManager.getInstance();
    // Then register this instance with the coordinator to complete the circular reference properly
    this.chatFlowCoordinator.setAgentModeManager(this);

    // Commands are registered lazily from activateAgentMode (T7.3).
    
    // Register event handlers
    this.registerEventHandlers();
    
    // Update status
    this.updateStatus(AgentModeStatus.INACTIVE);
  }
  
  /**
   * Register agent commands without constructing AgentModeManager (T7.3).
   * `getManager` should load heavy services on first invocation.
   */
  static registerLazyCommands(getManager: () => AgentModeManager): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand('knox.toggleAgentMode', () => {
        void getManager().toggleAgentMode();
      }),
      vscode.commands.registerCommand('knoxchat.toggleAgentMode', () => {
        void getManager().toggleAgentMode();
      }),
      vscode.commands.registerCommand('knox.executeToolCall', async (params: { toolCall: ToolCall, selectedModelTitle: string, viewReadModelTitle?: string | null }) => {
        return await getManager().executeToolCall(params.toolCall, params.selectedModelTitle, params.viewReadModelTitle);
      }),
      vscode.commands.registerCommand('knox.reapplyEdit', async (params: { targetFile: string, selectedModelTitle: string }) => {
        return await getManager().reapplyEdit(params.targetFile, params.selectedModelTitle);
      }),
      vscode.commands.registerCommand('knox.applySuggestion', async (params: { uri: vscode.Uri, suggestionId: string }) => {
        return await getManager().applySuggestion(params.uri, params.suggestionId);
      }),
      vscode.commands.registerCommand('knox.undoLastOperation', async () => {
        return await getManager().undoLastOperation();
      }),
      vscode.commands.registerCommand('knox.chatoLastOperation', async () => {
        return await getManager().redoLastOperation();
      }),
      vscode.commands.registerCommand('knox.redoLastOperation', async () => {
        return await getManager().redoLastOperation();
      }),
      vscode.commands.registerCommand('knoxchat.scrollToLatestAgentOperation', () => {
        getManager().chatFlowCoordinator.scrollToLatestOperation();
      }),
      vscode.commands.registerCommand('knoxchat.viewNextAgentOperation', () => {
        getManager().chatFlowCoordinator.viewNextOperation();
      }),
      vscode.commands.registerCommand('knoxchat.viewPreviousAgentOperation', () => {
        getManager().chatFlowCoordinator.viewPreviousOperation();
      }),
      vscode.commands.registerCommand('knoxchat.analyzeTask', async (task: string) => {
        const manager = getManager();
        const analysis = await manager.reasoningEngine.performTaskAnalysis(task);
        manager.chatFlowCoordinator.queueOperation(
          ChatOperationType.CONTEXT_GATHERING,
          t('agent.analyzeTaskPlan'),
          {
            task,
            analysis
          }
        );
        return analysis;
      }),
      vscode.commands.registerCommand('knox.structuredSolve', async (task: string) => {
        const manager = getManager();
        const analysis = await manager.reasoningEngine.performTaskAnalysis(task);

        vscode.window.showInformationMessage(
          t('agent.taskComplexity', { complexity: analysis.estimatedComplexity.toUpperCase(), count: analysis.steps.length })
        );

        manager.chatFlowCoordinator.queueOperation(
          ChatOperationType.CONTEXT_GATHERING,
          t('agent.analyzeTaskPlan'),
          {
            task,
            analysis
          }
        );

        for (let i = 0; i < analysis.steps.length; i++) {
          const step = analysis.steps[i];

          manager.chatFlowCoordinator.queueOperation(
            ChatOperationType.CONTEXT_GATHERING,
            t('agent.stepN', { n: i + 1, step }),
            {
              step_number: i + 1,
              step_description: step,
              total_steps: analysis.steps.length,
              task,
              complexity: analysis.estimatedComplexity,
            }
          );
        }

        return analysis;
      }),
    ];
  }
  
  // Register event handlers
  private registerEventHandlers(): void {
    // Listen for suggestion updates from code intelligence service
    this.codeIntelligenceService.onSuggestionsUpdated(({ uri, suggestions }) => {
      this._onSuggestionsAvailable.fire({ uri, suggestions });
    });
    
    // Listen for file change events
    vscode.workspace.onDidOpenTextDocument(this.onDocumentOpened, this, this.disposables);
    vscode.workspace.onDidCloseTextDocument(this.onDocumentClosed, this, this.disposables);
    vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this, this.disposables);
    
    // Listen for chat flow coordinator events
    this.chatFlowCoordinator.onOperationStarted((operation) => {
      this.updateStatus(AgentModeStatus.PROCESSING);
    });
    
    this.chatFlowCoordinator.onOperationCompleted((operation) => {
      // Only change status back to active if there are no more operations in the queue
      if (this.chatFlowCoordinator.getOperationQueue().length === 0) {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }
    });
    
    this.chatFlowCoordinator.onOperationFailed(({ operation, error }) => {
      this.updateStatus(AgentModeStatus.ERROR);
      // Status will be reset to active after a short delay
      setTimeout(() => {
        if (this.status === AgentModeStatus.ERROR) {
          this.updateStatus(AgentModeStatus.ACTIVE);
        }
      }, 3000);
    });
    
    this.chatFlowCoordinator.onQueueEmpty(() => {
      this.updateStatus(AgentModeStatus.ACTIVE);
    });
  }
  
  // Update agent mode status
  private updateStatus(status: AgentModeStatus): void {
    this.status = status;
    this._onStatusChanged.fire(status);
  }
  
  // Toggle agent mode (command palette / keybinding — shows a toast)
  public async toggleAgentMode(): Promise<void> {
    const currentlyOn = this.status !== AgentModeStatus.INACTIVE;
    await this.setActive(!currentlyOn, { silent: false });
  }

  /**
   * Idempotent activate/deactivate. GUI Chat/Agent tab uses silent:true
   * so remounts and tab clicks do not spam toasts.
   */
  public async setActive(
    active: boolean,
    options?: { silent?: boolean; sessionId?: string },
  ): Promise<void> {
    if (options?.sessionId) {
      this.boundSessionId = options.sessionId;
    }
    const currentlyOn = this.status !== AgentModeStatus.INACTIVE;
    if (active && currentlyOn) {
      if (this.boundSessionId) {
        await this.bindCheckpointSession(this.boundSessionId);
      }
      return;
    }
    if (active === currentlyOn) {
      return;
    }
    if (active) {
      await this.activateAgentMode(options);
    } else {
      await this.deactivateAgentMode(options);
    }
  }

  private async bindCheckpointSession(sessionId: string): Promise<void> {
    try {
      const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
      await CheckpointManager.getInstance().startAgentSession(sessionId);
    } catch (error) {
      console.warn("Failed to bind checkpoint agent session:", error);
    }
  }
  
  // Activate agent mode
  private async activateAgentMode(options?: { silent?: boolean; sessionId?: string }): Promise<void> {
    try {
      // Update status
      this.updateStatus(AgentModeStatus.ACTIVE);

      const sessionId = options?.sessionId ?? this.boundSessionId;
      if (sessionId) {
        this.boundSessionId = sessionId;
        await this.bindCheckpointSession(sessionId);
      }
      
      // Register active document watcher
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        this.watchDocument(activeEditor.document);
      }
      
      if (!options?.silent) {
        vscode.window.showInformationMessage(t('agent.activated'));
      }
      
    } catch (error) {
      console.error('Failed to activate agent mode:', error);
      this.updateStatus(AgentModeStatus.ERROR);
      vscode.window.showErrorMessage(t('agent.failedActivate', { message: (error as Error).message }));
      
      // Reset status after a delay
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.INACTIVE);
      }, 3000);
    }
  }
  
  // Deactivate agent mode
  private async deactivateAgentMode(options?: { silent?: boolean }): Promise<void> {
    try {
      // Update status
      this.updateStatus(AgentModeStatus.INACTIVE);
      
      // Stop checkpoint agent session
      try {
        const CheckpointManager = (await import('../checkpoints/CheckpointManager')).CheckpointManager;
        const checkpointManager = CheckpointManager.getInstance();
        await checkpointManager.stopAgentSession();
        console.log('✅ Stopped checkpoint agent session');
      } catch (error) {
        console.warn('⚠️ Failed to stop checkpoint agent session:', error);
        // Don't fail agent mode deactivation if checkpoint session fails
      }
      
      // Dispose file watchers
      for (const [_, disposable] of this.activeFileWatchers) {
        disposable.dispose();
      }
      this.activeFileWatchers.clear();
      
      if (!options?.silent) {
        vscode.window.showInformationMessage(t('agent.deactivated'));
      }
      
    } catch (error) {
      console.error('Failed to deactivate agent mode:', error);
      vscode.window.showErrorMessage(t('agent.failedDeactivate', { message: (error as Error).message }));
    }
  }
  
  // Handle document opened event
  private onDocumentOpened(document: vscode.TextDocument): void {
    if (this.status === AgentModeStatus.ACTIVE) {
      this.watchDocument(document);
    }
  }
  
  // Handle document closed event
  private onDocumentClosed(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    if (this.activeFileWatchers.has(uri)) {
      this.activeFileWatchers.get(uri)!.dispose();
      this.activeFileWatchers.delete(uri);
    }
  }
  
  // Handle active editor changed event
  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (editor && this.status === AgentModeStatus.ACTIVE) {
      this.watchDocument(editor.document);
    }
  }
  
  // Watch document for changes
  private watchDocument(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    
    // Only watch relevant document types
    if (document.uri.scheme !== 'file' || document.uri.path.includes('node_modules')) {
      return;
    }
    
    // Check if already watching
    if (this.activeFileWatchers.has(uri)) {
      return;
    }
    
    // Start watching document
    const disposable = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === uri) {
        // Only analyze if agent mode is active
        if (this.status === AgentModeStatus.ACTIVE) {
          // Debounce analysis
          this.debouncedAnalyzeDocument(document);
        }
      }
    });
    
    this.activeFileWatchers.set(uri, disposable);
    this.disposables.push(disposable);
    
    // Initial analysis
    if (this.status === AgentModeStatus.ACTIVE) {
      this.analyzeDocument(document);
    }
  }
  
  // Analyze document for suggestions
  private analyzeDocument(document: vscode.TextDocument): void {
    // Skip if document is too large
    if (document.lineCount > 10000) {
      return;
    }
    
    // Skip binary or non-text files
    if (!document.languageId || document.languageId === 'binary') {
      return;
    }
    
    // Request suggestions
    this.codeIntelligenceService.getSuggestions(document.uri);
  }
  
  // Debounced version of analyzeDocument
  private debouncedAnalyzeDocument = (() => {
    let timeout: NodeJS.Timeout | null = null;
    return (document: vscode.TextDocument) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        this.analyzeDocument(document);
        timeout = null;
      }, 500);
    };
  })();
  
  // Execute a tool call with dynamic model switching support.
  // Undo snapshots + pre-risky checkpoints are handled on Core tools/call
  // (same path as GUI chat) via IDE.captureMutatingToolBefore / recordMutatingToolAfter.
  public async executeToolCall(toolCall: ToolCall, selectedModelTitle: string, viewReadModelTitle?: string | null, realTimeSearchModelTitle?: string | null, preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch'): Promise<ContextItem[]> {
    try {
      // Update status to processing
      this.updateStatus(AgentModeStatus.PROCESSING);
      
      // If viewReadModelTitle is not provided, get the current one from configuration
      let effectiveViewReadModelTitle = viewReadModelTitle;
      if (!effectiveViewReadModelTitle) {
        try {
          effectiveViewReadModelTitle = await vscode.commands.executeCommand('knox.getCurrentViewReadModel') as string | null;
          console.log(`[AgentModeManager] Retrieved View/Read model from config: ${effectiveViewReadModelTitle || 'null'}`);
        } catch (error) {
          console.warn('Failed to get current View/Read model:', error);
          effectiveViewReadModelTitle = null;
        }
      } else {
        console.log(`[AgentModeManager] Using provided View/Read model: ${effectiveViewReadModelTitle}`);
      }
      
      // If realTimeSearchModelTitle is not provided, get the current one from configuration
      let effectiveRealTimeSearchModelTitle = realTimeSearchModelTitle;
      if (!effectiveRealTimeSearchModelTitle) {
        try {
          effectiveRealTimeSearchModelTitle = await vscode.commands.executeCommand('knox.getCurrentRealTimeSearchModel') as string | null;
          console.log(`[AgentModeManager] Retrieved RealTimeSearch model from config: ${effectiveRealTimeSearchModelTitle || 'null'}`);
        } catch (error) {
          console.warn('Failed to get current RealTimeSearch model:', error);
          effectiveRealTimeSearchModelTitle = null;
        }
      } else {
        console.log(`[AgentModeManager] Using provided RealTimeSearch model: ${effectiveRealTimeSearchModelTitle}`);
      }
      
      // Execute tool call through agent service with preferred model support
      const contextItems = await this.agentService.executeToolCall(toolCall, selectedModelTitle, effectiveViewReadModelTitle, effectiveRealTimeSearchModelTitle, preferredModel);

      this._onToolCallExecuted.fire({
        toolCall,
        result: contextItems,
      });
      
      // Update status back to active
      this.updateStatus(AgentModeStatus.ACTIVE);
      
      return contextItems;
    } catch (error) {
      console.error('Failed to execute tool call:', error);
      this.updateStatus(AgentModeStatus.ERROR);
      
      // Reset status after a delay
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      
      throw error;
    }
  }
  
  // Apply suggestion
  public async applySuggestion(uri: vscode.Uri, suggestionId: string): Promise<boolean> {
    try {
      // Update status to processing
      this.updateStatus(AgentModeStatus.PROCESSING);
      
      // Apply suggestion
      const success = await this.codeIntelligenceService.applySuggestion(uri, suggestionId);
      
      // Update status back to active
      this.updateStatus(AgentModeStatus.ACTIVE);
      
      return success;
    } catch (error) {
      console.error('Failed to apply suggestion:', error);
      this.updateStatus(AgentModeStatus.ERROR);
      
      // Reset status after a delay
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      
      throw error;
    }
  }
  
  // Undo last operation via CommandHistoryService snapshots
  public async undoLastOperation(): Promise<void> {
    try {
      this.updateStatus(AgentModeStatus.PROCESSING);
      await vscode.commands.executeCommand('knox.enhancedUndo');
      this.updateStatus(AgentModeStatus.ACTIVE);
    } catch (error) {
      console.error('Failed to undo last operation:', error);
      this.updateStatus(AgentModeStatus.ERROR);
      
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      
      throw error;
    }
  }
  
  // Redo last undone operation via CommandHistoryService snapshots
  public async redoLastOperation(): Promise<void> {
    try {
      this.updateStatus(AgentModeStatus.PROCESSING);
      await vscode.commands.executeCommand('knox.enhancedRedo');
      this.updateStatus(AgentModeStatus.ACTIVE);
    } catch (error) {
      console.error('Failed to redo last operation:', error);
      this.updateStatus(AgentModeStatus.ERROR);
      
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      
      throw error;
    }
  }
  
  // Reapply edit
  public async reapplyEdit(targetFile: string, selectedModelTitle: string): Promise<ContextItem[]> {
    try {
      // Update status to processing
      this.updateStatus(AgentModeStatus.PROCESSING);
      
      // Notify user for now
      vscode.window.showInformationMessage(t('agent.reapplyUnavailable'));
      
      // Update status back to active
      this.updateStatus(AgentModeStatus.ACTIVE);
      
      return [];
    } catch (error) {
      console.error('Failed to reapply edit:', error);
      this.updateStatus(AgentModeStatus.ERROR);
      
      // Reset status after a delay
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      
      throw error;
    }
  }
  
  // Get current status
  public getStatus(): AgentModeStatus {
    return this.status;
  }
  
  /**
   * Emit streaming content update
   */
  public emitStreamingUpdate(content: string, isComplete: boolean = false): void {
    this._onStreamingUpdate.fire({ content, isComplete });
  }
  
  /**
   * Show side-by-side diff for a pending shadow proposal.
   */
  public async showDiff(filePath: string): Promise<void> {
    try {
      this.updateStatus(AgentModeStatus.PROCESSING);
      await this.shadowWorkspaceManager.showDiff(filePath);
      this.updateStatus(AgentModeStatus.ACTIVE);
    } catch (error) {
      console.error("Failed to show diff:", error);
      this.updateStatus(AgentModeStatus.ERROR);
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      throw error;
    }
  }

  /**
   * Stage proposed content in the shadow workspace (does not write the original).
   */
  public async updateShadowFile(
    originalPath: string,
    newContent: string,
  ): Promise<string> {
    try {
      return await this.shadowWorkspaceManager.updateShadowFile(
        originalPath,
        newContent,
      );
    } catch (error) {
      console.error("Failed to update shadow file:", error);
      throw error;
    }
  }

  /**
   * Optional pre-apply preview: stage content, show Accept/Reject.
   * Accept applies through the chat vertical-diff path (wired apply handler).
   * Reject discards the proposal.
   */
  public async previewEdit(
    originalPath: string,
    proposedContent: string,
    options?: { streamId?: string },
  ): Promise<"accept" | "reject"> {
    this.updateStatus(AgentModeStatus.PROCESSING);
    try {
      const decision =
        await this.shadowWorkspaceManager.previewAndAwaitDecision(
          originalPath,
          proposedContent,
          { streamId: options?.streamId, promptUser: true },
        );
      // previewAndAwaitDecision sets a waiter, so Accept only resolves —
      // the caller owns applying via the chat path.
      if (decision === "accept") {
        await this.shadowWorkspaceManager.applyViaChatPath(
          originalPath,
          proposedContent,
          options?.streamId,
        );
      }
      this.updateStatus(AgentModeStatus.ACTIVE);
      return decision;
    } catch (error) {
      console.error("Failed to preview edit:", error);
      this.updateStatus(AgentModeStatus.ERROR);
      setTimeout(() => {
        this.updateStatus(AgentModeStatus.ACTIVE);
      }, 3000);
      throw error;
    }
  }
  
  // Dispose
  public dispose(): void {
    // Dispose all disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    
    // Dispose file watchers
    for (const [_, disposable] of this.activeFileWatchers) {
      disposable.dispose();
    }
    this.activeFileWatchers.clear();
    
    // Dispose event emitters
    this._onStatusChanged.dispose();
    this._onSuggestionsAvailable.dispose();
    this._onToolCallExecuted.dispose();
    this._onStreamingUpdate.dispose();
    
    // Dispose shadow workspace manager
    this.shadowWorkspaceManager.dispose();
  }
} 