import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { SearchOptions, SearchOutputMode } from "../protocol/ide";

/**
 * Built-in ripgrep 15.2.0 `--type` names (`rg --type-list`).
 * Unknown values fall back to `--glob *.ext`.
 */
const RIPGREP_TYPES = new Set(
  `
ada agda aidl alire amake asciidoc asm asp ats avro awk bat batch bazel
bitbake boxlang brotli buildstream bzip2 c cabal candid carp cbor ceylon
cfml clojure cmake cmd cml coffeescript config container coq cpp creole
crystal cs csharp cshtml csproj css csv cuda cython d dart devicetree
dhall diff dita docker dockercompose dts dvc ebuild edn elisp elixir elm
erb erlang fennel fidl fish flatbuffers fortran fsharp fut gap gdscript
gleam gn go gprbuild gradle graphql groovy gzip h haml hare haskell hbs
hs html hurl hy idris janet java jinja jl js json jsonl julia jupyter k
kconfig kotlin lean less license lilypond lisp llvm lock log lua lz4 lzma
m4 make mako man markdown matlab md meson minified mint mk ml mojo motoko
msbuild nim nix objc objcpp ocaml org pants pascal pdf perl php pkgbuild
po pod postscript prolog proto protobuf ps puppet purs py python qmake
qml qrc qui r racket raku rdoc readme reasonml red rescript robot rocq
rst ruby rust sass scala scdoc seed7 sh slim smarty sml solidity soy spark
spec sql ssa stylus sv svelte svg swift swig systemd taskpaper tcl tex
texinfo textile tf thrift toml ts twig txt typescript typoscript typst usd
v vala vb vcl verilog vhdl vim vimscript vue webidl wgsl wiki xml xz yacc
yaml yang z zig zsh zstd
`
    .trim()
    .split(/\s+/),
);

/** Common extension / short names that are not official `--type` ids. */
const RIPGREP_TYPE_ALIASES: Record<string, string> = {
  rs: "rust",
  rb: "ruby",
  tsx: "ts",
  jsx: "js",
  kt: "kotlin",
  htm: "html",
  yml: "yaml",
  cc: "cpp",
  hh: "cpp",
  hpp: "cpp",
  cxx: "cpp",
  s: "asm",
  S: "asm",
};

export const DEFAULT_SEARCH_CONTEXT_LINES = 2;
export const DEFAULT_SEARCH_MAX_RESULTS = 50;
/** Kernel/QEMU trees (HL-22). Still truncated; pass path/fileType to narrow. */
export const SYSTEMS_SEARCH_MAX_RESULTS = 200;
export const DEFAULT_SEARCH_MAX_FILESIZE = "8M";
export const DEFAULT_SEARCH_MAX_COLUMNS = 400;

/** Footer when the head-limit fires. Teach the model to scope, not page blindly. */
export const SEARCH_TRUNCATION_HINT =
  "truncated; pass maxResults/path/fileType";

export function formatSearchTruncationNotice(maxResults: number): string {
  return `${SEARCH_TRUNCATION_HINT} (showing ${maxResults} matches).`;
}

export function resolveSearchMaxResults(
  explicit: number | undefined,
  systemsWorkspace: boolean,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  return systemsWorkspace
    ? SYSTEMS_SEARCH_MAX_RESULTS
    : DEFAULT_SEARCH_MAX_RESULTS;
}

export type { SearchOutputMode };

function normalizeOutputMode(mode?: string): SearchOutputMode {
  if (mode === "files_with_matches" || mode === "count") {
    return mode;
  }
  return "content";
}

/**
 * Build argv for `rg` (not including the binary).
 *
 * Do **not** pass `-I`. In ripgrep that is `--no-filename` (GNU grep `-I`
 * means skip binaries). Ripgrep already skips binary files unless `-a`.
 */
