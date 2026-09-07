import {
  recordSoulEvent,
  rewindMemoryForWorkspaceCheckpoint,
} from "core/context/soul/recordSoulEvent";

import { CheckpointManager } from "./CheckpointManager";

export interface CheckpointRestoredPayload {
  checkpointId: string;
  description?: string;
  restoredFiles: string[];
  sessionId?: string;
  memoryRewound?: boolean;
  memoryMessage?: string;
}

type RestoreListener = (payload: CheckpointRestoredPayload) => void;

let listener: RestoreListener | undefined;

export function setCheckpointRestoreListener(fn: RestoreListener | undefined): void {
  listener = fn;
}

export async function notifyCheckpointRestored(
  checkpointId: string,
  restoredFiles: string[] = [],
  options?: { rewindMemory?: boolean },
): Promise<CheckpointRestoredPayload> {
  const manager = CheckpointManager.getInstance();
  const info = manager.getCheckpointInfo(checkpointId);
  const files =
    restoredFiles.length > 0
      ? restoredFiles
      : info?.fileSnapshots?.map((snapshot) => snapshot.relativePath) ?? [];
  const sessionId =
    (info?.conversationContext as { sessionId?: string } | undefined)?.sessionId ||
    manager.getBoundAgentSessionId() ||
    undefined;

  let memoryRewound = false;
  let memoryMessage: string | undefined;
  let memoryCheckpointId: number | undefined;

  if (options?.rewindMemory && sessionId) {
    try {
      const rewind = await rewindMemoryForWorkspaceCheckpoint({
        sessionId,
        workspaceCheckpointId: checkpointId,
        createdAt: info?.created?.toISOString(),
      });
      memoryRewound = rewind.rewound;
      memoryMessage = rewind.message;
      memoryCheckpointId = rewind.memoryCheckpointId;
    } catch {
      memoryMessage = "Memory rewind failed; files were still restored.";
    }
  }

  const payload: CheckpointRestoredPayload = {
    checkpointId,
    description: info?.description,
    restoredFiles: files,
    sessionId,
    memoryRewound,
    memoryMessage,
  };

  listener?.(payload);

  if (!sessionId) {
    return payload;
  }

  try {
    await recordSoulEvent({
      sessionId,
      kind: "restore",
      files,
      workspaceCheckpointId: checkpointId,
      memoryCheckpointId,
      ok: true,
      summary: [
        `Restored checkpoint ${checkpointId}${
          info?.description ? `: ${info.description}` : ""
        }`,
        memoryRewound ? memoryMessage : "",
      ]
        .filter(Boolean)
        .join(". "),
    });
  } catch {
    // Best-effort — restore already succeeded on disk.
  }

  return payload;
}
