/**
 * TaskRouter — Local task difficulty scoring and model routing (IMP-17).
 *
 * Scores D(x) from message length, code blocks, and tool count.
 * Maps to easy/medium/hard models from local MemoryConfig — not Knox API.
 */

import { getMemoryConfig } from "./memoryConfigAccess.js";

export type TaskDifficulty = "easy" | "medium" | "hard";

export interface TaskScoreInput {
  message: string;
  toolCount?: number;
  codeBlockCount?: number;
}

export interface TaskScoreResult {
  difficulty: TaskDifficulty;
  /** Normalized difficulty score 0.0–1.0 */
  score: number;
  factors: {
    lengthScore: number;
    codeScore: number;
    toolScore: number;
  };
}

export interface TaskRouteResult {
  difficulty: TaskDifficulty;
  score: number;
  /** Resolved model ID, or empty string if no model configured for tier */
  modelId: string;
}

/** Score task difficulty locally. */
export function scoreDifficulty(input: TaskScoreInput): TaskScoreResult {
  const text = input.message ?? "";
  const len = text.length;

  // Length factor: 0 at 0 chars, 1 at 8000+ chars
  const lengthScore = Math.min(1, len / 8000);

  // Code blocks: ``` fences or 4+ space-indented lines
  const fenceBlocks = (text.match(/```[\s\S]*?```/g) ?? []).length;
  const explicitBlocks = input.codeBlockCount ?? fenceBlocks;
  const codeScore = Math.min(1, explicitBlocks / 5);

  // Tool invocations
  const toolScore = Math.min(1, (input.toolCount ?? 0) / 8);

  const score = lengthScore * 0.35 + codeScore * 0.35 + toolScore * 0.30;

  let difficulty: TaskDifficulty;
  if (score < 0.35) {
    difficulty = "easy";
  } else if (score < 0.65) {
    difficulty = "medium";
  } else {
    difficulty = "hard";
  }

  return { difficulty, score, factors: { lengthScore, codeScore, toolScore } };
}

/** Map difficulty to configured model ID. */
export function routeModel(difficulty: TaskDifficulty): string {
  const cfg = getMemoryConfig();
  switch (difficulty) {
    case "easy":
      return cfg.easy_model;
    case "medium":
      return cfg.medium_model;
    case "hard":
      return cfg.hard_model;
  }
}

/** Score and route in one call. */
export function scoreAndRoute(input: TaskScoreInput): TaskRouteResult {
  const { difficulty, score } = scoreDifficulty(input);
  return { difficulty, score, modelId: routeModel(difficulty) };
}

export const TaskRouter = {
  scoreDifficulty,
  routeModel,
  scoreAndRoute,
};
