import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";

const RESTORE_PATH_LIST_LIMIT = 20;

function formatList(
  rows: Array<{
    id: string;
    description: string;
    created: string;
    sessionId?: string;
    fileCount?: number;
  }>,
): string {
  if (rows.length === 0) {
    return "No workspace checkpoints in this workspace.";
  }
  return rows
    .map((row, index) => {
      const files =
        typeof row.fileCount === "number" ? ` files=${row.fileCount}` : "";
      const session = row.sessionId ? ` session=${row.sessionId}` : "";
      return `${index + 1}. ${row.id}  ${row.created}  ${row.description}${files}${session}`;
    })
    .join("\n");
}

function formatRestoredFiles(paths: string[] | undefined): string {
  const restored = paths ?? [];
  if (restored.length === 0) {
    return "0 files written from reconstructed tree";
  }
  if (restored.length <= RESTORE_PATH_LIST_LIMIT) {
    const noun = restored.length === 1 ? "file" : "files";
    return `${restored.length} ${noun} written: ${restored.join(", ")}`;
  }
  return `${restored.length} files from reconstructed tree`;
}

function formatNamedPathList(
  label: string,
  rows: Array<{ path: string; detail: string }> | undefined,
): string {
  if (!rows?.length) {
    return "";
  }
  const shown = rows
    .slice(0, 10)
    .map((row) => `${row.path} (${row.detail})`)
    .join("; ");
  const extra = rows.length > 10 ? `; +${rows.length - 10} more` : "";
  return `\n${label} (${rows.length}): ${shown}${extra}`;
}

function formatPreviewRestore(
  checkpointId: string,
  preview: {
    description: string;
    modified: number;
    added: number;
    deleted: number;
    files: Array<{
      relativePath: string;
      action: string;
      additions: number;
      deletions: number;
      hunkCount: number;
    }>;
    skippedFiles: Array<{ path: string; reason: string }>;
  },
): string {
  const header = `Restore preview for ${checkpointId} (${preview.description}): ${preview.modified} modified, ${preview.added} added, ${preview.deleted} deleted. No files written.`;
  if (preview.files.length === 0) {
    return `${header} Workspace already matches this checkpoint.`;
  }
  const shown = preview.files.slice(0, RESTORE_PATH_LIST_LIMIT).map((file) => {
    const hunks = file.hunkCount === 1 ? "1 hunk" : `${file.hunkCount} hunks`;
    return `${file.relativePath} [${file.action} +${file.additions}/-${file.deletions}, ${hunks}]`;
  });
  const extra =
    preview.files.length > RESTORE_PATH_LIST_LIMIT
      ? `; +${preview.files.length - RESTORE_PATH_LIST_LIMIT} more`
      : "";
  const skipped = formatNamedPathList(
    "Skipped at capture",
    preview.skippedFiles.map((file) => ({ path: file.path, detail: file.reason })),
  );
  return `${header}\n${shown.join("\n")}${extra}${skipped}`;
}

function unavailable(kind: string) {
  return [
    {
      name: "workspace-checkpoint",
      description: "unavailable",
      content: `Workspace checkpoint ${kind} is only available in the VS Code host.`,
    },
  ];
}

function requireCheckpointId(args: { checkpoint_id?: unknown }): string {
  const checkpointId =
    typeof args.checkpoint_id === "string" ? args.checkpoint_id.trim() : "";
  if (!checkpointId) {
    throw new Error(t("missingRequiredParam", { param: "checkpoint_id" }));
  }
  return checkpointId;
}

function formatDiff(summary: {
  oldCheckpoint: { id: string; description: string } | null;
  newCheckpoint: { id: string; description: string };
  files: Array<{
    relativePath: string;
    status: string;
    additions: number;
    deletions: number;
    hunkCount: number;
  }>;
}): string {
  const baseline = summary.oldCheckpoint
    ? `${summary.oldCheckpoint.id} (${summary.oldCheckpoint.description})`
    : "none";
  const header = `Diff ${baseline} → ${summary.newCheckpoint.id} (${summary.newCheckpoint.description}): ${summary.files.length} file${summary.files.length === 1 ? "" : "s"}. No files written.`;
  if (summary.files.length === 0) {
    return `${header} No content differences.`;
  }
  const shown = summary.files.slice(0, RESTORE_PATH_LIST_LIMIT).map((file) => {
    const hunks = file.hunkCount === 1 ? "1 hunk" : `${file.hunkCount} hunks`;
    return `${file.relativePath} [${file.status} +${file.additions}/-${file.deletions}, ${hunks}]`;
  });
  const extra =
    summary.files.length > RESTORE_PATH_LIST_LIMIT
      ? `; +${summary.files.length - RESTORE_PATH_LIST_LIMIT} more`
      : "";
  return `${header}\n${shown.join("\n")}${extra}`;
}

function formatMemoryNote(
  rewindRequested: boolean,
  memoryRewound?: boolean,
  memoryMessage?: string,
): string {
  if (memoryRewound) {
    return ` Memory rewound${memoryMessage ? ` (${memoryMessage})` : ""}.`;
  }
  if (rewindRequested) {
    return " Memory rewind was requested but nothing linked was rolled back.";
  }
  return "";
}

