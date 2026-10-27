import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const RECIPE_PRODUCT_ACTIONS = ["list", "preview", "apply", "import_skill"] as const;
export type RecipeProductAction = (typeof RECIPE_PRODUCT_ACTIONS)[number];

export const recipeTool: Tool = {
  type: "function",
  displayTitle: "Recipe",
  wouldLikeTo: "{{{ action }}} a verified recipe",
  isCurrently: "using a verified recipe",
  hasAlready: "used a verified recipe",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Recipe,
    description:
      "List, preview, or apply a verified recipe (replayable procedure). Apply needs confirm=true and uses the recipe replayer, permissions, and ask card — never rewrite those files yourself. import_skill parses a SKILL.md into a candidate (not replayable until verified locally).",
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [...RECIPE_PRODUCT_ACTIONS],
          description: "list / preview / apply / import_skill",
        },
        query: {
          type: "string",
          description: "[list] Filter by title, intent, or path",
        },
        recipe_id: {
          type: "string",
          description: "[preview/apply] Recipe id from list",
        },
        confirm: {
          type: "boolean",
          description:
            "[apply] Must be true to run the replayer. Omit or false returns a preview and does not write.",
        },
        slot_values: {
          type: "object",
          description: "[preview/apply] Slot name → value for parameterized exact",
          additionalProperties: { type: "string" },
        },
        skill_path: {
          type: "string",
          description: "[import_skill] Workspace path to SKILL.md",
        },
        skill_content: {
          type: "string",
          description: "[import_skill] Raw SKILL.md text when not reading a file",
        },
      },
    },
  },
};
