/**
 * Utility to build a dynamic tool description that lists available skills.
 *
 * Called from the tool implementation at runtime so the LLM knows which
 * skills it can load. Matches opencode's XML-based description format.
 */

import { pathToFileURL } from "url";

import { SkillInfo } from "./types";

/**
 * Build the full skill tool description including the list of available skills.
 * If no skills are available, returns a simple message saying so.
 */
export function buildSkillToolDescription(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return (
      "Load a specialized skill that provides domain-specific instructions and workflows. " +
      "No skills are currently available."
    );
  }

  const skillList = skills
    .map(
      (s) =>
        `  <skill>\n` +
        `    <name>${s.name}</name>\n` +
        `    <description>${s.description}</description>\n` +
        `    <location>${pathToFileURL(s.location).href}</location>\n` +
        `  </skill>`,
    )
    .join("\n");

  // Build example hints like opencode does: e.g., (e.g., 'skill1', 'skill2', ...)
  const examples = skills
    .map((s) => `'${s.name}'`)
    .slice(0, 3)
    .join(", ");
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : "";

  return [
    "Load a specialized skill that provides domain-specific instructions and workflows.",
    "",
    "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
    "",
    "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
    "",
    'Tool output includes a `<skill_content name="...">` block with the loaded content.',
    "",
    `The following skills provide specialized sets of instructions for particular tasks${hint}.`,
    "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
    "",
    "<available_skills>",
    skillList,
    "</available_skills>",
  ].join("\n");
}
