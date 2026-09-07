import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Tool } from "core";
import type { AgentBackgroundJob } from "core/protocol/agentJobs";
import { ReactElement } from "react";

import {
  getLocalStorageSync,
  LocalStorageKey,
  setLocalStorageSync,
} from "../../util/localStorage";
import {
  DEFAULT_PERMISSION_MODE,
  nextPermissionMode,
  PermissionMode,
} from "../util/permissionMode";
import {
  applyPresetToExistingSettings,
  builtInAutoApproveToolSettings,
  DEFAULT_TOOL_SETTING,
  defaultSettingForTool,
  ToolPermissionPreset,
  ToolSetting,
} from "../util/toolPermissionDefaults";

type ToolGroupSetting = "include" | "exclude";

function readPersistedReasoningEffortByModel(): Record<string, string> {
  const stored = getLocalStorageSync(LocalStorageKey.ReasoningEffortByModel);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  const byModel: Record<string, string> = {};
  for (const [key, effort] of Object.entries(
    stored as Record<string, unknown>,
  )) {
    if (key && typeof effort === "string" && effort.length > 0) {
      byModel[key] = effort;
    }
  }
  return byModel;
}

function persistReasoningEffortToLocal(state: {
  reasoningEffort?: string;
  reasoningEffortByModel: Record<string, string>;
}) {
  if (state.reasoningEffort) {
    setLocalStorageSync(LocalStorageKey.ReasoningEffort, state.reasoningEffort);
  }
  setLocalStorageSync(
    LocalStorageKey.ReasoningEffortByModel,
    state.reasoningEffortByModel,
  );
}

type UIState = {
  showDialog: boolean;
  dialogMessage: string | ReactElement | undefined;
  dialogEntryOn: boolean;
  isExploreDialogOpen: boolean;
  hasDismissedExploreDialog: boolean;
  shouldAddFileForEditing: boolean;
  toolSettings: { [toolName: string]: ToolSetting };
  toolGroupSettings: { [toolGroupName: string]: ToolGroupSetting };
  /** Current model effort (legacy + active selection mirror). */
  reasoningEffort?: string;
  /** Sticky per-model effort preferences keyed by normalized model id. */
  reasoningEffortByModel: Record<string, string>;
  webSearchEnabled: boolean;
  isBlockSettingsToolbarExpanded: boolean;
  selectedBlockSettingsSection: string | null;
  /**
   * Session overlay on per-tool settings (does not rewrite saved toolSettings):
   * default = Ask before writes and terminal;
   * acceptEdits = auto file edits; fullAuto = YOLO (product default).
   */
  permissionMode: PermissionMode;
  /** Git worktree isolation for agent edits (Claude EnterWorktree). */
  worktree: {
    enabled: boolean;
    busy: boolean;
    branch?: string;
    path?: string;
    files: string[];
    error?: string;
  };
  /** Detached shell jobs for the background agent panel. */
  backgroundJobs: AgentBackgroundJob[];
  jobsPanelOpen: boolean;
};

export { DEFAULT_TOOL_SETTING };
export type { ToolPermissionPreset, ToolSetting };

