import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

import {
  DEFAULT_PERMISSION_MODE,
  getToolPermissionDisplay,
  isAwaitShellKill,
  isSamePermissionTool,
  isToolAutoApproved,
  nextPermissionMode,
  resolvePermissionToolName,
} from "./permissionMode";

describe("permissionMode", () => {
  it("defaults new sessions to Auto", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("fullAuto");
  });

  it("cycles default → acceptEdits → fullAuto", () => {
    expect(nextPermissionMode("default")).toBe("acceptEdits");
    expect(nextPermissionMode("acceptEdits")).toBe("fullAuto");
    expect(nextPermissionMode("fullAuto")).toBe("default");
  });

  it("respects disabled even in fullAuto", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {
          [BuiltInToolNames.RunTerminalCommand]: "disabled",
        },
        permissionMode: "fullAuto",
      }),
    ).toBe(false);
  });

  it("auto-approves file edits in acceptEdits but still asks for shell", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.EditFile,
        toolSettings: {
          [BuiltInToolNames.EditFile]: "allowedWithPermission",
        },
        permissionMode: "acceptEdits",
      }),
    ).toBe(true);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.ApplyPatch,
        toolSettings: {
          [BuiltInToolNames.ApplyPatch]: "allowedWithPermission",
        },
        permissionMode: "acceptEdits",
      }),
    ).toBe(true);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {
          [BuiltInToolNames.RunTerminalCommand]: "allowedWithPermission",
        },
        permissionMode: "acceptEdits",
      }),
    ).toBe(false);
  });

  it("never auto-approves a policy deny, even in fullAuto", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {
          [BuiltInToolNames.RunTerminalCommand]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { command: "rm -rf /" },
      }),
    ).toBe(false);
  });

  it("can auto-approve workspace checkpoint list/create in fullAuto", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "list" },
      }),
    ).toBe(true);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "create", label: "safe" },
      }),
    ).toBe(true);
  });

  it("never auto-approves workspace checkpoint restore", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "restore", checkpoint_id: "cp-1" },
      }),
    ).toBe(false);
  });

  it("can auto-approve workspace checkpoint preview_restore in fullAuto", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "preview_restore", checkpoint_id: "cp-1" },
      }),
    ).toBe(true);
  });

  it("can auto-approve workspace checkpoint diff and pin in fullAuto", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "diff", checkpoint_id: "cp-1" },
      }),
    ).toBe(true);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "pin", checkpoint_id: "cp-1" },
      }),
    ).toBe(true);
  });

  it("never auto-approves workspace checkpoint delete", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WorkspaceCheckpoint,
        toolSettings: {
          [BuiltInToolNames.WorkspaceCheckpoint]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        args: { action: "delete", checkpoint_id: "cp-1" },
      }),
    ).toBe(false);
  });

  it("never auto-approves ask_user", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.AskUser,
        toolSettings: {
          [BuiltInToolNames.AskUser]: "allowedWithoutPermission",
        },
        permissionMode: "fullAuto",
        sessionAllowlist: [BuiltInToolNames.AskUser],
      }),
    ).toBe(false);
  });

  it("auto-approves await_shell wait and kill when the tool is Auto-Approve", () => {
    expect(isAwaitShellKill(BuiltInToolNames.AwaitShell, { kill: true })).toBe(
      true,
    );
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.AwaitShell,
        toolSettings: {
          [BuiltInToolNames.AwaitShell]: "allowedWithoutPermission",
        },
        permissionMode: "default",
        args: { job_id: "sh_1", kill: true },
      }),
    ).toBe(true);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.AwaitShell,
        toolSettings: {
          [BuiltInToolNames.AwaitShell]: "allowedWithoutPermission",
        },
        permissionMode: "default",
        args: { job_id: "sh_1" },
      }),
    ).toBe(true);
  });

  it("still asks for await_shell when the tool requires approval", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.AwaitShell,
        toolSettings: {
          [BuiltInToolNames.AwaitShell]: "allowedWithPermission",
        },
        permissionMode: "default",
        args: { job_id: "sh_1", kill: true },
      }),
    ).toBe(false);
  });

  it("honors session allowlist", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.SearchWeb,
        toolSettings: {
          [BuiltInToolNames.SearchWeb]: "allowedWithPermission",
        },
        permissionMode: "default",
        sessionAllowlist: [BuiltInToolNames.SearchWeb],
      }),
    ).toBe(true);
  });

  it("resolves tool aliases so the list and popup share one identity", () => {
    expect(resolvePermissionToolName("create_new_file")).toBe(
      BuiltInToolNames.CreateNewFile,
    );
    expect(
      isSamePermissionTool("create_new_file", BuiltInToolNames.CreateNewFile),
    ).toBe(true);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.CreateNewFile,
        toolSettings: {
          [BuiltInToolNames.CreateNewFile]: "allowedWithPermission",
        },
        permissionMode: "default",
        sessionAllowlist: ["create_new_file"],
      }),
    ).toBe(true);
  });

  it("shows session Always on the list without rewriting saved settings", () => {
    const toolSettings = {
      [BuiltInToolNames.CreateNewFile]: "allowedWithPermission" as const,
    };
    expect(
      getToolPermissionDisplay({
        toolName: BuiltInToolNames.CreateNewFile,
        toolSettings,
      }),
    ).toBe("requiresApproval");
    expect(
      getToolPermissionDisplay({
        toolName: BuiltInToolNames.CreateNewFile,
        toolSettings,
        sessionAllowlist: [BuiltInToolNames.CreateNewFile],
      }),
    ).toBe("sessionAlways");
    expect(
      getToolPermissionDisplay({
        toolName: BuiltInToolNames.ReadFile,
        toolSettings: {
          [BuiltInToolNames.ReadFile]: "allowedWithoutPermission",
        },
        sessionAllowlist: [BuiltInToolNames.ReadFile],
      }),
    ).toBe("autoApprove");
    expect(
      getToolPermissionDisplay({
        toolName: BuiltInToolNames.EditFile,
        toolSettings: {
          [BuiltInToolNames.EditFile]: "disabled",
        },
        sessionAllowlist: [BuiltInToolNames.EditFile],
      }),
    ).toBe("disabled");
  });
});
