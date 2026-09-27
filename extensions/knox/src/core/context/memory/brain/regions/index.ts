/**
 * Brain region facades — Knox-MS neural architecture map (IMP-02).
 *
 * Part I flow: O(x) = Brainstem(M(Thalamus(Sensory(x))))
 *
 * Feedback loops:
 *   Hippocampus → PrefrontalCortex (H→P)
 *   Brainstem → Thalamus (Bs→T)
 *   Amygdala → PrefrontalCortex via Thalamus (A→P)
 */

export { NeuralArchitecture } from "./NeuralArchitecture.js";
export { SensoryCortex } from "./SensoryCortex.js";
export { Thalamus } from "./Thalamus.js";
export { PrefrontalCortex, formatMemoryGoal } from "./PrefrontalCortex.js";
export { Hippocampus } from "./Hippocampus.js";
export { Amygdala } from "./Amygdala.js";
export { BasalGanglia } from "./BasalGanglia.js";
export { Brainstem } from "./Brainstem.js";
