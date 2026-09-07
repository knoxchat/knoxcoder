import childProcess from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ContextItem } from "../..";
import { ToolImpl } from ".";
import { ToolCallError, ToolCallErrorCode } from "../errors";
import {
  formatTerminalResult,
  getShellSession,
  parseShellMeta,
  setShellCwd,
  workspaceShellKey,
  wrapPosixCommand,
} from "../shellSession";
import {
  createThrottledSnapshotEmitter,
  parseBlockUntilMs,
  resolveTerminalWaitMs,
  startShellJob,
  type ShellJobSnapshot,
  waitForShellJob,
} from "../shellJobs";
import { isPathOutsideWorkspace } from "../toolPolicy";

const TERMINAL_TOOL_NAME = "builtin_run_terminal_command";
const FORCE_KILL_MS = 2_000;

export interface LocalShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

function cancelledError(): ToolCallError {
  return new ToolCallError({
    code: ToolCallErrorCode.CANCELLED,
    message: "Terminal command cancelled",
    toolName: TERMINAL_TOOL_NAME,
    retryable: false,
  });
}

/**
 * Run a shell command locally with optional abort (SIGTERM → SIGKILL).
 * Non-zero exits resolve (so the model can read exit/stderr). Cancel rejects.
 * Exported for unit tests.
 */
export function runLocalShellCommand(
  command: string,
  cwd: string,
  abortSignal?: AbortSignal,
  onOutput?: (chunk: { stdout: string; stderr: string }) => void,
): Promise<LocalShellResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(cancelledError());
      return;
    }

    const child = childProcess.spawn(command, {
      cwd,
      shell: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      abortSignal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be gone
      }
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, FORCE_KILL_MS);

      settle(() => {
        reject(cancelledError());
      });
    };

    abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.({ stdout: text, stderr: "" });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.({ stdout: "", stderr: text });
    });

    child.on("error", (error) => {
      settle(() => reject(error));
    });

    child.on("close", (code) => {
      settle(() => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          durationMs: Date.now() - started,
        });
      });
    });
  });
}

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
  if (typeof requested !== "string" || !requested.trim()) {
    return sessionCwd;
  }
  const trimmed = requested.trim();
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(workspaceRoot, trimmed);
}

function isTruthy(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    return lower === "true" || lower === "1" || lower === "yes";
  }
  return false;
}

function applyPosixMeta(
  snapshot: ShellJobSnapshot,
  sessionCwd: string,
  workspaceKey: string,
  useWrap: boolean,
): { stderr: string; cwd: string; exitCode: number | null } {
  if (!useWrap) {
    return {
      stderr: snapshot.stderr,
      cwd: snapshot.cwd || sessionCwd,
      exitCode: snapshot.exitCode,
    };
  }
  const meta = parseShellMeta(snapshot.stderr);
  const nextCwd = meta.cwd || sessionCwd;
  if (meta.cwd) {
    setShellCwd(workspaceKey, nextCwd);
  }
  return {
    stderr: meta.stderr,
    cwd: nextCwd,
    exitCode: meta.exitCode ?? snapshot.exitCode,
  };
}

export function snapshotToContextItems(
  snapshot: ShellJobSnapshot,
  extras: {
    command: string;
    cwd: string;
    stderr: string;
    exitCode: number | null;
    body?: string;
    nextByte?: number;
    filters?: {
      tailLines?: number;
      grep?: string;
      sinceByte?: number;
      errorsOnly?: boolean;
    };
  },
): ContextItem[] {
  const durationMs = (snapshot.endedAt ?? Date.now()) - snapshot.startedAt;
  const running = snapshot.status === "running";
  return [
    {
      name: "Terminal",
      description: running
        ? `Terminal command running (${snapshot.id})`
        : `Terminal command exited ${extras.exitCode ?? 1}`,
      content: formatTerminalResult({
        command: extras.command,
        exitCode: extras.exitCode,
        durationMs,
        cwd: extras.cwd,
        stdout: snapshot.stdout,
        stderr: extras.stderr,
        status: snapshot.status,
        jobId: snapshot.id,
        truncated: snapshot.truncated,
        logPath: snapshot.logPath,
        body: extras.body,
        nextByte: extras.nextByte,
        filters: extras.filters,
      }),
    },
  ];
}

