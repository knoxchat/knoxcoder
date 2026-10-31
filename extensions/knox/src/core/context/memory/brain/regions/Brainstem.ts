/**
 * Brainstem — generate stage B_s (MEM-31).
 *
 *   B_g ─generate→ B_s → y
 *
 * Assembles C(q) via ContextBuilder. Feedback:
 *   B_s→T  re-attend injected titles (this call)
 *   B_s→H  attribution is `MemoryPipeline.attributeTurn` (MEM-17)
 */

import { ContextBuilder, type AssembleContextInput } from "../ContextBuilder.js";
import { injectedItemPassedGate } from "../RelevanceGate.js";
import type { BuildContextResult } from "../types.js";
import type { WorkingMemory } from "../WorkingMemory.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";
import { Thalamus } from "./Thalamus.js";

export const Brainstem = {
  async assemble(input: AssembleContextInput): Promise<BuildContextResult> {
    const goal = PrefrontalCortex.resolveGoal(input.goal, input.session_id);
    return ContextBuilder.buildDetailed({ ...input, goal });
  },

  async assembleSimple(input: AssembleContextInput): Promise<string> {
    const result = await Brainstem.assemble(input);
    return result.context;
  },

  /**
   * B_s→T after context assembly.
   * REL-06: only re-attend titles that passed REL-03. Never boost gated-out items.
   */
  feedbackToThalamus(wm: WorkingMemory, result: BuildContextResult): void {
    const highlights = result.items
      .filter(injectedItemPassedGate)
      .map((i) => i.title)
      .filter(Boolean);
    Thalamus.feedbackFromBrainstem(wm, highlights);
  },
};
