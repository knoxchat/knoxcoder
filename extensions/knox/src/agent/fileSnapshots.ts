import * as path from "node:path";

import { extractPatchFilePaths } from "core/tools/applyPatchFormat";
import * as vscode from "vscode";

/** Tools that mutate workspace files and support snapshot undo/redo. */
export const MUTATING_TOOL_NAMES = new Set([
  "builtin_create_new_file",
  "builtin_edit_file",
  "builtin_write_file",
  "builtin_apply_patch",
  "composite_smart_edit",
  "builtin_generate_tests",
]);

export interface FileContentSnapshot {
  uri: vscode.Uri;
  /** null means the file did not exist at snapshot time */
  content: Uint8Array | null;
}

/**
 * Parse tool-call arguments that may arrive as a JSON string or object.
 */
export function parseToolArguments(
  args: unknown,
): Record<string, unknown> | null {
  if (args == null) {
    return null;
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return null;
}

/**
 * Extract a workspace file path from known mutating-tool argument shapes.
 */
export function extractMutatingFilePath(
  toolName: string,
  args: Record<string, unknown> | null,
): string | undefined {
  if (!args || !MUTATING_TOOL_NAMES.has(toolName)) {
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

  // Test generation mutates the output test file, not the source filepath.
  if (toolName === "builtin_generate_tests") {
    const outputCandidates = [
      args.outputPath,
      args.output_path,
      args.test_file_path,
    ];
    for (const candidate of outputCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return undefined;
  }

  const candidates = [
    args.target_file,
    args.filepath,
    args.file_path,
    args.path,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

/** All workspace paths a mutating tool may touch (apply_patch can be multi-file). */
export function extractMutatingFilePaths(
  toolName: string,
  args: Record<string, unknown> | null,
): string[] {
  if (!args || !MUTATING_TOOL_NAMES.has(toolName)) {
    return [];
  }
  if (toolName === "builtin_apply_patch") {
    const patch =
      typeof args.patch === "string"
        ? args.patch
        : typeof args.diff === "string"
          ? args.diff
          : "";
    return extractPatchFilePaths(patch);
  }
  const single = extractMutatingFilePath(toolName, args);
  return single ? [single] : [];
}

/**
 * Resolve a tool file path (absolute, file URI, or workspace-relative) to a Uri.
 */
export function resolveFileUri(filePath: string): vscode.Uri {
  if (filePath.startsWith("file://") || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(filePath)) {
    return vscode.Uri.parse(filePath);
  }

  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return vscode.Uri.file(path.resolve(workspaceRoot, filePath));
  }

  return vscode.Uri.file(path.resolve(filePath));
}

/**
 * Read current file bytes, or null if the file does not exist.
 */
export async function captureFileSnapshot(
  filePath: string,
): Promise<FileContentSnapshot> {
  const uri = resolveFileUri(filePath);
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    return { uri, content: new Uint8Array(content) };
  } catch {
    return { uri, content: null };
  }
}

/**
 * Restore a file to a prior snapshot (create/overwrite or delete).
 */
export async function restoreFileSnapshot(
  snapshot: FileContentSnapshot,
): Promise<void> {
  if (snapshot.content === null) {
    try {
      await vscode.workspace.fs.delete(snapshot.uri, { useTrash: false });
    } catch (error) {
      // Already gone is success for "did not exist" restore.
      if (isFileNotFoundError(error)) {
        return;
      }
      // If delete failed for another reason, rethrow unless file is already absent.
      try {
        await vscode.workspace.fs.stat(snapshot.uri);
      } catch {
        return;
      }
      throw error;
    }
    return;
  }

  const dir = vscode.Uri.joinPath(snapshot.uri, "..");
  try {
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    // Directory may already exist.
  }
  await vscode.workspace.fs.writeFile(snapshot.uri, snapshot.content);
  await reloadOpenEditorsFromDisk(snapshot.uri);
}

function isFileNotFoundError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code === "FileNotFound" || code === "EntryNotFound") {
    return true;
  }
  return (
    error instanceof vscode.FileSystemError &&
    (error.code === "FileNotFound" || error.code === "EntryNotFound")
  );
}

/** Reload open text editors so undo/redo is visible immediately. */
async function reloadOpenEditorsFromDisk(uri: vscode.Uri): Promise<void> {
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.toString() !== uri.toString() || doc.isClosed) {
      continue;
    }
    try {
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: true,
      });
      await vscode.commands.executeCommand("workbench.action.files.revert");
    } catch {
      // Best-effort: disk restore already succeeded.
    }
  }
}

export function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOL_NAMES.has(toolName);
}