export const runTerminalCommandImpl: ToolImpl = async (args, extras) => {
  if (!args.command || typeof args.command !== "string") {
    throw new Error("Missing or invalid required parameter: command");
  }
  const command = args.command;
  const background = isTruthy(args.background ?? args.run_in_background);
  const explicitWait =
    args.block_until_ms !== undefined ||
    args.timeout_ms !== undefined ||
    args.timeout !== undefined ||
    args.background !== undefined ||
    args.run_in_background !== undefined;
  const blockUntilMs = parseBlockUntilMs(
    args.block_until_ms ?? args.timeout_ms ?? args.timeout,
  );

  const ideInfo = await extras.ide.getIdeInfo();

  if (ideInfo.remoteName === "local" || ideInfo.remoteName === "") {
    try {
      if (extras.abortSignal?.aborted) {
        throw cancelledError();
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
          `Terminal cwd must stay inside the workspace (got "${cwd}").`,
        );
      }
      setShellCwd(key, cwd);

      const useWrap = process.platform !== "win32";
      const toRun = useWrap ? wrapPosixCommand(command, cwd) : command;
      const spawnCwd = useWrap ? workspaceRoot : cwd;

      const emitPartial = extras.onPartialOutput
        ? createThrottledSnapshotEmitter((snap) => {
            const meta = applyPosixMeta(snap, cwd, key, useWrap);
            extras.onPartialOutput?.(
              snapshotToContextItems(snap, {
                command,
                cwd: meta.cwd,
                stderr: meta.stderr,
                exitCode: meta.exitCode,
              }),
            );
          })
        : undefined;

      const jobId = startShellJob({
        command: toRun,
        displayCommand: command,
        cwd: spawnCwd,
        onOutput: emitPartial?.push,
        onComplete: (snap) => {
          applyPosixMeta(snap, cwd, key, useWrap);
        },
      });

      const waitMs = resolveTerminalWaitMs({
        command,
        background,
        explicitWait,
        blockUntilMs,
      });
      const snapshot = await waitForShellJob(jobId, {
        timeoutMs: waitMs,
        abortSignal: extras.abortSignal,
        killOnAbort: !background,
        toolName: TERMINAL_TOOL_NAME,
      });
      emitPartial?.flush();

      const meta = applyPosixMeta(snapshot, cwd, key, useWrap);
      if (snapshot.status !== "running") {
        setShellCwd(key, meta.cwd);
      }

      return snapshotToContextItems(snapshot, {
        command,
        cwd: meta.cwd,
        stderr: meta.stderr,
        exitCode: meta.exitCode,
      });
    } catch (error: any) {
      if (
        error instanceof ToolCallError &&
        error.code === ToolCallErrorCode.CANCELLED
      ) {
        throw error;
      }
      return [
        {
          name: "Terminal",
          description: "Terminal command output",
          content: formatTerminalResult({
            command,
            exitCode: typeof error.code === "number" ? error.code : 1,
            durationMs: 0,
            cwd: "",
            stdout: error.stdout || "",
            stderr: error.stderr || error.toString(),
            status: "exited",
          }),
        },
      ];
    }
  }

  // Remote / SSH: best-effort fire-and-forget (no local process to kill).
  if (extras.abortSignal?.aborted) {
    throw cancelledError();
  }

  await extras.ide.runCommand(args.command);
  return [
    {
      name: "Terminal",
      description: "Terminal command output",
      content:
        "[Terminal output unavailable! This is only available in local development environments and not in SSH environments.]",
    },
  ];
};
