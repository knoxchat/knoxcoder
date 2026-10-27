import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../..";
import { BaseContextProvider } from "../index.js";

/**
 * @recipe — attach a verified procedure to the turn without hoping the matcher fires.
 */
class RecipeContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "recipe",
    displayTitle: "Recipe",
    description: "Attach a verified recipe (replayable procedure) to this turn",
    type: "submenu",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    if (typeof extras.ide.recipeControl !== "function") {
      return [
        {
          name: "Recipes",
          description: "unavailable",
          content: "Recipes are only available in the VS Code host.",
        },
      ];
    }
    const byId = query.trim() && /^[a-f0-9]{12,64}$/i.test(query.trim());
    const result = await extras.ide.recipeControl(
      byId
        ? { op: "preview", recipeId: query.trim() }
        : { op: "list", query, limit: 8 },
    );
    const title = byId
      ? result.title || `Recipe ${query.trim().slice(0, 8)}`
      : query.trim()
        ? `Recipes matching "${query.trim()}"`
        : "Recipes";
    return [
      {
        name: title,
        description: result.status,
        content: result.content,
      },
    ];
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    if (typeof args.ide.recipeControl !== "function") return [];
    const result = await args.ide.recipeControl({ op: "list", limit: 20 });
    return (result.recipes ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: `${row.status} · ${row.files} file(s)${row.slots.length ? ` · slots ${row.slots.join(", ")}` : ""}`,
    }));
  }
}

export default RecipeContextProvider;
