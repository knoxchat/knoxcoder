/**
 * Skill system types.
 */

export interface SkillInfo {
  /** Unique name from the frontmatter */
  name: string;
  /** Short human-readable description from the frontmatter */
  description: string;
  /** Absolute path to the SKILL.md file */
  location: string;
  /** Markdown body (everything after the frontmatter) */
  content: string;
}

export interface SkillManagerOptions {
  /**
   * Workspace directories to scan for project-level skills.
   * Typically from `ide.getWorkspaceDirs()`.
   */
  workspaceDirs: string[];

  /**
   * Optional additional skill paths from user configuration.
   * Can be absolute or relative (resolved against first workspace dir).
   * Supports `~/` prefix for home directory.
   */
  additionalPaths?: string[];

  /**
   * Optional remote skill index URLs.
   * Each URL should serve an `index.json` in the opencode skill-index format.
   */
  urls?: string[];

  /**
   * Optional integrity pins for remote skills: name → sha256 of SKILL.md.
   */
  pins?: Record<string, string>;

  /**
   * When true, skip scanning external directories (.claude, .agents, .opencode).
   * Default: false.
   */
  disableExternalSkills?: boolean;
}

/**
 * Skills configuration block — can be specified in config.yaml.
 * Mirrors opencode's `config.skills` structure.
 */
export interface SkillsConfig {
  /** Additional filesystem paths to scan for skills */
  paths?: string[];
  /** Remote skill index URLs */
  urls?: string[];
  /** When true, disable loading skills from .claude, .agents, .opencode dirs */
  disableExternalSkills?: boolean;
  /** Pin remote skills by name → sha256 of SKILL.md */
  pins?: Record<string, string>;
}
