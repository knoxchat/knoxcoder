import { describe, expect, it } from "vitest";

import {
  formatTerminalResult,
  getShellSession,
  parseShellMeta,
  resetShellSession,
  setShellCwd,
  wrapPosixCommand,
} from "./shellSession";

describe("shellSession", () => {
  it("persists cwd per workspace key", () => {
    resetShellSession();
    expect(getShellSession("ws", "/tmp/a").cwd).toBe("/tmp/a");
    setShellCwd("ws", "/tmp/b");
    expect(getShellSession("ws", "/tmp/a").cwd).toBe("/tmp/b");
    resetShellSession("ws");
    expect(getShellSession("ws", "/tmp/a").cwd).toBe("/tmp/a");
  });

  it("parses meta and strips it from stderr", () => {
    const parsed = parseShellMeta("warn\n__KNOX_META__\t0\t/tmp/proj\n");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.cwd).toBe("/tmp/proj");
    expect(parsed.stderr).toBe("warn");
  });

  it("wraps a posix command with cd + meta", () => {
    const wrapped = wrapPosixCommand("echo hi", "/tmp/ws");
    expect(wrapped).toContain("cd '/tmp/ws'");
    expect(wrapped).toContain("echo hi");
    expect(wrapped).toContain("__KNOX_META__");
  });

  it("formats structured output", () => {
    const text = formatTerminalResult({
      command: "echo hi",
      exitCode: 0,
      durationMs: 12,
      cwd: "/tmp/ws",
      stdout: "hi\n",
      stderr: "",
    });
    expect(text).toContain("Exit: 0");
    expect(text).toContain("Status: exited");
    expect(text).toContain("Duration: 12ms");
    expect(text).toContain("Cwd: /tmp/ws");
    expect(text).toContain("hi");
  });

  it("formats a running job with await hint", () => {
    const text = formatTerminalResult({
      command: "npm test",
      exitCode: null,
      durationMs: 30_000,
      cwd: "/tmp/ws",
      stdout: "ok",
      stderr: "",
      status: "running",
      jobId: "sh_1_abc",
    });
    expect(text).toContain("Status: running");
    expect(text).toContain("Job: sh_1_abc");
    expect(text).toContain("builtin_await_shell");
    expect(text).not.toContain("Exit:");
  });

  it("compacts make output to parsed errors and a tail", () => {
    const spam = Array.from({ length: 120 }, (_, i) => `  CC  f${i}.o`).join(
      "\n",
    );
    const text = formatTerminalResult({
      command: "make -j8",
      exitCode: 2,
      durationMs: 4000,
      cwd: "/linux",
      stdout: `${spam}\nmm/foo.c:10:1: error: boom\n`,
      stderr: "make: *** [mm/foo] Error 1\n",
      logPath: "/tmp/.knoxcoder/jobs/sh_make.log",
    });
    expect(text).toContain("mm/foo.c:10:1");
    expect(text).toContain("Full log: /tmp/.knoxcoder/jobs/sh_make.log");
    expect(text).not.toContain("  CC  f0.o");
    expect(text.length).toBeLessThan(4_000);
  });
});

