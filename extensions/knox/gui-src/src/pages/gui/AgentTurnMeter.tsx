import { ChatHistoryItem } from "core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import LoadingState from "../../components/loaders/LoadingState";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { useAppSelector } from "../../redux/hooks";
import { selectCurrentToolCall } from "../../redux/selectors/selectCurrentToolCall";
import { hasUnsettledToolCalls } from "../../redux/util";
import {
  buildAgentActivitySteps,
  collectTurnPromptLogs,
  currentActivityStep,
  estimateTokensFromPromptLogs,
  findLastUserIndex,
  formatDurationMs,
  itemCreatedAtMs,
  turnElapsedMs,
} from "../../redux/util/agentActivity";
import { resolveAgentMaxSteps } from "../../redux/util/agentMaxSteps";
import { getFontSize } from "../../util";
import { formatTokenCount } from "../../util/formatTokenCount";
import {
  getLocalStorageSync,
  LocalStorageKey,
  setLocalStorageSync,
} from "../../util/localStorage";
import {
  AgentActivityStepList,
  kindLabelKey,
  loadingVariantFor,
} from "./AgentActivitySteps";
import { AutonomousIterationBanner } from "./AutonomousIterationBanner";

const CYAN = "#159994";

interface AgentTurnMeterProps {
  history: ChatHistoryItem[];
  isStreaming: boolean;
}

