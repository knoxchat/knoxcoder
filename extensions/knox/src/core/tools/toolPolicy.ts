/**
 * Path / command permission policy (OpenCode / Claude / Codex-style).
 *
 * Deny always wins. Ask forces a prompt unless the session is fullAuto.
 * Allow auto-runs that target. Unmatched targets fall through to tool settings.
 */

import { extractPatchFilePaths } from "./applyPatchFormat";
import { BuiltInToolNames } from "./builtIn";
import { ToolCallError, ToolCallErrorCode } from "./errors";
import { matchGlob } from "./globMatch";
import { parseToolArgs } from "./postEditVerification";

export type PolicyAction = "allow" | "ask" | "deny";
export type ExternalDirectoryMode = "deny" | "ask" | "allow";

export interface PolicyRule {
  pattern: string;
  action: PolicyAction;
}

export interface AgentToolPolicy {
  paths?: PolicyRule[];
  commands?: PolicyRule[];
  /** When a tool path/cwd is outside the workspace. Default: ask */
  externalDirectory?: ExternalDirectoryMode;
  /** Block obvious destructive shell patterns even in fullAuto. Default: true */
  sandboxDestructive?: boolean;
}

export interface PolicyDecision {
  action: PolicyAction | null;
  reason: string;
}

export interface ToolPolicyTargets {
  paths: string[];
  command?: string;
  cwd?: string;
}

export const DEFAULT_AGENT_TOOL_POLICY: Required<AgentToolPolicy> = {
  paths: [
    { pattern: "~/.ssh/**", action: "deny" },
    { pattern: "~/.gnupg/**", action: "deny" },
    { pattern: "~/.aws/**", action: "deny" },
  ],
  commands: [
    { pattern: "rm -rf *", action: "deny" },
    { pattern: "rm -fr *", action: "deny" },
  ],
  externalDirectory: "ask",
  sandboxDestructive: true,
};

const HARD_PATH_DENY = ["~/.ssh/**", "~/.gnupg/**", "**/.ssh/**"];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  "rm -rf *",
  "rm -fr *",
  "sudo rm *",
  "mkfs*",
  "dd if=*",
  ":(){*",
];

const DESTRUCTIVE_COMMAND_REGEXES = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
  /\bchmod\s+-R\s+777\s+\//i,
  /\b(curl|wget)\b[\s\S]{0,200}\|\s*(ba)?sh\b/i,
  /\bcargo(?:\s+\+\S+)?\s+(publish|login)\b/i,
];

const CARGO_ASK_COMMAND_RE = /\bcargo(?:\s+\+\S+)?\s+(clean|yank)\b/i;

const CARGO_REGISTRY_SRC_READ_PATTERNS = [
  "~/.cargo/registry/src/**",
  "vendor/**",
];

const CARGO_REGISTRY_WRITE_DENY_PATTERNS = [
  "~/.cargo/registry/**",
  "~/.cargo/git/**",
];

const READONLY_PATH_TOOLS = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.Glob,
  BuiltInToolNames.ExactSearch,
  BuiltInToolNames.ViewSubdirectory,
  BuiltInToolNames.Lsp,
  BuiltInToolNames.EnhancedSearch,
]);

const MUTATING_PATH_TOOLS = new Set<string>([
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.EditFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.CreateNewFile,
]);

const COMMAND_PREFIXES = [
  "git",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "rm",
  "sudo",
  "curl",
  "wget",
  "chmod",
  "chown",
  "mkfs",
  "dd",
  "pip",
  "pip3",
  "cargo",
  "make",
  "docker",
  "kubectl",
  "ssh",
  "scp",
];

const PATH_ARG_KEYS = [
  "filepath",
  "target_file",
  "file_path",
  "path",
  "directory_path",
  "target_directory",
  "working_directory",
  "cwd",
  "outputPath",
  "output_path",
  "test_file_path",
];

export function parsePolicyLine(line: string): PolicyRule | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const match = trimmed.match(/^(allow|ask|deny)\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    action: match[1].toLowerCase() as PolicyAction,
    pattern: match[2].trim(),
  };
}

export function formatPolicyLines(rules: PolicyRule[] | undefined): string {
  return (rules ?? [])
    .map((rule) => `${rule.action} ${rule.pattern}`)
    .join("\n");
}

