import { createKnoxLogger } from "../util/knoxLog";
import { jevCanCallNetwork } from "./config";
import { JEV_DEFAULT_TIMEOUT_MS } from "./questions";
import type {
  JevAnswer,
  JevClient,
  JevQuestion,
  JevRuntime,
  JevSystemOneRequest,
  JevSystemOneResult,
} from "./types";

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

function parseAnswer(value: unknown, key: string): JevAnswer {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new JevClientError(`Jev answer "${key}" is missing a type`);
  }
  if (value.type === "noul") {
    if (typeof value.noul !== "number" || !Number.isFinite(value.noul)) {
      throw new JevClientError(`Jev answer "${key}" is missing noul`);
    }
    return { type: "noul", noul: value.noul };
  }
  if (value.type === "choice") {
    if (typeof value.choice !== "string" || !value.choice) {
      throw new JevClientError(`Jev answer "${key}" is missing choice`);
    }
    const confidence =
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? value.confidence
        : 0;
    const probabilities = isRecord(value.probabilities)
      ? Object.fromEntries(
          Object.entries(value.probabilities).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        )
      : undefined;
    return { type: "choice", choice: value.choice, confidence, probabilities };
  }
  if (value.type === "score") {
    if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
      throw new JevClientError(`Jev answer "${key}" is missing score`);
    }
    const confidence =
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? value.confidence
        : 0;
    return { type: "score", score: value.score, confidence };
  }
  throw new JevClientError(`Jev answer "${key}" has unknown type ${value.type}`);
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
  const { apiKey, baseUrl, model } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async systemOne(request, callOptions) {
      if (!apiKey) {
        throw new JevClientError("jev.apiKey is not set in config.yaml");
      }
      const questions = request.questions;
      if (!questions || Object.keys(questions).length === 0) {
        throw new JevClientError("Jev request has no questions");
      }
      const timeoutMs = callOptions?.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callOptions?.signal
        ? combineSignals([callOptions.signal, timeout])
        : timeout;
      const body: JevSystemOneRequest = {
        state: request.state,
        questions: request.questions as Record<string, JevQuestion>,
        model: request.model ?? model,
      };
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/v1/systemone`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          throw new JevClientError("Jev request timed out or was aborted");
        }
        throw new JevClientError(
          error instanceof Error ? error.message : String(error),
        );
      }
      const text = await response.text();
      if (!response.ok) {
        throw new JevClientError(
          `Jev HTTP ${response.status}: ${text.slice(0, 240)}`,
        );
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
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
  });
}
