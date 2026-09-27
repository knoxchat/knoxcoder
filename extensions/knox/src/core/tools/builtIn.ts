import { t } from "../i18n/index.js";

export enum BuiltInToolNames {
  ReadFile = "builtin_read_file",
  ReadCurrentlyOpenFile = "builtin_read_currently_open_file",
  CreateNewFile = "builtin_create_new_file",
  EditFile = "builtin_edit_file",
  WriteFile = "builtin_write_file",
  ApplyPatch = "builtin_apply_patch",
  RunTerminalCommand = "builtin_run_terminal_command",
  AwaitShell = "builtin_await_shell",
  ViewSubdirectory = "builtin_view_subdirectory",
  Glob = "builtin_glob",
  ViewRepoMap = "builtin_view_repo_map",
  ExactSearch = "builtin_exact_search",
  SearchWeb = "builtin_search_web",
  ViewDiff = "builtin_view_diff",
  EnhancedSearch = "builtin_enhanced_search",
  IntelligentChain = "builtin_intelligent_chain",
  Skill = "builtin_skill",
  Lsp = "builtin_lsp",
  Memory = "builtin_memory",
  MemoryGraph = "builtin_memory_graph",
  MemorySessions = "builtin_memory_sessions",
  MemoryManage = "builtin_memory_manage",
  MemoryLearn = "builtin_memory_learn",
  GenerateTests = "builtin_generate_tests",
  Task = "builtin_task",
  AskUser = "builtin_ask_user",
  GitStatus = "builtin_git_status",
  GitDiff = "builtin_git_diff",
  GitLog = "builtin_git_log",
  GitBlame = "builtin_git_blame",
  GitCommit = "builtin_git_commit",
  GitBisect = "builtin_git_bisect",
  WorkspaceCheckpoint = "builtin_workspace_checkpoint",
  Build = "builtin_build",
  PtyStart = "builtin_pty_start",
  PtySend = "builtin_pty_send",
  PtyRead = "builtin_pty_read",
  Qemu = "builtin_qemu",
  Debug = "builtin_debug",
  Kconfig = "builtin_kconfig",
  Maintainers = "builtin_maintainers",
  Plan = "builtin_plan",
}
export const BUILT_IN_GROUP_NAME = t("permissions");

/** Default cap for `builtin_view_subdirectory` when the model omits maxFiles. */
export const DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES = 1000;
export const MIN_VIEW_SUBDIRECTORY_MAX_FILES = 50;
export const MAX_VIEW_SUBDIRECTORY_MAX_FILES = 20000;

const BUILT_IN_NAME_SET = new Set<string>(Object.values(BuiltInToolNames));

/**
 * Models often drop the `builtin_` prefix, camelCase, or emit Claude/Codex
 * short names (`read_file`, `Read`, `grep`, `read_file_line`). Map those onto
 * catalog names so lookup, permissions, and routing stay on the real impl.
 */
