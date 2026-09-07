/**
 * clangd / compile_commands.json awareness (HL-25).
 *
 * Kernel trees need `bear -- make` or `scripts/clang-tools` before
 * gotoDefinition works. Distinguish "no LSP server" from "no compile DB".
 */

import type { IDE } from "..";
import { isLspWeakLanguagePath } from "./postEditVerification";
import { joinPathsToUri } from "../util/uri";

export const COMPILE_COMMANDS_ADVICE =
  "No compile_commands.json found. clangd cannot resolve kernel/C includes until you generate one once (`bear -- make`, `compiledb -n make`, or `python scripts/clang-tools/gen_compile_commands.py`). Do not invent include paths.";

export const NO_LSP_SERVER_ADVICE =
  "No LSP server is available for this file type. Install/enable the language server (clangd for C/C++). If this is a kernel tree, also generate compile_commands.json.";

export const RUST_ANALYZER_ADVICE =
  "Install/enable the rust-analyzer VS Code extension. Until then use builtin_build (cargo check) and read crate source under ~/.cargo/registry/src or vendor/. Do not invent method names.";

const NO_SERVER_RE =
  /no (?:matching )?(?:language )?server|no provider|provider not found|language server.*(not|missing)|not available|could not find.*server/i;

export async function findCompileCommandsUri(
  ide: IDE,
  filePath?: string,
): Promise<string | undefined> {
  const candidates: string[] = [];
  const dirs = await ide.getWorkspaceDirs();
  for (const dir of dirs) {
    candidates.push(joinPathsToUri(dir, "compile_commands.json"));
    candidates.push(joinPathsToUri(dir, "build", "compile_commands.json"));
  }
  if (filePath && (filePath.startsWith("file:") || filePath.includes("/"))) {
    const unix = filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    if (unix.startsWith("file:")) {
      candidates.push(`${unix.replace(/\/$/, "")}/compile_commands.json`);
    }
  }
  const seen = new Set<string>();
  for (const uri of candidates) {
    if (!uri || seen.has(uri)) {
      continue;
    }
    seen.add(uri);
    try {
      if (await ide.fileExists(uri)) {
        return uri;
      }
    } catch {
      // continue
    }
  }
  return undefined;
}

export function lspErrorLooksLikeNoServer(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return NO_SERVER_RE.test(message);
}

export function formatLspFailureAdvice(opts: {
  error?: unknown;
  emptyResult: boolean;
  isCLike: boolean;
  isRust?: boolean;
  hasCompileCommands: boolean;
  viaTags?: boolean;
}): string | undefined {
  if (opts.viaTags) {
    return undefined;
  }
  if (opts.isRust && (opts.emptyResult || opts.error)) {
    return RUST_ANALYZER_ADVICE;
  }
  if (opts.error && lspErrorLooksLikeNoServer(opts.error)) {
    if (opts.isCLike && !opts.hasCompileCommands) {
      return `${NO_LSP_SERVER_ADVICE}\n${COMPILE_COMMANDS_ADVICE}`;
    }
    return NO_LSP_SERVER_ADVICE;
  }
  if (opts.isCLike && !opts.hasCompileCommands && (opts.emptyResult || opts.error)) {
    return COMPILE_COMMANDS_ADVICE;
  }
  return undefined;
}

export function isCLikeLspPath(filePath?: string): boolean {
  if (!filePath) {
    return false;
  }
  return isLspWeakLanguagePath(filePath);
}
