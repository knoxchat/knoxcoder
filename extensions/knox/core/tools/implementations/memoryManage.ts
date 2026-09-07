import { BrainManager } from "../../context/memory/brain/BrainManager.js";
import type { MemoryManageAction } from "../../context/memory/brain/types.js";

import { ToolImpl } from ".";

const VALID_ACTIONS: Set<string> = new Set([
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
]);

export const memoryManageImpl: ToolImpl = async (args, extras) => {
  const action = args.action as MemoryManageAction;

  if (!action || !VALID_ACTIONS.has(action)) {
    return [
      {
        name: "Memory Manage",
        description: "Memory Manage Error",
        content: `Missing or invalid action. Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
      },
    ];
  }

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
        name: "Memory Manage",
        description: `Memory Manage — ${action}`,
        content: result,
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "Memory Manage",
        description: "Memory Manage Error",
        content: `Error executing manage action "${action}": ${message}`,
      },
    ];
  }
};
