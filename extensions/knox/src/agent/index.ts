import * as vscode from 'vscode';

import { AgentModeManager, AgentModeStatus } from './AgentModeManager';
import { isAgentModeStatusOn } from './agentModeStatus';
import { AgentService, AgentOperationStatus } from './AgentService';
import { ChatFlowCoordinator, ChatOperation, ChatOperationType, ChatOperationStatus } from './ChatFlowCoordinator';
import { CodeIntelligenceService, CodeSuggestion, SuggestionType } from './CodeIntelligenceService';
import { CommandHistoryService, OperationRecord } from './CommandHistoryService';
import { DebugIntegrationService, DebugAnalysisResult } from './DebugIntegrationService';
import { DiagnosticChecker, DiagnosticSeverity } from './DiagnosticChecker';
import { DiagnosticFixManager } from './DiagnosticFixManager';
import { ErrorPatternDetector } from './ErrorPatternDetector';
import { ReasoningEngine, TaskAnalysisResult } from './ReasoningEngine';
import { RefactoringService } from './RefactoringService';
import { ShadowWorkspaceManager } from './ShadowWorkspaceManager';
import { TerminalMonitor } from './TerminalMonitor';
import { TestGenerationService, TestGenerationOptions, TestGenerationResult } from './TestGenerationService';

let agentModeManager: AgentModeManager | undefined;
let diagnosticChecker: DiagnosticChecker | undefined;
let diagnosticFixManager: DiagnosticFixManager | undefined;
let agentService: AgentService | undefined;
let commandHistoryService: CommandHistoryService | undefined;
let refactoringService: RefactoringService | undefined;
let testGenerationService: TestGenerationService | undefined;
let debugIntegrationService: DebugIntegrationService | undefined;
let terminalMonitor: TerminalMonitor | undefined;
let errorPatternDetector: ErrorPatternDetector | undefined;
let agentExtensionContext: vscode.ExtensionContext | undefined;
let agentServicesLoaded = false;
let agentStatusContextRegistered = false;

/**
 * Construct heavy agent singletons (CodeIntelligence, terminal watchers, …).
 * Cheap command registration happens in `activateAgentMode` without this.
 */
export function ensureAgentServices(): void {
  if (agentServicesLoaded) {
    return;
  }
  agentServicesLoaded = true;

  agentModeManager = AgentModeManager.getInstance();
  diagnosticChecker = DiagnosticChecker.getInstance();
  diagnosticFixManager = DiagnosticFixManager.getInstance();
  commandHistoryService = CommandHistoryService.getInstance();
  refactoringService = RefactoringService.getInstance();
  testGenerationService = TestGenerationService.getInstance();
  debugIntegrationService = DebugIntegrationService.getInstance();
  terminalMonitor = TerminalMonitor.getInstance();
  errorPatternDetector = ErrorPatternDetector.getInstance();

  const context = agentExtensionContext;
  if (context && !agentStatusContextRegistered) {
    agentStatusContextRegistered = true;
    context.subscriptions.push(
      agentModeManager.onStatusChanged((status) => {
        void vscode.commands.executeCommand('setContext', 'knoxAgentModeActive', isAgentModeStatusOn(status));
      }),
      agentModeManager,
      diagnosticChecker,
      diagnosticFixManager,
      commandHistoryService,
      refactoringService,
      testGenerationService,
      debugIntegrationService,
      terminalMonitor,
      errorPatternDetector,
    );
  }
}

function getAgentManager(): AgentModeManager {
  ensureAgentServices();
  return agentModeManager!;
}

/**
 * Activate the Agent Mode feature
 * @param context The VSCode extension context
 */