export function AgentTurnMeter({ history, isStreaming }: AgentTurnMeterProps) {
  const { t } = useTranslation();
  const toolLoopSteps = useAppSelector((state) => state.session.toolLoopSteps);
  const autonomousLoop = useAppSelector((state) => state.session.autonomousLoop);
  const rawMaxSteps = useAppSelector(
    (state) => state.config.config.experimental?.agentMaxSteps,
  );
  const agentProfile = useAppSelector(
    (state) => state.config.config.experimental?.agentProfile,
  );
  const toolCallState = useAppSelector(selectCurrentToolCall);
  const sessionHistory = useAppSelector((state) => state.session.history);
  const maxSteps = resolveAgentMaxSteps(rawMaxSteps, agentProfile);
  const [open, setOpen] = useState(
    () => getLocalStorageSync(LocalStorageKey.ActivityPanelExpanded) ?? false,
  );

  const userIndex = findLastUserIndex(history);
  const steps = useMemo(
    () =>
      buildAgentActivitySteps(history, userIndex, {
        inProgress: isStreaming,
      }),
    [history, userIndex, isStreaming],
  );
  const current = currentActivityStep(steps);
  const startedAt = itemCreatedAtMs(history[userIndex]);
  const canCancel =
    isStreaming ||
    toolCallState?.status === "calling" ||
    hasUnsettledToolCalls(sessionHistory);
  const live = isStreaming || canCancel;
  const canExpand = steps.length > 0;
  const lastStep = steps[steps.length - 1];
  const activityFingerprint = `${steps.length}:${lastStep?.id ?? ""}:${lastStep?.status ?? ""}:${lastStep?.detail ?? ""}`;
  const { scrollRef } = useStickToBottom({
    follow: open && live,
    contentKey: activityFingerprint,
    resetKey: open && canExpand ? `turn:${userIndex}` : false,
  });

  const tokens = estimateTokensFromPromptLogs(
    collectTurnPromptLogs(history, userIndex),
  );
  const elapsed = turnElapsedMs(history, userIndex, Date.now(), live);

  const autonomousActive =
    autonomousLoop != null && autonomousLoop.status !== "idle";

  if (userIndex < 0 && !isStreaming && !autonomousActive) {
    return null;
  }
  if (
    !steps.length &&
    !isStreaming &&
    toolLoopSteps === 0 &&
    !autonomousActive
  ) {
    return null;
  }

  const stepsLabel =
    maxSteps === null
      ? t("activityStepsUnlimited", { used: toolLoopSteps })
      : t("activityStepsUsed", { used: toolLoopSteps, max: maxSteps });
  const profileLabel =
    agentProfile === "systems"
      ? t("activityProfileSystems")
      : agentProfile === "rust"
        ? t("activityProfileRust")
        : null;
  const nearCap =
    maxSteps !== null && maxSteps > 0 && toolLoopSteps / maxSteps >= 0.8;
  const progress =
    maxSteps !== null && maxSteps > 0
      ? Math.min(100, Math.round((toolLoopSteps / maxSteps) * 100))
      : null;

  return (
    <div
      className="attached-input-panel mx-0.5 mb-0 overflow-hidden"
      data-testid="agent-turn-meter"
      style={{
        fontSize: `${getFontSize() - 3}px`,
      }}
    >
      {autonomousActive && <AutonomousIterationBanner loop={autonomousLoop} />}
      <button
        type="button"
        className={`flex min-h-7 w-full items-center gap-1.5 px-2.5 ${
          canExpand ? "cursor-pointer transition-opacity hover:opacity-80" : "cursor-default"
        }`}
        style={{ background: "transparent", border: "none" }}
        aria-expanded={canExpand ? open : undefined}
        data-testid="agent-turn-meter-toggle"
        title={canExpand ? t("activityTimeline") : undefined}
        onClick={
          canExpand
            ? () =>
                setOpen((prev) => {
                  const next = !prev;
                  setLocalStorageSync(LocalStorageKey.ActivityPanelExpanded, next);
                  return next;
                })
            : undefined
        }
      >
        {canExpand && (
          <span className="flex shrink-0 items-center" style={{ color: CYAN }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}

        {live && (
          <LoadingState
            label={
              current ? t(kindLabelKey(current.kind)) : t("activityLoading")
            }
            variant={loadingVariantFor(current?.kind)}
            startedAt={startedAt}
            testId="agent-turn-meter-loading"
            className="w-auto min-w-0 max-w-full"
          />
        )}

        <span className="text-secgray flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={nearCap ? "text-orange" : undefined}>{stepsLabel}</span>
          {profileLabel && (
            <span data-testid="agent-turn-meter-profile">{profileLabel}</span>
          )}
          {autonomousActive && (
            <span data-testid="agent-turn-meter-autonomous">
              {autonomousLoop.maxIterations > 0
                ? t("activityAutonomous", {
                    iteration: autonomousLoop.iteration,
                    max: autonomousLoop.maxIterations,
                  })
                : t("activityAutonomousUnlimited", {
                    iteration: autonomousLoop.iteration,
                  })}
            </span>
          )}
          {tokens > 0 && (
            <span
              title={`${tokens.toLocaleString()} — ${t("activityTokensEstimate")}`}
            >
              {t("activityTokens", { count: formatTokenCount(tokens) })}
            </span>
          )}
          {!live && elapsed > 0 && <span>{formatDurationMs(elapsed)}</span>}
        </span>

        {canExpand && (
          <span className="text-secgray/80 ml-auto shrink-0">
            {t("activityRowCount", { count: steps.length })}
          </span>
        )}
      </button>

      {progress !== null && (live || toolLoopSteps > 0) && (
        <div
          className="bg-lightgray/20 mx-2.5 h-0.5 overflow-hidden"
          role="progressbar"
          aria-valuenow={toolLoopSteps}
          aria-valuemin={0}
          aria-valuemax={maxSteps ?? undefined}
        >
          <div
            className={`h-full ${nearCap ? "bg-orange" : "bg-knoxcyan"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: open && canExpand ? "40vh" : 0,
          opacity: open && canExpand ? 1 : 0,
        }}
      >
        <div
          ref={scrollRef}
          data-testid="agent-turn-meter-scroll"
          className="max-h-[38vh] overflow-y-auto overscroll-contain px-2.5 py-1"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${CYAN} 10%, transparent)`,
          }}
        >
          <AgentActivityStepList steps={steps} />
        </div>
      </div>
    </div>
  );
}
