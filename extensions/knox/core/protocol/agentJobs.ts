/** Shared wire types for the background agent jobs panel (P3.10). */

export type AgentBackgroundJobKind = "shell" | "task";
export type AgentBackgroundJobStatus = "running" | "exited" | "killed";
export type AgentJobEvent = "started" | "updated" | "completed";
export type AgentJobAction = "list" | "kill" | "killAll" | "dismiss" | "clear";

export interface AgentBackgroundJob {
  id: string;
  kind: AgentBackgroundJobKind;
  title: string;
  status: AgentBackgroundJobStatus;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number | null;
  detail?: string;
  /** Last ~4KB of stdout/stderr for the expandable jobs row. */
  output?: string;
  truncated?: boolean;
  /** Full untruncated log for make/ninja/gcc/qemu jobs (HL-09). */
  logPath?: string;
}

export interface AgentJobsRequest {
  action: AgentJobAction;
  jobId?: string;
}

export interface AgentJobsResponse {
  ok: boolean;
  error?: string;
  jobs: AgentBackgroundJob[];
}

export interface AgentJobUpdate {
  event: AgentJobEvent;
  job: AgentBackgroundJob;
  jobs: AgentBackgroundJob[];
}
