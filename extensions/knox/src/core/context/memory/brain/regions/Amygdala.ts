/**
 * Amygdala — Salience and emotional valence facade.
 * @deprecated K-073: not on the ContextBuilder / buildContext hot path.
 * Wraps BrainStore salience computation. No logic duplication.
 */

import { BrainStore } from "../BrainStore.js";
import type { EmotionalValence } from "../types.js";

export const Amygdala = {
  computeSalience(content: string, role: string, importance: number): number {
    return BrainStore.computeSalience(content, role, importance);
  },

  detectEmotionalValence(content: string, role: string): EmotionalValence {
    return BrainStore.detectEmotionalValence(content, role);
  },
};
