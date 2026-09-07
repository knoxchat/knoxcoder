import { ChatHistoryItem } from "core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AgentActivityStep,
  buildAgentActivitySteps,
  summarizeActivity,
  visibleActivitySteps,
} from "../../redux/util/agentActivity";
import { getFontSize } from "../../util";
import { AgentActivityStepList } from "./AgentActivitySteps";

function summaryLine(
  t: (key: string, opts?: Record<string, unknown>) => string,
  steps: AgentActivityStep[],
): string {
  const s = summarizeActivity(steps);
  const parts: string[] = [];
  if (s.thinking) {
    parts.push(t("activitySummaryThinking"));
  }
  if (s.reads) {
    parts.push(t("activitySummaryReads", { count: s.reads }));
  }
  if (s.searches) {
    parts.push(t("activitySummarySearches", { count: s.searches }));
  }
  if (s.edits) {
    parts.push(t("activitySummaryEdits", { count: s.edits }));
  }
  if (s.tests) {
    parts.push(t("activitySummaryTests", { count: s.tests }));
  }
  if (s.other) {
    parts.push(t("activitySummaryOther", { count: s.other }));
  }
  return parts.join(" · ") || t("activityWorking");
}

interface AgentActivityTimelineProps {
  history: ChatHistoryItem[];
  userIndex: number;
}

export function AgentActivityTimeline({
  history,
  userIndex,
}: AgentActivityTimelineProps) {
  const { t } = useTranslation();
  const steps = useMemo(
    () => buildAgentActivitySteps(history, userIndex),
    [history, userIndex],
  );
  const [expanded, setExpanded] = useState(false);
  const { visible, hiddenCount } = visibleActivitySteps(steps, expanded);

  if (!steps.length) {
    return null;
  }

  return (
    <div
      className="mx-3 mb-2 mt-1"
      data-testid="agent-activity-timeline"
      style={{ fontSize: `${getFontSize() - 2}px` }}
    >
      <button
        type="button"
        className="text-secgray hover:text-vsc-foreground flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-0 py-0.5 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        title={t("activityTimeline")}
      >
        <span className="min-w-0 truncate">{summaryLine(t, steps)}</span>
        <span className="text-secgray/80 ml-2 shrink-0">
          {t("activityRowCount", { count: steps.length })}
        </span>
      </button>
      <div className="mt-0.5">
        {hiddenCount > 0 && (
          <button
            type="button"
            className="text-knoxcyan cursor-pointer border-none bg-transparent px-0 py-0.5"
            onClick={() => setExpanded(true)}
          >
            {t("activityShowEarlier", { count: hiddenCount })}
          </button>
        )}
        <AgentActivityStepList steps={visible} />
      </div>
    </div>
  );
}
