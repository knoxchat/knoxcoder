import * as vscode from 'vscode';

import { AgentModeManager } from './AgentModeManager';
import { AgentModeStatus, AGENT_MODE_CONTEXT_KEY, isAgentModeStatusOn } from './agentModeStatus';
import { AgentService, AgentOperationStatus } from './AgentService';
import { ChatFlowCoordinator, ChatOperation, ChatOperationType, ChatOperationStatus } from './ChatFlowCoordinator';
import { CodeIntelligenceService, CodeSuggestion, SuggestionType } from './CodeIntelligenceService';
import { CommandHistoryService, OperationRecord } from './CommandHistoryService';
import { DebugIntegrationService, DebugAnalysisResult } from './DebugIntegrationService';
import {
  ADD_INTELLIGENT_BREAKPOINT_COMMAND,
  ANALYZE_DEBUG_SESSION_COMMAND,
  coerceDebugError,
  resolveAnalyzeDebugArgs,
  resolveIntelligentBreakpointPath,
  SUGGEST_FIX_FOR_ERROR_COMMAND,
} from './debugIntegration';
import { DiagnosticChecker, DiagnosticSeverity } from './DiagnosticChecker';
import { DiagnosticFixManager } from './DiagnosticFixManager';
import {
  CHECK_DIAGNOSTICS_COMMAND,
  FIX_DIAGNOSTICS_COMMAND,
  resolveDiagnosticUri,
  resolveFixDiagnosticsArgs,
} from './diagnostics';
import { ErrorPatternDetector } from './ErrorPatternDetector';
import { ReasoningEngine, TaskAnalysisResult } from './ReasoningEngine';
import { RefactoringService } from './RefactoringService';
import {
  EXTRACT_INTERFACE_COMMAND,
  EXTRACT_METHOD_COMMAND,
  MOVE_FILE_COMMAND,
  RENAME_SYMBOL_COMMAND,
  editorSelectionFallback,
  resolveExtractInterfaceArgs,
  resolveExtractMethodArgs,
  resolveMoveFileArgs,
  resolveRenameArgs,
} from './refactoring';
import { ScreenshotService } from './ScreenshotService';
import { CAPTURE_SCREENSHOT_COMMAND } from './screenshot';
import { ShadowWorkspaceManager } from './ShadowWorkspaceManager';
import { TerminalMonitor } from './TerminalMonitor';

let agentModeManager: AgentModeManager | undefined;
let diagnosticChecker: DiagnosticChecker | undefined;
let diagnosticFixManager: DiagnosticFixManager | undefined;
let agentService: AgentService | undefined;
let commandHistoryService: CommandHistoryService | undefined;
let refactoringService: RefactoringService | undefined;
let screenshotService: ScreenshotService | undefined;
let debugIntegrationService: DebugIntegrationService | undefined;
let terminalMonitor: TerminalMonitor | undefined;
let errorPatternDetector: ErrorPatternDetector | undefined;

/**
 * Activate the Agent Mode feature
 * @param context The VSCode extension context
 */
