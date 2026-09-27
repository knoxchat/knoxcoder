/**
 * KN-353: vscode-free debug-integration helpers.
 *
 * DebugIntegrationService is the vscode adapter (DAP events, breakpoints,
 * `knox.llmComplete`). Distinct from Agent `builtin_debug` (launch/attach/
 * step). `@debugger` paused-thread tracking lives in `debugTrackerLogic.ts`.
 */

import { LLM_COMPLETE_COMMAND } from "./diagnostics";

export { LLM_COMPLETE_COMMAND };

export const ANALYZE_DEBUG_SESSION_COMMAND = "knox.analyzeDebugSession";
export const SUGGEST_FIX_FOR_ERROR_COMMAND = "knox.suggestFixForError";
export const ADD_INTELLIGENT_BREAKPOINT_COMMAND = "knox.addIntelligentBreakpoint";

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

export interface DebugFrameSnapshot {
  id?: number;
  name: string;
  line: number;
  column: number;
  source?: {
    name?: string;
    path?: string;
  };
}

export interface DebugVariableSnapshot {
  value?: string;
  type?: string;
  variablesReference?: number;
}

export interface DebugBreakpointSnapshot {
  enabled: boolean;
  id?: string;
  location?: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
}

export interface DebugErrorSnapshot {
  name?: string;
  message: string;
  stack?: string;
}

export interface DebugSnapshot {
  callStack: DebugFrameSnapshot[];
  variables: Record<string, DebugVariableSnapshot | string>;
  breakpoints: DebugBreakpointSnapshot[];
  error?: DebugErrorSnapshot;
}

export interface BreakpointSuggestion {
  suggestedLines: number[];
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export function stringifyVariableValues(
  variables: Record<string, DebugVariableSnapshot | string | unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === "string") {
      out[name] = value;
    } else if (value && typeof value === "object" && "value" in value) {
      out[name] = String((value as { value: unknown }).value ?? "");
    } else if (value == null) {
      out[name] = "";
    } else {
      out[name] = String(value);
    }
  }
  return out;
}

export function serializeCallStack(
  frames: DebugFrameSnapshot[],
): DebugFrameSnapshot[] {
  return frames.map((frame) => ({
    name: frame.name,
    line: frame.line,
    column: frame.column,
    source: frame.source
      ? { name: frame.source.name, path: frame.source.path }
      : undefined,
  }));
}

export function buildDebugSnapshot(input: {
  callStack: DebugFrameSnapshot[];
  variables: Record<string, DebugVariableSnapshot | string | unknown>;
  breakpoints: DebugBreakpointSnapshot[];
  error?: DebugErrorSnapshot;
}): DebugSnapshot {
  return {
    callStack: serializeCallStack(input.callStack),
    variables: Object.fromEntries(
      Object.entries(input.variables).map(([name, value]) => {
        if (typeof value === "string") {
          return [name, value];
        }
        if (value && typeof value === "object") {
          const rec = value as DebugVariableSnapshot;
          return [
            name,
            {
              value: rec.value,
              type: rec.type,
              variablesReference: rec.variablesReference,
            },
          ];
        }
        return [name, String(value)];
      }),
    ),
    breakpoints: input.breakpoints.map((bp) => ({
      enabled: bp.enabled,
      id: bp.id,
      location: bp.location,
    })),
    error: input.error,
  };
}

export function parseJsonObject(
  text: string,
): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = (fence ? fence[1] : trimmed).trim();
  const tryParse = (raw: string): Record<string, unknown> | undefined => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };
  const direct = tryParse(candidate);
  if (direct) {
    return direct;
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(candidate.slice(start, end + 1));
  }
  return undefined;
}

function asSuggestedFixes(
  value: unknown,
): { filePath: string; change: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fixes: { filePath: string; change: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rec = entry as { filePath?: unknown; change?: unknown };
    if (typeof rec.filePath === "string" && typeof rec.change === "string") {
      fixes.push({ filePath: rec.filePath, change: rec.change });
    }
  }
  return fixes;
}

