import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const memorySessionsTool: Tool = {
  type: "function",
  displayTitle: "Memory Sessions",
  wouldLikeTo: "manage memory sessions",
  isCurrently: "managing sessions",
  hasAlready: "managed sessions",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.MemorySessions,
    description: `Session management for the Memory Brain — list, inspect, summarize, close, and search across sessions.

**Session Lifecycle:**
- **list_sessions**: List all tracked conversation sessions (optionally filter by workspace)
- **get_session**: Get details and conversation history of a specific session
- **close_session**: Close a session (marks inactive), auto-summarizes with LLM
- **summarize_session**: Generate and store a summary for a session

**Cross-Session Search:**
- **search_backlogs**: Search across ALL sessions for matching conversations and knowledge, with date range, role, and session ID filters

**Session Analysis:**
- **get_session_topics**: View auto-detected topic shifts within a session
- **find_related_sessions**: Find sessions related to a given session by shared entities, topics, and keywords

Use list_sessions at the start of a conversation to see available history. Use search_backlogs to find past discussions.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "list_sessions",
            "get_session",
            "close_session",
            "summarize_session",
            "search_backlogs",
            "get_session_topics",
            "find_related_sessions",
          ],
          description: "The session operation to perform",
        },
        session_id: {
          type: "string",
          description: "[get_session/close_session/summarize_session/get_session_topics/find_related_sessions] Session ID",
        },
        query: {
          type: "string",
          description: "[search_backlogs] Search query",
        },
        session_ids: {
          type: "array",
          items: { type: "string" },
          description: "[search_backlogs] Filter to specific session IDs",
        },
        date_from: {
          type: "string",
          description: "[search_backlogs] Start date filter (ISO 8601)",
        },
        date_to: {
          type: "string",
          description: "[search_backlogs] End date filter (ISO 8601)",
        },
        roles: {
          type: "array",
          items: { type: "string" },
          description: "[search_backlogs] Filter by message roles",
        },
        include_semantic: {
          type: "boolean",
          description: "[search_backlogs] Include semantic memories in search (default: true)",
        },
        include_episodic: {
          type: "boolean",
          description: "[search_backlogs] Include episodic memories in search",
        },
        limit: {
          type: "number",
          description: "[list_sessions/get_session/search_backlogs/find_related_sessions] Maximum results",
        },
        workspace_directory: {
          type: "string",
          description: "[list_sessions] Filter sessions by workspace directory",
        },
      },
    },
  },
};
