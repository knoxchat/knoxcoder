import { afterEach, describe, expect, it } from "vitest";

import { handleAgentJobsRequest, lastJobOutputLine, toAgentBackgroundJob } from "./agentJobs";
import {
  resetShellJobs,
  startShellJob,
  waitForShellJob,
} from "./shellJobs";
import {
  resetSubagentJobs,
  startSubagentJob,
  subscribeSubagentJobs,
  toSubagentBackgroundJob,
  updateSubagentJobProgress,
} from "./subagent/jobs";

afterEach(() => {
  resetShellJobs();
  resetSubagentJobs();
});

describe("lastJobOutputLine", () => {
  it("returns the last non-empty line, truncated", () => {
    expect(lastJobOutputLine("")).toBeUndefined();
    expect(lastJobOutputLine("hello\nworld")).toBe("world");
    expect(lastJobOutputLine(`${"x".repeat(100)}\n`)).toHaveLength(80);
  });
});

describe("handleAgentJobsRequest", () => {
  it("lists, kills, and dismisses shell jobs", async () => {
    const id = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const listed = handleAgentJobsRequest({ action: "list" });
    expect(listed.ok).toBe(true);
    expect(listed.jobs.some((job) => job.id === id && job.status === "running")).toBe(
      true,
    );

    const killed = handleAgentJobsRequest({ action: "kill", jobId: id });
    expect(killed.ok).toBe(true);
    expect(killed.jobs.find((job) => job.id === id)?.status).toBe("killed");

    await waitForShellJob(id, { timeoutMs: 2_000 });
    const dismissed = handleAgentJobsRequest({ action: "dismiss", jobId: id });
    expect(dismissed.ok).toBe(true);
    expect(dismissed.jobs.some((job) => job.id === id)).toBe(false);
  });

  it("rejects kill/dismiss without a job id", () => {
    expect(handleAgentJobsRequest({ action: "kill" }).ok).toBe(false);
    expect(handleAgentJobsRequest({ action: "dismiss" }).ok).toBe(false);
  });

  it("does not start from the sync handler (Core owns start)", () => {
    const out = handleAgentJobsRequest({ action: "start", task: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Core/i);
  });

  it("kills every running shell and subagent job", async () => {
    const shellId = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const child = startSubagentJob({ title: "resolve conflicts", profile: "general" });
    const killed = handleAgentJobsRequest({ action: "killAll" });
    expect(killed.ok).toBe(true);
    expect(killed.jobs.find((job) => job.id === shellId)?.status).toBe("killed");
    expect(killed.jobs.find((job) => job.id === child.id)?.status).toBe("killed");
    expect(child.abort.signal.aborted).toBe(true);
    await waitForShellJob(shellId, { timeoutMs: 2_000 });
  });

  it("maps a snapshot to a panel job", () => {
    const job = toAgentBackgroundJob({
      id: "sh_1",
      command: "pnpm test",
      cwd: "/",
      startedAt: 1,
      endedAt: 2,
      stdout: "ok\npassed",
      stderr: "",
      exitCode: 0,
      status: "exited",
      truncated: false,
    });
    expect(job.kind).toBe("shell");
    expect(job.title).toBe("pnpm test");
    expect(job.detail).toBe("passed");
    expect(job.exitCode).toBe(0);
    expect(job.output).toContain("passed");
  });

  it("strips shell meta from detail/output and prefers that exit code", () => {
    const job = toAgentBackgroundJob({
      id: "sh_2",
      command: "cargo build",
      cwd: "/",
      startedAt: 1,
      endedAt: 2,
      stdout: "Compiling tetris\nFinished",
      stderr: "warn\n__KNOX_META__\t0\t/tmp/proj\n",
      exitCode: 0,
      status: "exited",
      truncated: false,
    });
    expect(job.detail).toBe("Finished");
    expect(job.output).toContain("Finished");
    expect(job.output).toContain("warn");
    expect(job.output).not.toContain("__KNOX_META__");
    expect(job.exitCode).toBe(0);
  });

  it("streams child progress into the jobs panel record", () => {
    const events: string[] = [];
    const unsub = subscribeSubagentJobs((event, job) => {
      events.push(`${event}:${job.detail ?? ""}`);
    });
    const child = startSubagentJob({ title: "find auth", profile: "explore" });
    updateSubagentJobProgress(child.id, "step 1: builtin_read_file");
    const mapped = toSubagentBackgroundJob(child);
    expect(mapped.kind).toBe("task");
    expect(mapped.status).toBe("running");
    expect(mapped.detail).toContain("builtin_read_file");
    expect(mapped.output).toContain("builtin_read_file");
    expect(events[0]?.startsWith("started:")).toBe(true);
    expect(events.some((line) => line.includes("builtin_read_file"))).toBe(true);
    unsub();
  });

  it("clears finished jobs", async () => {
    const id = startShellJob({
      command: "echo clear-panel",
      cwd: process.cwd(),
    });
    await waitForShellJob(id);
    const cleared = handleAgentJobsRequest({ action: "clear" });
    expect(cleared.ok).toBe(true);
    expect(cleared.jobs.some((job) => job.id === id)).toBe(false);
  });
});
