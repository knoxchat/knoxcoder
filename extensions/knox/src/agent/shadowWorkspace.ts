import * as path from "path";

/** VS Code setting that gates optional pre-apply shadow preview. */
export const SHADOW_PREVIEW_SETTING = "knoxchat.enableShadowPreview";
/** When true, shadow preview still runs on files larger than SHADOW_LARGE_FILE_LINE_LIMIT. */
export const SHADOW_PREVIEW_LARGE_FILES_SETTING =
  "knoxchat.shadowPreviewLargeFiles";
export const SHADOW_LARGE_FILE_LINE_LIMIT = 4000;

export type ShadowDecision = "accept" | "reject";

export interface PendingShadowEdit {
  /** Absolute filesystem path of the real file. */
  originalPath: string;
  /** Absolute path of the shadow copy holding proposed content. */
  shadowPath: string;
  proposedContent: string;
  streamId?: string;
}

/**
 * Resolve a stable absolute path for map keys / comparisons.
 */
export function normalizeFsPath(filePath: string): string {
  if (!filePath) {
    return filePath;
  }
  // Strip file:// if present without pulling in vscode in pure helpers.
  let p = filePath;
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//, ""));
      // Windows: /C:/... → C:/...
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1);
      }
    } catch {
      p = filePath;
    }
  }
  return path.normalize(p);
}

/**
 * Relative path under the shadow root that mirrors workspace layout.
 * Falls back to basename when the file is outside the workspace root.
 */
export function resolveShadowRelativePath(
  originalPath: string,
  workspaceRoot?: string | null,
): string {
  const absolute = normalizeFsPath(originalPath);
  if (workspaceRoot) {
    const root = normalizeFsPath(workspaceRoot);
    const relative = path.relative(root, absolute);
    if (
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    ) {
      return relative;
    }
  }
  // Preserve uniqueness for out-of-workspace files.
  const hash = absolute
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-120);
  return path.join("_external", hash || path.basename(absolute));
}

export function isShadowPreviewEnabled(
  getConfig: (key: string) => unknown,
): boolean {
  return getConfig(SHADOW_PREVIEW_SETTING) === true;
}

/**
 * Whether shadow preview should gate an applyToFile call.
 * Skip for new/empty documents (those already use a fast insert path).
 */
export function shouldPreviewApply(args: {
  enabled: boolean;
  fileExists: boolean;
  currentContent: string;
  proposedContent: string;
  allowLargeFiles?: boolean;
}): boolean {
  if (!args.enabled || !args.fileExists) {
    return false;
  }
  if (!args.currentContent.trim()) {
    return false;
  }
  if (args.currentContent === args.proposedContent) {
    return false;
  }
  const lines = args.currentContent.split(/\r?\n/).length;
  if (lines > SHADOW_LARGE_FILE_LINE_LIMIT && !args.allowLargeFiles) {
    return false;
  }
  return true;
}
