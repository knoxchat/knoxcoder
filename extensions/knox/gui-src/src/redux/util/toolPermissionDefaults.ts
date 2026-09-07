import { Tool } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

export type ToolSetting =
  | "allowedWithPermission"
  | "allowedWithoutPermission"
  | "disabled";

export type ToolPermissionPreset = "safe" | "yolo";

/** Fallback for unknown tools — auto-approve (users can switch to ask-first). */
export const DEFAULT_TOOL_SETTING: ToolSetting = "allowedWithoutPermission";

const READ_WITHOUT_PERMISSION = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadCurrentlyOpenFile,
  BuiltInToolNames.ViewSubdirectory,
  BuiltInToolNames.Glob,
  BuiltInToolNames.ViewRepoMap,
  BuiltInToolNames.ExactSearch,
  BuiltInToolNames.ViewDiff,
  BuiltInToolNames.Lsp,
  BuiltInToolNames.Skill,
  BuiltInToolNames.Memory,
  BuiltInToolNames.MemoryGraph,
  BuiltInToolNames.MemorySessions,
  BuiltInToolNames.MemoryManage,
  BuiltInToolNames.MemoryLearn,
  BuiltInToolNames.AwaitShell,
  BuiltInToolNames.PtyRead,
  BuiltInToolNames.GitStatus,
  BuiltInToolNames.GitDiff,
  BuiltInToolNames.GitLog,
  BuiltInToolNames.GitBlame,
  BuiltInToolNames.Kconfig,
  BuiltInToolNames.Plan,
]);

const ASK_FIRST = new Set<string>([
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.Build,
  BuiltInToolNames.PtyStart,
  BuiltInToolNames.PtySend,
  BuiltInToolNames.SearchWeb,
  BuiltInToolNames.GenerateTests,
  BuiltInToolNames.Task,
  BuiltInToolNames.AskUser,
  BuiltInToolNames.GitCommit,
  BuiltInToolNames.GitBisect,
  BuiltInToolNames.Qemu,
  BuiltInToolNames.Debug,
  BuiltInToolNames.WorkspaceCheckpoint,
]);

/** Catalog used by the built-in Safe / Auto-Approve maps. */
function builtInCatalog(): Array<{ name: string; readonly?: boolean }> {
  return Object.values(BuiltInToolNames).map((name) => ({
    name,
    readonly: READ_WITHOUT_PERMISSION.has(name),
  }));
}

/** Per-tool default: auto-approve. Ask-first is the Safe preset. */
export function defaultSettingForTool(
  toolName: string,
  readonly?: boolean,
): ToolSetting {
  void toolName;
  void readonly;
  return DEFAULT_TOOL_SETTING;
}

/** Ask on writes / shell / web; auto-approve reads. Used by the Safe preset. */
export function safeSettingForTool(
  toolName: string,
  readonly?: boolean,
): ToolSetting {
  if (READ_WITHOUT_PERMISSION.has(toolName) || readonly) {
    return "allowedWithoutPermission";
  }
  if (ASK_FIRST.has(toolName)) {
    return "allowedWithPermission";
  }
  return "allowedWithPermission";
}

export function buildToolSettingsForPreset(
  tools: Array<{ name: string; readonly?: boolean }>,
  preset: ToolPermissionPreset,
): Record<string, ToolSetting> {
  const settings: Record<string, ToolSetting> = {};
  for (const tool of tools) {
    settings[tool.name] =
      preset === "yolo"
        ? "allowedWithoutPermission"
        : safeSettingForTool(tool.name, tool.readonly);
  }
  return settings;
}

export function builtInSafeToolSettings(): Record<string, ToolSetting> {
  return buildToolSettingsForPreset(builtInCatalog(), "safe");
}

export function builtInAutoApproveToolSettings(): Record<string, ToolSetting> {
  return buildToolSettingsForPreset(builtInCatalog(), "yolo");
}

/** Flip persisted Ask-first tools to Auto-Approve; keep Disabled as-is. */
export function autoApproveAskFirstSettings(
  current: Record<string, ToolSetting>,
): Record<string, ToolSetting> {
  const next: Record<string, ToolSetting> = {};
  for (const [name, setting] of Object.entries(current)) {
    next[name] =
      setting === "allowedWithPermission"
        ? "allowedWithoutPermission"
        : setting;
  }
  return next;
}

export function applyPresetToExistingSettings(
  current: Record<string, ToolSetting>,
  tools: Tool[],
  preset: ToolPermissionPreset,
): Record<string, ToolSetting> {
  const catalog = tools.map((tool) => ({
    name: tool.function.name,
    readonly: tool.readonly,
  }));
  const next = buildToolSettingsForPreset(catalog, preset);
  // Keep settings for tools not in the current catalog (custom/HTTP).
  for (const [name, setting] of Object.entries(current)) {
    if (!(name in next)) {
      next[name] =
        preset === "yolo" ? "allowedWithoutPermission" : setting;
    }
  }
  return next;
}