export const uiSlice = createSlice({
  name: "ui",
  initialState: {
    showDialog: false,
    dialogMessage: "",
    dialogEntryOn: false,
    isExploreDialogOpen:
      getLocalStorageSync(LocalStorageKey.IsExploreDialogOpen) ?? false,
    hasDismissedExploreDialog:
      getLocalStorageSync(LocalStorageKey.HasDismissedExploreDialog) ?? false,
    shouldAddFileForEditing: false,
    toolSettings: builtInAutoApproveToolSettings(),
    toolGroupSettings: {
      BUILT_IN_GROUP_NAME: "include",
    },
    reasoningEffort: getLocalStorageSync(LocalStorageKey.ReasoningEffort),
    reasoningEffortByModel: readPersistedReasoningEffortByModel(),
    webSearchEnabled: false,
    isBlockSettingsToolbarExpanded: true,
    selectedBlockSettingsSection: null,
    permissionMode: DEFAULT_PERMISSION_MODE,
    worktree: {
      enabled: false,
      busy: false,
      files: [],
    },
    backgroundJobs: [],
    jobsPanelOpen:
      getLocalStorageSync(LocalStorageKey.JobsPanelExpanded) ?? true,
  } as UIState,
  reducers: {
    setDialogMessage: (
      state,
      action: PayloadAction<UIState["dialogMessage"]>,
    ) => {
      state.dialogMessage = action.payload;
    },
    setDialogEntryOn: (
      state,
      action: PayloadAction<UIState["dialogEntryOn"]>,
    ) => {
      state.dialogEntryOn = action.payload;
    },
    setShowDialog: (state, action: PayloadAction<UIState["showDialog"]>) => {
      state.showDialog = action.payload;
    },
    setIsExploreDialogOpen: (
      state,
      action: PayloadAction<UIState[LocalStorageKey.IsExploreDialogOpen]>,
    ) => {
      state.isExploreDialogOpen = action.payload;
    },
    setHasDismissedExploreDialog: (state, action: PayloadAction<boolean>) => {
      state.hasDismissedExploreDialog = action.payload;
    },
    // Tools
    addTool: (state, action: PayloadAction<Tool>) => {
      const name = action.payload.function.name;
      if (state.toolSettings[name] !== undefined) {
        return;
      }
      state.toolSettings[name] = defaultSettingForTool(
        name,
        action.payload.readonly,
      );
    },
    applyToolPermissionPreset: (
      state,
      action: PayloadAction<{
        preset: ToolPermissionPreset;
        tools: Tool[];
      }>,
    ) => {
      state.toolSettings = applyPresetToExistingSettings(
        state.toolSettings,
        action.payload.tools,
        action.payload.preset,
      );
    },
    toggleToolSetting: (state, action: PayloadAction<string>) => {
      const setting = state.toolSettings[action.payload];

      switch (setting) {
        case "allowedWithPermission":
          state.toolSettings[action.payload] = "allowedWithoutPermission";
          break;
        case "allowedWithoutPermission":
          state.toolSettings[action.payload] = "disabled";
          break;
        case "disabled":
          state.toolSettings[action.payload] = "allowedWithPermission";
          break;
        default:
          state.toolSettings[action.payload] = DEFAULT_TOOL_SETTING;
          break;
      }
    },
    setToolSetting: (
      state,
      action: PayloadAction<{ name: string; setting: ToolSetting }>,
    ) => {
      state.toolSettings[action.payload.name] = action.payload.setting;
    },
    toggleToolGroupSetting: (state, action: PayloadAction<string>) => {
      const setting = state.toolGroupSettings[action.payload] ?? "include";

      if (setting === "include") {
        state.toolGroupSettings[action.payload] = "exclude";
      } else {
        state.toolGroupSettings[action.payload] = "include";
      }
    },
    setReasoningEffort: (
      state,
      {
        payload,
      }: PayloadAction<
        | string
        | undefined
        | { effort: string; modelKey?: string; modelKeys?: string[] }
      >,
    ) => {
      if (payload === undefined) {
        state.reasoningEffort = undefined;
        return;
      }
      if (typeof payload === "string") {
        state.reasoningEffort = payload;
        persistReasoningEffortToLocal(state);
        return;
      }
      state.reasoningEffort = payload.effort;
      const keys = [
        ...(payload.modelKey ? [payload.modelKey] : []),
        ...(payload.modelKeys ?? []),
      ];
      for (const key of keys) {
        if (key) {
          state.reasoningEffortByModel[key] = payload.effort;
        }
      }
      persistReasoningEffortToLocal(state);
    },
    hydrateReasoningEffort: (
      state,
      action: PayloadAction<{
        lastEffort?: string;
        byModel?: Record<string, string>;
      }>,
    ) => {
      const { lastEffort, byModel } = action.payload;
      if (lastEffort) {
        state.reasoningEffort = lastEffort;
      }
      if (byModel && Object.keys(byModel).length > 0) {
        state.reasoningEffortByModel = {
          ...state.reasoningEffortByModel,
          ...byModel,
        };
      }
      persistReasoningEffortToLocal(state);
    },
    setWebSearchEnabled: (state, { payload }: PayloadAction<boolean>) => {
      state.webSearchEnabled = payload;
    },
    setSelectedBlockSettingsSection: (
      state,
      { payload }: PayloadAction<string | null>,
    ) => {
      state.selectedBlockSettingsSection = payload;
    },
    toggleBlockSettingsToolbar: (state) => {
      state.isBlockSettingsToolbarExpanded =
        !state.isBlockSettingsToolbarExpanded;
    },
    setPermissionMode: (state, action: PayloadAction<PermissionMode>) => {
      state.permissionMode = action.payload;
    },
    cyclePermissionMode: (state) => {
      state.permissionMode = nextPermissionMode(state.permissionMode);
    },
    setWorktreeBusy: (state, action: PayloadAction<boolean>) => {
      state.worktree.busy = action.payload;
    },
    setWorktreeState: (
      state,
      action: PayloadAction<UIState["worktree"]>,
    ) => {
      state.worktree = action.payload;
    },
    setBackgroundJobs: (
      state,
      action: PayloadAction<AgentBackgroundJob[]>,
    ) => {
      state.backgroundJobs = action.payload;
    },
    setJobsPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.jobsPanelOpen = action.payload;
      setLocalStorageSync(LocalStorageKey.JobsPanelExpanded, action.payload);
    },
    toggleJobsPanel: (state) => {
      state.jobsPanelOpen = !state.jobsPanelOpen;
      setLocalStorageSync(LocalStorageKey.JobsPanelExpanded, state.jobsPanelOpen);
    },
  },
});

export const {
  setDialogMessage,
  setDialogEntryOn,
  setShowDialog,
  setIsExploreDialogOpen,
  setHasDismissedExploreDialog,
  toggleToolSetting,
  setToolSetting,
  toggleToolGroupSetting,
  addTool,
  applyToolPermissionPreset,
  setReasoningEffort,
  hydrateReasoningEffort,
  setWebSearchEnabled,
  setSelectedBlockSettingsSection,
  toggleBlockSettingsToolbar,
  setPermissionMode,
  cyclePermissionMode,
  setWorktreeBusy,
  setWorktreeState,
  setBackgroundJobs,
  setJobsPanelOpen,
  toggleJobsPanel,
} = uiSlice.actions;

export default uiSlice.reducer;
