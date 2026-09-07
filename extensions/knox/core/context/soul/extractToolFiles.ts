import { extractPatchFilePaths } from "../../tools/applyPatchFormat.js";
import { parseToolArgs } from "../../tools/postEditVerification.js";

const PATH_KEYS = [
  "filepath",
  "file_path",
  "target_file",
  "path",
  "outputPath",
  "output_path",
  "test_file_path",
  "directory_path",
  "target_directory",
] as const;

/**
 * Collect workspace paths a tool call touched so SoulEvents can name files
 * without parsing assistant prose.
 */
export function extractSoulFiles(toolName: string, args: unknown): string[] {
  const parsed = parseToolArgs(args);
  if (!parsed) {
    return [];
  }

  const files = new Set<string>();

  if (toolName === "builtin_apply_patch") {
    const patch =
      typeof parsed.patch === "string"
        ? parsed.patch
        : typeof parsed.diff === "string"
          ? parsed.diff
          : "";
    for (const path of extractPatchFilePaths(patch)) {
      if (path.trim()) {
        files.add(path.trim());
      }
    }
  }

  for (const key of PATH_KEYS) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      files.add(value.trim());
    }
  }

  if (Array.isArray(parsed.paths)) {
    for (const value of parsed.paths) {
      if (typeof value === "string" && value.trim()) {
        files.add(value.trim());
      }
    }
  }

  return [...files];
}

export function formatSoulEventContent(event: {
  kind: string;
  toolName?: string;
  files: string[];
  workspaceCheckpointId?: string;
  ok: boolean;
  summary: string;
}): string {
  const files =
    event.files.length > 0 ? event.files.join(", ") : "(no paths recorded)";
  const cp = event.workspaceCheckpointId
    ? ` checkpoint=${event.workspaceCheckpointId}`
    : "";
  const tool = event.toolName ? ` tool=${event.toolName}` : "";
  return `[soul ${event.kind}]${tool}${cp} ok=${event.ok} files=${files}\n${event.summary}`.trim();
}

const SOUL_CHECKPOINT_RE = /\[soul checkpoint=([^\s\]]+)\]/;

/** Read a workspace CP id stamped onto a tool result or soul event body. */
export function extractSoulCheckpointId(
  content: string | Array<{ content?: string }> | undefined,
): string | undefined {
  if (!content) {
    return undefined;
  }
  if (typeof content === "string") {
    return content.match(SOUL_CHECKPOINT_RE)?.[1];
  }
  for (const item of content) {
    const id = item.content?.match(SOUL_CHECKPOINT_RE)?.[1];
    if (id) {
      return id;
    }
  }
  return undefined;
}

export function formatSoulCheckpointStamp(checkpointId: string): string {
  return `[soul checkpoint=${checkpointId}]`;
}

/**
 * Point the agent at the paired workspace CP after a memory rewind.
 * Restore stays explicit — this is an offer, not an auto-rewind.
 */
export function formatLinkedRestoreOffer(
  workspaceCheckpointId?: string,
): string {
  if (!workspaceCheckpointId) {
    return "";
  }
  return [
    `Linked workspace checkpoint: ${workspaceCheckpointId}.`,
    `Restore files with builtin_workspace_checkpoint action=restore checkpoint_id=${workspaceCheckpointId} if you also want the disk to match this memory rewind.`,
  ].join(" ");
}

/** Compact list of settled tools so post-turn memory sees paths, not only prose. */
export function formatSettledToolSummary(
  tools: Array<{
    name?: string;
    status?: string;
    files?: string[];
    ok?: boolean;
  }>,
): string {
  if (tools.length === 0) {
    return "";
  }
  const lines = tools.map((tool) => {
    const name = tool.name || "tool";
    const ok = tool.ok ?? tool.status === "done";
    const status =
      tool.status && tool.status !== "done" ? ` status=${tool.status}` : "";
    const files = tool.files?.length
      ? ` files=${tool.files.slice(0, 8).join(", ")}`
      : "";
    return `- ${name} ${ok ? "ok" : "fail"}${status}${files}`;
  });
  return ["## Tools this turn", ...lines].join("\n");
}

export function formatRestoreNotice(input: {
  checkpointId: string;
  description?: string;
  restoredFiles: string[];
  memoryRewound?: boolean;
  memoryMessage?: string;
}): string {
  const files =
    input.restoredFiles.length > 0
      ? input.restoredFiles.slice(0, 20).join(", ")
      : "(see checkpoint details)";
  const extra =
    input.restoredFiles.length > 20
      ? ` (+${input.restoredFiles.length - 20} more)`
      : "";
  const memoryLine = input.memoryRewound
    ? [
        "Working memory was rewound to this checkpoint.",
        input.memoryMessage || "",
      ]
        .filter(Boolean)
        .join(" ")
    : [
        "Memory was not rewound.",
        `Use builtin_workspace_checkpoint action=restore checkpoint_id=${input.checkpointId} rewind_memory=true if you also want working memory to match this disk state.`,
      ].join(" ");
  return [
    "## Workspace restore",
    `The workspace was restored to checkpoint ${input.checkpointId}${
      input.description ? ` (${input.description})` : ""
    }.`,
    `Restored files: ${files}${extra}`,
    memoryLine,
    "Do not assume later edits still exist. Re-read files before editing.",
  ].join("\n");
}
