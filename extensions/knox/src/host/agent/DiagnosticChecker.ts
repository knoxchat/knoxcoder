import * as vscode from 'vscode';

import {
  DiagnosticCache,
  DIAGNOSTIC_CACHE_TTL_MS,
  DIAGNOSTIC_SETTLE_MS,
  DiagnosticSeverity,
  formatDiagnosticsForDisplay,
  issuesNeedFixing,
  summarizeDiagnostics,
  toDiagnosticIssue,
  type DiagnosticIssue,
} from './diagnostics';

export { DiagnosticSeverity, type DiagnosticIssue };

/**
 * DiagnosticChecker provides functionality to check for linting errors and warnings in code.
 * KN-352: vscode adapter over `diagnostics.ts` (cache, severity, display).
 */
export class DiagnosticChecker implements vscode.Disposable {
  private static instance: DiagnosticChecker | undefined;
  private disposables: vscode.Disposable[] = [];
  private readonly cache = new DiagnosticCache(DIAGNOSTIC_CACHE_TTL_MS);

  private _onDiagnosticsUpdated = new vscode.EventEmitter<string>();
  public readonly onDiagnosticsUpdated = this._onDiagnosticsUpdated.event;

  /**
   * Get the singleton instance
   */
  public static getInstance(): DiagnosticChecker {
    if (!DiagnosticChecker.instance) {
      DiagnosticChecker.instance = new DiagnosticChecker();
    }
    return DiagnosticChecker.instance;
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(e => {
        e.uris.forEach(uri => {
          this.cache.delete(uri.toString());
          this._onDiagnosticsUpdated.fire(uri.toString());
        });
      })
    );
  }

  /**
   * Get diagnostics for a file
   */
  public async getDiagnostics(fileUri: string | vscode.Uri): Promise<DiagnosticIssue[]> {
    const uri = typeof fileUri === 'string' ? vscode.Uri.parse(fileUri) : fileUri;
    const uriString = uri.toString();

    const cached = this.cache.get(uriString);
    if (cached) {
      return cached;
    }

    const issues = vscode.languages.getDiagnostics(uri).map(d => toDiagnosticIssue(uriString, d));
    this.cache.set(uriString, issues);
    return issues;
  }

  /**
   * Check a file for diagnostic issues after a modification
   */
  public async checkFile(fileUri: string | vscode.Uri): Promise<{
    hasErrors: boolean;
    hasWarnings: boolean;
    issues: DiagnosticIssue[];
  }> {
    await new Promise(resolve => setTimeout(resolve, DIAGNOSTIC_SETTLE_MS));
    const issues = await this.getDiagnostics(fileUri);
    return {
      issues,
      ...summarizeDiagnostics(issues),
    };
  }

  /**
   * Format diagnostic issues as a string for display
   */
  public formatDiagnosticsForDisplay(issues: DiagnosticIssue[]): string {
    return formatDiagnosticsForDisplay(issues);
  }

  /**
   * Check if a file needs fixing based on diagnostics
   */
  public async needsFixing(
    fileUri: string | vscode.Uri,
    severity: DiagnosticSeverity = DiagnosticSeverity.ERROR
  ): Promise<boolean> {
    const { issues } = await this.checkFile(fileUri);
    return issuesNeedFixing(issues, severity);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._onDiagnosticsUpdated.dispose();
    this.cache.clear();
    if (DiagnosticChecker.instance === this) {
      DiagnosticChecker.instance = undefined;
    }
  }
}