function asErrorAnalysis(
  value: unknown,
  fallback?: DebugErrorSnapshot,
): DebugAnalysisResult["errorAnalysis"] | undefined {
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.errorMessage === "string" || typeof rec.errorType === "string") {
      return {
        errorType: typeof rec.errorType === "string" ? rec.errorType : fallback?.name ?? "Error",
        errorMessage:
          typeof rec.errorMessage === "string"
            ? rec.errorMessage
            : fallback?.message ?? "",
        probableCause:
          typeof rec.probableCause === "string"
            ? rec.probableCause
            : "Could not determine cause",
        suggestedSolution:
          typeof rec.suggestedSolution === "string"
            ? rec.suggestedSolution
            : "Review the insights for more information",
      };
    }
  }
  if (fallback) {
    return {
      errorType: fallback.name ?? "Error",
      errorMessage: fallback.message,
      probableCause: "Unknown",
      suggestedSolution: "Review your code logic",
    };
  }
  return undefined;
}

export function fallbackAnalysis(opts: {
  insights: string;
  variables?: Record<string, DebugVariableSnapshot | string | unknown>;
  error?: DebugErrorSnapshot;
}): DebugAnalysisResult {
  return {
    insights: opts.insights,
    suggestedFixes: [],
    variableValues: stringifyVariableValues(opts.variables ?? {}),
    errorAnalysis: opts.error
      ? {
          errorType: opts.error.name ?? "Error",
          errorMessage: opts.error.message,
          probableCause: "Unknown",
          suggestedSolution: "Review your code logic",
        }
      : undefined,
  };
}

export function parseAnalysisResult(
  content: unknown,
  variables: Record<string, DebugVariableSnapshot | string | unknown> = {},
  error?: DebugErrorSnapshot,
): DebugAnalysisResult {
  const variableValues = stringifyVariableValues(variables);
  const text =
    typeof content === "string"
      ? content
      : content == null
        ? ""
        : JSON.stringify(content);

  if (!text.trim()) {
    return fallbackAnalysis({
      insights: error
        ? "Could not analyze the error"
        : "Could not analyze the debug session",
      variables,
      error,
    });
  }

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return fallbackAnalysis({ insights: text, variables, error });
  }

  const insights =
    typeof parsed.insights === "string" && parsed.insights.trim()
      ? parsed.insights
      : text;
  const result: DebugAnalysisResult = {
    insights,
    suggestedFixes: asSuggestedFixes(parsed.suggestedFixes),
    variableValues:
      parsed.variableValues &&
      typeof parsed.variableValues === "object" &&
      !Array.isArray(parsed.variableValues)
        ? stringifyVariableValues(
            parsed.variableValues as Record<string, unknown>,
          )
        : variableValues,
  };
  const errorAnalysis = asErrorAnalysis(parsed.errorAnalysis, error);
  if (errorAnalysis) {
    result.errorAnalysis = errorAnalysis;
  }
  return result;
}

export function parseBreakpointSuggestions(
  content: unknown,
): BreakpointSuggestion | undefined {
  const text =
    typeof content === "string"
      ? content
      : content == null
        ? ""
        : JSON.stringify(content);
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return undefined;
  }
  const linesRaw = parsed.suggestedLines;
  if (!Array.isArray(linesRaw)) {
    return undefined;
  }
  const suggestedLines = linesRaw
    .map((line) => Number(line))
    .filter((line) => Number.isInteger(line) && line >= 1);
  if (suggestedLines.length === 0) {
    return undefined;
  }
  return {
    suggestedLines,
    condition:
      typeof parsed.condition === "string" ? parsed.condition : undefined,
    hitCondition:
      typeof parsed.hitCondition === "string" ? parsed.hitCondition : undefined,
    logMessage:
      typeof parsed.logMessage === "string" ? parsed.logMessage : undefined,
  };
}

