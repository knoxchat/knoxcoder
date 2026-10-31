/** Context build, pipeline, C_addr / C_use, task routing. */

import { isBrainEnabled } from "../store/dbSafety.js";
import { BrainStore } from "../BrainStore.js";
import { MemoryPipeline } from "../MemoryPipeline.js";
import type { BuildContextResult } from "../types.js";
import { LocalAutonomousLoop } from "../LocalAutonomousLoop.js";
import type { AutonomousLoopInput, AutonomousLoopResult, AutonomousLoopStatus } from "../LocalAutonomousLoop.js";
import { TaskRouter } from "../TaskRouter.js";
import type { TaskScoreInput, TaskRouteResult } from "../TaskRouter.js";
import type {
  MemoryMode,
  MemoryPhase,
} from "../types.js";
import { getLastRoutedWindow, resolveMemoryWindow, sanitizeInjectOverride } from "../window.js";
import { brainRuntime } from "./state.js";
import { getLlm, getWorkingMemory } from "./runtime.js";
import { recordMetric } from "./telemetry.js";

// ── Auto-context: Build context from memory for conversation ───────────────

/**
 * Build relevant context from memory for a new message.
 * Injected memory is capped (K-072); pinned + plan outrank retrieved rows.
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
  options?: {
    goal?: string;
    memory_mode?: MemoryMode;
    llm?: unknown;
    model?: string;
    w?: number;
    w_out?: number;
    system_tokens?: number;
    goal_tokens?: number;
    recent_tokens?: number;
  },
): Promise<BuildContextResult> {
  if (!isBrainEnabled()) {
    return { context: "", items: [] };
  }
  const result = await MemoryPipeline.runPreTurn({
    message,
    session_id: currentSessionId,
    max_tokens: sanitizeInjectOverride(maxTokens),
    goal: options?.goal,
    llm: options?.llm ?? getLlm() ?? undefined,
    model: options?.model,
    w: options?.w,
    w_out: options?.w_out,
    system_tokens: options?.system_tokens,
    goal_tokens: options?.goal_tokens,
    recent_tokens: options?.recent_tokens,
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
  user_message?: string;
  assistant_message?: string;
  tool_summary?: string;
  turn_id?: string;
  turn_succeeded?: boolean;
  user_corrected?: boolean;
  recipe_hint?: string;
}) {
  if (params.mode === "pre_turn") {
    return MemoryPipeline.runPreTurn({
      message: params.message ?? "",
      session_id: params.session_id,
      goal: params.goal,
      max_tokens: sanitizeInjectOverride(params.max_tokens),
      turn_id: params.turn_id,
      user_corrected: params.user_corrected,
      user_message: params.user_message,
      llm: getLlm() ?? undefined,
    });
  }
  if (params.mode === "post_turn") {
    return MemoryPipeline.runPostTurn({
      message: params.message ?? "",
      session_id: params.session_id,
      role: params.role,
      turn_content: params.turn_content,
      user_message: params.user_message,
      assistant_message: params.assistant_message,
      tool_summary: params.tool_summary,
      turn_id: params.turn_id,
      turn_succeeded: params.turn_succeeded,
      user_corrected: params.user_corrected,
      recipe_hint: params.recipe_hint,
    });
  }
  if (params.mode === "full_cycle") {
    return MemoryPipeline.runFullCycle({
      message: params.message ?? "",
      session_id: params.session_id,
      role: params.role,
      goal: params.goal,
      max_tokens: sanitizeInjectOverride(params.max_tokens),
      llm: getLlm() ?? undefined,
      turn_content: params.turn_content,
      user_message: params.user_message,
      assistant_message: params.assistant_message,
      tool_summary: params.tool_summary,
      turn_id: params.turn_id,
      turn_succeeded: params.turn_succeeded,
      user_corrected: params.user_corrected,
      recipe_hint: params.recipe_hint,
    });
  }
  return {
    phases: [
      await MemoryPipeline.runPhase(params.mode, {
        message: params.message ?? "",
        session_id: params.session_id,
        role: params.role,
        turn_content: params.turn_content,
        user_message: params.user_message,
        assistant_message: params.assistant_message,
        tool_summary: params.tool_summary,
        turn_id: params.turn_id,
        turn_succeeded: params.turn_succeeded,
        user_corrected: params.user_corrected,
        recipe_hint: params.recipe_hint,
      }),
    ],
  };
}

export function getPhaseStatus() {
  const consolidationStats = brainRuntime.consolidationTracker.getStats();
  return MemoryPipeline.getPhaseStatus(consolidationStats.scheduler_active);
}

/** Local C_addr / C_use / W metrics (MEM-07). Rec / H_0.85 / σ / ε_* are filled when a bench window exists. */
export async function getEffectiveContext() {
  const { calculateAddressableMemory } = await import("../MemoryHierarchy.js");
  const config = BrainStore.getConfig();
  const wmStats = getWorkingMemory().getStats();
  const hierarchy = await calculateAddressableMemory({
    activeSessionId: brainRuntime.activeSessionId,
    workingMemoryTokens: wmStats.total_tokens,
  });
  const graphEntityCount = await BrainStore.countEntities();
  const compression = brainRuntime.compressionMetrics.getStats();
  const buildStats = brainRuntime.effectiveContextTracker.getStats();
  const sensory = (await import("../SensoryBuffer.js")).SensoryBuffer.getStats(
    brainRuntime.activeSessionId ?? undefined,
  );

  const window = getLastRoutedWindow() ?? resolveMemoryWindow({
    llm: getLlm() ?? undefined,
    remember: Boolean(getLlm()),
  });
  const w = window.w;
  const c_use = buildStats.last_context_tokens_used ?? 0;

  return {
    c_addr: hierarchy.c_addr,
    c_use,
    w,
    w_out: window.wOut,
    routed_model: window.model,
    rec_rolling: undefined as number | undefined,
    h_0_85: undefined as number | undefined,
    sigma: undefined as number | undefined,
    epsilon_b: undefined as number | null | undefined,
    epsilon_b_note: undefined as string | undefined,
    epsilon_s: undefined as number | undefined,
    theorem_held: undefined as boolean | undefined,
    levels: hierarchy.levels,
    tier_tokens: hierarchy.tier_tokens,
    active_window_tokens: w,
    context_max_tokens: w,
    last_context_tokens_used: c_use,
    last_context_max_tokens: buildStats.last_context_max_tokens,
    window_utilization: buildStats.window_utilization,
    memory_levels: hierarchy.levels,
    working_memory_tokens: wmStats.total_tokens,
    working_memory_budget: wmStats.token_budget,
    working_memory_lifetime: wmStats.lifetime,
    sensory_buffer_tokens: sensory.estimated_tokens,
    sensory_buffer_ms: sensory.buffer_ms,
    sensory_lifetime: sensory.lifetime,
    graph_entity_count: graphEntityCount,
    graph_channel_size: graphEntityCount,
    graph_role: "channel" as const,
    graph_is_capacity: false,
    graph_max_entities: 0,
    graph_max_depth: config.graph_max_depth,
    graph_depth_decay_gamma: config.graph_depth_decay_gamma,
    graph_ppr_alpha: config.ppr_alpha,
    graph_ppr_epsilon: config.ppr_epsilon,
    // No entity cap (MEM-25). Not C_addr and not a success metric.
    graph_cap_utilization: 0,
    compression_ratios: hierarchy.compression_ratios,
    memory_tokens_saved: compression.total_tokens_saved,
    last_compression_tokens_saved: compression.last_tokens_saved,
    compression_events: compression.compression_events,
  };
}

/** Record tokens saved when overflow replaces old turns with a summary node (MEM-30). */
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

/** Score task difficulty and route to configured model (IMP-17 / MEM-27). */
export function routeTask(input: TaskScoreInput): TaskRouteResult {
  return TaskRouter.scoreAndRoute({
    ...input,
    llm: input.llm ?? getLlm() ?? undefined,
  });
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
