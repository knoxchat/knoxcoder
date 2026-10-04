/**
 * KN-344: vscode-free batch multi-file diff engine.
 *
 * Collects pending vertical diffs, then accept/reject all or a selected
 * subset. The native GUI `/batch-diff` route is the product UI; host
 * commands `knox.batch.*` call the same apply path as `batch/*` protocol.
 */

/** Native GUI route for the multi-file accept/reject page. */
export const BATCH_DIFF_ROUTE = "/batch-diff";

/** Host command that navigates the native GUI (already contributed). */
export const BATCH_DIFF_NAVIGATE_COMMAND = "knoxchat.navigateTo";

export const BATCH_DIFF_COMMANDS = {
  show: "knox.batch.show",
  acceptAll: "knox.batch.acceptAll",
  rejectAll: "knox.batch.rejectAll",
  acceptSelected: "knox.batch.acceptSelected",
  rejectSelected: "knox.batch.rejectSelected",
} as const;

export const BATCH_DIFF_PROTOCOL = {
  getPendingFiles: "batch/getPendingFiles",
  acceptAll: "batch/acceptAll",
  rejectAll: "batch/rejectAll",
  acceptSelected: "batch/acceptSelected",
  rejectSelected: "batch/rejectSelected",
} as const;

export type BatchDiffKind =
  | "acceptAll"
  | "rejectAll"
  | "acceptSelected"
  | "rejectSelected";

export type BatchDiffAction = "accept" | "reject";

export interface BatchDiffEntry {
  filepath: string;
  streamId: string;
  numDiffs: number;
  selected: boolean;
}

export interface BatchDiffResult {
  totalFiles: number;
  successFiles: number;
  failedFiles: string[];
}

export interface BatchDiffHost {
  clearForFile(fileUri: string, accept: boolean): void | Promise<void>;
  saveIfDirty?(fileUri: string): Promise<void>;
}

export function emptyBatchDiffResult(): BatchDiffResult {
  return { totalFiles: 0, successFiles: 0, failedFiles: [] };
}

/** Files with at least one CodeLens block are pending diffs. */
export function collectPendingFiles(
  codeLensByUri: Iterable<[string, { length: number }]>,
): BatchDiffEntry[] {
  const entries: BatchDiffEntry[] = [];
  for (const [fileUri, codeLenses] of codeLensByUri) {
    if (codeLenses.length > 0) {
      entries.push({
        filepath: fileUri,
        streamId: "",
        numDiffs: codeLenses.length,
        selected: true,
      });
    }
  }
  return entries;
}

export function pendingFilesPayload(entries: BatchDiffEntry[]): {
  files: Array<{ filepath: string; numDiffs: number; selected: boolean }>;
} {
  return {
    files: entries.map((entry) => ({
      filepath: entry.filepath,
      numDiffs: entry.numDiffs,
      selected: entry.selected,
    })),
  };
}

export function batchActionForKind(kind: BatchDiffKind): BatchDiffAction {
  return kind.startsWith("accept") ? "accept" : "reject";
}

export function fileUrisForBatch(
  kind: BatchDiffKind,
  pending: BatchDiffEntry[],
  selected?: string[],
): string[] {
  if (kind === "acceptSelected" || kind === "rejectSelected") {
    return selected ?? [];
  }
  return pending.map((entry) => entry.filepath);
}

export function protocolTypeForKind(
  kind: BatchDiffKind,
): (typeof BATCH_DIFF_PROTOCOL)[BatchDiffKind] {
  return BATCH_DIFF_PROTOCOL[kind];
}

/**
 * Apply accept/reject to each file. Failures are recorded per URI; later
 * files still run (not transactional).
 */
export async function applyBatch(
  host: BatchDiffHost,
  action: BatchDiffAction,
  fileUris: string[],
): Promise<BatchDiffResult> {
  const result: BatchDiffResult = {
    totalFiles: fileUris.length,
    successFiles: 0,
    failedFiles: [],
  };
  const accept = action === "accept";

  for (const fileUri of fileUris) {
    try {
      await host.clearForFile(fileUri, accept);
      if (accept) {
        await host.saveIfDirty?.(fileUri);
      }
      result.successFiles++;
    } catch {
      result.failedFiles.push(fileUri);
    }
  }

  return result;
}
