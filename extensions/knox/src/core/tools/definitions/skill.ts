import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME } from "../builtIn";

/**
 * Tool name constant — matches the enum pattern used by other built-in tools.
 */
export const SKILL_TOOL_NAME = "builtin_skill";

/**
 * Tool definition for the skill tool.
 *
 * The description is dynamically populated at runtime by the
 * `getSkillToolDescription()` function (injected in `llmStreamChat`)
 * based on the currently available skills.
 * This static definition is the fallback when no skills are loaded.
 */
export const skillTool: Tool = {
  type: "function",
  displayTitle: "Load Skill",
  wouldLikeTo: 'load skill "{{{ name }}}"',
  isCurrently: 'loading skill "{{{ name }}}"',
  hasAlready: 'loaded skill "{{{ name }}}"',
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: SKILL_TOOL_NAME,
    description:
      "Load a specialized skill that provides domain-specific instructions and workflows. " +
      "When you recognize that a task matches one of the available skills, use this tool " +
      "to load the full skill instructions into the conversation context. " +
      "The skill will inject detailed instructions, workflows, and access to bundled " +
      "resources (scripts, references, templates). " +
      'Tool output includes a `<skill_content name="...">` block with the loaded content.',
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description:
            "The name of the skill to load. Must match one of the available skills " +
            "listed in the tool description's <available_skills> block.",
        },
      },
    },
  },
};
