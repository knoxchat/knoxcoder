/**
 * Enterprise-Grade Tool Call Middleware
 *
 * Provides a composable middleware pipeline for tool calls with:
 * - Input validation and sanitization
 * - Retry with exponential backoff and jitter
 * - Timeout enforcement
 * - Circuit breaker pattern
 * - Structured logging
 * - Argument repair for malformed JSON
 * - Concurrency control (file write locking)
 * - Performance monitoring
 *
 * Post-edit diagnostic verification and undo snapshots are NOT in this
 * middleware: they need the VS Code host. Core `tools/call` invokes optional
 * `IDE.runPostEditVerification` / `captureMutatingToolBefore` /
 * `recordMutatingToolAfter` so GUI chat and agent mode share one path.
 */

import { ContextItem, Tool, ToolExtras } from "..";
import {
  ToolCallError,
  ToolCallErrorCode,
} from "./errors";
import {
  BuiltInToolNames,
  DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES,
  resolveViewSubdirectoryMaxFiles,
} from "./builtIn";
import {
  assertToolPolicyAllowed,
  type AgentToolPolicy,
} from "./toolPolicy";
import {
  parseBlockUntilMs,
  resolveAwaitTimeoutMs,
  TOOL_TIMEOUT_SLACK_MS,
} from "./shellJobs";

// ─── Retry Configuration ─────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (default: 500) */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  multiplier: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter: boolean;
  /** Only retry errors matching these codes. If empty, retries all retryable errors */
  retryableCodes?: ToolCallErrorCode[];
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  multiplier: 2,
  jitter: true,
};

// ─── Timeout Configuration ───────────────────────────────────────────────────

export interface TimeoutOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT: TimeoutOptions = {
  timeoutMs: 30_000,
};

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting to half-open the circuit (default: 60000) */
  resetTimeoutMs: number;
  /** Number of successes in half-open to close circuit (default: 2) */
  halfOpenSuccessThreshold: number;
}

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenSuccessThreshold: 2,
};

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  halfOpenSuccesses: number;
}

// ─── Middleware Options ──────────────────────────────────────────────────────

export interface ToolCallMiddlewareOptions {
  retry?: Partial<RetryOptions> | false;
  timeout?: Partial<TimeoutOptions> | false;
  circuitBreaker?: Partial<CircuitBreakerOptions> | false;
  validateArgs?: boolean;
  repairArgs?: boolean;
  logging?: boolean;
  /** User + project policy. Built-in sandbox still applies when omitted. */
  agentPolicy?: AgentToolPolicy | null;
  workspaceDirs?: string[];
  /** Settings default for `builtin_view_subdirectory` when the model omits maxFiles. */
  defaultMaxFiles?: number;
}

const DEFAULT_OPTIONS: Required<ToolCallMiddlewareOptions> = {
  retry: DEFAULT_RETRY,
  timeout: DEFAULT_TIMEOUT,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
  validateArgs: true,
  repairArgs: true,
  logging: true,
  agentPolicy: null,
  workspaceDirs: [],
  defaultMaxFiles: DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES,
};

// ─── File Write Lock ─────────────────────────────────────────────────────────

const fileWriteLocks = new Map<string, Promise<void>>();

/**
 * Acquire a write lock for a file path (prevents concurrent writes)
 */
