import { BrainManager } from "../../context/memory/brain/BrainManager.js";
import type { MemoryLearnAction } from "../../context/memory/brain/types.js";

import { ToolImpl } from ".";

const VALID_ACTIONS: Set<string> = new Set([
  "learn_pattern",
  "suggest_approach",
  "get_patterns",
  "store_procedure",
  "get_procedures",
  "execute_procedure",
  "get_review_due",
  "boost_memory",
  "llm_evaluate_importance",
  "llm_summarize_session",
  "llm_post_action_memory",
]);

export const memoryLearnImpl: ToolImpl = async (args, extras) => {
  const action = args.action as MemoryLearnAction;

  if (!action || !VALID_ACTIONS.has(action)) {
    return [
      {
        name: "Memory Learn",
        description: "Memory Learn Error",
        content: `Missing or invalid action. Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
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
        name: "Memory Learn",
        description: `Memory Learn — ${action}`,
        content: result,
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "Memory Learn",
        description: "Memory Learn Error",
        content: `Error executing learn action "${action}": ${message}`,
      },
    ];
  }
};
