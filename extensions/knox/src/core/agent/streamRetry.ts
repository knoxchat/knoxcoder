/**
 * Loop-level resilience for model streams (K-011).
 *
 * A stream that fails with a transient error (network drop, 429, 5xx,
 * overloaded) is retried with backoff. Partial output from the failed attempt
 * is always discarded and the whole round is requested again: a half-streamed
 * tool call can never be executed.
 */

export interface StreamRetryOptions {
  /** Total attempts per round, including the first. Default 4. */
  maxAttempts?: number;
  /** First backoff delay. Default 1000 ms. */
  baseDelayMs?: number;
  /** Upper bound for any single wait (also caps `Retry-After`). Default 30 s. */
  maxDelayMs?: number;
  /** Attempts that fail on the primary model before `fallback` is used. Default 2. */
  fallbackAfter?: number;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface StreamRetryEvent {
  /** 1-based number of the attempt that is about to run. */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
  /** True when the next attempt uses the fallback model. */
  usingFallback: boolean;
  /** True when the failed attempt already streamed something to the UI. */
  discardedPartial: boolean;
}

export const DEFAULT_STREAM_RETRY: Required<
  Omit<StreamRetryOptions, "sleep">
> = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  fallbackAfter: 2,
};

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown; headers?: unknown };
  cause?: unknown;
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const TRANSIENT_MESSAGE =
  /\b(?:429|500|502|503|504|520|521|522|523|524|529)\b|rate.?limit|too many requests|overloaded|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|socket hang up|network error|fetch failed|terminated|stream (?:ended|closed|interrupted)|unexpected end|premature close|connection (?:reset|closed|lost)|ECONNRESET|ETIMEDOUT/i;

const PERMANENT_MESSAGE =
  /\b(?:400|401|402|403|404|413|422)\b|invalid api key|unauthorized|forbidden|insufficient (?:quota|credit)|context length|maximum context|model.{0,20}not found|content policy/i;

function statusOf(error: unknown): number | undefined {
  const e = error as ErrorLike;
  for (const v of [e?.response?.status, e?.status, e?.statusCode]) {
    if (typeof v === "number") {
      return v;
    }
  }
  return undefined;
}

/** True for failures that are worth retrying. Aborts and 4xx (except 408/429) are not. */
export function isTransientStreamError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const e = error as ErrorLike;
  if ((error as { name?: string }).name === "AbortError") {
    return false;
  }
  const status = statusOf(error);
  if (status !== undefined) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) {
    return true;
  }
  if (e.cause && e.cause !== error && isTransientStreamError(e.cause)) {
    return true;
  }
  const message =
    typeof e.message === "string" ? e.message : String(error ?? "");
  // Keep the permanent check to the HTTP status line so a stray number in a
  // long body cannot veto a real 5xx.
  const head = message.slice(0, 200);
  if (/^HTTP (\d{3})/.test(head)) {
    const code = Number(/^HTTP (\d{3})/.exec(head)![1]);
    return code === 408 || code === 425 || code === 429 || code >= 500;
  }
  if (PERMANENT_MESSAGE.test(head)) {
    return false;
  }
  return TRANSIENT_MESSAGE.test(message.slice(0, 400));
}

/** Parse a `Retry-After` value (seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Server-requested wait from the error, when it supplies one. */
export function retryAfterMsFromError(error: unknown): number | undefined {
  const e = error as ErrorLike;
  const headers = e?.response?.headers as
    | { get?: (name: string) => string | null }
    | undefined;
  if (headers && typeof headers.get === "function") {
    const fromHeader = parseRetryAfterMs(headers.get("retry-after"));
    if (fromHeader !== undefined) {
      return fromHeader;
    }
  }
  const message = typeof e?.message === "string" ? e.message : "";
  const m = /retry[- ]after[":=\s]+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds)?/i.exec(
    message,
  );
  if (m) {
    const n = Number(m[1]);
    return m[2]?.toLowerCase() === "ms" ? n : Math.round(n * 1000);
  }
  return undefined;
}

/** Delay before retry number `failures` (1-based), honoring `Retry-After`. */
export function computeRetryDelayMs(
  failures: number,
  error: unknown,
  opts: Pick<Required<StreamRetryOptions>, "baseDelayMs" | "maxDelayMs">,
): number {
  const server = retryAfterMsFromError(error);
  const backoff = opts.baseDelayMs * 2 ** Math.max(0, failures - 1);
  return Math.min(opts.maxDelayMs, Math.max(server ?? 0, backoff));
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function resolveStreamRetry(
  raw: StreamRetryOptions | false | undefined,
): (Required<Omit<StreamRetryOptions, "sleep">> & {
  sleep: NonNullable<StreamRetryOptions["sleep"]>;
}) | null {
  if (raw === false) {
    return null;
  }
  const r = raw ?? {};
  const int = (v: number | undefined, d: number, min: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : d;
  return {
    maxAttempts: int(r.maxAttempts, DEFAULT_STREAM_RETRY.maxAttempts, 1),
    baseDelayMs: int(r.baseDelayMs, DEFAULT_STREAM_RETRY.baseDelayMs, 0),
    maxDelayMs: int(r.maxDelayMs, DEFAULT_STREAM_RETRY.maxDelayMs, 0),
    fallbackAfter: int(r.fallbackAfter, DEFAULT_STREAM_RETRY.fallbackAfter, 1),
    sleep: r.sleep ?? defaultSleep,
  };
}
