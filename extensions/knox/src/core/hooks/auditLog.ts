import type { HookAuditEntry } from "./hooks";

/**
 * K-023: in-process audit log of hook runs. Every runner built by
 * `getWorkspaceHookRunner` appends here; the host shows it in an output
 * channel (`knoxchat.showHooksLog`).
 */
export interface HookLogEntry extends HookAuditEntry {
  at: number;
}

const MAX_ENTRIES = 500;
const entries: HookLogEntry[] = [];
const listeners = new Set<(entry: HookLogEntry) => void>();

export function recordHookAudit(entry: HookAuditEntry): HookLogEntry {
  const full: HookLogEntry = { ...entry, at: Date.now() };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  for (const l of [...listeners]) {
    try {
      l(full);
    } catch {
      // a broken listener must not affect the agent
    }
  }
  return full;
}

export function getHookLogEntries(): readonly HookLogEntry[] {
  return entries;
}

export function clearHookLog(): void {
  entries.length = 0;
}

export function onHookLog(listener: (entry: HookLogEntry) => void): {
  dispose(): void;
} {
  listeners.add(listener);
  return { dispose: () => void listeners.delete(listener) };
}

export function formatHookLogEntry(e: HookLogEntry): string {
  const time = new Date(e.at).toISOString().slice(11, 19);
  const tool = e.toolName ? ` ${e.toolName}` : "";
  const detail = e.detail ? `: ${e.detail}` : "";
  return `${time} ${e.event}${tool} ${e.command} -> ${e.outcome} (${e.durationMs}ms)${detail}`;
}
