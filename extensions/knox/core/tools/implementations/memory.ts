import { BrainManager } from "../../context/memory/brain/BrainManager.js";
import type { MemoryBrainAction } from "../../context/memory/brain/types.js";
import {
  isMemoryReadAction,
  memoryWriteBlockedMessage,
} from "../../context/soul/memoryAccess.js";

import { ToolImpl } from ".";

export const memoryImpl: ToolImpl = async (args, extras) => {
  const action: MemoryBrainAction = args.action;

  if (extras.soul?.readonlyMemory && action && !isMemoryReadAction(action)) {
    return [
      {
        name: "Memory",
        description: "Memory Brain Error",
        content: memoryWriteBlockedMessage(action),
      },
    ];
  }

  if (!action) {
    return [
      {
        name: "Memory",
        description: "Memory Brain Error",
        content: 'Missing required parameter: "action". Use get_stats to see all 79 available actions, or see the tool description for the full list.',
      },
    ];
  }

  // Pass LLM to BrainManager for LLM-enhanced features
  if (extras.llm) {
    BrainManager.setLlm(extras.llm);
  }

  try {
    const dispatchArgs =
      action === "run_pipeline" && args.pipeline_mode
        ? { ...args, mode: args.pipeline_mode }
        : args;
    const result = await BrainManager.dispatch(action, dispatchArgs);
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
