/**
 * Rules discovery and merge.
 *
 * ## Context merge order (chat)
 *
 * Effective system context is assembled in this order (later appends win for
 * conflicts only when both speak to the same concern; otherwise they coexist):
 *
 * 1. `DEFAULT_SYSTEM_MESSAGE` from `constructMessages` (code-block + edit-tool rules)
 * 2. Per-turn GUI inject: memory (`## Relevant Memory Context`)
 * 3. Config `systemMessage` = YAML/JSON `rules[]` **then** merged project
 *    instructions (appended in `compileChatMessages` via `LLM.systemMessage`)
 * 4. Skills: **not** auto-injected as full bodies — intent matcher may suggest
 *    skill names; full content loads via `builtin_skill`
 * 5. Prompt files: only when invoked as slash commands (may replace system)
 *
 * ## applyTo
 *
 * Frontmatter `applyTo` globs are matched against the current/open file paths
 * (relative to workspace roots when possible). Missing/`**` applyTo = always on.
 * Folder-level `{subdir}/.knoxrules` is not scanned. Nested `AGENTS.md` is
 * loaded when the current/open file walks up to the workspace root.
 *
 * ## Precedence (low → high; later sections appended)
 *
 * 1. `~/.knoxrules` (0) and `~/.knox/rules/*` (5)
 * 2. `{workspace}/CLAUDE.md` (7) — compat
 * 3. `{workspace}/AGENTS.md` (8)
 * 4. `{workspace}/.knox/AGENTS.md` (9)
 * 5. `{workspace}/.knoxrules` (10) — Knox-specific wins over generic agent files
 * 6. Nested `{subdir}/AGENTS.md` closer to the open file (12+)
 *
 * ## Policy blocks (P1.3 / P1.12)
 *
 * Frontmatter `always` / `ask` / `never` lists, or markdown
 * `- always: src/**` / `- never: rm -rf *`, become path/command rules
 * merged into `experimental.agentPolicyFromRules`.
 */

import ignore from "ignore";
import os from "os";
import path from "path";

import { IDE } from "..";
import {
  mergeAgentToolPolicies,
  parsePolicyBlocks,
  patternsToPolicy,
  type AgentToolPolicy,
} from "../tools/toolPolicy";
import { getGlobalRulesPath } from "../util/paths";
import { localPathOrUriToPath, localPathToUri } from "../util/pathToUri";
import { joinPathsToUri } from "../util/uri";

const RULES_FILE_NAME = ".knoxrules";

/** Workspace agent-instruction files besides `.knoxrules` (Codex / Claude). */
export const AGENT_INSTRUCTION_FILES: Array<{
  relativePath: string;
  defaultPriority: number;
}> = [
  { relativePath: "CLAUDE.md", defaultPriority: 7 },
  { relativePath: "AGENTS.md", defaultPriority: 8 },
  { relativePath: ".knox/AGENTS.md", defaultPriority: 9 },
];

const NESTED_AGENTS_NAME = "AGENTS.md";
const NESTED_AGENTS_BASE_PRIORITY = 12;

// ── Types ────────────────────────────────────────────────────────────

export interface RuleFile {
  /** Where this rule was loaded from */
  source: "global" | "workspace" | "folder";
  /** Absolute path to the file */
  filePath: string;
  /** Glob patterns this rule applies to (from YAML frontmatter) */
  applyTo: string[];
  /** Priority: higher = overrides lower. folder > workspace > global */
  priority: number;
  /** The rule content (markdown body after frontmatter) */
  content: string;
  /** always / ask / never policy fragments from frontmatter or markdown. */
  policy?: AgentToolPolicy;
}

export interface MergedRules {
  /** Combined system prompt content from all applicable rules */
  systemPrompt: string;
  /** Individual rule files that contributed */
  sources: string[];
}

// ── Template variable replacement ────────────────────────────────────

const TEMPLATE_VARS: Record<string, () => string> = {
  "{os}": () => process.platform,
  "{arch}": () => process.arch,
  "{home}": () => os.homedir(),
};

function applyTemplateVars(
  content: string,
  extraVars?: Record<string, string>,
): string {
  let result = content;
  for (const [pattern, resolver] of Object.entries(TEMPLATE_VARS)) {
    result = result.replaceAll(pattern, resolver());
  }
  if (extraVars) {
    for (const [key, value] of Object.entries(extraVars)) {
      result = result.replaceAll(`{${key}}`, value);
    }
  }
  return result;
}

// ── YAML frontmatter parsing ─────────────────────────────────────────

