import { Tool } from "core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import {
  applyToolPermissionPreset,
  toggleToolGroupSetting,
} from "../../../../redux/slices/uiSlice";
import { syncPendingToolPermissions } from "../../../../redux/thunks/syncPendingToolPermissions";
import { fontSize } from "../../../../util";
import CustomSwitch from "../../../gui/CustomSwitch";

import { PolicyRulesEditor } from "./PolicyRulesEditor";
import ToolDropdownItem from "./ToolDropdownItem";

export const ToolPermissionsDialog = () => {
  const { t } = useTranslation();
  const availableTools = useAppSelector((state) => state.config.config.tools);
  const toolGroupSettings = useAppSelector(
    (store) => store.ui.toolGroupSettings,
  );
  const dispatch = useAppDispatch();

  const toolsByGroup = useMemo(() => {
    const byGroup: Record<string, Tool[]> = {};
    for (const tool of availableTools) {
      if (!byGroup[tool.group]) {
        byGroup[tool.group] = [];
      }
      byGroup[tool.group].push(tool);
    }
    return Object.entries(byGroup);
  }, [availableTools]);

  // Detect duplicate tool names
  const duplicateDetection = useMemo(() => {
    const counts: Record<string, number> = {};
    availableTools.forEach((tool) => {
      if (counts[tool.function.name]) {
        counts[tool.function.name] = counts[tool.function.name] + 1;
      } else {
        counts[tool.function.name] = 1;
      }
    });
    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, v > 1]),
    );
  }, [availableTools]);

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex flex-row flex-wrap items-center gap-1.5 px-1">
        <button
          type="button"
          className="cursor-pointer border-none bg-lightgray/20 px-1.5 py-0.5 text-[11px] text-vsc-foreground hover:bg-lightgray/30"
          title={t("askOnWriteHint")}
          onClick={() => {
            dispatch(
              applyToolPermissionPreset({
                preset: "safe",
                tools: availableTools,
              }),
            );
            void dispatch(syncPendingToolPermissions());
          }}
        >
          {t("askOnWrite")}
        </button>
        <button
          type="button"
          className="cursor-pointer border-none bg-lightgray/20 px-1.5 py-0.5 text-[11px] text-vsc-foreground hover:bg-lightgray/30"
          title={t("yoloPresetHint")}
          onClick={() => {
            dispatch(
              applyToolPermissionPreset({
                preset: "yolo",
                tools: availableTools,
              }),
            );
            void dispatch(syncPendingToolPermissions());
          }}
        >
          {t("yoloPreset")}
        </button>
      </div>
      <PolicyRulesEditor />
      {toolsByGroup.map(([groupName, tools]) => (
        <div 
          key={groupName} 
          className="flex flex-col rounded-lg border transition-all duration-200"
          style={{
            backgroundColor: toolGroupSettings[groupName] === "exclude" 
              ? 'var(--vscode-input-background, rgb(45, 45, 45))/30'
              : 'transparent'
          }}
        >
          <div 
            className="flex flex-row items-center justify-between px-3 py-1 rounded-t-lg transition-all duration-200"
            style={{
              backgroundColor: 'var(--vscode-sideBar-background, rgb(37, 37, 38))'
            }}
          >
            <div className="flex items-center gap-2">
              <div 
                className="h-2 w-2 rounded-full transition-all duration-200"
                style={{
                  backgroundColor: toolGroupSettings[groupName] === "exclude" 
                    ? 'var(--vscode-errorForeground, #f14c4c)' 
                    : '#159994'
                }}
              />
              <h3
                className="m-0 p-0 font-semibold text-vsc-foreground"
                style={{
                  fontSize: fontSize(-1),
                }}
              >
                {groupName}
              </h3>
              <span 
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--vscode-badge-background, #159994)',
                  color: 'var(--vscode-badge-foreground, #fff)'
                }}
              >
                {tools.length}
              </span>
            </div>
            <CustomSwitch
              isToggled={toolGroupSettings[groupName] !== "exclude"}
              onToggle={() => dispatch(toggleToolGroupSetting(groupName))}
              size={12}
            />
          </div>
          <div className="relative flex flex-col px-2 py-1">
            {tools.map((tool) => (
              <ToolDropdownItem
                key={tool.uri + tool.function.name}
                tool={tool}
                duplicatesDetected={duplicateDetection[tool.function.name]}
                excluded={toolGroupSettings[groupName] === "exclude"}
              />
            ))}
            {toolGroupSettings[groupName] === "exclude" && (
              <div 
                className="absolute inset-0 flex items-center justify-center rounded-b-lg backdrop-blur-[1px]"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.3)'
                }}
              >
                <span 
                  className="text-xs font-medium px-3 py-1.5 rounded"
                  style={{
                    backgroundColor: 'var(--vscode-errorBackground, rgba(241, 76, 76, 0.1))',
                    color: 'var(--vscode-errorForeground, #f14c4c)',
                    border: '1px solid var(--vscode-errorForeground, #f14c4c)'
                  }}
                >
                  {t("groupDisabled")}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
