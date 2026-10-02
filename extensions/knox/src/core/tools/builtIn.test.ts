import { describe, expect, it } from "vitest";

import {
  BuiltInToolNames,
  DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES,
  formatUnknownToolError,
  resolveBuiltInToolCall,
  resolveBuiltInToolName,
  resolveViewSubdirectoryMaxFiles,
} from "./builtIn";

describe("resolveBuiltInToolName", () => {
  it("keeps catalog names unchanged", () => {
    expect(resolveBuiltInToolName(BuiltInToolNames.ReadFile)).toBe(
      BuiltInToolNames.ReadFile,
    );
  });

  it("maps short and competitor names onto catalog tools", () => {
    expect(resolveBuiltInToolName("read_file")).toBe(BuiltInToolNames.ReadFile);
    expect(resolveBuiltInToolName("Read")).toBe(BuiltInToolNames.ReadFile);
    expect(resolveBuiltInToolName("grep")).toBe(BuiltInToolNames.ExactSearch);
    expect(resolveBuiltInToolName("rg")).toBe(BuiltInToolNames.ExactSearch);
    expect(resolveBuiltInToolName("list_dir")).toBe(
      BuiltInToolNames.ViewSubdirectory,
    );
    expect(resolveBuiltInToolName("bash")).toBe(
      BuiltInToolNames.RunTerminalCommand,
    );
    expect(resolveBuiltInToolName("workspace_checkpoint")).toBe(
      BuiltInToolNames.WorkspaceCheckpoint,
    );
    expect(resolveBuiltInToolName("build")).toBe(BuiltInToolNames.Build);
    expect(resolveBuiltInToolName("compile")).toBe(BuiltInToolNames.Build);
    expect(resolveBuiltInToolName("pty")).toBe(BuiltInToolNames.PtyStart);
    expect(resolveBuiltInToolName("pty_send")).toBe(BuiltInToolNames.PtySend);
    expect(resolveBuiltInToolName("pty_read")).toBe(BuiltInToolNames.PtyRead);
    expect(resolveBuiltInToolName("qemu")).toBe(BuiltInToolNames.Qemu);
    expect(resolveBuiltInToolName("debug")).toBe(BuiltInToolNames.Debug);
    expect(resolveBuiltInToolName("gdb")).toBe(BuiltInToolNames.Debug);
    expect(resolveBuiltInToolName("kconfig")).toBe(BuiltInToolNames.Kconfig);
    expect(resolveBuiltInToolName("maintainers")).toBe(
      BuiltInToolNames.Maintainers,
    );
    expect(resolveBuiltInToolName("get_maintainer")).toBe(
      BuiltInToolNames.Maintainers,
    );
    expect(resolveBuiltInToolName("blame")).toBe(BuiltInToolNames.GitBlame);
    expect(resolveBuiltInToolName("bisect")).toBe(BuiltInToolNames.GitBisect);
    expect(resolveBuiltInToolName("plan")).toBe(BuiltInToolNames.Plan);
    expect(resolveBuiltInToolName("todo")).toBe(BuiltInToolNames.Plan);
    expect(resolveBuiltInToolName("checkpoint")).toBe(
      BuiltInToolNames.WorkspaceCheckpoint,
    );
  });

  it("maps invented read_file_line onto builtin_read_file", () => {
    expect(resolveBuiltInToolName("read_file_line")).toBe(
      BuiltInToolNames.ReadFile,
    );
    expect(resolveBuiltInToolName("ReadFileLine")).toBe(
      BuiltInToolNames.ReadFile,
    );
    expect(resolveBuiltInToolName("builtin_read_file_line")).toBe(
      BuiltInToolNames.ReadFile,
    );
  });

  it("corrects close typos onto catalog tools", () => {
    expect(resolveBuiltInToolName("exect_search")).toBe(
      BuiltInToolNames.ExactSearch,
    );
  });

  it("adds the builtin_ prefix when that is the only difference", () => {
    expect(resolveBuiltInToolName("view_repo_map")).toBe(
      BuiltInToolNames.ViewRepoMap,
    );
  });

  it("leaves unknown names alone", () => {
    expect(resolveBuiltInToolName("custom_http_tool")).toBe("custom_http_tool");
    expect(resolveBuiltInToolName("")).toBe("");
    expect(resolveBuiltInToolName("tool_name")).toBe("tool_name");
  });
});

describe("resolveBuiltInToolCall", () => {
  it("maps placeholder tool_name onto a catalog tool from arguments", () => {
    expect(
      resolveBuiltInToolCall("tool_name", { command: "find . -name Cargo.toml" }),
    ).toBe(BuiltInToolNames.RunTerminalCommand);
    expect(
      resolveBuiltInToolCall("Tool Name", { filepath: "Cargo.toml" }),
    ).toBe(BuiltInToolNames.ReadFile);
    expect(
      resolveBuiltInToolCall("function_name", {
        filepath: "src/main.rs",
        old_string: "a",
        new_string: "b",
      }),
    ).toBe(BuiltInToolNames.EditFile);
    expect(
      resolveBuiltInToolCall("tool_name", { pattern: "**/Cargo.toml" }),
    ).toBe(BuiltInToolNames.Glob);
  });

  it("leaves a placeholder without useful args as tool_name", () => {
    expect(resolveBuiltInToolCall("tool_name", {})).toBe("tool_name");
    expect(resolveBuiltInToolCall("tool_name")).toBe("tool_name");
  });
});

describe("formatUnknownToolError", () => {
  it("hints at builtin_read_file instead of read_file_line", () => {
    const message = formatUnknownToolError("read_file_line");
    expect(message).toContain("read_file_line");
    expect(message).toContain(BuiltInToolNames.ReadFile);
    expect(message).toMatch(/startLine/);
  });
});

describe("resolveViewSubdirectoryMaxFiles", () => {
  it("defaults and clamps", () => {
    expect(resolveViewSubdirectoryMaxFiles(undefined)).toBe(
      DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES,
    );
    expect(resolveViewSubdirectoryMaxFiles(0)).toBe(
      DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES,
    );
    expect(resolveViewSubdirectoryMaxFiles(25)).toBe(50);
    expect(resolveViewSubdirectoryMaxFiles(5000)).toBe(5000);
    expect(resolveViewSubdirectoryMaxFiles(999999)).toBe(20000);
  });
});
