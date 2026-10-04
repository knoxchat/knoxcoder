import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { t } from "../i18n/index.js";
import { localPathOrUriToPath, localPathToUri } from "../util/pathToUri.js";

import type { IDE } from "../index.js";
import { realPathOrSelf } from "./toolPolicy.js";

export interface AgentWorktreeState {
  enabled: true;
  sessionId: string;
  workspaceUri: string;
  worktreePath: string;
  worktreeUri: string;
  branch: string;
  createdAt: number;
  warning?: string;
  sparsePaths?: string[];
}

export interface AgentWorktreeStatus {
  enabled: boolean;
  branch?: string;
  path?: string;
  files: string[];
}

export interface AgentWorktreeResult {
  ok: boolean;
  error?: string;
  state?: AgentWorktreeStatus | null;
}

const FILE_PATH_METHODS = new Set<string>([
  "readFile",
  "writeFile",
  "fileExists",
  "removeFile",
  "saveFile",
  "openFile",
  "showLines",
  "readRangeInFile",
  "getProblems",
]);

export function shortId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function suggestWorktreePath(gitRootPath: string, sessionId: string): string {
  return path.join(
    os.tmpdir(),
    "knox-worktrees",
    shortId(gitRootPath),
    shortId(sessionId),
  );
}

export function suggestWorktreeBranch(sessionId: string): string {
  const slug = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "session";
  return `knox/agent-${slug}`;
}

export function toFileUri(pathOrUri: string): string {
  if (pathOrUri.startsWith("file://")) {
    return pathOrUri;
  }
  return localPathToUri(pathOrUri);
}

function isUnderRoot(abs: string, root: string): boolean {
  const resolved = path.resolve(abs);
  const resolvedRoot = path.resolve(root);
  if (resolved === resolvedRoot) {
    return true;
  }
  const prefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  return resolved.startsWith(prefix);
}

/**
 * Rewrite a workspace path/URI onto the isolated worktree.
 * Paths already inside the worktree, or outside the original workspace, are left alone.
 */
export function remapPathToWorktree(
  pathOrUri: string,
  state: Pick<AgentWorktreeState, "workspaceUri" | "worktreeUri">,
): string {
  if (!pathOrUri) {
    return pathOrUri;
  }
  const inputIsUri = pathOrUri.startsWith("file://");
  if (inputIsUri) {
    const workspace = state.workspaceUri.replace(/\/+$/, "");
    const worktree = state.worktreeUri.replace(/\/+$/, "");
    if (pathOrUri === workspace || pathOrUri.startsWith(`${workspace}/`)) {
      return worktree + pathOrUri.slice(workspace.length);
    }
    if (pathOrUri === worktree || pathOrUri.startsWith(`${worktree}/`)) {
      return pathOrUri;
    }
    return pathOrUri;
  }

  const abs = localPathOrUriToPath(pathOrUri);
  const workspace = localPathOrUriToPath(state.workspaceUri);
  const worktree = localPathOrUriToPath(state.worktreeUri);

  if (isUnderRoot(abs, worktree)) {
    return pathOrUri;
  }

  if (isUnderRoot(abs, workspace)) {
    return path.join(worktree, path.relative(workspace, abs));
  }
  if (!path.isAbsolute(abs)) {
    return path.join(worktree, abs);
  }
  return pathOrUri;
}

export function parsePorcelainPaths(porcelain: string): string[] {
  const files: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    // XY PATH or XY ORIG -> PATH
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const raw = arrow >= 0 ? rest.slice(arrow + 4) : rest;
    const cleaned = raw.replace(/^"|"$/g, "").trim();
    if (cleaned) {
      files.push(cleaned);
    }
  }
  return files;
}

async function runGit(
  ide: IDE,
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const command = ["git", ...args].join(" ");
  try {
    const [stdout, stderr] = await ide.subprocess(command, cwd);
    return { stdout: stdout ?? "", stderr: stderr ?? "", ok: true };
  } catch (error) {
    const stderr = typeof error === "string" ? error : (error as Error).message;
    return { stdout: "", stderr, ok: false };
  }
}

