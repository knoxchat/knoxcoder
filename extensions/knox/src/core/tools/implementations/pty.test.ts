import { afterEach, describe, expect, it } from "vitest";

import { resetShellJobs, startShellJob, waitForShellJob } from "../shellJobs";
import {
  decodePtyPayload,
  readPty,
  sendPty,
  startPtyJob,
  unescapePtyData,
} from "../ptySession";
import { ptyReadImpl, ptySendImpl, ptyStartImpl } from "./pty";
import type { IDE, ToolExtras } from "../..";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

function extras(): ToolExtras {
  return {
    ide: {
      getWorkspaceDirs: vi.fn(async () => [pathToFileURL(process.cwd()).href]),
      getIdeInfo: vi.fn(async () => ({ remoteName: "local" })),
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_pty_start" } } as ToolExtras["tool"],
  };
}

const stdinEcho = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
  "process.stdin.pipe(process.stdout)",
)}`;

afterEach(() => {
  resetShellJobs();
});

describe("decodePtyPayload", () => {
  it("unescapes newlines and hex Ctrl-C", () => {
    expect(unescapePtyData("hello\\n")).toBe("hello\n");
    const decoded = decodePtyPayload("\\x03");
    expect(decoded.sigint).toBe(true);
    expect(decoded.write).toBe("");
  });

  it("treats ctrl_c and eof extras", () => {
    expect(decodePtyPayload("", { ctrl_c: true }).sigint).toBe(true);
    expect(decodePtyPayload("", { eof: true }).eof).toBe(true);
  });
});

describe("pty session (HL-13)", () => {
  it("spawns a stdin echo, send hello, read hello", async () => {
    const id = startPtyJob({ command: stdinEcho, cwd: process.cwd() });
    await new Promise((r) => setTimeout(r, 80));
    const sent = sendPty(id, "hello\n");
    expect(sent.ok).toBe(true);
    expect(sent.written).toBe(true);

    const { body, snapshot, nextByte } = await readPty(id, {
      timeoutMs: 2_000,
      sinceByte: 0,
    });
    expect(body).toContain("hello");
    expect(nextByte).toBeGreaterThan(0);
    expect(snapshot.stdin).toBe(true);
    sendPty(id, "", { eof: true });
    await waitForShellJob(id, { timeoutMs: 2_000 });
  });
});

describe("pty tools", () => {
  it("start → send → read via tool impls", async () => {
    const started = await ptyStartImpl({ command: stdinEcho }, extras());
    const content = started[0]?.content ?? "";
    expect(content).toContain("Status: running");
    const jobMatch = content.match(/Job: (pty_\S+)/);
    expect(jobMatch?.[1]).toBeTruthy();
    const jobId = jobMatch![1];

    await new Promise((r) => setTimeout(r, 80));
    await ptySendImpl({ job_id: jobId, data: "hello\n" }, extras());
    const read = await ptyReadImpl(
      { job_id: jobId, timeout_ms: 2_000 },
      extras(),
    );
    expect(read[0]?.content).toContain("hello");
    await ptyReadImpl({ job_id: jobId, kill: true }, extras());
  });
});
