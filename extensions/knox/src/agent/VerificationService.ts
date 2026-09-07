import { extractVerifiedFilePath } from 'core/tools/postEditVerification';
import * as vscode from 'vscode';

import { DiagnosticChecker, DiagnosticIssue, DiagnosticSeverity } from './DiagnosticChecker';
import { DiagnosticFixManager } from './DiagnosticFixManager';

/**
 * Configuration for the verification loop.
 */
export interface VerificationConfig {
  /** Maximum number of verify→fix iterations (default: 5) */
  maxIterations: number;

  /** Whether to auto-verify after file edits (default: true) */
  enabled: boolean;

  /** Time in ms to wait for diagnostics to settle after an edit (default: 1500) */
  diagnosticSettleMs: number;

  /** Only fix errors (true) or also warnings (false) (default: true) */
  errorsOnly: boolean;

  /** Tool names that trigger verification after execution */
  triggerToolNames: Set<string>;
}

const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  maxIterations: 5,
  enabled: true,
  diagnosticSettleMs: 1500,
  errorsOnly: true,
  triggerToolNames: new Set([
    'builtin_create_new_file',
    'builtin_edit_file',
    'builtin_write_file',
    'builtin_apply_patch',
    'composite_smart_edit',
    'builtin_generate_tests',
  ]),
};

/**
 * Result of a single verification cycle.
 */
export interface VerificationResult {
  /** The file that was verified */
  filePath: string;
  /** Whether the file is now clean (no errors) */
  clean: boolean;
  /** Number of iterations performed */
  iterations: number;
  /** Issues remaining after all iterations */
  remainingIssues: DiagnosticIssue[];
  /** Total issues fixed across all iterations */
  totalFixed: number;
  /** Whether the loop bailed out due to repeated errors */
  bailedOut: boolean;
}

/**
 * VerificationService implements an agentic auto-verification loop.
 *
 * After any file-modifying tool call, it:
 * 1. Waits for diagnostics to settle
 * 2. Checks for errors via DiagnosticChecker
 * 3. If errors exist, calls DiagnosticFixManager (which uses the LLM)
 * 4. Re-checks diagnostics
 * 5. Repeats until clean or max iterations reached
 *
 * Loop-detection prevents infinite cycles when the LLM keeps producing
 * the same error.
 */
export class VerificationService implements vscode.Disposable {
  private static instance: VerificationService;
  private disposables: vscode.Disposable[] = [];
  private config: VerificationConfig;
  private diagnosticChecker: DiagnosticChecker;
  private diagnosticFixManager: DiagnosticFixManager;

  // Track ongoing verifications to prevent reentrancy
  private activeVerifications = new Set<string>();

  // Events
  private _onVerificationStarted = new vscode.EventEmitter<string>();
  public readonly onVerificationStarted = this._onVerificationStarted.event;

  private _onVerificationCompleted = new vscode.EventEmitter<VerificationResult>();
  public readonly onVerificationCompleted = this._onVerificationCompleted.event;

  private _onIterationCompleted = new vscode.EventEmitter<{
    filePath: string;
    iteration: number;
    fixedCount: number;
    remainingCount: number;
  }>();
  public readonly onIterationCompleted = this._onIterationCompleted.event;

  public static getInstance(): VerificationService {
    if (!VerificationService.instance) {
      VerificationService.instance = new VerificationService();
    }
    return VerificationService.instance;
  }

  private constructor() {
    this.config = { ...DEFAULT_VERIFICATION_CONFIG };
    this.diagnosticChecker = DiagnosticChecker.getInstance();
    this.diagnosticFixManager = DiagnosticFixManager.getInstance();
  }

  /**
   * Update the verification configuration.
   */
  public updateConfig(partialConfig: Partial<VerificationConfig>): void {
    this.config = { ...this.config, ...partialConfig };
  }

  /**
   * Check whether verification is enabled.
   * Tool eligibility is decided by Core `shouldVerifyTool` before this runs.
   */
  public shouldVerify(_toolName?: string): boolean {
    return this.config.enabled;
  }

  /**
   * Extract the target file path from a tool call's arguments.
   * Delegates to Core's shared helper so chat and agent agree.
   */
  public extractFilePath(toolName: string, toolArgs: any): string | undefined {
    return extractVerifiedFilePath(toolName, toolArgs);
  }

