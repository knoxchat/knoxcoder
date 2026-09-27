import { LOOPBACK_PORT } from "core/auth/knoxOAuth/constants";
import { CALLBACK_PATH } from "core/auth/knoxOAuth/loopback";

export const KNOX_URI_SCHEMES = ["knox", "knoxcoder"] as const;
export const KNOX_URI_AUTHORITIES = ["vscode.knox", "knoxchat.knoxchat"] as const;
export const KNOX_URI_OPEN_CHAT_COMMAND = "knox.openChat";

export type KnoxUriAction =
  | { type: "openChat" }
  | { type: "oauthCallback"; query: string }
  | { type: "ignore" };

export type KnoxUriHandlePlan =
  | { kind: "command"; command: string }
  | { kind: "fetch"; url: string }
  | { kind: "ignore" };

function normalizePath(path: string): string {
  if (!path || path === "/") {
    return "/";
  }
  return path.replace(/\/+$/, "") || "/";
}

/**
 * KN-356: `knox://…` and `knoxcoder://vscode.knox/…` (this fork's `urlProtocol`).
 * Chat paths focus the sidebar. OAuth `/callback` is forwarded to the
 * existing loopback listener so the registered redirect still completes.
 *
 * `vscode.window.registerUriHandler` delivers `knoxcoder://vscode.knox/…`.
 * `knox://chat`, `knox://open`, and `knox://callback` are parsed for the
 * same actions (custom-scheme / docs / tests).
 */
export function parseKnoxUri(uri: {
  scheme?: string;
  authority?: string;
  path: string;
  query: string;
}): KnoxUriAction {
  if (
    uri.scheme &&
    !(KNOX_URI_SCHEMES as readonly string[]).includes(uri.scheme)
  ) {
    return { type: "ignore" };
  }

  const authority = uri.authority ?? "";
  const path = normalizePath(uri.path);
  const query = uri.query.replace(/^\?/, "");

  if (authority === "chat" || authority === "open") {
    return { type: "openChat" };
  }
  if (authority === "callback") {
    return { type: "oauthCallback", query };
  }

  if (
    authority &&
    !(KNOX_URI_AUTHORITIES as readonly string[]).includes(authority)
  ) {
    return { type: "ignore" };
  }
  if (path === "/" || path === "/chat" || path === "/open") {
    return { type: "openChat" };
  }
  if (path === CALLBACK_PATH || path.endsWith(CALLBACK_PATH)) {
    return { type: "oauthCallback", query };
  }
  return { type: "ignore" };
}

export function knoxOAuthLoopbackCallbackUrl(query: string): string {
  const q = query.replace(/^\?/, "");
  return `http://127.0.0.1:${LOOPBACK_PORT}${CALLBACK_PATH}${q ? `?${q}` : ""}`;
}

export function knoxUriHandlePlan(action: KnoxUriAction): KnoxUriHandlePlan {
  if (action.type === "openChat") {
    return { kind: "command", command: KNOX_URI_OPEN_CHAT_COMMAND };
  }
  if (action.type === "oauthCallback") {
    return { kind: "fetch", url: knoxOAuthLoopbackCallbackUrl(action.query) };
  }
  return { kind: "ignore" };
}