async function acquireWriteLock(filePath: string): Promise<() => void> {
  // Wait for any existing write to complete
  while (fileWriteLocks.has(filePath)) {
    await fileWriteLocks.get(filePath);
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  fileWriteLocks.set(filePath, lockPromise);

  return () => {
    fileWriteLocks.delete(filePath);
    releaseLock!();
  };
}

// ─── Performance Metrics ─────────────────────────────────────────────────────

interface ToolMetrics {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  avgDurationMs: number;
  lastCallTime: number;
  circuitBreakerTrips: number;
}

const metricsStore = new Map<string, ToolMetrics>();

function getOrCreateMetrics(toolName: string): ToolMetrics {
  let metrics = metricsStore.get(toolName);
  if (!metrics) {
    metrics = {
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
      avgDurationMs: 0,
      lastCallTime: 0,
      circuitBreakerTrips: 0,
    };
    metricsStore.set(toolName, metrics);
  }
  return metrics;
}

/**
 * Get metrics for a specific tool or all tools
 */
export function getToolMetrics(
  toolName?: string,
): ToolMetrics | Map<string, ToolMetrics> {
  if (toolName) {
    return getOrCreateMetrics(toolName);
  }
  return new Map(metricsStore);
}

/**
 * Reset all metrics
 */
export function resetToolMetrics(): void {
  metricsStore.clear();
}

// ─── Circuit Breaker Store ───────────────────────────────────────────────────

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getOrCreateCircuitBreaker(
  toolName: string,
): CircuitBreakerState {
  let cb = circuitBreakers.get(toolName);
  if (!cb) {
    cb = {
      state: "closed",
      consecutiveFailures: 0,
      lastFailureTime: 0,
      halfOpenSuccesses: 0,
    };
    circuitBreakers.set(toolName, cb);
  }
  return cb;
}

/**
 * Reset circuit breaker for a tool
 */
export function resetCircuitBreaker(toolName: string): void {
  circuitBreakers.delete(toolName);
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  circuitBreakers.clear();
}

// ─── JSON Repair ─────────────────────────────────────────────────────────────

/**
 * Attempt to repair malformed JSON argument strings.
 * Handles common LLM output issues:
 * - Trailing commas
 * - Single quotes instead of double quotes
 * - Unquoted keys
 * - Missing closing braces
 * - Escaped newlines in strings
 * - Control characters
 */
export function repairJsonArgs(raw: string): Record<string, any> {
  if (!raw || typeof raw !== "string") {
    return {};
  }

  let str = raw.trim();

  // Strip markdown code fences if present
  if (str.startsWith("```")) {
    str = str.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Try direct parse first
  try {
    const result = JSON.parse(str);
    return typeof result === "object" && result !== null ? result : {};
  } catch {
    // Continue with repair
  }

  // Repair pass 1: handle common issues
  let repaired = str;

  // Remove control characters (except \n \r \t)
  repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  // Replace single quotes with double quotes (carefully)
  repaired = repaired.replace(
    /(?<=[\[{,:\s])'/g,
    '"',
  ).replace(
    /'(?=[,}\]:\s])/g,
    '"',
  );

  // Remove trailing commas
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");

  // Ensure keys are quoted
  repaired = repaired.replace(
    /(?<=[{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g,
    '"$1":',
  );

  // Fix missing closing brace
  const openBraces =
    (repaired.match(/{/g) || []).length -
    (repaired.match(/}/g) || []).length;
  if (openBraces > 0) {
    repaired += "}".repeat(openBraces);
  }

  // Fix missing closing bracket
  const openBrackets =
    (repaired.match(/\[/g) || []).length -
    (repaired.match(/]/g) || []).length;
  if (openBrackets > 0) {
    repaired += "]".repeat(openBrackets);
  }

  // Try parsing repaired string
  try {
    const result = JSON.parse(repaired);
    return typeof result === "object" && result !== null ? result : {};
  } catch {
    // Continue with more aggressive repair
  }

  // Repair pass 2: extract key-value pairs with regex
  return extractArgsFromString(str);
}

/**
 * Last-resort argument extraction from malformed strings.
 * Extracts key-value pairs using pattern matching.
 */
function extractArgsFromString(str: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Match "key": "value" patterns
  const stringPattern = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = stringPattern.exec(str)) !== null) {
    result[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  // Match "key": number patterns
  const numberPattern = /"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?)/g;
  while ((match = numberPattern.exec(str)) !== null) {
    if (!(match[1] in result)) {
      result[match[1]] = parseFloat(match[2]);
    }
  }

  // Match "key": true/false patterns
  const boolPattern = /"(\w+)"\s*:\s*(true|false)/gi;
  while ((match = boolPattern.exec(str)) !== null) {
    if (!(match[1] in result)) {
      result[match[1]] = match[2].toLowerCase() === "true";
    }
  }

  return result;
}

// ─── Argument Validation ─────────────────────────────────────────────────────

/**
 * Fallback required params when a Tool has no JSON Schema `required` array.
 * Prefer schema-driven validation via {@link getRequiredToolParams}.
 */
const TOOL_REQUIRED_PARAMS: Record<string, string[]> = {
  [BuiltInToolNames.ReadFile]: ["filepath"],
  [BuiltInToolNames.CreateNewFile]: ["filepath", "contents"],
  [BuiltInToolNames.ExactSearch]: ["query"],
  [BuiltInToolNames.RunTerminalCommand]: ["command"],
  [BuiltInToolNames.ViewSubdirectory]: ["directory_path"],
  [BuiltInToolNames.SearchWeb]: ["query"],
  [BuiltInToolNames.EnhancedSearch]: ["query"],
  [BuiltInToolNames.IntelligentChain]: ["description"],
  [BuiltInToolNames.Skill]: ["name"],
  [BuiltInToolNames.Lsp]: ["operation"],
  [BuiltInToolNames.Memory]: ["action"],
  [BuiltInToolNames.MemoryGraph]: ["action"],
  [BuiltInToolNames.MemorySessions]: ["action"],
  [BuiltInToolNames.MemoryManage]: ["action"],
  [BuiltInToolNames.MemoryLearn]: ["action"],
  [BuiltInToolNames.GenerateTests]: ["filepath"],
  [BuiltInToolNames.AskUser]: ["questions"],
  [BuiltInToolNames.GitCommit]: ["message"],
  [BuiltInToolNames.GitBlame]: ["filepath"],
  [BuiltInToolNames.GitBisect]: ["action"],
  [BuiltInToolNames.Plan]: ["action"],
  [BuiltInToolNames.PtyStart]: ["command"],
  [BuiltInToolNames.PtySend]: ["job_id"],
  [BuiltInToolNames.PtyRead]: ["job_id"],
  [BuiltInToolNames.Qemu]: ["action"],
  [BuiltInToolNames.Debug]: ["op"],
  [BuiltInToolNames.Kconfig]: ["op"],
};

/** Empty / null / undefined counts as missing (fail closed — no TODO placeholders). */
export function isMissingToolArg(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string" && value.trim() === "") {
    return true;
  }
  return false;
}

/**
 * Resolve required parameter names: Tool JSON Schema `required` first,
 * then the builtin fallback map. Empty = no validation for that tool.
 */
export function getRequiredToolParams(
  toolName: string,
  tool?: Tool,
): string[] {
  const fromSchema = tool?.function?.parameters?.required;
  if (Array.isArray(fromSchema) && fromSchema.length > 0) {
    return fromSchema.filter((p): p is string => typeof p === "string");
  }
  return TOOL_REQUIRED_PARAMS[toolName] ?? [];
}

/**
 * Validate tool arguments against schema / known required params.
 * Rejects missing or blank required strings — never fills placeholders.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, any>,
  tool?: Tool,
): void {
  const required = getRequiredToolParams(toolName, tool);
  if (required.length === 0) {
    return;
  }

  const missing = required.filter((param) => isMissingToolArg(args[param]));
  if (missing.length === 0) {
    return;
  }

  throw new ToolCallError({
    code: ToolCallErrorCode.MISSING_REQUIRED_PARAM,
    message:
      `Incomplete tool call for "${toolName}": missing required parameter(s) ` +
      `${missing.join(", ")}. ` +
      `Re-issue the tool call with complete arguments; placeholders are not accepted.`,
    toolName,
    retryable: false,
    context: {
      requiredParams: required,
      missingParams: missing,
      receivedParams: Object.keys(args),
    },
  });
}

// ─── Tool-Specific Timeout Overrides ─────────────────────────────────────────

const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  [BuiltInToolNames.RunTerminalCommand]: 120_000, // Self-backgrounds before this
  [BuiltInToolNames.Build]: 120_000,
  [BuiltInToolNames.AwaitShell]: 600_000, // HL-14: 10 min per await slice
  [BuiltInToolNames.PtyStart]: 30_000,
  [BuiltInToolNames.PtySend]: 15_000,
  [BuiltInToolNames.PtyRead]: 30_000,
  [BuiltInToolNames.Qemu]: 30_000,
  [BuiltInToolNames.GitBisect]: 600_000,
  [BuiltInToolNames.SearchWeb]: 20_000,
  [BuiltInToolNames.Task]: 600_000, // HL-36: explore fan-out can run minutes
  [BuiltInToolNames.Debug]: 30_000,
};

// ─── Write Operation Detection ───────────────────────────────────────────────

const WRITE_TOOLS = new Set([
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.Build,
  BuiltInToolNames.PtyStart,
  BuiltInToolNames.PtySend,
  BuiltInToolNames.Qemu,
  BuiltInToolNames.Debug,
  BuiltInToolNames.GitBisect,
]);

function isWriteOperation(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName as BuiltInToolNames);
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function logToolCall(
  level: "info" | "warn" | "error",
  toolName: string,
  message: string,
  data?: Record<string, any>,
): void {
  const prefix = `[ToolCall:${toolName}]`;
  const payload = data ? ` ${JSON.stringify(data)}` : "";

  switch (level) {
    case "info":
      console.log(`${prefix} ${message}${payload}`);
      break;
    case "warn":
      console.warn(`${prefix} ${message}${payload}`);
      break;
    case "error":
      console.error(`${prefix} ${message}${payload}`);
      break;
  }
}

// ─── Sleep with Jitter ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoff(
  attempt: number,
  opts: RetryOptions,
): number {
  const exponentialDelay =
    opts.baseDelayMs * Math.pow(opts.multiplier, attempt - 1);
  const capped = Math.min(exponentialDelay, opts.maxDelayMs);

  if (opts.jitter) {
    // Full jitter: uniform random between 0 and capped delay
    return Math.random() * capped;
  }
  return capped;
}

// ─── Main Middleware ─────────────────────────────────────────────────────────

/**
 * Enterprise-grade tool call middleware.
 *
 * Wraps the raw tool execution function with:
 * 1. Argument parsing & repair
 * 2. Input validation
 * 3. Circuit breaker check
 * 4. Timeout enforcement
 * 5. Retry with exponential backoff + jitter
 * 6. File write locking
 * 7. Structured error handling
 * 8. Performance metrics
 * 9. Structured logging
 */
export async function executeToolWithMiddleware(
  executeFn: (
    tool: Tool,
    args: Record<string, any>,
    extras: ToolExtras,
  ) => Promise<ContextItem[]>,
  tool: Tool,
  rawArgs: any,
  extras: ToolExtras,
  options?: Partial<ToolCallMiddlewareOptions>,
): Promise<ContextItem[]> {
  const opts = mergeOptions(options);
  const toolName = tool.uri ?? tool.function.name;
  const metrics = getOrCreateMetrics(toolName);
  const startTime = Date.now();

  metrics.totalCalls++;
  metrics.lastCallTime = startTime;

  if (opts.logging) {
    logToolCall("info", toolName, "Starting tool call", {
      hasArgs: rawArgs !== undefined && rawArgs !== null,
    });
  }

  // ── Step 1: Parse & Repair Arguments ──────────────────────────────────
  let args: Record<string, any>;
  try {
    args = normalizeToolArgs(
      toolName,
      parseAndRepairArgs(rawArgs, toolName, opts.repairArgs as boolean),
      { defaultMaxFiles: opts.defaultMaxFiles },
    );
  } catch (error) {
    metrics.failureCount++;
    throw ToolCallError.from(error, toolName, {
      code: ToolCallErrorCode.ARGUMENT_PARSE_ERROR,
    });
  }

  // ── Step 2: Validate Arguments ────────────────────────────────────────
  if (opts.validateArgs) {
    try {
      validateToolArgs(toolName, args, tool);
    } catch (error) {
      metrics.failureCount++;
      throw error instanceof ToolCallError
        ? error
        : ToolCallError.from(error, toolName);
    }
  }

  // ── Step 2b: Path / command policy (deny is hard; ask is GUI-only) ──
  try {
    const workspaceDirs =
      options?.workspaceDirs ??
      (typeof extras.ide?.getWorkspaceDirs === "function"
        ? await extras.ide.getWorkspaceDirs().catch(() => [])
        : []);
    assertToolPolicyAllowed({
      toolName,
      args,
      policy: options?.agentPolicy,
      workspaceDirs,
    });
  } catch (error) {
    metrics.failureCount++;
    throw error instanceof ToolCallError
      ? error
      : ToolCallError.from(error, toolName, {
          code: ToolCallErrorCode.PERMISSION_DENIED,
        });
  }

  // ── Step 3: Circuit Breaker ───────────────────────────────────────────
  if (opts.circuitBreaker !== false) {
    const cbOpts = {
      ...DEFAULT_CIRCUIT_BREAKER,
      ...(typeof opts.circuitBreaker === "object" ? opts.circuitBreaker : {}),
    };
    checkCircuitBreaker(toolName, cbOpts);
  }

  // ── Step 4: Acquire Write Lock (if applicable) ────────────────────────
  let releaseWriteLock: (() => void) | undefined;
  if (isWriteOperation(toolName) && args.filepath) {
    releaseWriteLock = await acquireWriteLock(args.filepath);
  }

  // ── Step 5: Execute With Retry + Timeout ──────────────────────────────
  try {
    const retryOpts =
      opts.retry !== false
        ? { ...DEFAULT_RETRY, ...(typeof opts.retry === "object" ? opts.retry : {}) }
        : null;

    const timeoutMs = resolveToolTimeoutMs(toolName, opts.timeout, args);
    const abortSignal = extras.abortSignal;

    // Bail before side effects if the user already cancelled.
    throwIfAborted(abortSignal, toolName);

    const result = await executeWithRetry(
      () =>
        executeWithTimeout(
          () => executeFn(tool, args, extras),
          timeoutMs,
          toolName,
          abortSignal,
        ),
      retryOpts,
      toolName,
      metrics,
      opts.logging as boolean,
      1,
      abortSignal,
    );

    // ── Success ───────────────────────────────────────────────────────
    metrics.successCount++;
    const duration = Date.now() - startTime;
    updateAvgDuration(metrics, duration);

    if (opts.circuitBreaker !== false) {
      recordCircuitBreakerSuccess(toolName);
    }

    if (opts.logging) {
      logToolCall("info", toolName, "Tool call succeeded", {
        durationMs: duration,
        outputItems: result.length,
      });
    }

    return result;
  } catch (error) {
    // ── Failure ─────────────────────────────────────────────────────
    metrics.failureCount++;
    const duration = Date.now() - startTime;
    updateAvgDuration(metrics, duration);

    const toolError = ToolCallError.from(error, toolName);

    if (opts.circuitBreaker !== false) {
      const cbOpts = {
        ...DEFAULT_CIRCUIT_BREAKER,
        ...(typeof opts.circuitBreaker === "object" ? opts.circuitBreaker : {}),
      };
      recordCircuitBreakerFailure(toolName, cbOpts);
    }

    if (opts.logging) {
      logToolCall("error", toolName, "Tool call failed", {
        durationMs: duration,
        errorCode: toolError.code,
        errorMessage: toolError.message,
        retryable: toolError.retryable,
      });
    }

    throw toolError;
  } finally {
    if (releaseWriteLock) {
      releaseWriteLock();
    }
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function mergeOptions(
  partial?: Partial<ToolCallMiddlewareOptions>,
): Required<ToolCallMiddlewareOptions> {
  if (!partial) return DEFAULT_OPTIONS;

  return {
    retry:
      partial.retry === false
        ? false
        : partial.retry
          ? { ...DEFAULT_RETRY, ...partial.retry }
          : DEFAULT_OPTIONS.retry,
    timeout:
      partial.timeout === false
        ? false
        : partial.timeout
          ? { ...DEFAULT_TIMEOUT, ...partial.timeout }
          : DEFAULT_OPTIONS.timeout,
    circuitBreaker:
      partial.circuitBreaker === false
        ? false
        : partial.circuitBreaker
          ? { ...DEFAULT_CIRCUIT_BREAKER, ...partial.circuitBreaker }
          : DEFAULT_OPTIONS.circuitBreaker,
    validateArgs: partial.validateArgs ?? DEFAULT_OPTIONS.validateArgs,
    repairArgs: partial.repairArgs ?? DEFAULT_OPTIONS.repairArgs,
    logging: partial.logging ?? DEFAULT_OPTIONS.logging,
    agentPolicy: partial.agentPolicy ?? DEFAULT_OPTIONS.agentPolicy,
    workspaceDirs: partial.workspaceDirs ?? DEFAULT_OPTIONS.workspaceDirs,
    defaultMaxFiles:
      partial.defaultMaxFiles ?? DEFAULT_OPTIONS.defaultMaxFiles,
  };
}

/**
 * Map common LLM argument aliases onto the schema names the impls expect.
 * Does not invent values — only copies an existing alias when the canonical
 * key is missing.
 */
export function normalizeToolArgs(
  toolName: string,
  args: Record<string, any>,
  defaults?: { defaultMaxFiles?: number },
): Record<string, any> {
  const next = { ...args };

  const copyIfMissing = (canonical: string, aliases: string[]) => {
    if (!isMissingToolArg(next[canonical])) {
      return;
    }
    for (const alias of aliases) {
      if (!isMissingToolArg(next[alias])) {
        next[canonical] = next[alias];
        return;
      }
    }
  };

  switch (toolName) {
    case BuiltInToolNames.ReadFile:
    case BuiltInToolNames.CreateNewFile:
    case BuiltInToolNames.EditFile:
    case BuiltInToolNames.WriteFile:
    case BuiltInToolNames.GenerateTests:
      copyIfMissing("filepath", [
        "path",
        "file_path",
        "file",
        "filename",
        "target_file",
      ]);
      if (toolName === BuiltInToolNames.ReadFile) {
        copyIfMissing("startLine", [
          "start_line",
          "start",
          "from_line",
          "line",
        ]);
        copyIfMissing("endLine", ["end_line", "end", "to_line"]);
      }
      break;
    case BuiltInToolNames.ViewSubdirectory:
      copyIfMissing("directory_path", [
        "path",
        "directory",
        "dir",
        "directoryPath",
        "target_directory",
      ]);
      if (isMissingToolArg(next.maxFiles)) {
        next.maxFiles = resolveViewSubdirectoryMaxFiles(defaults?.defaultMaxFiles);
      }
      break;
    case BuiltInToolNames.Glob:
      copyIfMissing("pattern", ["glob", "glob_pattern", "query"]);
      copyIfMissing("target_directory", [
        "directory_path",
        "directory",
        "path",
      ]);
      break;
    case BuiltInToolNames.ExactSearch:
      copyIfMissing("query", ["pattern", "search", "regex"]);
      copyIfMissing("path", ["directory", "dir", "target_directory", "cwd"]);
      copyIfMissing("fileGlob", ["glob", "include", "include_glob"]);
      copyIfMissing("excludeGlob", ["exclude", "exclude_glob"]);
      copyIfMissing("maxResults", ["head_limit", "limit", "max"]);
      copyIfMissing("outputMode", ["output_mode"]);
      break;
    case BuiltInToolNames.RunTerminalCommand:
      copyIfMissing("command", ["cmd", "shell"]);
      copyIfMissing("working_directory", ["cwd", "directory", "path"]);
      break;
    case BuiltInToolNames.PtyStart:
      copyIfMissing("command", ["cmd", "shell"]);
      copyIfMissing("working_directory", ["cwd", "directory", "path"]);
      break;
    case BuiltInToolNames.PtySend:
    case BuiltInToolNames.PtyRead:
    case BuiltInToolNames.AwaitShell:
      copyIfMissing("job_id", ["jobId", "id"]);
      copyIfMissing("timeout_ms", ["timeout", "block_until_ms"]);
      copyIfMissing("since_byte", ["sinceByte", "offset"]);
      copyIfMissing("tail_lines", ["tailLines", "tail"]);
      break;
    case BuiltInToolNames.SearchWeb:
      copyIfMissing("query", ["q", "search", "prompt"]);
      break;
    default:
      break;
  }

  return next;
}

function parseAndRepairArgs(
  rawArgs: any,
  toolName: string,
  repair: boolean,
): Record<string, any> {
  // Already an object
  if (typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)) {
    return rawArgs;
  }

  // Undefined/null
  if (rawArgs === undefined || rawArgs === null) {
    return {};
  }

  // String - try to parse
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs || "{}");
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      if (repair) {
        const repaired = repairJsonArgs(rawArgs);
        if (Object.keys(repaired).length > 0) {
          logToolCall("warn", toolName, "Repaired malformed arguments", {
            originalLength: rawArgs.length,
            repairedKeys: Object.keys(repaired),
          });
          return repaired;
        }
      }
      throw new ToolCallError({
        code: ToolCallErrorCode.ARGUMENT_PARSE_ERROR,
        message: `Failed to parse tool arguments: ${rawArgs.substring(0, 200)}`,
        toolName,
        retryable: false,
        context: { rawArgs: rawArgs.substring(0, 500) },
      });
    }
  }

  return {};
}

function requestedToolWaitMs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): number | undefined {
  if (!args) {
    return undefined;
  }
  const raw = args.timeout_ms ?? args.timeout ?? args.block_until_ms;
  if (toolName === BuiltInToolNames.AwaitShell) {
    if (raw === undefined) {
      return resolveAwaitTimeoutMs();
    }
    return parseBlockUntilMs(raw);
  }
  if (toolName === BuiltInToolNames.PtyRead) {
    if (raw === undefined) {
      return 5_000;
    }
    return parseBlockUntilMs(raw);
  }
  if (toolName === BuiltInToolNames.Qemu) {
    if (raw === undefined) {
      return 5_000;
    }
    return parseBlockUntilMs(raw);
  }
  return undefined;
}

/**
 * Middleware timeout for a tool call. Long waits (`await_shell`, `pty_read`)
 * extend past the per-tool override so EXECUTION_TIMEOUT does not fire first.
 */
export function resolveToolTimeoutMs(
  toolName: string,
  timeoutConfig: Partial<TimeoutOptions> | false | undefined,
  args?: Record<string, unknown>,
): number {
  if (timeoutConfig === false) {
    return 0;
  }

  const override = TOOL_TIMEOUT_OVERRIDES[toolName];
  const base =
    override ??
    (typeof timeoutConfig === "object" ? timeoutConfig.timeoutMs : undefined) ??
    DEFAULT_TIMEOUT.timeoutMs;

  const requested = requestedToolWaitMs(toolName, args);
  if (requested === undefined || requested === 0) {
    return base;
  }
  return Math.max(base, requested + TOOL_TIMEOUT_SLACK_MS);
}

function throwIfAborted(abortSignal: AbortSignal | undefined, toolName: string): void {
  if (abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: `Tool "${toolName}" cancelled`,
      toolName,
      retryable: false,
    });
  }
}

async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  toolName: string,
  abortSignal?: AbortSignal,
): Promise<T> {
  throwIfAborted(abortSignal, toolName);

  if (timeoutMs <= 0 && !abortSignal) {
    return fn();
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const races: Promise<T>[] = [fn()];

  if (timeoutMs > 0) {
    races.push(
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new ToolCallError({
              code: ToolCallErrorCode.EXECUTION_TIMEOUT,
              message: `Tool "${toolName}" timed out after ${timeoutMs}ms`,
              toolName,
              retryable: true,
              context: { timeoutMs },
            }),
          );
        }, timeoutMs);
      }),
    );
  }

  let onAbort: (() => void) | undefined;
  if (abortSignal) {
    races.push(
      new Promise<never>((_, reject) => {
        onAbort = () => {
          reject(
            new ToolCallError({
              code: ToolCallErrorCode.CANCELLED,
              message: `Tool "${toolName}" cancelled`,
              toolName,
              retryable: false,
            }),
          );
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }),
    );
  }

  try {
    return await Promise.race(races);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (onAbort && abortSignal) {
      abortSignal.removeEventListener("abort", onAbort);
    }
  }
}

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retryOpts: RetryOptions | null,
  toolName: string,
  metrics: ToolMetrics,
  logging: boolean,
  attempt: number = 1,
  abortSignal?: AbortSignal,
): Promise<T> {
  throwIfAborted(abortSignal, toolName);

  try {
    return await fn();
  } catch (error) {
    if (!retryOpts || attempt > retryOpts.maxRetries) {
      throw error;
    }

    const toolError = ToolCallError.from(error, toolName);

    // Never retry cancellation or other non-retryable errors
    if (
      !toolError.retryable ||
      toolError.code === ToolCallErrorCode.CANCELLED
    ) {
      throw toolError;
    }

    // Check if error code matches retryable codes filter
    if (
      retryOpts.retryableCodes &&
      retryOpts.retryableCodes.length > 0 &&
      !retryOpts.retryableCodes.includes(toolError.code)
    ) {
      throw toolError;
    }

    throwIfAborted(abortSignal, toolName);

    const delay = calculateBackoff(attempt, retryOpts);
    metrics.retryCount++;

    if (logging) {
      logToolCall("warn", toolName, `Retrying (attempt ${attempt}/${retryOpts.maxRetries})`, {
        errorCode: toolError.code,
        delayMs: Math.round(delay),
      });
    }

    await sleep(delay);

    return executeWithRetry(
      fn,
      retryOpts,
      toolName,
      metrics,
      logging,
      attempt + 1,
      abortSignal,
    );
  }
}

