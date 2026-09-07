import { ToolCall, ContextItem } from 'core';
import * as vscode from 'vscode';

import { DiagnosticChecker, DiagnosticIssue, DiagnosticSeverity } from './DiagnosticChecker';

/**
 * DiagnosticFixManager handles automatic repair of code issues detected by linters or diagnostics
 */
export class DiagnosticFixManager implements vscode.Disposable {
  private static instance: DiagnosticFixManager;
  private disposables: vscode.Disposable[] = [];
  private diagnosticChecker: DiagnosticChecker;
  
  // Track files being processed to avoid infinite loops
  private filesBeingProcessed: Set<string> = new Set();
  private maxFixAttempts: number = 3;
  private fixAttemptCounts: Map<string, number> = new Map();
  
  // Event emitters
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
    
    // Prevent reentry for same file
    if (this.filesBeingProcessed.has(uriString)) {
      return { success: false, fixedIssues: [], remainingIssues: [] };
    }
    
    this.filesBeingProcessed.add(uriString);
    
    try {
      // Check current diagnostics
      await this.waitForDiagnosticsToUpdate(uri);
      const { issues: initialIssues } = await this.diagnosticChecker.checkFile(uri);
      
      // If there are no issues, we're done
      if (initialIssues.length === 0) {
        return { success: true, fixedIssues: [], remainingIssues: [] };
      }
      
      // Get current fix attempt count
      const attemptCount = this.fixAttemptCounts.get(uriString) || 0;
      
      // If we've exceeded max attempts, give up
      if (attemptCount >= this.maxFixAttempts) {
        this.fixAttemptCounts.delete(uriString);
        return { 
          success: false, 
          fixedIssues: [], 
          remainingIssues: initialIssues 
        };
      }
      
      // Increment attempt count
      this.fixAttemptCounts.set(uriString, attemptCount + 1);
      
      // Notify that fix attempt is starting
      this._onFixAttemptStarted.fire(uriString);
      
      // Get document content
      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();
      
      // Create a fix tool call
      const fixToolCall: ToolCall = {
        id: `fix-${Date.now()}`,
        type: 'function',
        function: {
          name: 'fix_code_issues',
          arguments: JSON.stringify({
            file_content: content,
            file_path: uri.fsPath,
            issues: initialIssues.map(issue => ({
              message: issue.message,
              line: issue.line + 1, // Convert to 1-indexed for human readability
              severity: issue.severity,
              source: issue.source
            }))
          })
        }
      };
      
      // Execute tool call to get fix suggestions
      const fixSuggestions = await this.generateFixSuggestions(fixToolCall, selectedModelTitle);
      
      // Apply the fix directly to the file
      if (fixSuggestions.fixedContent) {
        // Apply fix
        await vscode.workspace.fs.writeFile(
          uri, 
          Buffer.from(fixSuggestions.fixedContent)
        );
        
        // Wait for diagnostics to update after fix
        await this.waitForDiagnosticsToUpdate(uri);
        
        // Check if issues were resolved
        const { issues: remainingIssues } = await this.diagnosticChecker.checkFile(uri);
        
        // Determine which issues were fixed
        const fixedIssues = initialIssues.filter(initial => 
          !remainingIssues.some(remaining => 
            remaining.line === initial.line && 
            remaining.message === initial.message
          )
        );
        
        // Emit completion event
        this._onFixAttemptCompleted.fire({
          filePath: uriString,
          success: remainingIssues.length < initialIssues.length,
          issues: remainingIssues
        });
        
        // If no issues remain or all severe issues are fixed, consider it a success
        const success = remainingIssues.length === 0 || 
          !remainingIssues.some(issue => issue.severity === DiagnosticSeverity.ERROR);
        
        return {
          success,
          fixedIssues,
          remainingIssues
        };
      }
      
      return {
        success: false,
        fixedIssues: [],
        remainingIssues: initialIssues
      };
    } finally {
      // Clean up
      this.filesBeingProcessed.delete(uriString);
    }
  }
  
  /**
   * Wait for diagnostics to be updated
   */
  private async waitForDiagnosticsToUpdate(uri: vscode.Uri): Promise<void> {
    return new Promise<void>(resolve => {
      // Wait for a reasonable time for diagnostics to update
      const timeout = setTimeout(() => {
        diagnosticsListener.dispose();
        resolve();
      }, 1500);
      
      // Also listen for diagnostics updates
      const diagnosticsListener = this.diagnosticChecker.onDiagnosticsUpdated(updatedUri => {
        if (updatedUri === uri.toString()) {
          clearTimeout(timeout);
          diagnosticsListener.dispose();
          // Wait a bit more to ensure all diagnostics are processed
          setTimeout(resolve, 200);
        }
      });
    });
  }
  
  /**
   * Generate fix suggestions from the AI model
   */
  private async generateFixSuggestions(
    fixToolCall: ToolCall, 
    selectedModelTitle: string
  ): Promise<{
    fixedContent?: string;
    explanation?: string;
  }> {
    try {
      const args = typeof fixToolCall.function.arguments === 'string' 
        ? JSON.parse(fixToolCall.function.arguments) 
        : fixToolCall.function.arguments;
        
      const content: string = args.file_content;
      const filePath: string = args.file_path;
      const issues: Array<{ message: string; line: number; severity: string; source?: string }> = args.issues || [];

      if (!issues.length) {
        return { fixedContent: content };
      }

      // Build a focused prompt with file content and diagnostic errors
      const issueList = issues
        .map((issue, i) => `  ${i + 1}. Line ${issue.line} [${issue.severity}]: ${issue.message}${issue.source ? ` (${issue.source})` : ''}`)
        .join('\n');

      // Determine file language from extension
      const ext = filePath.split('.').pop() || '';
      const langMap: Record<string, string> = {
        ts: 'TypeScript', tsx: 'TypeScript (React)', js: 'JavaScript', jsx: 'JavaScript (React)',
        py: 'Python', java: 'Java', cpp: 'C++', c: 'C', cs: 'C#', go: 'Go', rs: 'Rust',
        php: 'PHP', rb: 'Ruby', swift: 'Swift', kt: 'Kotlin',
      };
      const language = langMap[ext] || ext;

      const prompt = [
        `Fix the following ${language} code diagnostics. Return ONLY the complete fixed file content with no explanation, no markdown fences, no extra text.`,
        ``,
        `File: ${filePath}`,
        `Diagnostics to fix:`,
        issueList,
        ``,
        `Current file content:`,
        content,
      ].join('\n');

      // Call the LLM via the registered VS Code command
      const completion = await vscode.commands.executeCommand<string>(
        'knox.llmComplete',
        {
          prompt,
          title: selectedModelTitle || 'default',
          completionOptions: { maxTokens: 8192 },
        },
      );

      if (!completion || typeof completion !== 'string') {
        console.warn('[DiagnosticFixManager] LLM returned empty completion, skipping fix');
        return { fixedContent: content };
      }

      // Clean the response: strip markdown fences if the model added them
      let fixedContent = completion.trim();
      const fenceMatch = fixedContent.match(/^```[\w]*\n([\s\S]*?)```$/);
      if (fenceMatch) {
        fixedContent = fenceMatch[1].trim();
      }

      // Sanity check: the fixed content should look like real code
      // (has at least 30% of original line count to avoid hallucination)
      const originalLines = content.split('\n').length;
      const fixedLines = fixedContent.split('\n').length;
      if (fixedLines < originalLines * 0.3) {
        console.warn('[DiagnosticFixManager] LLM output too short, likely invalid — skipping');
        return { fixedContent: content };
      }

      return {
        fixedContent,
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
    this.fixAttemptCounts.delete(uri);
  }
  
  /**
   * Check if a file is has reached maximum fix attempts
   */
  public hasReachedMaxAttempts(fileUri: string | vscode.Uri): boolean {
    const uri = typeof fileUri === 'string' ? fileUri : fileUri.toString();
    const count = this.fixAttemptCounts.get(uri) || 0;
    return count >= this.maxFixAttempts;
  }
  
  /**
   * Get current attempt count for a file
   */
  public getAttemptCount(fileUri: string | vscode.Uri): number {
    const uri = typeof fileUri === 'string' ? fileUri : fileUri.toString();
    return this.fixAttemptCounts.get(uri) || 0;
  }
  
  /**
   * Dispose resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._onFixAttemptStarted.dispose();
    this._onFixAttemptCompleted.dispose();
    this.filesBeingProcessed.clear();
    this.fixAttemptCounts.clear();
  }
} 