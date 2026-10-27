import { ToolImpl } from ".";
import { BuiltInToolNames } from "../builtIn";
import { RECIPE_PRODUCT_ACTIONS, type RecipeProductAction } from "../definitions/recipe";

const ACTIONS = new Set<string>(RECIPE_PRODUCT_ACTIONS);

function asRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

export const recipeImpl: ToolImpl = async (args, extras) => {
  const action = typeof args.action === "string" ? args.action.trim() : "";
  if (!action) {
    return [
      {
        name: "Recipe",
        description: "Recipe Error",
        content:
          'Missing required parameter: "action". Use list, preview, apply, or import_skill.',
      },
    ];
  }
  if (!ACTIONS.has(action)) {
    return [
      {
        name: "Recipe",
        description: "Recipe Error",
        content: `Action "${action}" is not available on ${BuiltInToolNames.Recipe}. Use list, preview, apply, or import_skill.`,
      },
    ];
  }
  if (typeof extras.ide.recipeControl !== "function") {
    return [
      {
        name: "Recipe",
        description: "unavailable",
        content: "Recipes are only available in the VS Code host.",
      },
    ];
  }
  const result = await extras.ide.recipeControl({
    op: action as RecipeProductAction,
    query: typeof args.query === "string" ? args.query : undefined,
    recipeId: typeof args.recipe_id === "string" ? args.recipe_id.trim() : undefined,
    confirm: args.confirm === true,
    slotValues: asRecord(args.slot_values),
    skillPath: typeof args.skill_path === "string" ? args.skill_path : undefined,
    skillContent: typeof args.skill_content === "string" ? args.skill_content : undefined,
  });
  return [
    {
      name: "Recipe",
      description: result.status,
      content: result.content,
    },
  ];
};
