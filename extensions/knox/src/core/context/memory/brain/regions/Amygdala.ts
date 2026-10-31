/**
 * Amygdala — salience weighting stage A (MEM-31).
 *
 *   S ─filter→ T ─weight→ A ─plan→ P
 *
 * A is a live stage: it always produces I₀ (initial importance) and valence
 * for the current turn. It is not a 0.55 working-memory slot gate.
 */

import { BrainStore } from "../BrainStore.js";
import type { EmotionalValence } from "../types.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";

export interface AmygdalaWeight {
  salience: number;
  valence: EmotionalValence;
  /** Initial importance I₀ ∈ [0, 1] from salience weighting. */
  i0: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export const Amygdala = {
  computeSalience(content: string, role: string, importance: number): number {
    return BrainStore.computeSalience(content, role, importance);
  },

  detectEmotionalValence(content: string, role: string): EmotionalValence {
    return BrainStore.detectEmotionalValence(content, role);
  },

  /**
   * Weight the filtered turn. I₀ is the salience score itself (already
   * blended with an importance prior inside `computeSalience`).
   */
  weight(content: string, role = "user", importance = 0.5): AmygdalaWeight {
    const salience = clamp01(Amygdala.computeSalience(content, role, importance));
    const valence = Amygdala.detectEmotionalValence(content, role);
    return { salience, valence, i0: salience };
  },

  /** A→P: record a salience hint. Never sets C_goal (REL-07). */
  notifyPrefrontal(content: string, weight: AmygdalaWeight, sessionId?: string): void {
    PrefrontalCortex.feedbackFromAmygdala(content, weight.salience, sessionId);
  },
};
