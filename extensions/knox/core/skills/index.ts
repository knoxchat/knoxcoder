/**
 * Skills System — Reusable prompt files that provide domain-specific
 * instructions and workflows.
 *
 * Skills are discovered from well-known directories:
 *   - `~/.knox/skills/`    (global, Knox-native)
 *   - `skills/` or `skill/` (project-level, optional)
 *   - `.claude/skills/`    (project-level, Claude Code compat)
 *   - `.agents/skills/`    (project-level, shared agent compat)
 *   - `.opencode/skill/`   (project-level, opencode compat)
 *   - `.opencode/skills/`  (project-level, opencode compat)
 *   - `~/.claude/skills/`  (global, Claude Code compat)
 *   - `~/.agents/skills/`  (global, shared agent compat)
 *   - `~/.opencode/skill/` (global, opencode compat)
 *   - `~/.opencode/skills/` (global, opencode compat)
 *
 * Directory traversal walks up from workspace to git worktree root,
 * matching opencode's Filesystem.up() behaviour.
 *
 * Each skill is a folder containing a `SKILL.md` file with YAML frontmatter:
 *
 *   ```
 *   ---
 *   name: my-skill
 *   description: Short description of what this skill does
 *   ---
 *   Full skill instructions in Markdown…
 *   ```
 *
 * Supports `@file` references and `` !`shell` `` commands in skill content.
 * Follows symlinks when scanning directories.
 *
 * Behaviour matches (and extends) opencode's skill system for cross-tool
 * compatibility.
 */

export { SkillManager, getBundledSkillsPath } from "./skillManager";
export type { SkillInfo, SkillManagerOptions, SkillsConfig } from "./types";
export {
  parseFrontmatter,
  extractFileRefs,
  extractShellRefs,
  fallbackSanitization,
  FILE_REGEX,
  SHELL_REGEX,
} from "./frontmatter";
export { pullSkillsFromUrl, sha256Hex } from "./discovery";
export type { SkillIndexEntry, PullSkillsOptions } from "./discovery";
export { buildSkillToolDescription } from "./descriptionBuilder";
export {
  matchSkillsByIntent,
  formatMatchedSkillsHint,
} from "./skillMatcher";
export type { SkillMatch } from "./skillMatcher";
