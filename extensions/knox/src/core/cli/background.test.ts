import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTempRepos, git, makeTempRepo } from "../test/tempRepo";
import type { BgRunResult } from "./background";
import {
  abortJob,
  createJob,
  discardJob,
  listJobs,
  loadJob,
  mergeJob,
  MAX_CONCURRENT_BG_JOBS,
  runJob,
  saveJob,
  startJob,
} from "./background";

const roots: string[] = [];
const bgRoot = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "knox-bg-"));
  roots.push(d);
  return d;
};
afterEach(() => {
  cleanupTempRepos();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const ok: BgRunResult = {
  stoppedReason: "completed",
  steps: 2,
  summary: "done",
};

describe("background agents", () => {
  it("runs in a worktree, commits, notifies, then merges", async () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    const root = bgRoot();
    const job = createJob({ root, dir: repo, task: "edit a" });
    expect(listJobs(root)).toHaveLength(1);
    const notes: string[] = [];
    const done = await runJob({
      root,
      id: job.id,
      run: async (j) => {
        fs.writeFileSync(path.join(j.worktree, "a.txt"), "two\n");
        return ok;
      },
      notify: (t) => notes.push(t),
    });
    expect(done.status).toBe("done");
    expect(done.changedFiles).toEqual(["a.txt"]);
    expect(notes[0]).toContain("done");
    // the main checkout is untouched until merge
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("one\n");
    const merged = mergeJob(root, job.id);
    expect(merged.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("two\n");
    expect(loadJob(root, job.id)?.status).toBe("merged");
  });

  it("reports a conflict and leaves the repo clean", async () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    const root = bgRoot();
    const job = createJob({ root, dir: repo, task: "edit a" });
    await runJob({
      root,
      id: job.id,
      run: async (j) => {
        fs.writeFileSync(path.join(j.worktree, "a.txt"), "bg\n");
        return ok;
      },
    });
    fs.writeFileSync(path.join(repo, "a.txt"), "main\n");
    git(repo, ["commit", "-am", "main change"]);
    const result = mergeJob(root, job.id);
    expect(result.ok).toBe(false);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("main\n");
  });

  it("records failures and discards cleanly", async () => {
    const repo = makeTempRepo();
    const root = bgRoot();
    const job = createJob({ root, dir: repo, task: "boom" });
    const failed = await runJob({
      root,
      id: job.id,
      run: async () => {
        throw new Error("no network");
      },
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("no network");
    expect(mergeJob(root, job.id).ok).toBe(false);
    expect(discardJob(root, job.id).ok).toBe(true);
    expect(git(repo, ["branch", "--list", "knox/bg-*"]).trim()).toBe("");
    expect(fs.existsSync(job.worktree)).toBe(false);
  });

  it("job.json is complete JSON after concurrent saves", () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    const root = bgRoot();
    const job = createJob({ root, dir: repo, task: "edit a" });
    for (let i = 0; i < 12; i++) {
      saveJob(root, { ...job, pid: 1000 + i, summary: `n${i}` });
    }
    const file = path.join(root, job.id, "job.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(parsed.id).toBe(job.id);
    expect(parsed.summary).toMatch(/^n\d+$/);
    expect(loadJob(root, job.id)?.summary).toBe(parsed.summary);
    expect(fs.readdirSync(path.join(root, job.id)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("seeds uncommitted parent files into the worktree", () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    fs.writeFileSync(path.join(repo, "a.txt"), "dirty\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "untracked\n");
    const root = bgRoot();
    const job = startJob({ root, dir: repo, task: "seed" });
    expect(fs.readFileSync(path.join(job.worktree, "a.txt"), "utf-8")).toBe("dirty\n");
    expect(fs.readFileSync(path.join(job.worktree, "new.txt"), "utf-8")).toBe(
      "untracked\n",
    );
  });

  it("caps concurrent running jobs", () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    const root = bgRoot();
    startJob({ root, dir: repo, task: "one" });
    startJob({ root, dir: repo, task: "two" });
    expect(MAX_CONCURRENT_BG_JOBS).toBe(2);
    expect(() => startJob({ root, dir: repo, task: "three" })).toThrow(
      /at most 2/i,
    );
  });

  it("aborts a running job without using the host process pid", async () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    const root = bgRoot();
    const job = startJob({ root, dir: repo, task: "hang" });
    const pending = runJob({
      root,
      id: job.id,
      run: async (_j, signal) =>
        new Promise<BgRunResult>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });
    expect(abortJob(job.id)).toBe(true);
    const done = await pending;
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/aborted/);
    expect(done.pid).toBeUndefined();
  });
});
