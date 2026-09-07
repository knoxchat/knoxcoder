import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { MessageModes } from "core";
import { modelSupportsTools } from "core/llm/autodetect";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import {
  defaultBorderRadius,
  vscCommandCenterInactiveBorder,
} from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import { selectCurrentMode } from "../../redux/slices/sessionSlice";
import {
  cyclePermissionMode,
  setPermissionMode,
  toggleJobsPanel,
} from "../../redux/slices/uiSlice";
import { runAgentWorktree } from "../../redux/thunks/agentWorktree";
import { syncPendingToolPermissions } from "../../redux/thunks/syncPendingToolPermissions";
import {
  collectRunningTaskJobs,
  countRunningJobs,
  mergeBackgroundJobs,
} from "../../redux/util/backgroundJobs";
import { setSessionMode } from "../../redux/thunks/setSessionMode";
import { getMetaKeyLabel } from "../../util";
import {
  DEFAULT_PERMISSION_MODE,
  nextPermissionMode,
  PERMISSION_MODES,
  PermissionMode,
} from "../../redux/util/permissionMode";
import { recordGuiSoulEvent } from "../../redux/util/recordSoulEvent";

const TabContainer = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex min-w-0 shrink-0 items-center gap-0.5", className)}
    {...props}
  />
);

interface TabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