export function activateAgentMode(context: vscode.ExtensionContext): vscode.Disposable {
  // Initialize the Agent Mode Manager
  agentModeManager = AgentModeManager.getInstance();

  // Tools: knox.executeToolCall / knoxchat.tools/call → AgentModeManager → Core tools/call.
  // Validation helpers live in toolCallValidation.ts.

  // KN-352: DiagnosticChecker / DiagnosticFixManager (`knox.checkDiagnostics`, `knox.fixDiagnostics`)
  diagnosticChecker = DiagnosticChecker.getInstance();
  diagnosticFixManager = DiagnosticFixManager.getInstance();
  
  // KN-351: file-byte undo/redo + operation history QuickPick
  commandHistoryService = CommandHistoryService.getInstance();
  
  // KN-355: RefactoringService — LSP rename / extract via knox.llmComplete.
  // ReasoningEngine stays quarantined (product planner is builtin_plan).
  refactoringService = RefactoringService.getInstance();
  
  // KN-353: DebugIntegrationService helpers + DAP tracker for @debugger
  // (`knox.analyzeDebugSession`). Distinct from Agent `builtin_debug`.
  debugIntegrationService = DebugIntegrationService.getInstance();

  // KN-354: Screenshot → native GUI `addImageAttachment`
  screenshotService = ScreenshotService.getInstance();
  
  // Initialize TerminalMonitor for terminal output watching and error detection
  terminalMonitor = TerminalMonitor.getInstance();
  
  // Initialize ErrorPatternDetector for proactive fix suggestions
  errorPatternDetector = ErrorPatternDetector.getInstance();
  
  // Legacy alias — older call sites used activate* instead of toggle*
  const disposable = vscode.commands.registerCommand('knoxchat.activateAgentMode', () => {
    if (agentModeManager) {
      void agentModeManager.toggleAgentMode();
    }
  });

  // Canonical status query (public API in activate.ts)
  const isAgentModeActiveCommand = vscode.commands.registerCommand(
    'knox.isAgentModeActive',
    () => isAgentModeActive(),
  );
  // Legacy alias
  const isAgentModeActiveLegacyCommand = vscode.commands.registerCommand(
    'knoxchat.isAgentModeActive',
    () => isAgentModeActive(),
  );
  
  // Context key is owned by AgentModeManager.updateStatus (KN-350).
  void vscode.commands.executeCommand(
    'setContext',
    AGENT_MODE_CONTEXT_KEY,
    isAgentModeActive(),
  );
 
  // Register command to check diagnostics for a file
  const checkDiagnosticsCommand = vscode.commands.registerCommand(
    CHECK_DIAGNOSTICS_COMMAND,
    async (arg?: vscode.Uri | { uri?: vscode.Uri }) => {
      if (!diagnosticChecker) {
        throw new Error('Diagnostic Checker not initialized');
      }
      const uri = resolveDiagnosticUri(
        arg,
        vscode.window.activeTextEditor?.document.uri.toString(),
      );
      if (!uri) {
        throw new Error('No file to check: open a file or pass a uri');
      }
      return await diagnosticChecker.checkFile(uri);
    },
  );

  // Register command to attempt to fix diagnostics
  const fixDiagnosticsCommand = vscode.commands.registerCommand(
    FIX_DIAGNOSTICS_COMMAND,
    async (arg?: { uri?: vscode.Uri; selectedModelTitle?: string } | vscode.Uri) => {
      if (!diagnosticFixManager) {
        throw new Error('Diagnostic Fix Manager not initialized');
      }
      const { uri, selectedModelTitle } = resolveFixDiagnosticsArgs(arg, {
        uri: vscode.window.activeTextEditor?.document.uri.toString(),
        selectedModelTitle: 'default',
      });
      if (!uri) {
        throw new Error('No file to fix: open a file or pass a uri');
      }
      return await diagnosticFixManager.checkAndFixDiagnostics(uri, selectedModelTitle);
    },
  );

  const analyzeDebugSessionCommand = vscode.commands.registerCommand(
    ANALYZE_DEBUG_SESSION_COMMAND,
    async (arg?: { selectedModelTitle?: string }) => {
      if (!debugIntegrationService) {
        throw new Error('Debug Integration Service not initialized');
      }
      const { selectedModelTitle } = resolveAnalyzeDebugArgs(arg);
      return await debugIntegrationService.analyzeDebugSession(selectedModelTitle);
    },
  );

  const suggestFixForErrorCommand = vscode.commands.registerCommand(
    SUGGEST_FIX_FOR_ERROR_COMMAND,
    async (arg?: Error | { message?: string; selectedModelTitle?: string }) => {
      if (!debugIntegrationService) {
        throw new Error('Debug Integration Service not initialized');
      }
      const { selectedModelTitle } = resolveAnalyzeDebugArgs(arg);
      return await debugIntegrationService.suggestFixForError(
        coerceDebugError(arg),
        selectedModelTitle,
      );
    },
  );

  const addIntelligentBreakpointCommand = vscode.commands.registerCommand(
    ADD_INTELLIGENT_BREAKPOINT_COMMAND,
    async (arg?: string | { filePath?: string; selectedModelTitle?: string }) => {
      if (!debugIntegrationService) {
        throw new Error('Debug Integration Service not initialized');
      }
      const filePath = resolveIntelligentBreakpointPath(
        arg,
        vscode.window.activeTextEditor?.document.uri.fsPath,
      );
      if (!filePath) {
        throw new Error('No file to add a breakpoint: open a file or pass a path');
      }
      const { selectedModelTitle } = resolveAnalyzeDebugArgs(arg);
      return await debugIntegrationService.addIntelligentBreakpoint(
        filePath,
        selectedModelTitle,
      );
    },
  );

  const captureScreenshotCommand = vscode.commands.registerCommand(
    CAPTURE_SCREENSHOT_COMMAND,
    () => {
      if (!screenshotService) {
        throw new Error('Screenshot Service not initialized');
      }
      return screenshotService.captureAndSend();
    },
  );

  const renameSymbolCommand = vscode.commands.registerCommand(
    RENAME_SYMBOL_COMMAND,
    async (arg?: { oldName: string; newName: string; filePaths?: string[] }) => {
      if (!refactoringService) {
        throw new Error('Refactoring Service not initialized');
      }
      const resolved = resolveRenameArgs(arg);
      if (!resolved) {
        throw new Error('Rename requires oldName and newName');
      }
      return await refactoringService.renameSymbol(
        resolved.oldName,
        resolved.newName,
        resolved.filePaths,
      );
    },
  );

  const extractMethodCommand = vscode.commands.registerCommand(
    EXTRACT_METHOD_COMMAND,
    async (arg?: {
      filePath?: string;
      startLine?: number;
      endLine?: number;
      methodName: string;
      accessibility?: string;
    }) => {
      if (!refactoringService) {
        throw new Error('Refactoring Service not initialized');
      }
      const resolved = resolveExtractMethodArgs(
        arg,
        editorSelectionFallback(vscode.window.activeTextEditor),
      );
      if (!resolved) {
        throw new Error('Extract method requires a file, line range, and methodName');
      }
      return await refactoringService.extractMethod(
        resolved.filePath,
        resolved.startLine,
        resolved.endLine,
        resolved.methodName,
        resolved.accessibility,
      );
    },
  );

  const moveFileCommand = vscode.commands.registerCommand(
    MOVE_FILE_COMMAND,
    async (arg?: { sourcePath: string; targetPath: string; updateImports?: boolean }) => {
      if (!refactoringService) {
        throw new Error('Refactoring Service not initialized');
      }
      const resolved = resolveMoveFileArgs(arg);
      if (!resolved) {
        throw new Error('Move file requires sourcePath and targetPath');
      }
      return await refactoringService.moveFile(
        resolved.sourcePath,
        resolved.targetPath,
        resolved.updateImports,
      );
    },
  );

  const extractInterfaceCommand = vscode.commands.registerCommand(
    EXTRACT_INTERFACE_COMMAND,
    async (arg?: {
      filePath?: string;
      className: string;
      interfaceName: string;
      targetPath?: string;
    }) => {
      if (!refactoringService) {
        throw new Error('Refactoring Service not initialized');
      }
      const resolved = resolveExtractInterfaceArgs(
        arg,
        vscode.window.activeTextEditor?.document.uri.fsPath,
      );
      if (!resolved) {
        throw new Error('Extract interface requires filePath, className, and interfaceName');
      }
      return await refactoringService.extractInterface(
        resolved.filePath,
        resolved.className,
        resolved.interfaceName,
        resolved.targetPath,
      );
    },
  );

  // Register additional integration commands for better user experience
  const analyzeProjectStructureCommand = vscode.commands.registerCommand('knox.analyzeProjectStructure', async () => {
    if (!agentModeManager) {
      throw new Error('Agent Mode Manager not initialized');
    }
    
    const codeIntelligence = agentModeManager['codeIntelligenceService'];
    return await codeIntelligence.analyzeProjectStructure();
  });
  
  const findRelatedFilesCommand = vscode.commands.registerCommand('knox.findRelatedFiles', async (filePath: string) => {
    if (!agentModeManager) {
      throw new Error('Agent Mode Manager not initialized');
    }
    
    const codeIntelligence = agentModeManager['codeIntelligenceService'];
    return await codeIntelligence.findRelatedFiles(filePath);
  });
  
  const performTaskAnalysisCommand = vscode.commands.registerCommand('knox.performTaskAnalysis', async (task: string) => {
    if (!agentModeManager) {
      throw new Error('Agent Mode Manager not initialized');
    }
    
    const reasoningEngine = agentModeManager['reasoningEngine'];
    return await reasoningEngine.performTaskAnalysis(task);
  });
  
  // Add all disposables to context
  context.subscriptions.push(
    agentModeManager,
    diagnosticChecker,
    diagnosticFixManager,
    disposable,
    isAgentModeActiveCommand,
    isAgentModeActiveLegacyCommand,
    checkDiagnosticsCommand,
    fixDiagnosticsCommand,
    analyzeDebugSessionCommand,
    suggestFixForErrorCommand,
    addIntelligentBreakpointCommand,
    captureScreenshotCommand,
    renameSymbolCommand,
    extractMethodCommand,
    moveFileCommand,
    extractInterfaceCommand,
    commandHistoryService,
    screenshotService,
    refactoringService,
    debugIntegrationService,
    terminalMonitor,
    errorPatternDetector,
    analyzeProjectStructureCommand,
    findRelatedFilesCommand,
    performTaskAnalysisCommand
  );
  
  // Register custom tool call handler
  const toolCallHandler = vscode.commands.registerCommand('knoxchat.tools/call', async (params: { toolCall: any, selectedModelTitle: string, viewReadModelTitle?: string | null }) => {
    if (!agentModeManager) {
      throw new Error('Agent Mode Manager not initialized');
    }
    
    return await agentModeManager.executeToolCall(params.toolCall, params.selectedModelTitle, params.viewReadModelTitle);
  });
  
  context.subscriptions.push(toolCallHandler);
  
  // Return a disposable that can be used to clean up all resources
  return {
    dispose: () => {
      if (agentModeManager) {
        agentModeManager.dispose();
        agentModeManager = undefined;
      }
      
      if (diagnosticChecker) {
        diagnosticChecker.dispose();
        diagnosticChecker = undefined;
      }
      
      if (diagnosticFixManager) {
        diagnosticFixManager.dispose();
        diagnosticFixManager = undefined;
      }
      
      if (commandHistoryService) {
        commandHistoryService.dispose();
        commandHistoryService = undefined;
      }
      
      if (refactoringService) {
        refactoringService.dispose();
        refactoringService = undefined;
      }
      
      if (debugIntegrationService) {
        debugIntegrationService.dispose();
        debugIntegrationService = undefined;
      }

      if (screenshotService) {
        screenshotService.dispose();
        screenshotService = undefined;
      }
      
      if (terminalMonitor) {
        terminalMonitor.dispose();
        terminalMonitor = undefined;
      }
      
      if (errorPatternDetector) {
        errorPatternDetector.dispose();
        errorPatternDetector = undefined;
      }
      
      disposable.dispose();
      isAgentModeActiveCommand.dispose();
      toolCallHandler.dispose();
      checkDiagnosticsCommand.dispose();
      fixDiagnosticsCommand.dispose();
      analyzeDebugSessionCommand.dispose();
      suggestFixForErrorCommand.dispose();
      addIntelligentBreakpointCommand.dispose();
      captureScreenshotCommand.dispose();
      renameSymbolCommand.dispose();
      extractMethodCommand.dispose();
      moveFileCommand.dispose();
      extractInterfaceCommand.dispose();
      analyzeProjectStructureCommand.dispose();
      findRelatedFilesCommand.dispose();
      performTaskAnalysisCommand.dispose();
    }
  };
}

