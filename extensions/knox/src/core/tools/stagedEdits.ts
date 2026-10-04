/**
 * Staged review (K-026): while "Review edits" is on, file writes made by the
 * agent tools are held in memory instead of going to disk. Tools still see
 * their own staged content (read, exists, range reads), so a second edit of
 * the same file works. The user reviews the multi-file diff, then applies or
 * discards. Shell commands run against the real disk and do not see staged
 * files.
 */

import { diffLines } from "diff";

import type { IDE } from "..";
import { checkStagedApplyTarget } from "./toolPolicy";

export interface StagedFile {
  /** Content on disk when first staged; null if the file did not exist. */
  before: string | null;
  /** Staged content; null if staged for deletion. */
  after: string | null;
}

export type StagedKind = "create" | "modify" | "delete";

export interface StagedSummary {
  fileUri: string;
  kind: StagedKind;
  added: number;
  removed: number;
}

export class StagedEdits {
  readonly files = new Map<string, StagedFile>();
  /** Called after a tool write changes staged content (used to persist). */
  onChange?: () => void;

  get size(): number {
    return this.files.size;
  }
}

const lines = (text: string | null): string[] => {
  if (text === null || text === "") {
    return [];
  }
  const parts = text.split(/\r?\n/);
  if (parts[parts.length - 1] === "") {
    parts.pop(); // trailing newline is not a line
  }
  return parts;
};

/** Line-multiset diff counts (cheap, order-insensitive; enough for a summary). */
function diffCounts(
  before: string | null,
  after: string | null,
): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of lines(before)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  let added = 0;
  for (const line of lines(after)) {
    const n = counts.get(line) ?? 0;
    if (n > 0) {
      counts.set(line, n - 1);
    } else {
      added++;
    }
  }
  let removed = 0;
  for (const n of counts.values()) {
    removed += n;
  }
  return { added, removed };
}

export function stagedKind(file: StagedFile): StagedKind {
  if (file.after === null) {
    return "delete";
  }
  return file.before === null ? "create" : "modify";
}

/** Staged files whose content is back to what is on disk are dropped from the list. */
export function listStaged(staged: StagedEdits): StagedSummary[] {
  const out: StagedSummary[] = [];
  for (const [fileUri, file] of staged.files) {
    if (file.before === file.after) {
      continue;
    }
    const { added, removed } = diffCounts(file.before, file.after);
    out.push({ fileUri, kind: stagedKind(file), added, removed });
  }
  return out;
}

async function currentOnDisk(ide: IDE, fileUri: string): Promise<string | null> {
  try {
    if (!(await ide.fileExists(fileUri))) {
      return null;
    }
    return await ide.readFile(fileUri);
  } catch {
    return null;
  }
}

type RangeLike = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

function sliceRange(content: string, range: RangeLike): string {
  const all = content.split("\n");
  const picked = all.slice(range.start.line, range.end.line + 1);
  if (picked.length === 0) {
    return "";
  }
  picked[picked.length - 1] = picked[picked.length - 1].slice(
    0,
    range.end.character,
  );
  picked[0] = picked[0].slice(range.start.character);
  return picked.join("\n");
}

