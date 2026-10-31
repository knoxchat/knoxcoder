/**
 * BasalGanglia — procedural stage B_g (MEM-31).
 *
 *   H ─procedure→ B_g ─generate→ B_s
 *
 * Selects leftover procedures / learning patterns **before** Brainstem
 * (ContextBuilder) assembles C(q). Recipe matching stays off this path
 * until MEM-34 (recipes remain off by default; host hints use
 * `MemoryPipeline.noteRecipeInject`).
 */

import { BrainStore } from "../BrainStore.js";
import { ContextSections } from "../ContextSections.js";
import { LearningEngine } from "../LearningEngine.js";
import type { ContextCandidate } from "../selectContext.js";
import type { GoalType, LearnPatternInput } from "../types.js";

export interface BasalGangliaSelection {
  procedures: ContextCandidate[];
  patterns: ContextCandidate[];
}

export interface BasalGangliaSelectInput {
  query: string;
  includeProcedures?: boolean;
  includePatterns?: boolean;
}

export const BasalGanglia = {
  learnPattern: LearningEngine.learnPattern.bind(LearningEngine),
  suggestApproach: LearningEngine.suggestApproach.bind(LearningEngine),
  getPatterns: LearningEngine.getPatterns.bind(LearningEngine),
  addProcedure: BrainStore.addProcedure.bind(BrainStore),
  getAllProcedures: BrainStore.getAllProcedures.bind(BrainStore),
  searchProcedures: BrainStore.searchProcedures.bind(BrainStore),

  async recordSuccess(input: LearnPatternInput): Promise<number> {
    return LearningEngine.learnPattern({ ...input, success: true });
  },

  /**
   * Choose M₅ leftovers for this call. Always returns arrays (empty = none)
   * so ContextBuilder does not search procedures/patterns again.
   */
  async selectForTurn(input: BasalGangliaSelectInput): Promise<BasalGangliaSelection> {
    const query = input.query?.trim() ?? "";
    const procedures =
      input.includeProcedures && query
        ? await ContextSections.collectProcedureCandidates(query)
        : [];
    const patterns =
      input.includePatterns && query
        ? await ContextSections.collectPatternCandidates(query)
        : [];
    return { procedures, patterns };
  },
};

export type { GoalType, LearnPatternInput };
