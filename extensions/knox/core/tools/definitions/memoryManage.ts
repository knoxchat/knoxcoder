import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const memoryManageTool: Tool = {
  type: "function",
  displayTitle: "Memory Manage",
  wouldLikeTo: "manage memory system",
  isCurrently: "managing memory system",
  hasAlready: "managed memory system",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.MemoryManage,
    description: `Maintenance, monitoring, and system management for the Memory Brain.

**Health & Metrics:**
- **get_health**: Check brain health status with recommendations
- **get_health_score**: Numerical health score with weighted components
- **get_metrics**: Performance metrics (durations, success rates) for a time window
- **get_capacity_forecast**: Forecast when memory will reach capacity
- **get_consolidation_stats**: Tier consolidation statistics

**Self-Healing:**
- **heal**: Auto-detect and fix memory issues (orphans, inconsistencies, corruption)
- **get_healing_strategies**: List all available self-healing strategies
- **root_cause_analysis**: Analyze system health and identify root causes of degradation
- **optimize**: Vacuum database, rebuild indexes

**Checkpoints & Rollback:**
- **create_checkpoint**: Snapshot current memory state for later rollback
- **list_checkpoints**: List all saved checkpoints
- **rollback_checkpoint**: Restore memory to a previous checkpoint
- **delete_checkpoint**: Remove a checkpoint and its snapshot file
- **checkpoint_strategy_config**: View checkpoint strategy configuration
- **update_checkpoint_strategy**: Update strategy (mode: manual/time_interval/adaptive)
- **checkpoint_lifecycle_cleanup**: Run cleanup (remove old/excess checkpoints)
- **compress_checkpoint**: Compress a checkpoint snapshot
- **diff_checkpoint**: Show diff between checkpoint and current state

**Event Replay & Undo:**
- **replay_events**: Replay audit events from a time range or checkpoint
- **undo_operation**: Undo a specific operation by audit entry ID
- **get_undoable_operations**: List recent undoable operations

**Batch Operations:**
- **batch_delete**: Delete multiple memories at once
- **batch_store**: Store multiple memories in one operation
- **batch_audit_log**: Retrieve audit events in batch
- **batch_update_importance**: Update importance for multiple memories
- **batch_move_tier**: Move multiple memories to a different tier

**Tier Management:**
- **five_tier_consolidate**: Run full 5-tier hierarchy consolidation
- **get_tier_distribution**: Memory count per tier
- **get_tier_configs**: View tier configurations
- **update_tier_config**: Update tier configuration

**Audit & Config:**
- **get_audit_log**: View audit trail of memory operations
- **get_config**: View memory configuration
- **update_config**: Update a configuration setting

**Cache:**
- **get_cache_stats**: LRU cache statistics
- **clear_cache**: Clear the LRU cache

**Pipeline & Context Metrics:**
- **run_pipeline**: Run 8-phase memory pipeline (pre_turn/post_turn/single phase)
- **get_effective_context**: Local C_effective hierarchy metrics
- **get_phase_status**: Active pipeline phase

**Metrics Storage:**
- **store_metrics_snapshot**: Persist metrics to database
- **get_metrics_trend**: View metrics trends over time

Use create_checkpoint before major changes. Use heal when the system seems degraded. Use root_cause_analysis for deep diagnostics.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "create_checkpoint",
            "list_checkpoints",
            "rollback_checkpoint",
            "delete_checkpoint",
            "checkpoint_strategy_config",
            "update_checkpoint_strategy",
            "checkpoint_lifecycle_cleanup",
            "compress_checkpoint",
            "diff_checkpoint",
            "replay_events",
            "undo_operation",
            "get_undoable_operations",
            "batch_delete",
            "batch_store",
            "batch_audit_log",
            "batch_update_importance",
            "batch_move_tier",
            "five_tier_consolidate",
            "get_tier_distribution",
            "get_tier_configs",
            "update_tier_config",
            "root_cause_analysis",
            "get_audit_log",
            "get_health",
            "optimize",
            "get_config",
            "update_config",
            "get_metrics",
            "get_health_score",
            "get_capacity_forecast",
            "heal",
            "get_healing_strategies",
            "get_consolidation_stats",
            "get_cache_stats",
            "clear_cache",
            "store_metrics_snapshot",
            "get_metrics_trend",
            "run_pipeline",
            "get_effective_context",
            "get_phase_status",
          ],
          description: "The management operation to perform",
        },
        // Checkpoint params
        label: {
          type: "string",
          description: "[create_checkpoint] Label for the checkpoint",
        },
        checkpoint_id: {
          type: "number",
          description: "[rollback_checkpoint/delete_checkpoint/compress_checkpoint/diff_checkpoint] Checkpoint ID",
        },
        // Checkpoint strategy params
        mode: {
          type: "string",
          enum: ["manual", "time_interval", "adaptive"],
          description: "[update_checkpoint_strategy] Strategy mode",
        },
        adaptive_change_threshold: {
          type: "number",
          description: "[update_checkpoint_strategy] Changes before auto-checkpoint",
        },
        time_interval_minutes: {
          type: "number",
          description: "[update_checkpoint_strategy] Minutes between auto-checkpoints",
        },
        max_checkpoints: {
          type: "number",
          description: "[update_checkpoint_strategy] Max checkpoints to retain",
        },
        max_age_days: {
          type: "number",
          description: "[update_checkpoint_strategy] Max age before cleanup",
        },
        max_total_size_mb: {
          type: "number",
          description: "[update_checkpoint_strategy] Max total snapshot size in MB",
        },
        compress_snapshots: {
          type: "boolean",
          description: "[update_checkpoint_strategy] Compress snapshots",
        },
        // Event replay params
        from: {
          type: "string",
          description: "[replay_events] Start timestamp (ISO 8601)",
        },
        to: {
          type: "string",
          description: "[replay_events] End timestamp (ISO 8601)",
        },
        action_filter: {
          type: "string",
          description: "[replay_events] Filter by action type",
        },
        target_type_filter: {
          type: "string",
          description: "[replay_events] Filter by target type",
        },
        // Undo params
        audit_entry_id: {
          type: "number",
          description: "[undo_operation] Audit entry ID to undo",
        },
        // Batch params
        ids: {
          type: "array",
          items: { type: "number" },
          description: "[batch_delete/batch_move_tier] Array of memory IDs",
        },
        target_type: {
          type: "string",
          enum: ["episodic", "semantic", "entity", "procedure"],
          description: "[batch_delete/batch_move_tier] Target memory type",
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
          description: "[batch_store] Array of memory objects",
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
          description: "[batch_update_importance] Array of { id, importance }",
        },
        tier: {
          type: "string",
          enum: ["active", "hot", "warm", "cold", "frozen"],
          description: "[batch_move_tier/update_tier_config] Tier name",
        },
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
          description: "[batch_audit_log] Array of audit events",
        },
        // Tier config params
        max_age_hours: {
          type: "number",
          description: "[update_tier_config] Max memory age in hours",
        },
        importance_threshold: {
          type: "number",
          description: "[update_tier_config] Min importance score",
        },
        retrieval_threshold: {
          type: "number",
          description: "[update_tier_config] Min retrieval count",
        },
        compress: {
          type: "boolean",
          description: "[update_tier_config] Compress memories in tier",
        },
        // Audit params
        audit_action: {
          type: "string",
          description: "[get_audit_log] Filter by action type",
        },
        audit_target_type: {
          type: "string",
          description: "[get_audit_log] Filter by target type",
        },
        audit_target_id: {
          type: "string",
          description: "[get_audit_log] Filter by target ID",
        },
        // Config params
        key: {
          type: "string",
          description: "[update_config] Configuration key",
        },
        value: {
          type: "string",
          description: "[update_config] New value",
        },
        // Metrics params
        window_ms: {
          type: "number",
          description: "[get_metrics/store_metrics_snapshot] Time window in ms",
        },
        weights: {
          type: "object",
          description: "[get_health_score] Custom weights for health score components",
        },
        hours: {
          type: "number",
          description: "[get_metrics_trend] Hours to look back",
        },
        limit: {
          type: "number",
          description: "[get_undoable_operations/replay_events/batch_audit_log/get_audit_log] Max results",
        },
        pipeline_mode: {
          type: "string",
          enum: ["pre_turn", "post_turn", "sensory_input", "encoding", "working_memory", "consolidation", "long_term_storage", "retrieval", "sleep_consolidation", "output_generation"],
          description: "[run_pipeline] Pipeline mode or single phase name",
        },
        message: {
          type: "string",
          description: "[run_pipeline] User message for context assembly",
        },
        turn_content: {
          type: "string",
          description: "[run_pipeline post_turn] Combined user+assistant text for extraction",
        },
        goal: {
          type: "string",
          description: "[run_pipeline] Current task goal (C_goal)",
        },
        max_tokens: {
          type: "number",
          description: "[run_pipeline] Context token budget",
        },
      },
    },
  },
};
