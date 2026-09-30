/**
 * Loopback HTTP listener for the OAuth redirect.
 *
 * Binds `127.0.0.1` on the requested port (KnoxChat defaults to 8733). Never
 * falls back to another port. The listener is dropped after one `/callback`
 * (success, deny, or state mismatch).
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

import { LOOPBACK_PORT } from "./constants";

export const CALLBACK_PATH = "/callback";
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export type LoopbackCallback = {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
};

export type LoopbackErrorKind =
  | "port_in_use"
  | "timeout"
  | "state_mismatch"
  | "cancelled"
  | "bind_failed";

export class LoopbackError extends Error {
  constructor(readonly kind: LoopbackErrorKind) {
    super(kind);
    this.name = "LoopbackError";
  }
}

export function isDenied(callback: LoopbackCallback): boolean {
  return callback.error === "access_denied";
}

const CALLBACK_CLOSE_SCRIPT = [
  "<script>",
  "(function(){",
  'try{history.replaceState({},document.title,"/callback");}catch(e){}',
  "function closeWindow(){",
  'try{window.open("","_self");}catch(e){}',
  "try{window.close();}catch(e){}",
  "}",
  "closeWindow();",
  'window.addEventListener("load",closeWindow);',
  "setTimeout(closeWindow,50);",
  "})();",
  "</script>",
].join("");

export function callbackPageHtml(opts: {
  lang: string;
  title: string;
  body: string;
}): string {
  const body = htmlEscape(opts.body);
  return `<!DOCTYPE html><html lang="${htmlEscape(opts.lang)}"><head><meta charset="utf-8"><title>${htmlEscape(opts.title)}</title>${CALLBACK_CLOSE_SCRIPT}</head><body><p>${body}</p></body></html>`;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function parseCallbackQuery(query: string): LoopbackCallback {
  const callback: LoopbackCallback = {};
  if (!query) {
    return callback;
  }
  for (const pair of query.split("&")) {
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf("=");
    const key = decodeQuery(eq === -1 ? pair : pair.slice(0, eq));
    const value = decodeQuery(eq === -1 ? "" : pair.slice(eq + 1));
    switch (key) {
      case "code":
        callback.code = value;
        break;
      case "state":
        callback.state = value;
        break;
      case "error":
        callback.error = value;
        break;
      case "error_description":
        callback.errorDescription = value;
        break;
      default:
        break;
    }
  }
  return callback;
}

export function parseCallbackTarget(target: string): LoopbackCallback | undefined {
  const withoutFragment = target.split("#")[0] ?? target;
  const q = withoutFragment.indexOf("?");
  const path = q === -1 ? withoutFragment : withoutFragment.slice(0, q);
  const query = q === -1 ? "" : withoutFragment.slice(q + 1);
  if (path !== CALLBACK_PATH) {
    return undefined;
  }
  return parseCallbackQuery(query);
}

function decodeQuery(input: string): string {
  try {
    return decodeURIComponent(input.replace(/\+/g, " "));
  } catch {
    return input;
  }
}

export type CallbackPageCopy = {
  lang: string;
  title: string;
  body: string;
};

export type WaitForCallbackOptions = {
  expectedState: string;
  signal: AbortSignal;
  timeoutMs?: number;
  /** Loopback TCP port. Defaults to KnoxChat `LOOPBACK_PORT` (8733). */
  port?: number;
  /**
   * When false, a missing `state` query param is accepted (OpenRouter PKCE
   * does not document CSRF state). A present but mismatched value still fails.
   * Defaults to true (KnoxStudio).
   */
  requireState?: boolean;
  page: CallbackPageCopy;
};

export async function waitForLoopbackCallback(
  options: WaitForCallbackOptions,
): Promise<LoopbackCallback> {
  if (options.signal.aborted) {
    throw new LoopbackError("cancelled");
  }
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS;
  const port = options.port ?? LOOPBACK_PORT;
  const server = await bindLoopback(port);
  const html = callbackPageHtml(options.page);

  return await new Promise<LoopbackCallback>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (err: LoopbackError | null, callback?: LoopbackCallback) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal.removeEventListener("abort", onAbort);
      const settle = () => {
        if (err) {
          reject(err);
        } else if (callback) {
          resolve(callback);
        } else {
          reject(new LoopbackError("bind_failed"));
        }
      };
      server.close(settle);
      const withConnections = server as http.Server & {
        closeAllConnections?: () => void;
      };
      withConnections.closeAllConnections?.();
    };

    const onAbort = () => finish(new LoopbackError("cancelled"));
    if (options.signal.aborted) {
      onAbort();
      return;
    }
    options.signal.addEventListener("abort", onAbort);

    timer = setTimeout(() => {
      finish(new LoopbackError("timeout"));
    }, timeoutMs);

    server.on("request", (req, res) => {
      const url = req.url ?? "/";
      const callback = parseCallbackTarget(url);
      if (!callback) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain");
        res.end("not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      if (callback.state !== undefined && callback.state !== options.expectedState) {
        finish(new LoopbackError("state_mismatch"));
        return;
      }
      if (callback.state === undefined && options.requireState !== false) {
        finish(new LoopbackError("state_mismatch"));
        return;
      }
      finish(null, callback);
    });

    server.on("error", () => {
      finish(new LoopbackError("bind_failed"));
    });
  });
}

function bindLoopback(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new LoopbackError("port_in_use"));
      } else {
        reject(new LoopbackError("bind_failed"));
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || addr.port !== port || addr.address !== "127.0.0.1") {
        server.close();
        reject(new LoopbackError("bind_failed"));
        return;
      }
      resolve(server);
    });
  });
}
