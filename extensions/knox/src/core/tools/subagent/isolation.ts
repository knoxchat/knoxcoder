/**
 * Worktree isolation + patch merge-back for writing subagents (K-025).
 *
 * Each writer runs in its own git worktree (from HEAD). When it finishes, its
 * changes are captured as a patch and applied to the real workspace under a
 * mutex. A patch that no longer applies (overlapping edits from an earlier
 * writer) is reported as a conflict and kept on disk, never half-applied.
 *
 * Worktrees start at HEAD plus the parent's uncommitted edits (committed as a
 * baseline inside the throwaway worktree), so the child sees current files.
 */

import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile as readLocal,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { IDE } from "../..";
import { localPathOrUriToPath, localPathToUri } from "../../util/pathToUri.js";
import {
  discardAgentWorktree,
  enterAgentWorktree,
  wrapIdeForWorktree,
  type AgentWorktreeState,
} from "../worktree";
import { createMutex } from "./scheduler";

export interface SubagentMergeResult {
  status: "applied" | "conflict" | "no-changes" | "skipped" | "error";
  files: string[];
  patchPath?: string;
  message?: string;
}

const mergeLock = createMutex();

function q(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

async function git(
  ide: IDE,
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const [stdout, stderr] = await ide.subprocess(`git ${args.join(" ")}`, cwd);
    return { ok: true, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: typeof error === "string" ? error : (error as Error).message,
    };
  }
}

/**
 * Copy the parent's uncommitted state (tracked changes and untracked files)
 * into the fresh worktree and commit it as a baseline, so the child sees the
 * parent's current files and its captured patch only holds its own changes.
 * Best effort: on failure the child starts from HEAD and `warning` says so.
 */
