import * as vscode from 'vscode';

import type { AgentJobUpdate } from 'core/protocol/agentJobs';
import {
  classifyTerminalOutput,
  TERMINAL_OUTPUT_CAPTURE_CHARS,
  type ClassifiedTerminalError,
} from 'core/tools/build/classifyTerminalError';

/**
 * Detected error from terminal output.
 */
export interface TerminalError {
  /** The error pattern that matched */
  pattern: string;
  /** The matching line(s) from terminal output */
  matchedText: string;
  /** Category: build, test, runtime, dependency */
  category: ClassifiedTerminalError['category'];
  /** Severity level */
  severity: ClassifiedTerminalError['severity'];
  /** Suggested action label */
  suggestedAction: string;
}

/**
 * Terminal command record.
 */
export interface TerminalCommandRecord {
  command: string;
  output: string;
  exitCode: number | null;
  timestamp: number;
  errors: TerminalError[];
}

const OUTPUT_CAPTURE_CHARS = TERMINAL_OUTPUT_CAPTURE_CHARS;

/**
 * TerminalMonitor watches terminal output for errors and emits
 * proactive fix suggestions. It hooks into VS Code's terminal
 * shell integration API when available, and also records agent-shell
 * jobs (HL-10).
 */
export class TerminalMonitor implements vscode.Disposable {
  private static instance: TerminalMonitor;
  private disposables: vscode.Disposable[] = [];

  /** Recent command history (last 20 commands) */
  private commandHistory: TerminalCommandRecord[] = [];
  private readonly maxHistory = 20;

  // Events
  private _onErrorDetected = new vscode.EventEmitter<{ error: TerminalError; terminalOutput: string }>();
  public readonly onErrorDetected = this._onErrorDetected.event;

  private _onCommandCompleted = new vscode.EventEmitter<TerminalCommandRecord>();
  public readonly onCommandCompleted = this._onCommandCompleted.event;

  static getInstance(): TerminalMonitor {
    if (!TerminalMonitor.instance) {
      TerminalMonitor.instance = new TerminalMonitor();
    }
    return TerminalMonitor.instance;
  }

  private constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Use shell integration API (VS Code 1.93+) to detect command completions
    if (vscode.window.onDidEndTerminalShellExecution) {
      this.disposables.push(
        vscode.window.onDidEndTerminalShellExecution(async (event) => {
          await this.handleShellExecutionEnd(event);
        }),
      );
    }
  }

  /**
   * Handle terminal command completion via shell integration.
   */
  private async handleShellExecutionEnd(
    event: vscode.TerminalShellExecutionEndEvent,
  ): Promise<void> {
    const { execution, exitCode } = event;

    // Read the command output from the shell execution stream
    let output = '';
    try {
      if (execution.read) {
        const stream = execution.read();
        for await (const data of stream) {
          output += data;
          // Limit capture so a kernel make log does not sit in memory
          if (output.length > OUTPUT_CAPTURE_CHARS) {
            output = output.substring(output.length - OUTPUT_CAPTURE_CHARS);
            break;
          }
        }
      }
    } catch {
      // Stream read may fail — proceed with empty output
    }

    const commandLine = execution.commandLine?.value ?? '';

    // Detect errors in output
    const errors = this.detectErrors(output);

    const record: TerminalCommandRecord = {
      command: commandLine,
      output: output.substring(Math.max(0, output.length - 16_000)),
      exitCode: exitCode ?? null,
      timestamp: Date.now(),
      errors,
    };

    // Store in history
    this.commandHistory.push(record);
    if (this.commandHistory.length > this.maxHistory) {
      this.commandHistory.shift();
    }

    this._onCommandCompleted.fire(record);

    this.emitErrors(errors, output, exitCode);
  }

  /**
   * Detect error patterns in terminal output.
   */
  detectErrors(output: string): TerminalError[] {
    return classifyTerminalOutput(output);
  }

  private emitErrors(
    errors: TerminalError[],
    output: string,
    exitCode: number | null | undefined,
  ): void {
    if (errors.length > 0 || (exitCode !== undefined && exitCode !== null && exitCode !== 0)) {
      for (const error of errors) {
        this._onErrorDetected.fire({ error, terminalOutput: output });
      }
      if (errors.length === 0 && exitCode !== undefined && exitCode !== null && exitCode !== 0) {
        this._onErrorDetected.fire({
          error: {
            pattern: 'non-zero exit code',
            matchedText: `Command exited with code ${exitCode}`,
            category: 'general',
            severity: 'error',
            suggestedAction: 'Debug command failure',
          },
          terminalOutput: output,
        });
      }
    }
  }

  /**
   * Record a command that did not come from VS Code shell integration
   * (e.g. agent `builtin_run_terminal_command`). Agent jobs themselves
   * live in Core `shellJobs`; this only feeds the user-terminal history.
   */
  recordExternalCommand(record: Omit<TerminalCommandRecord, "errors"> & { errors?: TerminalError[] }): void {
    const errors = record.errors ?? this.detectErrors(record.output);
    const full: TerminalCommandRecord = {
      ...record,
      errors,
    };
    this.commandHistory.push(full);
    if (this.commandHistory.length > this.maxHistory) {
      this.commandHistory.shift();
    }
    this._onCommandCompleted.fire(full);
    this.emitErrors(errors, full.output, full.exitCode);
  }

  /**
   * Get the most recent terminal command history.
   */
  getCommandHistory(limit = 10): TerminalCommandRecord[] {
    return this.commandHistory.slice(-limit);
  }

  /**
   * Get the last failed command.
   */
  getLastFailedCommand(): TerminalCommandRecord | null {
    for (let i = this.commandHistory.length - 1; i >= 0; i--) {
      const record = this.commandHistory[i];
      if (record.errors.length > 0 || (record.exitCode !== null && record.exitCode !== 0)) {
        return record;
      }
    }
    return null;
  }

  dispose(): void {
    this._onErrorDetected.dispose();
    this._onCommandCompleted.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

/** Feed Core agent-shell jobs into the same classifier as the user terminal (HL-10). */
export function recordAgentJobForTerminalMonitor(update: AgentJobUpdate): void {
  if (update.event !== "completed") {
    return;
  }
  const job = update.job;
  if (job.kind !== "shell") {
    return;
  }
  TerminalMonitor.getInstance().recordExternalCommand({
    command: job.title,
    output: job.output ?? job.detail ?? "",
    exitCode: job.exitCode ?? null,
    timestamp: job.endedAt ?? Date.now(),
  });
}
