import { describe, expect, it } from "vitest";

import {
  extractVerifiedFilePath,
  isLspWeakLanguagePath,
  lspVerifySkippedItem,
  parseToolArgs,
  shouldCheckpointTool,
  shouldSkipLspVerify,
  shouldVerifyTool,
} from "./postEditVerification";

describe("postEditVerification helpers", () => {
  it("identifies mutating tools", () => {
    expect(shouldVerifyTool("builtin_create_new_file")).toBe(true);
    expect(shouldVerifyTool("builtin_edit_file")).toBe(true);
    expect(shouldVerifyTool("builtin_write_file")).toBe(true);
    expect(shouldVerifyTool("builtin_apply_patch")).toBe(true);
    expect(shouldVerifyTool("builtin_generate_tests")).toBe(true);
    expect(shouldVerifyTool("composite_smart_edit")).toBe(true);
    expect(shouldVerifyTool("builtin_read_file")).toBe(false);
  });

  it("checkpoints git commit and shell without running post-edit verify", () => {
    expect(shouldCheckpointTool("builtin_git_commit")).toBe(true);
    expect(shouldCheckpointTool("builtin_run_terminal_command")).toBe(true);
    expect(shouldCheckpointTool("builtin_build")).toBe(true);
    expect(shouldCheckpointTool("builtin_pty_start")).toBe(true);
    expect(shouldCheckpointTool("builtin_git_bisect")).toBe(true);
    expect(shouldCheckpointTool("builtin_qemu")).toBe(true);
    expect(shouldVerifyTool("builtin_git_commit")).toBe(false);
    expect(shouldVerifyTool("builtin_run_terminal_command")).toBe(false);
    expect(shouldVerifyTool("builtin_build")).toBe(false);
    expect(shouldCheckpointTool("builtin_read_file")).toBe(false);
  });

  it("parses string and object args", () => {
    expect(parseToolArgs('{"filepath":"a.ts"}')).toEqual({ filepath: "a.ts" });
    expect(parseToolArgs({ filepath: "b.ts" })).toEqual({ filepath: "b.ts" });
    expect(parseToolArgs("not-json")).toBeNull();
  });

  it("extracts the mutated file path", () => {
    expect(
      extractVerifiedFilePath("builtin_create_new_file", {
        filepath: "src/new.ts",
        contents: "x",
      }),
    ).toBe("src/new.ts");

    expect(
      extractVerifiedFilePath("builtin_edit_file", {
        filepath: "src/edit.ts",
        old_string: "a",
        new_string: "b",
      }),
    ).toBe("src/edit.ts");

    expect(
      extractVerifiedFilePath("builtin_write_file", {
        filepath: "src/write.ts",
        contents: "full",
      }),
    ).toBe("src/write.ts");

    expect(
      extractVerifiedFilePath("builtin_apply_patch", {
        patch: `*** Begin Patch
*** Update File: src/a.ts
@@
-a
+b
*** End Patch`,
      }),
    ).toBe("src/a.ts");

    expect(
      extractVerifiedFilePath("builtin_generate_tests", {
        filepath: "src/a.ts",
        outputPath: "src/a.test.ts",
      }),
    ).toBe("src/a.test.ts");

    expect(
      extractVerifiedFilePath("builtin_read_file", { filepath: "gone.ts" }),
    ).toBeUndefined();

    expect(
      extractVerifiedFilePath("builtin_read_file", { filepath: "a.ts" }),
    ).toBeUndefined();
  });

  it("skips LSP verify for C/systems paths without a compile command", () => {
    expect(isLspWeakLanguagePath("mm/file.c")).toBe(true);
    expect(isLspWeakLanguagePath("arch/x86/entry_64.S")).toBe(true);
    expect(isLspWeakLanguagePath("src/app.ts")).toBe(false);
    expect(shouldSkipLspVerify({ filePath: "foo.c" })).toBe(true);
    expect(shouldSkipLspVerify({ filePath: "foo.ts" })).toBe(false);
    expect(
      shouldSkipLspVerify({ filePath: "foo.ts", verifyCommand: "make" }),
    ).toBe(true);
    expect(shouldSkipLspVerify({ verifyMode: "off" })).toBe(true);
  });

  it("skips LSP for rust+command or rust+no RA, uses RA when live", () => {
    expect(
      shouldSkipLspVerify({
        filePath: "src/lib.rs",
        verifyMode: "command",
        verifyCommand: "cargo check --workspace --all-targets",
      }),
    ).toBe(true);
    expect(
      shouldSkipLspVerify({
        filePath: "src/lib.rs",
        rustAnalyzerAvailable: false,
      }),
    ).toBe(true);
    expect(
      shouldSkipLspVerify({
        filePath: "Cargo.toml",
        rustAnalyzerAvailable: false,
      }),
    ).toBe(true);
    expect(
      shouldSkipLspVerify({
        filePath: "src/lib.rs",
        rustAnalyzerAvailable: true,
      }),
    ).toBe(false);
    expect(shouldSkipLspVerify({ filePath: "src/app.ts" })).toBe(false);
    expect(lspVerifySkippedItem("src/lib.rs").content).toMatch(/rust-analyzer/);
    expect(lspVerifySkippedItem("src/lib.rs").content).toMatch(/builtin_build/);
  });
});
