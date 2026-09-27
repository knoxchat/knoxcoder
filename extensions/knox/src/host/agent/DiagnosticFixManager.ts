import * as vscode from 'vscode';

import { DiagnosticChecker } from './DiagnosticChecker';
import {
  buildFixPrompt,
  computeFixedIssues,
  DiagnosticIssue,
  FIX_DIAGNOSTIC_POST_UPDATE_MS,
  FIX_DIAGNOSTIC_WAIT_MS,
  FixAttemptTracker,
  isDiagnosticFixSuccess,
  LLM_COMPLETE_COMMAND,
  MAX_FIX_ATTEMPTS,
  sanitizeLlmFixOutput,
  toFixPromptIssues,
  type DiagnosticFixPromptIssue,
} from './diagnostics';

/**
 * DiagnosticFixManager handles automatic repair of code issues detected by linters or diagnostics.
 * KN-352: vscode adapter over `diagnostics.ts` (attempt cap, prompt, LLM sanitize).
 */
export class DiagnosticFixManager implements vscode.Disposable {
  private static instance: DiagnosticFixManager | undefined;
  private disposables: vscode.Disposable[] = [];
  private diagnosticChecker: DiagnosticChecker;
  private readonly attempts = new FixAttemptTracker(MAX_FIX_ATTEMPTS);

  private _onFixAttemptStarted = new vscode.EventEmitter<string>();
  public readonly onFixAttemptStarted = this._onFixAttemptStarted.event;

  private _onFixAttemptCompleted = new vscode.EventEmitter<{
    filePath: string;
    success: boolean;
    issues: DiagnosticIssue[];
  }>();
  public readonly onFixAttemptCompleted = this._onFixAttemptCompleted.event;

  /**
   * Get the singleton instance
   */
  public static getInstance(): DiagnosticFixManager {
    if (!DiagnosticFixManager.instance) {
      DiagnosticFixManager.instance = new DiagnosticFixManager();
    }
    return DiagnosticFixManager.instance;
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.diagnosticChecker = DiagnosticChecker.getInstance();
  }

  /**
   * Check and fix diagnostics after a file edit
   *
   * @param fileUri The URI of the file to check
   * @param selectedModelTitle The title of the model to use for fixing
   * @returns Object with success status, fixed issues and remaining issues
   */
  public async checkAndFixDiagnostics(
    fileUri: string | vscode.Uri,
    selectedModelTitle: string
  ): Promise<{
    success: boolean;
    fixedIssues: DiagnosticIssue[];
    remainingIssues: DiagnosticIssue[];
  }> {
    const uri = typeof fileUri === 'string' ? vscode.Uri.parse(fileUri) : fileUri;
    const uriString = uri.toString();

    if (!this.attempts.begin(uriString)) {
      return { success: false, fixedIssues: [], remainingIssues: [] };
    }

    try {
      await this.waitForDiagnosticsToUpdate(uri);
      const { issues: initialIssues } = await this.diagnosticChecker.checkFile(uri);

      if (initialIssues.length === 0) {
        return { success: true, fixedIssues: [], remainingIssues: [] };
      }

      if (this.attempts.hasReachedMax(uriString)) {
        this.attempts.reset(uriString);
        return {
          success: false,
          fixedIssues: [],
          remainingIssues: initialIssues,
        };
      }

      this.attempts.increment(uriString);
      this._onFixAttemptStarted.fire(uriString);

      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();

      const fixSuggestions = await this.generateFixSuggestions(
        content,
        uri.fsPath,
        toFixPromptIssues(initialIssues),
        selectedModelTitle
      );

      if (fixSuggestions.fixedContent) {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(fixSuggestions.fixedContent)
        );

        await this.waitForDiagnosticsToUpdate(uri);

        const { issues: remainingIssues } = await this.diagnosticChecker.checkFile(uri);
        const fixedIssues = computeFixedIssues(initialIssues, remainingIssues);
        const success = isDiagnosticFixSuccess(remainingIssues);

        this._onFixAttemptCompleted.fire({
          filePath: uriString,
          success: remainingIssues.length < initialIssues.length,
          issues: remainingIssues,
        });

        return {
          success,
          fixedIssues,
          remainingIssues,
        };
      }

      return {
        success: false,
        fixedIssues: [],
        remainingIssues: initialIssues,
      };
    } finally {
      this.attempts.end(uriString);
    }
  }

  /**
   * Wait for diagnostics to be updated
   */
  private async waitForDiagnosticsToUpdate(uri: vscode.Uri): Promise<void> {
    return new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        diagnosticsListener.dispose();
        resolve();
      }, FIX_DIAGNOSTIC_WAIT_MS);

      const diagnosticsListener = this.diagnosticChecker.onDiagnosticsUpdated(updatedUri => {
        if (updatedUri === uri.toString()) {
          clearTimeout(timeout);
          diagnosticsListener.dispose();
          setTimeout(resolve, FIX_DIAGNOSTIC_POST_UPDATE_MS);
        }
      });
    });
  }

  /**
   * Generate fix suggestions from the AI model
   */
  private async generateFixSuggestions(
    content: string,
    filePath: string,
    issues: DiagnosticFixPromptIssue[],
    selectedModelTitle: string
  ): Promise<{
    fixedContent?: string;
    explanation?: string;
  }> {
    try {
      if (!issues.length) {
        return { fixedContent: content };
      }

      const prompt = buildFixPrompt({ filePath, content, issues });

      const completion = await vscode.commands.executeCommand<string>(
        LLM_COMPLETE_COMMAND,
        {
          prompt,
          title: selectedModelTitle || 'default',
          completionOptions: { maxTokens: 8192 },
        },
      );

      const sanitized = sanitizeLlmFixOutput(completion, content);
      if (sanitized.skipped) {
        if (!completion || typeof completion !== 'string') {
          console.warn('[DiagnosticFixManager] LLM returned empty completion, skipping fix');
        } else {
          console.warn('[DiagnosticFixManager] LLM output too short, likely invalid — skipping');
        }
        return { fixedContent: sanitized.fixedContent };
      }

      return {
        fixedContent: sanitized.fixedContent,
        explanation: `Applied AI-generated fixes for ${issues.length} diagnostic issue(s)`,
      };
    } catch (error) {
      console.error('[DiagnosticFixManager] Error generating fix suggestions:', error);
      return {};
    }
  }

  /**
   * Reset attempt counter for a file
   */
  public resetAttemptCounter(fileUri: string | vscode.Uri): void {
    const uri = typeof fileUri === 'string' ? fileUri : fileUri.toString();
    this.attempts.reset(uri);
  }

  /**
   * Check if a file is has reached maximum fix attempts
   */
  public hasReachedMaxAttempts(fileUri: string | vscode.Uri): boolean {
    const uri = typeof fileUri === 'string' ? fileUri : fileUri.toString();
    return this.attempts.hasReachedMax(uri);
  }

  /**
   * Get current attempt count for a file
   */
  public getAttemptCount(fileUri: string | vscode.Uri): number {
    const uri = typeof fileUri === 'string' ? fileUri : fileUri.toString();
    return this.attempts.getCount(uri);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._onFixAttemptStarted.dispose();
    this._onFixAttemptCompleted.dispose();
    this.attempts.clear();
    if (DiagnosticFixManager.instance === this) {
      DiagnosticFixManager.instance = undefined;
    }
  }
}
