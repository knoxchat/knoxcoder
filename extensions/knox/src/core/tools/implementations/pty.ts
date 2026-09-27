import path from "node:path";
import { fileURLToPath } from "node:url";

import { ContextItem } from "../..";
import { ToolImpl } from ".";
import { ToolCallError, ToolCallErrorCode } from "../errors";
import { isPathOutsideWorkspace } from "../toolPolicy";
import {
  getShellJob,
  killShellJob,
  parseBlockUntilMs,
  type ShellJobSnapshot,
  waitForShellJob,
} from "../shellJobs";
import {
  formatTerminalResult,
  getShellSession,
  setShellCwd,
  workspaceShellKey,
} from "../shellSession";
import { readPty, sendPty, startPtyJob } from "../ptySession";

function toFsPath(uriOrPath: string): string {
  if (uriOrPath.startsWith("file://")) {
    return fileURLToPath(uriOrPath);
  }
  return uriOrPath;
}

function resolveRequestedCwd(
  requested: unknown,
  sessionCwd: string,
  workspaceRoot: string,
): string {
  if (typeof requested !== "string" || requested.trim() === "") {
    return sessionCwd;
  }
  const trimmed = requested.trim();
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(workspaceRoot, trimmed);
}

function jobIdOf(args: Record<string, unknown>): string {
  if (typeof args.job_id === "string" && args.job_id.trim()) {
    return args.job_id.trim();
  }
  if (typeof args.jobId === "string" && args.jobId.trim()) {
    return args.jobId.trim();
  }
  return "";
}

function unknownJob(jobId: string): ContextItem[] {
  return [
    {
      name: "PTY",
      description: "Unknown PTY job",
      content: `Unknown interactive job: ${jobId || "(missing job_id)"}. Start one with builtin_pty_start.`,
    },
  ];
}

function snapshotItems(
  snapshot: ShellJobSnapshot,
  extras: { body?: string; nextByte?: number },
): ContextItem[] {
  const durationMs = (snapshot.endedAt ?? Date.now()) - snapshot.startedAt;
  const running = snapshot.status === "running";
  return [
    {
      name: "PTY",
      description: running
        ? `Interactive session running (${snapshot.id})`
        : `Interactive session exited ${snapshot.exitCode ?? 1}`,
      content: formatTerminalResult({
        command: snapshot.command,
        exitCode: snapshot.exitCode,
        durationMs,
        cwd: snapshot.cwd,
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        status: snapshot.status,
        jobId: snapshot.id,
        truncated: snapshot.truncated,
        logPath: snapshot.logPath,
        body: extras.body,
        nextByte: extras.nextByte ?? snapshot.outputBytes ?? 0,
        pty: true,
        ptyNative: snapshot.ptyNative,
      }),
    },
  ];
}

export const ptyStartImpl: ToolImpl = async (args, extras) => {
  if (!args.command || typeof args.command !== "string") {
    throw new Error("Missing or invalid required parameter: command");
  }
  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "PTY start cancelled",
      toolName: "builtin_pty_start",
      retryable: false,
    });
  }

  const ideInfo = await extras.ide.getIdeInfo();
  if (ideInfo.remoteName !== "local" && ideInfo.remoteName !== "") {
    return [
      {
        name: "PTY",
        description: "unavailable",
        content:
          "Interactive sessions are only available in local development environments, not SSH remotes.",
      },
    ];
  }

  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  const workspaceRoot = toFsPath(workspaceDirs[0]);
  const key = workspaceShellKey(workspaceDirs);
  const session = getShellSession(key, workspaceRoot);
  const cwd = resolveRequestedCwd(
    args.working_directory ?? args.cwd,
    session.cwd,
    workspaceRoot,
  );
  if (isPathOutsideWorkspace(cwd, workspaceDirs.map(toFsPath))) {
    throw new Error(
      `PTY cwd must stay inside the workspace (got "${cwd}").`,
    );
  }
  setShellCwd(key, cwd);

  const jobId = startPtyJob({ command: args.command, cwd });
  const snapshot = getShellJob(jobId);
  if (!snapshot) {
    return unknownJob(jobId);
  }
  return snapshotItems(snapshot, { body: "", nextByte: 0 });
};

export const ptySendImpl: ToolImpl = async (args) => {
  const jobId = jobIdOf(args);
  if (!jobId) {
    return unknownJob("");
  }
  const before = getShellJob(jobId);
  if (!before) {
    return unknownJob(jobId);
  }
  const result = sendPty(jobId, args.data ?? args.keys ?? args.input, {
    eof: args.eof,
    ctrl_c: args.ctrl_c ?? args.ctrlC,
  });
  const snapshot = getShellJob(jobId) ?? before;
  const note = [
    result.written ? "wrote stdin" : "no stdin bytes",
    result.sigint ? "SIGINT" : "",
    result.eof ? "EOF" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return snapshotItems(snapshot, {
    body: `(sent: ${note})\nUse builtin_pty_read to collect output.`,
    nextByte: snapshot.outputBytes ?? 0,
  });
};

export const ptyReadImpl: ToolImpl = async (args, extras) => {
  const jobId = jobIdOf(args);
  if (!jobId || !getShellJob(jobId)) {
    return unknownJob(jobId);
  }

  if (args.kill === true || args.kill === "true") {
    const killed = killShellJob(jobId);
    if (!killed) {
      return unknownJob(jobId);
    }
    const snapshot = await waitForShellJob(jobId, {
      timeoutMs: 2_000,
      abortSignal: extras.abortSignal,
      killOnAbort: false,
      toolName: "builtin_pty_read",
    }).catch(() => getShellJob(jobId) ?? killed);
    return snapshotItems(snapshot, {
      body: snapshot.stdout + snapshot.stderr,
      nextByte: snapshot.outputBytes ?? 0,
    });
  }

  const timeoutMs =
    args.timeout_ms === undefined &&
    args.timeout === undefined &&
    args.block_until_ms === undefined
      ? 5_000
      : parseBlockUntilMs(
          args.timeout_ms ?? args.timeout ?? args.block_until_ms,
        );
  const sinceByte =
    typeof args.since_byte === "number"
      ? args.since_byte
      : typeof args.sinceByte === "number"
        ? args.sinceByte
        : undefined;

  const { snapshot, body, nextByte } = await readPty(jobId, {
    timeoutMs,
    sinceByte,
    abortSignal: extras.abortSignal,
  });
  return snapshotItems(snapshot, { body, nextByte });
};
