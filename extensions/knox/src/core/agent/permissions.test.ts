import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { isToolAutoApproved } from "./permissions";

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
});
