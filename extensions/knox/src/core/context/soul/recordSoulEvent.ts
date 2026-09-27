import { BrainManager } from "../memory/brain/BrainManager.js";
import { MemorySnapshot } from "../memory/brain/MemorySnapshot.js";
import { shouldVerifyTool } from "../../tools/postEditVerification.js";

import { formatSoulEventContent } from "./extractToolFiles.js";
import type { SoulEvent } from "./types.js";

const lastSoulBySession = new Map<string, SoulEvent & { episodicId: number }>();
const soulHistoryBySession = new Map<
  string,
  Array<SoulEvent & { episodicId: number }>
>();
const MAX_SOUL_HISTORY = 20;

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
    const linked = await BrainManager.findCheckpointByWorkspaceId(
      input.workspaceCheckpointId,
    );
    if (linked) {
      memoryCheckpointId = linked.id;
      const rollback = await BrainManager.rollbackCheckpoint(linked.id);
      rollbackLine = rollback.split("\n")[0] ?? "";
    }
  } catch (error) {
    rollbackLine = error instanceof Error ? error.message : String(error);
  }

  let trimmedEpisodic = 0;
  if (input.createdAt) {
    try {
      trimmedEpisodic = await BrainManager.trimEpisodicAfter(
        input.sessionId,
        input.createdAt,
      );
    } catch {
      // Trim is best-effort; file restore already succeeded.
    }
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

  const content = formatSoulEventContent(event);
  const importance =
    event.kind === "tool_denied" ||
    event.kind === "restore" ||
    event.kind === "build:fail" ||
    event.kind === "qemu:panic"
      ? 0.8
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
    },
  });

  const stored = { ...event, sessionId, episodicId: id };
  lastSoulBySession.set(sessionId, stored);
  const history = soulHistoryBySession.get(sessionId) ?? [];
  history.push(stored);
  if (history.length > MAX_SOUL_HISTORY) {
    history.splice(0, history.length - MAX_SOUL_HISTORY);
  }
  soulHistoryBySession.set(sessionId, history);

  if (
    event.kind === "tool_success" &&
    event.files.length > 0 &&
    event.toolName &&
    shouldVerifyTool(event.toolName)
  ) {
    await autoStoreTask({
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
