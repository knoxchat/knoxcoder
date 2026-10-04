/**
 * Persist and resume CLI chat sessions (`--continue` / `--resume`).
 * Files live in `~/.knoxcoder/sessions` (or `KNOX_GLOBAL_DIR`).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ChatMessage, Session } from "..";
import historyManager from "../util/history";
import { getSessionFilePath } from "../util/paths";

export function messagesFromSession(session: Session): ChatMessage[] {
  return session.history
    .map((item) => item.message)
    .filter((m): m is ChatMessage => Boolean(m) && m.role !== "system");
}

/** The shared loop omits the final no-tool assistant from `messages`; keep it for resume. */
export function withFinalAssistant(
  messages: ChatMessage[],
  summary: string,
): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return messages;
  }
  const content = summary.trim();
  if (!content) {
    return messages;
  }
  return [...messages, { role: "assistant", content }];
}

export function sessionFromMessages(opts: {
  existing?: Session;
  workspaceDir: string;
  task: string;
  messages: ChatMessage[];
}): Session {
  const titleSource = opts.existing?.title || opts.task;
  return {
    sessionId: opts.existing?.sessionId ?? randomUUID(),
    title: titleSource.replace(/\s+/g, " ").trim().slice(0, 80) || "CLI session",
    workspaceDirectory: path.resolve(opts.workspaceDir),
    history: opts.messages
      .filter((m) => m.role !== "system")
      .map((message) => ({ message, contextItems: [] })),
  };
}

export function loadCliSession(id: string): Session {
  const file = getSessionFilePath(id);
  if (!fs.existsSync(file)) {
    throw new Error(`session ${id} not found`);
  }
  return historyManager.load(id);
}

export function continueCliSession(workspaceDir: string): Session {
  const listed = historyManager.list({
    workspaceDirectory: path.resolve(workspaceDir),
  });
  if (!listed.length) {
    throw new Error("no previous session in this workspace");
  }
  return loadCliSession(listed[0].sessionId);
}

export function saveCliSession(session: Session): void {
  historyManager.save(session);
}
