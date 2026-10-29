import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import {
  DEFAULT_PERMISSION_MODE,
  isHardPolicyDeny,
  isToolAutoApproved,
} from "./permissions";

describe("isToolAutoApproved", () => {
  const workspaceDirs = [path.join(os.tmpdir(), "knox-ws")];

  it("deny glob wins over Auto (fullAuto cannot override)", () => {
    const filepath = path.join(workspaceDirs[0], "secrets", "key.pem");
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WriteFile,
        toolSettings: {},
        permissionMode: "fullAuto",
        args: { filepath, contents: "stolen" },
        policy: {
          paths: [{ pattern: "secrets/**", action: "deny" }],
        },
        workspaceDirs,
      }),
    ).toBe(false);
  });

  it("Ask mode prompts on write when the tool requires approval", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.WriteFile,
        toolSettings: {
          [BuiltInToolNames.WriteFile]: "allowedWithPermission",
        },
        permissionMode: "default",
        args: {
          filepath: path.join(workspaceDirs[0], "src", "a.ts"),
          contents: "x",
        },
        workspaceDirs,
      }),
    ).toBe(false);
  });

  it("Edits mode auto-approves builtin_edit_file", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.EditFile,
        toolSettings: {},
        permissionMode: "acceptEdits",
        args: {
          filepath: path.join(workspaceDirs[0], "src", "a.ts"),
          old_string: "a",
          new_string: "b",
        },
        workspaceDirs,
      }),
    ).toBe(true);
  });

  it("defaults to Auto (YOLO); Ask is opt-in", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("fullAuto");
  });

  it("Edits mode asks for shell by default, Auto does not", () => {
    const args = { command: "ls" };
    const base = {
      toolName: BuiltInToolNames.RunTerminalCommand,
      toolSettings: {},
      args,
      workspaceDirs,
    };
    expect(
      isToolAutoApproved({ ...base, permissionMode: "acceptEdits" }),
    ).toBe(false);
    expect(isToolAutoApproved({ ...base, permissionMode: "default" })).toBe(
      false,
    );
    expect(isToolAutoApproved({ ...base, permissionMode: "fullAuto" })).toBe(
      true,
    );
  });

  it("an explicit tool setting still wins over the mode default", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {
          [BuiltInToolNames.RunTerminalCommand]: "allowedWithoutPermission",
        },
        permissionMode: "acceptEdits",
        args: { command: "ls" },
        workspaceDirs,
      }),
    ).toBe(true);
  });

  it("never auto-runs workspace checkpoint stash or stash_pop", () => {
    const base = {
      toolName: BuiltInToolNames.WorkspaceCheckpoint,
      toolSettings: {},
      permissionMode: "fullAuto" as const,
      workspaceDirs,
    };
    expect(isToolAutoApproved({ ...base, args: { action: "stash" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "stash_pop" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "switch_branch" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "checkout" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "cherry_pick" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "revert" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "merge_continue" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "merge_abort" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "stash_list" } })).toBe(true);
    expect(isToolAutoApproved({ ...base, args: { action: "blame" } })).toBe(true);
    expect(isToolAutoApproved({ ...base, args: { action: "list_worktrees" } })).toBe(true);
    expect(isToolAutoApproved({ ...base, args: { action: "materialize_worktree" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "remove_worktree" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "bisect_start" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "bisect_good" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "bisect_bad" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "bisect_skip" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "bisect_reset" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "bisect_run" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "export_patch" } })).toBe(true);
    expect(isToolAutoApproved({ ...base, args: { action: "apply_patch" } })).toBe(false);
    expect(isToolAutoApproved({ ...base, args: { action: "create" } })).toBe(true);
  });

  it("Auto never runs a guarded command", () => {
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {},
        permissionMode: "fullAuto",
        args: { command: "git push --force" },
        workspaceDirs,
      }),
    ).toBe(false);
  });

  it("K-091: Auto asks for write-then-run; Ask denies", () => {
    const args = { command: "python evil.py" };
    const recentWrites = [path.join(workspaceDirs[0], "evil.py")];
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {},
        permissionMode: "fullAuto",
        args,
        workspaceDirs,
        recentWrites,
      }),
    ).toBe(false);
    expect(
      isToolAutoApproved({
        toolName: BuiltInToolNames.RunTerminalCommand,
        toolSettings: {},
        permissionMode: "default",
        args,
        workspaceDirs,
        recentWrites,
      }),
    ).toBe(false);
    expect(
      isHardPolicyDeny({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args,
        workspaceDirs,
        recentWrites,
        permissionMode: "fullAuto",
      }),
    ).toBe(false);
    expect(
      isHardPolicyDeny({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args,
        workspaceDirs,
        recentWrites,
        permissionMode: "default",
      }),
    ).toBe(true);
  });
});
