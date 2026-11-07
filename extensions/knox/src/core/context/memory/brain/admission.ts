/**
 * MEM-60 / MEM-61 — admission: which fused candidates are injected, and with
 * what probability each one was selected.
 *
 * The live policy is a mixture: with probability 1 − ε the greedy ranking
 * (U from counts), with probability ε a Thompson ranking (U drawn from
 * Beta(h + κ I₀, u + κ (1 − I₀))). `P(selected)` of a memory is
 *
 *     (1 − ε) · 1[kept by greedy] + ε · q,   q = share of simulated Thompson
 *                                              rankings that keep it
 *
 * and is logged on the attribution row. MEM-61 weights by 1 / propensity.
 * Pure: the cut is injected, the RNG is injected.
 */

import { priorModulation } from "./Value.js";
import { selectionPropensity, thompsonUtility, type Rng } from "./thompson.js";

export const EXPLORE_SIMULATIONS = 8;

export interface AdmissionItem {
  key: string;
  /** Final score this call used (already includes any Thompson draw for U). */
  score: number;
  /** (1 + η_U U)(1 + η_R R) that `score` already contains. */
  priorFactor: number;
  /** R(t, S) of the memory. */
  retrievability: number;
  /** Utility used for `score`. */
  utilityUsed: number;
  /** Greedy utility U(h, u, I₀). */
  utilityGreedy: number;
  helpful: number;
  unhelpful: number;
  i0: number;
  pinned: boolean;
}

export interface AdmissionRanked {
  key: string;
  score: number;
  pinned: boolean;
}

export interface AdmissionPlanInput {
  items: readonly AdmissionItem[];
  etaU: number;
  etaR: number;
  kappa: number;
  /** Rank by score, then slice / threshold. Returns the kept rows in order. */
  cut: (ranked: AdmissionRanked[]) => AdmissionRanked[];
  limit: number;
  rate: number;
  rng: Rng;
  explored: boolean;
  simulations?: number;
}

export interface AdmissionPlan {
  /** Kept keys, best first, for the call as it actually ran. */
  final: string[];
  greedy: Set<string>;
  propensity: Map<string, number>;
}

function scoreAt(item: AdmissionItem, utility: number, etaU: number, etaR: number): number {
  if (!(item.score > 0)) return 0;
  const core = item.score / Math.max(1, item.priorFactor);
  return core * priorModulation(utility, item.retrievability, etaU, etaR);
}

function keptKeys(
  items: readonly AdmissionItem[],
  scoreOf: (item: AdmissionItem) => number,
  input: Pick<AdmissionPlanInput, "cut" | "limit">,
): string[] {
  const ranked = items
    .map((item) => ({ key: item.key, score: scoreOf(item), pinned: item.pinned }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return input.cut(ranked).slice(0, input.limit).map((r) => r.key);
}

export function planAdmission(input: AdmissionPlanInput): AdmissionPlan {
  const { items, etaU, etaR, kappa } = input;
  const greedyScore = (item: AdmissionItem) => scoreAt(item, item.utilityGreedy, etaU, etaR);
  const greedyList = keptKeys(items, greedyScore, input);
  const greedy = new Set(greedyList);
  const final = input.explored
    ? keptKeys(items, (item) => Math.max(0, item.score), input)
    : greedyList;

  const propensity = new Map<string, number>();
  const rate = Math.max(0, Math.min(1, Number.isFinite(input.rate) ? input.rate : 0));
  if (rate <= 0) {
    for (const key of final) propensity.set(key, 1);
    return { final, greedy, propensity };
  }

  const sims = Math.max(1, input.simulations ?? EXPLORE_SIMULATIONS);
  const inclusion = new Map<string, number>();
  for (let k = 0; k < sims; k++) {
    const draws = new Map<string, number>();
    for (const item of items) {
      draws.set(item.key, thompsonUtility(item.helpful, item.unhelpful, item.i0, kappa, input.rng));
    }
    const kept = keptKeys(items, (item) => scoreAt(item, draws.get(item.key) ?? item.utilityGreedy, etaU, etaR), input);
    for (const key of kept) inclusion.set(key, (inclusion.get(key) ?? 0) + 1 / sims);
  }
  for (const key of final) {
    // Floor at the smallest nonzero estimate: a kept row was selectable, so p > 0.
    const p = selectionPropensity(greedy.has(key), inclusion.get(key) ?? 0, rate);
    propensity.set(key, Math.max(p, rate / sims));
  }
  return { final, greedy, propensity };
}
