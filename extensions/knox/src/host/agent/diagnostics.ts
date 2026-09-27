/**
 * KN-352: vscode-free diagnostic check/fix engine.
 *
 * DiagnosticChecker / DiagnosticFixManager are the vscode adapters
 * (`languages.getDiagnostics`, `knox.llmComplete`, `workspace.fs.writeFile`).
 */

export const CHECK_DIAGNOSTICS_COMMAND = "knox.checkDiagnostics";
export const FIX_DIAGNOSTICS_COMMAND = "knox.fixDiagnostics";
/** Host LLM complete used by DiagnosticFixManager. */
export const LLM_COMPLETE_COMMAND = "knox.llmComplete";

export const DIAGNOSTIC_CACHE_TTL_MS = 3000;
export const DIAGNOSTIC_SETTLE_MS = 500;
export const FIX_DIAGNOSTIC_WAIT_MS = 1500;
export const FIX_DIAGNOSTIC_POST_UPDATE_MS = 200;
export const MAX_FIX_ATTEMPTS = 3;
export const MIN_FIX_LINE_RATIO = 0.3;

/**
 * vscode.DiagnosticSeverity numeric values (Error=0 … Hint=3). Kept as
 * numbers so mocha can run this file without the vscode module.
 */
export const VSCODE_DIAGNOSTIC_SEVERITY = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

export enum DiagnosticSeverity {
  ERROR = "error",
  WARNING = "warning",
  INFO = "info",
  HINT = "hint",
}

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

export interface DiagnosticCheckResult {
  hasErrors: boolean;
  hasWarnings: boolean;
  issues: DiagnosticIssue[];
}

export interface HostDiagnostic {
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  code?: string | number | { value: string | number };
  source?: string;
}

export interface DiagnosticFixPromptIssue {
  message: string;
  /** 1-indexed line for the LLM prompt. */
  line: number;
  severity: string;
  source?: string;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript (React)",
  js: "JavaScript",
  jsx: "JavaScript (React)",
  py: "Python",
  java: "Java",
  cpp: "C++",
  c: "C",
  cs: "C#",
  go: "Go",
  rs: "Rust",
  php: "PHP",
  rb: "Ruby",
  swift: "Swift",
  kt: "Kotlin",
};

export function mapSeverity(severity: number): DiagnosticSeverity {
  switch (severity) {
    case VSCODE_DIAGNOSTIC_SEVERITY.Error:
      return DiagnosticSeverity.ERROR;
    case VSCODE_DIAGNOSTIC_SEVERITY.Warning:
      return DiagnosticSeverity.WARNING;
    case VSCODE_DIAGNOSTIC_SEVERITY.Information:
      return DiagnosticSeverity.INFO;
    case VSCODE_DIAGNOSTIC_SEVERITY.Hint:
      return DiagnosticSeverity.HINT;
    default:
      return DiagnosticSeverity.INFO;
  }
}

export function getSeverityIcon(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.ERROR:
      return "🔴";
    case DiagnosticSeverity.WARNING:
      return "⚠️";
    case DiagnosticSeverity.INFO:
      return "ℹ️";
    case DiagnosticSeverity.HINT:
      return "💡";
    default:
      return "•";
  }
}

export function formatDiagnosticsForDisplay(issues: DiagnosticIssue[]): string {
  if (issues.length === 0) {
    return "No issues found.";
  }
  return issues
    .map((issue) => {
      const severity = getSeverityIcon(issue.severity);
      return `${severity} ${issue.message} (Line ${issue.line + 1})`;
    })
    .join("\n");
}

export function summarizeDiagnostics(
  issues: DiagnosticIssue[],
): Pick<DiagnosticCheckResult, "hasErrors" | "hasWarnings"> {
  return {
    hasErrors: issues.some((i) => i.severity === DiagnosticSeverity.ERROR),
    hasWarnings: issues.some((i) => i.severity === DiagnosticSeverity.WARNING),
  };
}

export function issuesNeedFixing(
  issues: DiagnosticIssue[],
  threshold: DiagnosticSeverity = DiagnosticSeverity.ERROR,
): boolean {
  switch (threshold) {
    case DiagnosticSeverity.ERROR:
      return issues.some((i) => i.severity === DiagnosticSeverity.ERROR);
    case DiagnosticSeverity.WARNING:
      return issues.some(
        (i) =>
          i.severity === DiagnosticSeverity.ERROR ||
          i.severity === DiagnosticSeverity.WARNING,
      );
    case DiagnosticSeverity.INFO:
      return issues.some(
        (i) =>
          i.severity === DiagnosticSeverity.ERROR ||
          i.severity === DiagnosticSeverity.WARNING ||
          i.severity === DiagnosticSeverity.INFO,
      );
    default:
      return issues.length > 0;
  }
}

export function diagnosticCodeToString(
  code: HostDiagnostic["code"],
): string | undefined {
  if (code === undefined || code === null) {
    return undefined;
  }
  if (typeof code === "object" && "value" in code) {
    return String(code.value);
  }
  return String(code);
}

export function toDiagnosticIssue(
  filePath: string,
  d: HostDiagnostic,
): DiagnosticIssue {
  return {
    filePath,
    message: d.message,
    line: d.range.start.line,
    character: d.range.start.character,
    endLine: d.range.end.line,
    endCharacter: d.range.end.character,
    severity: mapSeverity(d.severity),
    code: diagnosticCodeToString(d.code),
    source: d.source,
  };
}

export function toFixPromptIssues(
  issues: DiagnosticIssue[],
): DiagnosticFixPromptIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    line: issue.line + 1,
    severity: issue.severity,
    source: issue.source,
  }));
}

export function languageFromFilePath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1) : "";
  return LANGUAGE_BY_EXT[ext] || ext;
}

