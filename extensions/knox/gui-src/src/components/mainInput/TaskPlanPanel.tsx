import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Minus,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanStepStatus } from "core/tools/planStore";

import { useAppSelector } from "../../redux/hooks";
import { collectLatestTaskPlanSnapshot, taskPlanFingerprint } from "../../redux/util/taskPlan";
import {
  applyLivePlanProgress,
  taskPlanFillPercent,
  type LivePlanStep,
} from "../../redux/util/taskPlanProgress";
import type { RootState } from "../../redux/store";
import Spinner from "../gui/Spinner";

const CYAN = "#159994";
const PENDING = "#6e6e77";
const SKIPPED = "#a1a1aa";

function statusIcon(status: PlanStepStatus) {
  switch (status) {
    case "done":
      return (
        <CheckSquare
          size={13}
          strokeWidth={2.25}
          fill={`color-mix(in srgb, ${CYAN} 22%, transparent)`}
          style={{ color: CYAN }}
        />
      );
    case "in_progress":
      return (
        <Square
          size={13}
          strokeWidth={2.25}
          fill={`color-mix(in srgb, ${CYAN} 28%, transparent)`}
          className="animate-pulse"
          style={{ color: CYAN }}
        />
      );
    case "skipped":
      return (
        <Minus size={13} strokeWidth={2.25} style={{ color: SKIPPED }} />
      );
    default:
      return (
        <Square size={13} strokeWidth={2} style={{ color: PENDING }} />
      );
  }
}

function statusLabelKey(status: PlanStepStatus): string {
  switch (status) {
    case "in_progress":
      return "taskPlanStatusActive";
    case "done":
      return "taskPlanStatusDone";
    case "skipped":
      return "taskPlanStatusSkipped";
    default:
      return "taskPlanStatusPending";
  }
}

function StepRow({
  step,
  index,
}: {
  step: LivePlanStep;
  index: number;
}) {
  const { t } = useTranslation();
  const muted = step.status === "done" || step.status === "skipped";
  const active = step.status === "in_progress";
  const label = [t(statusLabelKey(step.status)), step.activity]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="flex items-center gap-1.5 rounded px-1.5 py-0.5"
      data-testid={`task-plan-step-${step.id}`}
      data-status={step.status}
      title={label}
      aria-label={`${index + 1}. ${step.title} (${label})`}
      style={
        active
          ? {
              background: `color-mix(in srgb, ${CYAN} 10%, transparent)`,
            }
          : undefined
      }
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {statusIcon(step.status)}
      </span>
      <div
        className={`min-w-0 flex-1 truncate text-[11px] leading-4 ${
          muted ? "opacity-55" : ""
        } ${step.status === "skipped" ? "line-through" : ""}`}
        style={
          active
            ? { color: CYAN }
            : muted
              ? { color: "var(--vscode-descriptionForeground)" }
              : { color: "var(--vscode-foreground)" }
        }
      >
        <span className="opacity-45">{index + 1}.</span> {step.title}
      </div>
    </div>
  );
}

export function TaskPlanPanel() {
  const { t } = useTranslation();
  const history = useAppSelector((s: RootState) => s.session.history);
  const snapshot = useMemo(
    () => collectLatestTaskPlanSnapshot(history),
    [history],
  );
  const plan = useMemo(
    () =>
      snapshot
        ? applyLivePlanProgress(snapshot.plan, history, snapshot.historyIndex)
        : undefined,
    [history, snapshot],
  );
  const structureKey = snapshot
    ? `${snapshot.plan.title}|${snapshot.plan.steps.map((s) => s.id).join(",")}`
    : "";
  const [open, setOpen] = useState(true);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const prevStructure = useRef(structureKey);

  useEffect(() => {
    if (structureKey && structureKey !== prevStructure.current) {
      setOpen(true);
    }
    prevStructure.current = structureKey;
  }, [structureKey]);

  if (!plan || !snapshot) {
    return null;
  }

  const fingerprint = taskPlanFingerprint(snapshot.plan);
  if (dismissedKey === fingerprint) {
    return null;
  }

  const fill = taskPlanFillPercent(plan);
  const current = plan.current;

  return (
    <div
      className="attached-input-panel mx-0.5 mb-0 overflow-hidden transition-all duration-300"
      data-testid="task-plan-panel"
    >
      <button
        type="button"
        className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 px-2.5 transition-opacity hover:opacity-80"
        style={{ background: "transparent", border: "none" }}
        aria-expanded={open}
        data-testid="task-plan-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex shrink-0 items-center" style={{ color: CYAN }}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {plan.updating ? (
            <Spinner size="12px" thickness="1.5px" />
          ) : (
            <ListChecks size={12} style={{ color: CYAN }} />
          )}
        </span>

        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--vscode-foreground)" }}
        >
          {t("taskPlanTitle")}
        </span>

        <span className="ml-1 flex min-w-0 items-center gap-1.5 text-[10px] tabular-nums">
          {plan.steps.length > 0 ? (
            <span style={{ color: CYAN }}>
              {plan.remaining === 0
                ? t("taskPlanAllDone")
                : t("taskPlanFraction", {
                    done: plan.doneCount,
                    total: plan.steps.length,
                  })}
            </span>
          ) : (
            <span className="text-secgray">{t("taskPlanEmpty")}</span>
          )}
          {current ? (
            <span className="text-secgray min-w-0 flex-1 truncate">
              {current.title}
            </span>
          ) : null}
        </span>

        <span
          role="button"
          tabIndex={0}
          className="text-secgray hover:text-vsc-foreground ml-auto shrink-0 cursor-pointer"
          aria-label={t("taskPlanDismiss")}
          onClick={(e) => {
            e.stopPropagation();
            setDismissedKey(fingerprint);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setDismissedKey(fingerprint);
            }
          }}
        >
          <X className="h-3 w-3" />
        </span>
      </button>

      <div
        className="mx-2.5 mb-0.5 h-0.5 overflow-hidden rounded-full"
        data-testid="task-plan-progress-bar"
        style={{
          background: `color-mix(in srgb, ${CYAN} 16%, transparent)`,
        }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${fill}%`,
            background: CYAN,
          }}
        />
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: open ? "40vh" : 0,
          opacity: open ? 1 : 0,
        }}
      >
        <div
          className="max-h-[38vh] space-y-0 overflow-y-auto px-2 py-1 text-xs"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${CYAN} 10%, transparent)`,
          }}
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <div className="truncate text-[11px] font-medium">{plan.title}</div>
            {plan.remaining > 0 ? (
              <span className="text-secgray shrink-0 text-[10px] tabular-nums">
                {t("taskPlanProgress", {
                  remaining: plan.remaining,
                  total: plan.steps.length,
                })}
              </span>
            ) : null}
          </div>
          {plan.steps.length === 0 ? (
            <div className="opacity-50">{t("taskPlanEmpty")}</div>
          ) : (
            plan.steps.map((step, index) => (
              <StepRow key={step.id} step={step} index={index} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
