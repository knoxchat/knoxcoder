/**
 * MemoryPipeline — Unified 8-phase Knox-MS memory cycle orchestrator (local-only).
 *
 * Phases (φ₁–φ₈):
 *   1. sensory_input      — raw input capture
 *   2. encoding           — sanitize + normalize
 *   3. working_memory     — attention gating
 *   4. consolidation      — extract + strengthen (post-turn)
 *   5. long_term_storage  — persist extracted knowledge (post-turn)
 *   6. retrieval          — multi-strategy fusion search
 *   7. sleep_consolidation — background tiering (on-demand)
 *   8. output_generation  — context assembly for LLM
 */


import { getContextMaxTokens, getMemoryConfig } from "./memoryConfigAccess.js";
import { detectIntent } from "./RetrievalQuery.js";
import { BrainStore } from "./BrainStore.js";
import { SleepConsolidation } from "./SleepConsolidation.js";
import { NeuralArchitecture } from "./regions/NeuralArchitecture.js";
import { Hippocampus } from "./regions/Hippocampus.js";
import { PrefrontalCortex } from "./regions/PrefrontalCortex.js";
import { SensoryCortex } from "./regions/SensoryCortex.js";
import { Thalamus } from "./regions/Thalamus.js";
import { Brainstem } from "./regions/Brainstem.js";
import type { BuildContextResult, MemoryPhase, PipelineInput, PipelinePhaseResult } from "./types.js";

/** Canonical 8-phase order for cycle-invariant audit logging (IMP-01 / Part III). */
const FULL_CYCLE_ORDER: MemoryPhase[] = [
  "sensory_input",
  "encoding",
  "working_memory",
  "consolidation",
  "long_term_storage",
  "retrieval",
  "sleep_consolidation",
  "output_generation",
];

let _BrainManager: any = null;
async function getBrainManager() {
  if (!_BrainManager) {
    const mod = await import("./BrainManager.js");
    _BrainManager = mod.BrainManager;
  }
  return _BrainManager;
}

export interface PipelineResult {
  phases: PipelinePhaseResult[];
  context?: BuildContextResult;
  extracted?: { semantic_count: number; entity_count: number };
}

export type { PipelineInput, PipelinePhaseResult };

export class MemoryPipeline {
  /** Active phase for cycle-invariant status queries. */
  private static activePhase: MemoryPhase | null = null;
  /** Last completed phase + timestamp (Part III cycle invariant). */
  private static lastCompleted: { phase: MemoryPhase; at: number } | null = null;
  /** Per-phase run counts for diagnostics. */
  private static phaseRunCounts: Partial<Record<MemoryPhase, number>> = {};

  static getActivePhase(): MemoryPhase | null {
    return MemoryPipeline.activePhase;
  }

  /** Part III cycle status — at least one phase active or recently completed. */
  static getPhaseStatus(backgroundConsolidationActive = false): {
    active_phase: MemoryPhase | null;
    last_completed: { phase: MemoryPhase; at: number } | null;
    phase_counts: Partial<Record<MemoryPhase, number>>;
    cycle_invariant_met: boolean;
    background_sleep_active: boolean;
    canonical_order: MemoryPhase[];
  } {
    const recentlyActive =
      MemoryPipeline.activePhase !== null ||
      (MemoryPipeline.lastCompleted !== null &&
        Date.now() - MemoryPipeline.lastCompleted.at < 3_600_000);
    return {
      active_phase: MemoryPipeline.activePhase,
      last_completed: MemoryPipeline.lastCompleted,
      phase_counts: { ...MemoryPipeline.phaseRunCounts },
      cycle_invariant_met: recentlyActive || backgroundConsolidationActive,
      background_sleep_active: backgroundConsolidationActive,
      canonical_order: FULL_CYCLE_ORDER,
    };
  }

  private static markPhaseComplete(phase: MemoryPhase): void {
    MemoryPipeline.lastCompleted = { phase, at: Date.now() };
    MemoryPipeline.phaseRunCounts[phase] = (MemoryPipeline.phaseRunCounts[phase] ?? 0) + 1;
  }