const TOOL_NAME_ALIASES: Record<string, BuiltInToolNames> = {
  read: BuiltInToolNames.ReadFile,
  read_file: BuiltInToolNames.ReadFile,
  readfile: BuiltInToolNames.ReadFile,
  read_file_line: BuiltInToolNames.ReadFile,
  read_file_lines: BuiltInToolNames.ReadFile,
  read_file_range: BuiltInToolNames.ReadFile,
  read_lines: BuiltInToolNames.ReadFile,
  read_range: BuiltInToolNames.ReadFile,
  view: BuiltInToolNames.ReadFile,
  view_file: BuiltInToolNames.ReadFile,
  cat: BuiltInToolNames.ReadFile,
  open_file: BuiltInToolNames.ReadFile,
  get_file: BuiltInToolNames.ReadFile,
  show_file: BuiltInToolNames.ReadFile,
  write: BuiltInToolNames.WriteFile,
  write_file: BuiltInToolNames.WriteFile,
  writefile: BuiltInToolNames.WriteFile,
  edit: BuiltInToolNames.EditFile,
  edit_file: BuiltInToolNames.EditFile,
  str_replace: BuiltInToolNames.EditFile,
  strreplace: BuiltInToolNames.EditFile,
  str_replace_editor: BuiltInToolNames.EditFile,
  search_replace: BuiltInToolNames.EditFile,
  apply_patch: BuiltInToolNames.ApplyPatch,
  applypatch: BuiltInToolNames.ApplyPatch,
  create_file: BuiltInToolNames.CreateNewFile,
  create_new_file: BuiltInToolNames.CreateNewFile,
  bash: BuiltInToolNames.RunTerminalCommand,
  shell: BuiltInToolNames.RunTerminalCommand,
  exec: BuiltInToolNames.RunTerminalCommand,
  execute: BuiltInToolNames.RunTerminalCommand,
  run: BuiltInToolNames.RunTerminalCommand,
  terminal: BuiltInToolNames.RunTerminalCommand,
  run_terminal_command: BuiltInToolNames.RunTerminalCommand,
  grep: BuiltInToolNames.ExactSearch,
  rg: BuiltInToolNames.ExactSearch,
  ripgrep: BuiltInToolNames.ExactSearch,
  exact_search: BuiltInToolNames.ExactSearch,
  search: BuiltInToolNames.ExactSearch,
  search_code: BuiltInToolNames.ExactSearch,
  codebase_search: BuiltInToolNames.ExactSearch,
  find_in_files: BuiltInToolNames.ExactSearch,
  glob: BuiltInToolNames.Glob,
  find: BuiltInToolNames.Glob,
  list_dir: BuiltInToolNames.ViewSubdirectory,
  list_directory: BuiltInToolNames.ViewSubdirectory,
  view_subdirectory: BuiltInToolNames.ViewSubdirectory,
  ls: BuiltInToolNames.ViewSubdirectory,
  tree: BuiltInToolNames.ViewSubdirectory,
  web_search: BuiltInToolNames.SearchWeb,
  search_web: BuiltInToolNames.SearchWeb,
  ask_user: BuiltInToolNames.AskUser,
  task: BuiltInToolNames.Task,
  workspace_checkpoint: BuiltInToolNames.WorkspaceCheckpoint,
  checkpoint: BuiltInToolNames.WorkspaceCheckpoint,
  build: BuiltInToolNames.Build,
  compile: BuiltInToolNames.Build,
  kbuild: BuiltInToolNames.Build,
  pty: BuiltInToolNames.PtyStart,
  pty_start: BuiltInToolNames.PtyStart,
  pty_send: BuiltInToolNames.PtySend,
  pty_read: BuiltInToolNames.PtyRead,
  qemu: BuiltInToolNames.Qemu,
  debug: BuiltInToolNames.Debug,
  gdb: BuiltInToolNames.Debug,
  dap: BuiltInToolNames.Debug,
  kconfig: BuiltInToolNames.Kconfig,
  menuconfig: BuiltInToolNames.Kconfig,
  maintainers: BuiltInToolNames.Maintainers,
  get_maintainer: BuiltInToolNames.Maintainers,
  get_maintainers: BuiltInToolNames.Maintainers,
  blame: BuiltInToolNames.GitBlame,
  git_blame: BuiltInToolNames.GitBlame,
  bisect: BuiltInToolNames.GitBisect,
  git_bisect: BuiltInToolNames.GitBisect,
  plan: BuiltInToolNames.Plan,
  task_plan: BuiltInToolNames.Plan,
  todo: BuiltInToolNames.Plan,
};

const TOOL_NAME_PREFIX_RULES: Array<[RegExp, BuiltInToolNames]> = [
  [/^read_file/, BuiltInToolNames.ReadFile],
  [/^read_line/, BuiltInToolNames.ReadFile],
  [/^read_range/, BuiltInToolNames.ReadFile],
  [/^view_file/, BuiltInToolNames.ReadFile],
  [/^grep/, BuiltInToolNames.ExactSearch],
  [/^ripgrep/, BuiltInToolNames.ExactSearch],
  [/^exact_search/, BuiltInToolNames.ExactSearch],
  [/^search_code/, BuiltInToolNames.ExactSearch],
  [/^find_in_files/, BuiltInToolNames.ExactSearch],
  [/^list_dir/, BuiltInToolNames.ViewSubdirectory],
  [/^str_replace/, BuiltInToolNames.EditFile],
];

