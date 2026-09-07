/**
 * Enterprise-Grade Tool Call Error System
 *
 * Provides structured, typed errors for tool operations with:
 * - Error classification (retryable vs non-retryable)
 * - Error codes for programmatic handling
 * - Rich context for debugging
 * - Serialization support for IPC transport
 */

/**
 * Error codes for tool call failures
 */
export enum ToolCallErrorCode {
  // Input/Validation errors (non-retryable)
  INVALID_ARGUMENTS = "INVALID_ARGUMENTS",
  MISSING_REQUIRED_PARAM = "MISSING_REQUIRED_PARAM",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  INVALID_URI = "INVALID_URI",
  INVALID_FILE_PATH = "INVALID_FILE_PATH",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_ALREADY_EXISTS = "FILE_ALREADY_EXISTS",
  PERMISSION_DENIED = "PERMISSION_DENIED",

  // Runtime errors (potentially retryable)
  EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT",
  IDE_OPERATION_FAILED = "IDE_OPERATION_FAILED",
  NETWORK_ERROR = "NETWORK_ERROR",
  FILE_SYSTEM_ERROR = "FILE_SYSTEM_ERROR",
  ENCODING_ERROR = "ENCODING_ERROR",
  CONTENT_TOO_LARGE = "CONTENT_TOO_LARGE",

  // System errors
  INTERNAL_ERROR = "INTERNAL_ERROR",
  CONFIG_ERROR = "CONFIG_ERROR",
  RATE_LIMITED = "RATE_LIMITED",
  CIRCUIT_OPEN = "CIRCUIT_OPEN",
  CONCURRENCY_CONFLICT = "CONCURRENCY_CONFLICT",
  /** User/system cancelled an in-flight tool (non-retryable). */
  CANCELLED = "CANCELLED",

  // Parse errors
  ARGUMENT_PARSE_ERROR = "ARGUMENT_PARSE_ERROR",
  RESPONSE_PARSE_ERROR = "RESPONSE_PARSE_ERROR",
}

/**
 * Set of error codes that are safe to retry
 */
const RETRYABLE_ERROR_CODES = new Set<ToolCallErrorCode>([
  ToolCallErrorCode.EXECUTION_TIMEOUT,
  ToolCallErrorCode.IDE_OPERATION_FAILED,
  ToolCallErrorCode.NETWORK_ERROR,
  ToolCallErrorCode.FILE_SYSTEM_ERROR,
  ToolCallErrorCode.RATE_LIMITED,
  ToolCallErrorCode.ENCODING_ERROR,
]);

/**
 * Structured error for tool call failures
 */
export class ToolCallError extends Error {
  public readonly code: ToolCallErrorCode;
  public readonly toolName: string;
  public readonly retryable: boolean;
  public readonly context: Record<string, unknown>;
  public readonly timestamp: number;
  public readonly cause?: Error;

  constructor(params: {
    code: ToolCallErrorCode;
    message: string;
    toolName: string;
    retryable?: boolean;
    context?: Record<string, unknown>;
    cause?: Error;
  }) {
    super(params.message);
    this.name = "ToolCallError";
    this.code = params.code;
    this.toolName = params.toolName;
    this.retryable =
      params.retryable ?? RETRYABLE_ERROR_CODES.has(params.code);
    this.context = params.context ?? {};
    this.timestamp = Date.now();
    this.cause = params.cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ToolCallError);
    }
  }

  /**
   * Serialize for IPC transport (GUI ↔ Extension ↔ Core)
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      toolName: this.toolName,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause
        ? { message: this.cause.message, stack: this.cause.stack }
        : undefined,
    };
  }

  /**
   * Reconstruct from serialized form
   */
  static fromJSON(data: Record<string, any>): ToolCallError {
    return new ToolCallError({
      code: data.code as ToolCallErrorCode,
      message: data.message,
      toolName: data.toolName,
      retryable: data.retryable,
      context: data.context,
      cause: data.cause
        ? Object.assign(new Error(data.cause.message), {
            stack: data.cause.stack,
          })
        : undefined,
    });
  }

  /**
   * Create from an unknown error (wraps non-ToolCallError exceptions)
   */
  static from(
    error: unknown,
    toolName: string,
    defaults?: Partial<{
      code: ToolCallErrorCode;
      retryable: boolean;
      context: Record<string, unknown>;
    }>,
  ): ToolCallError {
    if (error instanceof ToolCallError) {
      return error;
    }

    const err = error instanceof Error ? error : new Error(String(error));

    // Classify known error patterns
    const { code, retryable } = classifyError(err, defaults);

    return new ToolCallError({
      code,
      message: err.message,
      toolName,
      retryable,
      context: defaults?.context ?? {},
      cause: err,
    });
  }
}

