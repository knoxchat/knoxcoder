/**
 * MEM-29 — budgeted submodular selection + start/end sandwich.
 *
 * Part VII replaces leftover per-section quotas. Every source competes on
 * marginal value per token:
 *
 *   F(X) = Σ_{m∈X} score(m,q) + λ Σ_{c∈Cand} score(c,q) · max_{m∈X} sim(c,m)
 *
 * λ = 0.5, max over ∅ is 0. F is monotone submodular, so lazy greedy
 * (better of value-greedy and value-per-token-greedy) is a ½(1−1/e)
 * approximation. sim is trigram / entity Jaccard — near-duplicates add
 * almost no coverage. Highest-scoring items sit at the start and end of
 * the memory block (lost-in-the-middle sandwich).
 *
 * Lexical only: no embeddings, vector index, or neural rerank.
 */

import type { InjectedMemoryItem } from "./types.js";

export const COVERAGE_LAMBDA_DEFAULT = 0.5;
/** Rank-1 RRF with k₀=60. Used to put non-fusion sources on the same scale. */
export const RANK1_RRF = 1 / 61;
const EPS = 1e-12;

export type ContextCandidateKind =
  | "semantic"
  | "episodic"
  | "entity"
  | "procedure"
  | "pattern"
  | "summary"
  | "recipe";

export type SelectStrategy = "value" | "value-per-token";

export interface CoverageFeatures {
  trigrams: ReadonlySet<string>;
  entities: ReadonlySet<string>;
}

export interface ContextCandidate {
  key: string;
  kind: ContextCandidateKind;
  /** score(m, q) from fusion or a rank-scaled lexical stand-in. */
  score: number;
  tokens: number;
  text: string;
  features: CoverageFeatures;
  item: InjectedMemoryItem;
  /**
   * Pins and full-mode session summary. Absorbed after greedy if they
   * still fit — they do not reserve quota ahead of higher-value items.
   */
  mustKeep?: boolean;
  /** LIKE-assembled semantic rows record inject_count (MEM-16). */
  recordInject?: boolean;
}

export interface SelectContextResult {
  selected: ContextCandidate[];
  /** Sandwich order of `selected`. */
  ordered: ContextCandidate[];
  objective: number;
  strategy: SelectStrategy;
  valueObjective: number;
  densityObjective: number;
  tokens: number;
}

export interface SelectContextOptions {
  lambda?: number;
  /** Default true. */
  absorbMustKeep?: boolean;
}

