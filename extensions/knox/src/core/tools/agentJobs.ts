import type {
  AgentBackgroundJob,
  AgentJobsRequest,
  AgentJobsResponse,
} from "../protocol/agentJobs";
import {
  dismissCompletedShellJobs,
  dismissShellJob,
  killAllRunningShellJobs,
  killShellJob,
  listShellJobs,
  type ShellJobSnapshot,
} from "./shellJobs";
import {
  dismissCompletedSubagentJobs,
  dismissSubagentJob,
  killAllRunningSubagentJobs,
  killSubagentJob,
  listSubagentJobs,
  toSubagentBackgroundJob,
} from "./subagent/jobs";
import { parseShellMeta } from "./shellSession";

const DETAIL_MAX = 80;
const OUTPUT_MAX = 4_000;

export function lastJobOutputLine(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (!last) {
    return undefined;
  }
  return last.length > DETAIL_MAX ? `${last.slice(0, DETAIL_MAX - 1)}…` : last;
}

export function jobOutputPreview(stdout: string, stderr: string): string | undefined {
  const meta = parseShellMeta(stderr);
  const parts = [stdout.trim(), meta.stderr.trim()].filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  const text = parts.join("\n--- stderr ---\n");
  if (text.length <= OUTPUT_MAX) {
    return text;
  }
  return `…${text.slice(text.length - OUTPUT_MAX + 1)}`;
}

export function toAgentBackgroundJob(
  snapshot: ShellJobSnapshot,
): AgentBackgroundJob {
  const meta = parseShellMeta(snapshot.stderr);
  const live = snapshot.stdout || meta.stderr;
  const preview = jobOutputPreview(snapshot.stdout, snapshot.stderr);
  const output = snapshot.logPath
    ? preview
      ? `${preview}\n\nFull log: ${snapshot.logPath}`
      : `Full log: ${snapshot.logPath}`
    : preview;
  return {
    id: snapshot.id,
    kind: "shell",
    title: snapshot.command,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    exitCode: meta.exitCode ?? snapshot.exitCode,
    detail: lastJobOutputLine(live),
    output,
    truncated: snapshot.truncated || undefined,
    logPath: snapshot.logPath,
  };
}

export function listAgentBackgroundJobs(): AgentBackgroundJob[] {
  return [
    ...listShellJobs().map(toAgentBackgroundJob),
    ...listSubagentJobs().map(toSubagentBackgroundJob),
  ];
}

/** User Stop: SIGTERM/abort every running shell job and child agent. */
export function cancelAllBackgroundJobs(): AgentBackgroundJob[] {
  killAllRunningShellJobs();
  killAllRunningSubagentJobs();
  return listAgentBackgroundJobs();
}

export function handleAgentJobsRequest(
  data: AgentJobsRequest,
): AgentJobsResponse {
  const action = data.action;
  if (action === "killAll") {
    return { ok: true, jobs: cancelAllBackgroundJobs() };
  }
  if (action === "kill") {
    const jobId = data.jobId?.trim();
    if (!jobId) {
      return { ok: false, error: "Missing jobId", jobs: listAgentBackgroundJobs() };
    }
    const killed = killShellJob(jobId) || killSubagentJob(jobId);
    if (!killed) {
      return {
        ok: false,
        error: `Unknown job: ${jobId}`,
        jobs: listAgentBackgroundJobs(),
      };
    }
    return { ok: true, jobs: listAgentBackgroundJobs() };
  }
  if (action === "dismiss") {
    const jobId = data.jobId?.trim();
    if (!jobId) {
      return { ok: false, error: "Missing jobId", jobs: listAgentBackgroundJobs() };
    }
    if (!dismissShellJob(jobId) && !dismissSubagentJob(jobId)) {
      return {
        ok: false,
        error: `Cannot dismiss job: ${jobId}`,
        jobs: listAgentBackgroundJobs(),
      };
    }
    return { ok: true, jobs: listAgentBackgroundJobs() };
  }
  if (action === "clear") {
    dismissCompletedShellJobs();
    dismissCompletedSubagentJobs();
    return { ok: true, jobs: listAgentBackgroundJobs() };
  }
  return { ok: true, jobs: listAgentBackgroundJobs() };
}
