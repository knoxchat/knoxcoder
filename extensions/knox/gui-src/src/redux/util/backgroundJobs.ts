import { ChatHistoryItem } from "core";
import type { AgentBackgroundJob } from "core/protocol/agentJobs";
import { BuiltInToolNames } from "core/tools/builtIn";

import { getHistoryToolStates } from "./index";

const TASK_ID_PREFIX = "task:";

export function isTaskJobId(id: string): boolean {
  return id.startsWith(TASK_ID_PREFIX);
}

export function truncateJobTitle(title: string, max = 72): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function countRunningJobs(jobs: AgentBackgroundJob[]): number {
  return jobs.filter((job) => job.status === "running").length;
}

export function sortBackgroundJobs(
  jobs: AgentBackgroundJob[],
): AgentBackgroundJob[] {
  return [...jobs].sort((a, b) => {
    const aRun = a.status === "running" ? 0 : 1;
    const bRun = b.status === "running" ? 0 : 1;
    if (aRun !== bRun) {
      return aRun - bRun;
    }
    return (b.startedAt ?? 0) - (a.startedAt ?? 0);
  });
}

export function mergeBackgroundJobs(
  shellJobs: AgentBackgroundJob[],
  taskJobs: AgentBackgroundJob[],
): AgentBackgroundJob[] {
  const byId = new Map<string, AgentBackgroundJob>();
  for (const job of shellJobs) {
    byId.set(job.id, job);
  }
  for (const job of taskJobs) {
    if (!byId.has(job.id)) {
      byId.set(job.id, job);
    }
  }
  return sortBackgroundJobs([...byId.values()]);
}

export function collectRunningTaskJobs(
  history: ChatHistoryItem[],
): AgentBackgroundJob[] {
  const jobs: AgentBackgroundJob[] = [];
  for (const item of history) {
    for (const state of getHistoryToolStates(item)) {
      const name = state.toolCall?.function?.name;
      if (name !== BuiltInToolNames.Task) {
        continue;
      }
      if (
        state.status !== "calling" &&
        state.status !== "generated" &&
        state.status !== "generating"
      ) {
        continue;
      }
      const prompt =
        typeof state.parsedArgs?.prompt === "string"
          ? state.parsedArgs.prompt
          : "";
      const profile =
        typeof state.parsedArgs?.profile === "string"
          ? state.parsedArgs.profile
          : "explore";
      const id = `${TASK_ID_PREFIX}${state.toolCallId || state.toolCall.id}`;
      jobs.push({
        id,
        kind: "task",
        title: prompt || profile,
        status: "running",
        detail: profile,
      });
    }
  }
  return jobs;
}

/** Jobs that were running in `prev` and are finished in `next` (toast candidates). */
export function jobsToNotify(
  prev: AgentBackgroundJob[],
  next: AgentBackgroundJob[],
): AgentBackgroundJob[] {
  const prevRunning = new Set(
    prev.filter((job) => job.status === "running").map((job) => job.id),
  );
  const seen = new Set<string>();
  const finished: AgentBackgroundJob[] = [];
  for (const job of next) {
    if (job.status === "running" || !prevRunning.has(job.id) || seen.has(job.id)) {
      continue;
    }
    seen.add(job.id);
    finished.push(job);
  }
  return finished;
}

export function jobToastLevel(
  job: AgentBackgroundJob,
): "info" | "warning" | "error" {
  if (job.status === "killed") {
    return "warning";
  }
  if (typeof job.exitCode === "number" && job.exitCode !== 0) {
    return "error";
  }
  return "info";
}
