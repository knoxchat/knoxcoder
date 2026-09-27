import type { JevAnswer, JevChoiceAnswer, JevNoulAnswer, JevScoreAnswer } from "./types";

/**
 * Confidence docs: peaked distribution → high, flat → low.
 * Used when a Choice/Score answer omits `confidence` but still sends probabilities.
 */
export function confidenceFromProbabilities(
  probabilities: Record<string, number>,
): number {
  const values = Object.values(probabilities).filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  const n = values.length;
  if (n === 0) {
    return 0;
  }
  if (n === 1) {
    return 1;
  }
  const sum = values.reduce((total, value) => total + Math.max(0, value), 0);
  if (sum <= 0) {
    return 0;
  }
  let entropy = 0;
  for (const value of values) {
    const p = Math.max(0, value) / sum;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  const maxEntropy = Math.log2(n);
  if (maxEntropy <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - entropy / maxEntropy));
}

export function asChoice(
  answers: Record<string, JevAnswer | { type: string }>,
  key: string,
): JevChoiceAnswer | undefined {
  const value = answers[key];
  return value?.type === "choice" ? (value as JevChoiceAnswer) : undefined;
}

export function asNoul(
  answers: Record<string, JevAnswer | { type: string }>,
  key: string,
): JevNoulAnswer | undefined {
  const value = answers[key];
  return value?.type === "noul" ? (value as JevNoulAnswer) : undefined;
}

export function asScore(
  answers: Record<string, JevAnswer | { type: string }>,
  key: string,
): JevScoreAnswer | undefined {
  const value = answers[key];
  return value?.type === "score" ? (value as JevScoreAnswer) : undefined;
}
