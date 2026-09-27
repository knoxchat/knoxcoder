import { afterEach, describe, expect, it } from "vitest";

import { ToolCallError, ToolCallErrorCode } from "./errors";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyAgentJobsOptions,
  buildShellEnv,
  createThrottledSnapshotEmitter,
  dismissCompletedShellJobs,
  dismissShellJob,
  extraShellPathDirs,
  getJobsLogDir,
  getShellJob,
  killShellJob,
  killAllRunningShellJobs,
  listShellJobs,
  MAX_COMPLETED_SHELL_JOBS,
  parseBlockUntilMs,
  resetShellJobs,
  resolveAwaitTimeoutMs,
  resolveTerminalWaitMs,
  resolveWaitMs,
  isLongRunningCommand,
  jobOutputSince,
  SHELL_WAIT_HARD_CAP_MS,
  startShellJob,
  subscribeShellJobs,
  waitForShellJob,
} from "./shellJobs";

afterEach(() => {
  resetShellJobs();
});

describe("shellJobs", () => {
  it("runs a short command to completion", async () => {
    const id = startShellJob({
      command: "echo hello-job-test",
      cwd: process.cwd(),
    });
    const snap = await waitForShellJob(id);
    expect(snap.status).toBe("exited");
    expect(snap.exitCode).toBe(0);
    expect(snap.stdout).toContain("hello-job-test");
  });

  it("polls a running job without waiting", async () => {
    const id = startShellJob({
      command: "sleep 2",
      cwd: process.cwd(),
    });
    const snap = await waitForShellJob(id, { timeoutMs: 0 });
    expect(snap.status).toBe("running");
    expect(getShellJob(id)?.status).toBe("running");
    killShellJob(id);
  });

  it("backgrounds after timeout and can be awaited later", async () => {
    const id = startShellJob({
      command: "sleep 0.4 && echo done-bg",
      cwd: process.cwd(),
    });
    const early = await waitForShellJob(id, { timeoutMs: 50 });
    expect(early.status).toBe("running");

    const later = await waitForShellJob(id, { timeoutMs: 2_000 });
    expect(later.status).toBe("exited");
    expect(later.stdout).toContain("done-bg");
  });

  it("kills a running job", async () => {
    const id = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const killed = killShellJob(id);
    expect(killed?.status).toBe("killed");
    const snap = await waitForShellJob(id, { timeoutMs: 2_000 });
    expect(snap.status).toBe("killed");
  });

  it("rejects wait with killOnAbort when already aborted", async () => {
    const id = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    await expect(
      waitForShellJob(id, {
        abortSignal: AbortSignal.abort(),
        killOnAbort: true,
      }),
    ).rejects.toMatchObject({
      code: ToolCallErrorCode.CANCELLED,
    });
    expect(getShellJob(id)?.status).toBe("killed");
  });

  it("does not kill on abort when killOnAbort is false", async () => {
    const id = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const snap = await waitForShellJob(id, {
      abortSignal: AbortSignal.abort(),
      killOnAbort: false,
    });
    expect(snap.status).toBe("running");
    killShellJob(id);
  });

  it("lists jobs", () => {
    const id = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    expect(listShellJobs().some((job) => job.id === id)).toBe(true);
    killShellJob(id);
  });

  it("kills every running job", async () => {
    const a = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const b = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const killed = killAllRunningShellJobs();
    expect(killed.map((job) => job.id).sort()).toEqual([a, b].sort());
    expect(getShellJob(a)?.status).toBe("killed");
    expect(getShellJob(b)?.status).toBe("killed");
    await Promise.all([
      waitForShellJob(a, { timeoutMs: 2_000 }),
      waitForShellJob(b, { timeoutMs: 2_000 }),
    ]);
  });

  it("parseBlockUntilMs defaults and resolveWaitMs caps", () => {
    expect(parseBlockUntilMs(undefined)).toBe(30_000);
    expect(parseBlockUntilMs(0)).toBe(0);
    expect(parseBlockUntilMs("1500")).toBe(1500);
    expect(resolveWaitMs(0)).toBe(SHELL_WAIT_HARD_CAP_MS);
    expect(resolveWaitMs(5_000)).toBe(5_000);
    expect(resolveWaitMs(999_999)).toBe(SHELL_WAIT_HARD_CAP_MS);
  });

  it("detects long-running systems commands (HL-14)", () => {
    expect(isLongRunningCommand("make -j8")).toBe(true);
    expect(isLongRunningCommand("ninja")).toBe(true);
    expect(isLongRunningCommand("cmake --build build")).toBe(true);
    expect(isLongRunningCommand("./configure --target=x86_64")).toBe(true);
    expect(isLongRunningCommand("meson compile -C build")).toBe(true);
    expect(isLongRunningCommand("qemu-system-x86_64 -kernel bzImage")).toBe(
      true,
    );
    expect(isLongRunningCommand("echo hi")).toBe(false);
    expect(isLongRunningCommand("gcc -c foo.c")).toBe(false);
    expect(isLongRunningCommand("cargo test --workspace")).toBe(true);
    expect(isLongRunningCommand("cargo check --workspace --all-targets")).toBe(
      true,
    );
    expect(isLongRunningCommand("cargo +nightly clippy")).toBe(true);
    expect(isLongRunningCommand("cargo metadata")).toBe(false);
    expect(isLongRunningCommand("cargo tree -i foo")).toBe(false);
    expect(isLongRunningCommand("cargo fmt --check")).toBe(false);
  });

  it("auto-backgrounds long commands unless wait is explicit (HL-14)", () => {
    expect(
      resolveTerminalWaitMs({
        command: "make -j8",
        background: false,
        explicitWait: false,
        blockUntilMs: 30_000,
      }),
    ).toBe(0);
    expect(
      resolveTerminalWaitMs({
        command: "make -j8",
        background: false,
        explicitWait: true,
        blockUntilMs: 5_000,
      }),
    ).toBe(5_000);
    expect(
      resolveTerminalWaitMs({
        command: "echo hi",
        background: false,
        explicitWait: false,
        blockUntilMs: 30_000,
      }),
    ).toBe(30_000);
  });

  it("notifies listeners on start, kill, and complete", async () => {
    const events: string[] = [];
    const unsub = subscribeShellJobs((event) => {
      events.push(event);
    });
    const id = startShellJob({
      command: "echo listen-test",
      cwd: process.cwd(),
    });
    expect(events).toContain("started");
    await waitForShellJob(id);
    expect(events).toContain("completed");
    unsub();
  });

  it("dismisses completed jobs but not running ones", async () => {
    const running = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    expect(dismissShellJob(running)).toBe(false);
    killShellJob(running);
    await waitForShellJob(running, { timeoutMs: 2_000 });

    const done = startShellJob({
      command: "echo dismiss-me",
      cwd: process.cwd(),
    });
    await waitForShellJob(done);
    expect(dismissShellJob(done)).toBe(true);
    expect(getShellJob(done)).toBeUndefined();
  });

  it("prunes oldest completed jobs past the cap", async () => {
    for (let i = 0; i < MAX_COMPLETED_SHELL_JOBS + 3; i++) {
      const id = startShellJob({
        command: `echo prune-${i}`,
        cwd: process.cwd(),
      });
      await waitForShellJob(id);
    }
    const completed = listShellJobs().filter((job) => job.status !== "running");
    expect(completed.length).toBe(MAX_COMPLETED_SHELL_JOBS);
  });

  it("emits completed once when spawn cwd is invalid", async () => {
    const events: string[] = [];
    const unsub = subscribeShellJobs((event) => {
      events.push(event);
    });
    const id = startShellJob({
      command: "echo should-not-run",
      cwd: path.join(os.tmpdir(), "knox-no-such-cwd", String(Date.now())),
    });
    const snap = await waitForShellJob(id, { timeoutMs: 2_000 });
    expect(snap.status).toBe("exited");
    expect(snap.exitCode).toBe(1);
    expect(events.filter((event) => event === "completed")).toHaveLength(1);
    unsub();
  });

  it("emits updated when output arrives", async () => {
    const events: string[] = [];
    const unsub = subscribeShellJobs((event) => {
      events.push(event);
    });
    const id = startShellJob({
      command: "echo live-update",
      cwd: process.cwd(),
    });
    await waitForShellJob(id);
    expect(events).toContain("started");
    expect(events).toContain("updated");
    expect(events).toContain("completed");
    unsub();
  });

  it("clears completed jobs and keeps running ones", async () => {
    const running = startShellJob({
      command: "sleep 30",
      cwd: process.cwd(),
    });
    const done = startShellJob({
      command: "echo clear-me",
      cwd: process.cwd(),
    });
    await waitForShellJob(done);
    expect(dismissCompletedShellJobs()).toBeGreaterThanOrEqual(1);
    expect(getShellJob(done)).toBeUndefined();
    expect(getShellJob(running)?.status).toBe("running");
    killShellJob(running);
  });

  it("buildShellEnv prepends existing extra bins", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "knox-shell-env-"));
    const cargoBin = path.join(home, ".cargo", "bin");
    fs.mkdirSync(cargoBin, { recursive: true });
    const env = buildShellEnv({ PATH: "/usr/bin" }, home);
    expect(env.PATH?.split(path.delimiter)[0]).toBe(cargoBin);
    expect(extraShellPathDirs(home)[0]).toBe(cargoBin);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("throttles snapshot emits after the first", async () => {
    const seen: number[] = [];
    const emitter = createThrottledSnapshotEmitter((snap) => {
      seen.push(snap.stdout.length);
    }, 30);
    emitter.push({
      id: "a",
      command: "x",
      cwd: "/",
      startedAt: 0,
      stdout: "1",
      stderr: "",
      exitCode: null,
      status: "running",
      truncated: false,
      outputBytes: 0,
    });
    emitter.push({
      id: "a",
      command: "x",
      cwd: "/",
      startedAt: 0,
      stdout: "12",
      stderr: "",
      exitCode: null,
      status: "running",
      truncated: false,
      outputBytes: 2,
    });
    expect(seen).toEqual([1]);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toBe(2);
  });

  it("writes a full make log under KNOX_GLOBAL_DIR/jobs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-jobs-log-"));
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = root;
    try {
      const id = startShellJob({
        command: "printf '  CC foo.o\\nfoo.c:1:1: error: x\\n'",
        displayCommand: "make",
        cwd: process.cwd(),
      });
      const snap = await waitForShellJob(id);
      expect(snap.logPath).toBe(path.join(root, "jobs", `${id}.log`));
      expect(fs.existsSync(snap.logPath!)).toBe(true);
      const log = fs.readFileSync(snap.logPath!, "utf8");
      expect(log).toContain("foo.c:1:1: error: x");
    } finally {
      if (prev === undefined) {
        delete process.env.KNOX_GLOBAL_DIR;
      } else {
        process.env.KNOX_GLOBAL_DIR = prev;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists a log for non-build jobs and supports since_byte (HL-15)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-jobs-log-"));
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = root;
    try {
      const id = startShellJob({
        command: "printf 'line-a\\nline-b\\nerror: boom\\n'",
        displayCommand: "printf lines",
        cwd: process.cwd(),
      });
      const snap = await waitForShellJob(id);
      expect(snap.logPath).toBeTruthy();
      expect(fs.existsSync(snap.logPath!)).toBe(true);
      const all = jobOutputSince(snap, 0);
      expect(all).toContain("line-a");
      expect(all).toContain("error: boom");
      const rest = jobOutputSince(snap, Buffer.byteLength("line-a\n"));
      expect(rest).toContain("line-b");
      expect(rest).not.toContain("line-a");
    } finally {
      if (prev === undefined) {
        delete process.env.KNOX_GLOBAL_DIR;
      } else {
        process.env.KNOX_GLOBAL_DIR = prev;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors agent.jobs.logDir and awaitTimeoutMs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-agent-jobs-"));
    applyAgentJobsOptions({ logDir: dir, awaitTimeoutMs: 45_000 });
    expect(getJobsLogDir()).toBe(path.resolve(dir));
    expect(resolveAwaitTimeoutMs()).toBe(45_000);
    applyAgentJobsOptions(null);
    expect(resolveAwaitTimeoutMs()).toBe(600_000);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