/**
 * Check if Agent Mode is active
 */
export function isAgentModeActive(): boolean {
  return !!agentModeManager && isAgentModeStatusOn(agentModeManager.getStatus());
}

/**
 * Get the Agent Mode Manager instance
 */
export function getAgentModeManager(): AgentModeManager | undefined {
  return agentModeManager;
}

/**
 * Get the Diagnostic Checker instance
 */
export function getDiagnosticChecker(): DiagnosticChecker | undefined {
  return diagnosticChecker;
}

/**
 * Get the Diagnostic Fix Manager instance
 */
export function getDiagnosticFixManager(): DiagnosticFixManager | undefined {
  return diagnosticFixManager;
}

/**
 * Get the Agent Service instance
 */
export function getAgentService(): AgentService | undefined {
  return agentService;
}

/**
 * Get the Command History Service instance
 */
export function getCommandHistoryService(): CommandHistoryService | undefined {
  return commandHistoryService;
}

/**
 * Get the Refactoring Service instance
 */
export function getRefactoringService(): RefactoringService | undefined {
  return refactoringService;
}

/**
 * Get the Debug Integration Service instance
 */
export function getDebugIntegrationService(): DebugIntegrationService | undefined {
  return debugIntegrationService;
}

/**
 * Get the Screenshot Service instance
 */
