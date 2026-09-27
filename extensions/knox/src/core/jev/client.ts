import { USER_AGENT } from "../auth/knoxOAuth/constants";
import { createKnoxLogger } from "../util/knoxLog";
import { confidenceFromProbabilities } from "./answers";
import {
  jevCanCallNetwork,
  normalizeJevBaseUrl,
  resolveJevApiKey,
} from "./config";
import { JEV_DEFAULT_BASE_URL, JEV_DEFAULT_TIMEOUT_MS, KNOX_KEYS_URL } from "./questions";
import type {
  JevAnswer,
  JevClient,
  JevQuestion,
  JevRuntime,
  JevSystemOneRequest,
  JevSystemOneResult,
} from "./types";

/** Match the TypeSafe JS SDK retry defaults, with a tighter cap so the harness stays fail-open-fast. */
const JEV_MAX_RETRIES = 2;
const JEV_BACKOFF_INITIAL_MS = 250;
const JEV_BACKOFF_MAX_MS = 2_000;
const JEV_BACKOFF_JITTER = 0.25;
const JEV_MAX_RETRY_AFTER_MS = 5_000;

const log = createKnoxLogger("jev");

export class JevClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevClientError";
  }
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const live = signals.filter(Boolean);
  if (live.length === 0) {
    return new AbortController().signal;
  }
  if (live.length === 1) {
    return live[0];
  }
  const any = (
    AbortSignal as typeof AbortSignal & {
      any?: (input: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof any === "function") {
    return any(live);
  }
  const controller = new AbortController();
  const onAbort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  for (const signal of live) {
    if (signal.aborted) {
      onAbort(signal);
      break;
    }
    signal.addEventListener("abort", () => onAbort(signal), { once: true });
  }
  return controller.signal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfidence(
  raw: unknown,
  probabilities?: Record<string, number>,
): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(1, Math.max(0, raw));
  }
  if (probabilities && Object.keys(probabilities).length > 0) {
    return confidenceFromProbabilities(probabilities);
  }
  return 0;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 529 || (status >= 500 && status <= 599);
}

function retryAfterMs(response: Response): number | undefined {
  const headerMs = response.headers.get("retry-after-ms");
  if (headerMs) {
    const parsed = Number(headerMs);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  const header = response.headers.get("retry-after");
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function backoffMs(attempt: number): number {
  const base = Math.min(
    JEV_BACKOFF_MAX_MS,
    JEV_BACKOFF_INITIAL_MS * 2 ** attempt,
  );
  const jitter = base * JEV_BACKOFF_JITTER * Math.random();
  return Math.max(0, base - jitter);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new JevClientError("Jev request timed out or was aborted"),
      );
    };
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseAnswer(value: unknown, key: string): JevAnswer {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new JevClientError(`Jev answer "${key}" is missing a type`);
  }
  if (value.type === "noul") {
    if (typeof value.noul !== "number" || !Number.isFinite(value.noul)) {
      throw new JevClientError(`Jev answer "${key}" is missing noul`);
    }
    return { type: "noul", noul: Math.min(1, Math.max(0, value.noul)) };
  }
  if (value.type === "choice") {
    if (typeof value.choice !== "string" || !value.choice) {
      throw new JevClientError(`Jev answer "${key}" is missing choice`);
    }
    const probabilities = isRecord(value.probabilities)
      ? Object.fromEntries(
          Object.entries(value.probabilities).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        )
      : undefined;
    const confidence = readConfidence(value.confidence, probabilities);
    return { type: "choice", choice: value.choice, confidence, probabilities };
  }
  if (value.type === "score") {
    if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
      throw new JevClientError(`Jev answer "${key}" is missing score`);
    }
    const probabilities = isRecord(value.probabilities)
      ? Object.fromEntries(
          Object.entries(value.probabilities).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        )
      : undefined;
    const confidence = readConfidence(value.confidence, probabilities);
    const legend = isRecord(value.legend)
      ? Object.fromEntries(
          Object.entries(value.legend).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : Array.isArray(value.legend)
        ? value.legend.filter((item): item is string => typeof item === "string")
        : undefined;
    return { type: "score", score: value.score, confidence, probabilities, legend };
  }
  throw new JevClientError(`Jev answer "${key}" has unknown type ${value.type}`);
}

function describeJevHttpError(status: number, text: string): string {
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
  const hint =
    status === 401
      ? "invalid or missing Knox API key"
      : status === 402
        ? "insufficient Knox credits"
        : status === 403
          ? `this key's model allowlist does not include jev-* (allow it on ${KNOX_KEYS_URL})`
          : status === 404
            ? "no Jev channel is available"
            : status === 429
              ? "rate limited"
              : status === 529
                ? "upstream overloaded"
                : undefined;
  if (hint) {
    return snippet
      ? `Jev HTTP ${status}: ${hint}. ${snippet}`
      : `Jev HTTP ${status}: ${hint}`;
  }
  return `Jev HTTP ${status}: ${snippet || "request failed"}`;
}