export function buildRipgrepArgs(
  query: string,
  options?: Partial<SearchOptions>,
): string[] {
  const rgArgs: string[] = ["--no-config", "--color", "never"];
  const outputMode = normalizeOutputMode(options?.outputMode);

  if (options?.caseSensitive) {
    rgArgs.push("-s");
  } else {
    rgArgs.push("-i");
  }

  if (options?.wholeWord) {
    rgArgs.push("-w");
  }

  // Exact Search is a literal substring search. `-F` must be the default so
  // queries like `fn ui(&mut self,` or `Game::new` are not compiled as regex
  // (rust-regex wraps the pattern in `(?:...)` and then reports "unclosed group").
  // Opt into regex with pcre2=true or fixedStrings=false. Never pass -F and -P.
  const usePcre2 = options?.pcre2 === true && options?.fixedStrings !== true;
  const useFixedStrings = !usePcre2 && options?.fixedStrings !== false;
  if (useFixedStrings) {
    rgArgs.push("-F");
  } else if (usePcre2) {
    rgArgs.push("-P");
  }

  if (options?.multiline) {
    rgArgs.push("-U", "--multiline-dotall");
  }

  if (options?.hidden) {
    rgArgs.push("--hidden");
  }

  if (options?.follow) {
    rgArgs.push("--follow");
  }

  if (outputMode === "content") {
    const before = options?.beforeContext;
    const after = options?.afterContext;
    if (typeof before === "number" || typeof after === "number") {
      if (typeof before === "number" && before > 0) {
        rgArgs.push("-B", String(before));
      }
      if (typeof after === "number" && after > 0) {
        rgArgs.push("-A", String(after));
      }
    } else {
      const contextLines = options?.contextLines ?? DEFAULT_SEARCH_CONTEXT_LINES;
      if (contextLines > 0) {
        rgArgs.push("-C", String(contextLines));
      }
    }

    rgArgs.push(
      "-H",
      "--heading",
      "--line-number",
      "--max-columns",
      String(options?.maxColumns ?? DEFAULT_SEARCH_MAX_COLUMNS),
      "--max-columns-preview",
    );
  } else if (outputMode === "files_with_matches") {
    rgArgs.push("-l");
  } else {
    rgArgs.push("--count-matches");
  }

  if (options?.fileType) {
    rgArgs.push(...fileTypeToRipgrepFlags(options.fileType));
  }

  if (options?.fileGlob) {
    rgArgs.push("--glob", options.fileGlob);
  }

  if (options?.excludeGlob) {
    const raw = options.excludeGlob.trim();
    if (raw) {
      rgArgs.push("--glob", raw.startsWith("!") ? raw : `!${raw}`);
    }
  }

  const maxFilesize = options?.maxFilesize ?? DEFAULT_SEARCH_MAX_FILESIZE;
  if (maxFilesize) {
    rgArgs.push("--max-filesize", maxFilesize);
  }

  const maxResults = options?.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS;
  if (maxResults > 0 && outputMode === "content") {
    // Per-file cap; the tool-level cap is applied in mergeWorkspaceSearchResults.
    rgArgs.push("-m", String(maxResults));
  }

  rgArgs.push("-e", query);

  const searchPath = options?.path?.trim() || ".";
  rgArgs.push("--", searchPath);

  return rgArgs;
}

export function fileTypeToRipgrepFlags(fileType: string): string[] {
  const trimmed = fileType.trim().replace(/^\./, "").toLowerCase();
  if (!trimmed) {
    return [];
  }
  const aliased = RIPGREP_TYPE_ALIASES[trimmed] ?? trimmed;
  if (RIPGREP_TYPES.has(aliased)) {
    return ["--type", aliased];
  }
  return ["--glob", `*.${trimmed}`];
}

export function isSearchFileHeader(line: string): boolean {
  if (!line || line === "--") {
    return false;
  }
  if (
    line.startsWith("…") ||
    line.startsWith("...") ||
    line.startsWith("Search error:") ||
    line.startsWith("Error:")
  ) {
    return false;
  }
  if (/^\d+[:\-]/.test(line)) {
    return false;
  }
  if (line.startsWith("./") || line.startsWith(".\\")) {
    return true;
  }
  return /[\\/]/.test(line) || /\.\w{1,8}$/.test(line);
}

export function isSearchMatchLine(line: string): boolean {
  return /^\d+:/.test(line);
}

function isEmptySearchOutput(content: string): boolean {
  return (
    !content ||
    content === "No matches found" ||
    content.startsWith("Error:") ||
    content.startsWith("Search error:")
  );
}

export function summarizeSearchOutput(
  content: string,
  outputMode: SearchOutputMode = "content",
): {
  fileCount: number;
  matchCount: number;
} {
  if (isEmptySearchOutput(content)) {
    return { fileCount: 0, matchCount: 0 };
  }

  const mode = normalizeOutputMode(outputMode);

  if (mode === "files_with_matches") {
    const files = content
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          line !== "--" &&
          !line.startsWith("…") &&
          !line.startsWith("..."),
      );
    return { fileCount: files.length, matchCount: files.length };
  }

  if (mode === "count") {
    let fileCount = 0;
    let matchCount = 0;
    for (const line of content.split("\n")) {
      const match = line.match(/:(\d+)\s*$/);
      if (match) {
        fileCount++;
        matchCount += Number.parseInt(match[1] ?? "0", 10);
      }
    }
    return { fileCount, matchCount };
  }

  const files = new Set<string>();
  let matchCount = 0;
  let currentFile: string | null = null;

  for (const line of content.split("\n")) {
    if (!line.trim() || line === "--") {
      continue;
    }
    if (isSearchFileHeader(line) && !isSearchMatchLine(line)) {
      currentFile = line;
      files.add(line);
      continue;
    }
    if (isSearchMatchLine(line)) {
      matchCount++;
      if (currentFile) {
        files.add(currentFile);
      }
    }
  }

  return { fileCount: files.size, matchCount };
}

