import { ToolCall, ContextItem } from 'core';
import * as vscode from 'vscode';

/**
 * Represents debug analysis results
 */
export interface DebugAnalysisResult {
  insights: string;
  suggestedFixes: { filePath: string; change: string }[];
  variableValues: Record<string, string>;
  errorAnalysis?: {
    errorType: string;
    errorMessage: string;
    probableCause: string;
    suggestedSolution: string;
  };
}

// Define a minimal stack frame interface to match the debug adapter protocol
interface StackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: {
    name?: string;
    path?: string;
  };
}

/**
 * DebugIntegrationService provides integration with VSCode's debugging capabilities
 * to allow the AI to analyze debug sessions and suggest fixes.
 */
export class DebugIntegrationService implements vscode.Disposable {
  private static instance: DebugIntegrationService;
  private disposables: vscode.Disposable[] = [];
  
  // Current debug session
  private currentSession: vscode.DebugSession | undefined;
  private isAnalyzing: boolean = false;
  
  // Debug data collection
  private callStack: StackFrame[] = [];
  private variables: Record<string, any> = {};
  private breakpoints: vscode.Breakpoint[] = [];
  private lastError: Error | undefined;
  
  // Event emitters
  private _onDebugSessionStarted = new vscode.EventEmitter<vscode.DebugSession>();
  public readonly onDebugSessionStarted = this._onDebugSessionStarted.event;
  
  private _onDebugSessionEnded = new vscode.EventEmitter<vscode.DebugSession>();
  public readonly onDebugSessionEnded = this._onDebugSessionEnded.event;
  
  private _onAnalysisCompleted = new vscode.EventEmitter<DebugAnalysisResult>();
  public readonly onAnalysisCompleted = this._onAnalysisCompleted.event;
  
  private _onErrorDetected = new vscode.EventEmitter<Error>();
  public readonly onErrorDetected = this._onErrorDetected.event;

  /**
   * Get the singleton instance
   */
  public static getInstance(): DebugIntegrationService {
    if (!DebugIntegrationService.instance) {
      DebugIntegrationService.instance = new DebugIntegrationService();
    }
    return DebugIntegrationService.instance;
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Register debug events
    this.registerDebugEvents();
    
    // Register commands
    this.registerCommands();
  }
  
  /**
   * Register debug session events
   */
  private registerDebugEvents(): void {
    // Debug session started
    this.disposables.push(
      vscode.debug.onDidStartDebugSession(session => {
        this.currentSession = session;
        this.resetDebugData();
        this._onDebugSessionStarted.fire(session);
      })
    );
    
    // Debug session ended
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession(session => {
        if (this.currentSession && this.currentSession.id === session.id) {
          this._onDebugSessionEnded.fire(session);
          this.currentSession = undefined;
        }
      })
    );
    
    // Call stack changed
    this.disposables.push(
      vscode.debug.onDidChangeActiveDebugSession(session => {
        if (session) {
          this.currentSession = session;
          this.updateCallStack();
        }
      })
    );
    