export const workspaceCheckpointImpl: ToolImpl = async (args, extras) => {
  const action = typeof args.action === "string" ? args.action.trim() : "";
  if (!action) {
    throw new Error(t("missingRequiredParam", { param: "action" }));
  }

  if (action === "list") {
    if (typeof extras.ide.listWorkspaceCheckpoints !== "function") {
      return [
        {
          name: "workspace-checkpoint",
          description: "unavailable",
          content:
            "Workspace checkpoints are only available in the VS Code host.",
        },
      ];
    }
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.min(50, Math.max(1, Math.floor(args.limit)))
        : 15;
    const rows = await extras.ide.listWorkspaceCheckpoints(limit);
    return [
      {
        name: "workspace-checkpoint",
        description: `Listed ${rows.length} checkpoint${rows.length === 1 ? "" : "s"}`,
        content: formatList(rows),
      },
    ];
  }

  if (action === "create") {
    if (typeof extras.ide.createWorkspaceCheckpoint !== "function") {
      return [
        {
          name: "workspace-checkpoint",
          description: "unavailable",
          content:
            "Workspace checkpoints are only available in the VS Code host.",
        },
      ];
    }
    const label =
      typeof args.label === "string" && args.label.trim()
        ? args.label.trim()
        : "Agent workspace checkpoint";
    const id = await extras.ide.createWorkspaceCheckpoint({
      description: label,
      sessionId: extras.soul?.sessionId,
    });
    return [
      {
        name: "workspace-checkpoint",
        description: id ? "created" : "skipped",
        content: id
          ? `Created workspace checkpoint ${id} (${label}).`
          : "No checkpoint was created (host skipped or uninitialized).",
      },
    ];
  }

  if (action === "diff") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.diffWorkspaceCheckpoint !== "function") {
      return unavailable("diff");
    }
    const compareToWorkspace =
      args.compare_to_workspace === true || args.compareToWorkspace === true;
    const compareToCheckpointId =
      typeof args.compare_to_checkpoint_id === "string"
        ? args.compare_to_checkpoint_id.trim()
        : typeof args.compareToCheckpointId === "string"
          ? args.compareToCheckpointId.trim()
          : undefined;
    const summary = await extras.ide.diffWorkspaceCheckpoint({
      checkpointId,
      compareToCheckpointId: compareToCheckpointId || undefined,
      compareToWorkspace,
    });
    if (!summary) {
      return [
        {
          name: "workspace-checkpoint",
          description: "failed",
          content: `No diff for ${checkpointId} (missing checkpoint or host could not reconstruct it).`,
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: "diff",
        content: formatDiff(summary),
      },
    ];
  }

  if (action === "preview_restore") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.previewWorkspaceCheckpointRestore !== "function") {
      return unavailable("preview");
    }
    const preview = await extras.ide.previewWorkspaceCheckpointRestore({
      checkpointId,
    });
    if (!preview) {
      return [
        {
          name: "workspace-checkpoint",
          description: "failed",
          content: `No restore preview for ${checkpointId} (missing checkpoint or host could not reconstruct it).`,
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: "preview",
        content: formatPreviewRestore(checkpointId, preview),
      },
    ];
  }

  if (action === "pin" || action === "unpin") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.pinWorkspaceCheckpoint !== "function") {
      return unavailable("pin");
    }
    const pinned = action === "pin";
    const result = await extras.ide.pinWorkspaceCheckpoint({
      checkpointId,
      pinned,
    });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? action : "failed",
        content: result.success
          ? `${pinned ? "Pinned" : "Unpinned"} checkpoint ${checkpointId}.`
          : `Could not ${action} ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "restore") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.restoreWorkspaceCheckpoint !== "function") {
      return unavailable("restore");
    }
    const rewindMemory =
      args.rewind_memory === true || args.rewindMemory === true;
    const result = await extras.ide.restoreWorkspaceCheckpoint({
      checkpointId,
      rewindMemory,
    });
    const files = formatRestoredFiles(result.restoredFiles);
    const failed = formatNamedPathList(
      "Failed",
      result.failedFiles?.map((file) => ({
        path: file.path,
        detail: file.error,
      })),
    );
    const skipped = formatNamedPathList(
      "Skipped at capture",
      result.skippedFiles?.map((file) => ({
        path: file.path,
        detail: file.reason,
      })),
    );
    const memory = formatMemoryNote(
      rewindMemory,
      result.memoryRewound,
      result.memoryMessage,
    );
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "restored" : "failed",
        content: result.success
          ? `Restored checkpoint ${checkpointId}. ${files}.${memory}${failed}${skipped}`
          : `Restore failed: ${result.message || "unknown error"}${
              result.restoredFiles?.length ? `. ${files}.` : ""
            }${failed}${skipped}${memory}`,
      },
    ];
  }

  if (action === "delete") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.deleteWorkspaceCheckpoint !== "function") {
      return unavailable("delete");
    }
    const result = await extras.ide.deleteWorkspaceCheckpoint({ checkpointId });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "deleted" : "failed",
        content: result.success
          ? `Deleted checkpoint ${checkpointId}.`
          : `Could not delete ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  throw new Error(`Unknown workspace checkpoint action: ${action}`);
};
