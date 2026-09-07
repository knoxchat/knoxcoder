import type { ContextItem } from "..";

import { extractPatchFilePaths } from "./applyPatchFormat";

/**
 * Shared helpers for post-edit verification after mutating tool calls.
 *
 * The actual diagnostic fix loop lives in the VS Code extension (needs LSP),
 * invoked via optional IDE.runPostEditVerification. Core decides *when*
 * verification should run so GUI chat and agent share one gate.
 */

/** Languages where clangd/tsserver usually cannot be the compile oracle. */
const LSP_WEAK_EXTENSIONS = new Set([
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".hxx",
  ".s",
  ".asm",
  ".lds",
  ".dts",
  ".dtsi",
]);

function pathBasename(filePath: string): string {
  const cleaned = filePath.split("?")[0].replace(/\\/g, "/");
  return cleaned.split("/").pop() ?? cleaned;
}

/** Rust sources — rust-analyzer is a real oracle when live; do not treat as weak. */
export function isRustLanguagePath(filePath: string): boolean {
  const base = pathBasename(filePath).toLowerCase();
  return base.endsWith(".rs") || base === "cargo.toml";
}

/** C/asm/DTS/Kconfig — LSP diagnostics are absent or stale without compile_commands. */
export function isLspWeakLanguagePath(filePath: string): boolean {
  const base = pathBasename(filePath).toLowerCase();
  if (
    base === "makefile" ||
    base === "gnumakefile" ||
    base === "kbuild" ||
    base.startsWith("kconfig")
  ) {
    return true;
  }
  const dot = base.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  const ext = base.slice(dot);
  if (ext === ".s") {
    return true;
  }
  return LSP_WEAK_EXTENSIONS.has(ext);
}

export function shouldSkipLspVerify(opts: {
  filePath?: string;
  verifyMode?: string;
  verifyCommand?: string;
  /** When true, rust-analyzer diagnostics are live and may be used. */
  rustAnalyzerAvailable?: boolean;
}): boolean {
  if (opts.verifyMode === "off" || opts.verifyMode === "command") {
    return true;
  }
  if (opts.verifyCommand?.trim()) {
    return true;
  }
  if (opts.filePath && isLspWeakLanguagePath(opts.filePath)) {
    return true;
  }
  if (opts.filePath && isRustLanguagePath(opts.filePath)) {
    return opts.rustAnalyzerAvailable !== true;
  }
  return false;
}

export function lspVerifySkippedItem(filePath: string): ContextItem {
  if (isRustLanguagePath(filePath)) {
    return {
      name: "Auto-Verification Skipped",
      description: "rust-analyzer not ready",
      content: `Skipped LSP auto-verification for ${filePath} (rust-analyzer missing or not ready). Use builtin_build (cargo check) or install/enable the rust-analyzer VS Code extension.`,
    };
  }
  return {
    name: "Auto-Verification Skipped",
    description: "LSP cannot help for this language",
    content: `Skipped LSP auto-verification for ${filePath} (C/systems source without a compile oracle). Use builtin_build or set knoxchat.verifyCommand / experimental.agentVerifyCommand (e.g. make -j8).`,
  };
}

/** Tools that write/create/overwrite workspace files and should be verified. */
export const POST_EDIT_VERIFY_TOOL_NAMES = new Set([
  "builtin_create_new_file",
  "builtin_edit_file",
  "builtin_write_file",
  "builtin_apply_patch",
  "composite_smart_edit",
  "builtin_generate_tests",
]);

export function shouldVerifyTool(toolName: string): boolean {
  return POST_EDIT_VERIFY_TOOL_NAMES.has(toolName);
}

/** First-of-turn workspace CP — file writes plus git commit and shell. */
export const SOUL_TURN_CHECKPOINT_TOOLS = new Set([
  ...POST_EDIT_VERIFY_TOOL_NAMES,
  "builtin_git_commit",
  "builtin_git_bisect",
  "builtin_run_terminal_command",
  "builtin_build",
  "builtin_pty_start",
  "builtin_qemu",
]);

export function shouldCheckpointTool(toolName: string): boolean {
  return SOUL_TURN_CHECKPOINT_TOOLS.has(toolName);
}

/**
 * Parse tool arguments that may be a JSON string or object.
 */
export function parseToolArgs(
  args: unknown,
): Record<string, unknown> | null {
  if (args == null) {
    return null;
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return null;
}

/**
 * Extract the workspace file path that a mutating tool changed.
 */
export function extractVerifiedFilePath(
  toolName: string,
  args: unknown,
): string | undefined {
  if (!shouldVerifyTool(toolName)) {
    return undefined;
  }

  const parsed = parseToolArgs(args);
  if (!parsed) {
    return undefined;
  }

  if (toolName === "builtin_apply_patch") {
    const patch =
      typeof parsed.patch === "string"
        ? parsed.patch
        : typeof parsed.diff === "string"
          ? parsed.diff
          : "";
    return extractPatchFilePaths(patch)[0];
  }

  if (toolName === "builtin_generate_tests") {
    const out =
      parsed.outputPath || parsed.output_path || parsed.test_file_path;
    if (typeof out === "string" && out.trim()) {
      return out.trim();
    }
    return undefined;
  }

  // delete_file has nothing useful to lint after deletion
  if (toolName === "delete_file") {
    return undefined;
  }

  const candidates = [
    parsed.target_file,
    parsed.filepath,
    parsed.file_path,
    parsed.path,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

export interface PostEditVerificationParams {
  toolName: string;
  toolArguments: unknown;
  selectedModelTitle: string;
}
