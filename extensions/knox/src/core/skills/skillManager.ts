/**
 * SkillManager — discovers, loads, and provides access to skills.
 *
 * Mirrors the behaviour of opencode's `Skill` namespace with enhancements:
 *  0. Scan shipped bundled skills (linux-kernel, qemu, gdb, kbuild, rust)
 *  1. Scan external dirs (.claude/skills/, .agents/skills/) — global then project
 *     with upward directory traversal (walking parent dirs to repo root)
 *  2. Scan opencode-compat dirs (.opencode/{skill,skills}/) — global then project
 *  3. Scan Knox-native dirs (~/.knox/skills/) — global only
 *  4. Scan additional user-configured paths
 *  5. Pull remote skills from URLs
 *
 * Project-level skills override global skills with the same name.
 * Supports symlinks, glob patterns, and `.opencode/` compatibility.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parseFrontmatter } from "./frontmatter";
import { pullSkillsFromUrl } from "./discovery";
import { SkillInfo, SkillManagerOptions } from "./types";
import { getGlobalSkillsPath } from "../util/paths";

/** Directory containing this module (`core/skills` in source, bundle dir after esbuild). */
function skillManagerDir(): string {
  try {
    // CJS (VS Code tsc / extension bundle). Do not use import.meta — vscode
    // compiles core with module: commonjs, which rejects import.meta.
    if (typeof __dirname === "string" && __dirname.length > 0) {
      return __dirname;
    }
  } catch {
    // ESM runtimes may not define __dirname
  }
  const fromCore = path.join(process.cwd(), "skills");
  if (fs.existsSync(fromCore)) {
    return fromCore;
  }
  return path.join(process.cwd(), "core", "skills");
}