  /** Record phase completion from NeuralArchitecture (pre-turn batch). */
  static markPhaseCompletePublic(phase: MemoryPhase): void {
    MemoryPipeline.markPhaseComplete(phase);
  }

  /** Log phase completion + cycle invariant to local audit trail (IMP-01). */
  private static async logPhaseAudit(
    result: PipelinePhaseResult,
    sessionId?: string,
    cycle?: string,
  ): Promise<void> {
    await BrainStore.auditLog(
      `pipeline:${result.phase}`,
      "pipeline",
      sessionId ?? null,
      {
        duration_ms: result.duration_ms,
        success: result.success,
        detail: result.detail,
        cycle,
        ...(result.audit ?? {}),
      },
    ).catch(() => {});
  }

  private static async logCycleInvariant(
    mode: string,
    phases: PipelinePhaseResult[],
    sessionId?: string,
  ): Promise<void> {
    const order = phases.map((p) => p.phase).join("→");
    await BrainStore.auditLog("pipeline:cycle_invariant", "pipeline", sessionId ?? null, {
      mode,
      phase_order: order,
      phase_count: phases.length,
      all_succeeded: phases.every((p) => p.success),
      canonical_order: FULL_CYCLE_ORDER.join("→"),
    }).catch(() => {});
  }

  private static parseExtractionDetail(
    detail?: string,
  ): { semantic_count: number; entity_count: number } {
    const match = detail?.match(/(\d+) semantic, (\d+) entities/);
    return {
      semantic_count: match ? Number(match[1]) : 0,
      entity_count: match ? Number(match[2]) : 0,
    };
  }