function parseResult(payload: unknown): JevSystemOneResult {
  if (!isRecord(payload)) {
    throw new JevClientError("Jev response is not a JSON object");
  }
  if (!isRecord(payload.answers)) {
    throw new JevClientError("Jev response is missing answers");
  }
  const answers: Record<string, JevAnswer> = {};
  for (const [key, value] of Object.entries(payload.answers)) {
    answers[key] = parseAnswer(value, key);
  }
  return {
    model: typeof payload.model === "string" ? payload.model : "",
    answers,
    usage: isRecord(payload.usage)
      ? {
          input_tokens:
            typeof payload.usage.input_tokens === "number"
              ? payload.usage.input_tokens
              : undefined,
          output_tokens:
            typeof payload.usage.output_tokens === "number"
              ? payload.usage.output_tokens
              : undefined,
        }
      : undefined,
  };
}

export function createHttpJevClient(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}): JevClient {
  const { apiKey, model } = options;
  const baseUrl = normalizeJevBaseUrl(JEV_DEFAULT_BASE_URL);
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async systemOne(request, callOptions) {
      if (!apiKey) {
        throw new JevClientError(
          "Jev API key is not set (add a knoxchat model key or jev.apiKey)",
        );
      }
      const questions = request.questions;
      if (!questions || Object.keys(questions).length === 0) {
        throw new JevClientError("Jev request has no questions");
      }
      const timeoutMs = callOptions?.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
      const userSignal = callOptions?.signal;
      const started = Date.now();
      const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));
      const attemptSignal = () => {
        const left = remaining();
        const timeout = AbortSignal.timeout(Math.max(50, left));
        return userSignal ? combineSignals([userSignal, timeout]) : timeout;
      };
      const body: JevSystemOneRequest = {
        state: request.state,
        questions: request.questions as Record<string, JevQuestion>,
        model: request.model ?? model,
      };
      const payloadJson = JSON.stringify(body);
      let lastError: JevClientError | undefined;
      for (let attempt = 0; attempt <= JEV_MAX_RETRIES; attempt++) {
        if (userSignal?.aborted) {
          throw new JevClientError(
            `Jev request timed out or was aborted (${timeoutMs}ms)`,
          );
        }
        if (remaining() < 50) {
          throw (
            lastError ??
            new JevClientError(
              `Jev request timed out or was aborted (${timeoutMs}ms)`,
            )
          );
        }
        const signal = attemptSignal();
        let response: Response;
        try {
          response = await doFetch(`${baseUrl}/v1/systemone`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "User-Agent": USER_AGENT,
            },
            body: payloadJson,
            signal,
          });
        } catch (error) {
          if (userSignal?.aborted || signal.aborted) {
            throw new JevClientError(
              `Jev request timed out or was aborted (${timeoutMs}ms)`,
            );
          }
          lastError = new JevClientError(
            error instanceof Error ? error.message : String(error),
          );
          if (attempt >= JEV_MAX_RETRIES) {
            throw lastError;
          }
          const wait = Math.min(backoffMs(attempt), remaining() - 50);
          if (wait < 0) {
            throw lastError;
          }
          await sleep(wait, userSignal);
          continue;
        }
        const text = await response.text();
        if (!response.ok) {
          lastError = new JevClientError(
            describeJevHttpError(response.status, text),
          );
          const retryable = shouldRetryStatus(response.status);
          if (!retryable || attempt >= JEV_MAX_RETRIES) {
            throw lastError;
          }
          const headerWait = retryAfterMs(response);
          const wait = Math.min(
            headerWait !== undefined && headerWait <= JEV_MAX_RETRY_AFTER_MS
              ? headerWait
              : backoffMs(attempt),
            remaining() - 50,
          );
          if (wait < 0) {
            throw lastError;
          }
          await sleep(wait, userSignal);
          continue;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          throw new JevClientError("Jev response is not valid JSON");
        }
        const result = parseResult(payload);
        log.debug(
          `systemOne model=${result.model || body.model} answers=${Object.keys(result.answers).length}`,
        );
        return result;
      }
      throw (
        lastError ??
        new JevClientError(
          `Jev request timed out or was aborted (${timeoutMs}ms)`,
        )
      );
    },
  };
}

let clientOverride: JevClient | undefined;

export function setJevClientForTests(client: JevClient | undefined): void {
  clientOverride = client;
}

export function getJevClientOverride(): JevClient | undefined {
  return clientOverride;
}

export function resolveJevClient(
  runtime: JevRuntime,
  client?: JevClient,
): JevClient | undefined {
  if (client) {
    return client;
  }
  if (clientOverride) {
    return clientOverride;
  }
  if (!jevCanCallNetwork(runtime)) {
    return undefined;
  }
  return createHttpJevClient({
    apiKey: resolveJevApiKey(runtime),
    baseUrl: runtime.baseUrl,
    model: runtime.model,
  });
}
