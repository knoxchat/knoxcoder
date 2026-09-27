import { afterEach, describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { resetShellJobs, startShellJob } from "../shellJobs";
import { awaitShellImpl } from "./awaitShell";

function extras(): ToolExtras {
  return {
    ide: {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_await_shell" } } as ToolExtras["tool"],
  };
}

afterEach(() => {
  resetShellJobs();
});

describe("awaitShellImpl", () => {
  it("lists jobs when job_id is omitted", async () => {
    const id = startShellJob({
      command: "sleep 30",
      displayCommand: "sleep 30",
      cwd: process.cwd(),
    });
    const result = await awaitShellImpl({}, extras());
    expect(result[0]?.content).toContain(id);
    expect(result[0]?.content).toContain("sleep 30");
  });

  it("returns unknown job message", async () => {
    const result = await awaitShellImpl({ job_id: "sh_missing" }, extras());
    expect(result[0]?.content).toContain("Unknown shell job");
  });

  it("polls a running job with timeout_ms 0", async () => {
    const id = startShellJob({
      command: "sleep 30",
      displayCommand: "sleep 30",
      cwd: process.cwd(),
    });
    const result = await awaitShellImpl(
      { job_id: id, timeout_ms: 0 },
      extras(),
    );
    expect(result[0]?.content).toContain("Status: running");
    expect(result[0]?.content).toContain(id);
  });

  it("kills a job", async () => {
    const id = startShellJob({
      command: "sleep 30",
      displayCommand: "sleep 30",
      cwd: process.cwd(),
    });
    const result = await awaitShellImpl({ job_id: id, kill: true }, extras());
    expect(result[0]?.content).toMatch(/Status: killed|Status: exited/);
  });

  it("returns grep and errors_only from the job log (HL-15)", async () => {
    const id = startShellJob({
      command: "printf 'cc foo\\nfoo.c:1:1: error: boom\\ncc bar\\n'",
      displayCommand: "make",
      cwd: process.cwd(),
    });
    const grepped = await awaitShellImpl(
      { job_id: id, timeout_ms: 2_000, grep: "error:" },
      extras(),
    );
    expect(grepped[0]?.content).toContain("error: boom");
    expect(grepped[0]?.content).not.toContain("cc foo");

    const errors = await awaitShellImpl(
      { job_id: id, timeout_ms: 0, errors_only: true },
      extras(),
    );
    expect(errors[0]?.content).toMatch(/foo\.c:1:1/);
  });
});
