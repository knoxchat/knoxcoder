/** Brain checkpoints, pin-for-workspace, and rollback. */

import { BrainStore } from "../BrainStore.js";
import { CheckpointManager } from "../CheckpointManager.js";
import { MemorySnapshot } from "../MemorySnapshot.js";
import { emit } from "./events.js";
import { invalidateMemoryCaches } from "./helpers.js";
import { getWorkingMemory } from "./runtime.js";

// ── Checkpoint / Rollback ──────────────────────────────────────────────────

export async function createCheckpoint(
  label: string,
  workspaceCheckpointId?: string,
  options?: { compress?: boolean },
) {
  const cp = await BrainStore.createCheckpoint(label, workspaceCheckpointId, {
    compress: options?.compress === true,
  });
  emit("checkpoint:created", { id: cp.id, label });
  return cp;
}

export async function listCheckpoints(limit?: number) {
  return BrainStore.listCheckpoints(limit);
}

export async function findCheckpointByWorkspaceId(workspaceCheckpointId: string) {
  return BrainStore.findCheckpointByWorkspaceId(workspaceCheckpointId);
}

export async function findNearestCheckpointBefore(createdAt: string) {
  return BrainStore.findNearestCheckpointBefore(createdAt);
}

export async function deleteCheckpointsForWorkspaceId(workspaceCheckpointId: string) {
  return BrainStore.deleteCheckpointsForWorkspaceId(workspaceCheckpointId);
}

export function isBrainOpen(): boolean {
  return BrainStore.isOpen();
}

/**
 * Ensure a brain snapshot is linked to a workspace file checkpoint.
 * No-op when the brain has not been opened in this process (checkpoint-only tests).
 */
export async function pinForWorkspaceCheckpoint(
  workspaceCheckpointId: string,
  label: string,
) {
  if (!workspaceCheckpointId.trim() || !BrainStore.isOpen()) {
    return undefined;
  }
  const existing = await BrainStore.findCheckpointByWorkspaceId(
    workspaceCheckpointId,
  );
  if (existing) {
    return existing;
  }
  return createCheckpoint(label, workspaceCheckpointId, {
    compress: CheckpointManager.getConfig().compress_snapshots,
  });
}

export async function trimEpisodicAfter(sessionId: string, createdAt: string) {
  return BrainStore.trimEpisodicAfter(sessionId, createdAt);
}

export async function rollbackCheckpoint(checkpointId: number) {
  const result = await BrainStore.rollbackCheckpoint(checkpointId);
  emit("checkpoint:rolled_back", { id: checkpointId });
  invalidateMemoryCaches();
  MemorySnapshot.invalidateAll();
  getWorkingMemory().clear();
  try {
    const { PrefrontalCortex } = await import("../regions/PrefrontalCortex.js");
    PrefrontalCortex.resetAll();
  } catch {
    // Goal reset is best-effort.
  }
  return result;
}

export async function deleteCheckpoint(checkpointId: number) {
  const result = await BrainStore.deleteCheckpoint(checkpointId);
  if (result) emit("checkpoint:deleted", { id: checkpointId });
  return result;
}
