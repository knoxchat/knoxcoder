import type { ChatHistoryItem, Session } from "../index.js";

/**
 * K-043: full-text search over stored sessions. The sessions are plain JSON files, so this reads
 * them one by one with hard limits (file size, matches, files) to keep a big history cheap.
 */

export interface SessionSearchHit {
  sessionId: string;
  snippet: string;
}

export const SESSION_SEARCH_MIN_QUERY = 2;
export const SESSION_SEARCH_MAX_HITS = 50;
/** Files above this are skipped: they are search-expensive and usually tool-output dumps. */
export const SESSION_SEARCH_MAX_FILE_BYTES = 8_000_000;
export const SESSION_SEARCH_SNIPPET_RADIUS = 48;

function messageText(item: ChatHistoryItem): string {
  const content = item.message?.content as unknown;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
      .join("\n");
  }
  return "";
}

/** The text around the first match, on one line, or undefined when the query is not in the session. */
export function searchSessionText(
  session: Pick<Session, "history">,
  query: string,
): string | undefined {
  const needle = query.trim().toLowerCase();
  if (needle.length < SESSION_SEARCH_MIN_QUERY) {
    return undefined;
  }
  for (const item of session.history ?? []) {
    // Tool output is skipped on purpose: it dominates size and matches would be noise.
    if (item.message?.role === "tool") {
      continue;
    }
    const text = messageText(item);
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0) {
      continue;
    }
    const start = Math.max(0, at - SESSION_SEARCH_SNIPPET_RADIUS);
    const end = Math.min(text.length, at + needle.length + SESSION_SEARCH_SNIPPET_RADIUS);
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
  }
  return undefined;
}

export function searchSessions(
  entries: Iterable<{ sessionId: string; read: () => Pick<Session, "history"> | undefined }>,
  query: string,
  maxHits = SESSION_SEARCH_MAX_HITS,
): SessionSearchHit[] {
  const hits: SessionSearchHit[] = [];
  for (const entry of entries) {
    let session: Pick<Session, "history"> | undefined;
    try {
      session = entry.read();
    } catch {
      continue;
    }
    const snippet = session ? searchSessionText(session, query) : undefined;
    if (snippet !== undefined) {
      hits.push({ sessionId: entry.sessionId, snippet });
      if (hits.length >= maxHits) {
        break;
      }
    }
  }
  return hits;
}
