import {
  captureFileSnapshot,
  extractMutatingFilePaths,
  FileContentSnapshot,
  isMutatingTool,
  parseToolArguments,
} from "./fileSnapshots";
import { CommandHistoryService } from "./CommandHistoryService";

/**
 * Pending before-snapshots for Core tools/call (GUI chat + agent).
 * Opaque beforeId keeps binary file bytes out of the Core protocol.
 */
const pendingBeforeSnapshots = new Map<string, FileContentSnapshot[]>();

export interface MutatingToolUndoParams {
  toolName: string;
  toolArguments: unknown;
}

/**
 * Capture file bytes before a mutating tool. Returns an opaque id, or null
 * when the tool is non-mutating / has no resolvable path.
 */
export async function captureMutatingToolBefore(
  params: MutatingToolUndoParams,
): Promise<string | null> {
  const { toolName, toolArguments } = params;
  if (!isMutatingTool(toolName)) {
    return null;
  }

  const args = parseToolArguments(toolArguments);
  const filePaths = extractMutatingFilePaths(toolName, args);
  if (filePaths.length === 0) {
    return null;
  }

  const befores = await Promise.all(
    filePaths.map((filePath) => captureFileSnapshot(filePath)),
  );
  const beforeId = `before-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  pendingBeforeSnapshots.set(beforeId, befores);
  return beforeId;
}

/**
 * After a mutating tool (and optional verification) finishes, pair before/after
 * snapshots into CommandHistoryService so knox.enhancedUndo works for GUI chat.
 * Always releases the pending before snapshot when beforeId is set.
 */
export async function recordMutatingToolAfter(params: {
  toolName: string;
  toolArguments: unknown;
  beforeId: string | null;
  /** When false, only discard the pending before snapshot (tool failed). */
  commit?: boolean;
}): Promise<void> {
  const { toolName, toolArguments, beforeId, commit = true } = params;
  const befores = beforeId
    ? pendingBeforeSnapshots.get(beforeId) ?? null
    : null;
  if (beforeId) {
    pendingBeforeSnapshots.delete(beforeId);
  }

  if (!commit || !befores || befores.length === 0 || !isMutatingTool(toolName)) {
    return;
  }

  const args = parseToolArguments(toolArguments);
  const filePaths = extractMutatingFilePaths(toolName, args);
  if (filePaths.length === 0) {
    return;
  }

  const pairs: Array<{ before: FileContentSnapshot; after: FileContentSnapshot }> =
    [];
  for (let i = 0; i < filePaths.length; i++) {
    const before = befores[i];
    if (!before) {
      continue;
    }
    const after = await captureFileSnapshot(filePaths[i]);
    pairs.push({ before, after });
  }
  if (pairs.length === 0) {
    return;
  }

  await CommandHistoryService.getInstance().recordManualMutation({
    description: `${toolName}: ${filePaths.join(", ")}`,
    toolName,
    filePath: filePaths[0],
    args,
    pairs,
  });
}

/** Test helper: clear pending before-snapshots. */
export function clearPendingMutatingToolBefores(): void {
  pendingBeforeSnapshots.clear();
}

/** Test helper: pending before count. */
export function pendingMutatingToolBeforeCount(): number {
  return pendingBeforeSnapshots.size;
}
