/**
 * FSRS strengthen-on-use (revised Knox-MS Part IV, MEM-14).
 *
 *   S' = S · (1 + a (11 − D) S^{-b} (e^{g(1−R)} − 1))
 *   a = e^{1.5}, b = 0.2, g = 1
 *
 *   Used+helpful → S ← S'
 *   Used+harmful → S ← 0.3 S,  D ← min(10, D+1)
 *   Retrieved-not-used → no change
 *
 * Attribution (MEM-17) is the live caller. Retrieve / inject must not apply this.
 */

import {
  type ForgettingParams,
  type StabilitySource,
  DEFAULT_DIFFICULTY,
  daysSince,
  defaultForgettingParams,
  resolveStability,
  retrievability,
} from "./Forgetting.js";
import { getTheoremParams } from "./memoryConfigAccess.js";
import { clamp01, lastAccessAt, type ValueSource } from "./Value.js";

export const FSRS_A_DEFAULT = Math.exp(1.5);
export const FSRS_B_DEFAULT = 0.2;
export const FSRS_G_DEFAULT = 1;
export const FSRS_HARMFUL_STABILITY_FACTOR = 0.3;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

export type FsrsOutcome = "helpful" | "harmful" | "unused";
export type FsrsMemoryKind = "semantic" | "episodic";

export interface FsrsParams {
  a: number;
  b: number;
  g: number;
  forgetting?: Partial<ForgettingParams>;
}

export interface FsrsState {
  stability: number;
  difficulty: number;
}

export interface FsrsSource extends StabilitySource, Pick<ValueSource, "last_accessed_at" | "created_at"> {
  difficulty?: number | null;
}

/** Pure defaults. Live a / b / g come from getFsrsParams(). */
export function defaultFsrsParams(): FsrsParams {
  return {
    a: FSRS_A_DEFAULT,
    b: FSRS_B_DEFAULT,
    g: FSRS_G_DEFAULT,
    forgetting: defaultForgettingParams(),
  };
}

export function getFsrsParams(): FsrsParams {
  try {
    const theorem = getTheoremParams();
    return {
      a: theorem.fsrsA,
      b: theorem.fsrsB,
      g: theorem.fsrsG,
      forgetting: {
        ...defaultForgettingParams(),
        F: theorem.forgettingF,
        c: theorem.forgettingC,
      },
    };
  } catch {
    return defaultFsrsParams();
  }
}

function resolveParams(params?: Partial<FsrsParams>): FsrsParams {
  const fallback = getFsrsParams();
  return {
    a: params?.a ?? fallback.a,
    b: params?.b ?? fallback.b,
    g: params?.g ?? fallback.g,
    forgetting: params?.forgetting ?? fallback.forgetting,
  };
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clampDifficulty(difficulty: number | null | undefined): number {
  const n = Number(difficulty);
  if (!Number.isFinite(n)) return DEFAULT_DIFFICULTY;
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, n));
}

export function resolveDifficulty(difficulty: number | null | undefined): number {
  return clampDifficulty(difficulty ?? DEFAULT_DIFFICULTY);
}

/**
 * S' = S · (1 + a (11 − D) S^{-b} (e^{g(1−R)} − 1)).
 * Spacing: R ≈ 1 → gain ≈ 0. Saturation: large S grows more slowly.
 */
export function nextStability(
  stability: number,
  difficulty: number,
  retrievabilityR: number,
  params?: Partial<FsrsParams>,
): number {
  const p = resolveParams(params);
  const s = resolveStability(stability);
  const d = clampDifficulty(difficulty);
  const r = clamp01(retrievabilityR);
  const a = Number.isFinite(p.a) && p.a >= 0 ? p.a : FSRS_A_DEFAULT;
  const b = Number.isFinite(p.b) && p.b >= 0 ? p.b : FSRS_B_DEFAULT;
  const g = Number.isFinite(p.g) ? p.g : FSRS_G_DEFAULT;
  const spacing = Math.exp(g * (1 - r)) - 1;
  const gain = a * (11 - d) * s ** -b * spacing;
  const next = s * (1 + gain);
  if (!Number.isFinite(next)) return s;
  return resolveStability(next);
}

export function applyHarmful(
  stability: number,
  difficulty: number,
): FsrsState {
  return {
    stability: resolveStability(resolveStability(stability) * FSRS_HARMFUL_STABILITY_FACTOR),
    difficulty: Math.min(MAX_DIFFICULTY, resolveDifficulty(difficulty) + 1),
  };
}

/** Apply one FSRS event. `unused` returns the resolved current state. */
export function applyFsrs(
  stability: number,
  difficulty: number,
  retrievabilityR: number,
  outcome: FsrsOutcome,
  params?: Partial<FsrsParams>,
): FsrsState {
  const s = resolveStability(stability);
  const d = resolveDifficulty(difficulty);
  if (outcome === "unused") return { stability: s, difficulty: d };
  if (outcome === "harmful") return applyHarmful(s, d);
  return { stability: nextStability(s, d, retrievabilityR, params), difficulty: d };
}

export function retrievabilityFromSource(
  source?: FsrsSource | null,
  params?: Partial<FsrsParams>,
  nowMs: number = Date.now(),
): number {
  const p = resolveParams(params);
  const accessed = lastAccessAt(source);
  const tDays = accessed ? daysSince(accessed, nowMs) : 0;
  return retrievability(tDays, resolveStability(source?.stability, source?.category), p.forgetting);
}

export function applyFsrsFromSource(
  source?: FsrsSource | null,
  outcome: FsrsOutcome = "unused",
  params?: Partial<FsrsParams>,
  nowMs: number = Date.now(),
): FsrsState {
  const r = retrievabilityFromSource(source, params, nowMs);
  return applyFsrs(
    resolveStability(source?.stability, source?.category),
    resolveDifficulty(source?.difficulty),
    r,
    outcome,
    params,
  );
}

export const Fsrs = {
  FSRS_A_DEFAULT,
  FSRS_B_DEFAULT,
  FSRS_G_DEFAULT,
  FSRS_HARMFUL_STABILITY_FACTOR,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  defaultFsrsParams,
  getFsrsParams,
  clampDifficulty,
  resolveDifficulty,
  nextStability,
  applyHarmful,
  applyFsrs,
  retrievabilityFromSource,
  applyFsrsFromSource,
};
