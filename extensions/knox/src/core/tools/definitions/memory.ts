import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

/** Product `action` enum advertised to the model (K-070). Admin actions stay on `callTool`. */
export const MEMORY_PRODUCT_ACTIONS = [
  "store",
  "recall",
  "search",
  "delete",
  "build_context",
  "pin",
  "unpin",
] as const;

export type MemoryProductAction = (typeof MEMORY_PRODUCT_ACTIONS)[number];

export const memoryTool: Tool = {
  type: "function",
  displayTitle: "Memory",
  wouldLikeTo: "use durable memory",
  isCurrently: "using durable memory",
  hasAlready: "used durable memory",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Memory,
    description:
      "Durable facts and decisions only; do not store file contents. Actions: store, recall, search, delete, build_context, pin, unpin.",
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [...MEMORY_PRODUCT_ACTIONS],
          description:
            "store / recall / search / delete / build_context / pin / unpin",
        },
        category: {
          type: "string",
          enum: [
            "fact",
            "preference",
            "decision",
            "summary",
            "insight",
            "code_pattern",
            "error_fix",
            "project_context",
            "workflow",
          ],
          description: "[store] Category of the memory",
        },
        title: {
          type: "string",
          description: "[store] Short title",
        },
        content: {
          type: "string",
          description: "[store] Fact or decision text — not file contents",
        },
        keywords: {
          type: "string",
          description: "[store] Comma-separated keywords",
        },
        importance: {
          type: "number",
          description: "[store] 0.0–1.0 (default 0.5)",
        },
        ttl_days: {
          type: "number",
          description: "[store] Days to keep (omit = permanent)",
        },
        query: {
          type: "string",
          description: "[recall/search/build_context] Query text",
        },
        include_episodic: {
          type: "boolean",
          description: "[recall] Include conversation snippets (default true)",
        },
        session_id: {
          type: "string",
          description: "[recall/build_context] Session id",
        },
        id: {
          type: "number",
          description: "[delete/pin/unpin] Memory id",
        },
        memory_id: {
          type: "number",
          description: "[pin/unpin] Alias for id",
        },
        limit: {
          type: "number",
          description: "[recall/search/build_context] Max results",
        },
      },
    },
  },
};
