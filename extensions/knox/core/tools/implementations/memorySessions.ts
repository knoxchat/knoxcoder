import { BrainManager } from "../../context/memory/brain/BrainManager.js";
import type { MemorySessionsAction } from "../../context/memory/brain/types.js";
import {
  isMemoryReadAction,
  memoryWriteBlockedMessage,
} from "../../context/soul/memoryAccess.js";

import { ToolImpl } from ".";

const VALID_ACTIONS: Set<string> = new Set([
  "list_sessions",
  "get_session",
  "close_session",
  "summarize_session",
  "search_backlogs",
  "get_session_topics",
  "find_related_sessions",
]);

export const memorySessionsImpl: ToolImpl = async (args, extras) => {
  const action = args.action as MemorySessionsAction;

  if (!action || !VALID_ACTIONS.has(action)) {
    return [
      {
        name: "Memory Sessions",
        description: "Memory Sessions Error",
        content: `Missing or invalid action. Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
      },
    ];
  }

  if (extras.soul?.readonlyMemory && !isMemoryReadAction(action)) {
    return [
      {
        name: "Memory Sessions",
        description: "Memory Sessions Error",
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
        name: "Memory Sessions",
        description: `Memory Sessions — ${action}`,
        content: result,
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "Memory Sessions",
        description: "Memory Sessions Error",
        content: `Error executing session action "${action}": ${message}`,
      },
    ];
  }
};
