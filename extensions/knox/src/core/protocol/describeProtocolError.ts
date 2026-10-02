import { ToolCallError } from "../tools/errors";
import { formatToolErrorForModel } from "../tools/errors";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

interface ErrorCause {
  name?: string;
  code?: string;
  message?: string;
}

/** Message types whose failures are tool results, never connection problems. */
function isToolMessageType(messageType: string | undefined): boolean {
  return typeof messageType === "string" && messageType.startsWith("tools/");
}

function looksLikeToolCallError(err: Error): boolean {
  if (err instanceof ToolCallError) {
    return true;
  }
  const rec = err as Error & { code?: unknown; toolName?: unknown };
  return err.name === "ToolCallError" && typeof rec.code === "string";
}

/**
 * The user/model-visible text for an error raised while handling a webview
 * request.
 *
 * Regression this guards: `ToolCallError.from()` keeps the original exception
 * as `cause`, and the host used to treat *any* error with a `cause` as a failed
 * HTTP request. Tool failures then reached the model as
 * `Request failed with "Error": … If you are having trouble setting up
 * KnoxStudio, see the troubleshooting guide`, which both hid the real reason
 * and sent the model chasing a setup problem. Tool errors now keep their code,
 * message, and recovery hint; connection wording is reserved for real
 * connection failures on non-tool requests.
 */
export function describeProtocolError(
  err: Error,
  messageType: string | undefined,
  t: Translate,
): string {
  if (looksLikeToolCallError(err)) {
    return formatToolErrorForModel(err as ToolCallError);
  }
  const base = err.message || String(err);
  if (isToolMessageType(messageType)) {
    return base;
  }
  const cause = (err as Error & { cause?: ErrorCause }).cause;
  if (!cause) {
    return base;
  }
  if (cause.name === "ConnectTimeoutError") {
    return t("connection.timeout");
  }
  if (cause.code === "ECONNREFUSED") {
    return t("connection.refused");
  }
  return t("connection.requestFailed", {
    name: cause.name ?? "Error",
    message: cause.message ?? base,
  });
}