const TabButton = forwardRef<HTMLButtonElement, TabButtonProps>(
  ({ active, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "flex items-center gap-0.5 whitespace-nowrap border-none py-px px-1 cursor-pointer transition-all duration-200",
        active ? "bg-lightgray/20" : "bg-transparent",
        "hover:bg-lightgray/15",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
TabButton.displayName = "TabButton";

function ModeSelect() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const mode = useAppSelector(selectCurrentMode);
  const sessionId = useAppSelector((state) => state.session.id);
  const selectedModel = useAppSelector(selectDefaultModel);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const permissionMode =
    useAppSelector((state) => state.ui.permissionMode) ??
    DEFAULT_PERMISSION_MODE;
  const worktree = useAppSelector((state) => state.ui.worktree);
  const history = useAppSelector((state) => state.session.history);
  const shellJobs = useAppSelector((state) => state.ui.backgroundJobs);
  const jobsPanelOpen = useAppSelector((state) => state.ui.jobsPanelOpen);
  const runningJobs = useMemo(
    () =>
      countRunningJobs(
        mergeBackgroundJobs(shellJobs, collectRunningTaskJobs(history)),
      ),
    [history, shellJobs],
  );
  const agentModeSupported = selectedModel && modelSupportsTools(selectedModel);
  const agentActive = mode === "agent";

  const permissionLabel: Record<PermissionMode, string> = {
    default: t("permissionModeAsk"),
    acceptEdits: t("permissionModeEdits"),
    fullAuto: t("permissionModeAuto"),
  };
  const permissionTitle: Record<PermissionMode, string> = {
    default: t("permissionModeAskHint"),
    acceptEdits: t("permissionModeEditsHint"),
    fullAuto: t("permissionModeAutoHint"),
  };

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    if (mode === "agent" && !agentModeSupported) {
      void dispatch(setSessionMode("chat"));
    }
  }, [mode, agentModeSupported, dispatch, selectedModel]);

  // Keep VS Code AgentModeManager aligned with the Chat/Agent tab
  useEffect(() => {
    ideMessenger.post("setAgentMode", {
      active: mode === "agent",
      sessionId,
    });
  }, [ideMessenger, mode, sessionId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
      }
      if (e.key === "Tab" && e.shiftKey && mode === "agent" && !isStreaming) {
        e.preventDefault();
        const next = nextPermissionMode(permissionMode);
        dispatch(cyclePermissionMode());
        recordGuiSoulEvent(ideMessenger, {
          sessionId,
          kind: "tool_success",
          policy: next === "default" ? "ask" : "allow",
          summary: `Permission mode → ${next}`,
        });
        void dispatch(syncPendingToolPermissions());
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, ideMessenger, mode, isStreaming, permissionMode, sessionId]);

  const handleModeChange = (newMode: MessageModes) => {
    if (newMode === mode || isStreaming) {
      return;
    }
    void dispatch(setSessionMode(newMode));
  };

  const agentTitle = !agentModeSupported
    ? t("agentModeNotSupported")
    : agentActive
      ? t("agentOptions")
      : t("agentMode");

  return (
    <TabContainer>
      <TabButton
        active={mode === "chat"}
        disabled={isStreaming}
        onClick={() => handleModeChange("chat")}
        title={`${t("chatMode")} (${getMetaKeyLabel()}L)`}
        className={mode === "chat" ? "text-knoxcyan" : "text-secgray"}
      >
        <span style={{ fontSize: "0.9em" }}>{t("chat")}</span>
      </TabButton>

      {agentActive && agentModeSupported ? (
        <Menu>
          <MenuButton
            as={TabButton}
            active
            disabled={isStreaming}
            title={agentTitle}
            className="text-knoxcyan"
            data-testid="agent-options-trigger"
          >
            <span style={{ fontSize: "0.9em" }}>{t("agent")}</span>
            {runningJobs > 0 && (
              <span
                className="text-knoxcyan min-w-[0.9em] text-center"
                style={{ fontSize: "0.7em" }}
              >
                {runningJobs}
              </span>
            )}
            <ChevronDown className="h-2.5 w-2.5 opacity-80" aria-hidden="true" />
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            className="bg-vsc-input-background text-vsc-foreground z-[1000] mt-1 min-w-[12rem] overflow-hidden py-1 shadow-md focus:outline-none"
            style={{
              border: `1px solid ${vscCommandCenterInactiveBorder}`,
              borderRadius: defaultBorderRadius,
            }}
          >
            <div
              className="text-secgray px-2 pb-1 pt-1.5 uppercase tracking-wide"
              style={{ fontSize: "0.65em" }}
            >
              {t("permissionModeGroup")}
            </div>
            {PERMISSION_MODES.map((value) => (
              <MenuItem key={value} disabled={isStreaming}>
                {({ focus, disabled }) => (
                  <button
                    type="button"
                    disabled={disabled}
                    title={`${permissionTitle[value]} (Shift+Tab)`}
                    onClick={() => {
                      dispatch(setPermissionMode(value));
                      recordGuiSoulEvent(ideMessenger, {
                        sessionId,
                        kind: "tool_success",
                        policy: value === "default" ? "ask" : "allow",
                        summary: `Permission mode → ${value}`,
                      });
                      void dispatch(syncPendingToolPermissions());
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2 py-1 text-left",
                      focus && "bg-lightgray/15",
                      disabled && "cursor-not-allowed opacity-50",
                      value === permissionMode
                        ? value === "fullAuto"
                          ? "text-orange"
                          : "text-knoxcyan"
                        : "text-vsc-foreground",
                    )}
                    style={{ fontSize: "0.85em" }}
                  >
                    <Check
                      className={cn(
                        "h-3 w-3 shrink-0",
                        value === permissionMode ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex-1">{permissionLabel[value]}</span>
                  </button>
                )}
              </MenuItem>
            ))}

            <div
              className="bg-lightgray/20 my-1 h-px"
              role="separator"
            />

            <MenuItem disabled={isStreaming || worktree.busy}>
              {({ focus, disabled }) => (
                <button
                  type="button"
                  disabled={disabled}
                  title={
                    worktree.enabled
                      ? t("worktreeLeaveHint")
                      : t("worktreeEnterHint")
                  }
                  onClick={() =>
                    dispatch(
                      runAgentWorktree(worktree.enabled ? "discard" : "enter"),
                    )
                  }
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2 py-1 text-left",
                    focus && "bg-lightgray/15",
                    disabled && "cursor-not-allowed opacity-50",
                    worktree.enabled ? "text-knoxcyan" : "text-vsc-foreground",
                  )}
                  style={{ fontSize: "0.85em" }}
                >
                  <Check
                    className={cn(
                      "h-3 w-3 shrink-0",
                      worktree.enabled ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{t("worktreeChip")}</span>
                </button>
              )}
            </MenuItem>

            <MenuItem>
              {({ focus }) => (
                <button
                  type="button"
                  title={
                    jobsPanelOpen ? t("jobsChipHintOpen") : t("jobsChipHint")
                  }
                  onClick={() => dispatch(toggleJobsPanel())}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2 py-1 text-left",
                    focus && "bg-lightgray/15",
                    runningJobs > 0
                      ? "text-knoxcyan"
                      : "text-vsc-foreground",
                  )}
                  style={{ fontSize: "0.85em" }}
                >
                  <Check
                    className={cn(
                      "h-3 w-3 shrink-0",
                      jobsPanelOpen ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1">
                    {runningJobs > 0
                      ? t("jobsChipCount", { count: runningJobs })
                      : t("jobsChip")}
                  </span>
                </button>
              )}
            </MenuItem>
          </MenuItems>
        </Menu>
      ) : (
        <TabButton
          active={false}
          disabled={isStreaming || !agentModeSupported}
          onClick={() => handleModeChange("agent")}
          title={agentTitle}
          className={!agentModeSupported ? "text-orange" : "text-secgray"}
        >
          <span style={{ fontSize: "0.9em" }}>{t("agent")}</span>
        </TabButton>
      )}
    </TabContainer>
  );
}

export default ModeSelect;
