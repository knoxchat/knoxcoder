import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../..";
import { BaseContextProvider } from "../index.js";
import { MemoryManager } from "../memory/MemoryManager.js";

import type { MemoryCategory } from "../memory/types.js";

/**
 * Context provider that retrieves relevant project memories.
 * Usage: @memory <query> — searches stored memories for relevant facts,
 * conventions, fix patterns, and user notes.
 */
class ProjectMemoryContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "memory",
    displayTitle: "Project Memory",
    description:
      "Search stored project memories — conventions, fix patterns, and learnings",
    type: "query",
  };

  async getContextItems(
    query: string,
    _extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    if (!query || query.trim().length === 0) {
      // Return recent memories when no query
      const recent = await MemoryManager.listAll(5);
      return recent.map((mem) => ({
        name: `Memory: ${mem.title}`,
        description: `[${mem.category}] ${mem.title}`,
        content: `# ${mem.title}\n\nCategory: ${mem.category}\nSource: ${mem.source}\n\n${mem.content}`,
      }));
    }

    // Detect category filter prefix (e.g., "convention: naming" or "fix: import error")
    let category: MemoryCategory | undefined;
    let searchQuery = query;
    const prefixMatch = query.match(
      /^(convention|fix-pattern|project-fact|user-note):\s*/i,
    );
    if (prefixMatch) {
      category = prefixMatch[1].toLowerCase() as MemoryCategory;
      searchQuery = query.slice(prefixMatch[0].length);
    }

    const results = await MemoryManager.recall({
      query: searchQuery,
      category,
      limit: 8,
    });

    return results.map((mem) => ({
      name: `Memory: ${mem.title}`,
      description: `[${mem.category}] ${mem.title}`,
      content: `# ${mem.title}\n\nCategory: ${mem.category}\nSource: ${mem.source}\nRelevance: ${Math.round(mem.relevanceScore * 100)}%\n\n${mem.content}`,
    }));
  }

  async loadSubmenuItems(
    _args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const memories = await MemoryManager.listAll(20);
    return memories.map((mem) => ({
      id: String(mem.id),
      title: mem.title,
      description: `[${mem.category}] ${mem.content.substring(0, 80)}`,
    }));
  }
}

export default ProjectMemoryContextProvider;
