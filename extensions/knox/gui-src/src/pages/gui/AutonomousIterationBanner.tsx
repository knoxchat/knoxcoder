import { Bot, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import Spinner from "../../components/gui/Spinner";
import type { AutonomousLoopState } from "../../redux/slices/sessionSlice";
import { getFontSize } from "../../util";

const CYAN = "#159994";

interface AutonomousIterationBannerProps {
  loop: AutonomousLoopState;
}

export function AutonomousIterationBanner({
  loop,
}: AutonomousIterationBannerProps) {
  const { t } = useTranslation();

  if (loop.status === "idle") {
    return null;
  }

  const max = loop.maxIterations;
  const unlimited = max <= 0;
  const nearCap = !unlimited && loop.iteration / max >= 0.8;
  const progress = unlimited
    ? null
    : Math.min(100, Math.round((loop.iteration / max) * 100));
  const count = unlimited
    ? { iteration: loop.iteration }
    : { iteration: loop.iteration, max };
  const labelKey =
    loop.status === "completed"
      ? unlimited
        ? "autonomousBannerCompletedUnlimited"
        : "autonomousBannerCompleted"
      : loop.status === "cancelled"
        ? unlimited
          ? "autonomousBannerCancelledUnlimited"
          : "autonomousBannerCancelled"
        : unlimited
          ? "autonomousBannerRunningUnlimited"
          : "autonomousBannerRunning";
  const label = t(labelKey, count);

  return (
    <div
      className="px-2.5 pt-1.5"
      data-testid="autonomous-iteration-banner"
      style={{ fontSize: `${getFontSize() - 3}px` }}
    >
      <div className="text-secgray flex min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 items-center" style={{ color: CYAN }}>
          {loop.status === "running" ? (
            <Spinner size="12px" />
          ) : loop.status === "completed" ? (
            <Check size={12} />
          ) : (
            <X size={12} />
          )}
        </span>
        <Bot size={12} className="shrink-0" style={{ color: CYAN }} />
        <span
          className={`min-w-0 truncate font-medium ${nearCap ? "text-orange" : ""}`}
          title={loop.goal}
        >
          {label}
        </span>
        {loop.goal && (
          <span className="min-w-0 truncate opacity-70" title={loop.goal}>
            {loop.goal}
          </span>
        )}
      </div>
      {progress !== null && (
        <div
          className="bg-lightgray/20 mt-1 h-0.5 overflow-hidden"
          role="progressbar"
          aria-valuenow={loop.iteration}
          aria-valuemin={0}
          aria-valuemax={max}
        >
          <div
            className={`h-full ${nearCap ? "bg-orange" : "bg-knoxcyan"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
