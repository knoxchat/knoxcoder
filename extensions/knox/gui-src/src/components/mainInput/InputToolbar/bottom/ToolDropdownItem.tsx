import { Tool } from "core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { PermissionActionButtons } from "../../../../pages/gui/ToolCallDiv/PermissionActionButtons";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import {
  selectCurrentToolCall,
  selectIsCurrentToolAutoApproved,
} from "../../../../redux/selectors/selectCurrentToolCall";
import { removeSessionToolAllowlist } from "../../../../redux/slices/sessionSlice";
import { addTool, toggleToolSetting } from "../../../../redux/slices/uiSlice";
import { syncPendingToolPermissions } from "../../../../redux/thunks/syncPendingToolPermissions";
import {
  getToolPermissionDisplay,
  isSamePermissionTool,
  resolvePermissionToolName,
} from "../../../../redux/util/permissionMode";
import { InformationCircleIcon } from "../../../../svg-icons";
import { fontSize } from "../../../../util";
import { getCategorizedToolName } from "../../../../util/toolNameFormatter";
import { ToolTip } from "../../../gui/Tooltip";

interface ToolDropdownItemProps {
  tool: Tool;
  duplicatesDetected: boolean;
  excluded: boolean;
}

function ToolDropdownItem(props: ToolDropdownItemProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const rowRef = useRef<HTMLDivElement>(null);
  const toolName = resolvePermissionToolName(props.tool.function.name);
  const settings = useAppSelector(
    (state) => state.ui.toolSettings[toolName],
  );
  const sessionAllowlist = useAppSelector(
    (state) => state.session.sessionToolAllowlist,
  );
  const toolSettings = useAppSelector((state) => state.ui.toolSettings);
  const pendingToolCall = useAppSelector(selectCurrentToolCall);
  const pendingToolAutoApproved = useAppSelector(
    selectIsCurrentToolAutoApproved,
  );
  const isPending =
    pendingToolCall?.status === "generated" &&
    isSamePermissionTool(pendingToolCall.toolCall.function.name, toolName);

  useEffect(() => {
    if (!settings) {
      dispatch(addTool(props.tool));
    }
  }, [dispatch, props.tool, settings]);

  useEffect(() => {
    if (isPending) {
      rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isPending]);

  if (!settings) {
    return null;
  }

  const display = getToolPermissionDisplay({
    toolName,
    toolSettings,
    sessionAllowlist,
  });
  const formattedToolName = getCategorizedToolName(props.tool);

  const cycleOrClearSession = () => {
    if (display === "sessionAlways") {
      for (const allowed of sessionAllowlist) {
        if (isSamePermissionTool(allowed, toolName)) {
          dispatch(removeSessionToolAllowlist(allowed));
        }
      }
      return;
    }
    dispatch(toggleToolSetting(toolName));
    if (display === "autoApprove") {
      for (const allowed of sessionAllowlist) {
        if (isSamePermissionTool(allowed, toolName)) {
          dispatch(removeSessionToolAllowlist(allowed));
        }
      }
    }
    void dispatch(syncPendingToolPermissions());
  };

  return (
    <div
      ref={rowRef}
      data-testid={`tool-permission-row-${toolName}`}
      data-tool-permission={toolName}
      data-pending={isPending ? "true" : "false"}
      className="group flex flex-col rounded-md px-2 py-1.5 my-0.5 transition-all duration-150"
      style={{
        fontSize: fontSize(-3),
        opacity: props.excluded ? 0.5 : 1,
        backgroundColor: isPending
          ? "var(--vscode-list-activeSelectionBackground, rgba(21, 153, 148, 0.16))"
          : undefined,
        outline: isPending
          ? "1px solid var(--vscode-focusBorder, rgba(21, 153, 148, 0.45))"
          : undefined,
      }}
    >
      <div
        className={`flex items-center justify-between gap-2 ${
          props.excluded || isPending ? "" : "cursor-pointer"
        }`}
        onMouseEnter={(e) => {
          if (!props.excluded && !isPending) {
            e.currentTarget.style.backgroundColor =
              "var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1))";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        onClick={(e) => {
          if (props.excluded || isPending) {
            return;
          }
          cycleOrClearSession();
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <div className="flex flex-1 flex-row items-center gap-1">
          {props.duplicatesDetected ? (
            <>
              <div
                data-tooltip-id={props.tool.displayTitle + "-duplicate-warning"}
                className="h-3 w-3 cursor-help text-yellow-500"
              >
                <InformationCircleIcon />
              </div>
              <ToolTip
                id={props.tool.displayTitle + "-duplicate-warning"}
                place="bottom"
                className="flex flex-wrap items-center"
              >
                <p className="m-0 p-0">
                  <span>{t("duplicateToolName")}</span>{" "}
                  <code>{props.tool.function.name}</code>{" "}
                  <span>{t("duplicateToolWarning")}</span>
                </p>
              </ToolTip>
            </>
          ) : null}
          <span className="line-clamp-1 flex items-center gap-1">
            {props.tool.faviconUrl && (
              <img
                src={props.tool.faviconUrl}
                alt={props.tool.displayTitle}
                className="h-4 w-4"
              />
            )}
            <span className="my-0.5 text-[11px] font-medium">
              {formattedToolName}
            </span>
            <span
              className="text-[9px] text-lightgray cursor-help"
              data-tooltip-id={`tool-id-${props.tool.function.name}`}
            >
              ({t("toolId")})
            </span>
            <ToolTip id={`tool-id-${props.tool.function.name}`} place="bottom">
              <code className="text-[10px]">{props.tool.function.name}</code>
            </ToolTip>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {props.excluded ? (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor:
                  "var(--vscode-input-background, rgb(45, 45, 45))",
                color: "var(--vscode-descriptionForeground, #9d9d9d)",
              }}
            >
              {t("toolDisabled")}
            </span>
          ) : (
            <PermissionStatusBadge
              display={display}
              onClearSession={
                display === "sessionAlways" && !isPending
                  ? cycleOrClearSession
                  : undefined
              }
            />
          )}
        </div>
      </div>
      {isPending && !props.excluded && !pendingToolAutoApproved && (
        <PermissionActionButtons toolName={toolName} compact />
      )}
    </div>
  );
}

function PermissionStatusBadge({
  display,
  onClearSession,
}: {
  display: ReturnType<typeof getToolPermissionDisplay>;
  onClearSession?: () => void;
}) {
  const { t } = useTranslation();

  if (display === "requiresApproval") {
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded font-medium"
        data-testid="tool-permission-badge"
        style={{
          backgroundColor: "rgba(253, 126, 20, 0.15)",
          color: "#fd7e14",
          border: "1px solid rgba(253, 126, 20, 0.3)",
        }}
      >
        {t("toolRequiresApproval")}
      </span>
    );
  }

  if (display === "sessionAlways") {
    return (
      <button
        type="button"
        className="text-[9px] px-1.5 py-0.5 rounded font-medium cursor-pointer border-none"
        data-testid="tool-permission-badge"
        title={t("toolAlwaysThisSessionHint")}
        onClick={(e) => {
          e.stopPropagation();
          onClearSession?.();
        }}
        style={{
          backgroundColor: "rgba(21, 158, 148, 0.22)",
          color: "#159994",
          border: "1px solid rgba(21, 158, 148, 0.55)",
        }}
      >
        {t("toolAlwaysThisSession")}
      </button>
    );
  }

  if (display === "autoApprove") {
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded font-medium"
        data-testid="tool-permission-badge"
        style={{
          backgroundColor: "rgba(21, 158, 148, 0.15)",
          color: "#159994",
          border: "1px solid rgba(21, 158, 148, 0.3)",
        }}
      >
        {t("toolAutoApprove")}
      </span>
    );
  }

  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-medium"
      data-testid="tool-permission-badge"
      style={{
        backgroundColor: "var(--vscode-input-background, rgb(45, 45, 45))",
        color: "var(--vscode-descriptionForeground, #9d9d9d)",
      }}
    >
      {t("toolDisabled")}
    </span>
  );
}

export default ToolDropdownItem;
