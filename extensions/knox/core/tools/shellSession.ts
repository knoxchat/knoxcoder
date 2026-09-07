import {
  applyJobOutputFilters,
  compactShellBody,
  isVerboseBuildCommand,
  type JobOutputFilters,
} from "./build/formatShellLog";

/** Persistent cwd per workspace for builtin_run_terminal_command. */

export interface ShellSessionState {
  cwd: string;
}

const sessions = new Map<string, ShellSessionState>();

export const KNOX_SHELL_META = "__KNOX_META__";

export function workspaceShellKey(workspaceDirs: string[]): string {
  return workspaceDirs[0] || "default";
}

export function getShellSession(
  key: string,
  defaultCwd: string,
): ShellSessionState {
  const existing = sessions.get(key);
  if (existing) {
    return { ...existing };
  }
  const created = { cwd: defaultCwd };
  sessions.set(key, created);
  return { ...created };
}

export function setShellCwd(key: string, cwd: string): void {
  const current = sessions.get(key);
  if (current) {
    current.cwd = cwd;
    return;
  }
  sessions.set(key, { cwd });
}

export function resetShellSession(key?: string): void {
  if (key) {
    sessions.delete(key);
    return;
  }
  sessions.clear();
}

export function wrapPosixCommand(command: string, cwd: string): string {
  const escaped = cwd.replace(/'/g, `'\\''`);
  return `cd '${escaped}' || exit 1
${command}
__knox_status=$?
printf '\\n${KNOX_SHELL_META}\\t%d\\t%s\\n' "$__knox_status" "$(pwd)" >&2
exit $__knox_status`;
}

export function parseShellMeta(stderr: string): {
  exitCode?: number;
  cwd?: string;
  stderr: string;
} {
  const lines = stderr.split("\n");
  let exitCode: number | undefined;
  let cwd: string | undefined;
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith(KNOX_SHELL_META + "\t") || line.startsWith(KNOX_SHELL_META)) {
      const parts = line.split("\t");
      const code = Number(parts[1]);
      if (!Number.isNaN(code)) {
        exitCode = code;
      }
      if (parts[2]) {
        cwd = parts[2].trim();
      }
    } else {
      kept.push(line);
    }
  }
  return {
    exitCode,
    cwd,
    stderr: kept.join("\n").replace(/\n+$/, ""),
  };
}

export function formatTerminalResult(params: {
  command: string;
  exitCode: number | null;
  durationMs: number;
  cwd: string;
  stdout: string;
  stderr: string;
  status?: "running" | "exited" | "killed";
  jobId?: string;
  truncated?: boolean;
  logPath?: string;
  nextByte?: number;
  filters?: JobOutputFilters;
  /** Pre-sliced interleaved log (HL-13/15). When set, replaces stdout/stderr dump. */
  body?: string;
  pty?: boolean;
  ptyNative?: boolean;
}): string {
  const status = params.status ?? "exited";
  const compact =
    !params.body &&
    (isVerboseBuildCommand(params.command) || !!params.truncated);
  const parts = [
    `Command: ${params.command}`,
    `Status: ${status}`,
  ];
  if (params.jobId) {
    parts.push(`Job: ${params.jobId}`);
  }
  if (params.pty) {
    parts.push(params.ptyNative ? "TTY: native" : "TTY: pipe");
  }
  if (status !== "running") {
    parts.push(`Exit: ${params.exitCode ?? 1}`);
  }
  parts.push(
    `Duration: ${params.durationMs}ms`,
    `Cwd: ${params.cwd}`,
  );
  if (params.nextByte !== undefined) {
    parts.push(`Next byte: ${params.nextByte}`);
  }
  if (params.logPath && (params.body !== undefined || !compact)) {
    parts.push(`Full log: ${params.logPath}`);
  }
  if (params.body !== undefined) {
    const filtered = applyJobOutputFilters(params.body, params.filters);
    parts.push("--- output ---", filtered || "(empty)");
  } else if (compact) {
    parts.push(
      compactShellBody({
        stdout: params.stdout,
        stderr: params.stderr,
        logPath: params.logPath,
        tailCount: params.filters?.tailLines,
      }),
    );
  } else {
    const filteredOut = applyJobOutputFilters(params.stdout, params.filters);
    const filteredErr = params.stderr
      ? applyJobOutputFilters(params.stderr, params.filters)
      : "";
    if (params.truncated) {
      parts.push("(output truncated to last 200KB)");
    }
    parts.push("--- stdout ---", filteredOut || "(empty)");
    if (filteredErr) {
      parts.push("--- stderr ---", filteredErr);
    }
  }
  if (status === "running" && params.jobId) {
    const waiter = params.pty
      ? `builtin_pty_read with job_id "${params.jobId}" (timeout is per-read). builtin_pty_send writes stdin; send \\x03 for Ctrl-C.`
      : `builtin_await_shell with job_id "${params.jobId}" to poll or wait. Pass kill: true to stop it.`;
    parts.push(`---\nStill running. Use ${waiter}`);
  }
  return parts.join("\n");
}