export async function seedWorktreeWithLocalChanges(
  ide: IDE,
  state: AgentWorktreeState,
  label: string,
): Promise<{ seeded: number; warning?: string }> {
  const root = localPathOrUriToPath(state.workspaceUri);
  const tracked = await git(ide, root, ["diff", "--binary", "HEAD"]);
  const others = await git(ide, root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const untracked = others.ok
    ? others.stdout.split("\0").filter((f) => f && !f.includes(".."))
    : [];
  if (!tracked.stdout.trim() && !untracked.length) {
    return { seeded: 0 };
  }
  try {
    if (tracked.stdout.trim()) {
      const dir = path.join(os.tmpdir(), "knox-subagent-patches");
      await mkdir(dir, { recursive: true });
      const seedPath = path.join(
        dir,
        `seed-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}.patch`,
      );
      await writeFile(
        seedPath,
        tracked.stdout.endsWith("\n") ? tracked.stdout : `${tracked.stdout}\n`,
      );
      const applied = await git(ide, state.worktreePath, [
        "apply",
        "--whitespace=nowarn",
        q(seedPath),
      ]);
      if (!applied.ok) {
        return {
          seeded: 0,
          warning: `could not copy uncommitted edits into the worktree: ${applied.stderr.trim().split("\n")[0]}`,
        };
      }
    }
    for (const rel of untracked) {
      const dest = path.join(state.worktreePath, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(path.join(root, rel), dest);
    }
    await git(ide, state.worktreePath, ["add", "-A"]);
    const committed = await git(ide, state.worktreePath, [
      "-c",
      "user.name=knox",
      "-c",
      "user.email=knox@localhost",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--no-verify",
      "-m",
      "knox-seed",
    ]);
    if (!committed.ok) {
      return {
        seeded: 0,
        warning: `could not baseline uncommitted edits: ${committed.stderr.trim().split("\n")[0]}`,
      };
    }
    return { seeded: untracked.length + (tracked.stdout.trim() ? 1 : 0) };
  } catch (error) {
    return {
      seeded: 0,
      warning: `could not seed worktree: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Capture everything the child changed (incl. new/deleted files) as a patch. */
export async function captureWorktreePatch(
  ide: IDE,
  state: AgentWorktreeState,
): Promise<{ patch: string; files: string[] }> {
  await git(ide, state.worktreePath, ["add", "-A"]);
  const names = await git(ide, state.worktreePath, [
    "diff",
    "--cached",
    "--no-renames",
    "--name-only",
    "HEAD",
  ]);
  const files = names.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!files.length) {
    return { patch: "", files };
  }
  const diff = await git(ide, state.worktreePath, [
    "diff",
    "--cached",
    "--no-renames",
    "--binary",
    "HEAD",
  ]);
  return { patch: diff.ok ? diff.stdout : "", files };
}

/**
 * Apply `patch` to a scratch copy of the files' current contents (as the IDE
 * sees them, including unsaved buffers); if that works, write the results
 * back through the IDE. Nothing is written unless every file applies.
 */
async function mergeViaIde(
  ide: IDE,
  root: string,
  patch: string,
  patchPath: string,
  files: string[],
): Promise<SubagentMergeResult> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "knox-merge-"));
  const uriFor = (rel: string) => localPathToUri(path.join(root, rel));
  try {
    const existed = new Map<string, boolean>();
    for (const rel of files) {
      let text: string | null = null;
      try {
        text = await ide.readFile(uriFor(rel));
      } catch {
        text = null; // new file
      }
      existed.set(rel, text !== null);
      if (text !== null) {
        const dest = path.join(scratch, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, text);
      }
    }
    const check = await git(ide, scratch, ["apply", "--check", q(patchPath)]);
    if (!check.ok) {
      return {
        status: "conflict",
        files,
        patchPath,
        message: check.stderr.trim().split("\n").slice(0, 6).join("\n"),
      };
    }
    const applied = await git(ide, scratch, ["apply", q(patchPath)]);
    if (!applied.ok) {
      return { status: "error", files, patchPath, message: applied.stderr.trim() };
    }
    for (const rel of files) {
      let after: string | null = null;
      try {
        after = await readLocal(path.join(scratch, rel), "utf-8");
      } catch {
        after = null; // deleted by the patch
      }
      if (after === null) {
        if (existed.get(rel) && ide.removeFile) {
          await ide.removeFile(uriFor(rel));
        }
      } else {
        await ide.writeFile(uriFor(rel), after);
      }
    }
    return { status: "applied", files };
  } catch (error) {
    return {
      status: "error",
      files,
      patchPath,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Apply a patch to the real workspace atomically, or report a conflict. */
export function mergePatchIntoWorkspace(
  ide: IDE,
  state: AgentWorktreeState,
  patch: string,
  files: string[],
  label: string,
): Promise<SubagentMergeResult> {
  return mergeLock(async () => {
    if (!patch.trim()) {
      return { status: "no-changes", files: [] };
    }
    const dir = path.join(os.tmpdir(), "knox-subagent-patches");
    await mkdir(dir, { recursive: true });
    const patchPath = path.join(
      dir,
      `${label.replace(/[^a-zA-Z0-9_-]/g, "_")}.patch`,
    );
    await writeFile(patchPath, patch.endsWith("\n") ? patch : `${patch}\n`);
    const root = localPathOrUriToPath(state.workspaceUri);
    // Text-only patches go through the IDE so open (even unsaved) editor
    // buffers are merged and refreshed instead of racing a disk write.
    if (!/^GIT binary patch|^(old|new) mode /m.test(patch)) {
      return mergeViaIde(ide, root, patch, patchPath, files);
    }
    const check = await git(ide, root, ["apply", "--check", q(patchPath)]);
    if (!check.ok) {
      return {
        status: "conflict",
        files,
        patchPath,
        message: check.stderr.trim().split("\n").slice(0, 6).join("\n"),
      };
    }
    const applied = await git(ide, root, ["apply", q(patchPath)]);
    if (!applied.ok) {
      return {
        status: "error",
        files,
        patchPath,
        message: applied.stderr.trim(),
      };
    }
    return { status: "applied", files };
  });
}

export function formatMergeResult(merge: SubagentMergeResult): string {
  const files = merge.files.length ? merge.files.join(", ") : "(none)";
  switch (merge.status) {
    case "applied":
      return `Merge: applied to workspace (${files}).`;
    case "no-changes":
      return "Merge: child made no file changes.";
    case "skipped":
      return `Merge: skipped${merge.message ? ` (${merge.message})` : ""}.`;
    case "conflict":
      return `Merge: CONFLICT — patch not applied (${files}). Patch kept at ${merge.patchPath}. Reason:\n${merge.message ?? "overlapping edits"}`;
    default:
      return `Merge: ERROR ${merge.message ?? ""}${merge.patchPath ? ` (patch at ${merge.patchPath})` : ""}`;
  }
}

/**
 * Run `run` against an isolated worktree IDE, then merge back. If the run was
 * aborted or `shouldMerge` returns false, the worktree is dropped unmerged.
 */
export async function runInWorktree<T>(
  ide: IDE,
  sessionId: string | undefined,
  label: string,
  run: (childIde: IDE) => Promise<T>,
  opts?: { shouldMerge?: (result: T) => boolean },
): Promise<{ result: T; merge: SubagentMergeResult }> {
  const unique = randomBytes(4).toString("hex");
  const state = await enterAgentWorktree(
    ide,
    `${unique}${sessionId ?? "session"}`,
  );
  try {
    const seed = await seedWorktreeWithLocalChanges(ide, state, unique);
    const result = await run(wrapIdeForWorktree(ide, state));
    if (opts?.shouldMerge && !opts.shouldMerge(result)) {
      return {
        result,
        merge: { status: "skipped", files: [], message: "child did not complete" },
      };
    }
    const { patch, files } = await captureWorktreePatch(ide, state);
    const merge = await mergePatchIntoWorkspace(
      ide,
      state,
      patch,
      files,
      `${label}-${unique}`,
    );
    return {
      result,
      merge: seed.warning
        ? { ...merge, message: [merge.message, seed.warning].filter(Boolean).join("\n") }
        : merge,
    };
  } finally {
    await discardAgentWorktree(ide, state).catch(() => undefined);
  }
}
