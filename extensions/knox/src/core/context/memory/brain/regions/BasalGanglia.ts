/**
 * BasalGanglia — procedural stage B_g (MEM-31).
 *
 *   H ─procedure→ B_g ─generate→ B_s
 *
 * Selects leftover procedures / learning patterns **before** Brainstem
 * (ContextBuilder) assembles C(q). Product M₅ is live recipes: leftovers
 * yield on the same intent fingerprint (MEM-37). Host hints still use
 * `MemoryPipeline.noteRecipeInject`.
 */

import { BrainStore } from "../BrainStore.js";
import { ContextSections } from "../ContextSections.js";
import { LearningEngine } from "../LearningEngine.js";
import {
  leftoverCoveredByFingerprints,
  leftoverFingerprints,
  loadLiveRecipeCoverage,
} from "../m5Surface.js";
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
    const coverage = await loadLiveRecipeCoverage();
    if (
      leftoverCoveredByFingerprints(
        leftoverFingerprints([input.pattern_signature, input.description]),
        coverage.fingerprints,
      )
    ) {
      return 0;
    }
    return LearningEngine.learnPattern({ ...input, success: true });
  },

  /**
   * Choose leftover M₅ for this call. Covered leftovers are already dropped
   * in ContextSections (MEM-37). Always returns arrays (empty = none) so
   * ContextBuilder does not search procedures/patterns again.
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
