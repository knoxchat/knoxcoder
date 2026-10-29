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
    branch?: string;
    label?: string;
  }>,
): string {
  if (rows.length === 0) {
    return "No workspace checkpoints in this workspace.";
  }
  return rows
    .map((row, index) => {
      const title = row.label || row.description;
      const extraDesc =
        row.label && row.description && row.label !== row.description
          ? ` (${row.description})`
          : "";
      const files =
        typeof row.fileCount === "number" ? ` files=${row.fileCount}` : "";
      const session = row.sessionId ? ` session=${row.sessionId}` : "";
      const branch = row.branch ? ` branch=${row.branch}` : "";
      const label = title ? ` label=${title}` : "";
      return `${index + 1}. ${row.id}  ${row.created}${label}${extraDesc}${branch}${files}${session}`;
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
    oldPath?: string;
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
    const origin = file.oldPath ? ` ← ${file.oldPath}` : "";
    return `${file.relativePath}${origin} [${file.status} +${file.additions}/-${file.deletions}, ${hunks}]`;
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

  if (action === "create_branch") {
    if (typeof extras.ide.createWorkspaceCheckpointBranch !== "function") {
      return unavailable("create_branch");
    }
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) {
      throw new Error(t("missingRequiredParam", { param: "name" }));
    }
    const checkpointId =
      typeof args.checkpoint_id === "string" ? args.checkpoint_id.trim() : "";
    const description =
      typeof args.label === "string" && args.label.trim()
        ? args.label.trim()
        : undefined;
    const result = await extras.ide.createWorkspaceCheckpointBranch({
      name,
      checkpointId: checkpointId || undefined,
      description,
    });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "branched" : "failed",
        content: result.success
          ? `Created checkpoint branch ${result.name} (${result.branchId}) at ${result.headCheckpointId}.`
          : `Could not create branch: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "switch_branch") {
    if (typeof extras.ide.switchWorkspaceCheckpointBranch !== "function") {
      return unavailable("switch_branch");
    }
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const branchId =
      typeof args.branch_id === "string"
        ? args.branch_id.trim()
        : typeof args.branchId === "string"
          ? args.branchId.trim()
          : "";
    if (!name && !branchId) {
      throw new Error(t("missingRequiredParam", { param: "name or branch_id" }));
    }
    const result = await extras.ide.switchWorkspaceCheckpointBranch({
      name: name || undefined,
      branchId: branchId || undefined,
    });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "switched" : "failed",
        content: result.success
          ? `Switched to checkpoint branch ${result.branchId ?? (branchId || name)} at ${result.headCheckpointId}.${result.stashed ? ` Stashed dirty files as ${result.stashId}.` : ""}`
          : `Could not switch branch: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "checkout") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.checkoutWorkspaceCheckpoint !== "function") {
      return unavailable("checkout");
    }
    const result = await extras.ide.checkoutWorkspaceCheckpoint({ checkpointId });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? (result.detached ? "detached" : "checked out") : "failed",
        content: result.success
          ? `${result.detached ? "Detached checkout of" : "Checked out"} ${result.checkpointId ?? checkpointId}.${result.stashed ? ` Stashed dirty files as ${result.stashId}.` : ""}`
          : `Could not check out ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "cherry_pick") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.cherryPickWorkspaceCheckpoint !== "function") {
      return unavailable("cherry_pick");
    }
    const result = await extras.ide.cherryPickWorkspaceCheckpoint({ checkpointId });
    if (result.conflicts.length > 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "conflicts",
          content: `Cherry-pick stopped; resolve markers and continue, or abort. Conflicts: ${result.conflicts.map((conflict) => conflict.path).join(", ")}`,
        },
      ];
    }
    if (result.empty) {
      return [
        {
          name: "workspace-checkpoint",
          description: "empty",
          content: `Nothing to cherry-pick from ${checkpointId} — those changes are already on the current line.`,
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "cherry-picked" : "failed",
        content: result.success
          ? `Cherry-picked ${checkpointId} onto the current line as ${result.checkpointId}.`
          : `Could not cherry-pick ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "revert") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.revertWorkspaceCheckpoint !== "function") {
      return unavailable("revert");
    }
    const result = await extras.ide.revertWorkspaceCheckpoint({ checkpointId });
    if (result.conflicts.length > 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "conflicts",
          content: `Revert stopped; resolve markers and continue, or abort. Conflicts: ${result.conflicts.map((conflict) => conflict.path).join(", ")}`,
        },
      ];
    }
    if (result.empty) {
      return [
        {
          name: "workspace-checkpoint",
          description: "empty",
          content: `Nothing to revert from ${checkpointId} — those changes are already undone on the current line.`,
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "reverted" : "failed",
        content: result.success
          ? `Reverted ${checkpointId} onto the current line as ${result.checkpointId}. The original checkpoint is still in history.`
          : `Could not revert ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "merge_continue") {
    if (typeof extras.ide.continueWorkspaceCheckpointMerge !== "function") {
      return unavailable("merge_continue");
    }
    const result = await extras.ide.continueWorkspaceCheckpointMerge();
    if (result.conflicts.length > 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "conflicts",
          content: `Merge continue stopped. Unresolved: ${result.conflicts.map((conflict) => conflict.path).join(", ")}`,
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "continued" : "failed",
        content: result.success
          ? `Finished the in-progress operation as ${result.checkpointId}.`
          : `Could not continue: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "merge_abort") {
    if (typeof extras.ide.abortWorkspaceCheckpointMerge !== "function") {
      return unavailable("merge_abort");
    }
    const result = await extras.ide.abortWorkspaceCheckpointMerge();
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "aborted" : "failed",
        content: result.success
          ? "Aborted the in-progress merge and restored the pre-merge tree."
          : `Could not abort: ${result.message || "unknown error"}`,
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

  if (action === "stash") {
    if (typeof extras.ide.stashWorkspaceCheckpoint !== "function") {
      return unavailable("stash");
    }
    const message =
      typeof args.label === "string" && args.label.trim()
        ? args.label.trim()
        : undefined;
    const result = await extras.ide.stashWorkspaceCheckpoint({ message });
    if (result.empty) {
      return [
        {
          name: "workspace-checkpoint",
          description: "empty",
          content: "Nothing to stash — the working tree matches the current checkpoint.",
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "stashed" : "failed",
        content: result.success
          ? `Stashed ${result.fileCount ?? 0} file(s) as ${result.stashId}.`
          : `Could not stash: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "stash_list") {
    if (typeof extras.ide.listWorkspaceStashes !== "function") {
      return unavailable("stash_list");
    }
    const rows = await extras.ide.listWorkspaceStashes();
    if (rows.length === 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "listed 0 stashes",
          content: "The stash stack is empty.",
        },
      ];
    }
    const content = rows
      .map((row, index) => {
        const note = row.message ? ` note=${row.message}` : "";
        return `${index + 1}. ${row.id}  ${row.created}${note} files=${row.fileCount}`;
      })
      .join("\n");
    return [
      {
        name: "workspace-checkpoint",
        description: `Listed ${rows.length} stash${rows.length === 1 ? "" : "es"}`,
        content,
      },
    ];
  }

  if (action === "stash_pop") {
    if (typeof extras.ide.popWorkspaceStash !== "function") {
      return unavailable("stash_pop");
    }
    const stashId =
      typeof args.stash_id === "string" && args.stash_id.trim()
        ? args.stash_id.trim()
        : undefined;
    const result = await extras.ide.popWorkspaceStash({ stashId });
    if (result.empty) {
      return [
        {
          name: "workspace-checkpoint",
          description: "empty",
          content: "The stash stack is empty.",
        },
      ];
    }
    if (result.conflicts.length > 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "conflicts",
          content: `Stash apply stopped; working tree unchanged. Conflicts: ${result.conflicts.map((conflict) => conflict.path).join(", ")}`,
        },
      ];
    }
    const files = formatRestoredFiles([
      ...(result.restoredFiles ?? []),
      ...(result.removedFiles ?? []),
    ]);
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "popped" : "failed",
        content: result.success
          ? `Popped stash ${result.stashId}. ${files}.`
          : `Could not pop stash: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "file_history") {
    const relativePath =
      typeof args.path === "string"
        ? args.path.trim()
        : typeof args.relative_path === "string"
          ? args.relative_path.trim()
          : "";
    if (!relativePath) {
      throw new Error(t("missingRequiredParam", { param: "path" }));
    }
    if (typeof extras.ide.listWorkspaceCheckpointFileHistory !== "function") {
      return unavailable("file_history");
    }
    const follow = args.follow !== false;
    const versions = await extras.ide.listWorkspaceCheckpointFileHistory({
      path: relativePath,
      follow,
    });
    if (versions.length === 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "listed 0 versions",
          content: `No checkpoint versions found for ${relativePath}.`,
        },
      ];
    }
    const content = versions
      .map((version, index) => {
        const state = version.deleted ? " deleted" : "";
        const origin =
          version.relativePath && version.relativePath !== relativePath
            ? ` was=${version.relativePath}`
            : "";
        const hash = version.hash ? ` hash=${version.hash.slice(0, 8)}` : "";
        return `${index + 1}. ${version.checkpointId}  ${version.created}${state}${origin}${hash}  ${version.description}`;
      })
      .join("\n");
    return [
      {
        name: "workspace-checkpoint",
        description: `Listed ${versions.length} version${versions.length === 1 ? "" : "s"}`,
        content: `File history for ${relativePath} (follow=${follow ? "on" : "off"}). No files written.\n${content}`,
      },
    ];
  }

  if (action === "bisect_start") {
    const badId = requireCheckpointId(args);
    if (typeof extras.ide.startWorkspaceCheckpointBisect !== "function") {
      return unavailable("bisect_start");
    }
    const goodId = typeof args.good_checkpoint_id === "string" ? args.good_checkpoint_id.trim() : undefined;
    const result = await extras.ide.startWorkspaceCheckpointBisect({ badId, goodId });
    return [{
      name: "workspace-checkpoint",
      description: result.success ? (result.done ? "found" : "started") : "failed",
      content: result.success
        ? (result.firstBadId
          ? `First bad checkpoint is ${result.firstBadId}.`
          : `Bisecting; current ${result.currentId} (${result.remaining} left).`)
        : `Could not start bisect: ${result.message || "unknown error"}`,
    }];
  }

  if (action === "bisect_good" || action === "bisect_bad" || action === "bisect_skip") {
    if (typeof extras.ide.markWorkspaceCheckpointBisect !== "function") {
      return unavailable(action);
    }
    const verdict = action === "bisect_good" ? "good" : action === "bisect_skip" ? "skip" : "bad";
    const result = await extras.ide.markWorkspaceCheckpointBisect({ verdict });
    return [{
      name: "workspace-checkpoint",
      description: result.success ? (result.done ? "found" : "stepped") : "failed",
      content: result.success
        ? (result.firstBadId
          ? `First bad checkpoint is ${result.firstBadId}.`
          : `Marked ${verdict}; current ${result.currentId} (${result.remaining} left).`)
        : `Could not mark bisect: ${result.message || "unknown error"}`,
    }];
  }

  if (action === "bisect_reset") {
    if (typeof extras.ide.resetWorkspaceCheckpointBisect !== "function") {
      return unavailable("bisect_reset");
    }
    const result = await extras.ide.resetWorkspaceCheckpointBisect();
    return [{
      name: "workspace-checkpoint",
      description: result.success ? "reset" : "failed",
      content: result.success ? "Bisect cleared. The main workspace was not rewritten." : `Could not reset bisect: ${result.message || "unknown error"}`,
    }];
  }

  if (action === "bisect_run") {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (!command) {
      throw new Error(t("missingRequiredParam", { param: "command" }));
    }
    if (typeof extras.ide.runWorkspaceCheckpointBisect !== "function") {
      return unavailable("bisect_run");
    }
    const result = await extras.ide.runWorkspaceCheckpointBisect({ command });
    return [{
      name: "workspace-checkpoint",
      description: result.success ? (result.done ? "found" : "ran") : "failed",
      content: result.success
        ? (result.firstBadId
          ? `First bad checkpoint is ${result.firstBadId} after ${result.steps} step(s).`
          : `Bisect still running (${result.remaining} left).`)
        : `Could not run bisect: ${result.message || "unknown error"}`,
    }];
  }

  if (action === "list_worktrees") {
    if (typeof extras.ide.listWorkspaceCheckpointWorktrees !== "function") {
      return unavailable("list_worktrees");
    }
    const rows = await extras.ide.listWorkspaceCheckpointWorktrees();
    if (rows.length === 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "listed 0 worktrees",
          content: "No isolated checkpoint worktrees.",
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: `Listed ${rows.length} worktree${rows.length === 1 ? "" : "s"}`,
        content: rows
          .map((row, index) => `${index + 1}. ${row.id}  ${row.checkpointId}  ${row.path}  files=${row.fileCount}`)
          .join("\n"),
      },
    ];
  }

  if (action === "materialize_worktree") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.materializeWorkspaceCheckpointWorktree !== "function") {
      return unavailable("materialize_worktree");
    }
    const result = await extras.ide.materializeWorkspaceCheckpointWorktree({ checkpointId });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "materialized" : "failed",
        content: result.success
          ? `Opened worktree ${result.worktreeId} at ${result.path} (${result.fileCount ?? 0} files).`
          : `Could not materialize ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "remove_worktree") {
    const worktreeId =
      typeof args.worktree_id === "string"
        ? args.worktree_id.trim()
        : typeof args.stash_id === "string"
          ? args.stash_id.trim()
          : "";
    if (!worktreeId) {
      throw new Error(t("missingRequiredParam", { param: "worktree_id" }));
    }
    if (typeof extras.ide.removeWorkspaceCheckpointWorktree !== "function") {
      return unavailable("remove_worktree");
    }
    const result = await extras.ide.removeWorkspaceCheckpointWorktree({ worktreeId });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "removed" : "failed",
        content: result.success
          ? `Removed worktree ${worktreeId}.`
          : `Could not remove ${worktreeId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "export_patch") {
    const checkpointId = requireCheckpointId(args);
    if (typeof extras.ide.exportWorkspaceCheckpointPatch !== "function") {
      return unavailable("export_patch");
    }
    const result = await extras.ide.exportWorkspaceCheckpointPatch({ checkpointId });
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "exported" : "failed",
        content: result.success
          ? `${result.patch ?? ""}\nNo files written.`
          : `Could not export patch for ${checkpointId}: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "apply_patch") {
    const patch =
      typeof args.patch === "string"
        ? args.patch
        : typeof args.patch_text === "string"
          ? args.patch_text
          : "";
    if (!patch.trim()) {
      throw new Error(t("missingRequiredParam", { param: "patch" }));
    }
    if (typeof extras.ide.applyWorkspaceCheckpointPatch !== "function") {
      return unavailable("apply_patch");
    }
    const result = await extras.ide.applyWorkspaceCheckpointPatch({ patch });
    if (result.conflicts.length > 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "conflicts",
          content: `Patch stopped; working tree unchanged. Conflicts: ${result.conflicts.map((conflict) => conflict.path).join(", ")}`,
        },
      ];
    }
    return [
      {
        name: "workspace-checkpoint",
        description: result.success ? "applied" : "failed",
        content: result.success
          ? `Applied patch as ${result.checkpointId}. ${formatRestoredFiles([
              ...(result.restoredFiles ?? []),
              ...(result.removedFiles ?? []),
            ])}.`
          : `Could not apply patch: ${result.message || "unknown error"}`,
      },
    ];
  }

  if (action === "blame") {
    const relativePath =
      typeof args.path === "string"
        ? args.path.trim()
        : typeof args.relative_path === "string"
          ? args.relative_path.trim()
          : "";
    if (!relativePath) {
      throw new Error(t("missingRequiredParam", { param: "path" }));
    }
    if (typeof extras.ide.blameWorkspaceCheckpoint !== "function") {
      return unavailable("blame");
    }
    const atCheckpointId =
      typeof args.at_checkpoint_id === "string" && args.at_checkpoint_id.trim()
        ? args.at_checkpoint_id.trim()
        : undefined;
    const result = await extras.ide.blameWorkspaceCheckpoint({
      path: relativePath,
      atCheckpointId,
    });
    if (result.unsupported) {
      return [
        {
          name: "workspace-checkpoint",
          description: "unsupported",
          content: `Blame is not available for ${relativePath} (${result.unsupported}).`,
        },
      ];
    }
    if (result.ranges.length === 0) {
      return [
        {
          name: "workspace-checkpoint",
          description: "listed 0 ranges",
          content: `No blame ranges for ${relativePath}.`,
        },
      ];
    }
    const content = result.ranges
      .map((range) => {
        const span = range.startLine === range.endLine
          ? `${range.startLine}`
          : `${range.startLine}-${range.endLine}`;
        const id = range.checkpointId ?? "unknown";
        const title = range.label || range.description || "";
        const origin = range.originPath && range.originPath !== relativePath
          ? ` was=${range.originPath}`
          : "";
        return `${span}  ${id}${title ? `  ${title}` : ""}${origin}`;
      })
      .join("\n");
    return [
      {
        name: "workspace-checkpoint",
        description: `Listed ${result.ranges.length} range${result.ranges.length === 1 ? "" : "s"}`,
        content: `Blame for ${relativePath}${atCheckpointId ? ` at ${atCheckpointId}` : ""}. No files written.\n${content}`,
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