export function getScreenshotService(): ScreenshotService | undefined {
  return screenshotService;
}

// Export all agent mode components from a single point
export { AGENT_MODE_CONTEXT_KEY, isAgentModeStatusOn } from './agentModeStatus';
export {
  ENHANCED_REDO_COMMAND,
  ENHANCED_UNDO_COMMAND,
  KNOX_CAN_REDO_CONTEXT_KEY,
  KNOX_CAN_UNDO_CONTEXT_KEY,
  SHOW_OPERATION_HISTORY_COMMAND,
  UNDO_LAST_OPERATION_COMMAND,
} from './operationHistory';
export {
  CHECK_DIAGNOSTICS_COMMAND,
  FIX_DIAGNOSTICS_COMMAND,
  LLM_COMPLETE_COMMAND,
} from './diagnostics';
export {
  ADD_INTELLIGENT_BREAKPOINT_COMMAND,
  ANALYZE_DEBUG_SESSION_COMMAND,
  SUGGEST_FIX_FOR_ERROR_COMMAND,
} from './debugIntegration';
export {
  ADD_IMAGE_ATTACHMENT_MESSAGE,
  CAPTURE_SCREENSHOT_COMMAND,
  SEND_TO_WEBVIEW_COMMAND,
} from './screenshot';
export {
  EXTRACT_INTERFACE_COMMAND,
  EXTRACT_METHOD_COMMAND,
  MOVE_FILE_COMMAND,
  RENAME_SYMBOL_COMMAND,
} from './refactoring';

export {
    // Agent Mode
    AgentModeManager,
    AgentModeStatus,
    
    // Agent Service
    AgentService,
    AgentOperationStatus,
    
    // Chat Flow
    ChatFlowCoordinator,
    ChatOperation,
    ChatOperationType,
    ChatOperationStatus,
    
    // Code Intelligence
    CodeIntelligenceService,
    CodeSuggestion,
    SuggestionType,
    
    // Refactoring
    RefactoringService,
    
    // Debug Integration
    DebugIntegrationService,
    DebugAnalysisResult,

    // Screenshot
    ScreenshotService,
    
    // Diagnostics
    DiagnosticChecker,
    DiagnosticSeverity,
    DiagnosticFixManager,
    
    // Command History
    CommandHistoryService,
    OperationRecord,
    
    // Structured Reasoning
    ReasoningEngine,
    TaskAnalysisResult,
    
    // Shadow Workspace
    ShadowWorkspaceManager,
}; 