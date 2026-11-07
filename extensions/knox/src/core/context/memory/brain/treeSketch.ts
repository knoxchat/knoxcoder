/**
 * MEM-53 — term sketches on the summary tree (φ₅).
 *
 * Every ancestor keeps a sketch of all descendant leaves:
 *   - a Bloom filter over exact terms (no false negatives, so exact-term
 *     routing never drops the right subtree), and
 *   - top-term counts.
 *
 * A leaf keeps its own term list (full text, not the 400-char display text),
 * so an exact term anywhere in a leaf is routable.
 *
 * Lexical only. No embeddings.
 */

import { contentWords, RETRIEVAL_STOPWORDS } from "./RetrievalQuery.js";

export const SKETCH_MIN_TERM_LEN = 3;
const BLOOM_HASHES = 3;
const BLOOM_BASE_BITS = 2048;
const BLOOM_MAX_BITS = 1 << 17;
/** Terms kept per leaf. */
export const LEAF_TERM_CAP = 200;
/** Top-term counts kept per node. */
export const NODE_TERM_CAP = 128;
const COUNT_PRUNE_AT = 256;

export type TermCounts = Record<string, number>;

/** Unique, lowercase terms: content words plus raw identifier-ish tokens. */
export function sketchTerms(text: string, cap = LEAF_TERM_CAP): string[] {
  const out = new Set<string>();
  for (const w of contentWords(text)) {
    const t = w.toLowerCase();
    if (t.length >= SKETCH_MIN_TERM_LEN) out.add(t);
  }
  const raw = String(text ?? "").toLowerCase().match(/[\p{L}\p{N}_][\p{L}\p{N}_./-]*/gu) ?? [];
  for (const t of raw) {
    if (t.length >= SKETCH_MIN_TERM_LEN && !RETRIEVAL_STOPWORDS.has(t)) out.add(t);
  }
  return [...out].slice(0, cap);
}

/** Bloom bits for a node of the given height (0 = holds leaves directly). */
export function bloomBitsForHeight(height: number): number {
  const h = Math.max(0, Math.floor(Number.isFinite(height) ? height : 0));
  return Math.min(BLOOM_MAX_BITS, BLOOM_BASE_BITS * 4 ** h);
}

export function bloomNew(bits: number): Uint8Array {
  return new Uint8Array(Math.max(1, Math.ceil(bits / 8)));
}

function fnv1a(term: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function bitPositions(term: string, bits: number): number[] {
  const h1 = fnv1a(term, 0);
  const h2 = fnv1a(term, 0x9e3779b9) | 1;
  const out: number[] = [];
  for (let i = 0; i < BLOOM_HASHES; i++) {
    out.push(((h1 + Math.imul(i, h2)) >>> 0) % bits);
  }
  return out;
}

export function bloomAdd(bloom: Uint8Array, term: string): void {
  const bits = bloom.length * 8;
  for (const p of bitPositions(term, bits)) bloom[p >> 3]! |= 1 << (p & 7);
}

export function bloomHas(bloom: Uint8Array, term: string): boolean {
  const bits = bloom.length * 8;
  for (const p of bitPositions(term, bits)) {
    if (((bloom[p >> 3] ?? 0) & (1 << (p & 7))) === 0) return false;
  }
  return true;
}

export function bloomFromTerms(terms: Iterable<string>, bits: number): Uint8Array {
  const bloom = bloomNew(bits);
  for (const t of terms) bloomAdd(bloom, t);
  return bloom;
}

export function mergeTermCounts(counts: TermCounts, terms: Iterable<string>): TermCounts {
  for (const t of terms) counts[t] = (counts[t] ?? 0) + 1;
  return Object.keys(counts).length > COUNT_PRUNE_AT ? pruneTermCounts(counts) : counts;
}

export function pruneTermCounts(counts: TermCounts, cap = NODE_TERM_CAP): TermCounts {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.slice(0, cap));
}

export function serializeTermCounts(counts: TermCounts): string {
  return JSON.stringify(pruneTermCounts(counts));
}

export function parseTermCounts(raw: unknown): TermCounts {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TermCounts = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeLeafTerms(terms: readonly string[]): string {
  return JSON.stringify(terms.slice(0, LEAF_TERM_CAP));
}

export function parseLeafTerms(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function toBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return null;
}

export const SKETCH_WEIGHT = 0.5;
export const TOP_TERM_WEIGHT = 0.1;

/**
 * Routing score of a node from its sketch alone, in [0, 0.6].
 * Bloom containment = share of query terms present anywhere below the node.
 * Top-term share = share of query terms among the node's most frequent terms.
 */
export function sketchScore(
  queryTerms: readonly string[],
  bloom: Uint8Array | null,
  counts: TermCounts | null,
): number {
  if (queryTerms.length === 0) return 0;
  let inBloom = 0;
  let inTop = 0;
  for (const t of queryTerms) {
    if (bloom && bloomHas(bloom, t)) inBloom++;
    if (counts && counts[t] != null) inTop++;
  }
  return (
    SKETCH_WEIGHT * (inBloom / queryTerms.length) + TOP_TERM_WEIGHT * (inTop / queryTerms.length)
  );
}

/** Leaf routing score from its exact term list. */
export function leafSketchScore(queryTerms: readonly string[], leafTerms: readonly string[]): number {
  if (queryTerms.length === 0 || leafTerms.length === 0) return 0;
  const have = new Set(leafTerms);
  let hit = 0;
  for (const t of queryTerms) if (have.has(t)) hit++;
  return SKETCH_WEIGHT * (hit / queryTerms.length);
}