  /**
   * Run the verification loop on a file after an edit.
   *
   * @param filePath - Absolute path or URI string of the edited file
   * @param selectedModelTitle - Model title for LLM-based fixes
   * @returns Verification result
   */
  public async verifyAndFix(
    filePath: string,
    selectedModelTitle: string,
  ): Promise<VerificationResult> {
    // Prevent reentry for same file
    if (this.activeVerifications.has(filePath)) {
      const earlyResult: VerificationResult = {
        filePath,
        clean: false,
        iterations: 0,
        remainingIssues: [],
        totalFixed: 0,
        bailedOut: false,
      };
      this._onVerificationCompleted.fire(earlyResult);
      return earlyResult;
    }

    this.activeVerifications.add(filePath);
    this._onVerificationStarted.fire(filePath);

    // Reset the DiagnosticFixManager's attempt counter for a fresh loop
    this.diagnosticFixManager.resetAttemptCounter(filePath);

    const uri = filePath.startsWith('file://') || filePath.includes('://')
      ? vscode.Uri.parse(filePath)
      : vscode.Uri.file(filePath);

    let iterations = 0;
    let totalFixed = 0;
    let bailedOut = false;
    let previousErrorSignatures = new Set<string>();
    let result: VerificationResult | undefined;

    try {
      while (iterations < this.config.maxIterations) {
        // Wait for diagnostics to settle
        await this.waitForDiagnostics(uri);

        // Get current diagnostics
        const { issues } = await this.diagnosticChecker.checkFile(uri);

        // Filter by severity if configured
        const relevantIssues = this.config.errorsOnly
          ? issues.filter((i) => i.severity === DiagnosticSeverity.ERROR)
          : issues;

        // Clean — we're done
        if (relevantIssues.length === 0) {
          result = {
            filePath,
            clean: true,
            iterations,
            remainingIssues: [],
            totalFixed,
            bailedOut: false,
          };
          return result;
        }

        // Loop detection: if exact same errors appear again, bail out
        const currentSignatures = new Set(
          relevantIssues.map((i) => `${i.line}:${i.message}`),
        );
        const allSame =
          currentSignatures.size === previousErrorSignatures.size &&
          [...currentSignatures].every((s) => previousErrorSignatures.has(s));

        if (iterations > 0 && allSame) {
          console.warn(
            `[VerificationService] Same errors detected after iteration ${iterations}, bailing out`,
          );
          bailedOut = true;
          result = {
            filePath,
            clean: false,
            iterations,
            remainingIssues: relevantIssues,
            totalFixed,
            bailedOut: true,
          };
          return result;
        }

        previousErrorSignatures = currentSignatures;
        iterations++;

        console.log(
          `[VerificationService] Iteration ${iterations}: ${relevantIssues.length} issue(s) in ${filePath}`,
        );

        // Attempt fix via DiagnosticFixManager (which now calls the LLM)
        const fixResult = await this.diagnosticFixManager.checkAndFixDiagnostics(
          uri,
          selectedModelTitle,
        );

        totalFixed += fixResult.fixedIssues.length;

        this._onIterationCompleted.fire({
          filePath,
          iteration: iterations,
          fixedCount: fixResult.fixedIssues.length,
          remainingCount: fixResult.remainingIssues.length,
        });

        // If fix manager says success (no errors remain), verify once more
        if (fixResult.success) {
          // Do a final check
          await this.waitForDiagnostics(uri);
          const { issues: finalIssues } = await this.diagnosticChecker.checkFile(uri);
          const finalRelevant = this.config.errorsOnly
            ? finalIssues.filter((i) => i.severity === DiagnosticSeverity.ERROR)
            : finalIssues;

          result = {
            filePath,
            clean: finalRelevant.length === 0,
            iterations,
            remainingIssues: finalRelevant,
            totalFixed,
            bailedOut: false,
          };
          return result;
        }

        // Reset the attempt counter so the fix manager can try again next iteration
        this.diagnosticFixManager.resetAttemptCounter(filePath);
      }

      // Reached max iterations
      await this.waitForDiagnostics(uri);
      const { issues: finalIssues } = await this.diagnosticChecker.checkFile(uri);
      const finalRelevant = this.config.errorsOnly
        ? finalIssues.filter((i) => i.severity === DiagnosticSeverity.ERROR)
        : finalIssues;

      result = {
        filePath,
        clean: finalRelevant.length === 0,
        iterations,
        remainingIssues: finalRelevant,
        totalFixed,
        bailedOut: false,
      };
      return result;
    } finally {
      this.activeVerifications.delete(filePath);
      if (result) {
        this._onVerificationCompleted.fire(result);
      }
    }
  }

  /**
   * Wait for diagnostics to settle after a file change.
   */
  private async waitForDiagnostics(uri: vscode.Uri): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        listener.dispose();
        resolve();
      }, this.config.diagnosticSettleMs);

      const listener = this.diagnosticChecker.onDiagnosticsUpdated((updatedUri) => {
        if (updatedUri === uri.toString()) {
          clearTimeout(timeout);
          listener.dispose();
          // Give a small extra buffer for all providers to report
          setTimeout(resolve, 200);
        }
      });
    });
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this._onVerificationStarted.dispose();
    this._onVerificationCompleted.dispose();
    this._onIterationCompleted.dispose();
    this.activeVerifications.clear();
  }
}