export function buildFixPrompt(params: {
  filePath: string;
  content: string;
  issues: DiagnosticFixPromptIssue[];
}): string {
  const language = languageFromFilePath(params.filePath);
  const issueList = params.issues
    .map(
      (issue, i) =>
        `  ${i + 1}. Line ${issue.line} [${issue.severity}]: ${issue.message}${issue.source ? ` (${issue.source})` : ""}`,
    )
    .join("\n");
  return [
    `Fix the following ${language} code diagnostics. Return ONLY the complete fixed file content with no explanation, no markdown fences, no extra text.`,
    ``,
    `File: ${params.filePath}`,
    `Diagnostics to fix:`,
    issueList,
    ``,
    `Current file content:`,
    params.content,
  ].join("\n");
}

/**
 * Strip markdown fences and reject completions that are far shorter than
 * the original file (likely a hallucinated explanation instead of code).
 * Empty / invalid completions return the original content so the adapter
 * can no-op write rather than blank the file.
 */
export function sanitizeLlmFixOutput(
  completion: unknown,
  originalContent: string,
): { fixedContent: string; skipped: boolean } {
  if (!completion || typeof completion !== "string") {
    return { fixedContent: originalContent, skipped: true };
  }
  let fixedContent = completion.trim();
  const fenceMatch = fixedContent.match(/^```[\w]*\n([\s\S]*?)```$/);
  if (fenceMatch) {
    fixedContent = fenceMatch[1].trim();
  }
  const originalLines = originalContent.split("\n").length;
  const fixedLines = fixedContent.split("\n").length;
  if (fixedLines < originalLines * MIN_FIX_LINE_RATIO) {
    return { fixedContent: originalContent, skipped: true };
  }
  return { fixedContent, skipped: false };
}

export function computeFixedIssues(
  initial: DiagnosticIssue[],
  remaining: DiagnosticIssue[],
): DiagnosticIssue[] {
  return initial.filter(
    (first) =>
      !remaining.some(
        (later) => later.line === first.line && later.message === first.message,
      ),
  );
}

export function isDiagnosticFixSuccess(remaining: DiagnosticIssue[]): boolean {
  return (
    remaining.length === 0 ||
    !remaining.some((issue) => issue.severity === DiagnosticSeverity.ERROR)
  );
}

function uriLikeToString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "fsPath" in value &&
    typeof (value as { toString?: unknown }).toString === "function"
  ) {
    const s = (value as { toString: () => string }).toString();
    if (s.length > 0) {
      return s;
    }
  }
  return undefined;
}

/**
 * Resolve the file for `knox.checkDiagnostics` / `knox.fixDiagnostics`.
 * Accepts a vscode.Uri, a URI string, `{ uri }`, or falls back to the
 * active editor URI.
 */
export function resolveDiagnosticUri(
  arg: unknown,
  activeUri?: string,
): string | undefined {
  const direct = uriLikeToString(arg);
  if (direct) {
    return direct;
  }
  if (arg && typeof arg === "object" && "uri" in arg) {
    const nested = uriLikeToString((arg as { uri: unknown }).uri);
    if (nested) {
      return nested;
    }
  }
  return activeUri && activeUri.length > 0 ? activeUri : undefined;
}

export function resolveFixDiagnosticsArgs(
  arg: unknown,
  fallbacks: { uri?: string; selectedModelTitle?: string } = {},
): { uri?: string; selectedModelTitle: string } {
  const uri = resolveDiagnosticUri(arg, fallbacks.uri);
  let selectedModelTitle = fallbacks.selectedModelTitle ?? "default";
  if (arg && typeof arg === "object" && "selectedModelTitle" in arg) {
    const title = (arg as { selectedModelTitle?: unknown }).selectedModelTitle;
    if (typeof title === "string" && title.length > 0) {
      selectedModelTitle = title;
    }
  }
  return { uri, selectedModelTitle };
}

export class DiagnosticCache {
  private readonly store = new Map<
    string,
    { issues: DiagnosticIssue[]; expiresAt: number }
  >();

  constructor(
    private readonly ttlMs: number = DIAGNOSTIC_CACHE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(uri: string): DiagnosticIssue[] | undefined {
    const hit = this.store.get(uri);
    if (!hit) {
      return undefined;
    }
    if (this.now() >= hit.expiresAt) {
      this.store.delete(uri);
      return undefined;
    }
    return hit.issues;
  }

  set(uri: string, issues: DiagnosticIssue[]): void {
    this.store.set(uri, { issues, expiresAt: this.now() + this.ttlMs });
  }

  delete(uri: string): void {
    this.store.delete(uri);
  }

  clear(): void {
    this.store.clear();
  }
}

export class FixAttemptTracker {
  private readonly processing = new Set<string>();
  private readonly counts = new Map<string, number>();

  constructor(private readonly maxAttempts: number = MAX_FIX_ATTEMPTS) {}

  isProcessing(uri: string): boolean {
    return this.processing.has(uri);
  }

  /** Returns false if this file is already in a fix pass (reentry). */
  begin(uri: string): boolean {
    if (this.processing.has(uri)) {
      return false;
    }
    this.processing.add(uri);
    return true;
  }

  end(uri: string): void {
    this.processing.delete(uri);
  }

  increment(uri: string): number {
    const next = (this.counts.get(uri) || 0) + 1;
    this.counts.set(uri, next);
    return next;
  }

  getCount(uri: string): number {
    return this.counts.get(uri) || 0;
  }

  hasReachedMax(uri: string): boolean {
    return this.getCount(uri) >= this.maxAttempts;
  }

  reset(uri: string): void {
    this.counts.delete(uri);
  }

  clear(): void {
    this.processing.clear();
    this.counts.clear();
  }
}
