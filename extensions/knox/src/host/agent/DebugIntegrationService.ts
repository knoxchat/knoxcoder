import * as vscode from 'vscode';

import { LLM_COMPLETE_COMMAND } from './diagnostics';
import {
  ADD_INTELLIGENT_BREAKPOINT_COMMAND,
  ANALYZE_DEBUG_SESSION_COMMAND,
  buildAnalyzeSessionPrompt,
  buildBreakpointSuggestionPrompt,
  buildDebugSnapshot,
  buildErrorAnalysisPrompt,
  coerceDebugError,
  fallbackAnalysis,
  parseAnalysisResult,
  parseBreakpointSuggestions,
  SUGGEST_FIX_FOR_ERROR_COMMAND,
  type DebugAnalysisResult,
  type DebugBreakpointSnapshot,
  type DebugErrorSnapshot,
  type DebugFrameSnapshot,
  type DebugVariableSnapshot,
} from './debugIntegration';
import { threadStopped } from '../debug/debug';
import { preferredDebugThreadId } from '../debug/debugTrackerLogic';

export {
  ADD_INTELLIGENT_BREAKPOINT_COMMAND,
  ANALYZE_DEBUG_SESSION_COMMAND,
  SUGGEST_FIX_FOR_ERROR_COMMAND,
  type DebugAnalysisResult,
};

/**
 * KN-353: vscode adapter over `debugIntegration.ts`.
 *
 * Host helpers around paused DAP sessions (`knox.analyzeDebugSession`,
 * `@debugger` via the DAP tracker). Distinct from Agent `builtin_debug`.
 */
export class DebugIntegrationService implements vscode.Disposable {
  private static instance: DebugIntegrationService | undefined;
  private disposables: vscode.Disposable[] = [];

  private currentSession: vscode.DebugSession | undefined;
  private isAnalyzing = false;

  private callStack: DebugFrameSnapshot[] = [];
  private variables: Record<string, DebugVariableSnapshot> = {};
  private breakpoints: vscode.Breakpoint[] = [];
  private lastError: DebugErrorSnapshot | undefined;

  private _onDebugSessionStarted = new vscode.EventEmitter<vscode.DebugSession>();
  public readonly onDebugSessionStarted = this._onDebugSessionStarted.event;

  private _onDebugSessionEnded = new vscode.EventEmitter<vscode.DebugSession>();
  public readonly onDebugSessionEnded = this._onDebugSessionEnded.event;

  private _onAnalysisCompleted = new vscode.EventEmitter<DebugAnalysisResult>();
  public readonly onAnalysisCompleted = this._onAnalysisCompleted.event;

  private _onErrorDetected = new vscode.EventEmitter<DebugErrorSnapshot>();
  public readonly onErrorDetected = this._onErrorDetected.event;

  public static getInstance(): DebugIntegrationService {
    if (!DebugIntegrationService.instance) {
      DebugIntegrationService.instance = new DebugIntegrationService();
    }
    return DebugIntegrationService.instance;
  }

  private constructor() {
    this.registerDebugEvents();
  }

  private registerDebugEvents(): void {
    this.disposables.push(
      vscode.debug.onDidStartDebugSession(session => {
        this.currentSession = session;
        this.resetDebugData();
        this._onDebugSessionStarted.fire(session);
      }),
    );

    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession(session => {
        if (this.currentSession && this.currentSession.id === session.id) {
          this._onDebugSessionEnded.fire(session);
          this.currentSession = undefined;
        }
      }),
    );

    this.disposables.push(
      vscode.debug.onDidChangeActiveDebugSession(session => {
        if (session) {
          this.currentSession = session;
          void this.updateCallStack();
        }
      }),
    );

