import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { runAgentWorktree } from "../../redux/thunks/agentWorktree";
import { getFontSize } from "../../util";

export function WorktreePanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.session.mode);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const worktree = useAppSelector((state) => state.ui.worktree);
  const wasStreaming = useRef(isStreaming);

  useEffect(() => {
    if (worktree.enabled && wasStreaming.current && !isStreaming) {
      void dispatch(runAgentWorktree("status"));
    }
    wasStreaming.current = isStreaming;
  }, [dispatch, isStreaming, worktree.enabled]);

  if (mode !== "agent" || (!worktree.enabled && !worktree.error)) {
    return null;
  }

  const fileCount = worktree.files.length;

  return (
    <div
      className="mb-1 flex flex-col gap-0.5 px-0.5"
      data-testid="agent-worktree-panel"
      style={{ fontSize: `${getFontSize() - 2}px` }}
    >
      <div className="text-secgray flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">
          {worktree.enabled
            ? t("worktreeActive", {
                branch: worktree.branch ?? "knox/agent",
                count: fileCount,
              })
            : t("worktreeChip")}
        </span>
        {worktree.enabled && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="text-knoxcyan hover:bg-lightgray/20 cursor-pointer border-none bg-transparent px-1.5 py-0.5 disabled:opacity-50"
              disabled={worktree.busy || fileCount === 0}
              title={t("worktreeApplyHint")}
              onClick={() => dispatch(runAgentWorktree("apply"))}
            >
              {t("worktreeApply")}
            </button>
            <button
              type="button"
              className="text-orange hover:bg-orange/15 cursor-pointer border-none bg-transparent px-1.5 py-0.5 disabled:opacity-50"
              disabled={worktree.busy}
              title={t("worktreeDiscardHint")}
              onClick={() => dispatch(runAgentWorktree("discard"))}
            >
              {t("worktreeDiscard")}
            </button>
          </div>
        )}
      </div>
      {worktree.error ? (
        <span className="text-orange">{worktree.error}</span>
      ) : worktree.path ? (
        <code className="text-secgray/80 truncate" title={worktree.path}>
          {worktree.path}
        </code>
      ) : null}
    </div>
  );
}
