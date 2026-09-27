const MEMORY_READONLY_ACTIONS = new Set<string>([
  "recall",
  "search",
  "build_context",
  "get_stats",
  "search_by_tag",
  "list_collections",
  "get_health_score",
  "get_audit_log",
  "list_checkpoints",
  "diff_checkpoint",
  "checkpoint_strategy_config",
  "search_entities",
  "explore_graph",
  "get_graph_stats",
  "list_sessions",
  "get_session",
  "search_backlogs",
  "get_session_topics",
  "find_related_sessions",
]);

export function isMemoryReadAction(action: string | undefined): boolean {
  return typeof action === "string" && MEMORY_READONLY_ACTIONS.has(action);
}

export function memoryWriteBlockedMessage(action: string): string {
  return `Memory action "${action}" writes the brain. This child agent may only recall, search, or build_context.`;
}
