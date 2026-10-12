/** Memory Brain types: actions. Re-exported from ../types.ts. */

// ── Core Memory Types ────────────────────────────────────────────────────────

export type MemoryBrainAction =
  | "store"
  | "recall"
  | "search"
  | "summarize_session"
  | "list_sessions"
  | "get_session"
  | "close_session"
  | "delete"
  | "mismatch"
  | "get_stats"
  | "consolidate"
  | "associate"
  // Knowledge Graph actions
  | "add_entity"
  | "search_entities"
  | "add_edge"
  | "explore_graph"
  | "get_graph_stats"
  | "extract_entities"
  // Learning Pattern actions
  | "learn_pattern"
  | "suggest_approach"
  | "get_patterns"
  // Procedural Memory actions
  | "store_procedure"
  | "get_procedures"
  | "execute_procedure"
  // Auto-memory actions
  | "auto_extract"
  // Context actions
  | "build_context"
  | "run_pipeline"
  | "get_phase_status"
  | "get_effective_context"
  // Tagging actions
  | "tag"
  | "untag"
  | "search_by_tag"
  // Collection actions
  | "create_collection"
  | "list_collections"
  | "add_to_collection"
  // Import/Export
  | "export"
  | "import"
  // Self-management
  | "get_health"
  | "optimize"
  | "get_config"
  | "update_config"
  // Cross-session backlog search
  | "search_backlogs"
  // LLM-enhanced actions
  | "llm_extract_entities"
  | "llm_summarize_session"
  | "llm_evaluate_importance"
  | "llm_post_action_memory"
  // Checkpoint/rollback
  | "create_checkpoint"
  | "list_checkpoints"
  | "rollback_checkpoint"
  | "delete_checkpoint"
  // Audit trail
  | "get_audit_log"
  // Session topics
  | "get_session_topics"
  // Performance & self-management (Tier B)
  | "get_metrics"
  | "get_health_score"
  | "get_capacity_forecast"
  | "heal"
  | "get_healing_strategies"
  | "get_consolidation_stats"
  // Checkpoint strategies & lifecycle (Tier C)
  | "checkpoint_strategy_config"
  | "update_checkpoint_strategy"
  | "checkpoint_lifecycle_cleanup"
  | "compress_checkpoint"
  | "diff_checkpoint"
  // Event replay & undo (Tier C)
  | "replay_events"
  | "undo_operation"
  | "get_undoable_operations"
  // Batch operations (Tier C)
  | "batch_delete"
  | "batch_store"
  | "batch_audit_log"
  | "batch_update_importance"
  | "batch_move_tier"
  // Related sessions & hierarchy (Tier D)
  | "find_related_sessions"
  | "five_tier_consolidate"
  | "get_tier_distribution"
  | "get_tier_configs"
  | "update_tier_config"
  // Root cause analysis (Tier D)
  | "root_cause_analysis"
  // Spaced repetition (Tier D)
  | "get_review_due"
  | "boost_memory"
  // LRU cache (Tier D)
  | "get_cache_stats"
  | "clear_cache"
  // Metrics storage (Tier D)
  | "store_metrics_snapshot"
  | "get_metrics_trend";

// ── P1.3 Split-Tool Action Groups ───────────────────────────────────────────

/** Actions for the core memory tool (store/recall/search/context) */
export type MemoryCoreAction =
  | "store"
  | "recall"
  | "search"
  | "delete"
  | "build_context"
  | "auto_extract"
  | "associate"
  | "tag"
  | "untag"
  | "search_by_tag"
  | "create_collection"
  | "list_collections"
  | "add_to_collection"
  | "export"
  | "import"
  | "get_stats"
  | "consolidate";

/** Actions for the knowledge graph tool */
export type MemoryGraphAction =
  | "add_entity"
  | "search_entities"
  | "add_edge"
  | "explore_graph"
  | "get_graph_stats"
  | "extract_entities"
  | "llm_extract_entities";

/** Actions for session management tool */
export type MemorySessionsAction =
  | "list_sessions"
  | "get_session"
  | "close_session"
  | "summarize_session"
  | "search_backlogs"
  | "get_session_topics"
  | "find_related_sessions";

/** Actions for memory maintenance/management tool */
export type MemoryManageAction =
  | "create_checkpoint"
  | "list_checkpoints"
  | "rollback_checkpoint"
  | "delete_checkpoint"
  | "checkpoint_strategy_config"
  | "update_checkpoint_strategy"
  | "checkpoint_lifecycle_cleanup"
  | "compress_checkpoint"
  | "diff_checkpoint"
  | "replay_events"
  | "undo_operation"
  | "get_undoable_operations"
  | "batch_delete"
  | "batch_store"
  | "batch_audit_log"
  | "batch_update_importance"
  | "batch_move_tier"
  | "five_tier_consolidate"
  | "get_tier_distribution"
  | "get_tier_configs"
  | "update_tier_config"
  | "root_cause_analysis"
  | "get_audit_log"
  | "get_health"
  | "optimize"
  | "get_config"
  | "update_config"
  | "get_metrics"
  | "get_health_score"
  | "get_capacity_forecast"
  | "heal"
  | "get_healing_strategies"
  | "get_consolidation_stats"
  | "get_cache_stats"
  | "clear_cache"
  | "store_metrics_snapshot"
  | "get_metrics_trend"
  | "run_pipeline"
  | "get_effective_context"
  | "get_phase_status";

/** Actions for the learning engine tool */
export type MemoryLearnAction =
  | "learn_pattern"
  | "suggest_approach"
  | "get_patterns"
  | "store_procedure"
  | "get_procedures"
  | "execute_procedure"
  | "get_review_due"
  | "boost_memory"
  | "llm_evaluate_importance"
  | "llm_summarize_session"
  | "llm_post_action_memory";
