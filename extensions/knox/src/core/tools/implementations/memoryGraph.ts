import { BrainManager } from "../../context/memory/brain/BrainManager.js";
import type { MemoryGraphAction } from "../../context/memory/brain/types.js";
import {
  isMemoryReadAction,
  memoryWriteBlockedMessage,
} from "../../context/soul/memoryAccess.js";

import { ToolImpl } from ".";

const VALID_ACTIONS: Set<string> = new Set([
  "add_entity",
  "search_entities",
  "add_edge",
  "explore_graph",
  "get_graph_stats",
  "extract_entities",
  "llm_extract_entities",
]);

export const memoryGraphImpl: ToolImpl = async (args, extras) => {
  const action = args.action as MemoryGraphAction;

  if (!action || !VALID_ACTIONS.has(action)) {
    return [
      {
        name: "Memory Graph",
        description: "Memory Graph Error",
        content: `Missing or invalid action. Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
      },
    ];
  }

  if (extras.soul?.readonlyMemory && !isMemoryReadAction(action)) {
    return [
      {
        name: "Memory Graph",
        description: "Memory Graph Error",
        content: memoryWriteBlockedMessage(action),
      },
    ];
  }

  if (extras.llm) {
    BrainManager.setLlm(extras.llm);
  }

  try {
    const result = await BrainManager.dispatch(action, args);
    return [
      {
        name: "Memory Graph",
        description: `Memory Graph — ${action}`,
        content: result,
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "Memory Graph",
        description: "Memory Graph Error",
        content: `Error executing graph action "${action}": ${message}`,
      },
    ];
  }
};
