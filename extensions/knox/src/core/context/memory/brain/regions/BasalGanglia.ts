/**
 * BasalGanglia — Procedural memory and pattern learning facade.
 * Wraps LearningEngine + BrainStore procedures.
 */

import { BrainStore } from "../BrainStore.js";
import { LearningEngine } from "../LearningEngine.js";
import type { GoalType, LearnPatternInput } from "../types.js";

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
};

export type { GoalType, LearnPatternInput };
