import type { AgentBackgroundJob } from "core/protocol/agentJobs";
import { Bot, ChevronDown, ChevronRight, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { toggleJobsPanel } from "../../redux/slices/uiSlice";
import { runAgentJobAction } from "../../redux/thunks/agentJobs";
import { formatDurationMs } from "../../redux/util/agentActivity";
import {
  collectRunningTaskJobs,
  countRunningJobs,
  isTaskJobId,
  mergeBackgroundJobs,
  truncateJobTitle,
} from "../../redux/util/backgroundJobs";
import Spinner from "../gui/Spinner";

const CYAN = "#159994";

export function BackgroundAgentPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.session.mode);
  const history = useAppSelector((state) => state.session.history);
  const shellJobs = useAppSelector((state) => state.ui.backgroundJobs);
  const isExpanded = useAppSelector((state) => state.ui.jobsPanelOpen);
  const [now, setNow] = useState(() => Date.now());
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  const taskJobs = useMemo(() => collectRunningTaskJobs(history), [history]);
  const jobs = useMemo(
    () => mergeBackgroundJobs(shellJobs, taskJobs),
    [shellJobs, taskJobs],
  );
  const running = countRunningJobs(jobs);
  const failed = jobs.filter(
    (job) =>
      job.status === "exited" &&
      typeof job.exitCode === "number" &&
      job.exitCode !== 0,
  ).length;
  const canClearFinished = jobs.some((job) => job.status !== "running");

  useEffect(() => {
    if (running === 0) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (mode !== "agent" || jobs.length === 0) {
    return null;
  }

  return (
    <div
      className="attached-input-panel mx-0.5 mb-0 overflow-hidden transition-all duration-300"
      data-testid="agent-jobs-panel"
    >
      <button
        type="button"
        className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 px-2.5 transition-opacity hover:opacity-80"
        style={{ background: "transparent", border: "none" }}
        aria-expanded={isExpanded}
        data-testid="agent-jobs-toggle"
        onClick={() => dispatch(toggleJobsPanel())}
      >
        <span className="flex shrink-0 items-center" style={{ color: CYAN }}>
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--vscode-foreground)" }}
        >
          {t("jobsCount", { count: jobs.length })}
        </span>

        <span className="ml-1 flex items-center gap-1.5 text-[10px] tabular-nums">
          {running > 0 && (
            <span style={{ color: CYAN }}>
              {t("jobsRunning", { count: running })}
            </span>
          )}
          {failed > 0 && (
            <span style={{ color: "#f87171" }}>
              {t("jobsFailedCount", { count: failed })}
            </span>
          )}
        </span>

        {canClearFinished && (
          <span
            role="button"
            tabIndex={0}
            className="text-secgray hover:text-vsc-foreground ml-auto shrink-0 cursor-pointer text-[10px]"
            title={t("jobsClearFinishedHint")}
            onClick={(event) => {
              event.stopPropagation();
              dispatch(runAgentJobAction({ action: "clear" }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                dispatch(runAgentJobAction({ action: "clear" }));
              }
            }}
          >
            {t("jobsClearFinished")}
          </span>
        )}
      </button>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "40vh" : 0,
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <ul
          className="m-0 flex max-h-[38vh] list-none flex-col overflow-y-auto p-0 pb-1"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${CYAN} 10%, transparent)`,
          }}
        >
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              now={now}
              logOpen={openLogId === job.id}
              onToggleLog={() =>
                setOpenLogId(openLogId === job.id ? null : job.id)
              }
              onKill={() =>
                dispatch(runAgentJobAction({ action: "kill", jobId: job.id }))
              }
              onDismiss={() =>
                dispatch(
                  runAgentJobAction({ action: "dismiss", jobId: job.id }),
                )
              }
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function JobRow({
  job,
  now,
  logOpen,
  onToggleLog,
  onKill,
  onDismiss,
}: {
  job: AgentBackgroundJob;
  now: number;
  logOpen: boolean;
  onToggleLog: () => void;
  onKill: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const elapsed =
    job.startedAt && job.startedAt > 0
      ? formatDurationMs((job.endedAt ?? now) - job.startedAt)
      : "";
  const Icon = job.kind === "task" ? Bot : Terminal;
  const canKill = job.status === "running" && !isTaskJobId(job.id);
  const canDismiss =
    job.kind === "shell" && job.status !== "running" && !isTaskJobId(job.id);
  const failedJob =
    job.status === "exited" &&
    typeof job.exitCode === "number" &&
    job.exitCode !== 0;

  return (
    <li data-testid={`agent-job-${job.id}`}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {job.status === "running" ? (
            <Spinner />
          ) : (
            <Icon
              className="h-3 w-3"
              style={{ color: failedJob ? "#f87171" : undefined }}
            />
          )}
        </span>
        <button
          type="button"
          className="text-vsc-foreground min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[11px]"
          title={t("jobsOutputHint")}
          onClick={onToggleLog}
        >
          {truncateJobTitle(job.title)}
          {job.detail ? (
            <span className="text-secgray ml-1">
              {truncateJobTitle(job.detail, 40)}
            </span>
          ) : null}
        </button>
        <span
          className="shrink-0 text-[10px] tabular-nums"
          style={{
            color: failedJob
              ? "#f87171"
              : "var(--vscode-descriptionForeground)",
          }}
        >
          {job.status === "running"
            ? elapsed
            : job.status === "killed"
              ? t("jobsStatusKilled")
              : t("jobsStatusExited", { code: job.exitCode ?? "—" })}
        </span>
        {canKill && (
          <button
            type="button"
            className="text-orange hover:bg-orange/15 cursor-pointer border-none bg-transparent px-1 py-0 text-[10px]"
            title={t("jobsKillHint")}
            onClick={onKill}
          >
            {t("jobsKill")}
          </button>
        )}
        {canDismiss && (
          <button
            type="button"
            className="text-secgray hover:bg-lightgray/20 cursor-pointer border-none bg-transparent px-1 py-0"
            title={t("jobsDismissHint")}
            onClick={onDismiss}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {logOpen && (
        <pre
          className="text-secgray mx-2 mb-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1 text-[10px]"
          data-testid={`agent-job-log-${job.id}`}
          style={{
            background:
              "color-mix(in srgb, var(--vscode-foreground) 6%, transparent)",
          }}
        >
          {job.output?.trim() || t("jobsNoOutput")}
        </pre>
      )}
    </li>
  );
}
