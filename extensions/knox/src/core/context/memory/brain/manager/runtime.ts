/** LLM handle, active session, working memory, pin/mismatch. */

import { BrainStore } from "../BrainStore.js";
import { WorkingMemory } from "../WorkingMemory.js";
import type { WorkingMemoryState } from "../WorkingMemory.js";
import { PrefrontalCortex } from "../regions/PrefrontalCortex.js";
import type { ILLM } from "../../../../index.js";
import { brainRuntime } from "./state.js";
import { emit } from "./events.js";
import { invalidateMemoryCaches } from "./helpers.js";

/**
 * Set the LLM instance for LLM-enhanced memory features.
 * Called from the tool implementation which has access to extras.llm.
 */
export function setLlm(llm: ILLM): void {
  brainRuntime.llm = llm;
}

export function getLlm(): ILLM | null {
  return brainRuntime.llm;
}

export function getActiveSessionId(): string | null {
  return brainRuntime.activeSessionId;
}

/** Ingest editor/document text into M₁ sensory buffer (φ₁). */
export function ingestSensoryInput(content: string, sessionId?: string): void {
  const sid = sessionId ?? brainRuntime.activeSessionId;
  if (!sid || !content.trim()) return;
  void import("../regions/SensoryCortex.js").then(({ SensoryCortex }) => {
    const wm = getWorkingMemory();
    SensoryCortex.setFlushHandler(sid, (text) => {
      void import("../regions/Thalamus.js").then(({ Thalamus }) => {
        Thalamus.attend(wm, text, "user");
      });
    });
    SensoryCortex.ingest(sid, content);
  });
}

/**
 * Get or create the WorkingMemory instance.
 * Optionally restores persisted state from a previous session.
 */
export function getWorkingMemory(): WorkingMemory {
  if (!brainRuntime.workingMem) {
    brainRuntime.workingMem = new WorkingMemory();
  }
  return brainRuntime.workingMem;
}

/**
 * REL-06: flush M₂ when the session's topic shifts. No-op if a different
 * session's working memory is currently loaded.
 */
export async function onTopicShift(sessionId?: string): Promise<void> {
  if (
    sessionId &&
    brainRuntime.workingMemSessionId &&
    sessionId !== brainRuntime.workingMemSessionId
  ) {
    return;
  }
  getWorkingMemory().flushOnTopicShift();
  PrefrontalCortex.clearGoal(sessionId);
  if (sessionId) {
    const { closeOnTopicShift } = await import("../TaskContext.js");
    await closeOnTopicShift(sessionId);
  }
}

/**
 * Restore working memory state from a previous session.
 */
export async function restoreWorkingMemory(sessionId: string): Promise<void> {
  try {
    const db = await BrainStore.get();
    const row = await db.get(
      `SELECT value FROM brain_config WHERE key = ?`,
      `working_memory:${sessionId}`,
    );
    brainRuntime.workingMem = new WorkingMemory();
    brainRuntime.workingMemSessionId = sessionId;
    if (row?.value) {
      const state = JSON.parse(row.value as string) as WorkingMemoryState;
      brainRuntime.workingMem.restore(state);
    }
  } catch {
    brainRuntime.workingMem = new WorkingMemory();
    brainRuntime.workingMemSessionId = sessionId;
  }
}

