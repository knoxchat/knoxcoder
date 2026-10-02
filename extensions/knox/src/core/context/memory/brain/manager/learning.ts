/** Learning patterns and procedural memory. */

import { BrainStore } from "../BrainStore.js";
import { LearningEngine } from "../LearningEngine.js";
import type {
  LearnPatternInput,
  StoreProcedureInput,
} from "../types.js";
import { emit } from "./events.js";

// ── Learning Engine ────────────────────────────────────────────────────────

export async function learnPattern(input: LearnPatternInput): Promise<number> {
  const id = await LearningEngine.learnPattern(input);
  emit("pattern:learned", { id, goal_type: input.goal_type, signature: input.pattern_signature, success: input.success });
  return id;
}

export async function suggestApproach(query: string, goalType?: any, limit?: number) {
  return LearningEngine.suggestApproach(query, goalType, limit);
}

export async function getPatterns(goalType?: any, limit?: number) {
  return LearningEngine.getPatterns(goalType, limit);
}

// ── Procedural Memory ──────────────────────────────────────────────────────

export async function storeProcedure(input: StoreProcedureInput): Promise<number> {
  const id = await BrainStore.addProcedure({
    name: input.name,
    description: input.description,
    steps: input.steps,
    trigger_pattern: input.trigger_pattern,
    category: input.category ?? "general",
  });
  emit("procedure:stored", { id, name: input.name, steps_count: input.steps.length });
  return id;
}

export async function getProcedures(category?: string, limit?: number) {
  return BrainStore.getAllProcedures(category, limit);
}

export async function executeProcedure(id: number, success: boolean) {
  await BrainStore.recordProcedureExecution(id, success);
  const proc = await BrainStore.getProcedure(id);
  emit("procedure:executed", { id, success, name: proc?.name });
  return proc;
}