interface Frontmatter {
  applyTo?: string[];
  priority?: number;
  always?: string[];
  ask?: string[];
  never?: string[];
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInlineApplyTo(value: string): string[] | undefined {
  if (!value) {
    return [];
  }
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value.replace(/'/g, '"'));
      if (Array.isArray(parsed)) {
        return parsed.map((item) => stripQuotes(String(item).trim())).filter(Boolean);
      }
    } catch {
      // Fall through to comma-split inside brackets
      const inner = value.slice(1, value.endsWith("]") ? -1 : undefined);
      return inner
        .split(",")
        .map((part) => stripQuotes(part.trim()))
        .filter(Boolean);
    }
    return [];
  }
  return [stripQuotes(value)];
}

const LIST_KEYS = ["applyTo", "always", "ask", "never"] as const;
type ListKey = (typeof LIST_KEYS)[number];

function isListKey(key: string): key is ListKey {
  return (LIST_KEYS as readonly string[]).includes(key);
}

/**
 * Parse a minimal rules frontmatter block.
 * Supports `applyTo`, `always` / `ask` / `never` policy lists, and `priority`.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = raw.match(fmRegex);

  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const fmBlock = match[1];
  const body = raw.slice(match[0].length);
  const frontmatter: Frontmatter = {};
  let collecting: ListKey | null = null;

  for (const line of fmBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const listHeader = trimmed.match(/^(applyTo|always|ask|never):(?:\s*(.*))?$/);
    if (listHeader && isListKey(listHeader[1])) {
      collecting = listHeader[1];
      const value = (listHeader[2] ?? "").trim();
      frontmatter[collecting] = parseInlineApplyTo(value);
      continue;
    }

    if (trimmed.startsWith("- ") && collecting) {
      if (!frontmatter[collecting]) {
        frontmatter[collecting] = [];
      }
      const item = stripQuotes(trimmed.slice(2).trim());
      if (item) {
        frontmatter[collecting]!.push(item);
      }
      continue;
    }

    if (trimmed.startsWith("priority:")) {
      collecting = null;
      const val = parseInt(trimmed.slice("priority:".length).trim(), 10);
      if (!isNaN(val)) {
        frontmatter.priority = val;
      }
      continue;
    }

    if (trimmed.includes(":")) {
      collecting = null;
    }
  }

  return { frontmatter, body };
}

export function policyFromRuleText(
  frontmatter: Frontmatter,
  body: string,
): AgentToolPolicy | undefined {
  const fromFm = patternsToPolicy({
    always: frontmatter.always,
    ask: frontmatter.ask,
    never: frontmatter.never,
  });
  const fromBody = patternsToPolicy(parsePolicyBlocks(body));
  const merged = mergeAgentToolPolicies(fromFm, fromBody);
  if ((merged.paths?.length ?? 0) === 0 && (merged.commands?.length ?? 0) === 0) {
    return undefined;
  }
  return merged;
}

function normalizeApplyTo(applyTo: string[] | undefined): string[] {
  if (!applyTo || applyTo.length === 0) {
    return ["**"];
  }
  return applyTo.map((pattern) => stripQuotes(pattern.trim())).filter(Boolean);
}

// ── applyTo matching ─────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Normalize a file path/URI for glob matching (prefer workspace-relative).
 */
export function normalizePathForRules(
  filePathOrUri: string,
  workspaceDirs: string[] = [],
): string {
  let filePath = filePathOrUri;
  try {
    filePath = localPathOrUriToPath(filePathOrUri);
  } catch {
    // keep as-is
  }
  const posix = toPosix(filePath);

  for (const dir of workspaceDirs) {
    let root = dir;
    try {
      root = localPathOrUriToPath(dir);
    } catch {
      // keep
    }
    const rootPosix = toPosix(root).replace(/\/+$/, "");
    if (posix === rootPosix) {
      return ".";
    }
    if (posix.startsWith(rootPosix + "/")) {
      return posix.slice(rootPosix.length + 1);
    }
  }

  // Strip leading slash so gitignore-style matchers can see "src/foo.ts"
  return posix.replace(/^\/+/, "");
}

/**
 * Whether a rule's applyTo globs match any of the active paths.
 * `**` or empty applyTo always matches. With no active paths, only universal rules match.
 */
export function ruleAppliesToPaths(
  rule: Pick<RuleFile, "applyTo">,
  activePaths?: string[] | null,
): boolean {
  const patterns = normalizeApplyTo(rule.applyTo);
  if (patterns.includes("**") || patterns.includes("*")) {
    return true;
  }

  if (!activePaths || activePaths.length === 0) {
    // Path-specific rules stay inactive until we know which files are in play
    return false;
  }

  const ig = ignore();
  try {
    ig.add(patterns);
  } catch {
    return false;
  }

  return activePaths.some((active) => {
    const candidates = [active, toPosix(active), path.posix.basename(toPosix(active))];
    return candidates.some((candidate) => {
      if (!candidate || candidate === ".") {
        return false;
      }
      try {
        return ig.ignores(candidate);
      } catch {
        return false;
      }
    });
  });
}

