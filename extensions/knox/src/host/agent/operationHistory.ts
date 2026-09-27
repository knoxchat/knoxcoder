/**
 * KN-351: vscode-free file-byte undo/redo stack + operation-history QuickPick.
 *
 * CommandHistoryService is the vscode adapter (commands, restore, QuickPick).
 * Core tools/call records snapshots via IDE.captureMutatingToolBefore /
 * recordMutatingToolAfter so GUI chat and agent share one path.
 */

export const ENHANCED_UNDO_COMMAND = "knox.enhancedUndo";
export const ENHANCED_REDO_COMMAND = "knox.enhancedRedo";
export const UNDO_LAST_OPERATION_COMMAND = "knox.undoLastOperation";
export const REDO_LAST_OPERATION_COMMAND = "knox.redoLastOperation";
/** Legacy typo alias kept so older keybindings still redo. */
export const LEGACY_REDO_LAST_OPERATION_COMMAND = "knox.chatoLastOperation";
export const SHOW_OPERATION_HISTORY_COMMAND = "knox.showOperationHistory";
export const CLEAR_OPERATION_HISTORY_COMMAND = "knox.clearOperationHistory";

export const KNOX_CAN_UNDO_CONTEXT_KEY = "knoxCanUndo";
export const KNOX_CAN_REDO_CONTEXT_KEY = "knoxCanRedo";

export const OPERATION_HISTORY_MAX_SIZE = 100;

export interface OperationSnapshotView {
  content: Uint8Array | null;
}

export type SnapshotChangeKind = "none" | "created" | "deleted" | "modified";

export interface SnapshotChange {
  kind: SnapshotChangeKind;
  beforeBytes: number;
  afterBytes: number;
}

export interface OperationHistoryInspectPayload {
  id: string;
  description: string;
  timestamp: number;
  toolName: string;
  filePath: string | undefined;
  args: Record<string, unknown> | null;
  beforeExisted: boolean;
  afterExisted: boolean;
  beforeBytes: number;
  afterBytes: number;
}

export interface OperationHistoryPickItem<T> {
  label: string;
  description: string;
  detail: string;
  operation: T;
}

export type HistoryTranslator = (
  key: string,
  vars?: Record<string, string>,
) => string;

/**
 * File-byte undo/redo stacks. `record` clears redo. Failed undo/redo can
 * `restore*` the popped entry so the user can retry.
 */
export class OperationHistoryStack<T> {
  private undoItems: T[] = [];
  private redoItems: T[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = OPERATION_HISTORY_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  record(op: T): void {
    this.redoItems = [];
    this.undoItems.push(op);
    while (this.undoItems.length > this.maxSize) {
      this.undoItems.shift();
    }
  }

  takeUndo(): T | undefined {
    return this.undoItems.pop();
  }

  commitUndo(op: T): void {
    this.redoItems.push(op);
  }

  restoreUndo(op: T): void {
    this.undoItems.push(op);
  }

  takeRedo(): T | undefined {
    return this.redoItems.pop();
  }

  commitRedo(op: T): void {
    this.undoItems.push(op);
  }

  restoreRedo(op: T): void {
    this.redoItems.push(op);
  }

  clear(): void {
    this.undoItems = [];
    this.redoItems = [];
  }

  get undoStack(): readonly T[] {
    return this.undoItems;
  }

  get redoStack(): readonly T[] {
    return this.redoItems;
  }

  canUndo(): boolean {
    return this.undoItems.length > 0;
  }

  canRedo(): boolean {
    return this.redoItems.length > 0;
  }
}

export function snapshotBytesEqual(
  a: OperationSnapshotView,
  b: OperationSnapshotView,
): boolean {
  if (a.content === null && b.content === null) {
    return true;
  }
  if (a.content === null || b.content === null) {
    return false;
  }
  if (a.content.byteLength !== b.content.byteLength) {
    return false;
  }
  for (let i = 0; i < a.content.byteLength; i++) {
    if (a.content[i] !== b.content[i]) {
      return false;
    }
  }
  return true;
}

export function changedSnapshotPairs<
  T extends { before: OperationSnapshotView; after: OperationSnapshotView },
>(pairs: readonly T[]): T[] {
  return pairs.filter((pair) => !snapshotBytesEqual(pair.before, pair.after));
}

export function pathsLikelyMatch(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const norm = (p: string) =>
    p
      .replace(/^file:\/\//, "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

export function findLatestOperationIndexForPath(
  undoStack: readonly { context: { filePath?: string } }[],
  filePath: string,
): number {
  for (let i = undoStack.length - 1; i >= 0; i--) {
    const opPath = undoStack[i].context.filePath;
    if (opPath === filePath || pathsLikelyMatch(opPath, filePath)) {
      return i;
    }
  }
  return -1;
}

export function describeSnapshotChange(op: {
  before: OperationSnapshotView | null;
  after: OperationSnapshotView | null;
}): SnapshotChange {
  const before = op.before?.content;
  const after = op.after?.content;
  const beforeBytes = before?.byteLength ?? 0;
  const afterBytes = after?.byteLength ?? 0;
  if (before === null || before === undefined) {
    if (after === null || after === undefined) {
      return { kind: "none", beforeBytes, afterBytes };
    }
    return { kind: "created", beforeBytes, afterBytes };
  }
  if (after === null || after === undefined) {
    return { kind: "deleted", beforeBytes, afterBytes };
  }
  return { kind: "modified", beforeBytes, afterBytes };
}

export function formatSnapshotChangeDetail(
  change: SnapshotChange,
  t: HistoryTranslator,
): string {
  switch (change.kind) {
    case "none":
      return t("history.changeNone");
    case "created":
      return t("history.changeCreated", { bytes: String(change.afterBytes) });
    case "deleted":
      return t("history.changeDeleted", { bytes: String(change.beforeBytes) });
    case "modified":
      return t("history.changeModified", {
        before: String(change.beforeBytes),
        after: String(change.afterBytes),
      });
  }
}

/**
 * QuickPick rows: newest first, numbered from 1 at the top.
 */
export function buildOperationHistoryPickItems<
  T extends { description: string; timestamp: number },
>(
  undoStack: readonly T[],
  options: {
    formatTime?: (timestamp: number) => string;
    detail?: (op: T) => string;
  } = {},
): OperationHistoryPickItem<T>[] {
  const formatTime =
    options.formatTime ?? ((timestamp) => new Date(timestamp).toLocaleTimeString());
  const detail = options.detail ?? (() => "");
  const n = undoStack.length;
  return undoStack
    .map((op, index) => ({
      label: `${n - index}. ${op.description}`,
      description: formatTime(op.timestamp),
      detail: detail(op),
      operation: op,
    }))
    .reverse();
}

export function operationHistoryInspectPayload(op: {
  id: string;
  description: string;
  timestamp: number;
  context: {
    toolName: string;
    args: Record<string, unknown> | null;
    filePath?: string;
  };
  before: OperationSnapshotView | null;
  after: OperationSnapshotView | null;
}): OperationHistoryInspectPayload {
  return {
    id: op.id,
    description: op.description,
    timestamp: op.timestamp,
    toolName: op.context.toolName,
    filePath: op.context.filePath,
    args: op.context.args,
    beforeExisted: op.before?.content != null,
    afterExisted: op.after?.content != null,
    beforeBytes: op.before?.content?.byteLength ?? 0,
    afterBytes: op.after?.content?.byteLength ?? 0,
  };
}
