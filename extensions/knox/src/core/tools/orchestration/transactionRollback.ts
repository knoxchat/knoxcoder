/**
 * Default file-state capture + rollback for ToolTransaction.
 * Used when callers do not supply an explicit rollback handler.
 */

import type { IDE } from "../..";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { createKnoxLogger } from "../../util/knoxLog";
import { extractPatchFilePaths } from "../applyPatchFormat";

const log = createKnoxLogger("ToolTransaction");

/** Tools whose args point at a file we can restore/delete on rollback. */
const FILE_MUTATING_TOOLS = new Set([
  "builtin_create_new_file",
  "builtin_edit_file",
  "builtin_write_file",
  "builtin_apply_patch",
  "composite_smart_edit",
  "builtin_generate_tests",
]);

export interface PriorFileState {
  /** Resolved file URI when possible, else original path string. */
  filepath: string;
  existed: boolean;
  /** Prior text content when the file existed; null if it did not. */
  content: string | null;
}

export function isFileMutatingTool(toolName: string): boolean {
  return FILE_MUTATING_TOOLS.has(toolName);
}

/**
 * Extract the workspace file path from known mutating-tool argument shapes.
 */
export function extractTransactionFilePath(
  toolName: string,
  args: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!args || !isFileMutatingTool(toolName)) {
    return undefined;
  }

  if (toolName === "builtin_apply_patch") {
    const patch =
      typeof args.patch === "string"
        ? args.patch
        : typeof args.diff === "string"
          ? args.diff
          : "";
    return extractPatchFilePaths(patch)[0];
  }

  if (toolName === "builtin_generate_tests") {
    for (const key of ["outputPath", "output_path", "test_file_path"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  for (const key of ["filepath", "target_file", "file_path", "path"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

async function resolveFileUri(
  filepath: string,
  ide: IDE,
): Promise<string> {
  try {
    return await inferResolvedUriFromRelativePath(filepath, ide);
  } catch {
    return filepath;
  }
}

/**
 * Snapshot file existence + content before a mutating tool runs.
 */
export async function capturePriorFileState(
  toolName: string,
  args: Record<string, unknown>,
  ide: IDE,
): Promise<PriorFileState | null> {
  const rawPath = extractTransactionFilePath(toolName, args);
  if (!rawPath) {
    return null;
  }

  const filepath = await resolveFileUri(rawPath, ide);
  try {
    const existed = await ide.fileExists(filepath);
    if (!existed) {
      return { filepath, existed: false, content: null };
    }
    const content = await ide.readFile(filepath);
    return { filepath, existed: true, content };
  } catch (error) {
    log.warn(
      `Failed to capture prior state for ${filepath}:`,
      error instanceof Error ? error.message : String(error),
    );
    return { filepath, existed: false, content: null };
  }
}

/**
 * Restore prior file state after a failed transaction.
 * - Created files (did not exist) → removeFile when available
 * - Edited/overwritten files → write prior content back
 * - Deleted files → rewrite prior content
 */
export async function applyDefaultFileRollback(
  toolName: string,
  args: Record<string, unknown>,
  prior: PriorFileState | null | undefined,
  ide: IDE,
): Promise<void> {
  if (!isFileMutatingTool(toolName)) {
    if (toolName === "builtin_run_terminal_command") {
      log.warn(
        `Cannot automatically rollback terminal command: ${String(args.command ?? "")}`,
      );
    }
    return;
  }

  if (!prior) {
    log.warn(
      `No prior file state for ${toolName}; cannot auto-rollback. Provide an explicit rollback handler.`,
    );
    return;
  }

  if (!prior.existed) {
    if (typeof ide.removeFile === "function") {
      try {
        const stillThere = await ide.fileExists(prior.filepath);
        if (stillThere) {
          await ide.removeFile(prior.filepath);
        }
        return;
      } catch (error) {
        throw new Error(
          `Failed to delete created file during rollback (${prior.filepath}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    throw new Error(
      `Cannot auto-rollback file creation for ${prior.filepath}: IDE.removeFile is not available. Provide an explicit rollback handler.`,
    );
  }

  // File existed before — restore prior contents (covers edit + overwrite + delete).
  await ide.writeFile(prior.filepath, prior.content ?? "");
}
