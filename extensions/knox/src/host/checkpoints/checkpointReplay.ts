/**
 * Pure helpers for replaying TypeScript delta checkpoints into a full file state.
 * Used by restore and workspace-diff so both share the same semantics.
 */

export interface ReplaySnapshot {
  relativePath: string;
  content?: string;
  hash?: string;
  encoding?: string;
  deleted?: boolean;
  changeType?: "created" | "modified" | "deleted" | string;
}

export interface ReplayCheckpoint {
  fileSnapshots?: ReplaySnapshot[];
}

export interface ResolvedFileState {
  content: string;
  encoding: string;
  hash?: string;
}

/**
 * Replay checkpoint deltas in chronological order into a full path → content map.
 * Deleted snapshots remove a path from the map.
 */
export function replaySnapshotsToState(
  checkpoints: ReplayCheckpoint[],
): Map<string, ResolvedFileState> {
  const state = new Map<string, ResolvedFileState>();

  for (const checkpoint of checkpoints) {
    for (const snapshot of checkpoint.fileSnapshots || []) {
      if (snapshot.deleted || snapshot.changeType === "deleted") {
        state.delete(snapshot.relativePath);
        continue;
      }
      state.set(snapshot.relativePath, {
        content: snapshot.content ?? "",
        encoding: snapshot.encoding || "utf8",
        ...(snapshot.hash ? { hash: snapshot.hash } : {}),
      });
    }
  }

  return state;
}

/**
 * Merge a checkpoint's snapshots into its successor so the successor can
 * reconstruct the same tree after the earlier checkpoint is deleted.
 * Successor entries win on path conflicts (including deletes).
 */
export function foldSnapshotsIntoSuccessor<T extends ReplaySnapshot>(
  current: T[] | undefined,
  successor: T[] | undefined,
): T[] {
  const merged = new Map<string, T>();
  for (const snapshot of current ?? []) {
    merged.set(snapshot.relativePath, snapshot);
  }
  for (const snapshot of successor ?? []) {
    merged.set(snapshot.relativePath, snapshot);
  }
  return Array.from(merged.values());
}