/**
 * Classify a generic error into a ToolCallErrorCode
 */
function classifyError(
  error: Error,
  defaults?: Partial<{ code: ToolCallErrorCode; retryable: boolean }>,
): { code: ToolCallErrorCode; retryable: boolean } {
  const msg = error.message.toLowerCase();

  // Cancellation (user abort / tools/cancel)
  if (
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("aborted") ||
    error.name === "AbortError"
  ) {
    return { code: ToolCallErrorCode.CANCELLED, retryable: false };
  }

  // File system errors
  if (msg.includes("enoent") || msg.includes("no such file")) {
    return { code: ToolCallErrorCode.FILE_NOT_FOUND, retryable: false };
  }
  if (msg.includes("eacces") || msg.includes("permission denied")) {
    return { code: ToolCallErrorCode.PERMISSION_DENIED, retryable: false };
  }
  if (msg.includes("eexist") || msg.includes("already exists")) {
    return { code: ToolCallErrorCode.FILE_ALREADY_EXISTS, retryable: false };
  }
  if (
    msg.includes("enospc") ||
    msg.includes("disk full") ||
    msg.includes("enomem")
  ) {
    return { code: ToolCallErrorCode.FILE_SYSTEM_ERROR, retryable: false };
  }

  // Network errors (retryable)
  if (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return { code: ToolCallErrorCode.NETWORK_ERROR, retryable: true };
  }

  // Timeout
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return { code: ToolCallErrorCode.EXECUTION_TIMEOUT, retryable: true };
  }

  // Rate limiting
  if (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("too many requests")
  ) {
    return { code: ToolCallErrorCode.RATE_LIMITED, retryable: true };
  }

  // IDE operation failures (often transient)
  if (
    msg.includes("disposed") ||
    msg.includes("editor") ||
    msg.includes("workspace")
  ) {
    return { code: ToolCallErrorCode.IDE_OPERATION_FAILED, retryable: true };
  }

  // JSON parsing
  if (msg.includes("json") || msg.includes("unexpected token")) {
    return { code: ToolCallErrorCode.ARGUMENT_PARSE_ERROR, retryable: false };
  }

  return {
    code: defaults?.code ?? ToolCallErrorCode.INTERNAL_ERROR,
    retryable: defaults?.retryable ?? false,
  };
}

/**
 * Argument validation helpers
 */
export function validateRequiredString(
  args: Record<string, any>,
  param: string,
  toolName: string,
): string {
  const value = args[param];
  if (value === undefined || value === null || typeof value !== "string") {
    throw new ToolCallError({
      code: ToolCallErrorCode.MISSING_REQUIRED_PARAM,
      message: `Missing or invalid required parameter: "${param}" (expected non-empty string)`,
      toolName,
      retryable: false,
      context: { param, receivedType: typeof value, receivedValue: value },
    });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolCallError({
      code: ToolCallErrorCode.INVALID_ARGUMENTS,
      message: `Parameter "${param}" cannot be empty`,
      toolName,
      retryable: false,
      context: { param },
    });
  }
  return trimmed;
}

export function validateOptionalNumber(
  args: Record<string, any>,
  param: string,
  toolName: string,
  opts?: { min?: number; max?: number; defaultValue?: number },
): number | undefined {
  const value = args[param];
  if (value === undefined || value === null) {
    return opts?.defaultValue;
  }
  const num =
    typeof value === "number" ? value : parseInt(String(value), 10);
  if (isNaN(num)) {
    throw new ToolCallError({
      code: ToolCallErrorCode.INVALID_ARGUMENTS,
      message: `Parameter "${param}" must be a valid number, got: ${value}`,
      toolName,
      retryable: false,
      context: { param, receivedValue: value },
    });
  }
  if (opts?.min !== undefined && num < opts.min) {
    throw new ToolCallError({
      code: ToolCallErrorCode.INVALID_ARGUMENTS,
      message: `Parameter "${param}" must be >= ${opts.min}, got: ${num}`,
      toolName,
      retryable: false,
      context: { param, receivedValue: num, min: opts.min },
    });
  }
  if (opts?.max !== undefined && num > opts.max) {
    throw new ToolCallError({
      code: ToolCallErrorCode.INVALID_ARGUMENTS,
      message: `Parameter "${param}" must be <= ${opts.max}, got: ${num}`,
      toolName,
      retryable: false,
      context: { param, receivedValue: num, max: opts.max },
    });
  }
  return num;
}