function checkCircuitBreaker(
  toolName: string,
  opts: CircuitBreakerOptions,
): void {
  const cb = getOrCreateCircuitBreaker(toolName);

  switch (cb.state) {
    case "open": {
      const timeSinceLastFailure = Date.now() - cb.lastFailureTime;
      if (timeSinceLastFailure >= opts.resetTimeoutMs) {
        // Transition to half-open
        cb.state = "half-open";
        cb.halfOpenSuccesses = 0;
        logToolCall("info", toolName, "Circuit breaker transitioned to half-open");
      } else {
        throw new ToolCallError({
          code: ToolCallErrorCode.CIRCUIT_OPEN,
          message: `Circuit breaker is open for tool "${toolName}". Will retry in ${Math.round((opts.resetTimeoutMs - timeSinceLastFailure) / 1000)}s`,
          toolName,
          retryable: false,
          context: {
            consecutiveFailures: cb.consecutiveFailures,
            timeSinceLastFailure,
            resetTimeoutMs: opts.resetTimeoutMs,
          },
        });
      }
      break;
    }
    case "half-open":
      // Allow the call through — will be tracked by success/failure handlers
      break;
    case "closed":
      // Normal operation
      break;
  }
}

function recordCircuitBreakerSuccess(toolName: string): void {
  const cb = getOrCreateCircuitBreaker(toolName);
  cb.consecutiveFailures = 0;

  if (cb.state === "half-open") {
    cb.halfOpenSuccesses++;
    const opts = DEFAULT_CIRCUIT_BREAKER; // Use default for threshold
    if (cb.halfOpenSuccesses >= opts.halfOpenSuccessThreshold) {
      cb.state = "closed";
      logToolCall("info", toolName, "Circuit breaker closed (recovered)");
    }
  }
}

function recordCircuitBreakerFailure(
  toolName: string,
  opts: CircuitBreakerOptions,
): void {
  const cb = getOrCreateCircuitBreaker(toolName);
  cb.consecutiveFailures++;
  cb.lastFailureTime = Date.now();

  if (cb.state === "half-open") {
    cb.state = "open";
    const metrics = getOrCreateMetrics(toolName);
    metrics.circuitBreakerTrips++;
    logToolCall("warn", toolName, "Circuit breaker re-opened from half-open");
    return;
  }

  if (
    cb.state === "closed" &&
    cb.consecutiveFailures >= opts.failureThreshold
  ) {
    cb.state = "open";
    const metrics = getOrCreateMetrics(toolName);
    metrics.circuitBreakerTrips++;
    logToolCall(
      "warn",
      toolName,
      `Circuit breaker opened after ${cb.consecutiveFailures} consecutive failures`,
    );
  }
}

function updateAvgDuration(metrics: ToolMetrics, duration: number): void {
  if (metrics.totalCalls <= 1) {
    metrics.avgDurationMs = duration;
  } else {
    // Exponential moving average
    const alpha = 0.2;
    metrics.avgDurationMs =
      alpha * duration + (1 - alpha) * metrics.avgDurationMs;
  }
}