export function characterTrigrams(text: string): Set<string> {
  const trigrams = new Set<string>();
  const normalized = ` ${String(text ?? "").replace(/\s+/g, " ").trim()} `;
  if (normalized.length < 3) return trigrams;
  for (let i = 0; i < normalized.length - 2; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

export function jaccardSets(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * sim(c, m): trigram Jaccard, or the better of trigram and entity Jaccard
 * when both sides name entities.
 */
export function coverageSimilarity(a: CoverageFeatures, b: CoverageFeatures): number {
  const trigram = jaccardSets(a.trigrams, b.trigrams);
  if (a.entities.size === 0 || b.entities.size === 0) return trigram;
  return Math.max(trigram, jaccardSets(a.entities, b.entities));
}

export function coverageFeatures(text: string, entities: readonly string[] = []): CoverageFeatures {
  const names = new Set<string>();
  for (const raw of entities) {
    const key = raw.trim().toLowerCase();
    if (key) names.add(key);
  }
  return {
    trigrams: characterTrigrams(text),
    entities: names,
  };
}

export function rankScaledScore(rank: number, overlap = 1, k0 = 60): number {
  const r = Number.isFinite(rank) && rank >= 1 ? Math.floor(rank) : 1;
  const k = Number.isFinite(k0) && k0 > 0 ? k0 : 60;
  const frac = Math.max(0, Math.min(1, overlap));
  return (frac * 1) / (k + r);
}

export function submodularObjective(
  selected: readonly ContextCandidate[],
  pool: readonly ContextCandidate[],
  lambda = COVERAGE_LAMBDA_DEFAULT,
): number {
  if (selected.length === 0) return 0;
  const lam = Number.isFinite(lambda) ? Math.max(0, lambda) : COVERAGE_LAMBDA_DEFAULT;
  let relevance = 0;
  for (const m of selected) relevance += Math.max(0, m.score);
  let coverage = 0;
  for (const c of pool) {
    let best = 0;
    for (const m of selected) {
      const sim = coverageSimilarity(c.features, m.features);
      if (sim > best) best = sim;
    }
    coverage += Math.max(0, c.score) * best;
  }
  return relevance + lam * coverage;
}

/**
 * Highest at the start, second-highest at the end, then fill inward
 * (even ranks front, odd ranks back reversed).
 */
export function sandwichOrder<T extends { score: number; key?: string }>(items: readonly T[]): T[] {
  if (items.length <= 1) return [...items];
  const ranked = [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ak = a.key ?? "";
    const bk = b.key ?? "";
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  const front: T[] = [];
  const back: T[] = [];
  for (let i = 0; i < ranked.length; i++) {
    if (i % 2 === 0) front.push(ranked[i]!);
    else back.push(ranked[i]!);
  }
  back.reverse();
  return [...front, ...back];
}

export function selectBudgetedSubmodular(
  candidates: readonly ContextCandidate[],
  budget: number,
  options: SelectContextOptions = {},
): SelectContextResult {
  const lambda = Number.isFinite(options.lambda)
    ? Math.max(0, options.lambda as number)
    : COVERAGE_LAMBDA_DEFAULT;
  const absorb = options.absorbMustKeep !== false;
  const cap = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  const pool = dedupeCandidates(candidates).filter((c) => c.tokens > 0 && c.tokens <= cap);

  const empty: SelectContextResult = {
    selected: [],
    ordered: [],
    objective: 0,
    strategy: "value",
    valueObjective: 0,
    densityObjective: 0,
    tokens: 0,
  };
  if (pool.length === 0 || cap <= 0) return empty;

  const valueSet = lazyGreedy(pool, cap, lambda, "value");
  const densitySet = lazyGreedy(pool, cap, lambda, "value-per-token");
  const valueObjective = submodularObjective(valueSet, pool, lambda);
  const densityObjective = submodularObjective(densitySet, pool, lambda);

  let selected = valueSet;
  let strategy: SelectStrategy = "value";
  let objective = valueObjective;
  if (densityObjective > valueObjective + EPS) {
    selected = densitySet;
    strategy = "value-per-token";
    objective = densityObjective;
  } else if (Math.abs(densityObjective - valueObjective) <= EPS) {
    const valueTokens = tokenSum(valueSet);
    const densityTokens = tokenSum(densitySet);
    if (densitySet.length > valueSet.length || densityTokens < valueTokens) {
      selected = densitySet;
      strategy = "value-per-token";
      objective = densityObjective;
    }
  }

  if (absorb) {
    selected = absorbMustKeep(selected, pool, cap);
    objective = submodularObjective(selected, pool, lambda);
  }

  const ordered = sandwichOrder(selected);
  return {
    selected,
    ordered,
    objective,
    strategy,
    valueObjective,
    densityObjective,
    tokens: tokenSum(selected),
  };
}

function dedupeCandidates(candidates: readonly ContextCandidate[]): ContextCandidate[] {
  const seen = new Set<string>();
  const out: ContextCandidate[] = [];
  for (const raw of candidates) {
    const key = String(raw.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    const tokens = Math.max(0, Math.ceil(Number(raw.tokens) || 0));
    const score = Number.isFinite(raw.score) ? Math.max(0, raw.score) : 0;
    if (tokens <= 0) continue;
    seen.add(key);
    out.push({ ...raw, key, tokens, score });
  }
  return out;
}

function tokenSum(items: readonly ContextCandidate[]): number {
  let n = 0;
  for (const item of items) n += item.tokens;
  return n;
}

function absorbMustKeep(
  selected: ContextCandidate[],
  pool: readonly ContextCandidate[],
  budget: number,
): ContextCandidate[] {
  const have = new Set(selected.map((s) => s.key));
  let used = tokenSum(selected);
  const extra: ContextCandidate[] = [];
  for (const cand of pool) {
    if (!cand.mustKeep || have.has(cand.key)) continue;
    if (used + cand.tokens > budget) continue;
    extra.push(cand);
    have.add(cand.key);
    used += cand.tokens;
  }
  return extra.length === 0 ? selected : [...selected, ...extra];
}

type HeapEntry = { key: string; bound: number; gen: number };

function lazyGreedy(
  pool: readonly ContextCandidate[],
  budget: number,
  lambda: number,
  mode: SelectStrategy,
): ContextCandidate[] {
  const byKey = new Map(pool.map((c) => [c.key, c]));
  const selected: ContextCandidate[] = [];
  const selectedKeys = new Set<string>();
  const maxSim = new Map<string, number>();
  let used = 0;

  const heap: HeapEntry[] = [];
  for (const cand of pool) {
    const gain = marginalGain(cand, pool, maxSim, lambda);
    heapPush(heap, { key: cand.key, bound: priority(gain, cand.tokens, mode), gen: 0 });
  }

  while (heap.length > 0 && used < budget) {
    const top = heapPop(heap);
    if (!top) break;
    const cand = byKey.get(top.key);
    if (!cand || selectedKeys.has(cand.key)) continue;
    if (used + cand.tokens > budget) continue;

    if (top.gen !== selected.length) {
      const gain = marginalGain(cand, pool, maxSim, lambda);
      const bound = priority(gain, cand.tokens, mode);
      if (bound <= EPS) continue;
      heapPush(heap, { key: cand.key, bound, gen: selected.length });
      continue;
    }

    if (top.bound <= EPS) continue;
    selected.push(cand);
    selectedKeys.add(cand.key);
    used += cand.tokens;
    for (const c of pool) {
      const sim = coverageSimilarity(c.features, cand.features);
      const prev = maxSim.get(c.key) ?? 0;
      if (sim > prev) maxSim.set(c.key, sim);
    }
  }

  return selected;
}

function marginalGain(
  item: ContextCandidate,
  pool: readonly ContextCandidate[],
  maxSim: ReadonlyMap<string, number>,
  lambda: number,
): number {
  let coverage = 0;
  for (const c of pool) {
    const sim = coverageSimilarity(c.features, item.features);
    const prev = maxSim.get(c.key) ?? 0;
    if (sim > prev) coverage += Math.max(0, c.score) * (sim - prev);
  }
  return Math.max(0, item.score) + lambda * coverage;
}

function priority(gain: number, tokens: number, mode: SelectStrategy): number {
  if (mode === "value") return gain;
  const cost = Math.max(1, tokens);
  return gain / cost;
}

function heapPush(heap: HeapEntry[], entry: HeapEntry): void {
  heap.push(entry);
  siftUp(heap, heap.length - 1);
}

function heapPop(heap: HeapEntry[]): HeapEntry | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    siftDown(heap, 0);
  }
  return top;
}

function heapBetter(a: HeapEntry, b: HeapEntry): boolean {
  if (a.bound !== b.bound) return a.bound > b.bound;
  return a.key < b.key;
}

function siftUp(heap: HeapEntry[], index: number): void {
  let i = index;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!heapBetter(heap[i]!, heap[parent]!)) break;
    swap(heap, i, parent);
    i = parent;
  }
}

function siftDown(heap: HeapEntry[], index: number): void {
  let i = index;
  const n = heap.length;
  while (true) {
    const left = i * 2 + 1;
    const right = left + 1;
    let best = i;
    if (left < n && heapBetter(heap[left]!, heap[best]!)) best = left;
    if (right < n && heapBetter(heap[right]!, heap[best]!)) best = right;
    if (best === i) break;
    swap(heap, i, best);
    i = best;
  }
}

function swap(heap: HeapEntry[], i: number, j: number): void {
  const tmp = heap[i]!;
  heap[i] = heap[j]!;
  heap[j] = tmp;
}
