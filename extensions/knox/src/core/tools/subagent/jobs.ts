/**
 * In-flight explore/general child agents for the jobs panel (HL-36).
 */

import type {
  AgentBackgroundJob,
  AgentJobEvent,
} from "../../protocol/agentJobs";

export interface SubagentJobRecord {
  id: string;
  title: string;
  profile: string;
  status: "running" | "exited" | "killed";
  startedAt: number;
  endedAt?: number;
  summary?: string;
  /** Latest one-line status for the jobs row. */
  detail?: string;
  /** Capped progress log (tool steps). */
  log?: string;
  /** K-065: last child oracle / files for the jobs row. */
  oracle?: "pass" | "fail" | "unverified" | "skipped";
  files?: string[];
  abort: AbortController;
}

export type SubagentJobListener = (
  event: AgentJobEvent,
  job: SubagentJobRecord,
) => void;

const jobs = new Map<string, SubagentJobRecord>();
const listeners = new Set<SubagentJobListener>();
let seq = 0;

export const MAX_PARALLEL_EXPLORES = 3;
const PROGRESS_LOG_MAX = 4_000;
const DETAIL_MAX = 80;

export function resetSubagentJobs(): void {
  for (const job of jobs.values()) {
    if (job.status === "running") {
      job.abort.abort();
    }
  }
  jobs.clear();
  seq = 0;
}

export function subscribeSubagentJobs(listener: SubagentJobListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitSubagentJob(event: AgentJobEvent, job: SubagentJobRecord): void {
  const copy = { ...job };
  for (const listener of listeners) {
    try {
      listener(event, copy);
    } catch {
      // Panel listeners must not break the child.
    }
  }
}

function clipDetail(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= DETAIL_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, DETAIL_MAX - 1)}…`;
}

function appendLog(existing: string | undefined, line: string): string {
  const next = existing ? `${existing}\n${line}` : line;
  if (next.length <= PROGRESS_LOG_MAX) {
    return next;
  }
  return `…${next.slice(next.length - PROGRESS_LOG_MAX + 1)}`;
}

export function startSubagentJob(input: {
  title: string;
  profile: string;
  abort?: AbortController;
}): SubagentJobRecord {
  seq += 1;
  const id = `task_child_${seq}`;
  const record: SubagentJobRecord = {
    id,
    title: input.title,
    profile: input.profile,
    status: "running",
    startedAt: Date.now(),
    detail: "started",
    abort: input.abort ?? new AbortController(),
  };
  jobs.set(id, record);
  emitSubagentJob("started", record);
  return record;
}

export function updateSubagentJobProgress(id: string, line: string): void {
  const job = jobs.get(id);
  if (!job) {
    return;
  }
  const detail = clipDetail(line);
  if (!detail) {
    return;
  }
  job.detail = detail;
  job.log = appendLog(job.log, detail);
  emitSubagentJob("updated", job);
}

export function finishSubagentJob(
  id: string,
  status: "exited" | "killed",
  summary?: string,
  extra?: {
    oracle?: "pass" | "fail" | "unverified" | "skipped";
    files?: string[];
  },
): void {
  const job = jobs.get(id);
  if (!job || job.status !== "running") {
    return;
  }
  job.status = status;
  job.endedAt = Date.now();
  job.summary = summary;
  if (extra?.oracle) {
    job.oracle = extra.oracle;
  }
  if (extra?.files) {
    job.files = extra.files;
  }
  if (summary) {
    const head = extra?.oracle
      ? `oracle=${extra.oracle} ${summary.split("\n")[0] ?? summary}`
      : (summary.split("\n")[0] ?? summary);
    job.detail = clipDetail(head);
    job.log = appendLog(job.log, job.detail);
  }
  emitSubagentJob("completed", job);
}

export function killSubagentJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running") {
    return false;
  }
  job.abort.abort();
  finishSubagentJob(id, "killed", "killed");
  return true;
}

/** Abort every in-flight explore/general child. User Stop must not leave them running. */
export function killAllRunningSubagentJobs(): SubagentJobRecord[] {
  const killed: SubagentJobRecord[] = [];
  for (const job of [...jobs.values()]) {
    if (job.status !== "running") {
      continue;
    }
    if (killSubagentJob(job.id)) {
      killed.push(job);
    }
  }
  return killed;
}

export function dismissSubagentJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status === "running") {
    return false;
  }
  jobs.delete(id);
  return true;
}

export function dismissCompletedSubagentJobs(): void {
  for (const [id, job] of jobs) {
    if (job.status !== "running") {
      jobs.delete(id);
    }
  }
}

export function listSubagentJobs(): SubagentJobRecord[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function toSubagentBackgroundJob(
  record: SubagentJobRecord,
): AgentBackgroundJob {
  return {
    id: record.id,
    kind: "task",
    title: `[${record.profile}] ${record.title}`,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    detail: record.detail ?? record.summary?.split("\n")[0],
    output: record.log ?? record.summary,
  };
}