function normalizeToolNameKey(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) {
    return 99;
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    dp[i * cols] = i;
  }
  for (let j = 0; j < cols; j++) {
    dp[j] = j;
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        (dp[(i - 1) * cols + j] ?? 99) + 1,
        (dp[i * cols + j - 1] ?? 99) + 1,
        (dp[(i - 1) * cols + j - 1] ?? 99) + cost,
      );
    }
  }
  return dp[a.length * cols + b.length] ?? 99;
}

function lookupAlias(key: string): BuiltInToolNames | undefined {
  return TOOL_NAME_ALIASES[key];
}

function matchPrefixRule(bare: string): BuiltInToolNames | undefined {
  for (const [pattern, tool] of TOOL_NAME_PREFIX_RULES) {
    if (pattern.test(bare)) {
      return tool;
    }
  }
  return undefined;
}

function matchCatalogPrefix(bare: string): BuiltInToolNames | undefined {
  for (const catalog of Object.values(BuiltInToolNames)) {
    const catalogBare = catalog.replace(/^builtin_/, "");
    if (bare === catalogBare || bare.startsWith(`${catalogBare}_`)) {
      return catalog;
    }
  }
  return undefined;
}

export function suggestBuiltInToolName(
  name: string | undefined | null,
): string | undefined {
  if (!name?.trim()) {
    return undefined;
  }
  const bare = normalizeToolNameKey(name).replace(/^builtin_/, "");
  if (!bare) {
    return undefined;
  }

  let best: string | undefined;
  let bestDistance = 3;
  const candidates = new Set<string>([
    ...Object.keys(TOOL_NAME_ALIASES),
    ...Object.values(BuiltInToolNames).map((value) =>
      value.replace(/^builtin_/, ""),
    ),
  ]);
  for (const candidate of candidates) {
    const distance = editDistance(bare, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      const mapped = lookupAlias(candidate);
      best = mapped ?? `builtin_${candidate}`;
    }
  }
  return best;
}

/**
 * Models often drop the `builtin_` prefix or emit Claude/Codex short names
 * (`read_file`, `Read`, `grep`, `read_file_line`). Map those onto catalog names
 * so lookup, permissions, and routing stay on the real implementation.
 */
export function resolveBuiltInToolName(name: string | undefined | null): string {
  if (!name) {
    return "";
  }
  const trimmed = name.trim();
  if (BUILT_IN_NAME_SET.has(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (BUILT_IN_NAME_SET.has(lower)) {
    return lower;
  }
  if (lookupAlias(lower)) {
    return lookupAlias(lower)!;
  }

  const normalized = normalizeToolNameKey(trimmed);
  if (BUILT_IN_NAME_SET.has(normalized)) {
    return normalized;
  }
  if (lookupAlias(normalized)) {
    return lookupAlias(normalized)!;
  }

  const bare = normalized.replace(/^builtin_/, "");
  if (lookupAlias(bare)) {
    return lookupAlias(bare)!;
  }

  const withBuiltin = lower.startsWith("builtin_") ? lower : `builtin_${lower}`;
  if (BUILT_IN_NAME_SET.has(withBuiltin)) {
    return withBuiltin;
  }

  const prefixed = matchPrefixRule(bare) ?? matchCatalogPrefix(bare);
  if (prefixed) {
    return prefixed;
  }

  const typo = suggestBuiltInToolName(trimmed);
  if (typo && typo !== trimmed) {
    return typo;
  }

  return trimmed;
}

export function formatUnknownToolError(name: string): string {
  const suggestion = suggestBuiltInToolName(name);
  const lines = [`Tool "${name}" not found.`];
  if (suggestion && suggestion !== name) {
    lines.push(`Did you mean ${suggestion}?`);
  }
  lines.push(
    "Call tools by catalog names. There is no read_file_line tool — use builtin_read_file with filepath and optional startLine/endLine.",
    "Search with builtin_exact_search (literal -F, not grep/rg). List files with builtin_glob or builtin_view_subdirectory.",
  );
  return lines.join("\n");
}

export function resolveViewSubdirectoryMaxFiles(
  configured?: number | null,
): number {
  if (
    typeof configured !== "number" ||
    !Number.isFinite(configured) ||
    configured <= 0
  ) {
    return DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES;
  }
  return Math.min(
    MAX_VIEW_SUBDIRECTORY_MAX_FILES,
    Math.max(MIN_VIEW_SUBDIRECTORY_MAX_FILES, Math.floor(configured)),
  );
}
