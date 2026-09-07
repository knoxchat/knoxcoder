import * as vscode from 'vscode';

import { ChatFlowCoordinator, ChatOperation, ChatOperationStatus, ChatOperationType } from './ChatFlowCoordinator';

/**
 * Handles integration between the Agent Mode and WebView UI
 */
export class AgentWebViewIntegration implements vscode.Disposable {
  private static instance: AgentWebViewIntegration;
  private disposables: vscode.Disposable[] = [];
  private chatFlowCoordinator: ChatFlowCoordinator;
  private webviewView: vscode.WebviewView | undefined;
  private lastObservedOperationId: string | undefined;
  private operationHistory: ChatOperation[] = [];
  
  // Event tracking
  private isProcessingMultiOperation = false;
  private scrollSyncEnabled = true;

  /**
   * Get the singleton instance
   */
  public static getInstance(): AgentWebViewIntegration {
    if (!AgentWebViewIntegration.instance) {
      AgentWebViewIntegration.instance = new AgentWebViewIntegration();
    }
    return AgentWebViewIntegration.instance;
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.chatFlowCoordinator = ChatFlowCoordinator.getInstance();
    this.registerEventListeners();
  }

  /**
   * Register webview handler for the agent mode
   */
  public registerWebviewProvider(context: vscode.ExtensionContext): void {
    // Register the webview provider
    const provider = new AgentWebViewProvider(context.extensionUri, this);
    this.disposables.push(
      vscode.window.registerWebviewViewProvider('knoxAgentView', provider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
    
    // Register commands
    this.registerCommands();
  }

  /**
   * Register event listeners
   */
  private registerEventListeners(): void {
    // Listen for operation events
    this.disposables.push(
      this.chatFlowCoordinator.onOperationQueued((operation) => {
        this.operationHistory.push({ ...operation });
        this.notifyWebview('operationQueued', { operation });
        
        // Multiple operations indicator
        if (this.chatFlowCoordinator.getOperationQueue().length > 1) {
          this.isProcessingMultiOperation = true;
          this.notifyWebview('multiOperationStarted', { count: this.chatFlowCoordinator.getOperationQueue().length + 1 });
        }
      })
    );
    
    this.disposables.push(
      this.chatFlowCoordinator.onOperationStarted((operation) => {
        this.lastObservedOperationId = operation.id;
        this.updateOperationInHistory(operation);
        this.notifyWebview('operationStarted', { operation });
        
        // Ensure the UI scrolls to the latest operation if scroll sync is enabled
        if (this.scrollSyncEnabled && this.isProcessingMultiOperation) {
          this.scrollToLatestOperation();
        }
      })
    );
    
    this.disposables.push(
      this.chatFlowCoordinator.onOperationCompleted((operation) => {
        this.updateOperationInHistory(operation);
        this.notifyWebview('operationCompleted', { operation });
        
        // Ensure the UI scrolls to the latest operation if scroll sync is enabled
        if (this.scrollSyncEnabled && this.isProcessingMultiOperation) {
          this.scrollToLatestOperation();
        }
      })
    );
    
    this.disposables.push(
      this.chatFlowCoordinator.onOperationFailed(({ operation, error }) => {
        this.updateOperationInHistory(operation);
        this.notifyWebview('operationFailed', { operation, error: error.message });
      })
    );
    
    this.disposables.push(
      this.chatFlowCoordinator.onQueueEmpty(() => {
        this.isProcessingMultiOperation = false;
        this.notifyWebview('operationQueueEmpty', {});
      })
    );
    
    this.disposables.push(
      this.chatFlowCoordinator.onAutoScrollChanged((enabled) => {
        this.scrollSyncEnabled = enabled;
        this.notifyWebview('scrollSyncChanged', { enabled });
      })
    );
    
    // Listen for streaming updates from ChatFlowCoordinator
    this.disposables.push(
      this.chatFlowCoordinator.onStreamingUpdate(({ content, isComplete }) => {
        this.notifyWebview('streamingUpdate', { content, isComplete });
      })
    );
  }
  
  /**
   * Register commands for the webview integration
   */
  private registerCommands(): void {
    // Register webview related commands
    this.disposables.push(
      vscode.commands.registerCommand('knox.scrollToLatestAgentOperation', () => {
        this.scrollToLatestOperation();
      })
    );
    
    this.disposables.push(
      vscode.commands.registerCommand('knox.viewNextAgentOperation', () => {
        this.notifyWebview('viewNextOperation', {});
      })
    );
    
    this.disposables.push(
      vscode.commands.registerCommand('knox.viewPreviousAgentOperation', () => {
        this.notifyWebview('viewPreviousOperation', {});
      })
    );
  }
  
  /**
   * Handle webview messages
   */
  public handleWebviewMessage(message: any): void {
    switch (message.command) {
      case 'toggleScrollSync':
        this.chatFlowCoordinator.toggleAutoScroll();
        break;
        
      case 'viewOperation':
        // Highlight a specific operation
        this.updateHighlightedOperation(message.operationId);
        break;
        
      case 'retryOperation':
        // Retry a failed operation
        this.retryOperation(message.operationId);
        break;
        
      case 'cancelOperations':
        // Cancel all operations
        this.chatFlowCoordinator.cancelAllOperations();
        break;
        
      case 'webviewReady':
        // Send initial state to webview
        this.sendInitialState();
        break;
    }
  }
  
  /**
   * Set the webview reference
   */
  public setWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    
    // Send initial state to webview
    this.sendInitialState();
  }
  
  /**
   * Send initial state to webview
   */
  private sendInitialState(): void {
    if (!this.webviewView) {return;}
    
    // Send operation history
    this.notifyWebview('initState', {
      operations: this.operationHistory,
      scrollSyncEnabled: this.scrollSyncEnabled,
      isProcessingMultiOperation: this.isProcessingMultiOperation,
      activeOperation: this.chatFlowCoordinator.getActiveOperation(),
      queuedOperations: this.chatFlowCoordinator.getOperationQueue()
    });
  }
  
  /**
   * Notify the webview of events
   */
  private notifyWebview(event: string, data: any): void {
    if (!this.webviewView) {return;}
    
    try {
      this.webviewView.webview.postMessage({
        type: event,
        data
      });
    } catch (error) {
      console.error('Failed to post message to webview:', error);
    }
  }
  
  /**
   * Scroll to the latest operation in the webview
   */
  private scrollToLatestOperation(): void {
    const activeOperation = this.chatFlowCoordinator.getActiveOperation();
    if (activeOperation) {
      this.notifyWebview('scrollToOperation', { operationId: activeOperation.id });
    } else if (this.lastObservedOperationId) {
      this.notifyWebview('scrollToOperation', { operationId: this.lastObservedOperationId });
    }
  }
  
  /**
   * Update the highlighted operation in the webview
   */
  private updateHighlightedOperation(operationId: string): void {
    this.notifyWebview('highlightOperation', { operationId });
  }
  
  /**
   * Update an operation in the history
   */
  private updateOperationInHistory(updatedOperation: ChatOperation): void {
    const index = this.operationHistory.findIndex(op => op.id === updatedOperation.id);
    if (index !== -1) {
      this.operationHistory[index] = { ...updatedOperation };
    } else {
      this.operationHistory.push({ ...updatedOperation });
    }
    
    // Trim history if it gets too long (keep last 100 operations)
    if (this.operationHistory.length > 100) {
      this.operationHistory = this.operationHistory.slice(-100);
    }
  }
  
  /**
   * Retry a failed operation
   */
  private retryOperation(operationId: string): void {
    const operation = this.operationHistory.find(op => op.id === operationId);
    if (!operation || operation.status !== ChatOperationStatus.FAILED) {
      return;
    }
    
    // Create a new operation with the same payload
    this.chatFlowCoordinator.queueOperation(
      operation.type,
      operation.description,
      operation.payload
    );
  }
  
  /**
   * Get all operations in the history
   */
  public getOperationHistory(): ChatOperation[] {
    return [...this.operationHistory];
  }
  
  /**
   * Clear the operation history
   */
  public clearOperationHistory(): void {
    this.operationHistory = [];
    this.notifyWebview('operationHistoryCleared', {});
  }
  
  /**
   * Dispose resources
   */
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

/**
 * WebView Provider for Agent Mode
 */
class AgentWebViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly integration: AgentWebViewIntegration
  ) {}
  
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    // Setup webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    
    // Set HTML content
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    
    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      message => this.integration.handleWebviewMessage(message),
      undefined,
      []
    );
    
    // Store webview reference
    this.integration.setWebviewView(webviewView);
  }
  
  /**
   * Generate HTML for the webview
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Get resource paths
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'agentView.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'agentView.css')
    );

    // Use nonce for script security
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
      <link href="${styleUri}" rel="stylesheet">
      <title>Agent Operations</title>
    </head>
    <body>
      <div class="controls">
        <button id="toggleAutoScrollBtn" class="control-button">Auto-Scroll: ON</button>
        <button id="clearBtn" class="control-button">Clear History</button>
      </div>
      
      <div class="status-bar">
        <div id="statusIndicator" class="status-indicator"></div>
        <span id="statusText">Idle</span>
      </div>
      
      <div id="operationsContainer" class="operations-container">
        <div id="noOperations" class="no-operations">No operations yet. Switch to Agent Mode to get started.</div>
      </div>
      
      <div id="multiOperationIndicator" class="multi-operation-indicator hidden">
        <div class="indicator-spinner"></div>
        <span class="indicator-text">Processing multiple operations...</span>
      </div>
      
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }
  
  /**
   * Generate a nonce for script security
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
} 