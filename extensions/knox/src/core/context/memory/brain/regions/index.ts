/**
 * Brain region facades — Knox-MS neural architecture map (MEM-31 / IMP-02).
 *
 * Boxed O(x) = B_s(B_g(H(P(A(T(S(x)))))))
 *
 *   x ─encode→ S ─filter→ T ─weight→ A ─plan→ P
 *     ─recall/store→ H ─procedure→ B_g ─generate→ B_s → y
 *
 * Feedback:
 *   H→P  retrieved memory can re-plan (hint, never overwrite C_goal)
 *   B_s→H attribution (MEM-17)
 *   B_s→T turn t output is input at t+1
 */

export { NeuralArchitecture } from "./NeuralArchitecture.js";
export { SensoryCortex } from "./SensoryCortex.js";
export { Thalamus } from "./Thalamus.js";
export { PrefrontalCortex, formatMemoryGoal } from "./PrefrontalCortex.js";
export { Hippocampus } from "./Hippocampus.js";
export { Amygdala } from "./Amygdala.js";
export { BasalGanglia } from "./BasalGanglia.js";
export { Brainstem } from "./Brainstem.js";
export { BOXED_O_X, LIVE_ARROW, LIVE_FEEDBACK, LIVE_STAGES } from "./flow.js";