function isCountableResultLine(
  line: string,
  outputMode: SearchOutputMode,
): boolean {
  if (outputMode === "content") {
    return isSearchMatchLine(line);
  }
  const trimmed = line.trim();
  return Boolean(
    trimmed &&
      trimmed !== "--" &&
      !trimmed.startsWith("…") &&
      !trimmed.startsWith("..."),
  );
}

/**
 * Keep at most `maxResults` match lines (`N:`) across workspace roots.
 * `-m` in ripgrep is per-file, so the tool-level cap is applied here.
 */
export function mergeWorkspaceSearchResults(
  dirResults: string[],
  maxResults: number = DEFAULT_SEARCH_MAX_RESULTS,
  options?: { outputMode?: SearchOutputMode; offset?: number },
): string {
  const outputMode = normalizeOutputMode(options?.outputMode);
  const offset = Math.max(0, options?.offset ?? 0);

  const usable = dirResults.filter(
    (result) =>
      result &&
      result !== "No matches found" &&
      !result.startsWith("Error:") &&
      !result.startsWith("Search error:"),
  );
  const errors = dirResults.filter(
    (result) =>
      result.startsWith("Error:") || result.startsWith("Search error:"),
  );

  if (usable.length === 0) {
    return errors[0] ?? "No matches found";
  }

  const unlimited = maxResults < 0;
  const merged = usable.join("\n\n");
  if (unlimited && offset === 0) {
    return merged;
  }

  const kept: string[] = [];
  let seen = 0;
  let keptCount = 0;
  const cap = unlimited ? Number.POSITIVE_INFINITY : maxResults;
  const truncationNotice = formatSearchTruncationNotice(maxResults);

  for (const line of merged.split("\n")) {
    const countable = isCountableResultLine(line, outputMode);
    if (countable) {
      if (seen < offset) {
        seen++;
        continue;
      }
      if (keptCount >= cap) {
        if (outputMode === "content" && isSearchFileHeader(line)) {
          continue;
        }
        kept.push("");
        kept.push(truncationNotice);
        break;
      }
      seen++;
      keptCount++;
    } else if (
      outputMode === "content" &&
      keptCount >= cap &&
      isSearchFileHeader(line)
    ) {
      kept.push("");
      kept.push(truncationNotice);
      break;
    } else if (offset > 0 && seen < offset && isSearchFileHeader(line)) {
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n") || "No matches found";
}

export interface SearchRoot {
  cwd: string;
  searchPath: string;
}

/**
 * Map an optional model-supplied path onto workspace roots.
 * Strips a leading workspace folder name (`tetris/src` when cwd is `…/tetris`).
 */
export function resolveSearchRoots(
  workspaceFsPaths: string[],
  requestedPath?: string,
): SearchRoot[] | { error: string } {
  const roots = workspaceFsPaths.filter(Boolean);
  if (roots.length === 0) {
    return { error: "Search error: no workspace folders" };
  }

  const raw = requestedPath?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw === ".") {
    return roots.map((cwd) => ({ cwd, searchPath: "." }));
  }

  for (const cwd of roots) {
    const candidates = [raw];
    const base = path.basename(cwd);
    if (raw === base) {
      candidates.push(".");
    } else if (raw.startsWith(`${base}/`)) {
      candidates.push(raw.slice(base.length + 1) || ".");
    }

    if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
      candidates.push(raw);
    }

    for (const candidate of candidates) {
      const full = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(cwd, candidate);
      if (!existsSync(full)) {
        continue;
      }
      const relative = path.relative(cwd, full);
      const searchPath =
        !relative || relative.startsWith("..")
          ? full
          : relative || ".";
      return [{ cwd, searchPath: searchPath || "." }];
    }
  }

  return { error: `Search error: path not found: ${requestedPath}` };
}

