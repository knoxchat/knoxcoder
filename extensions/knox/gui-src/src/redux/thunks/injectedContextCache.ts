/**
 * Caches the system context block (memory context) injected at
 * the start of a chat turn, plus provenance items for the UI.
 *
 * Tool-call continuation rounds (streamResponseAfterToolCall) reconstruct
 * messages from session history, which never contains the injected system
 * message — without this cache the LLM silently loses the memory context
 * after the first tool round.
 */

export interface InjectedMemoryProvenance {
  id: number | null;
  kind: string;
  title: string;
  reason: string;
  category?: string;
  score?: number;
  pinned?: boolean;
  evidence?: string[];
}

let cached: {
  sessionId: string;
  content: string;
  items: InjectedMemoryProvenance[];
} | null = null;

let restoreNotice: { sessionId: string; content: string } | null = null;

export function setInjectedSystemContext(
  sessionId: string,
  content: string,
  items: InjectedMemoryProvenance[] = [],
): void {
  cached = { sessionId, content, items };
}

export function clearInjectedSystemContext(): void {
  cached = null;
}

export function setRestoreNotice(sessionId: string, content: string): void {
  restoreNotice = { sessionId, content };
}

export function getRestoreNotice(sessionId: string): string | null {
  return restoreNotice && restoreNotice.sessionId === sessionId
    ? restoreNotice.content
    : null;
}

export function clearRestoreNotice(): void {
  restoreNotice = null;
}

export function getInjectedSystemContext(sessionId: string): string | null {
  return cached && cached.sessionId === sessionId ? cached.content : null;
}

export function getInjectedMemoryItems(
  sessionId: string,
): InjectedMemoryProvenance[] {
  return cached && cached.sessionId === sessionId ? cached.items : [];
}

/**
 * Merge injected memory/plan context into the leading system message so
 * compileChatMessages preserves it (mid-list system msgs were historically dropped).
 */
export function mergeInjectIntoMessages<
  T extends { role: string; content: any },
>(messages: T[], injectedContent: string): T[] {
  if (!injectedContent.trim()) return messages;
  if (messages[0]?.role === "system") {
    const existing =
      typeof messages[0].content === "string"
        ? messages[0].content
        : Array.isArray(messages[0].content)
          ? messages[0].content
              .filter((p: any) => p?.type === "text")
              .map((p: any) => p.text)
              .join("\n")
          : String(messages[0].content ?? "");
    return [
      { ...messages[0], content: `${existing}\n\n${injectedContent}` },
      ...messages.slice(1),
    ] as T[];
  }
  return [
    { role: "system", content: injectedContent } as T,
    ...messages,
  ];
}
