import type { CheckpointMetadata } from "./checkpointTypes";

export const CHECKPOINT_LIST_PAGE_SIZE = 50;

export function checkpointSessionId(checkpoint: CheckpointMetadata): string | undefined {
  return checkpoint.sessionId ?? checkpoint.conversationContext?.sessionId;
}

export function buildCheckpointSearchDocument(checkpoint: CheckpointMetadata) {
  return {
    id: checkpoint.id,
    description: checkpoint.description,
    tags: (checkpoint.tags ?? []).join(" "),
    sessionId: checkpointSessionId(checkpoint) ?? "",
    paths: (checkpoint.changedPaths ?? []).join(" "),
  };
}

export function selectCheckpointIdRange(
  orderedIds: string[],
  fromId: string,
  toId: string,
): string[] {
  const startIndex = orderedIds.indexOf(fromId);
  const endIndex = orderedIds.indexOf(toId);
  if (startIndex < 0 && endIndex < 0) {
    return [];
  }
  if (startIndex < 0) {
    return [toId];
  }
  if (endIndex < 0) {
    return [fromId];
  }
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);
  return orderedIds.slice(start, end + 1);
}

export function chronologicalCheckpointPair<T extends { dateCreated: string }>(
  left: T,
  right: T,
): [T, T] {
  return new Date(left.dateCreated).getTime() <= new Date(right.dateCreated).getTime()
    ? [left, right]
    : [right, left];
}

export function compareCheckpointTargets<T extends { id: string; dateCreated: string }>(
  catalog: T[],
  currentId: string,
): T[] {
  return catalog
    .filter((checkpoint) => checkpoint.id !== currentId)
    .sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
}