function ripgrepSearchRoots(): string[] {
  const roots: string[] = [];
  try {
    // CJS (VS Code tsc / extension bundle). Do not use import.meta — vscode
    // compiles core with module: commonjs, which rejects import.meta.
    if (typeof __dirname === "string" && __dirname.length > 0) {
      roots.push(__dirname);
    }
  } catch {
    // ESM runtimes may not define __dirname
  }
  roots.push(process.cwd());
  return roots;
}

let productAppRoot: string | undefined;

/** Product `vscode.env.appRoot` — resolve `@vscode/ripgrep-universal` first (T5.1). */
export function setRipgrepAppRoot(appRoot: string | undefined): void {
  productAppRoot = appRoot && appRoot.length > 0 ? appRoot : undefined;
}

function ripgrepExe(): string {
  return process.platform === "win32" ? "rg.exe" : "rg";
}

function ripgrepOsArch(): { os: string; arch: string } {
  return {
    os: process.platform,
    arch: process.env.npm_config_arch || process.arch,
  };
}

/**
 * KnoxCoder ships rg in the product (`@vscode/ripgrep-universal`, fallback
 * `@vscode/ripgrep`). Binaries live under node_modules.asar.unpacked in
 * packaged builds. Do not vendor kc/binary/ripgrep archives.
 */
export function productRipgrepCandidates(appRoot?: string): string[] {
  const root = appRoot ?? productAppRoot;
  if (!root) {
    return [];
  }
  const exe = ripgrepExe();
  const { os, arch } = ripgrepOsArch();
  const moduleRoots = [
    path.join(root, "node_modules.asar.unpacked"),
    path.join(root, "node_modules"),
  ];
  const out: string[] = [];
  for (const moduleRoot of moduleRoots) {
    out.push(
      path.join(
        moduleRoot,
        "@vscode",
        "ripgrep-universal",
        "bin",
        `${os}-${arch}`,
        exe,
      ),
    );
    out.push(path.join(moduleRoot, "@vscode", "ripgrep", "bin", exe));
  }
  return out;
}

function bundledRipgrepCandidates(exe: string): string[] {
  const { os, arch } = ripgrepOsArch();
  const relativeBins = [
    path.join(
      "node_modules",
      "@vscode",
      "ripgrep-universal",
      "bin",
      `${os}-${arch}`,
      exe,
    ),
    path.join("node_modules", "@vscode", "ripgrep", "bin", exe),
    path.join("out", "node_modules", "@vscode", "ripgrep", "bin", exe),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const start of ripgrepSearchRoots()) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      for (const rel of relativeBins) {
        const full = path.join(dir, rel);
        if (!seen.has(full)) {
          seen.add(full);
          out.push(full);
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return out;
}

export function resolveRipgrepBinary(
  extraCandidates: string[] = [],
  appRoot?: string,
): string | undefined {
  const exe = ripgrepExe();
  const candidates = [
    ...productRipgrepCandidates(appRoot),
    ...extraCandidates,
    ...bundledRipgrepCandidates(exe),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const which = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(which, ["rg"], { encoding: "utf8" });
    const found = result.stdout?.trim().split(/\r?\n/)[0];
    if (result.status === 0 && found && existsSync(found)) {
      return found;
    }
  } catch {
    // ignore
  }

  return undefined;
}

export function runRipgrepSearch(
  rgPath: string,
  cwd: string,
  query: string,
  options?: Partial<SearchOptions>,
): Promise<string> {
  const rgArgs = buildRipgrepArgs(query, options);
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, rgArgs, { cwd });
    let output = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else if (code === 1) {
        resolve("No matches found");
      } else if (code === 2) {
        resolve(`Search error: ${stderr.trim() || "Invalid search pattern"}`);
      } else {
        reject(
          new Error(
            `Process exited with code: ${code}. ${stderr}`.trim(),
          ),
        );
      }
    });
  });
}

export async function searchWorkspaceWithRipgrep(
  workspaceFsPaths: string[],
  query: string,
  options?: Partial<SearchOptions>,
  rgPath?: string,
): Promise<string> {
  const binary = rgPath ?? resolveRipgrepBinary();
  if (!binary) {
    return "Error: ripgrep binary not found. KnoxCoder product ripgrep was not resolved from vscode.env.appRoot.";
  }

  const roots = resolveSearchRoots(workspaceFsPaths, options?.path);
  if ("error" in roots) {
    return roots.error;
  }

  const results: string[] = [];
  for (const root of roots) {
    results.push(
      await runRipgrepSearch(binary, root.cwd, query, {
        ...options,
        path: root.searchPath,
      }),
    );
  }

  return mergeWorkspaceSearchResults(
    results,
    options?.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS,
    {
      outputMode: normalizeOutputMode(options?.outputMode),
      offset: options?.offset,
    },
  );
}