    this.disposables.push(
      vscode.debug.onDidChangeBreakpoints(() => {
        this.updateBreakpoints();
      }),
    );
  }

  private resetDebugData(): void {
    this.callStack = [];
    this.variables = {};
    this.breakpoints = [];
    this.lastError = undefined;
  }

  private async updateCallStack(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    try {
      const threadId = preferredDebugThreadId(threadStopped);
      const stackFrames = await vscode.debug.activeDebugSession?.customRequest('stackTrace', {
        threadId,
      });

      if (stackFrames && stackFrames.stackFrames) {
        this.callStack = stackFrames.stackFrames as DebugFrameSnapshot[];
        await this.updateVariables();
      }
    } catch (error) {
      console.error('Error updating call stack:', error);
    }
  }

  private async updateVariables(): Promise<void> {
    if (!this.currentSession || this.callStack.length === 0) {
      return;
    }

    try {
      const frameId = this.callStack[0].id;
      if (typeof frameId !== 'number') {
        return;
      }

      const scopes = await vscode.debug.activeDebugSession?.customRequest('scopes', {
        frameId,
      });

      if (scopes && scopes.scopes) {
        for (const scope of scopes.scopes) {
          const variables = await vscode.debug.activeDebugSession?.customRequest('variables', {
            variablesReference: scope.variablesReference,
          });

          if (variables && variables.variables) {
            for (const variable of variables.variables) {
              this.variables[variable.name] = {
                value: variable.value,
                type: variable.type,
                variablesReference: variable.variablesReference,
              };
            }
          }
        }
      }
    } catch (error) {
      console.error('Error updating variables:', error);
    }
  }

  private updateBreakpoints(): void {
    this.breakpoints = [...vscode.debug.breakpoints];
  }

  private serializeBreakpoints(): DebugBreakpointSnapshot[] {
    return this.breakpoints.map(bp => {
      if (bp instanceof vscode.SourceBreakpoint) {
        return {
          enabled: bp.enabled,
          location: {
            uri: bp.location.uri.toString(),
            range: {
              start: {
                line: bp.location.range.start.line,
                character: bp.location.range.start.character,
              },
              end: {
                line: bp.location.range.end.line,
                character: bp.location.range.end.character,
              },
            },
          },
        };
      }
      return {
        enabled: bp.enabled,
        id: bp.id,
      };
    });
  }

  private async completeJson(prompt: string, selectedModelTitle: string): Promise<string> {
    const completion = await vscode.commands.executeCommand<string>(
      LLM_COMPLETE_COMMAND,
      {
        prompt,
        title: selectedModelTitle || 'default',
        completionOptions: { maxTokens: 2048 },
      },
    );
    return typeof completion === 'string' ? completion : '';
  }

  public async analyzeDebugSession(selectedModelTitle = 'default'): Promise<DebugAnalysisResult> {
    if (!this.currentSession) {
      throw new Error('No active debug session to analyze');
    }

    if (this.isAnalyzing) {
      throw new Error('Analysis already in progress');
    }

    this.isAnalyzing = true;

    try {
      await this.updateCallStack();

      const snapshot = buildDebugSnapshot({
        callStack: this.callStack,
        variables: this.variables,
        breakpoints: this.serializeBreakpoints(),
        error: this.lastError,
      });

      const completion = await this.completeJson(
        buildAnalyzeSessionPrompt(snapshot),
        selectedModelTitle,
      );
      const analysisResult = parseAnalysisResult(completion, this.variables, this.lastError);
      this._onAnalysisCompleted.fire(analysisResult);
      return analysisResult;
    } catch (error) {
      console.error('Error analyzing debug session:', error);
      return fallbackAnalysis({
        insights: `Error analyzing debug session: ${(error as Error).message}`,
        variables: this.variables,
      });
    } finally {
      this.isAnalyzing = false;
    }
  }

  public async suggestFixForError(
    error: Error | DebugErrorSnapshot,
    selectedModelTitle = 'default',
  ): Promise<DebugAnalysisResult> {
    this.lastError = error instanceof Error ? coerceDebugError(error) : error;
    this._onErrorDetected.fire(this.lastError);

    const completion = await this.completeJson(
      buildErrorAnalysisPrompt({
        error: this.lastError,
        callStack: this.callStack,
        variables: this.variables,
      }),
      selectedModelTitle,
    );
    const analysisResult = parseAnalysisResult(completion, this.variables, this.lastError);
    this._onAnalysisCompleted.fire(analysisResult);
    return analysisResult;
  }

  public async addIntelligentBreakpoint(
    filePath: string,
    selectedModelTitle = 'default',
  ): Promise<boolean> {
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const fileContent = document.getText();

      const existingLines = vscode.debug.breakpoints
        .filter(bp => bp instanceof vscode.SourceBreakpoint)
        .map(bp => {
          const sourceBp = bp as vscode.SourceBreakpoint;
          return {
            path: sourceBp.location.uri.fsPath,
            line: sourceBp.location.range.start.line + 1,
          };
        })
        .filter(bp => bp.path === filePath)
        .map(bp => bp.line);

      const completion = await this.completeJson(
        buildBreakpointSuggestionPrompt({
          filePath,
          fileContent,
          language: document.languageId,
          existingLines,
        }),
        selectedModelTitle,
      );

      const suggestions = parseBreakpointSuggestions(completion);
      if (!suggestions) {
        return false;
      }

      const breakpoints = suggestions.suggestedLines.map((line: number) => {
        return new vscode.SourceBreakpoint(
          new vscode.Location(uri, new vscode.Position(line - 1, 0)),
          true,
          suggestions.condition,
          suggestions.hitCondition,
          suggestions.logMessage,
        );
      });

      vscode.debug.addBreakpoints(breakpoints);
      return true;
    } catch (error) {
      console.error('Error adding intelligent breakpoint:', error);
      return false;
    }
  }

  public getCurrentSession(): vscode.DebugSession | undefined {
    return this.currentSession;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this._onDebugSessionStarted.dispose();
    this._onDebugSessionEnded.dispose();
    this._onAnalysisCompleted.dispose();
    this._onErrorDetected.dispose();
    if (DebugIntegrationService.instance === this) {
      DebugIntegrationService.instance = undefined;
    }
  }
}