async function tryLoadRuleFile(
  ide: IDE,
  filePath: string,
  source: RuleFile["source"],
  defaultPriority: number,
): Promise<RuleFile | null> {
  try {
    if (!(await ide.fileExists(filePath))) {
      return null;
    }
    const content = await ide.readFile(filePath);
    const { frontmatter, body } = parseFrontmatter(content);
    const trimmed = body.trim();
    if (!trimmed) {
      return null;
    }
    return {
      source,
      filePath,
      applyTo: normalizeApplyTo(frontmatter.applyTo),
      priority: frontmatter.priority ?? defaultPriority,
      content: trimmed,
      policy: policyFromRuleText(frontmatter, body),
    };
  } catch {
    return null;
  }
}

function parentDirUri(fileUri: string): string | null {
  const trimmed = fileUri.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) {
    return null;
  }
  // Keep scheme://host for file:// URIs
  const schemeIdx = trimmed.indexOf("://");
  const min = schemeIdx >= 0 ? schemeIdx + 3 : 0;
  if (idx <= min) {
    return null;
  }
  return trimmed.slice(0, idx);
}

function isUriUnderRoot(candidate: string, root: string): boolean {
  const a = candidate.replace(/\/+$/, "");
  const b = root.replace(/\/+$/, "");
  return a === b || a.startsWith(b + "/");
}

function depthFromRoot(dirUri: string, root: string): number {
  const a = dirUri.replace(/\/+$/, "");
  const b = root.replace(/\/+$/, "");
  if (a === b) {
    return 0;
  }
  if (!a.startsWith(b + "/")) {
    return 0;
  }
  return a.slice(b.length + 1).split("/").filter(Boolean).length;
}

/**
 * Directories from an active file up to (and including) the workspace root.
 */
export function walkDirsToWorkspaceRoot(
  filePathOrUri: string,
  workspaceDirs: string[],
): string[] {
  let current = filePathOrUri;
  try {
    // If this is a file, start from its parent
    if (!current.endsWith("/")) {
      const parent = parentDirUri(current);
      if (parent) {
        current = parent;
      }
    }
  } catch {
    // keep
  }

  const dirs: string[] = [];
  const seen = new Set<string>();
  let dir: string | null = current;
  while (dir) {
    const key = dir.replace(/\/+$/, "");
    if (seen.has(key)) {
      break;
    }
    const under = workspaceDirs.some((root) => isUriUnderRoot(key, root));
    if (!under) {
      break;
    }
    seen.add(key);
    dirs.push(key);
    if (workspaceDirs.some((root) => key === root.replace(/\/+$/, ""))) {
      break;
    }
    dir = parentDirUri(key);
  }
  return dirs;
}

// ── Rule discovery ───────────────────────────────────────────────────

/**
 * Discover and load project instructions from:
 * 1. Global: `~/.knoxrules` and `~/.knox/rules/*.{md,txt}`
 * 2. Workspace roots: `CLAUDE.md`, `AGENTS.md`, `.knox/AGENTS.md`, `.knoxrules`
 * 3. Nested `{subdir}/AGENTS.md` along the current/open file path
 *
 * Subfolder `.knoxrules` files are not discovered.
 */