export function wrapIdeForStaging(ide: IDE, staged: StagedEdits): IDE {
  return new Proxy(ide, {
    get(target, prop, receiver) {
      switch (prop) {
        case "readFile":
          return async (fileUri: string) => {
            const file = staged.files.get(fileUri);
            if (file) {
              if (file.after === null) {
                throw new Error(`File not found: ${fileUri}`);
              }
              return file.after;
            }
            return target.readFile(fileUri);
          };
        case "readRangeInFile":
          return async (fileUri: string, range: RangeLike) => {
            const file = staged.files.get(fileUri);
            if (file) {
              if (file.after === null) {
                throw new Error(`File not found: ${fileUri}`);
              }
              return sliceRange(file.after, range);
            }
            return (target as any).readRangeInFile(fileUri, range);
          };
        case "fileExists":
          return async (fileUri: string) => {
            const file = staged.files.get(fileUri);
            return file ? file.after !== null : target.fileExists(fileUri);
          };
        case "writeFile":
          return async (fileUri: string, contents: string) => {
            const existing = staged.files.get(fileUri);
            if (existing) {
              existing.after = contents;
              staged.onChange?.();
              return;
            }
            staged.files.set(fileUri, {
              before: await currentOnDisk(target, fileUri),
              after: contents,
            });
            staged.onChange?.();
          };
        case "removeFile":
          return async (fileUri: string) => {
            const existing = staged.files.get(fileUri);
            if (existing) {
              existing.after = null;
              staged.onChange?.();
              return;
            }
            staged.files.set(fileUri, {
              before: await currentOnDisk(target, fileUri),
              after: null,
            });
            staged.onChange?.();
          };
        case "openFile":
        case "saveFile":
          // Nothing on disk to open or save for a staged file.
          return async (fileUri: string, ...rest: unknown[]) => {
            if (staged.files.has(fileUri)) {
              return;
            }
            return (target as any)[prop](fileUri, ...rest);
          };
        default: {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
}

export interface ApplyStagedResult {
  applied: string[];
  failed: Array<{ fileUri: string; error: string }>;
}

/**
 * Write staged files to disk (all, or only `fileUris`). Applied files leave the
 * staging area; failed ones stay so the user can retry.
 */
export async function applyStaged(
  ide: IDE,
  staged: StagedEdits,
  fileUris?: string[],
  /** Workspace roots the staged paths belong to; defaults to `ide.getWorkspaceDirs()`. */
  workspaceRoots?: string[],
): Promise<ApplyStagedResult> {
  const only = fileUris ? new Set(fileUris) : null;
  const result: ApplyStagedResult = { applied: [], failed: [] };
  let workspaceDirs: string[] = workspaceRoots ?? [];
  try {
    if (!workspaceRoots) {
      workspaceDirs = (await ide.getWorkspaceDirs()) ?? [];
    }
  } catch {
    // No workspace info: only hard-denied paths are checked.
  }
  for (const [fileUri, file] of [...staged.files]) {
    if (only && !only.has(fileUri)) {
      continue;
    }
    try {
      if (file.before !== file.after) {
        const refused = checkStagedApplyTarget(fileUri, workspaceDirs);
        if (refused) {
          throw new Error(refused);
        }
        if (file.after === null) {
          await (ide as any).removeFile(fileUri);
        } else {
          await ide.writeFile(fileUri, file.after);
        }
        result.applied.push(fileUri);
      }
      staged.files.delete(fileUri);
    } catch (error) {
      result.failed.push({
        fileUri,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** Drop staged files (all, or only `fileUris`) without touching disk. */
export function discardStaged(
  staged: StagedEdits,
  fileUris?: string[],
): string[] {
  const targets = fileUris ?? [...staged.files.keys()];
  const dropped: string[] = [];
  for (const fileUri of targets) {
    if (staged.files.delete(fileUri)) {
      dropped.push(fileUri);
    }
  }
  return dropped;
}

/** Staged content of one file, for the diff view; undefined if not staged. */
export function stagedContent(
  staged: StagedEdits,
  fileUri: string,
): StagedFile | undefined {
  return staged.files.get(fileUri);
}

/** Unified-style diff of one staged file: `-` removed, `+` added, with a little context. */
export function stagedDiffText(file: StagedFile, context = 2): string {
  const parts = diffLines(file.before ?? "", file.after ?? "");
  const out: string[] = [];
  parts.forEach((part, index) => {
    const body = part.value.replace(/\n$/, "").split("\n");
    if (part.added || part.removed) {
      const mark = part.added ? "+" : "-";
      for (const line of body) {
        out.push(`${mark}${line}`);
      }
      return;
    }
    const head = index === 0 ? 0 : context;
    const tail = index === parts.length - 1 ? 0 : context;
    if (body.length <= head + tail) {
      body.forEach((line) => out.push(` ${line}`));
      return;
    }
    body.slice(0, head).forEach((line) => out.push(` ${line}`));
    out.push("...");
    body.slice(body.length - tail).forEach((line) => out.push(` ${line}`));
  });
  return out.join("\n");
}

const DISK_TOOLS = new Set<string>([
  "builtin_run_terminal_command",
  "builtin_build",
  "builtin_debug",
  "builtin_pty_start",
  "builtin_pty_send",
  "builtin_qemu",
]);

/**
 * Shell/build/test tools run on the real disk, so while edits are staged they
 * see stale files. Returns a note for the model/user, or undefined.
 */
export function stagedDiskNotice(
  toolName: string,
  staged: StagedEdits | undefined,
): string | undefined {
  if (!staged || staged.size === 0 || !DISK_TOOLS.has(toolName)) {
    return undefined;
  }
  const files = [...staged.files.keys()]
    .slice(0, 8)
    .map((uri) => uri.replace(/^file:\/\//, ""))
    .join(", ");
  return `Note: ${staged.size} edit(s) are staged for review and NOT on disk yet (${files}${staged.size > 8 ? ", ..." : ""}). This command ran against the on-disk files, so its result does not include them. Ask the user to apply the staged edits before relying on tests or builds.`;
}
