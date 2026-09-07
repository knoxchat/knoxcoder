import { BuiltInToolNames } from "core/tools/builtIn";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  selectCurrentToolCall,
  selectIsCurrentToolAutoApproved,
} from "../../../redux/selectors/selectCurrentToolCall";
import { addSessionToolAllowlist } from "../../../redux/slices/sessionSlice";
import { callTool } from "../../../redux/thunks/callTool";
import { cancelTool } from "../../../redux/thunks/cancelTool";
import {
  getToolPermissionDisplay,
  isSamePermissionTool,
  resolvePermissionToolName,
} from "../../../redux/util/permissionMode";
import { recordGuiSoulEvent } from "../../../redux/util/recordSoulEvent";
import {
  hasGuiToolApproval,
  resolveGuiToolApproval,
} from "../../../redux/util/guiToolApproval";

interface PermissionActionButtonsProps {
  toolName?: string;
  compact?: boolean;
}

export function PermissionActionButtons({
  toolName,
  compact = false,
}: PermissionActionButtonsProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const sessionId = useAppSelector((state) => state.session.id);
  const toolCallState = useAppSelector(selectCurrentToolCall);
  const sessionAllowlist = useAppSelector(
    (state) => state.session.sessionToolAllowlist,
  );
  const toolSettings = useAppSelector((state) => state.ui.toolSettings);
  const autoApproved = useAppSelector(selectIsCurrentToolAutoApproved);
  const autonomousRunning = useAppSelector(
    (state) => state.session.autonomousLoop.status === "running",
  );

  const pendingName = resolvePermissionToolName(
    toolCallState?.toolCall.function.name,
  );
  const targetName = resolvePermissionToolName(toolName) || pendingName;
  const isPending =
    toolCallState?.status === "generated" &&
    pendingName.length > 0 &&
    isSamePermissionTool(pendingName, targetName) &&
    pendingName !== BuiltInToolNames.AskUser;

  if (!isPending || !toolCallState || autoApproved) {
    return null;
  }

  const display = getToolPermissionDisplay({
    toolName: targetName,
    toolSettings,
    sessionAllowlist,
  });
  const alwaysActive =
    display === "sessionAlways" || display === "autoApprove";

  const resolveAutonomous = (allow: boolean, always?: boolean) => {
    void ideMessenger.request("brain/resolveAutonomousTool", {
      sessionId,
      callId: toolCallState.toolCallId,
      allow,
      always,
    });
  };

  const resolveGuiLoop = (allow: boolean, always?: boolean) => {
    resolveGuiToolApproval(toolCallState.toolCallId, allow, always);
  };

  const approveOnce = () => {
    if (autonomousRunning) {
      resolveAutonomous(true);
      return;
    }
    if (hasGuiToolApproval(toolCallState.toolCallId)) {
      resolveGuiLoop(true);
      return;
    }
    void dispatch(callTool({ toolCallId: toolCallState.toolCallId }));
  };

  const approveAlwaysSession = () => {
    if (targetName) {
      dispatch(addSessionToolAllowlist(targetName));
      recordGuiSoulEvent(ideMessenger, {
        sessionId,
        kind: "tool_success",
        toolName: targetName,
        policy: "allow",
        summary: `Always allowed ${targetName} for this chat`,
      });
    }
    if (autonomousRunning) {
      resolveAutonomous(true, true);
      return;
    }
    if (hasGuiToolApproval(toolCallState.toolCallId)) {
      resolveGuiLoop(true, true);
      return;
    }
    void dispatch(callTool({ toolCallId: toolCallState.toolCallId }));
  };

  const deny = () => {
    if (autonomousRunning) {
      resolveAutonomous(false);
      return;
    }
    if (hasGuiToolApproval(toolCallState.toolCallId)) {
      resolveGuiLoop(false);
      return;
    }
    void dispatch(cancelTool({ toolCallId: toolCallState.toolCallId }));
  };

  const buttonClass = compact
    ? "px-1.5 py-0.5 text-[10px] rounded"
    : "p-1 rounded-md flex-1";

  return (
    <div
      className={`flex ${compact ? "gap-1" : "gap-2 mt-3 m-2"}`}
      data-testid="permission-action-buttons"
      data-tool-name={targetName}
    >
      <button
        type="button"
        onClick={deny}
        className={`${buttonClass} cursor-pointer hover:opacity-80 text-lightgray border border-lightgray bg-transparent`}
      >
        {t("deny")}
      </button>
      <button
        type="button"
        onClick={approveAlwaysSession}
        className={`${buttonClass} cursor-pointer hover:opacity-80 border ${
          alwaysActive
            ? "border-knoxcyan/50 bg-knoxcyan/15 text-knoxcyan"
            : "text-lightgray border-lightgray bg-transparent"
        }`}
        title={t("alwaysThisSessionHint")}
        aria-pressed={alwaysActive}
      >
        {t("alwaysThisSession")}
      </button>
      <button
        type="button"
        onClick={approveOnce}
        data-testid="accept-tool-call-button"
        className={`${buttonClass} cursor-pointer hover:opacity-80 border-none bg-vsc-button-background text-vsc-button-foreground`}
      >
        {t("approveOnce")}
      </button>
    </div>
  );
}
