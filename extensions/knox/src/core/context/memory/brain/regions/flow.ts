/**
 * Revised Knox-MS Part I — one live order (MEM-31).
 *
 * Boxed O(x) from the theorem page:
 *   O(x) = B_s(B_g(H(P(A(T(S(x)))))))
 *
 *   x ─encode→ S ─filter→ T ─weight→ A ─plan→ P
 *     ─recall/store→ H ─procedure→ B_g ─generate→ B_s → y
 *
 * Feedback: H→P (re-plan hint), B_s→H (attribution), B_s→T (t output → t+1).
 */

export const BOXED_O_X = "O(x) = B_s(B_g(H(P(A(T(S(x)))))))";

export const LIVE_STAGES = ["S", "T", "A", "P", "H", "B_g", "B_s"] as const;
export type LiveStage = (typeof LIVE_STAGES)[number];

export const LIVE_ARROW =
  "x → S → T → A → P → H → B_g → B_s → y";

export const LIVE_FEEDBACK = [
  "H→P retrieved memory can re-plan (hint, never overwrite C_goal)",
  "B_s→H attribution (MEM-17)",
  "B_s→T turn t output is input at t+1",
] as const;
