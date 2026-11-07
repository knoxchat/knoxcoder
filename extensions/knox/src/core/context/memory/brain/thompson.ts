/**
 * MEM-60 — Thompson exploration and selection propensity.
 *
 * `explore_rate` of calls (5%) replace U(m) in Stage 3 with a draw from
 * Beta(h + κ I₀, u + κ (1 − I₀)). Every injection logs P(selected) so the
 * calibration (MEM-61) can weight by 1/propensity and correct selection bias.
 *
 * Pure math over an injectable RNG. No model, no embedding, no rerank.
 */

export type Rng = () => number;

/** mulberry32: small, fast, seedable. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: Rng): number {
  let u = 0;
  while (u <= Number.EPSILON) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang. shape < 1 uses the boost Gamma(a) = Gamma(a+1) · U^{1/a}. */
export function sampleGamma(shape: number, rng: Rng): number {
  const a = Number.isFinite(shape) && shape > 0 ? shape : 1e-3;
  if (a < 1) {
    let u = 0;
    while (u <= Number.EPSILON) u = rng();
    return sampleGamma(a + 1, rng) * u ** (1 / a);
  }
  const d = a - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded: a degenerate RNG (constant output) must not hang retrieval.
  for (let attempt = 0; attempt < 200; attempt++) {
    let x: number;
    let v: number;
    let inner = 0;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0 && ++inner < 50);
    if (v <= 0) continue;
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(Math.max(u, Number.EPSILON)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}

export function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const sum = x + y;
  return sum > 0 ? x / sum : 0.5;
}

/** One Thompson draw of U(m). `i0` is clamped to [0, 1]. */
export function thompsonUtility(
  helpful: number,
  unhelpful: number,
  initialImportance: number,
  kappa: number,
  rng: Rng,
): number {
  const h = Math.max(0, Number.isFinite(helpful) ? helpful : 0);
  const u = Math.max(0, Number.isFinite(unhelpful) ? unhelpful : 0);
  const i0 = Math.max(0, Math.min(1, Number.isFinite(initialImportance) ? initialImportance : 0.5));
  const k = Number.isFinite(kappa) && kappa > 0 ? kappa : 5;
  return sampleBeta(h + k * i0, u + k * (1 - i0), rng);
}

/**
 * P(selected) under the mixture policy: with prob 1 − ε the greedy ranking,
 * with prob ε the Thompson ranking. `exploreInclusion` is the share of
 * simulated Thompson rankings that keep the memory.
 */
export function selectionPropensity(
  greedyKept: boolean,
  exploreInclusion: number,
  exploreRate: number,
): number {
  const eps = Math.max(0, Math.min(1, Number.isFinite(exploreRate) ? exploreRate : 0));
  const q = Math.max(0, Math.min(1, Number.isFinite(exploreInclusion) ? exploreInclusion : 0));
  const p = (1 - eps) * (greedyKept ? 1 : 0) + eps * q;
  return Math.max(0, Math.min(1, p));
}

// ── Injectable exploration RNG ─────────────────────────────────────────────

let injectedRng: Rng | null = null;

/** Tests: pass a seeded RNG; `null` restores the default. */
export function setExplorationRng(rng: Rng | null): void {
  injectedRng = rng;
}

export function getExplorationRng(): Rng {
  return injectedRng ?? Math.random;
}

/**
 * Under vitest an un-seeded run never explores, so ordinary retrieval tests
 * stay deterministic. Exploration tests inject a seeded RNG (per call or here).
 */
export function explorationAllowed(callRng?: Rng): boolean {
  if (callRng || injectedRng) return true;
  return !(typeof process !== "undefined" && process.env?.VITEST);
}
