import {
  Brain,
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
  Target,
  ThumbsDown,
  Trash2,
  X,
} from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  removeInjectedMemory,
  setLastInjectedMemories,
  updateInjectedMemoryPinned,
} from "../../redux/slices/sessionSlice";
import type { RootState } from "../../redux/store";

const CYAN = "#159994";
/** REL-19: collapse below this fusion score in selective mode. */
const SELECTIVE_COLLAPSE_BELOW = 0.7;

/**
 * Compact provenance UI for memories injected into the latest chat turn.
 * Lets the user see "why this memory", pin, forget, or mark not relevant.
 * Styled as an attached input header, matching BackgroundAgentPanel.
 */
export function InjectedMemoriesPanel() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const items = useAppSelector(
    (s: RootState) => s.session.lastInjectedMemories,
  );
  const sessionId = useAppSelector((s: RootState) => s.session.id);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [memoryMode, setMemoryMode] = useState<string>("summarized");
  const [showLowScoring, setShowLowScoring] = useState(false);

  useEffect(() => {
    void ideMessenger.request("brain/getConfig", undefined).then((result) => {
      if (result.status === "success") {
        const mode = (result.content as any)?.config?.memory_mode;
        if (typeof mode === "string") setMemoryMode(mode);
      }
    });
  }, [ideMessenger, items.length]);

  const { visible, collapsed } = useMemo(() => {
    if (memoryMode !== "selective") {
      return { visible: items, collapsed: [] as typeof items };
    }
    const high = items.filter(
      (i) =>
        i.kind === "timeout" ||
        i.kind === "goal" ||
        typeof i.score !== "number" ||
        i.score >= SELECTIVE_COLLAPSE_BELOW,
    );
    const low = items.filter((i) => !high.includes(i));
    return { visible: high, collapsed: low };
  }, [items, memoryMode]);

  const rendered = showLowScoring ? [...visible, ...collapsed] : visible;

  if (!items.length) return null;

  const actionable = items.filter((i) => i.id != null && i.kind === "semantic");
  const isTimeoutNotice =
    items.length === 1 && items[0].kind === "timeout";

  const handlePin = async (id: number, pinned: boolean) => {
    setBusyId(id);
    try {
      const result = await ideMessenger.request(
        pinned ? "brain/unpinMemory" : "brain/pinMemory",
        { id },
      );
      if (result.status === "success" && (result.content as any)?.success) {
        dispatch(updateInjectedMemoryPinned({ id, pinned: !pinned }));
      }
    } catch {
      // best-effort
    } finally {
      setBusyId(null);
    }
  };

  const handleForget = async (id: number) => {
    setBusyId(id);
    try {
      const result = await ideMessenger.request("brain/deleteMemory", { id });
      if (result.status === "success" && (result.content as any)?.success) {
        dispatch(removeInjectedMemory(id));
      }
    } catch {
      // best-effort
    } finally {
      setBusyId(null);
    }
  };

  const handleMismatch = async (id: number) => {
    setBusyId(id);
    try {
      const result = await ideMessenger.request("brain/mismatchMemory", {
        id,
        sessionId,
      });
      if (result.status === "success" && (result.content as any)?.success) {
        dispatch(removeInjectedMemory(id));
      }
    } catch {
      // best-effort
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="attached-input-panel mx-0.5 mb-0 overflow-hidden transition-all duration-300"
      data-testid="injected-memories-panel"
    >
      <button
        type="button"
        className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 px-2.5 transition-opacity hover:opacity-80"
        style={{ background: "transparent", border: "none" }}
        aria-expanded={open}
        data-testid="injected-memories-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex shrink-0 items-center" style={{ color: CYAN }}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        <Brain size={12} className="shrink-0" style={{ color: CYAN }} />

        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--vscode-foreground)" }}
        >
          {isTimeoutNotice
            ? t("memoryInjectUnavailable")
            : t("memoryInjectedTitle", { count: items.length })}
        </span>

        <span
          role="button"
          tabIndex={0}
          className="text-secgray hover:text-vsc-foreground ml-auto shrink-0 cursor-pointer"
          aria-label={t("memoryInjectDismiss")}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(setLastInjectedMemories([]));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              dispatch(setLastInjectedMemories([]));
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
          className="max-h-[38vh] space-y-1 overflow-y-auto px-2 py-1.5 text-xs"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${CYAN} 10%, transparent)`,
          }}
        >
          {rendered.map((item, idx) => (
            <div
              key={`${item.kind}-${item.id ?? idx}`}
              className="flex items-start gap-2 rounded px-1 py-1"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 truncate font-medium">
                  {item.kind === "goal" ? (
                    <Target size={10} style={{ color: CYAN }} className="shrink-0" />
                  ) : item.pinned ? (
                    <Pin size={10} style={{ color: CYAN }} className="shrink-0" />
                  ) : null}
                  <span className="truncate">
                    {item.kind === "timeout"
                      ? t("memoryInjectUnavailable")
                      : item.title}
                  </span>
                  {item.category ? (
                    <span className="shrink-0 opacity-50">[{item.category}]</span>
                  ) : item.kind === "goal" ? (
                    <span className="shrink-0 opacity-50">[C_goal]</span>
                  ) : null}
                  {typeof item.score === "number" && Number.isFinite(item.score) ? (
                    <span className="shrink-0 opacity-50">
                      {item.score.toFixed(2)}
                    </span>
                  ) : null}
                </div>
                <div className="opacity-55">
                  {item.kind === "timeout"
                    ? t("memoryContextTimeoutReason")
                    : item.reason}
                </div>
                {item.kind !== "timeout" &&
                  Array.isArray(item.evidence) &&
                  item.evidence.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {item.evidence.map((token) => (
                        <span
                          key={token}
                          className="rounded px-1 py-px text-[10px] opacity-70"
                          style={{
                            background:
                              "color-mix(in srgb, var(--vscode-foreground) 8%, transparent)",
                          }}
                        >
                          {token}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
              {item.id != null && item.kind === "semantic" && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    title={
                      item.pinned ? t("memoryUnpin") : t("memoryPin")
                    }
                    className="rounded p-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
                    onClick={() => void handlePin(item.id!, !!item.pinned)}
                  >
                    {item.pinned ? (
                      <PinOff size={12} style={{ color: CYAN }} />
                    ) : (
                      <Pin size={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    title={t("memoryNotRelevant")}
                    className="rounded p-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
                    onClick={() => void handleMismatch(item.id!)}
                  >
                    <ThumbsDown size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    title={t("memoryForget")}
                    className="rounded p-0.5 opacity-60 hover:text-red-400 hover:opacity-100 disabled:opacity-30"
                    onClick={() => void handleForget(item.id!)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {collapsed.length > 0 && (
            <button
              type="button"
              className="w-full rounded px-1 py-1 text-left opacity-60 hover:opacity-100"
              style={{ background: "transparent", border: "none" }}
              onClick={() => setShowLowScoring((v) => !v)}
            >
              {showLowScoring
                ? t("memoryHideLowerScoring")
                : t("memoryShowLowerScoring", { count: collapsed.length })}
            </button>
          )}
          {actionable.length === 0 && !isTimeoutNotice && (
            <div className="opacity-50">{t("memoryInjectNoActions")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
