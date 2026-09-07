/**
 * Skill tool implementation.
 *
 * When the agent calls the `skill` tool with a skill name, this implementation:
 *  1. Looks up the skill in the SkillManager singleton.
 *  2. Returns the skill content wrapped in `<skill_content>` XML tags
 *     (matching opencode's output format).
 *  3. Lists bundled files in the skill's directory so the agent knows
 *     what supporting resources are available.
 *  4. Includes `@file` references and `!shell` command hints from the content.
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

import { ContextItem, ToolExtras } from "../..";
import { ToolImpl } from "./index";
import { getSkillManager } from "./skillSingleton";
import { buildSkillToolDescription } from "../../skills/descriptionBuilder";
import { extractFileRefs, extractShellRefs } from "../../skills/frontmatter";

/**
 * Returns the dynamic tool description including available skills.
 * Call this when building the tool list for the LLM.
 */
export function getSkillToolDescription(): string {
  const manager = getSkillManager();
  if (!manager || !manager.isLoaded) {
    return (
      "Load a specialized skill that provides domain-specific instructions and workflows. " +
      "No skills are currently available."
    );
  }
  return buildSkillToolDescription(manager.all());
}

/** Directories to skip when listing bundled files. */
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv"]);

/**
 * List non-SKILL.md files in a directory (up to `limit`).
 * Returns absolute paths. Follows symlinks.
 */
function listSkillFiles(dir: string, limit = 10): string[] {
  const results: string[] = [];

  function walk(d: string) {
    if (results.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      const full = path.join(d, entry.name);

      // Resolve symlinks
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectorySafe(full));
      const isFile = entry.isFile() || (entry.isSymbolicLink() && !isDir);

      if (isDir) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (isFile && entry.name !== "SKILL.md") {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

function isDirectorySafe(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export const skillImpl: ToolImpl = async (
  args: { name: string },
  extras: ToolExtras,
): Promise<ContextItem[]> => {
  const manager = getSkillManager();

  if (!manager) {
    return [
      {
        name: "Skill Error",
        description: "Skill system not initialized",
        content: "The skill system has not been initialized. No skills are available.",
      },
    ];
  }

  // Ensure skills are loaded
  if (!manager.isLoaded) {
    await manager.load();
  }

  const skill = manager.get(args.name);

  if (!skill) {
    const available = manager.all().map((s: { name: string }) => s.name);
    const list = available.length > 0 ? available.join(", ") : "none";
    return [
      {
        name: "Skill Not Found",
        description: `Skill "${args.name}" not found`,
        content: `Skill "${args.name}" not found. Available skills: ${list}`,
      },
    ];
  }

  const dir = path.dirname(skill.location);
  const baseUrl = pathToFileURL(dir).href;

  // List bundled resource files (matching opencode's Ripgrep-based listing)
  const files = listSkillFiles(dir);
  const fileList = files.map((f) => `<file>${f}</file>`).join("\n");

  // Extract @file references and !shell commands from skill content
  const fileRefs = extractFileRefs(skill.content);
  const shellRefs = extractShellRefs(skill.content);

  const extraSections: string[] = [];

  if (fileRefs.length > 0) {
    const refList = fileRefs.map((m) => m[1]).join(", ");
    extraSections.push(
      `Referenced files: ${refList}`,
      "These file references are relative to the skill's base directory unless they start with /.",
    );
  }

  if (shellRefs.length > 0) {
    const cmdList = shellRefs.map((m) => m[1]).join("; ");
    extraSections.push(
      `Embedded shell commands: ${cmdList}`,
      "These commands can be executed using the terminal tool when appropriate.",
    );
  }

  const output = [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${baseUrl}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    ...(extraSections.length > 0 ? ["", ...extraSections] : []),
    "",
    "<skill_files>",
    fileList,
    "</skill_files>",
    "</skill_content>",
  ].join("\n");

  return [
    {
      name: `Loaded skill: ${skill.name}`,
      description: skill.description,
      content: output,
    },
  ];
};