/** Shipped kernel/QEMU/GDB/Kbuild/Rust skills (HL-40 / RL-18). Project skills with the same name override. */
export function getBundledSkillsPath(): string {
  return path.join(skillManagerDir(), "bundled");
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Directories from other coding agents we also scan. */
const EXTERNAL_DIRS = [".claude", ".agents"];

/** Opencode-compatible directories. */
const OPENCODE_DIRS = [".opencode"];

/** The filename we look for inside skill directories. */
const SKILL_FILENAME = "SKILL.md";

/** Directories to skip when recursively walking. */
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a path exists (follows symlinks).
 */
function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory (follows symlinks).
 */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively find all files matching `SKILL.md` under `root`.
 * Returns absolute paths. Follows symlinks.
 */
function findSkillFiles(root: string): string[] {
  const results: string[] = [];
  if (!pathExists(root) || !isDirectory(root)) {
    return results;
  }

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      // Resolve symlinks — entry.isDirectory() returns false for symlinks,
      // so we need to check with fs.statSync which follows symlinks.
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(full));
      const isFile = entry.isFile() || (entry.isSymbolicLink() && !isDir);

      if (isDir) {
        if (SKIP_DIRS.has(entry.name)) continue;
        // Skip hidden dirs except known ones at specific levels
        if (entry.name.startsWith(".") && !EXTERNAL_DIRS.includes(entry.name) && !OPENCODE_DIRS.includes(entry.name)) continue;
        walk(full);
      } else if (isFile && entry.name === SKILL_FILENAME) {
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
}

/**
 * Walk upward from `start` to `stop` (inclusive) looking for directories
 * matching any of `targets`. Returns the full paths of matching target dirs.
 *
 * Mirrors opencode's `Filesystem.up()` pattern.
 *
 * @example
 *   // start = /home/user/projects/myapp/src
 *   // stop  = /home/user/projects/myapp
 *   // targets = [".claude", ".agents"]
 *   // Checks: /home/user/projects/myapp/src/.claude, .../src/.agents,
 *   //         /home/user/projects/myapp/.claude, .../.agents
 */
function* walkUp(
  targets: string[],
  start: string,
  stop?: string,
): Generator<string> {
  let current = path.resolve(start);
  const root = stop ? path.resolve(stop) : path.parse(current).root;

  while (true) {
    for (const target of targets) {
      const candidate = path.join(current, target);
      if (pathExists(candidate) && isDirectory(candidate)) {
        yield candidate;
      }
    }

    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
}

/**
 * Try to find the git worktree root (for bounding upward traversal).
 */
function findWorktreeRoot(dir: string): string | undefined {
  let current = path.resolve(dir);
  while (true) {
    if (pathExists(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Try to read and parse a SKILL.md file.
 * Returns undefined if the file is invalid / missing required fields.
 */
function loadSkillFile(filePath: string): SkillInfo | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    return undefined;
  }

  const { name, description } = parsed.data;
  if (!name || !description) {
    return undefined;
  }

  return {
    name,
    description,
    location: filePath,
    content: parsed.content,
  };
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class SkillManager {
  private skills: Map<string, SkillInfo> = new Map();
  private skillDirs: Set<string> = new Set();
  private loaded = false;
  private options: SkillManagerOptions;

  constructor(options: SkillManagerOptions) {
    this.options = options;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Get a single skill by name. */
  get(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  /** Get all loaded skills. */
  all(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  /** Get all directories that contain loaded skills. */
  dirs(): string[] {
    return Array.from(this.skillDirs);
  }

  /** Whether skills have been loaded at least once. */
  get isLoaded(): boolean {
    return this.loaded;
  }

  // ── Loading ─────────────────────────────────────────────────────────

  /**
   * Discover and load all skills. Can be called multiple times to refresh.
   */
  async load(): Promise<void> {
    this.skills.clear();
    this.skillDirs.clear();

    // 0. Shipped systems skills (linux-kernel, qemu, gdb, kbuild)
    this.scanDir(getBundledSkillsPath());

    // 1. External dirs (.claude, .agents) — global (home) first, then
    //    project-level with upward directory traversal
    if (!this.options.disableExternalSkills) {
      const home = os.homedir();

      // Global external dirs (e.g. ~/.claude/skills/, ~/.agents/skills/)
      for (const dir of EXTERNAL_DIRS) {
        this.scanExternalDir(path.join(home, dir));
      }

      // Project-level with upward traversal — walk from workspace dir up
      // to the git worktree root, checking for .claude/skills, .agents/skills
      for (const wsDir of this.options.workspaceDirs) {
        const worktreeRoot = findWorktreeRoot(wsDir);
        for (const extDir of walkUp(EXTERNAL_DIRS, wsDir, worktreeRoot)) {
          this.scanExternalDir(extDir);
        }
      }
    }

    // 2. Opencode-compat dirs (.opencode/{skill,skills}/) — global then project
    if (!this.options.disableExternalSkills) {
      const home = os.homedir();

      // Global opencode dir
      for (const dir of OPENCODE_DIRS) {
        this.scanOpencodeDirs(path.join(home, dir));
      }

      // Project-level with upward traversal
      for (const wsDir of this.options.workspaceDirs) {
        const worktreeRoot = findWorktreeRoot(wsDir);
        for (const ocDir of walkUp(OPENCODE_DIRS, wsDir, worktreeRoot)) {
          this.scanOpencodeDirs(ocDir);
        }
      }
    }

    // 3. Knox-native dirs — global only
    this.scanDir(getGlobalSkillsPath());

    for (const wsDir of this.options.workspaceDirs) {
      // Also support top-level skills/ and skill/ in the workspace
      this.scanDir(path.join(wsDir, "skills"));
      this.scanDir(path.join(wsDir, "skill"));
    }

    // 4. Additional user-configured paths
    if (this.options.additionalPaths) {
      for (const skillPath of this.options.additionalPaths) {
        const expanded = skillPath.startsWith("~/")
          ? path.join(os.homedir(), skillPath.slice(2))
          : skillPath;
        const resolved = path.isAbsolute(expanded)
          ? expanded
          : this.options.workspaceDirs.length > 0
            ? path.join(this.options.workspaceDirs[0], expanded)
            : path.resolve(expanded);

        if (!isDirectory(resolved)) {
          console.warn(`[skills] Configured path not found: ${resolved}`);
          continue;
        }
        this.scanDir(resolved);
      }
    }

    // 5. Remote skill indexes (optional sha256 / config pins)
    if (this.options.urls) {
      for (const url of this.options.urls) {
        try {
          const dirs = await pullSkillsFromUrl(url, {
            pins: this.options.pins,
          });
          for (const dir of dirs) {
            this.scanDir(dir);
          }
        } catch (err) {
          console.error(`[skills] Failed to pull from ${url}:`, err);
        }
      }
    }

    this.loaded = true;
  }

  // ── Private scanning helpers ────────────────────────────────────────

  /**
   * Scan an external dir (e.g. `.claude`) for skills under `skills/`.
   */
  private scanExternalDir(root: string): void {
    const skillsDir = path.join(root, "skills");
    this.scanDir(skillsDir);
  }

  /**
   * Scan an opencode-compatible dir (e.g. ".opencode") for skills under
   * both "skill/" and "skills/" subdirectories (matching opencode's
   * skill+skills glob pattern).
   */
  private scanOpencodeDirs(root: string): void {
    this.scanDir(path.join(root, "skill"));
    this.scanDir(path.join(root, "skills"));
  }

  /**
   * Scan a directory for SKILL.md files and add them.
   */
  private scanDir(dir: string): void {
    if (!pathExists(dir) || !isDirectory(dir)) {
      return;
    }

    const files = findSkillFiles(dir);
    for (const file of files) {
      this.addSkill(file);
    }
  }

  /**
   * Load a single SKILL.md file and register it.
   * Later additions (project-level) override earlier ones (global) with the same name.
   */
  private addSkill(filePath: string): void {
    const skill = loadSkillFile(filePath);
    if (!skill) {
      return;
    }

    if (this.skills.has(skill.name)) {
      console.warn(
        `[skills] Duplicate skill "${skill.name}": ` +
          `${this.skills.get(skill.name)!.location} -> ${filePath}`,
      );
    }

    this.skillDirs.add(path.dirname(filePath));
    this.skills.set(skill.name, skill);
  }
}
