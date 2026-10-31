import { BrainManager } from "../memory/brain/BrainManager.js";
import { BrainStore } from "../memory/brain/BrainStore.js";
import { MemorySnapshot } from "../memory/brain/MemorySnapshot.js";
import { shouldVerifyTool } from "../../tools/postEditVerification.js";

import {
  CHECKPOINT_LEAF_RECIPE_CAP,
  CHECKPOINT_POINTER_KIND,
  checkpointPointerMetadata,
  formatCheckpointMetadataLeaf,
  mergeCheckpointIds,
  normalizeCheckpointPaths,
  normalizeCheckpointRecipeIds,
  parseCheckpointPointerLeaf,
} from "./checkpointPointer.js";
import { formatSoulEventContent } from "./extractToolFiles.js";
import type { SoulEvent } from "./types.js";

const lastSoulBySession = new Map<string, SoulEvent & { episodicId: number }>();
const soulHistoryBySession = new Map<
  string,
  Array<SoulEvent & { episodicId: number }>
>();
export const MAX_SOUL_HISTORY = 20;

function isDurableSoulEvent(event: SoulEvent): boolean {
  if (event.oracle) return true;
  if (event.kind === "build:pass" || event.kind === "build:fail" || event.kind === "qemu:panic" || event.kind === "user_correction") return true;
  if (event.kind === "checkpoint") return true;
  return Boolean(
    event.kind === "tool_success" &&
      event.toolName &&
      shouldVerifyTool(event.toolName) &&
      event.files.length > 0,
  );
}

/** Prefer mutating / oracle events when the in-memory ring overflows. */
export function trimSoulHistory<T extends SoulEvent & { episodicId: number }>(
  history: T[],
  cap = MAX_SOUL_HISTORY,
): T[] {
  if (history.length <= cap) return history;
  const durable = history.filter(isDurableSoulEvent);
  if (durable.length >= cap) return durable.slice(-cap);
  const rest = history.filter((event) => !isDurableSoulEvent(event));
  const mixed = [...rest.slice(-(cap - durable.length)), ...durable];
  mixed.sort((a, b) => a.episodicId - b.episodicId);
  return mixed;
}

export function getLastSoulEvent(
  sessionId: string,
): (SoulEvent & { episodicId: number }) | undefined {
  return lastSoulBySession.get(sessionId);
}

export function listSoulEvents(
  sessionId: string,
): Array<SoulEvent & { episodicId: number }> {
  return soulHistoryBySession.get(sessionId) ?? [];
}

/** Last workspace CP for this chat, unless the caller already named one. */
export function resolveLinkedWorkspaceCheckpointId(
  explicit?: string,
): string | undefined {
  if (explicit) {
    return explicit;
  }
  const sessionId = BrainManager.getActiveSessionId();
  if (!sessionId) {
    return undefined;
  }
  return getLastSoulEvent(sessionId)?.workspaceCheckpointId;
}

/**
 * Pin the world at compaction time: brain snapshot + last workspace CP.
 */
