import * as vscode from 'vscode';

/**
 * Severity levels for diagnostics
 */
export enum DiagnosticSeverity {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  HINT = 'hint'
}

/**
 * Represents a diagnostic issue found in code
 */
export interface DiagnosticIssue {
  filePath: string;
  message: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  severity: DiagnosticSeverity;
  code?: string;
  source?: string;
}

/**
 * DiagnosticChecker provides functionality to check for linting errors and warnings in code
 */
export class DiagnosticChecker implements vscode.Disposable {
  private static instance: DiagnosticChecker;
  private disposables: vscode.Disposable[] = [];
  
  // Caching diagnostics for performance
  private diagnosticCache: Map<string, DiagnosticIssue[]> = new Map();
  private cacheTTL: number = 3000; // 3 seconds
  
  // Event emitters
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
    // Listen for diagnostic changes
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(e => {
        e.uris.forEach(uri => {
          // Clear cache for changed files
          this.diagnosticCache.delete(uri.toString());
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
    
    // Check cache first
    if (this.diagnosticCache.has(uriString)) {
      return this.diagnosticCache.get(uriString) || [];
    }
    
    // Get diagnostics from VS Code
    const diagnostics = vscode.languages.getDiagnostics(uri);
    
    // Convert to our format
    const issues = diagnostics.map(d => ({
      filePath: uriString,
      message: d.message,
      line: d.range.start.line,
      character: d.range.start.character,
      endLine: d.range.end.line,
      endCharacter: d.range.end.character,
      severity: this.mapSeverity(d.severity),
      code: d.code ? String(d.code) : undefined,
      source: d.source
    }));
    
    // Cache the results
    this.diagnosticCache.set(uriString, issues);
    
    // Set timeout to clear cache
    setTimeout(() => {
      this.diagnosticCache.delete(uriString);
    }, this.cacheTTL);
    
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
    // Need to wait a bit for VS Code to update diagnostics
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get diagnostics
    const issues = await this.getDiagnostics(fileUri);
    
    // Check for errors and warnings
    const hasErrors = issues.some(i => i.severity === DiagnosticSeverity.ERROR);
    const hasWarnings = issues.some(i => i.severity === DiagnosticSeverity.WARNING);
    
    return {
      hasErrors,
      hasWarnings,
      issues
    };
  }
  
  /**
   * Format diagnostic issues as a string for display
   */
  public formatDiagnosticsForDisplay(issues: DiagnosticIssue[]): string {
    if (issues.length === 0) {
      return 'No issues found.';
    }
    
    return issues.map(issue => {
      const severity = this.getSeverityIcon(issue.severity);
      return `${severity} ${issue.message} (Line ${issue.line + 1})`;
    }).join('\n');
  }
  
  /**
   * Map VS Code diagnostic severity to our severity
   */
  private mapSeverity(severity: vscode.DiagnosticSeverity): DiagnosticSeverity {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return DiagnosticSeverity.ERROR;
      case vscode.DiagnosticSeverity.Warning:
        return DiagnosticSeverity.WARNING;
      case vscode.DiagnosticSeverity.Information:
        return DiagnosticSeverity.INFO;
      case vscode.DiagnosticSeverity.Hint:
        return DiagnosticSeverity.HINT;
      default:
        return DiagnosticSeverity.INFO;
    }
  }
  
  /**
   * Get icon for severity level
   */
  private getSeverityIcon(severity: DiagnosticSeverity): string {
    switch (severity) {
      case DiagnosticSeverity.ERROR:
        return '🔴';
      case DiagnosticSeverity.WARNING:
        return '⚠️';
      case DiagnosticSeverity.INFO:
        return 'ℹ️';
      case DiagnosticSeverity.HINT:
        return '💡';
      default:
        return '•';
    }
  }
  
  /**
   * Check if a file needs fixing based on diagnostics
   */
  public async needsFixing(fileUri: string | vscode.Uri, severity: DiagnosticSeverity = DiagnosticSeverity.ERROR): Promise<boolean> {
    const { issues } = await this.checkFile(fileUri);
    
    switch(severity) {
      case DiagnosticSeverity.ERROR:
        return issues.some(i => i.severity === DiagnosticSeverity.ERROR);
      case DiagnosticSeverity.WARNING:
        return issues.some(i => 
          i.severity === DiagnosticSeverity.ERROR || 
          i.severity === DiagnosticSeverity.WARNING
        );
      case DiagnosticSeverity.INFO:
        return issues.some(i => 
          i.severity === DiagnosticSeverity.ERROR || 
          i.severity === DiagnosticSeverity.WARNING || 
          i.severity === DiagnosticSeverity.INFO
        );
      default:
        return issues.length > 0;
    }
  }
  
  /**
   * Dispose resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._onDiagnosticsUpdated.dispose();
    this.diagnosticCache.clear();
  }
} 