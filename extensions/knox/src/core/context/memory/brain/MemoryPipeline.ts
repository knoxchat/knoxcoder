/**
 * MemoryPipeline — Unified 8-phase Knox-MS memory cycle orchestrator (local-only).
 *
 * Live pre-turn order (MEM-31 / boxed O(x)):
 *   S → T → A → P → H → B_g → B_s
 *   O(x) = B_s(B_g(H(P(A(T(S(x)))))))
 *
 * NeuralArchitecture.processPreTurn delegates here — one path.
 *
 * Phases (φ₁–φ₈):
 *   1. sensory_input      — S capture
 *   2. encoding           — S sanitize + normalize
 *   3. working_memory     — T filter → A weight → P plan
 *   4. consolidation      — H extract (post-turn)
 *   5. long_term_storage  — H persist (post-turn)
 *   6. retrieval          — H fusion search
 *   7. sleep_consolidation — background tiering (on-demand)
 *   8. output_generation  — B_g procedures then B_s assemble
 *
 * Cycle invariant (MEM-32): Budget ∧ Reachability ∧ Losslessness.
 */

import { getMemoryConfig, getModeSettings } from "./memoryConfigAccess.js";
import { memoryWindowBuildFields, resolveMemoryWindow } from "./window.js";
import { resolveRetrievalQuery } from "./RetrievalQuery.js";
import { BrainStore } from "./BrainStore.js";
import { SleepConsolidation } from "./SleepConsolidation.js";
import { Amygdala, type AmygdalaWeight } from "./regions/Amygdala.js";
import { BasalGanglia } from "./regions/BasalGanglia.js";
import { Brainstem } from "./regions/Brainstem.js";
import { Hippocampus } from "./regions/Hippocampus.js";
import { PrefrontalCortex } from "./regions/PrefrontalCortex.js";
import { SensoryCortex } from "./regions/SensoryCortex.js";
import { Thalamus } from "./regions/Thalamus.js";
import {
  emptyAttributionResult,
  finalizePreviousAttribution,
  generateTurnId,
  recipeInjectItem,
  recordTurnAttribution,
  type AttributionTurnResult,
} from "./attribution.js";
import {
  cycleInvariantsMet,
  getInvariantSnapshot,
} from "./invariants.js";
import type {
  BuildContextResult,
  InjectedMemoryItem,
  MemoryPhase,
  MemoryPhaseStatus,
  PipelineInput,
  PipelinePhaseResult,
} from "./types.js";

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
  attribution?: AttributionTurnResult;
  encoded_message?: string;
  goal?: string;
  fusion_hits?: number;
  salience?: AmygdalaWeight;
  procedural_hits?: number;
}

export type { PipelineInput, PipelinePhaseResult };

/** Compact last-turn inject snapshot for Memories / Overview (T6). */
export interface LastInjectSnapshot {
  at: number;
  turn_id: string;
  session_id?: string;
  items: InjectedMemoryItem[];
}

export class MemoryPipeline {
  /** Active phase for cycle-invariant status queries. */
  private static activePhase: MemoryPhase | null = null;
  /** Last completed phase + timestamp (Part III cycle invariant). */
  private static lastCompleted: { phase: MemoryPhase; at: number } | null = null;
  /** Per-phase run counts for diagnostics. */
  private static phaseRunCounts: Partial<Record<MemoryPhase, number>> = {};
  /** Last pre-turn inject provenance (Memories tab + Overview). */
  private static lastInject: LastInjectSnapshot | null = null;
  /** Recipe hints noted before or after φ₈ lastInject is written (MEM-17). */
  private static pendingRecipeInjects: InjectedMemoryItem[] = [];
  /** Last A-stage I₀ for this process (MEM-31). */
  private static lastSalience: AmygdalaWeight | null = null;

  static getActivePhase(): MemoryPhase | null {
    return MemoryPipeline.activePhase;
  }

  /** Last pre-turn inject items (semantic/episodic) with gate reason. */
  static getLastInject(): LastInjectSnapshot | null {
    return MemoryPipeline.lastInject;
  }