export function activateAgentMode(context: vscode.ExtensionContext): vscode.Disposable {
  agentExtensionContext = context;

  // T7.3: register commands immediately; do not construct AgentModeManager
  // (CodeIntelligence providers, terminal monitor, …) until sidebar or command.
  const managerCommands = AgentModeManager.registerLazyCommands(getAgentManager);
  context.subscriptions.push(...managerCommands);

  // Legacy alias — older call sites used activate* instead of toggle*
  const disposable = vscode.commands.registerCommand('knoxchat.activateAgentMode', () => {
    void getAgentManager().toggleAgentMode();
  });

  // Canonical status query (public API in activate.ts) — must not construct services
  const isAgentModeActiveCommand = vscode.commands.registerCommand(
    'knox.isAgentModeActive',
    () => isAgentModeActive(),
  );
  // Legacy alias
  const isAgentModeActiveLegacyCommand = vscode.commands.registerCommand(
    'knoxchat.isAgentModeActive',
    () => isAgentModeActive(),
  );

  const checkDiagnosticsCommand = vscode.commands.registerCommand('knox.checkDiagnostics', async (uri: vscode.Uri) => {
    ensureAgentServices();
    return await diagnosticChecker!.checkFile(uri);
  });

  const fixDiagnosticsCommand = vscode.commands.registerCommand('knox.fixDiagnostics', async (params: { uri: vscode.Uri, selectedModelTitle: string }) => {
    ensureAgentServices();
    return await diagnosticFixManager!.checkAndFixDiagnostics(params.uri, params.selectedModelTitle);
  });

  const analyzeProjectStructureCommand = vscode.commands.registerCommand('knox.analyzeProjectStructure', async () => {
    const codeIntelligence = getAgentManager()['codeIntelligenceService'];
    return await codeIntelligence.analyzeProjectStructure();
  });

  const findRelatedFilesCommand = vscode.commands.registerCommand('knox.findRelatedFiles', async (filePath: string) => {
    const codeIntelligence = getAgentManager()['codeIntelligenceService'];
    return await codeIntelligence.findRelatedFiles(filePath);
  });

  const performTaskAnalysisCommand = vscode.commands.registerCommand('knox.performTaskAnalysis', async (task: string) => {
    const reasoningEngine = getAgentManager()['reasoningEngine'];
    return await reasoningEngine.performTaskAnalysis(task);
  });

  context.subscriptions.push(
    disposable,
    isAgentModeActiveCommand,
    isAgentModeActiveLegacyCommand,
    checkDiagnosticsCommand,
    fixDiagnosticsCommand,
    analyzeProjectStructureCommand,
    findRelatedFilesCommand,
    performTaskAnalysisCommand
  );
  
  // Register custom tool call handler
  const toolCallHandler = vscode.commands.registerCommand('knoxchat.tools/call', async (params: { toolCall: any, selectedModelTitle: string, viewReadModelTitle?: string | null }) => {
    return await getAgentManager().executeToolCall(params.toolCall, params.selectedModelTitle, params.viewReadModelTitle);
  });
  
  context.subscriptions.push(toolCallHandler);
  
  // Return a disposable that can be used to clean up all resources
  return {
    dispose: () => {
      agentServicesLoaded = false;
      agentStatusContextRegistered = false;
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
      
      if (testGenerationService) {
        testGenerationService.dispose();
        testGenerationService = undefined;
      }
      
      if (debugIntegrationService) {
        debugIntegrationService.dispose();
        debugIntegrationService = undefined;
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
 * Get the Test Generation Service instance
 */
export function getTestGenerationService(): TestGenerationService | undefined {
  return testGenerationService;
}

/**
 * Get the Debug Integration Service instance
 */
export function getDebugIntegrationService(): DebugIntegrationService | undefined {
  return debugIntegrationService;
}

// Export all agent mode components from a single point
export { isAgentModeStatusOn } from './agentModeStatus';

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
    
    // Test Generation
    TestGenerationService,
    TestGenerationOptions,
    TestGenerationResult,
    
    // Debug Integration
    DebugIntegrationService,
    DebugAnalysisResult,
    
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