    // Breakpoints changed
    this.disposables.push(
      vscode.debug.onDidChangeBreakpoints(event => {
        this.updateBreakpoints();
      })
    );
  }
  
  /**
   * Register commands for debug integration
   */
  private registerCommands(): void {
    // Analyze debug session command
    this.disposables.push(
      vscode.commands.registerCommand('knox.analyzeDebugSession', async () => {
        return await this.analyzeDebugSession();
      })
    );
    
    // Suggest fix for error command
    this.disposables.push(
      vscode.commands.registerCommand('knox.suggestFixForError', async (error: Error) => {
        return await this.suggestFixForError(error);
      })
    );
    
    // Add intelligent breakpoint command
    this.disposables.push(
      vscode.commands.registerCommand('knox.addIntelligentBreakpoint', async (filePath: string) => {
        return await this.addIntelligentBreakpoint(filePath);
      })
    );
  }
  
  /**
   * Reset debug data collection
   */
  private resetDebugData(): void {
    this.callStack = [];
    this.variables = {};
    this.breakpoints = [];
    this.lastError = undefined;
  }
  
  /**
   * Update call stack information
   */
  private async updateCallStack(): Promise<void> {
    if (!this.currentSession) {return;}
    
    try {
      const stackFrames = await vscode.debug.activeDebugSession?.customRequest('stackTrace', {
        threadId: 1 // Use default thread ID
      });
      
      if (stackFrames && stackFrames.stackFrames) {
        this.callStack = stackFrames.stackFrames;
        await this.updateVariables();
      }
    } catch (error) {
      console.error('Error updating call stack:', error);
    }
  }
  
  /**
   * Update variables from the current stack frame
   */
  private async updateVariables(): Promise<void> {
    if (!this.currentSession || this.callStack.length === 0) {return;}
    
    try {
      // Get variables from the top stack frame
      const frameId = this.callStack[0].id;
      
      const scopes = await vscode.debug.activeDebugSession?.customRequest('scopes', {
        frameId
      });
      
      if (scopes && scopes.scopes) {
        // Collect variables from all scopes
        for (const scope of scopes.scopes) {
          const variables = await vscode.debug.activeDebugSession?.customRequest('variables', {
            variablesReference: scope.variablesReference
          });
          
          if (variables && variables.variables) {
            for (const variable of variables.variables) {
              this.variables[variable.name] = {
                value: variable.value,
                type: variable.type,
                variablesReference: variable.variablesReference
              };
              
              // If this is an object or array with nested variables, we could
              // recursively fetch them here if needed
            }
          }
        }
      }
    } catch (error) {
      console.error('Error updating variables:', error);
    }
  }
  
  /**
   * Update breakpoints information
   */
  private updateBreakpoints(): void {
    // Create a copy of the breakpoints array
    this.breakpoints = [...vscode.debug.breakpoints];
  }
  
  /**
   * Analyze the current debug session
   * @returns Analysis results
   */
  public async analyzeDebugSession(): Promise<DebugAnalysisResult> {
    if (!this.currentSession) {
      throw new Error('No active debug session to analyze');
    }
    
    if (this.isAnalyzing) {
      throw new Error('Analysis already in progress');
    }
    
    this.isAnalyzing = true;
    
    try {
      // Update call stack and variables
      await this.updateCallStack();
      
      // Prepare debug data for analysis
      const debugData = {
        callStack: this.callStack.map(frame => ({
          name: frame.name,
          source: frame.source ? {
            name: frame.source.name,
            path: frame.source.path
          } : undefined,
          line: frame.line,
          column: frame.column
        })),
        variables: this.variables,
        breakpoints: this.breakpoints.map(bp => {
          if (bp instanceof vscode.SourceBreakpoint) {
            return {
              enabled: bp.enabled,
              location: {
                uri: bp.location.uri.toString(),
                range: {
                  start: {
                    line: bp.location.range.start.line,
                    character: bp.location.range.start.character
                  },
                  end: {
                    line: bp.location.range.end.line,
                    character: bp.location.range.end.character
                  }
                }
              }
            };
          }
          return {
            enabled: bp.enabled,
            id: bp.id
          };
        }),
        error: this.lastError ? {
          message: this.lastError.message,
          stack: this.lastError.stack
        } : undefined
      };
      
      // Create tool call for debug analysis
      const toolCall: ToolCall = {
        id: `debug-analysis-${Date.now()}`,
        type: 'function',
        function: {
          name: 'analyze_debug_session',
          arguments: JSON.stringify({
            debug_data: debugData
          })
        }
      };
      
      // Execute the tool call
      const result = await vscode.commands.executeCommand<ContextItem[]>(
        'knox.executeToolCall',
        { toolCall, selectedModelTitle: 'default' }
      );
      
      // Parse the analysis result
      let analysisResult: DebugAnalysisResult;
      
      if (result && result.length > 0) {
        const content = typeof result[0].content === 'string' 
          ? result[0].content 
          : JSON.stringify(result[0].content);
        
        try {
          analysisResult = JSON.parse(content);
        } catch (e) {
          // Create a basic result structure if parsing fails
          analysisResult = {
            insights: content,
            suggestedFixes: [],
            variableValues: this.variables
          };
        }
      } else {
        // Create a fallback analysis
        analysisResult = {
          insights: "Could not analyze the debug session",
          suggestedFixes: [],
          variableValues: this.variables
        };
      }
      
      // Emit event
      this._onAnalysisCompleted.fire(analysisResult);
      
      return analysisResult;
    } catch (error) {
      console.error('Error analyzing debug session:', error);
      
      // Create a fallback for error case
      const errorResult: DebugAnalysisResult = {
        insights: `Error analyzing debug session: ${(error as Error).message}`,
        suggestedFixes: [],
        variableValues: this.variables
      };
      
      return errorResult;
    } finally {
      this.isAnalyzing = false;
    }
  }
  
  /**
   * Suggest a fix for a specific error
   * @param error The error to fix
   * @returns Suggested fixes
   */
  public async suggestFixForError(error: Error): Promise<DebugAnalysisResult> {
    // Store the error for context
    this.lastError = error;
    
    // Emit the error event
    this._onErrorDetected.fire(error);
    
    // Create tool call for error analysis
    const toolCall: ToolCall = {
      id: `error-analysis-${Date.now()}`,
      type: 'function',
      function: {
        name: 'analyze_error',
        arguments: JSON.stringify({
          error_message: error.message,
          error_stack: error.stack,
          call_stack: this.callStack.map(frame => ({
            name: frame.name,
            source: frame.source ? {
              name: frame.source.name,
              path: frame.source.path
            } : undefined,
            line: frame.line,
            column: frame.column
          })),
          variables: this.variables
        })
      }
    };
    
    // Execute the tool call
    const result = await vscode.commands.executeCommand<ContextItem[]>(
      'knox.executeToolCall',
      { toolCall, selectedModelTitle: 'default' }
    );
    
    // Parse the analysis result
    let analysisResult: DebugAnalysisResult;
    
    if (result && result.length > 0) {
      const content = typeof result[0].content === 'string' 
        ? result[0].content 
        : JSON.stringify(result[0].content);
      
      try {
        analysisResult = JSON.parse(content);
      } catch (e) {
        // Create a basic result structure if parsing fails
        analysisResult = {
          insights: content,
          suggestedFixes: [],
          variableValues: this.variables,
          errorAnalysis: {
            errorType: error.name,
            errorMessage: error.message,
            probableCause: "Could not determine cause",
            suggestedSolution: "Review the insights for more information"
          }
        };
      }
    } else {
      // Create a fallback analysis
      analysisResult = {
        insights: "Could not analyze the error",
        suggestedFixes: [],
        variableValues: this.variables,
        errorAnalysis: {
          errorType: error.name,
          errorMessage: error.message,
          probableCause: "Unknown",
          suggestedSolution: "Review your code logic"
        }
      };
    }
    
    // Emit event
    this._onAnalysisCompleted.fire(analysisResult);
    
    return analysisResult;
  }
  
  /**
   * Add an intelligent breakpoint to a file
   * This uses AI to determine good breakpoint locations
   * @param filePath The file to add a breakpoint to
   * @returns Whether the operation was successful
   */
  public async addIntelligentBreakpoint(filePath: string): Promise<boolean> {
    try {
      // Read the file content
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const fileContent = document.getText();
      
      // Create tool call for intelligent breakpoint suggestion
      const toolCall: ToolCall = {
        id: `suggest-breakpoints-${Date.now()}`,
        type: 'function',
        function: {
          name: 'suggest_breakpoints',
          arguments: JSON.stringify({
            file_path: filePath,
            file_content: fileContent,
            language: document.languageId,
            existing_breakpoints: vscode.debug.breakpoints
              .filter(bp => bp instanceof vscode.SourceBreakpoint)
              .map(bp => {
                const sourceBp = bp as vscode.SourceBreakpoint;
                return {
                  path: sourceBp.location.uri.fsPath,
                  line: sourceBp.location.range.start.line + 1
                };
              })
              .filter(bp => bp.path === filePath)
          })
        }
      };
      
      // Execute the tool call
      const result = await vscode.commands.executeCommand<ContextItem[]>(
        'knox.executeToolCall',
        { toolCall, selectedModelTitle: 'default' }
      );
      
      // Process results
      if (result && result.length > 0) {
        const content = typeof result[0].content === 'string' 
          ? result[0].content 
          : JSON.stringify(result[0].content);
        
        try {
          const breakpointSuggestions = JSON.parse(content);
          
          if (Array.isArray(breakpointSuggestions.suggestedLines)) {
            // Add the suggested breakpoints
            const breakpoints = breakpointSuggestions.suggestedLines.map((line: number) => {
              return new vscode.SourceBreakpoint(
                new vscode.Location(
                  uri,
                  new vscode.Position(line - 1, 0)
                ),
                true,
                breakpointSuggestions.condition,
                breakpointSuggestions.hitCondition,
                breakpointSuggestions.logMessage
              );
            });
            
            // Add the breakpoints
            vscode.debug.addBreakpoints(breakpoints);
            
            return true;
          }
        } catch (e) {
          console.error('Error parsing breakpoint suggestions:', e);
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error adding intelligent breakpoint:', error);
      return false;
    }
  }
  
  /**
   * Get the current debug session
   */
  public getCurrentSession(): vscode.DebugSession | undefined {
    return this.currentSession;
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this._onDebugSessionStarted.dispose();
    this._onDebugSessionEnded.dispose();
    this._onAnalysisCompleted.dispose();
    this._onErrorDetected.dispose();
  }
} 