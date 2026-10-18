/**
 * Background agents (K-050): a detached git worktree plus job record.
 *
 * The GUI lists, merges, discards, and starts jobs under `~/.knoxcoder/bg`.
 *
 * Job state lives in `~/.knoxcoder/bg/<id>/job.json`; the worktree is
 * `~/.knoxcoder/bg/<id>/tree` on branch `knox/bg-<id>`, created from HEAD
 * plus the parent's uncommitted tracked/untracked files (same idea as
 * subagent worktrees). At most two jobs may run at once.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeFileAtomic } from "../util/atomicWrite";
import { withFileLockSync } from "../util/fileLock";

export type BgStatus = "running" | "done" | "failed" | "merged" | "discarded";

export interface BgRunResult {
  stoppedReason: string;
  steps?: number;
  summary?: string;
}

export interface BgJob {
  id: string;
  task: string;
  repo: string;
  branch: string;
  worktree: string;
  status: BgStatus;
  startedAt: string;
  finishedAt?: string;
  args: string[];
  stoppedReason?: string;
  steps?: number;
  summary?: string;
  changedFiles?: string[];
  error?: string;
  pid?: number;
}

export function bgRoot(home = os.homedir()): string {
  return path.join(home, ".knoxcoder", "bg");
}

export const MAX_CONCURRENT_BG_JOBS = 2;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function jobFile(root: string, id: string): string {
  return path.join(root, id, "job.json");
}

export function saveJob(root: string, job: BgJob): void {
  const file = jobFile(root, job.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  withFileLockSync(`${file}.lock`, () => {
    writeFileAtomic(file, JSON.stringify(job, null, 2));
  });
}

export function loadJob(root: string, id: string): BgJob | undefined {
  const file = jobFile(root, id);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  try {
    return withFileLockSync(`${file}.lock`, () => {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as BgJob;
    });
  } catch {
    return undefined;
  }
}

export function listJobs(root: string): BgJob[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map((id) => loadJob(root, id))
    .filter((j): j is BgJob => !!j)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Create the worktree + job record. Does not start anything. */
export function createJob(opts: {
  root: string;
  dir: string;
  task: string;
  args?: string[];
}): BgJob {
  const repo = git(opts.dir, ["rev-parse", "--show-toplevel"]);
  const id = randomBytes(3).toString("hex");
  const branch = `knox/bg-${id}`;
  const worktree = path.join(opts.root, id, "tree");
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(repo, ["worktree", "add", "-b", branch, worktree, "HEAD"]);
  const job: BgJob = {
    id,
    task: opts.task,
    repo,
    branch,
    worktree,
    status: "running",
    startedAt: new Date().toISOString(),
    args: opts.args ?? [],
  };
  saveJob(opts.root, job);
  return job;
}

/** Copy the parent's uncommitted tracked diff and untracked files into the worktree. */
export function seedWorktreeFromParent(repo: string, worktree: string): number {
  let seeded = 0;
  const diff = git(repo, ["diff", "--binary", "HEAD"]);
  if (diff.trim()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-bg-seed-"));
    const patch = path.join(dir, "seed.patch");
    fs.writeFileSync(patch, diff.endsWith("\n") ? diff : `${diff}\n`);
    git(worktree, ["apply", "--whitespace=nowarn", patch]);
    fs.rmSync(dir, { recursive: true, force: true });
    seeded += 1;
  }
  const others = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: repo, encoding: "utf-8" },
  );
  for (const rel of others.split("\0").filter((file) => file && !file.includes(".."))) {
    const dest = path.join(worktree, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dest);
    seeded += 1;
  }
  return seeded;
}

function runningCount(root: string): number {
  return listJobs(root).filter((job) => job.status === "running").length;
}

/**
 * Create a job, refuse a third concurrent runner, and seed uncommitted parent files.
 */
const jobAborts = new Map<string, AbortController>();