function toStatus(state: AgentWorktreeState, files: string[] = []): AgentWorktreeStatus {
  return {
    enabled: true,
    branch: state.branch,
    path: state.worktreePath,
    files,
  };
}

export async function listWorktreeChangedFiles(
  ide: IDE,
  state: AgentWorktreeState,
): Promise<string[]> {
  const result = await runGit(ide, state.worktreePath, [
    "status",
    "--porcelain=v1",
  ]);
  if (!result.ok) {
    return [];
  }
  return parsePorcelainPaths(result.stdout);
}

export interface EnterWorktreeOptions {
  sparsePaths?: string[];
}

export const WORKTREE_FILE_COUNT_WARN = 20_000;

export const WORKTREE_SKIP_APPLY_RE =
  /(?:^|\/)(?:vmlinux(?:\.bin)?|qemu-system-[\w.-]+)$|(?:^|\/).+\.(?:ko|o|dtb|a)$|(?:^|\/)pc-bios\/|modules\.order/;

export function shouldSkipWorktreeApply(rel: string): boolean {
  return WORKTREE_SKIP_APPLY_RE.test(rel.replace(/\\/g, "/"));
}

let worktreeAddQueue: Promise<void> = Promise.resolve();

export async function enterAgentWorktree(
  ide: IDE,
  sessionId: string,
  existing?: AgentWorktreeState | null,
  options?: EnterWorktreeOptions,
): Promise<AgentWorktreeState> {
  if (existing?.enabled) {
    return existing;
  }

  const dirs = await ide.getWorkspaceDirs();
  if (!dirs.length) {
    throw new Error(t("gitNoWorkspace"));
  }
  const root = dirs[0];
  const gitRoot = ide.getGitRootPath
    ? ((await ide.getGitRootPath(root)) ?? root)
    : root;
  const gitRootPath = localPathOrUriToPath(gitRoot);
  const workspaceUri = toFileUri(gitRootPath);
  const worktreePath = suggestWorktreePath(gitRootPath, sessionId);
  const branch = suggestWorktreeBranch(sessionId);

  await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path.dirname(worktreePath), { recursive: true });

  // Concurrent `git worktree add` calls race on .git/worktrees metadata.
  const prior = worktreeAddQueue;
  let release!: () => void;
  worktreeAddQueue = new Promise<void>((r) => (release = r));
  await prior;
  let added: Awaited<ReturnType<typeof runGit>>;
  try {
    added = await runGit(ide, gitRootPath, [
      "worktree",
      "add",
      "-B",
      branch,
      worktreePath,
      "HEAD",
    ]);
  } finally {
    release();
  }
  if (!added.ok) {
    throw new Error(added.stderr || t("worktreeCreateFailed"));
  }

  const sparsePaths = (options?.sparsePaths ?? []).map((p) => p.trim()).filter(Boolean);
  if (sparsePaths.length) {
    await runGit(ide, worktreePath, ["sparse-checkout", "init", "--cone"]);
    const sparse = await runGit(ide, worktreePath, [
      "sparse-checkout",
      "set",
      ...sparsePaths,
    ]);
    if (!sparse.ok) {
      throw new Error(sparse.stderr || "sparse-checkout failed");
    }
  }

  let warning: string | undefined;
  const counted = await runGit(ide, gitRootPath, ["ls-files"]);
  if (counted.ok) {
    const n = counted.stdout.split("\n").filter((line) => line.trim()).length;
    if (n > WORKTREE_FILE_COUNT_WARN) {
      warning = `Repo has ${n} tracked files; worktree checkout is expensive. Pass sparsePaths (e.g. arch/x86, kernel, mm) next time.`;
    }
  }

  return {
    enabled: true,
    sessionId,
    workspaceUri,
    worktreePath,
    worktreeUri: localPathToUri(worktreePath),
    branch,
    createdAt: Date.now(),
    warning,
    sparsePaths: sparsePaths.length ? sparsePaths : undefined,
  };
}

