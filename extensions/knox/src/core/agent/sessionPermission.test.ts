import { describe, expect, it } from "vitest";

import {
  permissionModeFromSetting,
  resolveDefaultPermissionMode,
  resolveWorkspacePermissionMode,
} from "./sessionPermission";

describe("resolveDefaultPermissionMode", () => {
  it("saved mode wins", () => {
    expect(
      resolveDefaultPermissionMode({
        savedMode: "fullAuto",
        setting: "edits",
      }),
    ).toEqual({ mode: "fullAuto", reason: "saved" });
  });

  it("setting overrides Auto", () => {
    expect(
      resolveDefaultPermissionMode({
        setting: "edits",
      }),
    ).toEqual({ mode: "acceptEdits", reason: "setting" });
    expect(
      resolveDefaultPermissionMode({
        setting: "auto",
      }),
    ).toEqual({ mode: "fullAuto", reason: "setting" });
  });

  it("legacy ask and unset both start Auto", () => {
    expect(permissionModeFromSetting("ask")).toBe("fullAuto");
    expect(
      resolveDefaultPermissionMode({
        setting: "ask",
      }),
    ).toEqual({ mode: "fullAuto", reason: "default" });
    expect(resolveDefaultPermissionMode({})).toEqual({
      mode: "fullAuto",
      reason: "default",
    });
    expect(resolveWorkspacePermissionMode("/tmp/clone")).toEqual({
      mode: "fullAuto",
      reason: "default",
    });
  });
});