  /**
   * Run a single memory phase.
   */
  static async runPhase(
    phase: MemoryPhase,
    input: PipelineInput,
  ): Promise<PipelinePhaseResult> {
    const start = Date.now();
    MemoryPipeline.activePhase = phase;
    const BrainManager = await getBrainManager();

    try {
      let detail = "";
      let audit: Record<string, unknown> | undefined;

      switch (phase) {
        case "sensory_input": {
          if (input.session_id) {
            const wm = BrainManager.getWorkingMemory();
            SensoryCortex.setFlushHandler(input.session_id, (text) => Thalamus.attend(wm, text));
            SensoryCortex.flushOnTurnBoundary(input.session_id, input.message);
          }
          detail = "input accepted";
          break;
        }

        case "encoding": {
          const result = SensoryCortex.scan(input.message);
          detail = result.safe
            ? "encoded"
            : `sanitized (${result.threats.length} threats)`;
          break;
        }

        case "working_memory": {
          const wm = BrainManager.getWorkingMemory();
          if (input.session_id) {
            PrefrontalCortex.switchSession(input.session_id);
          }
          const plan = PrefrontalCortex.plan(input.message);
          const intent = detectIntent(input.message);
          if (intent === "new_task") {
            PrefrontalCortex.clearGoal(input.session_id);
          }
          if (input.goal?.trim()) {
            PrefrontalCortex.setGoal(input.goal, input.session_id);
          } else if (plan.intent) {
            PrefrontalCortex.setGoal(plan.intent, input.session_id);
          }
          Thalamus.gateTurn(wm, {
            message: input.message,
            framed: plan.framed,
            role: input.role ?? "user",
            intent,
            retrievalQuery: input.retrieval_query,
          });
          detail = plan.intent
            ? `attention applied (intent framed)`
            : "attention applied";
          break;
        }

        case "consolidation": {
          if (!input.session_id) {
            detail = "skipped (no session)";
            break;
          }
          const hasParts = Boolean(
            input.user_message?.trim() ||
              input.assistant_message?.trim() ||
              input.tool_summary?.trim(),
          );
          if (!input.turn_content && !hasParts) {
            detail = "skipped (no turn content)";
            break;
          }
          const extracted = await Hippocampus.encode(
            input.turn_content ?? input.message ?? "",
            input.role ?? "assistant",
            input.session_id,
            {
              userMessage: input.user_message,
              assistantMessage: input.assistant_message,
              toolSummary: input.tool_summary,
            },
          );
          detail = `${extracted.semantic_count} semantic, ${extracted.entity_count} entities`;
          break;
        }

        case "long_term_storage": {
          if (!input.session_id) {
            detail = "skipped (no session)";
            break;
          }
          const extracted = input.extracted ?? { semantic_count: 0, entity_count: 0 };
          if (extracted.semantic_count === 0 && extracted.entity_count === 0) {
            detail = input.turn_content ? "no new knowledge to persist" : "skipped (no extraction)";
            break;
          }
          const persisted = await Hippocampus.persistToLongTerm(input.session_id, extracted);
          detail = `M₄ promoted ${persisted.promoted}, M₅ procedural ${persisted.procedural}, compressed ${persisted.compressed}`;
          break;
        }

        case "retrieval": {
          const hits = await Hippocampus.fusionRetrieve({
            message: input.message,
            session_id: input.session_id,
            retrieval_query: input.retrieval_query,
          });
          detail = `${hits.length} fusion hits`;
          break;
        }

        case "output_generation": {
          const config = getMemoryConfig();
          const result = await Brainstem.assemble({
            message: input.message,
            session_id: input.session_id,
            max_tokens: getContextMaxTokens(input.max_tokens),
            memory_mode: config.memory_mode,
            goal: PrefrontalCortex.resolveGoal(input.goal, input.session_id),
            retrieval_query: input.retrieval_query,
            fusion_hits: input.fusion_hits,
          });
          const wm = BrainManager.getWorkingMemory();
          Brainstem.feedbackToThalamus(wm, result);
          detail = `${result.items.length} items, context fenced`;
          audit = {
            retrieval_query: input.retrieval_query ?? input.message,
            item_count: result.items.length,
            items: result.items.map((item) => ({
              id: item.id,
              kind: item.kind,
              fusion_score: item.score ?? null,
              fts5: item.fts5 ?? null,
              trigram: item.trigram ?? null,
              graph: item.graph ?? null,
              recency: item.recency ?? null,
              importance: item.importance ?? null,
              topic_id: item.topic_id ?? null,
              task_id: item.task_id ?? null,
              gate_passed: item.gate_passed ?? false,
            })),
          };
          break;
        }

        case "sleep_consolidation": {
          const cycle = await SleepConsolidation.runCycle();
          detail = `promoted ${cycle.promoted}, pruned ${cycle.pruned}`;
          break;
        }

        default:
          detail = "unknown phase";
      }

      const phaseResult: PipelinePhaseResult = {
        phase,
        duration_ms: Date.now() - start,
        success: true,
        detail,
        audit,
      };
      await MemoryPipeline.logPhaseAudit(phaseResult, input.session_id);
      MemoryPipeline.markPhaseComplete(phase);
      return phaseResult;
    } catch (err) {
      const phaseResult: PipelinePhaseResult = {
        phase,
        duration_ms: Date.now() - start,
        success: false,
        detail: err instanceof Error ? err.message : String(err),
      };
      await MemoryPipeline.logPhaseAudit(phaseResult, input.session_id);
      MemoryPipeline.markPhaseComplete(phase);
      return phaseResult;
    } finally {
      MemoryPipeline.activePhase = null;
    }
  }

