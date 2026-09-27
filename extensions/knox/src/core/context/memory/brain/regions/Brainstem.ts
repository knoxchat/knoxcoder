/**
 * Brainstem — Final context assembly facade (φ₈).
 * Wraps ContextBuilder. Sends Brainstem→Thalamus feedback after assembly.
 */

import { ContextBuilder } from "../ContextBuilder.js";
import { injectedItemPassedGate } from "../RelevanceGate.js";
import type { BuildContextInput, BuildContextResult } from "../types.js";
import type { WorkingMemory } from "../WorkingMemory.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";
import { Thalamus } from "./Thalamus.js";

export const Brainstem = {
  async assemble(input: BuildContextInput): Promise<BuildContextResult> {
    const goal = PrefrontalCortex.resolveGoal(input.goal, input.session_id);
    return ContextBuilder.buildDetailed({ ...input, goal });
  },

  async assembleSimple(input: BuildContextInput): Promise<string> {
    const goal = PrefrontalCortex.resolveGoal(input.goal, input.session_id);
    return ContextBuilder.build({ ...input, goal });
  },

  /**
   * Brainstem→Thalamus feedback loop after context assembly.
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
