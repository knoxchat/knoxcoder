/**
 * Local shareable session links. There is no remote host: the URI points at a
 * Markdown transcript on disk (`/share` or Export as Markdown). Opening
 * `knoxcoder://vscode.knox/session/import?path=…` imports it into a new session.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const SESSION_SHARE_SCHEME = "knoxcoder";
export const SESSION_SHARE_AUTHORITY = "vscode.knox";
export const SESSION_SHARE_PATH = "/session/import";

/** Alternate `knox://session/import?path=` form used in docs and tests. */
export const SESSION_SHARE_KNOX_AUTHORITY = "session";
export const SESSION_SHARE_KNOX_PATH = "/import";

export function buildSessionShareUri(filePath: string): string {
  const abs = path.resolve(filePath);
  const query = new URLSearchParams({ path: abs }).toString();
  return `${SESSION_SHARE_SCHEME}://${SESSION_SHARE_AUTHORITY}${SESSION_SHARE_PATH}?${query}`;
}

export function filePathFromShareQuery(query: string): string | undefined {
  const params = new URLSearchParams(query.replace(/^\?/, ""));
  const raw = params.get("path")?.trim();
  if (!raw || raw.includes("\0")) {
    return undefined;
  }
  if (/^https?:\/\//i.test(raw)) {
    return undefined;
  }
  if (/^file:/i.test(raw)) {
    try {
      return fileURLToPath(raw);
    } catch {
      return undefined;
    }
  }
  return path.resolve(raw);
}

export function isSessionSharePath(pathName: string): boolean {
  const normalized = pathName.replace(/\/+$/, "") || "/";
  return (
    normalized === SESSION_SHARE_PATH ||
    normalized === SESSION_SHARE_KNOX_PATH ||
    normalized.endsWith(SESSION_SHARE_PATH)
  );
}
