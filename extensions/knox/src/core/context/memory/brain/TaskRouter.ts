/**
 * TaskRouter — Local task difficulty scoring and model routing (IMP-17 / MEM-27).
 *
 * Scores D(x) from message length, code blocks, and tool count.
 * Maps to easy/medium/hard models from local MemoryConfig when those ids
 * are set. W follows Model(x) via resolveContextWindow.
 */

import { getMemoryConfig } from "./memoryConfigAccess.js";
import { resolveMemoryWindow, type MemoryWindow } from "./window.js";

export type TaskDifficulty = "easy" | "medium" | "hard";

export interface TaskScoreInput {
  message: string;
  toolCount?: number;
  codeBlockCount?: number;
  /** Current / fallback LLM. Used when a tier model id is empty, and for W. */
  llm?: unknown;
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
  /** Configured easy/medium/hard model, else the current LLM model id. */
  modelId: string;
  /** W(Model(x)) — routed model contextLength (MEM-27). */
  w: number;
  /** W_out — reserved completion tokens (MEM-27). */
  wOut: number;
  window: MemoryWindow;
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

function configuredTierModel(difficulty: TaskDifficulty): string {
  const cfg = getMemoryConfig();
  const raw =
    difficulty === "easy"
      ? cfg.easy_model
      : difficulty === "medium"
        ? cfg.medium_model
        : cfg.hard_model;
  return typeof raw === "string" ? raw.trim() : "";
}

function fallbackModelId(llm?: unknown): string {
  const model = (llm as { model?: unknown } | undefined)?.model;
  return typeof model === "string" ? model.trim() : "";
}

/** Map difficulty to configured model ID, else the current LLM. */
export function routeModel(difficulty: TaskDifficulty, llm?: unknown): string {
  return configuredTierModel(difficulty) || fallbackModelId(llm);
}

/** Score and route in one call. W follows the routed Model(x). */
export function scoreAndRoute(input: TaskScoreInput): TaskRouteResult {
  const { difficulty, score } = scoreDifficulty(input);
  const modelId = routeModel(difficulty, input.llm);
  const llmModel = fallbackModelId(input.llm);
  const llmMatches = !modelId || !llmModel || llmModel === modelId;
  const window = resolveMemoryWindow({
    model: modelId || undefined,
    llm: llmMatches ? input.llm : undefined,
    remember: true,
  });
  return { difficulty, score, modelId, w: window.w, wOut: window.wOut, window };
}

export const TaskRouter = {
  scoreDifficulty,
  routeModel,
  scoreAndRoute,
};
