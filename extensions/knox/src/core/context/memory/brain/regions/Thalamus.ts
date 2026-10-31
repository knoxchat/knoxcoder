/**
 * Thalamus — filter / attention stage T (MEM-31).
 *
 *   S ─filter→ T ─weight→ A
 *
 * T scopes and attends. Salience I₀ is A's job — T does not decide whether
 * the current turn exists in M₂ by a 0.55 cutoff.
 *
 * REL-06: new-task / topic-shift flushes M₂; continuation attends the
 * expanded query. Current-turn is a single replaced slot.
 */

import type { WorkingMemory } from "../WorkingMemory.js";
import { CURRENT_TURN_SLOT_ID } from "../WorkingMemory.js";
import type { RetrievalIntent } from "../RetrievalQuery.js";
import { Amygdala, type AmygdalaWeight } from "./Amygdala.js";

/** Leftover: high-salience marker only. A always writes I₀ onto current-turn. */
export const WM_SALIENCE_SLOT_THRESHOLD = 0.55;

export interface ThalamusGateTurnInput {
  message: string;
  framed?: string;
  role?: string;
  intent: RetrievalIntent;
  retrievalQuery?: string;
}

export const Thalamus = {
  /**
   * T only: attend the query. Does not write a salience-gated slot.
   * Convenience `attend` still applies A so standalone callers get T→A.
   */
  filterAndAttend(wm: WorkingMemory, query: string): void {
    wm.attendTo(query);
  },

  /** Gate attention to query-relevant working memory items (T then A). */
  attend(wm: WorkingMemory, query: string, role = "user"): void {
    Thalamus.filterAndAttend(wm, query);
    const weight = Amygdala.weight(query, role);
    Thalamus.applySalience(wm, query, weight, role);
  },

  /**
   * Write the current-turn M₂ slot with A's I₀ as relevance.
   * Always upserts — salience weights the slot, it does not gate it.
   */
  applySalience(
    wm: WorkingMemory,
    query: string,
    weight: AmygdalaWeight,
    role = "user",
    sessionId?: string,
  ): void {
    const trimmed = query.trim();
    if (!trimmed) {
      Amygdala.notifyPrefrontal(query, weight, sessionId);
      return;
    }

    wm.add({
      id: CURRENT_TURN_SLOT_ID,
      content: trimmed.slice(0, 800),
      source: "user",
      relevance: weight.i0,
      metadata: {
        valence: weight.valence,
        salience: weight.salience,
        i0: weight.i0,
      },
    });
    Amygdala.notifyPrefrontal(trimmed, weight, sessionId);
  },

  /**
   * REL-06: at most one current-turn scratch slot. Replaces the previous
   * turn's content instead of appending a new id.
   */
  upsertCurrentTurn(
    wm: WorkingMemory,
    query: string,
    role = "user",
    salience?: number,
  ): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    const weight =
      salience != null
        ? {
            salience,
            valence: Amygdala.detectEmotionalValence(trimmed, role),
            i0: salience,
          }
        : Amygdala.weight(trimmed, role);
    Thalamus.applySalience(wm, trimmed, weight, role);
  },

  /**
   * T: flush on new-task, attend expanded query on continuation.
   * A is applied by `gateTurn` / the live pipeline after this returns.
   */
  filterTurn(wm: WorkingMemory, input: ThalamusGateTurnInput): void {
    if (input.intent === "new_task") {
      wm.flushOnTopicShift();
    }

    if (input.intent === "continuation" && input.retrievalQuery?.trim()) {
      wm.attendTo(input.retrievalQuery);
      return;
    }

    Thalamus.filterAndAttend(wm, input.framed ?? input.message);
  },

  /**
   * Standalone T→A (tests / isolated `runPhase`). Live `runPreTurn`
   * calls `filterTurn` then `Amygdala.weight` then `applySalience`.
   */
  gateTurn(wm: WorkingMemory, input: ThalamusGateTurnInput): void {
    const role = input.role ?? "user";
    Thalamus.filterTurn(wm, input);
    const weight = Amygdala.weight(input.message, role);
    Thalamus.applySalience(wm, input.message, weight, role);
  },

  /** B_s→T: re-focus on assembled context highlights. */
  feedbackFromBrainstem(wm: WorkingMemory, highlights: string[]): void {
    for (const text of highlights.slice(0, 3)) {
      if (text.trim()) wm.attendTo(text);
    }
  },
};