export async function discoverRules(ide: IDE): Promise<RuleFile[]> {
  const rules: RuleFile[] = [];

  // 1. Global rules: ~/.knoxrules
  try {
    const globalPath = path.join(os.homedir(), RULES_FILE_NAME);
    if (await ide.fileExists(globalPath)) {
      const content = await ide.readFile(globalPath);
      const { frontmatter, body } = parseFrontmatter(content);
      rules.push({
        source: "global",
        filePath: globalPath,
        applyTo: normalizeApplyTo(frontmatter.applyTo),
        priority: frontmatter.priority ?? 0,
        content: body.trim(),
        policy: policyFromRuleText(frontmatter, body),
      });
    }
  } catch {
    // Global file not found — fine
  }

  // ~/.knox/rules/*.md directory
  try {
    const globalRulesDir = localPathToUri(getGlobalRulesPath());
    const entries = await ide.listDir(globalRulesDir);
    for (const [name, fileType] of entries) {
      if (fileType === 1 && (name.endsWith(".md") || name.endsWith(".txt"))) {
        const filePath = joinPathsToUri(globalRulesDir, name);
        try {
          const content = await ide.readFile(filePath);
          const { frontmatter, body } = parseFrontmatter(content);
          rules.push({
            source: "global",
            filePath,
            applyTo: normalizeApplyTo(frontmatter.applyTo),
            priority: frontmatter.priority ?? 5,
            content: body.trim(),
            policy: policyFromRuleText(frontmatter, body),
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // ~/.knox/rules/ directory doesn't exist
  }

  // 2. Workspace-level agent instructions + .knoxrules
  const workspaceDirs = await ide.getWorkspaceDirs();
  const seenFiles = new Set(rules.map((r) => r.filePath));

  const pushUnique = (rule: RuleFile | null) => {
    if (!rule || seenFiles.has(rule.filePath)) {
      return;
    }
    seenFiles.add(rule.filePath);
    rules.push(rule);
  };

  for (const dir of workspaceDirs) {
    for (const spec of AGENT_INSTRUCTION_FILES) {
      pushUnique(
        await tryLoadRuleFile(
          ide,
          joinPathsToUri(dir, spec.relativePath),
          "workspace",
          spec.defaultPriority,
        ),
      );
    }
    pushUnique(
      await tryLoadRuleFile(
        ide,
        joinPathsToUri(dir, RULES_FILE_NAME),
        "workspace",
        10,
      ),
    );
  }

  // 3. Nested AGENTS.md from the current/open file up to the workspace root
  const activePaths = await collectActivePaths(ide);
  for (const active of activePaths ?? []) {
    // active is workspace-relative; resolve against each root
    for (const root of workspaceDirs) {
      const fileUri = active.includes("://")
        ? active
        : joinPathsToUri(root, active);
      const dirs = walkDirsToWorkspaceRoot(fileUri, workspaceDirs);
      for (const dir of dirs) {
        const isRoot = workspaceDirs.some(
          (ws) => dir.replace(/\/+$/, "") === ws.replace(/\/+$/, ""),
        );
        if (isRoot) {
          continue; // already loaded as workspace AGENTS.md
        }
        const depth = depthFromRoot(dir, root);
        pushUnique(
          await tryLoadRuleFile(
            ide,
            joinPathsToUri(dir, NESTED_AGENTS_NAME),
            "folder",
            NESTED_AGENTS_BASE_PRIORITY + depth,
          ),
        );
      }
    }
  }

  // Sort by priority (lower first → higher overrides)
  rules.sort((a, b) => a.priority - b.priority);

  return rules;
}

// ── Rule merging ─────────────────────────────────────────────────────

/**
 * Merge discovered rules into a single system prompt string.
 * Applies template substitution and filters by `applyTo` when `activePaths` is set.
 */
export function mergeRules(
  rules: RuleFile[],
  extraVars?: Record<string, string>,
  activePaths?: string[] | null,
): MergedRules {
  if (rules.length === 0) {
    return { systemPrompt: "", sources: [] };
  }

  const sections: string[] = [];
  const sources: string[] = [];

  for (const rule of rules) {
    if (!rule.content) continue;
    if (!ruleAppliesToPaths(rule, activePaths)) continue;

    const processed = applyTemplateVars(rule.content, extraVars);
    sections.push(processed);
    sources.push(rule.filePath);
  }

  return {
    systemPrompt: sections.join("\n\n"),
    sources,
  };
}

async function collectActivePaths(ide: IDE): Promise<string[] | undefined> {
  try {
    const workspaceDirs = await ide.getWorkspaceDirs();
    const paths = new Set<string>();
    const current = await ide.getCurrentFile();
    if (current?.path && !current.isUntitled) {
      paths.add(normalizePathForRules(current.path, workspaceDirs));
    }
    const openFiles = await ide.getOpenFiles();
    for (const open of openFiles ?? []) {
      paths.add(normalizePathForRules(open, workspaceDirs));
    }
    const list = Array.from(paths).filter(Boolean);
    return list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
}

export function mergeRulePolicies(rules: RuleFile[]): AgentToolPolicy {
  return mergeAgentToolPolicies(...rules.map((rule) => rule.policy));
}

export async function loadProjectInstructions(
  ide: IDE,
  extraVars?: Record<string, string>,
): Promise<{
  systemPrompt: string | null;
  policy: AgentToolPolicy;
  sources: string[];
}> {
  const rules = await discoverRules(ide);
  if (rules.length === 0) {
    return { systemPrompt: null, policy: {}, sources: [] };
  }

  const activePaths = await collectActivePaths(ide);
  const merged = mergeRules(rules, extraVars, activePaths ?? []);
  return {
    systemPrompt: merged.systemPrompt || null,
    policy: mergeRulePolicies(rules),
    sources: merged.sources,
  };
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Load all rules and merge them into a system prompt.
 * Drop-in replacement for getSystemPromptDotFile() with hierarchy + applyTo support.
 */
export async function loadRules(
  ide: IDE,
  extraVars?: Record<string, string>,
): Promise<string | null> {
  const { systemPrompt } = await loadProjectInstructions(ide, extraVars);
  return systemPrompt;
}
