import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTempRepos, git, makeTempRepo } from "../test/tempRepo";
import {
  createJob,
  discardJob,
  listJobs,
  loadJob,
  mergeJob,
  runJob,
} from "./background";
import type { HeadlessResult } from "./headless";

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

const ok: HeadlessResult = {
  stoppedReason: "completed",
  exitCode: 0,
  steps: 2,
  summary: "done",
  tools: [],
  denied: [],
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
});