  /**
   * Pre-turn pipeline: φ₁ → φ₂ → φ₃ → φ₆ → φ₈
   */
  static async runPreTurn(input: PipelineInput): Promise<PipelineResult> {
    const neural = await NeuralArchitecture.processPreTurn(input);
    const BrainManager = await getBrainManager();

    for (const phase of neural.phases) {
      await MemoryPipeline.logPhaseAudit(phase, input.session_id, "pre_turn");
      MemoryPipeline.markPhaseCompletePublic(phase.phase);
    }
    await MemoryPipeline.logCycleInvariant("pre_turn", neural.phases, input.session_id);

    if (neural.context.memory_tokens_saved && neural.context.memory_tokens_saved > 0) {
      BrainManager.recordCompressionMetrics(neural.context.memory_tokens_saved);
    }

    if (neural.context.context) {
      const maxTokens = input.max_tokens ?? getContextMaxTokens();
      const tokensUsed = Math.ceil(neural.context.context.length / 4);
      BrainManager.recordContextBuild(tokensUsed, maxTokens);
    }

    return { phases: neural.phases, context: neural.context };
  }

  /**
   * Post-turn pipeline: φ₄ → φ₅
   */
  static async runPostTurn(input: PipelineInput): Promise<PipelineResult> {
    const phases: PipelinePhaseResult[] = [];
    const config = getMemoryConfig();

    if (!config.enable_knowledge_extraction && !config.auto_extract_enabled) {
      return { phases, extracted: { semantic_count: 0, entity_count: 0 } };
    }

    const consolidation = await MemoryPipeline.runPhase("consolidation", input);
    phases.push(consolidation);

    const extracted = MemoryPipeline.parseExtractionDetail(consolidation.detail);

    const storage = await MemoryPipeline.runPhase("long_term_storage", {
      ...input,
      extracted,
    });
    phases.push(storage);

    if (extracted.semantic_count > 0 || extracted.entity_count > 0) {
      // BasalGanglia→procedural: record successful extraction pattern
      if (config.learning_enabled && input.turn_content) {
        const { BasalGanglia } = await import("./regions/BasalGanglia.js");
        const signature = input.turn_content
          .slice(0, 120)
          .replace(/\s+/g, " ")
          .trim();
        if (signature.length >= 20) {
          await BasalGanglia.recordSuccess({
            goal_type: "coding",
            pattern_signature: signature,
            description: `Turn extraction: ${extracted.semantic_count} semantic, ${extracted.entity_count} entities`,
            success: true,
          }).catch(() => {});
        }
      }
    }

    await MemoryPipeline.logCycleInvariant("post_turn", phases, input.session_id);

    return { phases, extracted };
  }

  /**
   * Full 8-phase cycle: φ₁ → φ₈ (debug / consolidation runs).
   * Runs pre-turn retrieval+output, post-turn consolidation+storage, then sleep.
   */
  static async runFullCycle(input: PipelineInput): Promise<PipelineResult> {
    const neural = await NeuralArchitecture.processPreTurn(input);
    const phases = [...neural.phases];
    const BrainManager = await getBrainManager();

    if (neural.context.memory_tokens_saved && neural.context.memory_tokens_saved > 0) {
      BrainManager.recordCompressionMetrics(neural.context.memory_tokens_saved);
    }

    for (const phase of neural.phases) {
      await MemoryPipeline.logPhaseAudit(phase, input.session_id, "full_cycle");
    }

    if (input.turn_content && input.session_id) {
      const consolidation = await MemoryPipeline.runPhase("consolidation", input);
      phases.push(consolidation);
      const extracted = MemoryPipeline.parseExtractionDetail(consolidation.detail);
      phases.push(
        await MemoryPipeline.runPhase("long_term_storage", { ...input, extracted }),
      );
    } else {
      phases.push({
        phase: "consolidation",
        duration_ms: 0,
        success: true,
        detail: "skipped (no turn content)",
      });
      phases.push({
        phase: "long_term_storage",
        duration_ms: 0,
        success: true,
        detail: "skipped (no turn content)",
      });
    }

    phases.push(await MemoryPipeline.runPhase("sleep_consolidation", input));

    await MemoryPipeline.logCycleInvariant("full_cycle", phases, input.session_id);

    const lastConsolidation = phases.find((p) => p.phase === "consolidation");
    const extracted = MemoryPipeline.parseExtractionDetail(lastConsolidation?.detail);

    return { phases, context: neural.context, extracted };
  }
}