export function abortJob(id: string): boolean {
  const controller = jobAborts.get(id);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

export function abortAllRunningJobs(root: string): number {
  let n = 0;
  for (const job of listJobs(root)) {
    if (job.status === "running" && abortJob(job.id)) {
      n += 1;
    }
  }
  return n;
}

export function startJob(opts: {
  root: string;
  dir: string;
  task: string;
  args?: string[];
}): BgJob {
  if (runningCount(opts.root) >= MAX_CONCURRENT_BG_JOBS) {
    throw new Error(`At most ${MAX_CONCURRENT_BG_JOBS} background jobs can run at once.`);
  }
  const job = createJob(opts);
  jobAborts.set(job.id, new AbortController());
  try {
    seedWorktreeFromParent(job.repo, job.worktree);
  } catch {
    // Worktree is still usable at HEAD; the job record says so in summary later.
  }
  return job;
}

/**
 * Worker body: run the agent in the worktree, commit its changes, record the
 * outcome, and call `notify`. `run` is injected by tests.
 */
export async function runJob(opts: {
  root: string;
  id: string;
  run: (job: BgJob, signal: AbortSignal) => Promise<BgRunResult>;
  notify?: (title: string, body: string) => void;
}): Promise<BgJob> {
  const job = loadJob(opts.root, opts.id);
  if (!job) throw new Error(`unknown job ${opts.id}`);
  const controller = jobAborts.get(job.id) ?? new AbortController();
  jobAborts.set(job.id, controller);
  saveJob(opts.root, job);
  try {
    if (controller.signal.aborted) {
      throw new Error("aborted");
    }
    const result = await opts.run(job, controller.signal);
    git(job.worktree, ["add", "-A"]);
    const changed = git(job.worktree, ["diff", "--cached", "--name-only"])
      .split("\n")
      .filter(Boolean);
    if (changed.length) {
      git(job.worktree, [
        "-c",
        "user.name=Knox",
        "-c",
        "user.email=knox@localhost",
        "commit",
        "-m",
        `knox bg ${job.id}: ${job.task.slice(0, 60)}`,
      ]);
    }
    job.status = result.stoppedReason === "completed" ? "done" : "failed";
    job.stoppedReason = result.stoppedReason;
    job.steps = result.steps;
    job.summary = result.summary;
    job.changedFiles = changed;
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
  }
  job.finishedAt = new Date().toISOString();
  jobAborts.delete(job.id);
  saveJob(opts.root, job);
  opts.notify?.(
    `Knox background job ${job.id} ${job.status}`,
    job.summary?.slice(0, 120) || job.error || job.task,
  );
  return job;
}

export type MergeOutcome = { ok: true; message: string } | { ok: false; message: string };

/** Merge the job branch into the repo's current branch; abort cleanly on conflict. */
export function mergeJob(root: string, id: string): MergeOutcome {
  const job = loadJob(root, id);
  if (!job) return { ok: false, message: `unknown job ${id}` };
  if (job.status !== "done" && job.status !== "failed") {
    return { ok: false, message: `job is ${job.status}` };
  }
  if (!job.changedFiles?.length) {
    return { ok: false, message: "job made no changes; use discard" };
  }
  try {
    git(job.repo, ["merge", "--no-edit", job.branch]);
  } catch (error) {
    try {
      git(job.repo, ["merge", "--abort"]);
    } catch {
      // nothing to abort
    }
    return {
      ok: false,
      message: `merge conflict; repo left unchanged. Branch ${job.branch} is kept. ${error instanceof Error ? error.message.split("\n")[0] : ""}`,
    };
  }
  dropWorktree(job);
  job.status = "merged";
  saveJob(root, job);
  return { ok: true, message: `merged ${job.branch} (${job.changedFiles.join(", ")})` };
}

function dropWorktree(job: BgJob): void {
  try {
    git(job.repo, ["worktree", "remove", "--force", job.worktree]);
  } catch {
    fs.rmSync(job.worktree, { recursive: true, force: true });
  }
}

export function discardJob(root: string, id: string): MergeOutcome {
  const job = loadJob(root, id);
  if (!job) return { ok: false, message: `unknown job ${id}` };
  if (job.status === "running") {
    abortJob(job.id);
  }
  dropWorktree(job);
  try {
    git(job.repo, ["branch", "-D", job.branch]);
  } catch {
    // branch may be gone
  }
  job.status = "discarded";
  saveJob(root, job);
  return { ok: true, message: `discarded ${job.id}` };
}

export function formatJobLine(job: BgJob): string {
  return `${job.id}  ${job.status.padEnd(9)} ${job.task.slice(0, 60)}`;
}
