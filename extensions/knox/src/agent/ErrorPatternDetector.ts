import * as vscode from 'vscode';

import { TerminalError, TerminalMonitor } from './TerminalMonitor';
import { shouldOfferPackageInstall } from 'core/tools/build/classifyTerminalError';

/**
 * Fix suggestion generated from detected terminal errors.
 */
export interface FixSuggestion {
  /** Unique suggestion ID */
  id: string;
  /** Error that triggered this suggestion */
  error: TerminalError;
  /** Human-readable suggestion text */
  message: string;
  /** Command or action to execute if user accepts */
  action: FixAction;
  /** Confidence level (0–1) */
  confidence: number;
  /** Timestamp when suggestion was created */
  timestamp: number;
}

export type FixAction =
  | { type: 'sendToAgent'; context: string }
  | { type: 'runCommand'; command: string }
  | { type: 'installPackage'; packageName: string; manager: string };

/**
 * ErrorPatternDetector provides higher-level error analysis and
 * fix suggestion generation on top of TerminalMonitor's raw error detection.
 *
 * It:
 * 1. Receives error events from TerminalMonitor
 * 2. Analyzes the error context (surrounding output, command, exit code)
 * 3. Generates actionable fix suggestions
 * 4. Manages suggestion lifecycle (display, accept, dismiss, expire)
 */
export class ErrorPatternDetector implements vscode.Disposable {
  private static instance: ErrorPatternDetector;
  private disposables: vscode.Disposable[] = [];
  private terminalMonitor: TerminalMonitor;

  /** Active (undismissed) suggestions */
  private activeSuggestions: FixSuggestion[] = [];
  private readonly maxSuggestions = 5;
  private suggestionCounter = 0;

  // Events
  private _onSuggestionCreated = new vscode.EventEmitter<FixSuggestion>();
  public readonly onSuggestionCreated = this._onSuggestionCreated.event;

  private _onSuggestionDismissed = new vscode.EventEmitter<string>();
  public readonly onSuggestionDismissed = this._onSuggestionDismissed.event;

  static getInstance(): ErrorPatternDetector {
    if (!ErrorPatternDetector.instance) {
      ErrorPatternDetector.instance = new ErrorPatternDetector();
    }
    return ErrorPatternDetector.instance;
  }

  private constructor() {
    this.terminalMonitor = TerminalMonitor.getInstance();
    this.setupListeners();
  }

  private setupListeners(): void {
    this.disposables.push(
      this.terminalMonitor.onErrorDetected(({ error, terminalOutput }) => {
        const suggestion = this.generateSuggestion(error, terminalOutput);
        if (suggestion) {
          this.addSuggestion(suggestion);
        }
      }),
    );
  }

  /**
   * Generate a fix suggestion for a detected error.
   */
  private generateSuggestion(error: TerminalError, output: string): FixSuggestion | null {
    const id = `suggestion-${++this.suggestionCounter}`;

    switch (error.category) {
      case 'dependency': {
        const missingModule = this.extractMissingModule(error.matchedText);
        if (missingModule && shouldOfferPackageInstall(error.category, undefined, output)) {
          const manager = this.detectPackageManager(output);
          return {
            id,
            error,
            message: `Missing module "${missingModule}". Install it?`,
            action: {
              type: 'installPackage',
              packageName: missingModule,
              manager,
            },
            confidence: 0.9,
            timestamp: Date.now(),
          };
        }
        return {
          id,
          error,
          message: `Dependency error: ${error.suggestedAction}`,
          action: {
            type: 'sendToAgent',
            context: `Terminal error:\n${error.matchedText}\n\nFull output:\n${output.substring(0, 2000)}`,
          },
          confidence: 0.7,
          timestamp: Date.now(),
        };
      }

      case 'build': {
        return {
          id,
          error,
          message: `Build error detected: ${error.suggestedAction}`,
          action: {
            type: 'sendToAgent',
            context: `Build error:\n${error.matchedText}\n\nFull output:\n${output.substring(0, 3000)}`,
          },
          confidence: 0.8,
          timestamp: Date.now(),
        };
      }

      case 'test': {
        return {
          id,
          error,
          message: `Test failure: ${error.suggestedAction}`,
          action: {
            type: 'sendToAgent',
            context: `Test failure:\n${error.matchedText}\n\nFull output:\n${output.substring(0, 3000)}`,
          },
          confidence: 0.8,
          timestamp: Date.now(),
        };
      }

      case 'runtime': {
        return {
          id,
          error,
          message: `Runtime error: ${error.suggestedAction}`,
          action: {
            type: 'sendToAgent',
            context: `Runtime error:\n${error.matchedText}\n\nStack trace:\n${this.extractStackTrace(output)}`,
          },
          confidence: 0.7,
          timestamp: Date.now(),
        };
      }

      default: {
        return {
          id,
          error,
          message: error.suggestedAction,
          action: {
            type: 'sendToAgent',
            context: `Terminal error:\n${error.matchedText}\n\nOutput:\n${output.substring(0, 2000)}`,
          },
          confidence: 0.5,
          timestamp: Date.now(),
        };
      }
    }
  }

  /**
   * Extract missing module name from error text.
   */
  private extractMissingModule(text: string): string | null {
    const patterns = [
      /Cannot find module ['"]([^'"]+)['"]/i,
      /Module not found.*['"]([^'"]+)['"]/i,
      /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
      /ImportError: No module named ['"]([^'"]+)['"]/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Detect which package manager is being used.
   */
  private detectPackageManager(output: string): string {
    if (output.includes('pnpm') || output.includes('ERR_PNPM')) return 'pnpm';
    if (output.includes('yarn')) return 'yarn';
    if (output.includes('bun')) return 'bun';
    return 'npm';
  }

  /**
   * Extract stack trace from output.
   */
  private extractStackTrace(output: string): string {
    const lines = output.split('\n');
    const traceStart = lines.findIndex(
      (l) => l.includes('Traceback') || l.match(/^\s+at\s+/) || l.includes('Error:'),
    );
    if (traceStart === -1) return output.substring(0, 1000);

    return lines.slice(traceStart, traceStart + 20).join('\n');
  }

  /**
   * Add a new suggestion and fire events.
   */
  private addSuggestion(suggestion: FixSuggestion): void {
    this.activeSuggestions.push(suggestion);

    // Cap suggestions to prevent accumulation
    while (this.activeSuggestions.length > this.maxSuggestions) {
      this.activeSuggestions.shift();
    }

    this._onSuggestionCreated.fire(suggestion);
  }

  /**
   * Get all active suggestions.
   */
  public getActiveSuggestions(): FixSuggestion[] {
    return [...this.activeSuggestions];
  }

  /**
   * Dismiss a suggestion by ID.
   */
  public dismissSuggestion(id: string): void {
    const idx = this.activeSuggestions.findIndex((s) => s.id === id);
    if (idx !== -1) {
      this.activeSuggestions.splice(idx, 1);
      this._onSuggestionDismissed.fire(id);
    }
  }

  /**
   * Clear all active suggestions.
   */
  public clearAllSuggestions(): void {
    const ids = this.activeSuggestions.map((s) => s.id);
    this.activeSuggestions = [];
    for (const id of ids) {
      this._onSuggestionDismissed.fire(id);
    }
  }

  public dispose(): void {
    this._onSuggestionCreated.dispose();
    this._onSuggestionDismissed.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
