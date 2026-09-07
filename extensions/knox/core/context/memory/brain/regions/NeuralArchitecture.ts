/**
 * NeuralArchitecture — Knox-MS Part I flow (IMP-01 / IMP-02).
 *
 *   O(x) = Brainstem(M(Thalamus(Sensory(x))))
 *
 * Feedback loops:
 *   Hippocampus → PrefrontalCortex (H→P)
 *   Brainstem → Thalamus (Bs→T)
 *   Amygdala → PrefrontalCortex via Thalamus (A→P)
 */

import { getContextMaxTokens, getMemoryConfig, getModeSettings } from "../memoryConfigAccess.js";
import { resolveRetrievalQuery } from "../RetrievalQuery.js";
import type { BuildContextResult, MemoryPhase, PipelineInput, PipelinePhaseResult } from "../types.js";
import { Brainstem } from "./Brainstem.js";
import { Hippocampus } from "./Hippocampus.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";
import { SensoryCortex } from "./SensoryCortex.js";
import { Thalamus } from "./Thalamus.js";

export interface NeuralProcessResult {
  phases: PipelinePhaseResult[];
  context: BuildContextResult;
  encoded_message: string;
  goal?: string;
  fusion_hits: number;
}

let _BrainManager: { getWorkingMemory(): import("../WorkingMemory.js").WorkingMemory } | null = null;
async function getBrainManager() {
  if (!_BrainManager) {
    const mod = await import("../BrainManager.js");
    _BrainManager = mod.BrainManager;
  }
  return _BrainManager;
}

export const NeuralArchitecture = {
  /**
   * Pre-turn neural path: φ₁ → φ₂ → φ₃ → φ₆ → φ₈
   * Implements O(x) = Brainstem(M(Thalamus(Sensory(x))))
   */
  async processPreTurn(input: PipelineInput): Promise<NeuralProcessResult> {
    const BrainManager = await getBrainManager();
    const wm = BrainManager.getWorkingMemory();
    const phases: PipelinePhaseResult[] = [];

    // REL-07: bind C_goal to this session; do not copy the previous session's goal.
    PrefrontalCortex.switchSession(input.session_id);

    // φ₁ — Sensory(x)
    const sensoryStart = Date.now();
    let message = input.message;
    if (input.session_id) {
      SensoryCortex.setFlushHandler(input.session_id, (text) =>
        Thalamus.attend(wm, text, "user"),
      );
      message = SensoryCortex.flushOnTurnBoundary(input.session_id, input.message);
    }
    phases.push({
      phase: "sensory_input",
      duration_ms: Date.now() - sensoryStart,
      success: true,
      detail: "input accepted",
    });

    // φ₂ — encode / sanitize (still SensoryCortex facade)
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

    // φ₃ — Thalamus(Prefrontal(x)) → M₂  (REL-06: isolate on new-task)
    const wmStart = Date.now();
    const plan = PrefrontalCortex.plan(encodedMessage);

    const retrieval = await resolveRetrievalQuery({
      message: encodedMessage,
      sessionId: input.session_id,
      retrievalQueryOverride: input.retrieval_query,
      workingMemoryItems: wm.getAll().map((item) => ({
        content: item.content,
        source: item.source,
        added_at: item.added_at,
      })),
    });

    if (input.session_id) {
      const { ensureTaskForTurn } = await import("../TaskContext.js");
      await ensureTaskForTurn(input.session_id, encodedMessage, retrieval.intent).catch(
        () => undefined,
      );
    }

    // REL-07: new-task drops the previous C_goal; never keep an extracted title.
    if (retrieval.intent === "new_task") {
      PrefrontalCortex.clearGoal(input.session_id);
    }
    if (input.goal?.trim()) {
      PrefrontalCortex.setGoal(input.goal, input.session_id);
    } else if (plan.intent) {
      PrefrontalCortex.setGoal(plan.intent, input.session_id);
    }

    Thalamus.gateTurn(wm, {
      message: encodedMessage,
      framed: plan.framed,
      role: input.role ?? "user",
      intent: retrieval.intent,
      retrievalQuery: retrieval.retrievalQuery,
    });

    phases.push({
      phase: "working_memory",
      duration_ms: Date.now() - wmStart,
      success: true,
      detail: plan.intent ? `attention applied (intent: ${plan.intent.slice(0, 40)}…)` : "attention applied",
    });

    const goal = PrefrontalCortex.resolveGoal(input.goal, input.session_id);
    const config = getMemoryConfig();
    const mode = getModeSettings(config.memory_mode);

    // φ₆ — M(...) hippocampal fusion retrieval (expanded query, not raw follow-up)
    const retrievalStart = Date.now();
    const fusionResults = await Hippocampus.fusionRetrieve({
      message: encodedMessage,
      session_id: input.session_id,
      retrieval_query: retrieval.retrievalQuery,
      includeEpisodic: mode.includeEpisodic,
    });
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

    // φ₈ — Brainstem(...) consumes φ₆ hits; no second fusion/LIKE hunt
    const outputStart = Date.now();
    const context = await Brainstem.assemble({
      message: encodedMessage,
      session_id: input.session_id,
      max_tokens: getContextMaxTokens(input.max_tokens),
      memory_mode: config.memory_mode,
      goal,
      retrieval_query: retrieval.retrievalQuery,
      fusion_hits: fusionResults,
    });
    Brainstem.feedbackToThalamus(wm, context);
    phases.push({
      phase: "output_generation",
      duration_ms: Date.now() - outputStart,
      success: true,
      detail: `${context.items.length} items, context fenced`,
      audit: {
        retrieval_query: retrieval.retrievalQuery,
        item_count: context.items.length,
        items: context.items.map((item) => ({
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
      },
    });

    return {
      phases,
      context,
      encoded_message: encodedMessage,
      goal,
      fusion_hits: fusionResults.length,
    };
  },

  /** Human-readable summary of the Part I flow for diagnostics. */
  describeFlow(): string {
    return [
      "O(x) = Brainstem(M(Thalamus(Sensory(x))))",
      "  SensoryCortex  → φ₁ capture + φ₂ encode",
      "  PrefrontalCortex → φ₃ plan / task framing",
      "  Thalamus       → φ₃ attention gating (+ Amygdala→Prefrontal)",
      "  Hippocampus    → φ₆ fusion retrieval (M)",
      "  Brainstem      → φ₈ context assembly (+ Brainstem→Thalamus)",
      "  PrefrontalCortex → C_goal / plan integration (+ Hippocampus→Prefrontal)",
    ].join("\n");
  },

  canonicalPhaseOrder(): MemoryPhase[] {
    return [
      "sensory_input",
      "encoding",
      "working_memory",
      "retrieval",
      "output_generation",
    ];
  },
};