/** Persist working memory for a session to brain_config (IMP-18). */
export async function persistWorkingMemory(sessionId: string): Promise<void> {
  if (brainRuntime.workingMemSessionId !== sessionId || !brainRuntime.workingMem) {
    return;
  }
  try {
    const state = brainRuntime.workingMem.serialize();
    const db = await BrainStore.get();
    await db.run(
      `INSERT OR REPLACE INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      `working_memory:${sessionId}`,
      JSON.stringify(state),
    );
  } catch {}
}

/**
 * Switch the in-memory working memory singleton to another session.
 * Persists outgoing state and restores incoming state from SQLite.
 */
export async function switchWorkingMemorySession(sessionId: string): Promise<void> {
  if (brainRuntime.workingMemSessionId === sessionId) {
    return;
  }
  if (brainRuntime.workingMemSessionId) {
    await persistWorkingMemory(brainRuntime.workingMemSessionId);
  }
  brainRuntime.workingMem = null;
  await restoreWorkingMemory(sessionId);
  PrefrontalCortex.switchSession(sessionId);
}

/**
 * Pin a semantic memory so it stays hot and is preferred during inject.
 */
export async function pinMemory(id: number): Promise<boolean> {
  const mem = await BrainStore.getSemanticById(id);
  if (!mem) return false;
  if (mem.tombstoned_at) {
    await BrainStore.restoreTombstoned("semantic", id, "hot");
  }
  await BrainStore.addTag("semantic", id, "pinned");
  await BrainStore.removeTag("semantic", id, "mismatch");
  const db = await BrainStore.get();
  await db.run(
    `UPDATE brain_semantic
     SET importance_score = MAX(importance_score, 0.95),
         tier = 'hot',
         last_accessed_at = datetime('now'),
         mismatch_until = NULL
     WHERE id = ?`,
    [id],
  );
  invalidateMemoryCaches();
  emit("tag:added", { id, tag: "pinned" });
  return true;
}

/**
 * Unpin a semantic memory (keeps the memory, removes pin privilege).
 */
/**
 * Pin a past session's summary and top semantic rows into the next inject
 * (working memory + pinned), without storing a new memory.
 */
export async function useSessionAsContext(
  sessionId: string,
): Promise<{ ok: boolean; pinned: number; workingMemory: number }> {
  const { getSessionHistoryFull } = await import("./episodic.js");
  const { pinMemories } = await import("./semantic.js");
  const history = await getSessionHistoryFull(sessionId, {
    episodicLimit: 0,
    semanticLimit: 8,
  });
  const semantic = history.semantic ?? [];
  const ids = semantic
    .map((mem) => Number(mem.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 8);
  if (ids.length) {
    await pinMemories(ids);
  }
  const wm = getWorkingMemory();
  let workingMemory = 0;
  const summary =
    typeof history.session?.summary === "string"
      ? history.session.summary.trim()
      : "";
  if (summary) {
    wm.add({
      id: `session-context:${sessionId}:summary`,
      content: summary,
      source: "user",
      relevance: 1,
      metadata: { sessionId, kind: "summary" },
    });
    workingMemory++;
  }
  for (const mem of semantic.slice(0, 5)) {
    const content = [mem.title, mem.content].filter(Boolean).join(": ").trim();
    if (!content) {
      continue;
    }
    wm.add({
      id: `session-context:${sessionId}:${mem.id}`,
      content,
      source: "semantic",
      relevance: 0.95,
      metadata: { sessionId, memoryId: mem.id },
    });
    workingMemory++;
  }
  const activeId = getActiveSessionId();
  if (activeId) {
    await persistWorkingMemory(activeId);
  }
  return { ok: true, pinned: ids.length, workingMemory };
}

export async function unpinMemory(id: number): Promise<boolean> {
  const mem = await BrainStore.getSemanticById(id);
  if (!mem) return false;
  await BrainStore.removeTag("semantic", id, "pinned");
  invalidateMemoryCaches();
  emit("tag:removed", { id, tag: "pinned" });
  return true;
}

/**
 * REL-14: mark a semantic memory as not relevant. Does not delete.
 * Demotes it for the session's current topic for MISMATCH_TTL_DAYS.
 */
export async function recordMismatch(id: number, sessionId?: string): Promise<boolean> {
  const mem = await BrainStore.getSemanticById(id);
  if (!mem) return false;
  const sid = sessionId ?? mem.source_session_id ?? undefined;
  const topic = sid ? await BrainStore.getLatestSessionTopic(sid) : null;
  const ok = await BrainStore.recordMismatch(id, topic?.id ?? mem.topic_id ?? null);
  if (ok) {
    invalidateMemoryCaches();
    emit("memory:mismatched", { id, topic_id: topic?.id ?? null });
  }
  return ok;
}
