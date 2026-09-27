import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const memoryTool: Tool = {
  type: "function",
  displayTitle: "Memory",
  wouldLikeTo: "access the memory brain",
  isCurrently: "accessing memory brain",
  hasAlready: "accessed memory brain",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Memory,
    description: `Core persistent memory system — store, recall, search, and organize knowledge across ALL sessions.

For specialized operations, prefer the dedicated sub-tools:
- **builtin_memory_graph** — Knowledge graph (entities, edges, traversal)
- **builtin_memory_sessions** — Session management (list, close, search backlogs)
- **builtin_memory_manage** — Maintenance (checkpoints, healing, batch ops, config)
- **builtin_memory_learn** — Learning engine (patterns, procedures, spaced repetition)

**Core Memory:**
- **store**: Save facts, decisions, code patterns, preferences, or any knowledge
- **recall**: Retrieve relevant memories (semantic + episodic + associations) using multi-strategy fusion search
- **search**: Search stored knowledge by query and optional category
- **delete**: Remove a specific memory by ID
- **build_context**: Build token-budgeted context from ALL memory types for any query

**Auto-Memory:**
- **auto_extract**: Extract memories and entities from text automatically

**Organization:**
- **associate**: Create a link between two memories
- **tag** / **untag** / **search_by_tag**: Tag-based organization
- **create_collection** / **list_collections** / **add_to_collection**: Collections

**Maintenance:**
- **get_stats**: Comprehensive brain statistics
- **consolidate**: Run memory tiering (hot→warm→cold)
- **export** / **import**: Backup & restore

IMPORTANT: Use "store" proactively to save useful context. Use "recall" or "build_context" at the start of new conversations.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "store",
            "recall",
            "search",
            "summarize_session",
            "list_sessions",
            "get_session",
            "close_session",
            "delete",
            "get_stats",
            "consolidate",
            "associate",
            "add_entity",
            "search_entities",
            "add_edge",
            "explore_graph",
            "get_graph_stats",
            "extract_entities",
            "learn_pattern",
            "suggest_approach",
            "get_patterns",
            "store_procedure",
            "get_procedures",
            "execute_procedure",
            "auto_extract",
            "build_context",
            "run_pipeline",
            "get_effective_context",
            "get_phase_status",
            "tag",
            "untag",
            "search_by_tag",
            "create_collection",
            "list_collections",
            "add_to_collection",
            "export",
            "import",
            "get_health",
            "optimize",
            "get_config",
            "update_config",
            "search_backlogs",
            "llm_extract_entities",
            "llm_summarize_session",
            "llm_evaluate_importance",
            "llm_post_action_memory",
            "create_checkpoint",
            "list_checkpoints",
            "rollback_checkpoint",
            "delete_checkpoint",
            "get_audit_log",
            "get_session_topics",
            // ── Performance & Self-Management (Tier B) ──
            "get_metrics",
            "get_health_score",
            "get_capacity_forecast",
            "heal",
            "get_healing_strategies",
            "get_consolidation_stats",
            // ── Checkpoint Strategies & Lifecycle (Tier C) ──
            "checkpoint_strategy_config",
            "update_checkpoint_strategy",
            "checkpoint_lifecycle_cleanup",
            "compress_checkpoint",
            "diff_checkpoint",
            // ── Event Replay & Undo (Tier C) ──
            "replay_events",
            "undo_operation",
            "get_undoable_operations",
            // ── Batch Operations (Tier C) ──
            "batch_delete",
            "batch_store",
            "batch_audit_log",
            "batch_update_importance",
            "batch_move_tier",
            // ── Related Sessions & Hierarchy (Tier D) ──
            "find_related_sessions",
            "five_tier_consolidate",
            "get_tier_distribution",
            "get_tier_configs",
            "update_tier_config",
            // ── Root Cause Analysis (Tier D) ──
            "root_cause_analysis",
            // ── Spaced Repetition (Tier D) ──
            "get_review_due",
            "boost_memory",
            // ── LRU Cache (Tier D) ──
            "get_cache_stats",
            "clear_cache",
            // ── Metrics Storage (Tier D) ──
            "store_metrics_snapshot",
            "get_metrics_trend",
          ],
          description: "The memory operation to perform",
        },
        // ── Store params ──
        category: {
          type: "string",
          enum: ["fact", "preference", "decision", "summary", "insight", "code_pattern", "error_fix", "project_context", "workflow"],
          description: "[store] Category of the memory",
        },
        title: {
          type: "string",
          description: "[store] Short title for the memory",
        },
        content: {
          type: "string",
          description: "[store/auto_extract/extract_entities] Content text",
        },
        keywords: {
          type: "string",
          description: "[store] Comma-separated keywords for search indexing",
        },
        importance: {
          type: "number",
          description: "[store] Importance score 0.0–1.0 (default: 0.5)",
        },
        ttl_days: {
          type: "number",
          description: "[store] Time-to-live in days (null = permanent)",
        },
        // ── Recall/search params ──
        query: {
          type: "string",
          description: "[recall/search/search_entities/suggest_approach/build_context] Search query text",
        },
        include_episodic: {
          type: "boolean",
          description: "[recall] Whether to include past conversation snippets (default: true)",
        },
        // ── Session params ──
        session_id: {
          type: "string",
          description: "[summarize_session/get_session/recall/build_context/auto_extract] Session ID",
        },
        // ── Delete params ──
        id: {
          type: "number",
          description: "[delete/execute_procedure/explore_graph] Memory/entity/procedure ID",
        },
        // ── Association params ──
        source_type: {
          type: "string",
          enum: ["episodic", "semantic"],
          description: "[associate] Source memory type",
        },
        source_id: {
          type: "number",
          description: "[associate] Source memory ID",
        },
        target_type: {
          type: "string",
          enum: ["episodic", "semantic", "entity", "procedure"],
          description: "[associate/batch_delete/batch_move_tier] Target memory type",
        },
        target_id: {
          type: "number",
          description: "[associate] Target memory ID",
        },
        relationship: {
          type: "string",
          description: "[associate/add_edge] Relationship label",
        },
        strength: {
          type: "number",
          description: "[associate] Association strength 0.0–1.0 (default: 0.5)",
        },
        // ── Knowledge Graph params ──
        name: {
          type: "string",
          description: "[add_entity/store_procedure/create_collection] Name",
        },
        entity_type: {
          type: "string",
          enum: ["person", "organization", "technology", "concept", "project", "file", "function", "class", "variable", "location", "event", "product", "custom"],
          description: "[add_entity/search_entities] Entity type",
        },
        description: {
          type: "string",
          description: "[add_entity/store_procedure/create_collection] Description",
        },
        entity_id: {
          type: "number",
          description: "[explore_graph] Starting entity ID for graph traversal",
        },
        source_entity_id: {
          type: "number",
          description: "[add_edge] Source entity ID",
        },
        target_entity_id: {
          type: "number",
          description: "[add_edge] Target entity ID",
        },
        depth: {
          type: "number",
          description: "[explore_graph] Traversal depth (default: 2)",
        },
        weight: {
          type: "number",
          description: "[add_edge] Edge weight 0.0–1.0 (default: 0.5)",
        },
        // ── Learning params ──
        goal_type: {
          type: "string",
          enum: ["coding", "analysis", "research", "creative", "debugging", "documentation", "explanation", "planning", "conversation", "other"],
          description: "[learn_pattern/suggest_approach/get_patterns] Goal classification",
        },
        pattern_signature: {
          type: "string",
          description: "[learn_pattern] Short signature for the pattern",
        },
        success: {
          type: "boolean",
          description: "[learn_pattern/execute_procedure] Whether the outcome was successful",
        },
        tokens_used: {
          type: "number",
          description: "[learn_pattern] Tokens consumed during this pattern",
        },
        // ── Procedure params ──
        steps: {
          type: "array",
          items: { type: "string" },
          description: "[store_procedure] Ordered list of procedure steps",
        },
        trigger_pattern: {
          type: "string",
          description: "[store_procedure] Pattern that triggers this procedure",
        },
        // ── Tag params ──
        memory_type: {
          type: "string",
          enum: ["semantic", "episodic", "entity", "procedure"],
          description: "[tag/untag/search_by_tag/add_to_collection] Memory type",
        },
        memory_id: {
          type: "number",
          description: "[tag/untag/add_to_collection/boost_memory] Memory ID",
        },
        tag: {
          type: "string",
          description: "[tag/untag/search_by_tag] Tag name",
        },
        // ── Collection params ──
        collection_id: {
          type: "number",
          description: "[add_to_collection] Collection ID",
        },
        // ── Context builder / pipeline params ──
        message: {
          type: "string",
          description: "[build_context/run_pipeline] Message to build context for",
        },
        pipeline_mode: {
          type: "string",
          enum: ["pre_turn", "post_turn", "sensory_input", "encoding", "working_memory", "consolidation", "long_term_storage", "retrieval", "sleep_consolidation", "output_generation"],
          description: "[run_pipeline] Pipeline mode or single phase name",
        },
        turn_content: {
          type: "string",
          description: "[run_pipeline post_turn] Combined user+assistant text for extraction",
        },
        goal: {
          type: "string",
          description: "[build_context/run_pipeline] Current task goal (C_goal)",
        },
        max_tokens: {
          type: "number",
          description: "[build_context] Maximum tokens for context (default: 4000)",
        },
        include_graph: {
          type: "boolean",
          description: "[build_context] Include knowledge graph context (default: true)",
        },
        include_procedures: {
          type: "boolean",
          description: "[build_context] Include relevant procedures (default: true)",
        },
        include_patterns: {
          type: "boolean",
          description: "[build_context] Include pattern suggestions (default: true)",
        },
        // ── Config params ──
        key: {
          type: "string",
          description: "[update_config] Configuration key to update",
        },
        value: {
          type: "string",
          description: "[update_config] New value for the configuration key",
        },
        // ── Import params ──
        file_path: {
          type: "string",
          description: "[import] Path to the JSON export file to import",
        },
        // ── Auto-extract params ──
        role: {
          type: "string",
          description: "[auto_extract/llm_evaluate_importance] Role of the message author (user/assistant)",
        },
        text: {
          type: "string",
          description: "[extract_entities/auto_extract/llm_extract_entities] Text to extract from (alias for content)",
        },
        // ── Cross-session backlog search params ──
        session_ids: {
          type: "array",
          items: { type: "string" },
          description: "[search_backlogs] Filter to specific session IDs",
        },
        date_from: {
          type: "string",
          description: "[search_backlogs] Start date filter (ISO 8601 format)",
        },
        date_to: {
          type: "string",
          description: "[search_backlogs] End date filter (ISO 8601 format)",
        },
        roles: {
          type: "array",
          items: { type: "string" },
          description: "[search_backlogs] Filter by message roles (e.g. ['user', 'assistant'])",
        },
        include_semantic: {
          type: "boolean",
          description: "[search_backlogs] Include semantic memories in search (default: true)",
        },
        // ── LLM-enhanced params ──
        detail_level: {
          type: "string",
          enum: ["brief", "detailed"],
          description: "[llm_summarize_session] Level of detail in the summary (default: detailed)",
        },
        context: {
          type: "string",
          description: "[llm_evaluate_importance] Additional context for importance evaluation",
        },
        action_description: {
          type: "string",
          description: "[llm_post_action_memory] Description of the action that was performed",
        },
        action_result: {
          type: "string",
          description: "[llm_post_action_memory] Result of the action performed",
        },
        // ── Checkpoint params ──
        label: {
          type: "string",
          description: "[create_checkpoint] Label for the checkpoint snapshot",
        },
        checkpoint_id: {
          type: "number",
          description: "[rollback_checkpoint/delete_checkpoint] Checkpoint ID",
        },
        // ── Audit trail params ──
        audit_action: {
          type: "string",
          description: "[get_audit_log] Filter by action type (e.g. 'memory:stored', 'entity:added')",
        },
        audit_target_type: {
          type: "string",
          description: "[get_audit_log] Filter by target type (e.g. 'memory', 'session', 'entity')",
        },
        audit_target_id: {
          type: "string",
          description: "[get_audit_log] Filter by target ID",
        },
        // ── Common ──
        limit: {
          type: "number",
          description: "[recall/search/list_sessions/get_session/search_entities/get_patterns/get_procedures/suggest_approach/search_by_tag/list_collections/explore_graph/get_undoable_operations/replay_events/find_related_sessions/get_review_due/batch_audit_log] Maximum results",
        },
        workspace_directory: {
          type: "string",
          description: "[list_sessions] Filter sessions by workspace directory",
        },
        // ── Performance & Self-Management params (Tier B) ──
        window_ms: {
          type: "number",
          description: "[get_metrics/store_metrics_snapshot] Time window in milliseconds for metrics collection",
        },
        weights: {
          type: "object",
          description: "[get_health_score] Custom weights for health score components (e.g. { memory_freshness: 0.3, diversity: 0.2 })",
        },
        // ── Checkpoint strategy params (Tier C) ──
        mode: {
          type: "string",
          enum: ["manual", "time_interval", "adaptive"],
          description: "[update_checkpoint_strategy] Checkpoint strategy mode",
        },
        adaptive_change_threshold: {
          type: "number",
          description: "[update_checkpoint_strategy] Number of changes before auto-checkpoint in adaptive mode",
        },
        time_interval_minutes: {
          type: "number",
          description: "[update_checkpoint_strategy] Minutes between auto-checkpoints in time_interval mode",
        },
        max_checkpoints: {
          type: "number",
          description: "[update_checkpoint_strategy] Maximum number of checkpoints to retain",
        },
        max_age_days: {
          type: "number",
          description: "[update_checkpoint_strategy] Maximum age in days before checkpoint cleanup",
        },
        max_total_size_mb: {
          type: "number",
          description: "[update_checkpoint_strategy] Maximum total size of all checkpoint snapshots in MB",
        },
        compress_snapshots: {
          type: "boolean",
          description: "[update_checkpoint_strategy] Whether to compress checkpoint snapshots",
        },
        // ── Event replay params (Tier C) ──
        from: {
          type: "string",
          description: "[replay_events] Start timestamp (ISO 8601) for event replay range",
        },
        to: {
          type: "string",
          description: "[replay_events] End timestamp (ISO 8601) for event replay range",
        },
        action_filter: {
          type: "string",
          description: "[replay_events] Filter replayed events by action type",
        },
        target_type_filter: {
          type: "string",
          description: "[replay_events] Filter replayed events by target type",
        },
        // ── Undo params (Tier C) ──
        audit_entry_id: {
          type: "number",
          description: "[undo_operation] Audit trail entry ID of the operation to undo",
        },
        // ── Batch params (Tier C) ──
        ids: {
          type: "array",
          items: { type: "number" },
          description: "[batch_delete/batch_move_tier] Array of memory IDs",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              title: { type: "string" },
              content: { type: "string" },
              keywords: { type: "string" },
              importance: { type: "number" },
            },
          },
          description: "[batch_store] Array of memory objects to store (StoreInput format)",
        },
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              importance: { type: "number" },
            },
          },
          description: "[batch_update_importance] Array of { id, importance } updates",
        },
        tier: {
          type: "string",
          enum: ["active", "hot", "warm", "cold", "frozen"],
          description: "[batch_move_tier/update_tier_config] Target tier name",
        },
        // ── Batch audit params (Tier C) ──
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string" },
              target_type: { type: "string" },
              target_id: { type: "number" },
              details: { type: "object" },
            },
          },
          description: "[batch_audit_log] Array of audit events to log",
        },
        // ── Tier config params (Tier D) ──
        max_age_hours: {
          type: "number",
          description: "[update_tier_config] Maximum memory age in hours for this tier",
        },
        importance_threshold: {
          type: "number",
          description: "[update_tier_config] Minimum importance score for this tier",
        },
        retrieval_threshold: {
          type: "number",
          description: "[update_tier_config] Minimum retrieval count for this tier",
        },
        compress: {
          type: "boolean",
          description: "[update_tier_config] Whether to compress memories in this tier",
        },
        // ── Spaced repetition params (Tier D) ──
        retention_threshold: {
          type: "number",
          description: "[get_review_due] Retention score threshold below which memories are due for review (default: 0.5)",
        },
        // ── Metrics trend params (Tier D) ──
        hours: {
          type: "number",
          description: "[get_metrics_trend] Number of hours to look back for metrics trend",
        },
      },
    },
  },
};
