/**
 * In-flight explore/general child agents for the jobs panel (HL-36).
 */

import type { AgentBackgroundJob } from "../../protocol/agentJobs";

export interface SubagentJobRecord {
  id: string;
  title: string;
  profile: string;
  status: "running" | "exited" | "killed";
  startedAt: number;
  endedAt?: number;
  summary?: string;
  abort: AbortController;
}

const jobs = new Map<string, SubagentJobRecord>();
let seq = 0;

export const MAX_PARALLEL_EXPLORES = 3;

export function resetSubagentJobs(): void {
  for (const job of jobs.values()) {
    if (job.status === "running") {
      job.abort.abort();
    }
  }
  jobs.clear();
  seq = 0;
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
    abort: input.abort ?? new AbortController(),
  };
  jobs.set(id, record);
  return record;
}

export function finishSubagentJob(
  id: string,
  status: "exited" | "killed",
  summary?: string,
): void {
  const job = jobs.get(id);
  if (!job) {
    return;
  }
  job.status = status;
  job.endedAt = Date.now();
  job.summary = summary;
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
    detail: record.summary?.split("\n")[0],
    output: record.summary,
  };
}
