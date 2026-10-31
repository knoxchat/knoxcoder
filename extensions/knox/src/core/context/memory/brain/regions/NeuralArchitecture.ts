/**
 * NeuralArchitecture — Knox-MS Part I flow (MEM-31 / IMP-01 / IMP-02).
 *
 * Live path is MemoryPipeline.runPreTurn. This module only describes the
 * boxed composition and delegates so the two entry points stay one path.
 */

import { MemoryPipeline, type PipelineResult } from "../MemoryPipeline.js";
import type { BuildContextResult, MemoryPhase, PipelineInput, PipelinePhaseResult } from "../types.js";
import {
  BOXED_O_X,
  LIVE_ARROW,
  LIVE_FEEDBACK,
  LIVE_STAGES,
  type LiveStage,
} from "./flow.js";

export interface NeuralProcessResult {
  phases: PipelinePhaseResult[];
  context: BuildContextResult;
  encoded_message: string;
  goal?: string;
  fusion_hits: number;
  salience?: PipelineResult["salience"];
  procedural_hits?: number;
}

export const NeuralArchitecture = {
  /**
   * Same path as MemoryPipeline.runPreTurn:
   *   S → T → A → P → H → B_g → B_s
   */
  async processPreTurn(input: PipelineInput): Promise<NeuralProcessResult> {
    const result = await MemoryPipeline.runPreTurn(input);
    return {
      phases: result.phases,
      context: result.context ?? { context: "", items: [] },
      encoded_message: result.encoded_message ?? input.message,
      goal: result.goal,
      fusion_hits: result.fusion_hits ?? 0,
      salience: result.salience,
      procedural_hits: result.procedural_hits,
    };
  },

  /** Boxed O(x) plus stage map for diagnostics (IMP-01/02). */
  describeFlow(): string {
    return [
      BOXED_O_X,
      `  ${LIVE_ARROW}`,
      "  S  SensoryCortex     encode / φ₁+φ₂ → M₁",
      "  T  Thalamus          filter / attention",
      "  A  Amygdala          salience weight → I₀",
      "  P  PrefrontalCortex  plan / C_goal",
      "  H  Hippocampus       recall (φ₆)",
      "  B_g BasalGanglia     procedures / leftover M₅",
      "  B_s Brainstem        generate (φ₈)",
      "Feedback:",
      ...LIVE_FEEDBACK.map((line) => `  ${line}`),
    ].join("\n");
  },

  liveStageOrder(): LiveStage[] {
    return [...LIVE_STAGES];
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
