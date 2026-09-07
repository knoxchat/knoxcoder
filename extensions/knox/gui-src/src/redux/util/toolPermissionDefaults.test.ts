import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

import {
  applyPresetToExistingSettings,
  autoApproveAskFirstSettings,
  builtInAutoApproveToolSettings,
  builtInSafeToolSettings,
  DEFAULT_TOOL_SETTING,
  defaultSettingForTool,
  safeSettingForTool,
} from "./toolPermissionDefaults";

describe("toolPermissionDefaults", () => {
  it("auto-approves every catalog tool by default", () => {
    expect(DEFAULT_TOOL_SETTING).toBe("allowedWithoutPermission");
    expect(defaultSettingForTool(BuiltInToolNames.ReadFile, true)).toBe(
      "allowedWithoutPermission",
    );
    expect(defaultSettingForTool(BuiltInToolNames.EditFile)).toBe(
      "allowedWithoutPermission",
    );
    expect(defaultSettingForTool(BuiltInToolNames.RunTerminalCommand)).toBe(
      "allowedWithoutPermission",
    );
    expect(defaultSettingForTool(BuiltInToolNames.SearchWeb)).toBe(
      "allowedWithoutPermission",
    );
    expect(defaultSettingForTool("custom_http")).toBe(
      "allowedWithoutPermission",
    );
  });

  it("Safe preset still asks before writes, terminal, and web", () => {
    expect(safeSettingForTool(BuiltInToolNames.ReadFile, true)).toBe(
      "allowedWithoutPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.Glob, true)).toBe(
      "allowedWithoutPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.EditFile)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.WriteFile)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.ApplyPatch)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.RunTerminalCommand)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.SearchWeb)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.Task)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.AskUser)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.GitCommit)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.WorkspaceCheckpoint)).toBe(
      "allowedWithPermission",
    );
    expect(safeSettingForTool(BuiltInToolNames.Plan)).toBe(
      "allowedWithoutPermission",
    );
  });

  it("builds a safe map that includes new edit tools", () => {
    const settings = builtInSafeToolSettings();
    expect(settings[BuiltInToolNames.ReadFile]).toBe(
      "allowedWithoutPermission",
    );
    expect(settings[BuiltInToolNames.Plan]).toBe("allowedWithoutPermission");
    expect(settings[BuiltInToolNames.EditFile]).toBe("allowedWithPermission");
    expect(settings[BuiltInToolNames.WriteFile]).toBe("allowedWithPermission");
  });

  it("builds an auto-approve map for the default catalog", () => {
    const settings = builtInAutoApproveToolSettings();
    expect(settings[BuiltInToolNames.ReadFile]).toBe(
      "allowedWithoutPermission",
    );
    expect(settings[BuiltInToolNames.EditFile]).toBe(
      "allowedWithoutPermission",
    );
    expect(settings[BuiltInToolNames.RunTerminalCommand]).toBe(
      "allowedWithoutPermission",
    );
    expect(settings[BuiltInToolNames.SearchWeb]).toBe(
      "allowedWithoutPermission",
    );
  });

  it("YOLO auto-approves every catalog tool", () => {
    const next = applyPresetToExistingSettings(
      { custom_http: "disabled" },
      [
        {
          function: { name: BuiltInToolNames.EditFile },
          readonly: false,
        } as any,
        {
          function: { name: BuiltInToolNames.ReadFile },
          readonly: true,
        } as any,
      ],
      "yolo",
    );
    expect(next[BuiltInToolNames.EditFile]).toBe("allowedWithoutPermission");
    expect(next[BuiltInToolNames.ReadFile]).toBe("allowedWithoutPermission");
    expect(next.custom_http).toBe("allowedWithoutPermission");
  });

  it("Safe preset restores ask-first for writes without touching unknown tools", () => {
    const next = applyPresetToExistingSettings(
      { custom_http: "disabled" },
      [
        {
          function: { name: BuiltInToolNames.EditFile },
          readonly: false,
        } as any,
        {
          function: { name: BuiltInToolNames.ReadFile },
          readonly: true,
        } as any,
      ],
      "safe",
    );
    expect(next[BuiltInToolNames.EditFile]).toBe("allowedWithPermission");
    expect(next[BuiltInToolNames.ReadFile]).toBe("allowedWithoutPermission");
    expect(next.custom_http).toBe("disabled");
  });

  it("migrates persisted Ask-first tools to Auto-Approve and keeps Disabled", () => {
    expect(
      autoApproveAskFirstSettings({
        [BuiltInToolNames.EditFile]: "allowedWithPermission",
        [BuiltInToolNames.ReadFile]: "allowedWithoutPermission",
        custom: "disabled",
      }),
    ).toEqual({
      [BuiltInToolNames.EditFile]: "allowedWithoutPermission",
      [BuiltInToolNames.ReadFile]: "allowedWithoutPermission",
      custom: "disabled",
    });
  });
});
