import { afterEach, describe, expect, it } from "vitest";

import { resetShellJobs, waitForShellJob } from "../shellJobs";
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

/**
 * stdin.pipe(stdout) never flows on a Windows ConPTY (Node TTY). Raw mode plus
 * a READY handshake works on POSIX and Windows, and avoids racing attach.
 */
const stdinEcho = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
  "process.stdout.write('READY\\n');if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.on('data',d=>process.stdout.write(d))",
)}`;
const helloLine = process.platform === "win32" ? "hello\r" : "hello\n";

async function waitForReady(
  read: () => Promise<{ body: string }>,
): Promise<string> {
  const { body } = await read();
  expect(body, `PTY never printed READY. Got:\n${body}`).toContain("READY");
  return body;
}

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
    await waitForReady(() =>
      readPty(id, { timeoutMs: 8_000, sinceByte: 0 }),
    );
    const sent = sendPty(id, helloLine);
    expect(sent.ok).toBe(true);
    expect(sent.written).toBe(true);

    // A read returns on the first new output (e.g. the trailing "\r\n" of
    // READY), so keep reading until the echo arrives.
    let body = "";
    let snapshot: Awaited<ReturnType<typeof readPty>>["snapshot"] | undefined;
    let nextByte = 0;
    const deadline = Date.now() + 10_000;
    while (!body.includes("hello") && Date.now() < deadline) {
      const r = await readPty(id, { timeoutMs: 2_000 });
      body += r.body;
      snapshot = r.snapshot;
      nextByte = r.nextByte;
    }
    expect(body).toContain("hello");
    expect(nextByte).toBeGreaterThan(0);
    expect(snapshot?.stdin).toBe(true);
    sendPty(id, "", { eof: true });
    await waitForShellJob(id, { timeoutMs: 2_000 });
  }, 20_000);
});

describe("pty tools", () => {
  it("start → send → read via tool impls", async () => {
    const started = await ptyStartImpl({ command: stdinEcho }, extras());
    const content = started[0]?.content ?? "";
    expect(content).toContain("Status: running");
    const jobMatch = content.match(/Job: (pty_\S+)/);
    expect(jobMatch?.[1]).toBeTruthy();
    const jobId = jobMatch![1];

    await waitForReady(async () => {
      const read = await ptyReadImpl(
        { job_id: jobId, timeout_ms: 8_000 },
        extras(),
      );
      return { body: read[0]?.content ?? "" };
    });
    await ptySendImpl({ job_id: jobId, data: helloLine }, extras());
    let text = "";
    const deadline = Date.now() + 10_000;
    while (!text.includes("hello") && Date.now() < deadline) {
      const read = await ptyReadImpl(
        { job_id: jobId, timeout_ms: 2_000 },
        extras(),
      );
      text += read[0]?.content ?? "";
    }
    expect(text).toContain("hello");
    await ptyReadImpl({ job_id: jobId, kill: true }, extras());
  }, 20_000);
});
