import type { JevChoiceAnswer, JevNoulAnswer, JevScoreAnswer } from "./types";

export function asChoice(
  answers: Record<string, { type: string }>,
  key: string,
): JevChoiceAnswer | undefined {
  const value = answers[key];
  return value?.type === "choice" ? (value as JevChoiceAnswer) : undefined;
}

export function asNoul(
  answers: Record<string, { type: string }>,
  key: string,
): JevNoulAnswer | undefined {
  const value = answers[key];
  return value?.type === "noul" ? (value as JevNoulAnswer) : undefined;
}

export function asScore(
  answers: Record<string, { type: string }>,
  key: string,
): JevScoreAnswer | undefined {
  const value = answers[key];
  return value?.type === "score" ? (value as JevScoreAnswer) : undefined;
}
