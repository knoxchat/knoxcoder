import { BrainManager } from "../../context/memory/brain/BrainManager.js";
import {
  isMemoryReadAction,
  memoryWriteBlockedMessage,
} from "../../context/soul/memoryAccess.js";
import {
  MEMORY_PRODUCT_ACTION_LIST,
  MEMORY_PRODUCT_ACTIONS,
  type MemoryProductAction,
} from "../definitions/memory.js";

import { ToolImpl } from ".";

const PRODUCT_ACTIONS = new Set<string>(MEMORY_PRODUCT_ACTIONS);

function isProductMemoryAction(action: string): action is MemoryProductAction {
  return PRODUCT_ACTIONS.has(action);
}

export const memoryImpl: ToolImpl = async (args, extras) => {
  const action = typeof args.action === "string" ? args.action : "";

  if (!action) {
    return [
      {
        name: "Memory",
        description: "Memory Brain Error",
        content:
          `Missing required parameter: "action". Product actions: ${MEMORY_PRODUCT_ACTION_LIST}.`,
      },
    ];
  }

  if (!isProductMemoryAction(action)) {
    return [
      {
        name: "Memory",
        description: "Memory Brain Error",
        content: `Action "${action}" is not available on builtin_memory. Use ${MEMORY_PRODUCT_ACTION_LIST}. Admin stays on brain/* host handlers.`,
      },
    ];
  }

  if (extras.soul?.readonlyMemory && !isMemoryReadAction(action)) {
    return [
      {
        name: "Memory",
        description: "Memory Brain Error",
        content: memoryWriteBlockedMessage(action),
      },
    ];
  }

  // Pass LLM to BrainManager for LLM-enhanced features
  if (extras.llm) {
    BrainManager.setLlm(extras.llm);
  }

  // MEM-16: recall / search / build_context are retrieve-not-used.
  // They must not call SpacedRepetition.boostOnRetrieval or write S / I.

  try {
    const result = await BrainManager.dispatch(action, args);
    return [
      {
        name: "Memory",
        description: `Memory Brain — ${action}`,
        content: result,
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "Memory",
        description: "Memory Brain Error",
        content: `Error executing memory action "${action}": ${message}`,
      },
    ];
  }
};
