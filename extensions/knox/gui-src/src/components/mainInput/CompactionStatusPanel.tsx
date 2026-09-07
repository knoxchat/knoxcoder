import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  setLastCompaction,
  type LastCompactionState,
} from "../../redux/slices/sessionSlice";
import type { RootState } from "../../redux/store";

const CYAN = "#159994";

function isCompactionBannerVisible(
  compaction: LastCompactionState | null | undefined,
): compaction is LastCompactionState {
  return Boolean(
    compaction &&
      (compaction.tokensSaved > 0 ||
        compaction.originalMessageCount > compaction.compactedMessageCount),
  );
}

/**
 * Compact provenance UI for the latest context compaction.
 * Styled as an attached input header, matching InjectedMemoriesPanel.
 */
export function CompactionStatusPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const compaction = useAppSelector(
    (s: RootState) => s.session.lastCompaction,
  );
  const [open, setOpen] = useState(false);

  useWebviewListener(
    "compaction/applied",
    async (data) => {
      if (
        !data ||
        (data.tokensSaved <= 0 &&
          data.originalMessageCount <= data.compactedMessageCount)
      ) {
        dispatch(setLastCompaction(null));
        return;
      }
      dispatch(
        setLastCompaction({
          tokensSaved: data.tokensSaved,
          originalMessageCount: data.originalMessageCount,
          compactedMessageCount: data.compactedMessageCount,
          summarized: data.summarized,
          deduplicated: data.deduplicated,
          summarizationMethod: data.summarizationMethod,
          summaryText: data.summaryText,
        }),
      );
      setOpen(false);
    },
    [dispatch],
  );

  if (!isCompactionBannerVisible(compaction)) {
    return null;
  }

  const methodLabel =
    compaction.summarizationMethod === "llm"
      ? t("compactionMethodLlm")
      : compaction.summarizationMethod === "heuristic"
        ? t("compactionMethodHeuristic")
        : t("compactionMethodNone");

  return (
    <div
      className="attached-input-panel mx-0.5 mb-0 overflow-hidden transition-all duration-300"
      data-testid="compaction-status-panel"
    >
      <button
        type="button"
        className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 px-2.5 transition-opacity hover:opacity-80"
        style={{ background: "transparent", border: "none" }}
        aria-expanded={open}
        data-testid="compaction-status-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex shrink-0 items-center" style={{ color: CYAN }}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--vscode-foreground)" }}
        >
          {t("compactionAppliedTitle")}
        </span>

        <span className="text-secgray ml-1 text-[10px]">{methodLabel}</span>

        <span
          role="button"
          tabIndex={0}
          className="text-secgray hover:text-vsc-foreground ml-auto shrink-0 cursor-pointer"
          aria-label={t("compactionDismiss")}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(setLastCompaction(null));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              dispatch(setLastCompaction(null));
            }
          }}
        >
          <X className="h-3 w-3" />
        </span>
      </button>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: open ? "40vh" : 0,
          opacity: open ? 1 : 0,
        }}
      >
        <div
          className="max-h-[38vh] space-y-1.5 overflow-y-auto px-2 py-1.5 text-xs"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${CYAN} 10%, transparent)`,
          }}
        >
          <div className="opacity-60">
            {t("compactionStats", {
              from: compaction.originalMessageCount,
              to: compaction.compactedMessageCount,
            })}
            {compaction.deduplicated
              ? ` · ${t("compactionDeduplicated")}`
              : ""}
            {compaction.summarized ? ` · ${t("compactionSummarized")}` : ""}
          </div>
          {compaction.summaryText ? (
            <pre
              className="text-secgray whitespace-pre-wrap break-words rounded px-2 py-1.5"
              style={{
                background:
                  "color-mix(in srgb, var(--vscode-foreground) 6%, transparent)",
                fontSize: "11px",
              }}
            >
              {compaction.summaryText}
            </pre>
          ) : (
            <div className="opacity-50">{t("compactionNoSummary")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
