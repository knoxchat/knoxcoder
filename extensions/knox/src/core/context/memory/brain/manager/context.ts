/** Context build, pipeline, C_effective, task routing. */

import { BrainStore } from "../BrainStore.js";
import { MemoryPipeline } from "../MemoryPipeline.js";
import { LocalAutonomousLoop } from "../LocalAutonomousLoop.js";
import type { AutonomousLoopInput, AutonomousLoopResult, AutonomousLoopStatus } from "../LocalAutonomousLoop.js";
import { TaskRouter } from "../TaskRouter.js";
import type { TaskScoreInput, TaskRouteResult } from "../TaskRouter.js";
import type {
  MemoryMode,
  MemoryPhase,
} from "../types.js";
import { brainRuntime } from "./state.js";
import { getWorkingMemory } from "./runtime.js";
import { recordMetric } from "./telemetry.js";

// ── Auto-context: Build context from memory for conversation ───────────────

/**
 * Build relevant context from memory for a new message.
 * This is the key function that enables "unlimited context window".
 *
 * Given any user message, it searches across ALL sessions to find relevant
 * semantic knowledge and episodic memories, then returns them as context.
 */
export async function buildContextForMessage(
  message: string,
  currentSessionId?: string,
  maxTokens?: number,
): Promise<string> {
  const result = await buildContextDetailed(
    message,
    currentSessionId,
    maxTokens,
  );
  return result.context;
}

export async function buildContextDetailed(
  message: string,
  currentSessionId?: string,
  maxTokens?: number,
  options?: { goal?: string; memory_mode?: MemoryMode },
) {
  const result = await MemoryPipeline.runPreTurn({
    message,
    session_id: currentSessionId,
    max_tokens: maxTokens,
    goal: options?.goal,
  });
  return result.context!;
}

/**
 * Run the 8-phase memory pipeline for a single phase or full pre/post turn.
 */
export async function runPipeline(params: {
  mode: "pre_turn" | "post_turn" | "full_cycle" | MemoryPhase;
  message?: string;
  session_id?: string;
  role?: string;
  goal?: string;
  max_tokens?: number;
  turn_content?: string;
}) {
  if (params.mode === "pre_turn") {
    return MemoryPipeline.runPreTurn({
      message: params.message ?? "",
      session_id: params.session_id,
      goal: params.goal,
      max_tokens: params.max_tokens,
    });
  }
  if (params.mode === "post_turn") {
    return MemoryPipeline.runPostTurn({
      message: params.message ?? "",
      session_id: params.session_id,
      role: params.role,
      turn_content: params.turn_content,
    });
  }
  if (params.mode === "full_cycle") {
    return MemoryPipeline.runFullCycle({
      message: params.message ?? "",
      session_id: params.session_id,
      role: params.role,
      goal: params.goal,
      max_tokens: params.max_tokens,
      turn_content: params.turn_content,
    });
  }
  return {
    phases: [
      await MemoryPipeline.runPhase(params.mode, {
        message: params.message ?? "",
        session_id: params.session_id,
        role: params.role,
        turn_content: params.turn_content,
      }),
    ],
  };
}

export function getPhaseStatus() {
  const consolidationStats = brainRuntime.consolidationTracker.getStats();
  return MemoryPipeline.getPhaseStatus(consolidationStats.scheduler_active);
}

/** Local C_effective metrics (IMP-04 / IMP-16). Part II M₁–M₅ hierarchy. */
export async function getEffectiveContext() {
  const { calculateHierarchyEffective } = await import("../MemoryHierarchy.js");
  const config = BrainStore.getConfig();
  const wmStats = getWorkingMemory().getStats();
  const hierarchy = await calculateHierarchyEffective({
    activeSessionId: brainRuntime.activeSessionId,
    workingMemoryTokens: wmStats.total_tokens,
  });
  const graphEntityCount = await BrainStore.countEntities();
  const compression = brainRuntime.compressionMetrics.getStats();
  const buildStats = brainRuntime.effectiveContextTracker.getStats();
  const sensory = (await import("../SensoryBuffer.js")).SensoryBuffer.getStats(
    brainRuntime.activeSessionId ?? undefined,
  );

  return {
    /** W_max — configured active context window (Part VII). */
    active_window_tokens: config.context_max_tokens,
    context_max_tokens: config.context_max_tokens,
    last_context_tokens_used: buildStats.last_context_tokens_used,
    last_context_max_tokens: buildStats.last_context_max_tokens,
    window_utilization: buildStats.window_utilization,
    tier_tokens: hierarchy.tier_tokens,
    memory_levels: hierarchy.levels,
    hierarchy_effective_tokens: hierarchy.hierarchy_effective_tokens,
    working_memory_tokens: wmStats.total_tokens,
    working_memory_budget: wmStats.token_budget,
    sensory_buffer_tokens: sensory.estimated_tokens,
    sensory_buffer_ms: sensory.buffer_ms,
    graph_entity_count: graphEntityCount,
    graph_max_entities: config.graph_max_entities,
    graph_max_depth: config.graph_max_depth,
    graph_depth_decay_gamma: config.graph_depth_decay_gamma,
    graph_cap_utilization:
      config.graph_max_entities > 0
        ? graphEntityCount / config.graph_max_entities
        : 0,
    total_effective: config.context_max_tokens + hierarchy.hierarchy_effective_tokens,
    compression_ratios: hierarchy.compression_ratios,
    memory_tokens_saved: compression.total_tokens_saved,
    last_compression_tokens_saved: compression.last_tokens_saved,
    compression_events: compression.compression_events,
  };
}

/** Record tokens saved from compress-oldest overflow (IMP-15). */
export function recordCompressionMetrics(tokensSaved: number): void {
  if (tokensSaved <= 0) return;
  brainRuntime.compressionMetrics.record(tokensSaved);
  recordMetric("build_context_compression", 0, tokensSaved, true);
}

/** Record last context build utilization for capacity dashboard (IMP-16). */
export function recordContextBuild(tokensUsed: number, maxTokens: number): void {
  brainRuntime.effectiveContextTracker.recordBuild(tokensUsed, maxTokens);
}

export function getContextBuildStats() {
  return brainRuntime.effectiveContextTracker.getStats();
}

export function getCompressionStats() {
  return brainRuntime.compressionMetrics.getStats();
}

/** Score task difficulty and route to configured model (IMP-17). */
export function routeTask(input: TaskScoreInput): TaskRouteResult {
  return TaskRouter.scoreAndRoute(input);
}

/** Start local autonomous execution loop (IMP-24). */
export async function runAutonomousLoop(input: AutonomousLoopInput): Promise<AutonomousLoopResult> {
  return LocalAutonomousLoop.run(input);
}

/** Cancel a running autonomous loop for a session. */
export function cancelAutonomousLoop(sessionId: string): boolean {
  return LocalAutonomousLoop.cancel(sessionId);
}

/** Get status of a running or recently completed autonomous loop. */
export function getAutonomousLoopStatus(sessionId: string): AutonomousLoopStatus | null {
  return LocalAutonomousLoop.getStatus(sessionId);
}
