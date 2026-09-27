/**
 * KN-343: vscode-free shadow preview engine.
 *
 * Chat Apply optionally stages proposed content in a temp tree, opens
 * side-by-side `vscode.diff` (original | proposed), then Accept continues
 * the vertical-diff apply path and Reject discards. Files over
 * SHADOW_LARGE_FILE_LINE_LIMIT skip unless shadowPreviewLargeFiles is on.
 */

import * as path from "path";

/** VS Code setting that gates optional pre-apply shadow preview. */
export const SHADOW_PREVIEW_SETTING = "knoxchat.enableShadowPreview";
/** When true, shadow preview still runs on files larger than SHADOW_LARGE_FILE_LINE_LIMIT. */
export const SHADOW_PREVIEW_LARGE_FILES_SETTING =
  "knoxchat.shadowPreviewLargeFiles";
export const SHADOW_LARGE_FILE_LINE_LIMIT = 4000;

export const VSCODE_DIFF_COMMAND = "vscode.diff";
export const SHADOW_DIFF_VISIBLE_CONTEXT = "knox.shadowDiffVisible";

export const SHADOW_PREVIEW_COMMANDS = {
  accept: "knox.acceptShadowChanges",
  reject: "knox.rejectShadowChanges",
  apply: "knox.applyShadowChanges",
  showDiff: "knox.showDiff",
  showDiffView: "knox.showDiffView",
  closeDiffView: "knox.closeDiffView",
} as const;

export type ShadowDecision = "accept" | "reject";

export interface PendingShadowEdit {
  /** Absolute filesystem path of the real file. */
  originalPath: string;
  /** Absolute path of the shadow copy holding proposed content. */
  shadowPath: string;
  proposedContent: string;
  streamId?: string;
}

/** Arguments for `vscode.diff` — original on the left, proposed on the right. */
export interface ShadowDiffOpen {
  command: typeof VSCODE_DIFF_COMMAND;
  originalPath: string;
  shadowPath: string;
  titleFile: string;
}

export type ShadowTargetResolution =
  | { kind: "found"; originalPath: string }
  | { kind: "none" }
  | { kind: "pick"; originalPaths: string[] };

export type ShadowAcceptRoute = "waiter" | "apply-handler" | "raw-write";

export type ApplyShadowCommandAction =
  | "accept-path"
  | "accept-all"
  | "accept-current";

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

export function isShadowPreviewLargeFilesEnabled(
  getConfig: (key: string) => unknown,
): boolean {
  return getConfig(SHADOW_PREVIEW_LARGE_FILES_SETTING) === true;
}

export function countFileLines(content: string): number {
  return content.split(/\r?\n/).length;
}

/**
 * Whether shadow preview should gate an applyToFile call.
 * Skip for new/empty documents (those already use a fast insert path).
 * Skip files over SHADOW_LARGE_FILE_LINE_LIMIT unless allowLargeFiles.
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
  if (
    countFileLines(args.currentContent) > SHADOW_LARGE_FILE_LINE_LIMIT &&
    !args.allowLargeFiles
  ) {
    return false;
  }
  return true;
}

export function buildShadowDiffOpen(
  pending: PendingShadowEdit,
): ShadowDiffOpen {
  return {
    command: VSCODE_DIFF_COMMAND,
    originalPath: pending.originalPath,
    shadowPath: pending.shadowPath,
    titleFile: path.basename(pending.originalPath),
  };
}

/**
 * Resolve which pending shadow edit Accept/Reject/Show Diff should target.
 * Active editor may be the original file or the shadow (diff right-hand side).
 */
export function resolveShadowTarget(args: {
  requestedPath?: string;
  activeFsPath?: string;
  pending: readonly Pick<PendingShadowEdit, "originalPath" | "shadowPath">[];
}): ShadowTargetResolution {
  if (args.requestedPath) {
    return {
      kind: "found",
      originalPath: normalizeFsPath(args.requestedPath),
    };
  }
  if (args.activeFsPath) {
    const normalized = normalizeFsPath(args.activeFsPath);
    for (const item of args.pending) {
      if (
        item.originalPath === normalized ||
        normalizeFsPath(item.shadowPath) === normalized
      ) {
        return { kind: "found", originalPath: item.originalPath };
      }
    }
  }
  if (args.pending.length === 1) {
    return { kind: "found", originalPath: args.pending[0].originalPath };
  }
  if (args.pending.length > 1) {
    return {
      kind: "pick",
      originalPaths: args.pending.map((item) => item.originalPath),
    };
  }
  return { kind: "none" };
}

/**
 * Accept with a waiter (applyToFile / previewEdit) only resolves — the
 * caller continues the chat apply path and must not raw-write the original.
 */
export function decideShadowAcceptRoute(args: {
  hasWaiter: boolean;
  hasApplyHandler: boolean;
}): ShadowAcceptRoute {
  if (args.hasWaiter) {
    return "waiter";
  }
  if (args.hasApplyHandler) {
    return "apply-handler";
  }
  return "raw-write";
}

/**
 * `knox.applyShadowChanges`: a path argument accepts that file; otherwise
 * accept-all when several are pending, else the current/single target.
 */
export function decideApplyShadowCommand(args: {
  filePath?: string;
  pendingCount: number;
}): ApplyShadowCommandAction {
  if (args.filePath) {
    return "accept-path";
  }
  if (args.pendingCount > 1) {
    return "accept-all";
  }
  return "accept-current";
}

export function shadowDiffContextVisible(pendingCount: number): boolean {
  return pendingCount > 0;
}

/**
 * Pending shadow edits + Accept/Reject waiters. vscode-free so Accept
 * routing can be unit-tested without opening a diff editor.
 */
export class ShadowPreviewStore {
  private readonly pending = new Map<string, PendingShadowEdit>();
  private readonly waiters = new Map<
    string,
    (decision: ShadowDecision) => void
  >();

  get size(): number {
    return this.pending.size;
  }

  keys(): string[] {
    return [...this.pending.keys()];
  }

  values(): PendingShadowEdit[] {
    return [...this.pending.values()];
  }

  get(originalPath: string): PendingShadowEdit | undefined {
    return this.pending.get(normalizeFsPath(originalPath));
  }

  upsert(edit: PendingShadowEdit): void {
    const key = normalizeFsPath(edit.originalPath);
    const prev = this.pending.get(key);
    this.pending.set(key, {
      ...edit,
      originalPath: key,
      streamId: edit.streamId ?? prev?.streamId,
    });
  }

  delete(originalPath: string): PendingShadowEdit | undefined {
    const key = normalizeFsPath(originalPath);
    const prev = this.pending.get(key);
    this.pending.delete(key);
    return prev;
  }

  clear(): void {
    this.pending.clear();
    this.waiters.clear();
  }

  setWaiter(
    originalPath: string,
    resolve: (decision: ShadowDecision) => void,
  ): void {
    this.waiters.set(normalizeFsPath(originalPath), resolve);
  }

  hasWaiter(originalPath: string): boolean {
    return this.waiters.has(normalizeFsPath(originalPath));
  }

  takeWaiter(
    originalPath: string,
  ): ((decision: ShadowDecision) => void) | undefined {
    const key = normalizeFsPath(originalPath);
    const waiter = this.waiters.get(key);
    this.waiters.delete(key);
    return waiter;
  }

  rejectAllWaiters(): void {
    for (const resolve of this.waiters.values()) {
      resolve("reject");
    }
    this.waiters.clear();
  }

  contextVisible(): boolean {
    return shadowDiffContextVisible(this.pending.size);
  }
}