export async function pinCompactionSoul(input: {
  tokensSaved: number;
  originalMessageCount: number;
  compactedMessageCount: number;
  summaryText?: string;
  sessionId?: string;
}): Promise<number> {
  const sessionId =
    input.sessionId ?? BrainManager.getActiveSessionId() ?? undefined;
  if (!sessionId) {
    return 0;
  }

  const last = getLastSoulEvent(sessionId);
  const workspaceCheckpointId = last?.workspaceCheckpointId;
  let memoryCheckpointId: number | undefined;
  try {
    const checkpoint = await BrainManager.createCheckpoint(
      `compaction ${new Date().toISOString()}`,
      workspaceCheckpointId,
    );
    memoryCheckpointId = checkpoint.id;
  } catch {
    // Brain snapshot is best-effort; the episodic pin still records.
  }

  return recordSoulEvent({
    sessionId,
    kind: "compaction",
    files: last?.files ?? [],
    workspaceCheckpointId,
    memoryCheckpointId,
    ok: true,
    summary: [
      `Compacted chat ${input.originalMessageCount}→${input.compactedMessageCount} (saved ~${input.tokensSaved} tokens)`,
      input.summaryText ? input.summaryText.slice(0, 400) : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export async function autoStoreTask(input: {
  taskDescription: string;
  filesModified: string[];
  sessionSummary?: string;
  sessionId?: string;
}): Promise<void> {
  const sessionId = input.sessionId ?? BrainManager.getActiveSessionId() ?? undefined;
  const content = [
    `Task: ${input.taskDescription}`,
    input.filesModified.length > 0
      ? `Files: ${input.filesModified.join(", ")}`
      : "",
    input.sessionSummary || "",
  ]
    .filter(Boolean)
    .join("\n");

  await BrainManager.dispatch("store", {
    title: `Completed: ${input.taskDescription.substring(0, 100)}`,
    content,
    category: "summary",
    keywords: "task-completion",
    importance: 0.6,
    session_id: sessionId,
  });
  await BrainManager.dispatch("auto_extract", {
    text: content,
    session_id: sessionId,
  });
  if (input.filesModified.length > 0) {
    try {
      const { MemoryManager } = await import("../memory/MemoryManager.js");
      await MemoryManager.extractConvention(
        input.taskDescription,
        input.filesModified,
      );
    } catch {
      // Legacy convention extract is best-effort.
    }
  }
}

export interface MemoryRewindResult {
  rewound: boolean;
  memoryCheckpointId?: number;
  trimmedEpisodic: number;
  message: string;
}

/**
 * Pin a brain snapshot to a workspace file checkpoint so "restore files +
 * memory" can rewind knowledge, not only later episodic turns.
 */
export async function pinMemoryForWorkspaceCheckpoint(input: {
  workspaceCheckpointId: string;
  label?: string;
  sessionId?: string;
  files?: string[];
  recipeIds?: string[];
}): Promise<number | undefined> {
  if (!input.workspaceCheckpointId.trim()) {
    return undefined;
  }
  let memoryCheckpointId: number | undefined;
  try {
    if (BrainManager.isBrainOpen()) {
      const checkpoint = await BrainManager.pinForWorkspaceCheckpoint(
        input.workspaceCheckpointId,
        input.label ?? `workspace ${input.workspaceCheckpointId.slice(0, 8)}`,
      );
      memoryCheckpointId = checkpoint?.id;
    }
  } catch {
    // Brain snapshot is best-effort; the pointer leaf can still be indexed.
  }
  try {
    await indexWorkspaceCheckpointMetadata({
      workspaceCheckpointId: input.workspaceCheckpointId,
      memoryCheckpointId,
      label: input.label,
      sessionId: input.sessionId,
      files: input.files,
      recipeIds: input.recipeIds,
    });
  } catch {
    // Pointer leaf is best-effort; the file snapshot already exists.
  }
  return memoryCheckpointId;
}

async function lookupRecipeIdsForCheckpoint(workspaceCheckpointId: string): Promise<string[]> {
  try {
    if (!BrainManager.isBrainOpen()) return [];
    const db = await BrainStore.get();
    const rows = (await db.all(
      `SELECT DISTINCT recipe_id FROM brain_recipe_steps
       WHERE checkpoint_id = ? AND recipe_id != ''
       ORDER BY recipe_id LIMIT ?`,
      [workspaceCheckpointId, CHECKPOINT_LEAF_RECIPE_CAP],
    )) as Array<{ recipe_id?: string }>;
    return normalizeCheckpointRecipeIds(rows.map((row) => String(row.recipe_id ?? "")));
  } catch {
    return [];
  }
}

function checkpointSoulSummary(label: string | undefined, workspaceCheckpointId: string): string {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  return text || `workspace ${workspaceCheckpointId.slice(0, 8)}`;
}

/**
 * Upsert an episodic pointer leaf for a workspace checkpoint (MEM-38).
 * Fusion retrieves this row; inject is `checkpoint_id=…` only.
 */
export async function indexWorkspaceCheckpointMetadata(input: {
  workspaceCheckpointId: string;
  memoryCheckpointId?: number;
  label?: string;
  sessionId?: string;
  files?: string[];
  recipeIds?: string[];
}): Promise<number> {
  const workspaceCheckpointId = input.workspaceCheckpointId.trim();
  if (!workspaceCheckpointId) return 0;
  try {
    if (!BrainManager.isBrainOpen()) return 0;
  } catch {
    return 0;
  }

  const sessionId =
    input.sessionId?.trim() ||
    BrainManager.getActiveSessionId() ||
    `checkpoint:${workspaceCheckpointId}`;
  const lookedUpRecipes = input.recipeIds
    ? normalizeCheckpointRecipeIds(input.recipeIds)
    : await lookupRecipeIdsForCheckpoint(workspaceCheckpointId);
  const incomingFiles = normalizeCheckpointPaths(input.files);
  const existing = await BrainStore.findCheckpointPointerLeaf(workspaceCheckpointId);
  const existingParsed = existing
    ? parseCheckpointPointerLeaf(existing.content, existing.metadata)
    : undefined;
  const files = incomingFiles.length > 0 ? incomingFiles : existingParsed?.files ?? [];
  const recipeIds = mergeCheckpointIds(
    existingParsed?.recipeIds,
    lookedUpRecipes,
    CHECKPOINT_LEAF_RECIPE_CAP,
  );
  const label = checkpointSoulSummary(input.label ?? existingParsed?.label, workspaceCheckpointId);
  const memoryCheckpointId = input.memoryCheckpointId ?? existingParsed?.memoryCheckpointId;
  const content = formatCheckpointMetadataLeaf({
    workspaceCheckpointId,
    memoryCheckpointId,
    label,
    sessionId,
    files,
    recipeIds,
  });
  const metadata = checkpointPointerMetadata({
    workspaceCheckpointId,
    memoryCheckpointId,
    label,
    sessionId,
    files,
    recipeIds,
  });

  if (existing) {
    await BrainStore.updateEpisodicContent(existing.id, content, {
      metadata,
      tokenCount: Math.ceil(content.length / 4),
      importanceScore: 0.75,
    });
    const history = soulHistoryBySession.get(existing.session_id) ?? [];
    for (const event of history) {
      if (event.kind === "checkpoint" && event.workspaceCheckpointId === workspaceCheckpointId) {
        event.files = files;
        event.summary = label;
        event.memoryCheckpointId = memoryCheckpointId;
        event.metadata = { ...event.metadata, ...metadata };
      }
    }
    const last = lastSoulBySession.get(existing.session_id);
    if (last?.kind === "checkpoint" && last.workspaceCheckpointId === workspaceCheckpointId) {
      last.files = files;
      last.summary = label;
      last.memoryCheckpointId = memoryCheckpointId;
      last.metadata = { ...last.metadata, ...metadata };
    }
    return existing.id;
  }

  return recordSoulEvent({
    sessionId,
    kind: CHECKPOINT_POINTER_KIND,
    files,
    workspaceCheckpointId,
    memoryCheckpointId,
    ok: true,
    summary: label,
    metadata,
  });
}

export async function deleteMemoryPinsForWorkspaceCheckpoint(
  workspaceCheckpointId: string,
): Promise<void> {
  if (!workspaceCheckpointId.trim()) {
    return;
  }
  try {
    if (!BrainManager.isBrainOpen()) {
      return;
    }
    await BrainManager.deleteCheckpointsForWorkspaceId(workspaceCheckpointId);
  } catch {
    // Joint GC is best-effort; file delete already succeeded.
  }
}

/**
 * Explicit paired restore: rewind brain (if a linked CP exists) and drop
 * episodic turns recorded after the workspace checkpoint.
 */
export async function rewindMemoryForWorkspaceCheckpoint(input: {
  sessionId: string;
  workspaceCheckpointId: string;
  createdAt?: string;
}): Promise<MemoryRewindResult> {
  let memoryCheckpointId: number | undefined;
  let rollbackLine = "";
  try {
    let linked = await BrainManager.findCheckpointByWorkspaceId(
      input.workspaceCheckpointId,
    );
    if (!linked && input.createdAt) {
      linked = await BrainManager.findNearestCheckpointBefore(input.createdAt);
    }
    if (linked) {
      memoryCheckpointId = linked.id;
      const rollback = await BrainManager.rollbackCheckpoint(linked.id);
      rollbackLine = rollback.split("\n")[0] ?? "";
    }
  } catch (error) {
    rollbackLine = error instanceof Error ? error.message : String(error);
  }

  let trimmedEpisodic = 0;
  if (input.sessionId && input.createdAt) {
    try {
      trimmedEpisodic = await BrainManager.trimEpisodicAfter(
        input.sessionId,
        input.createdAt,
      );
    } catch {
      // Trim is best-effort; file restore already succeeded.
    }
  }

  try {
    BrainManager.getWorkingMemory().clear();
  } catch {
    // Working memory may not be constructed yet.
  }
  MemorySnapshot.invalidateAll();

  const parts = [
    rollbackLine ||
      (memoryCheckpointId
        ? `Rolled back memory checkpoint #${memoryCheckpointId}`
        : "No linked memory checkpoint; semantic memory left in place"),
    trimmedEpisodic > 0
      ? `Trimmed ${trimmedEpisodic} later episodic turn${
          trimmedEpisodic === 1 ? "" : "s"
        }`
      : "No later episodic turns to trim",
  ];

  return {
    rewound: Boolean(memoryCheckpointId) || trimmedEpisodic > 0,
    memoryCheckpointId,
    trimmedEpisodic,
    message: parts.filter(Boolean).join(". "),
  };
}

/**
 * Persist a durable agent event as episodic memory (and a task-completion
 * summary when a mutating tool succeeded with files).
 */
export async function recordSoulEvent(event: SoulEvent): Promise<number> {
  const sessionId = event.sessionId || BrainManager.getActiveSessionId();
  if (!sessionId) {
    return 0;
  }

  const content =
    event.kind === "checkpoint"
      ? formatCheckpointMetadataLeaf({
          workspaceCheckpointId: event.workspaceCheckpointId ?? "",
          memoryCheckpointId: event.memoryCheckpointId,
          label: event.summary,
          sessionId,
          files: event.files,
          recipeIds: Array.isArray(event.metadata?.recipeIds)
            ? event.metadata.recipeIds.filter((id): id is string => typeof id === "string")
            : undefined,
        })
      : formatSoulEventContent(event);
  const importance =
    event.kind === "tool_denied" ||
    event.kind === "restore" ||
    event.kind === "build:fail" ||
    event.kind === "qemu:panic" ||
    event.kind === "user_correction"
      ? 0.8
      : event.kind === "checkpoint"
        ? 0.75
      : event.kind === "compaction" || event.kind === "build:pass"
        ? 0.7
        : 0.55;

  const id = await BrainManager.recordMessage(sessionId, "tool", content, {
    type: event.ok ? "tool_result" : "tool_call",
    importance,
    metadata: {
      soul: true,
      kind: event.kind,
      toolName: event.toolName,
      files: event.files,
      workspaceCheckpointId: event.workspaceCheckpointId,
      policy: event.policy,
      ...event.metadata,
      ...(event.oracle ? { oracle: event.oracle } : {}),
    },
  });

  const stored = { ...event, sessionId, episodicId: id };
  lastSoulBySession.set(sessionId, stored);
  const history = soulHistoryBySession.get(sessionId) ?? [];
  history.push(stored);
  soulHistoryBySession.set(sessionId, trimSoulHistory(history));

  if (
    event.kind === "tool_success" &&
    event.files.length > 0 &&
    event.toolName &&
    shouldVerifyTool(event.toolName)
  ) {
    // Do not block the soul-event write (and recipe capture) on extraction.
    void autoStoreTask({
      taskDescription: event.summary || `${event.toolName ?? "tool"} succeeded`,
      filesModified: event.files,
      sessionId,
    }).catch(() => {});
  }

  if (event.kind === "restore") {
    MemorySnapshot.invalidateAll();
  }

  return id;
}
