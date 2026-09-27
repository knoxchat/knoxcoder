import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import {
  createEchoNativePtySpawner,
  createSpawnerFromPtyModule,
  nativePtyModuleCandidates,
  resetNativePtyLoader,
  setNativePtySpawner,
} from "./nativePty";
import {
  getShellJob,
  resetShellJobs,
  startShellJob,
  waitForShellJob,
} from "./shellJobs";
import { readPty, sendPty, startPtyJob } from "./ptySession";

afterEach(() => {
  resetShellJobs();
  resetNativePtyLoader();
});

describe("native PTY (HL remaining polish)", () => {
  it("marks the job ptyNative and echoes via the injected TTY", async () => {
    setNativePtySpawner(createEchoNativePtySpawner());
    const id = startPtyJob({ command: "gdb", cwd: process.cwd() });
    expect(getShellJob(id)?.ptyNative).toBe(true);
    expect(getShellJob(id)?.stdin).toBe(true);

    const sent = sendPty(id, "hello\n");
    expect(sent.written).toBe(true);
    const { body } = await readPty(id, { timeoutMs: 1_000, sinceByte: 0 });
    expect(body).toContain("hello");
  });

  it("SIGINT on a native session writes Ctrl-C instead of killing a pipe", async () => {
    setNativePtySpawner(createEchoNativePtySpawner());
    const id = startShellJob({
      command: "gdb",
      cwd: process.cwd(),
      stdin: true,
      nativePty: true,
      idPrefix: "pty",
    });
    sendPty(id, "", { ctrl_c: true });
    const snap = await waitForShellJob(id, { timeoutMs: 1_000 });
    expect(snap.status).toBe("exited");
    expect(snap.exitCode).toBe(130);
  });

  it("falls back to a pipe when no native spawner is available", async () => {
    setNativePtySpawner(null);
    const id = startPtyJob({
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        "process.stdout.write(process.stdout.isTTY ? 'TTY' : 'PIPE')",
      )}`,
      cwd: process.cwd(),
    });
    expect(getShellJob(id)?.ptyNative).toBeUndefined();
    const snap = await waitForShellJob(id, { timeoutMs: 3_000 });
    expect(snap.stdout).toContain("PIPE");
  });

  it("resolves VS Code appRoot then the packaged VSIX module", () => {
    const candidates = nativePtyModuleCandidates({
      appRoot: "/App/Contents/Resources/app",
      extensionPath: "/ext/knox",
    });
    expect(candidates[0]).toBe(
      path.join("/App/Contents/Resources/app", "node_modules.asar", "node-pty"),
    );
    expect(candidates).toContain(
      path.join("/ext/knox", "dist", "node_modules", "node-pty"),
    );
    expect(candidates).toContain(
      path.join("/ext/knox", "out", "node_modules", "node-pty"),
    );
    expect(candidates.at(-1)).toBe("node-pty");
  });

  it("wraps a node-pty module as a Core spawner", () => {
    const calls: Array<{ cwd: unknown; env: unknown }> = [];
    const spawner = createSpawnerFromPtyModule({
      spawn(_file, _args, options) {
        calls.push({ cwd: options.cwd, env: options.env });
        return {
          pid: 7,
          write() {},
          kill() {},
          onData() {},
          onExit() {},
        };
      },
    });
    const proc = spawner({
      command: "gdb",
      cwd: "/tmp/kernel",
      env: { FOO: "1" },
    });
    expect(proc?.pid).toBe(7);
    expect(calls[0]?.cwd).toBe("/tmp/kernel");
    expect((calls[0]?.env as { TERM?: string }).TERM).toBe("xterm-256color");
  });
});
