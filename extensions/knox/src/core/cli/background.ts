/**
 * Background agents (K-050): run a headless task in a detached git worktree.
 *
 *   knox bg start "<task>" [run options]   create the worktree, detach a worker
 *   knox bg list | show <id>               status and result
 *   knox bg merge <id>                     merge the job's branch into the repo
 *   knox bg discard <id>                   drop the worktree and branch
 *
 * Job state lives in `~/.knoxcoder/bg/<id>/job.json`; the worktree is
 * `~/.knoxcoder/bg/<id>/tree` on branch `knox/bg-<id>`, created from HEAD
 * (uncommitted changes in the repo are not copied). The finished worker
 * commits what the agent changed so merge/discard are plain git operations.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeFileAtomic } from "../util/atomicWrite";
import { withFileLockSync } from "../util/fileLock";
import type { HeadlessResult } from "./headless";

export type BgStatus = "running" | "done" | "failed" | "merged" | "discarded";

export interface BgJob {
  id: string;
  task: string;
  repo: string;
  branch: string;
  worktree: string;
  status: BgStatus;
  startedAt: string;
  finishedAt?: string;
  /** Extra `knox run` flags (permission, model, ...), replayed by the worker. */
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

/**
 * Worker body: run the agent in the worktree, commit its changes, record the
 * outcome, and call `notify`. `run` is injected (the CLI passes `runHeadless`).
 */
export async function runJob(opts: {
  root: string;
  id: string;
  run: (job: BgJob) => Promise<HeadlessResult>;
  notify?: (title: string, body: string) => void;
}): Promise<BgJob> {
  const job = loadJob(opts.root, opts.id);
  if (!job) throw new Error(`unknown job ${opts.id}`);
  job.pid = process.pid;
  saveJob(opts.root, job);
  try {
    const result = await opts.run(job);
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
  if (job.status === "running" && job.pid) {
    try {
      process.kill(job.pid);
    } catch {
      // already gone
    }
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

/** Best-effort desktop notification; never throws. */
export function desktopNotify(title: string, body: string): void {
  try {
    if (process.platform === "darwin") {
      execFileSync("osascript", [
        "-e",
        `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`,
      ]);
    } else if (process.platform === "linux") {
      execFileSync("notify-send", [title, body]);
    }
  } catch {
    // no notifier available
  }
}