export function parsePolicyLines(text: string | undefined): PolicyRule[] {
  if (!text) {
    return [];
  }
  const rules: PolicyRule[] = [];
  for (const line of text.split("\n")) {
    const rule = parsePolicyLine(line);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules;
}

/** Classify a bare always/ask/never pattern as a path or a command. */
export function classifyPolicyPattern(
  raw: string,
): { kind: "path" | "command"; pattern: string } {
  const trimmed = raw.trim();
  const prefixed = trimmed.match(/^(path|cmd|command)\s*:\s*(.+)$/i);
  if (prefixed) {
    const kind = prefixed[1].toLowerCase() === "path" ? "path" : "command";
    return { kind, pattern: prefixed[2].trim() };
  }
  if (
    trimmed.startsWith("~") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("**") ||
    trimmed.includes("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return { kind: "path", pattern: trimmed };
  }
  const first = trimmed.split(/\s+/)[0]?.replace(/[*?]/g, "") ?? "";
  if (COMMAND_PREFIXES.includes(first.toLowerCase()) || /\s/.test(trimmed)) {
    return { kind: "command", pattern: trimmed };
  }
  if (/\.\w{1,8}$/.test(trimmed) || trimmed.includes("*.")) {
    return { kind: "path", pattern: trimmed };
  }
  return { kind: "command", pattern: trimmed };
}

export function patternsToPolicy(patterns: {
  always?: string[];
  ask?: string[];
  never?: string[];
}): AgentToolPolicy {
  const paths: PolicyRule[] = [];
  const commands: PolicyRule[] = [];
  const add = (items: string[] | undefined, action: PolicyAction) => {
    for (const item of items ?? []) {
      if (!item.trim()) {
        continue;
      }
      const { kind, pattern } = classifyPolicyPattern(item);
      (kind === "path" ? paths : commands).push({ pattern, action });
    }
  };
  add(patterns.never, "deny");
  add(patterns.ask, "ask");
  add(patterns.always, "allow");
  return { paths, commands };
}

/** Markdown `- always: src/**` / `- never: rm -rf *` plus frontmatter lists. */
export function parsePolicyBlocks(markdown: string): {
  always: string[];
  ask: string[];
  never: string[];
} {
  const result = { always: [] as string[], ask: [] as string[], never: [] as string[] };
  const lineRe = /^\s*-\s*(always|ask|never)\s*:\s*(.+)$/i;
  for (const line of markdown.split("\n")) {
    const match = line.match(lineRe);
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase() as "always" | "ask" | "never";
    const value = match[2].trim();
    if (value) {
      result[key].push(value);
    }
  }
  return result;
}

export function mergeAgentToolPolicies(
  ...policies: Array<AgentToolPolicy | null | undefined>
): AgentToolPolicy {
  const merged: AgentToolPolicy = {
    paths: [],
    commands: [],
    externalDirectory: DEFAULT_AGENT_TOOL_POLICY.externalDirectory,
    sandboxDestructive: DEFAULT_AGENT_TOOL_POLICY.sandboxDestructive,
  };
  for (const policy of policies) {
    if (!policy) {
      continue;
    }
    if (policy.paths?.length) {
      merged.paths = [...(merged.paths ?? []), ...policy.paths];
    }
    if (policy.commands?.length) {
      merged.commands = [...(merged.commands ?? []), ...policy.commands];
    }
    if (policy.externalDirectory) {
      merged.externalDirectory = policy.externalDirectory;
    }
    if (policy.sandboxDestructive !== undefined) {
      merged.sandboxDestructive = policy.sandboxDestructive;
    }
  }
  return merged;
}

export function matchCommandPattern(command: string, pattern: string): boolean {
  const cmd = command.trim().replace(/\s+/g, " ");
  const pat = pattern.trim().replace(/\s+/g, " ");
  let regex = "";
  for (const ch of pat) {
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "?") {
      regex += ".";
    } else if (".+^${}()|[]\\".includes(ch)) {
      regex += `\\${ch}`;
    } else {
      regex += ch;
    }
  }
  return new RegExp(`^${regex}$`, "i").test(cmd);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function joinPath(base: string, rel: string): string {
  if (!base) {
    return rel;
  }
  if (!rel) {
    return base;
  }
  return `${toPosix(base).replace(/\/+$/, "")}/${toPosix(rel).replace(/^\/+/, "")}`;
}

function normalizeSlashes(p: string): string {
  const posix = toPosix(p);
  const parts: string[] = [];
  for (const part of posix.split("/")) {
    if (part === "" || part === ".") {
      if (part === "" && parts.length === 0) {
        parts.push("");
      }
      continue;
    }
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else {
        parts.push("..");
      }
      continue;
    }
    parts.push(part);
  }
  if (posix.startsWith("/")) {
    return "/" + parts.filter(Boolean).join("/");
  }
  return parts.join("/");
}

function expandHome(p: string, home: string): string {
  if (!home) {
    return p;
  }
  if (p === "~") {
    return home;
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return joinPath(home, p.slice(2));
  }
  return p;
}

function stripFileUri(p: string): string {
  if (p.startsWith("file://")) {
    try {
      return decodeURIComponent(
        p.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1"),
      );
    } catch {
      return p.replace(/^file:\/\//, "");
    }
  }
  return p;
}

function guessHome(): string {
  try {
    return process.env.HOME || process.env.USERPROFILE || "";
  } catch {
    return "";
  }
}

export function normalizePolicyPath(
  raw: string,
  workspaceDirs: string[] = [],
  home = guessHome(),
): { relative: string; absolute: string } {
  let cleaned = stripFileUri(raw.trim());
  cleaned = expandHome(cleaned, home);
  const absolute = normalizeSlashes(
    isAbsolutePath(cleaned)
      ? cleaned
      : workspaceDirs[0]
        ? joinPath(stripFileUri(workspaceDirs[0]), cleaned)
        : cleaned,
  );

  const absPosix = toPosix(absolute);
  for (const dir of workspaceDirs) {
    const root = normalizeSlashes(
      toPosix(stripFileUri(expandHome(dir, home))),
    ).replace(/\/+$/, "");
    if (absPosix === root) {
      return { relative: ".", absolute };
    }
    if (absPosix.startsWith(root + "/")) {
      return { relative: absPosix.slice(root.length + 1), absolute };
    }
  }
  return { relative: toPosix(cleaned).replace(/^\/+/, ""), absolute };
}

export function isCargoRegistrySourceReadPath(
  raw: string,
  home = guessHome(),
): boolean {
  return CARGO_REGISTRY_SRC_READ_PATTERNS.some((pattern) =>
    pathMatchesPolicy(raw, pattern, [], home),
  );
}

export function isCargoRegistryWritePath(
  raw: string,
  home = guessHome(),
): boolean {
  return CARGO_REGISTRY_WRITE_DENY_PATTERNS.some((pattern) =>
    pathMatchesPolicy(raw, pattern, [], home),
  );
}

export function isPathOutsideWorkspace(
  raw: string,
  workspaceDirs: string[],
  home = guessHome(),
): boolean {
  if (!workspaceDirs.length) {
    return false;
  }
  const { absolute } = normalizePolicyPath(raw, workspaceDirs, home);
  const absPosix = toPosix(absolute);
  return !workspaceDirs.some((dir) => {
    const root = normalizeSlashes(
      toPosix(stripFileUri(expandHome(dir, home))),
    ).replace(/\/+$/, "");
    return absPosix === root || absPosix.startsWith(root + "/");
  });
}

export function pathMatchesPolicy(
  rawPath: string,
  pattern: string,
  workspaceDirs: string[] = [],
  home = guessHome(),
): boolean {
  const { relative, absolute } = normalizePolicyPath(rawPath, workspaceDirs, home);
  const expandedPattern = expandHome(pattern, home);
  const candidates = [
    relative,
    toPosix(absolute),
    toPosix(rawPath.trim()),
    toPosix(expandHome(rawPath.trim(), home)),
  ];
  return candidates.some(
    (candidate) =>
      matchGlob(candidate, pattern) || matchGlob(candidate, expandedPattern),
  );
}

export function extractToolPolicyTargets(
  toolName: string,
  args: unknown,
): ToolPolicyTargets {
  const parsed = parseToolArgs(args) ?? {};
  const paths: string[] = [];
  let command: string | undefined;
  let cwd: string | undefined;

  if (toolName === BuiltInToolNames.ApplyPatch) {
    const patch =
      typeof parsed.patch === "string"
        ? parsed.patch
        : typeof parsed.diff === "string"
          ? parsed.diff
          : "";
    paths.push(...extractPatchFilePaths(patch));
  }

  if (
    toolName === BuiltInToolNames.RunTerminalCommand ||
    toolName === BuiltInToolNames.PtyStart
  ) {
    if (typeof parsed.command === "string") {
      command = parsed.command;
    }
    if (typeof parsed.working_directory === "string") {
      cwd = parsed.working_directory;
      paths.push(parsed.working_directory);
    } else if (typeof parsed.cwd === "string") {
      cwd = parsed.cwd;
      paths.push(parsed.cwd);
    }
  }

  for (const key of PATH_ARG_KEYS) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
  }

  return {
    paths: [...new Set(paths)],
    command,
    cwd,
  };
}

function worstAction(
  current: PolicyAction | null,
  next: PolicyAction,
): PolicyAction {
  const rank = { deny: 3, ask: 2, allow: 1 };
  if (!current) {
    return next;
  }
  return rank[next] > rank[current] ? next : current;
}

export function evaluateToolPolicy(params: {
  toolName: string;
  args: unknown;
  policy?: AgentToolPolicy | null;
  workspaceDirs?: string[];
  home?: string;
}): PolicyDecision {
  const policy = mergeAgentToolPolicies(
    DEFAULT_AGENT_TOOL_POLICY,
    params.policy,
  );
  const home = params.home ?? guessHome();
  const workspaceDirs = params.workspaceDirs ?? [];
  const targets = extractToolPolicyTargets(params.toolName, params.args);

  let action: PolicyAction | null = null;
  let reason = "";

  const set = (next: PolicyAction, why: string) => {
    const prev = action;
    action = worstAction(action, next);
    if (action !== prev) {
      reason = why;
    }
  };

  if (targets.command && policy.sandboxDestructive !== false) {
    const cmd = targets.command;
    if (
      DESTRUCTIVE_COMMAND_PATTERNS.some((pat) => matchCommandPattern(cmd, pat)) ||
      DESTRUCTIVE_COMMAND_REGEXES.some((re) => re.test(cmd))
    ) {
      return {
        action: "deny",
        reason: `Sandbox blocked destructive command: ${cmd}`,
      };
    }
    if (CARGO_ASK_COMMAND_RE.test(cmd)) {
      set(
        "ask",
        `cargo clean/yank requires explicit confirmation: ${cmd}`,
      );
    }
  }

  for (const p of targets.paths) {
    for (const hard of HARD_PATH_DENY) {
      if (pathMatchesPolicy(p, hard, workspaceDirs, home)) {
        return {
          action: "deny",
          reason: `Sensitive path "${p}" is blocked (${hard})`,
        };
      }
    }
  }

  if (MUTATING_PATH_TOOLS.has(params.toolName)) {
    for (const p of targets.paths) {
      if (isCargoRegistryWritePath(p, home)) {
        return {
          action: "deny",
          reason: `Writing crates.io / cargo registry source is blocked: ${p}`,
        };
      }
    }
  }

  for (const p of targets.paths) {
    for (const rule of policy.paths ?? []) {
      if (pathMatchesPolicy(p, rule.pattern, workspaceDirs, home)) {
        set(rule.action, `Path "${p}" matched ${rule.action} ${rule.pattern}`);
      }
    }
  }

  if (targets.command) {
    for (const rule of policy.commands ?? []) {
      if (matchCommandPattern(targets.command, rule.pattern)) {
        set(
          rule.action,
          `Command matched ${rule.action} ${rule.pattern}`,
        );
      }
    }
  }

  const externalMode = policy.externalDirectory ?? "ask";
  if (externalMode !== "allow" && workspaceDirs.length > 0) {
    const extras = [...targets.paths];
    if (targets.cwd) {
      extras.push(targets.cwd);
    }
    for (const p of extras) {
      if (
        READONLY_PATH_TOOLS.has(params.toolName) &&
        isCargoRegistrySourceReadPath(p, home)
      ) {
        set("allow", `Read of pinned crate source "${p}" is allowed`);
        continue;
      }
      if (isPathOutsideWorkspace(p, workspaceDirs, home)) {
        set(
          externalMode === "deny" ? "deny" : "ask",
          `Path "${p}" is outside the workspace`,
        );
      }
    }
  }

  return { action, reason };
}

export function policyBlocksAutoApprove(
  decision: PolicyDecision,
  permissionMode: "default" | "acceptEdits" | "fullAuto",
): boolean {
  if (decision.action === "deny") {
    return true;
  }
  if (decision.action === "ask" && permissionMode !== "fullAuto") {
    return true;
  }
  return false;
}

export function policyForcesAutoApprove(decision: PolicyDecision): boolean {
  return decision.action === "allow";
}

/** Hard deny for Core middleware / tools/call. Ask is a GUI concern. */
export function assertToolPolicyAllowed(params: {
  toolName: string;
  args: unknown;
  policy?: AgentToolPolicy | null;
  workspaceDirs?: string[];
}): void {
  const decision = evaluateToolPolicy(params);
  if (decision.action === "deny") {
    throw new ToolCallError({
      code: ToolCallErrorCode.PERMISSION_DENIED,
      message: decision.reason || `Tool "${params.toolName}" blocked by policy`,
      toolName: params.toolName,
      retryable: false,
      context: { reason: decision.reason },
    });
  }
}

export function resolveConfigAgentPolicy(experimental?: {
  agentPolicy?: AgentToolPolicy | null;
  agentPolicyFromRules?: AgentToolPolicy | null;
} | null): AgentToolPolicy {
  return mergeAgentToolPolicies(
    experimental?.agentPolicyFromRules,
    experimental?.agentPolicy,
  );
}
