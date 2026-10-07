/**
 * Import a Markdown transcript (from `/share` or the GUI "export as Markdown")
 * back into a session. Text only: tool calls and context items are not
 * restored, and secrets are redacted again on the way in.
 */

import { randomUUID } from "node:crypto";

import type { ChatHistoryItem, Session } from "../index.js";

import { redactSecrets } from "./redactSecrets.js";

export const TRANSCRIPT_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSCRIPT_MAX_MESSAGES = 2000;

const HEADING_RE = /^#{2,4}\s*_?\*?(User|Assistant|Human|AI)\*?_?\s*:?\s*$/i;

export interface ParsedTranscript {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  title: string;
  truncated: boolean;
}

function unquote(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const quoted = nonEmpty.length > 0 && nonEmpty.every((l) => /^>\s?/.test(l));
  return quoted ? lines.map((l) => l.replace(/^>\s?/, "")) : lines;
}

export function parseTranscriptMarkdown(text: string): ParsedTranscript | null {
  if (text.length > TRANSCRIPT_MAX_BYTES) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const messages: ParsedTranscript["messages"] = [];
  let role: "user" | "assistant" | undefined;
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    if (!role) {
      return;
    }
    const content = unquote(buf).join("\n").trim();
    if (content) {
      messages.push({ role, content });
    }
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*>?\s*```/.test(line)) {
      inFence = !inFence;
    }
    const m = !inFence ? HEADING_RE.exec(line.trim()) : null;
    if (m) {
      flush();
      role = /^(user|human)$/i.test(m[1]) ? "user" : "assistant";
      continue;
    }
    if (role) {
      buf.push(line);
    }
  }
  flush();

  if (!messages.length) {
    return null;
  }
  const truncated = messages.length > TRANSCRIPT_MAX_MESSAGES;
  const kept = truncated ? messages.slice(-TRANSCRIPT_MAX_MESSAGES) : messages;
  const firstUser = kept.find((m) => m.role === "user")?.content ?? "Imported session";
  const title = `Imported: ${firstUser.replace(/\s+/g, " ").slice(0, 60)}`;
  return { messages: kept, title, truncated };
}

export function transcriptToSession(
  parsed: ParsedTranscript,
  workspaceDirectory: string,
  sessionId: string = randomUUID(),
): Session {
  const history: ChatHistoryItem[] = parsed.messages.map((m) => ({
    message: { role: m.role, content: redactSecrets(m.content) },
    contextItems: [],
  }));
  return {
    sessionId,
    title: parsed.title,
    workspaceDirectory,
    history,
  };
}