export function buildAnalyzeSessionPrompt(snapshot: DebugSnapshot): string {
  return [
    "Analyze this VS Code debug session. Respond with JSON only:",
    "{",
    '  "insights": string,',
    '  "suggestedFixes": [{ "filePath": string, "change": string }],',
    '  "variableValues": { [name: string]: string },',
    '  "errorAnalysis"?: { "errorType": string, "errorMessage": string, "probableCause": string, "suggestedSolution": string }',
    "}",
    "",
    "Session snapshot:",
    JSON.stringify(snapshot, null, 2),
  ].join("\n");
}

export function buildErrorAnalysisPrompt(input: {
  error: DebugErrorSnapshot;
  callStack: DebugFrameSnapshot[];
  variables: Record<string, DebugVariableSnapshot | string | unknown>;
}): string {
  return [
    "Analyze this runtime error in a paused debug session. Respond with JSON only:",
    "{",
    '  "insights": string,',
    '  "suggestedFixes": [{ "filePath": string, "change": string }],',
    '  "variableValues": { [name: string]: string },',
    '  "errorAnalysis": { "errorType": string, "errorMessage": string, "probableCause": string, "suggestedSolution": string }',
    "}",
    "",
    JSON.stringify(
      {
        error_message: input.error.message,
        error_stack: input.error.stack,
        error_name: input.error.name,
        call_stack: serializeCallStack(input.callStack),
        variables: input.variables,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function buildBreakpointSuggestionPrompt(input: {
  filePath: string;
  fileContent: string;
  language: string;
  existingLines: number[];
}): string {
  return [
    "Suggest useful debugger breakpoint lines for this file. Respond with JSON only:",
    "{",
    '  "suggestedLines": number[],',
    '  "condition"?: string,',
    '  "hitCondition"?: string,',
    '  "logMessage"?: string',
    "}",
    "Lines are 1-based. Do not repeat existing breakpoints. Prefer early-return, error paths, and loop heads.",
    "",
    JSON.stringify(
      {
        file_path: input.filePath,
        language: input.language,
        existing_breakpoints: input.existingLines,
        file_content: input.fileContent,
      },
      null,
      2,
    ),
  ].join("\n");
}

function uriLikeToString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "fsPath" in value &&
    typeof (value as { fsPath?: unknown }).fsPath === "string" &&
    (value as { fsPath: string }).fsPath.length > 0
  ) {
    return (value as { fsPath: string }).fsPath;
  }
  return undefined;
}

/**
 * Resolve the file for `knox.addIntelligentBreakpoint`.
 * Accepts a path string, `{ filePath }`, a vscode.Uri-like, or the active editor.
 */
export function resolveIntelligentBreakpointPath(
  arg: unknown,
  activePath?: string,
): string | undefined {
  const direct = uriLikeToString(arg);
  if (direct) {
    return direct;
  }
  if (arg && typeof arg === "object" && "filePath" in arg) {
    const nested = uriLikeToString((arg as { filePath: unknown }).filePath);
    if (nested) {
      return nested;
    }
  }
  return activePath && activePath.length > 0 ? activePath : undefined;
}

export function coerceDebugError(arg: unknown): DebugErrorSnapshot {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  if (typeof arg === "string" && arg.length > 0) {
    return { name: "Error", message: arg };
  }
  if (arg && typeof arg === "object") {
    const rec = arg as { name?: unknown; message?: unknown; stack?: unknown };
    const message =
      typeof rec.message === "string" && rec.message.length > 0
        ? rec.message
        : "Unknown error";
    return {
      name: typeof rec.name === "string" ? rec.name : "Error",
      message,
      stack: typeof rec.stack === "string" ? rec.stack : undefined,
    };
  }
  return { name: "Error", message: "Unknown error" };
}

export function resolveAnalyzeDebugArgs(
  arg: unknown,
  fallbackTitle = "default",
): { selectedModelTitle: string } {
  if (arg && typeof arg === "object" && "selectedModelTitle" in arg) {
    const title = (arg as { selectedModelTitle?: unknown }).selectedModelTitle;
    if (typeof title === "string" && title.length > 0) {
      return { selectedModelTitle: title };
    }
  }
  return { selectedModelTitle: fallbackTitle };
}
