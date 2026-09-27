/**
 * TaskContext — Explicit task identity (REL-13).
 *
 * Multi-turn work keeps a `task_id` until REL-01 new-task detection or a
 * topic shift. Continuation (`"continue"`) stays on the open task.
 * `"new question: …"` always closes the current task and opens a new one.
 */

import { BrainStore } from "./BrainStore.js";
import { detectIntent, type RetrievalIntent } from "./RetrievalQuery.js";
import type { BrainTask } from "./types.js";

const NEW_QUESTION_PREFIX =
  /^(?:new question|new task|different question)\s*:?\s*/i;

/** Tasks opened as new_task this turn — topic shift must not close them. */
const lastNewTaskBySession = new Map<string, string>();

export function isExplicitNewQuestion(message: string): boolean {
  return NEW_QUESTION_PREFIX.test(message.trim());
}

export function taskTitleFromMessage(message: string): string {
  const stripped = message.trim().replace(NEW_QUESTION_PREFIX, "").trim();
  const line = stripped.split(/\n/)[0]?.trim() || "untitled task";
  return line.slice(0, 80);
}

export function resolveTaskIntent(message: string, topicKeywords?: string): RetrievalIntent {
  if (isExplicitNewQuestion(message)) return "new_task";
  return detectIntent(message, topicKeywords);
}

/**
 * Open on the first substantial user turn; close+reopen on new-task;
 * keep the same row for continuation.
 */
export async function ensureTaskForTurn(
  sessionId: string | undefined,
  message: string,
  intent?: RetrievalIntent,
): Promise<BrainTask | null> {
  if (!sessionId) return null;
  try {
    const resolved = intent ?? resolveTaskIntent(message);
    const existing = await BrainStore.getOpenTask(sessionId);

    if (resolved === "continuation") {
      if (existing) return existing;
      return openFromMessage(sessionId, message);
    }

    if (existing) {
      await BrainStore.closeTask(existing.id);
    }
    const opened = await openFromMessage(sessionId, message);
    lastNewTaskBySession.set(sessionId, opened.id);
    return opened;
  } catch {
    // Session may not be tracked yet — task identity is best-effort.
    return BrainStore.getOpenTask(sessionId).catch(() => null);
  }
}

export async function getOpenTask(sessionId: string): Promise<BrainTask | null> {
  return BrainStore.getOpenTask(sessionId);
}

/**
 * Topic shift closes a stale task. If this turn already opened a new_task,
 * rebind its topic_id instead of closing it.
 */
export async function closeOnTopicShift(sessionId: string): Promise<void> {
  const open = await BrainStore.getOpenTask(sessionId);
  if (!open) return;
  if (lastNewTaskBySession.get(sessionId) === open.id) {
    const latest = await BrainStore.getLatestSessionTopic(sessionId);
    if (latest && open.topic_id !== latest.id) {
      await BrainStore.bindTaskTopic(open.id, latest.id);
    }
    return;
  }
  await BrainStore.closeTask(open.id);
}

export function resetTaskContext(): void {
  lastNewTaskBySession.clear();
}

async function openFromMessage(sessionId: string, message: string): Promise<BrainTask> {
  const topic = await BrainStore.getLatestSessionTopic(sessionId);
  return BrainStore.openTask({
    sessionId,
    title: taskTitleFromMessage(message),
    topicId: topic?.id ?? null,
  });
}