  /** JSON payload for `brain/dashboard` and `brain/searchMemories`. */
  static lastInjectPayload(): {
    at: number;
    turn_id: string;
    session_id?: string;
    items: Array<{
      id: number | null;
      kind: string;
      title: string;
      reason: string;
      cite?: string;
      mem_id?: string;
      evidence?: string[];
      gate_passed?: boolean;
      score?: number;
      fts5?: number;
      trigram?: number;
      graph?: number;
      recency?: number;
      importance?: number;
    }>;
  } | null {
    const snap = MemoryPipeline.lastInject;
    if (!snap) return null;
    return {
      at: snap.at,
      turn_id: snap.turn_id,
      session_id: snap.session_id,
      items: snap.items
        .filter((item) => item.kind === "semantic" || item.kind === "episodic" || item.kind === "recipe")
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          reason: item.reason,
          cite: item.cite,
          mem_id: item.mem_id,
          evidence: item.evidence,
          gate_passed: item.gate_passed,
          score: item.score,
          channel: item.channel,
          fts5: item.fts5,
          trigram: item.trigram,
          graph: item.graph,
          recency: item.recency,
          importance: item.importance,
        })),
    };
  }

  /** Record a recipe hint/stub as an injected cite for this turn (MEM-17). */
  static noteRecipeInject(recipe: { id: string; title?: string }, reason = "recipe-hint"): InjectedMemoryItem {
    const item = recipeInjectItem(recipe, reason);
    MemoryPipeline.pendingRecipeInjects.push(item);
    if (MemoryPipeline.lastInject) {
      MemoryPipeline.lastInject.items.push(item);
    }
    return item;
  }

  /** Test helper — forget lastInject / pending recipe cites / last I₀. */
  static resetInjectStateForTests(): void {
    MemoryPipeline.lastInject = null;
    MemoryPipeline.pendingRecipeInjects = [];
    MemoryPipeline.lastSalience = null;
  }

  /** Last Amygdala I₀ from the live pre-turn path (MEM-31). */
  static getLastSalience(): AmygdalaWeight | null {
    return MemoryPipeline.lastSalience;
  }

  private static rememberInject(
    input: PipelineInput,
    items: InjectedMemoryItem[],
  ): LastInjectSnapshot {
    const recipes = MemoryPipeline.pendingRecipeInjects.splice(0);
    const snap: LastInjectSnapshot = {
      at: Date.now(),
      turn_id: input.turn_id?.trim() || generateTurnId(input.session_id),
      session_id: input.session_id,
      items: [...items, ...recipes],
    };
    MemoryPipeline.lastInject = snap;
    return snap;
  }

  private static injectedItemsForTurn(input: PipelineInput): InjectedMemoryItem[] {
    const items: InjectedMemoryItem[] = [];
    const snap = MemoryPipeline.lastInject;
    if (
      snap &&
      (!input.session_id || !snap.session_id || snap.session_id === input.session_id)
    ) {
      items.push(...snap.items);
    }
    items.push(...MemoryPipeline.pendingRecipeInjects);
    return items;
  }

  /**
   * Bs→H: parse `[mem:id]` cites, persist `brain_attribution`, apply h/u + FSRS
   * when the turn succeeded or the next user turn corrects a cited memory.
   */
  static async attributeTurn(input: PipelineInput): Promise<AttributionTurnResult> {
    try {
      const turnId =
        input.turn_id?.trim() ||
        MemoryPipeline.lastInject?.turn_id ||
        generateTurnId(input.session_id);
      return await recordTurnAttribution(
        { ...input, turn_id: turnId },
        MemoryPipeline.injectedItemsForTurn(input),
      );
    } catch {
      return emptyAttributionResult(input.turn_id ?? "");
    }
  }

  /**
   * Part III cycle status (MEM-32).
   * `cycle_invariant_met` is Budget ∧ Reachability ∧ Losslessness,
   * not “a phase ran in the last hour”.
   */
  static getPhaseStatus(backgroundConsolidationActive = false): MemoryPhaseStatus {
    const snap = getInvariantSnapshot();
    return {
      active_phase: MemoryPipeline.activePhase,
      last_completed: MemoryPipeline.lastCompleted,
      phase_counts: { ...MemoryPipeline.phaseRunCounts },
      cycle_invariant_met: cycleInvariantsMet(snap),
      budget_invariant_met: snap.budget.met,
      reachability_invariant_met: snap.reachability.met,
      losslessness_invariant_met: snap.losslessness.met,
      background_sleep_active: backgroundConsolidationActive,
      canonical_order: FULL_CYCLE_ORDER,
    };
  }

  private static markPhaseComplete(phase: MemoryPhase): void {
    MemoryPipeline.lastCompleted = { phase, at: Date.now() };
    MemoryPipeline.phaseRunCounts[phase] = (MemoryPipeline.phaseRunCounts[phase] ?? 0) + 1;
  }

  /** Record phase completion from a pre-turn batch. */
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
    const snap = getInvariantSnapshot();
    await BrainStore.auditLog("pipeline:cycle_invariant", "pipeline", sessionId ?? null, {
      mode,
      phase_order: order,
      phase_count: phases.length,
      all_succeeded: phases.every((p) => p.success),
      canonical_order: FULL_CYCLE_ORDER.join("→"),
      cycle_invariant_met: cycleInvariantsMet(snap),
      budget_invariant_met: snap.budget.met,
      reachability_invariant_met: snap.reachability.met,
      losslessness_invariant_met: snap.losslessness.met,
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
          wm.flushOnCallBoundary();
          if (input.session_id) {
            PrefrontalCortex.switchSession(input.session_id);
          }
          const retrieval = await resolveRetrievalQuery({
            message: input.message,
            sessionId: input.session_id,
            retrievalQueryOverride: input.retrieval_query,
          });
          Thalamus.filterTurn(wm, {
            message: input.message,
            role: input.role ?? "user",
            intent: retrieval.intent,
            retrievalQuery: retrieval.retrievalQuery,
          });
          const weight = Amygdala.weight(input.message, input.role ?? "user");
          Thalamus.applySalience(wm, input.message, weight, input.role ?? "user", input.session_id);
          MemoryPipeline.lastSalience = weight;
          if (retrieval.intent === "new_task") {
            PrefrontalCortex.clearGoal(input.session_id);
          }
          const plan = PrefrontalCortex.plan(input.message);
          if (input.goal?.trim()) {
            PrefrontalCortex.setGoal(input.goal, input.session_id);
          } else if (plan.intent) {
            PrefrontalCortex.setGoal(plan.intent, input.session_id);
          }
          detail = `T→A→P (i0=${weight.i0.toFixed(2)})`;
          audit = {
            flow: "T→A→P",
            i0: weight.i0,
            salience: weight.salience,
            valence: weight.valence,
            intent: retrieval.intent,
          };
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
          const persisted = await Hippocampus.persistToLongTerm(input.session_id, extracted);
          if (extracted.semantic_count === 0 && extracted.entity_count === 0) {
            detail = persisted.compressed
              ? `M₃/M₄ tree linked ${persisted.compressed} (no new extract)`
              : input.turn_content
                ? "no new knowledge to persist"
                : "skipped (no extraction)";
            break;
          }
          detail = `M₄ promoted ${persisted.promoted}, M₅ recipes ${persisted.recipes}, leftover procedural ${persisted.procedural}, compressed ${persisted.compressed}`;
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
          const mode = getModeSettings(config.memory_mode);
          const query = input.retrieval_query ?? input.message;
          const procedural = await BasalGanglia.selectForTurn({
            query,
            includeProcedures: mode.includeProcedures && config.learning_enabled,
            includePatterns: mode.includePatterns && config.learning_enabled,
          });
          const result = await Brainstem.assemble({
            message: input.message,
            session_id: input.session_id,
            memory_mode: config.memory_mode,
            goal: PrefrontalCortex.resolveGoal(input.goal, input.session_id),
            retrieval_query: input.retrieval_query,
            fusion_hits: input.fusion_hits,
            procedure_hits: procedural.procedures,
            pattern_hits: procedural.patterns,
            ...memoryWindowBuildFields(input),
          });
          const wm = BrainManager.getWorkingMemory();
          Brainstem.feedbackToThalamus(wm, result);
          MemoryPipeline.rememberInject(input, result.items);
          detail = `${result.items.length} items, B_g=${procedural.procedures.length + procedural.patterns.length}`;
          audit = {
            retrieval_query: query,
            item_count: result.items.length,
            procedural_hits: procedural.procedures.length + procedural.patterns.length,
            items: result.items.map((item) => ({
              id: item.id,
              kind: item.kind,
              cite: item.cite ?? null,
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
   * Live pre-turn path (MEM-31): S → T → A → P → H → B_g → B_s.
   * NeuralArchitecture.processPreTurn calls this method.
   */
  static async runPreTurn(input: PipelineInput): Promise<PipelineResult> {
    const BrainManager = await getBrainManager();
    const wm = BrainManager.getWorkingMemory();
    const phases: PipelinePhaseResult[] = [];

    // S — encode
    const sensoryStart = Date.now();
    let message = input.message;
    if (input.session_id) {
      SensoryCortex.setFlushHandler(input.session_id, (text) =>
        Thalamus.filterAndAttend(wm, text),
      );
      message = SensoryCortex.flushOnTurnBoundary(input.session_id, input.message);
    }
    phases.push({
      phase: "sensory_input",
      duration_ms: Date.now() - sensoryStart,
      success: true,
      detail: "input accepted",
    });

    const encodingStart = Date.now();
    const scan = SensoryCortex.scan(message);
    const encodedMessage = scan.cleaned;
    phases.push({
      phase: "encoding",
      duration_ms: Date.now() - encodingStart,
      success: true,
      detail: scan.safe
        ? "encoded"
        : `sanitized (${scan.threats.length} threats)`,
    });

    // B_s→H of the previous turn (correction / delayed accept).
    await finalizePreviousAttribution({
      session_id: input.session_id,
      user_message: encodedMessage,
      user_corrected: input.user_corrected,
    }).catch(() => undefined);

    // T — filter (intent needed for new-task / continuation)
    const wmStart = Date.now();
    wm.flushOnCallBoundary();
    if (input.session_id) {
      PrefrontalCortex.switchSession(input.session_id);
    }
    const retrieval = await resolveRetrievalQuery({
      message: encodedMessage,
      sessionId: input.session_id,
      retrievalQueryOverride: input.retrieval_query,
      workingMemoryItems: wm.getAll().map((item: { content: string; source: string; added_at: number }) => ({
        content: item.content,
        source: item.source,
        added_at: item.added_at,
      })),
    });

    if (input.session_id) {
      const { ensureTaskForTurn } = await import("./TaskContext.js");
      await ensureTaskForTurn(input.session_id, encodedMessage, retrieval.intent).catch(
        () => undefined,
      );
    }

    Thalamus.filterTurn(wm, {
      message: encodedMessage,
      role: input.role ?? "user",
      intent: retrieval.intent,
      retrievalQuery: retrieval.retrievalQuery,
    });

    // A — salience weight → I₀
    const weight = Amygdala.weight(encodedMessage, input.role ?? "user");
    Thalamus.applySalience(wm, encodedMessage, weight, input.role ?? "user", input.session_id);
    MemoryPipeline.lastSalience = weight;

    // P — plan / C_goal (after T and A)
    if (retrieval.intent === "new_task") {
      PrefrontalCortex.clearGoal(input.session_id);
    }
    const plan = PrefrontalCortex.plan(encodedMessage);
    if (input.goal?.trim()) {
      PrefrontalCortex.setGoal(input.goal, input.session_id);
    } else if (plan.intent) {
      PrefrontalCortex.setGoal(plan.intent, input.session_id);
    }
    phases.push({
      phase: "working_memory",
      duration_ms: Date.now() - wmStart,
      success: true,
      detail: `T→A→P (i0=${weight.i0.toFixed(2)})`,
      audit: {
        flow: "T→A→P",
        i0: weight.i0,
        salience: weight.salience,
        valence: weight.valence,
        intent: retrieval.intent,
      },
    });

    const config = getMemoryConfig();
    const mode = getModeSettings(config.memory_mode);

    // H — recall
    const retrievalStart = Date.now();
    const fusionResults = await Hippocampus.fusionRetrieve({
      message: encodedMessage,
      session_id: input.session_id,
      retrieval_query: retrieval.retrievalQuery,
      includeEpisodic: mode.includeEpisodic,
    });
    Hippocampus.replanFromHits(fusionResults, input.session_id);
    phases.push({
      phase: "retrieval",
      duration_ms: Date.now() - retrievalStart,
      success: true,
      detail: `${fusionResults.length} fusion hits`,
      audit: {
        retrieval_query: retrieval.retrievalQuery,
        hit_count: fusionResults.length,
      },
    });

    // B_g — procedures before B_s
    const procedural = await BasalGanglia.selectForTurn({
      query: retrieval.retrievalQuery,
      includeProcedures: mode.includeProcedures && config.learning_enabled,
      includePatterns: mode.includePatterns && config.learning_enabled,
    });

    // B_s — generate
    const outputStart = Date.now();
    const goal = PrefrontalCortex.resolveGoal(input.goal, input.session_id);
    const context = await Brainstem.assemble({
      message: encodedMessage,
      session_id: input.session_id,
      memory_mode: config.memory_mode,
      goal,
      retrieval_query: retrieval.retrievalQuery,
      fusion_hits: fusionResults,
      procedure_hits: procedural.procedures,
      pattern_hits: procedural.patterns,
      ...memoryWindowBuildFields(input),
    });
    Brainstem.feedbackToThalamus(wm, context);
    MemoryPipeline.rememberInject(input, context.items);
    phases.push({
      phase: "output_generation",
      duration_ms: Date.now() - outputStart,
      success: true,
      detail: `${context.items.length} items, B_g=${procedural.procedures.length + procedural.patterns.length}`,
      audit: {
        retrieval_query: retrieval.retrievalQuery,
        item_count: context.items.length,
        procedural_hits: procedural.procedures.length + procedural.patterns.length,
        recent_overflow: context.recent_overflow ?? false,
        summary_node_id: context.summary_node_id ?? null,
        dropped_turn_ids: context.dropped_turn_ids ?? [],
        items: context.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          reason: item.reason,
          cite: item.cite ?? null,
          evidence: item.evidence,
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
      },
    });

    for (const phase of phases) {
      await MemoryPipeline.logPhaseAudit(phase, input.session_id, "pre_turn");
      MemoryPipeline.markPhaseCompletePublic(phase.phase);
    }
    await MemoryPipeline.logCycleInvariant("pre_turn", phases, input.session_id);

    if (context.memory_tokens_saved && context.memory_tokens_saved > 0) {
      BrainManager.recordCompressionMetrics(context.memory_tokens_saved);
    }
    if (context.context) {
      const window = resolveMemoryWindow({
        llm: input.llm,
        model: input.model,
        contextLength: context.w ?? input.w,
        maxTokens: context.w_out ?? input.w_out,
        remember: Boolean(input.llm || input.model),
      });
      const tokensUsed = Math.ceil(context.context.length / 4);
      BrainManager.recordContextBuild(tokensUsed, context.w ?? window.w);
    }

    return {
      phases,
      context,
      encoded_message: encodedMessage,
      goal,
      fusion_hits: fusionResults.length,
      salience: weight,
      procedural_hits: procedural.procedures.length + procedural.patterns.length,
    };
  }

  /**
   * Post-turn pipeline: φ₄ → φ₅
   */
  static async runPostTurn(input: PipelineInput): Promise<PipelineResult> {
    const phases: PipelinePhaseResult[] = [];
    const config = getMemoryConfig();
    const attribution = await MemoryPipeline.attributeTurn(input);

    if (!config.enable_knowledge_extraction && !config.auto_extract_enabled) {
      return { phases, extracted: { semantic_count: 0, entity_count: 0 }, attribution };
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

    return { phases, extracted, attribution };
  }

  /**
   * Full 8-phase cycle: φ₁ → φ₈ (debug / consolidation runs).
   * Runs pre-turn retrieval+output, post-turn consolidation+storage, then sleep.
   */
  static async runFullCycle(input: PipelineInput): Promise<PipelineResult> {
    const pre = await MemoryPipeline.runPreTurn(input);
    const phases = [...pre.phases];

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
    const attribution = await MemoryPipeline.attributeTurn(input);

    return { phases, context: pre.context, extracted, attribution };
  }
}
