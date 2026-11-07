// Copyright (c) KnoxStudio. All rights reserved. Licensed under the GNU GPL-3.0 License.
/**
 * MEM-58 — MinHash signatures (lexical, no embeddings).
 *
 * `sig_i(X) = min_{s ∈ X} h_i(s)` over the word 3-shingles `X` of a memory. The
 * fraction of agreeing coordinates of two signatures is an unbiased estimate of
 * the Jaccard similarity of their shingle sets. 128 permutations → standard
 * error ≤ 0.044.
 *
 * Computed once at encode time and stored per leaf (`minhash BLOB`). `sim(c, m)`
 * in `selectContext.ts` and the MERGE test in φ₄ read the stored signature, so
 * selection stays monotone submodular (`sim ≥ 0`, a fixed kernel).
 *
 * This is a hash signature of the text's own tokens. It is not an embedding and
 * does not rerank anything (AGENTS.md).
 */

import { getTheoremParamsV2 } from "./memoryConfigAccess.js";

export const MINHASH_PERMUTATIONS_DEFAULT = 128;
export const MINHASH_SHINGLE_DEFAULT = 3;
/** Sentinel for an empty shingle set: matches nothing, including itself. */
const EMPTY = 0xffffffff;

export interface MinhashParams {
  permutations: number;
  shingle: number;
}

export function defaultMinhashParams(): MinhashParams {
  return { permutations: MINHASH_PERMUTATIONS_DEFAULT, shingle: MINHASH_SHINGLE_DEFAULT };
}

export function getMinhashParams(): MinhashParams {
  try {
    const v2 = getTheoremParamsV2();
    return resolveParams({ permutations: v2.minhashPermutations, shingle: v2.minhashShingle });
  } catch {
    return defaultMinhashParams();
  }
}

function resolveParams(params?: Partial<MinhashParams>): MinhashParams {
  const d = defaultMinhashParams();
  const perm = Math.trunc(Number(params?.permutations));
  const shingle = Math.trunc(Number(params?.shingle));
  return {
    permutations: Number.isFinite(perm) && perm >= 1 ? Math.min(perm, 1024) : d.permutations,
    shingle: Number.isFinite(shingle) && shingle >= 1 ? Math.min(shingle, 8) : d.shingle,
  };
}

/** Lowercased letter / digit / underscore runs (any script). */
export function shingleTokens(text: string): string[] {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * Word k-shingles. Fewer than k tokens → one shingle of all tokens, so short
 * memories still compare. No tokens → empty set.
 */
export function shingles(text: string, k = MINHASH_SHINGLE_DEFAULT): Set<string> {
  const tokens = shingleTokens(text);
  const out = new Set<string>();
  if (tokens.length === 0) return out;
  if (tokens.length <= k) {
    out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + k <= tokens.length; i++) out.add(tokens.slice(i, i + k).join(" "));
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** murmur3 finalizer: a bijection on 32-bit ints. */
function mix(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const seedCache = new Map<number, Uint32Array>();

/** Fixed per-permutation seeds (splitmix-style), identical on every machine and run. */
function seeds(n: number): Uint32Array {
  const cached = seedCache.get(n);
  if (cached) return cached;
  const out = new Uint32Array(n);
  let state = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    state = (state + 0x9e3779b9) >>> 0;
    out[i] = mix(state ^ Math.imul(i + 1, 0x85ebca6b));
  }
  seedCache.set(n, out);
  return out;
}

/** Signature of a text. An empty text yields an all-sentinel signature. */
export function minhashSignature(text: string, params?: Partial<MinhashParams>): Uint32Array {
  const p = resolveParams(params ?? getMinhashParams());
  const sig = new Uint32Array(p.permutations).fill(EMPTY);
  const set = shingles(text, p.shingle);
  if (set.size === 0) return sig;
  const seed = seeds(p.permutations);
  for (const shingle of set) {
    const base = fnv1a(shingle);
    for (let i = 0; i < p.permutations; i++) {
      const h = mix(base ^ seed[i]!);
      if (h < sig[i]!) sig[i] = h;
    }
  }
  return sig;
}

export function isEmptySignature(sig: ArrayLike<number>): boolean {
  for (let i = 0; i < sig.length; i++) if (sig[i] !== EMPTY) return false;
  return true;
}

/**
 * Estimated Jaccard ∈ [0, 1]: share of agreeing coordinates. Either side empty
 * or a length mismatch → 0 (callers fall back to the lexical Jaccard).
 */
export function minhashSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  if (isEmptySignature(a) || isEmptySignature(b)) return 0;
  let agree = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) agree++;
  return agree / a.length;
}

/** Little-endian bytes for a BLOB column. */
export function signatureToBytes(sig: Uint32Array): Uint8Array {
  const out = new Uint8Array(sig.length * 4);
  for (let i = 0; i < sig.length; i++) {
    const v = sig[i]!;
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

/** Inverse of {@link signatureToBytes}. Null for missing or malformed bytes. */
export function signatureFromBytes(bytes: ArrayLike<number> | null | undefined): Uint32Array | null {
  if (!bytes || bytes.length === 0 || bytes.length % 4 !== 0) return null;
  const out = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      ((bytes[i * 4]! | (bytes[i * 4 + 1]! << 8) | (bytes[i * 4 + 2]! << 16) | (bytes[i * 4 + 3]! << 24)) >>> 0);
  }
  return out;
}

/** Bytes to store for a new leaf; `null` when the text has no shingles. */
export function encodeMinhash(text: string, params?: Partial<MinhashParams>): Buffer | null {
  const sig = minhashSignature(text, params);
  if (isEmptySignature(sig)) return null;
  return Buffer.from(signatureToBytes(sig));
}