/**
 * A path reported by `git diff` is only merged back when it stays inside both
 * trees after resolving symlinks. Blocks `..`/absolute entries and symlinks
 * (committed by an agent) that would copy files from, or write files to,
 * locations outside the worktree and the workspace.
 */
export function isSafeWorktreeApplyPath(
  rel: string,
  workspace: string,
  worktreePath: string,
): boolean {
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..") || rel.includes("\0")) {
    return false;
  }
  const within = (candidate: string, root: string) => {
    const r = realPathOrSelf(path.resolve(root));
    const c = realPathOrSelf(path.resolve(candidate));
    return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  };
  return (
    within(path.join(worktreePath, rel), worktreePath) &&
    within(path.join(workspace, rel), workspace)
  );
}

export async function applyAgentWorktree(
  ide: IDE,
  state: AgentWorktreeState,
): Promise<string[]> {
  const files = await listWorktreeChangedFiles(ide, state);
  const workspace = localPathOrUriToPath(state.workspaceUri);
  const applied: string[] = [];

  for (const rel of files) {
    if (shouldSkipWorktreeApply(rel)) {
      continue;
    }
    if (!isSafeWorktreeApplyPath(rel, workspace, state.worktreePath)) {
      console.warn(`[worktree] refusing to merge "${rel}": resolves outside the workspace or worktree`);
      continue;
    }
    const from = toFileUri(path.join(state.worktreePath, rel));
    const to = toFileUri(path.join(workspace, rel));
    const exists = await ide.fileExists(from);
    if (!exists) {
      if (typeof ide.removeFile === "function") {
        await ide.removeFile(to);
      }
      applied.push(rel);
      continue;
    }
    const contents = await ide.readFile(from);
    await ide.writeFile(to, contents);
    applied.push(rel);
  }

  return applied;
}

export async function discardAgentWorktree(
  ide: IDE,
  state: AgentWorktreeState,
): Promise<void> {
  const workspace = localPathOrUriToPath(state.workspaceUri);
  const removed = await runGit(ide, workspace, [
    "worktree",
    "remove",
    "--force",
    state.worktreePath,
  ]);
  if (!removed.ok) {
    await rm(state.worktreePath, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await runGit(ide, workspace, ["worktree", "prune"]);
  }
  await runGit(ide, workspace, ["branch", "-D", state.branch]);
}

export function wrapIdeForWorktree(ide: IDE, state: AgentWorktreeState): IDE {
  return new Proxy(ide, {
    get(target, prop, receiver) {
      if (prop === "getWorkspaceDirs") {
        return async () => [state.worktreeUri];
      }
      if (prop === "getGitRootPath") {
        return async () => state.worktreeUri;
      }
      if (prop === "subprocess") {
        return async (command: string, cwd?: string) => {
          const mappedCwd = cwd
            ? remapPathToWorktree(cwd, state)
            : state.worktreePath;
          return target.subprocess(command, localPathOrUriToPath(mappedCwd));
        };
      }
      if (typeof prop === "string" && FILE_PATH_METHODS.has(prop)) {
        return async (filePath?: string, ...rest: unknown[]) => {
          if (!filePath) {
            return (target as any)[prop](filePath, ...rest);
          }
          const mapped = remapPathToWorktree(filePath, state);
          return (target as any)[prop](mapped, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function worktreeActionResult(
  ide: IDE,
  state: AgentWorktreeState | null,
): Promise<AgentWorktreeResult> {
  if (!state) {
    return { ok: true, state: { enabled: false, files: [] } };
  }
  const files = await listWorktreeChangedFiles(ide, state);
  return { ok: true, state: toStatus(state, files) };
}
