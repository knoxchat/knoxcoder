/**
 * PrefrontalCortex — Goal/plan integration facade (φ₃ planning step).
 * REL-07: C_goal is session-scoped. Hippocampus/Amygdala feedback may
 * record a recent-knowledge hint, never overwrite the active goal.
 *
 * Part III φ₃: Working Memory = Thalamus(Prefrontal(x)) → M₂
 */

const DEFAULT_SESSION_KEY = "__default__";

interface SessionGoalState {
  goal: string | null;
  recentKnowledgeHint: string | null;
}

const sessionGoals = new Map<string, SessionGoalState>();
let activeSessionId: string | null = null;

function sessionKey(sessionId?: string | null): string {
  const explicit = sessionId?.trim();
  if (explicit) return explicit;
  return activeSessionId ?? DEFAULT_SESSION_KEY;
}

function getState(sessionId?: string | null): SessionGoalState {
  const key = sessionKey(sessionId);
  let state = sessionGoals.get(key);
  if (!state) {
    state = { goal: null, recentKnowledgeHint: null };
    sessionGoals.set(key, state);
  }
  return state;
}

export interface PrefrontalPlan {
  /** Input after prefrontal framing (may equal raw input). */
  framed: string;
  /** Extracted task intent for C_goal when no explicit goal is set. */
  intent?: string;
}

/** Truncate C_goal display text. Never concatenates retrieval expansion. */
export function formatMemoryGoal(
  userText: string,
  planTitle?: string,
): string | undefined {
  const plan = planTitle?.trim();
  if (plan) {
    return plan.length > 500 ? `${plan.slice(0, 500)}...` : plan;
  }
  const trimmed = userText?.trim();
  if (!trimmed) return undefined;
  const firstLine = trimmed.split(/\n/).find((l) => l.trim())?.trim() ?? trimmed;
  return firstLine.length > 500 ? `${firstLine.slice(0, 500)}...` : firstLine;
}

export const PrefrontalCortex = {
  /**
   * φ₃ planning step — frame raw input before Thalamus attention gating.
   * Lightweight intent extraction (no LLM): questions, imperatives, first clause.
   */
  plan(content: string): PrefrontalPlan {
    const trimmed = content.trim();
    if (!trimmed) return { framed: content };

    const firstLine = trimmed.split(/\n/).find((l) => l.trim())?.trim() ?? trimmed;
    let intent: string | undefined;

    const qIdx = firstLine.indexOf("?");
    if (qIdx >= 0) {
      intent = firstLine.slice(0, qIdx + 1).slice(0, 200);
    } else if (
      /^(please |can you |how |what |why |when |where |implement |fix |add |create |update |remove |build |refactor )/i.test(
        firstLine,
      )
    ) {
      intent = firstLine.slice(0, 200);
    }

    return { framed: trimmed, intent };
  },

  /**
   * Point C_goal lookups at `sessionId` without copying the previous session's goal.
   */
  switchSession(sessionId?: string | null): void {
    activeSessionId = sessionId?.trim() || null;
  },

  getActiveSessionId(): string | null {
    return activeSessionId;
  },

  setGoal(goal: string, sessionId?: string): void {
    const state = getState(sessionId);
    state.goal = goal.trim() || null;
  },

  getGoal(sessionId?: string): string | null {
    return getState(sessionId).goal;
  },

  /** Resolve C_goal: explicit input > this session's stored goal. */
  resolveGoal(explicit?: string, sessionId?: string): string | undefined {
    const trimmed = explicit?.trim();
    if (trimmed) return trimmed;
    return getState(sessionId).goal ?? undefined;
  },

  clearGoal(sessionId?: string): void {
    getState(sessionId).goal = null;
  },

  /** Test helper — drop every session's goal and hint. */
  resetAll(): void {
    sessionGoals.clear();
    activeSessionId = null;
  },

  /**
   * Hippocampus→Prefrontal: recent knowledge hint only. Never C_goal (REL-07).
   */
  feedbackFromHippocampus(
    extracted: { title?: string; category?: string },
    sessionId?: string,
  ): void {
    if (extracted.title && extracted.category !== "general") {
      getState(sessionId).recentKnowledgeHint = extracted.title;
    }
  },

  getRecentKnowledgeHint(sessionId?: string): string | null {
    return getState(sessionId).recentKnowledgeHint;
  },

  /**
   * Amygdala→Prefrontal: high-salience input must not set C_goal (REL-07).
   */
  feedbackFromAmygdala(_content: string, _salience: number): void {
    // Intentionally no-op for C_goal.
  },
};
