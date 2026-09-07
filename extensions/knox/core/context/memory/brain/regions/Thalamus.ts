/**
 * Thalamus — Attention gating facade (φ₃).
 * Wraps WorkingMemory.attendTo(). Receives Brainstem→Thalamus feedback.
 *
 * REL-06: high-salience input occupies a single `current-turn` slot that
 * replaces the previous one (never `salient:${Date.now()}` accumulation).
 * New-task / topic-shift flushes M₂; continuation attends the expanded query.
 */

import type { WorkingMemory } from "../WorkingMemory.js";
import { CURRENT_TURN_SLOT_ID } from "../WorkingMemory.js";
import type { RetrievalIntent } from "../RetrievalQuery.js";
import { Amygdala } from "./Amygdala.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";

/** Amygdala→Thalamus: only this salience or higher earns an explicit WM slot. */
export const WM_SALIENCE_SLOT_THRESHOLD = 0.55;

export interface ThalamusGateTurnInput {
  message: string;
  framed?: string;
  role?: string;
  intent: RetrievalIntent;
  retrievalQuery?: string;
}

export const Thalamus = {
  /** Gate attention to query-relevant working memory items. */
  attend(wm: WorkingMemory, query: string, role = "user"): void {
    const salience = Amygdala.computeSalience(query, role, 0.5);
    wm.attendTo(query);
    Thalamus.upsertCurrentTurn(wm, query, role, salience);
  },

  /**
   * REL-06: at most one current-turn scratch slot. Replaces the previous
   * turn's salient content instead of appending a new id.
   */
  upsertCurrentTurn(
    wm: WorkingMemory,
    query: string,
    role = "user",
    salience?: number,
  ): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    const sal = salience ?? Amygdala.computeSalience(trimmed, role, 0.5);
    if (sal < WM_SALIENCE_SLOT_THRESHOLD) return;

    wm.add({
      id: CURRENT_TURN_SLOT_ID,
      content: trimmed.slice(0, 800),
      source: "user",
      relevance: sal,
      metadata: {
        valence: Amygdala.detectEmotionalValence(trimmed, role),
        salience: sal,
      },
    });
    // REL-07: amygdala must not set C_goal; hook remains for future salience hints.
    PrefrontalCortex.feedbackFromAmygdala(trimmed, sal);
  },

  /**
   * REL-06 pre-turn M₂ gating: flush on new-task, attend expanded query on
   * continuation so Task A is not decayed by `"continue"`.
   */
  gateTurn(wm: WorkingMemory, input: ThalamusGateTurnInput): void {
    const role = input.role ?? "user";
    if (input.intent === "new_task") {
      wm.flushOnTopicShift();
    }

    if (input.intent === "continuation" && input.retrievalQuery?.trim()) {
      wm.attendTo(input.retrievalQuery);
      Thalamus.upsertCurrentTurn(wm, input.message, role);
      return;
    }

    Thalamus.attend(wm, input.framed ?? input.message, role);
  },

  /** Brainstem→Thalamus feedback: re-focus on assembled context highlights. */
  feedbackFromBrainstem(wm: WorkingMemory, highlights: string[]): void {
    for (const text of highlights.slice(0, 3)) {
      if (text.trim()) wm.attendTo(text);
    }
  },
};
