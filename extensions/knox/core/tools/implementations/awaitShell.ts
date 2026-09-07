import { ToolImpl } from ".";
import type { JobOutputFilters } from "../build/formatShellLog";
import {
  getShellJob,
  jobOutputSince,
  killShellJob,
  listShellJobs,
  parseBlockUntilMs,
  resolveAwaitTimeoutMs,
  type ShellJobSnapshot,
  waitForShellJob,
} from "../shellJobs";
import { snapshotToContextItems } from "./runTerminalCommand";

function formatJobList(jobs: ShellJobSnapshot[]): string {
  if (jobs.length === 0) {
    return "No shell jobs. Start one with builtin_run_terminal_command (set background: true for servers / long tests) or builtin_pty_start.";
  }
  return jobs
    .map((job) => {
      const duration = (job.endedAt ?? Date.now()) - job.startedAt;
      const exit =
        job.status === "running" ? "running" : `exit ${job.exitCode ?? "?"}`;
      const kind = job.stdin ? "pty" : "shell";
      return `${job.id}\t${kind}\t${job.status}\t${exit}\t${duration}ms\t${job.command}`;
    })
    .join("\n");
}

function parsePositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  return Math.floor(n);
}

function parseFilters(args: Record<string, unknown>): JobOutputFilters {
  const tailLines = parsePositiveInt(args.tail_lines ?? args.tailLines);
  const sinceByte = parsePositiveInt(args.since_byte ?? args.sinceByte);
  const grep =
    typeof args.grep === "string" && args.grep
      ? args.grep
      : typeof args.pattern === "string" && args.pattern
        ? args.pattern
        : undefined;
  const errorsOnly =
    args.errors_only === true ||
    args.errors_only === "true" ||
    args.errorsOnly === true;
  return { tailLines, grep, sinceByte, errorsOnly };
}

function toItems(
  snapshot: ShellJobSnapshot,
  filters: JobOutputFilters,
): ReturnType<typeof snapshotToContextItems> {
  const since = filters.sinceByte ?? 0;
  const useSlice =
    since > 0 ||
    filters.tailLines !== undefined ||
    !!filters.grep ||
    !!filters.errorsOnly;
  return snapshotToContextItems(snapshot, {
    command: snapshot.command,
    cwd: snapshot.cwd,
    stderr: snapshot.stderr,
    exitCode: snapshot.exitCode,
    body: useSlice ? jobOutputSince(snapshot, since) : undefined,
    nextByte: snapshot.outputBytes ?? 0,
    filters: useSlice ? { ...filters, sinceByte: 0 } : filters,
  });
}

export const awaitShellImpl: ToolImpl = async (args, extras) => {
  const jobId =
    typeof args.job_id === "string" && args.job_id.trim()
      ? args.job_id.trim()
      : typeof args.jobId === "string" && args.jobId.trim()
        ? args.jobId.trim()
        : "";

  if (!jobId) {
    const jobs = listShellJobs();
    return [
      {
        name: "Terminal",
        description: jobs.length === 0 ? "No shell jobs" : `${jobs.length} shell job(s)`,
        content: formatJobList(jobs),
      },
    ];
  }

  const filters = parseFilters(args);

  if (args.kill === true || args.kill === "true") {
    const killed = killShellJob(jobId);
    if (!killed) {
      return [
        {
          name: "Terminal",
          description: "Unknown shell job",
          content: `Unknown shell job: ${jobId}. Omit job_id to list jobs.`,
        },
      ];
    }
    const snapshot = await waitForShellJob(jobId, {
      timeoutMs: 2_000,
      abortSignal: extras.abortSignal,
      killOnAbort: false,
      toolName: "builtin_await_shell",
    }).catch(() => getShellJob(jobId) ?? killed);

    return toItems(snapshot, filters);
  }

  if (!getShellJob(jobId)) {
    return [
      {
        name: "Terminal",
        description: "Unknown shell job",
        content: `Unknown shell job: ${jobId}. Omit job_id to list jobs.`,
      },
    ];
  }

  const timeoutMs =
    args.timeout_ms === undefined &&
    args.timeout === undefined &&
    args.block_until_ms === undefined
      ? resolveAwaitTimeoutMs()
      : parseBlockUntilMs(
          args.timeout_ms ?? args.timeout ?? args.block_until_ms,
        );

  const snapshot = await waitForShellJob(jobId, {
    timeoutMs,
    abortSignal: extras.abortSignal,
    killOnAbort: false,
    toolName: "builtin_await_shell",
  });

  return toItems(snapshot, filters);
};
