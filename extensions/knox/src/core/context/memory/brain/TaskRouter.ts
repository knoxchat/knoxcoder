/**
 * TaskRouter — Local task difficulty scoring and model routing (IMP-17 / MEM-27 / MEM-71).
 *
 * Part X: TaskType is Coding vs General; Model(x) is Easy / Medium / Hard from
 * δ(x) cuts `< 0.3` / `0.3–0.7` / `≥ 0.7`. W follows Model(x) via resolveContextWindow.
 * MEM-70: if the floor does not fit, reroute to a larger window or error.
 */

import { getMemoryConfig, wMemFloor } from "./memoryConfigAccess.js";
import { rememberRoutedWindow, resolveMemoryWindow, type MemoryWindow } from "./window.js";

export type TaskDifficulty = "easy" | "medium" | "hard";
/** Part X TaskType(x): coding vs general. */
export type TaskType = "code" | "general";

/** δ(x) < this → Easy. */
export const DELTA_EASY_MAX = 0.3;
/** δ(x) ≥ this → Hard. Medium is the half-open interval in between. */
export const DELTA_HARD_MIN = 0.7;

export interface TaskScoreInput {
  message: string;
  toolCount?: number;
  codeBlockCount?: number;
  /** Current / fallback LLM. Used when a tier model id is empty, and for W. */
  llm?: unknown;
}

export interface TaskScoreResult {
  difficulty: TaskDifficulty;
  /** Normalized difficulty score 0.0–1.0 (δ(x)). */
  score: number;
  /** Alias of `score` — Part X task difficulty, not per-memory D_m. */
  delta: number;
  taskType: TaskType;
  factors: {
    lengthScore: number;
    codeScore: number;
    toolScore: number;
  };
}

export interface TaskRouteResult {
  difficulty: TaskDifficulty;
  score: number;
  delta: number;
  taskType: TaskType;
  /** Configured easy/medium/hard model, else the current LLM model id. */
  modelId: string;
  /** W(Model(x)) — routed model contextLength (MEM-27). */
  w: number;
  /** W_out — reserved completion tokens (MEM-27). */
  wOut: number;
  window: MemoryWindow;
}

export interface WindowReroute {
  modelId: string;
  window: MemoryWindow;
  llm?: unknown;
}

export interface FitWindowResult {
  llm: unknown;
  window: MemoryWindow;
  rerouted: boolean;
  reroutedModel?: string;
  error?: string;
}

/** Explicit error when W cannot hold C_system + C_goal + W_out + W_mem^min (MEM-70). */
export class MemoryBudgetError extends Error {
  readonly code = "window_too_small" as const;
  readonly needed: number;
  readonly w: number;

  constructor(message: string, needed: number, w: number) {
    super(message);
    this.name = "MemoryBudgetError";
    this.needed = needed;
    this.w = w;
  }
}

const CODE_FENCE = /```/;
const CODE_PATH =
  /\b(?:src\/|lib\/|app\/|extensions\/|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|scala|sh|bash|zsh|sql|json|ya?ml|toml|mdc))\b/i;
const CODE_KEYWORD =
  /\b(?:function|class |export |import |from ['"]|const |let |async |await |impl |fn |struct |enum |def |cargo |npm |pnpm |yarn |eslint |clippy |typecheck|refactor|stack trace|compile error)\b/i;

/** Part X TaskType(x): code vs general. Lexical only. */
export function detectTaskType(
  message: string,
  codeBlockCount?: number,
): TaskType {
  if ((codeBlockCount ?? 0) > 0) return "code";
  const text = message ?? "";
  if (CODE_FENCE.test(text) || CODE_PATH.test(text) || CODE_KEYWORD.test(text)) {
    return "code";
  }
  return "general";
}

/** Part X Model(x) cuts: Easy < 0.3 ≤ Medium < 0.7 ≤ Hard. */
export function difficultyFromDelta(delta: number): TaskDifficulty {
  const d = Number.isFinite(delta) ? delta : 0;
  if (d < DELTA_EASY_MAX) return "easy";
  if (d < DELTA_HARD_MIN) return "medium";
  return "hard";
}

/** Score task difficulty locally. δ(x) is this score. */
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
  const difficulty = difficultyFromDelta(score);
  const taskType = detectTaskType(text, explicitBlocks);

  return {
    difficulty,
    score,
    delta: score,
    taskType,
    factors: { lengthScore, codeScore, toolScore },
  };
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

function resolveRoutedWindow(modelId: string, llm?: unknown): MemoryWindow {
  const llmModel = fallbackModelId(llm);
  const llmMatches = !modelId || !llmModel || llmModel === modelId;
  return resolveMemoryWindow({
    model: modelId || undefined,
    llm: llmMatches ? llm : undefined,
    remember: true,
  });
}

/** Score and route in one call. W follows the routed Model(x). */
export function scoreAndRoute(input: TaskScoreInput): TaskRouteResult {
  const scored = scoreDifficulty(input);
  const modelId = routeModel(scored.difficulty, input.llm);
  const window = resolveRoutedWindow(modelId, input.llm);
  return {
    difficulty: scored.difficulty,
    score: scored.score,
    delta: scored.delta,
    taskType: scored.taskType,
    modelId,
    w: window.w,
    wOut: window.wOut,
    window,
  };
}

export function neededMemoryWindow(occupancy: {
  systemTokens?: number;
  goalTokens?: number;
  wOut: number;
  w: number;
  wMemMin?: number;
}): number {
  const system = Math.max(0, Math.floor(occupancy.systemTokens ?? 0));
  const goal = Math.max(0, Math.floor(occupancy.goalTokens ?? 0));
  const wOut = Math.max(0, Math.floor(occupancy.wOut));
  const min = occupancy.wMemMin ?? wMemFloor(occupancy.w);
  return system + goal + wOut + min;
}

function windowTooSmallMessage(needed: number, w: number): string {
  return (
    `Memory window too small: need ${needed} tokens ` +
    `(C_system + C_goal + W_out + W_mem^min), W=${w}. ` +
    `Route to a larger-window model or shorten system/goal. ` +
    `The request was not truncated.`
  );
}

/**
 * Pick the smallest configured / fallback model whose W can hold `needed`.
 * Does not instantiate an LLM from a bare id — callers with `resolveModel`
 * (or `fallbackLlm`) supply the handle.
 */
export function rerouteForWindow(input: {
  currentW: number;
  needed: number;
  llm?: unknown;
  fallbackLlm?: unknown;
}): WindowReroute | null {
  const needed = Math.max(0, Math.floor(input.needed));
  const currentW = Math.max(0, Math.floor(input.currentW));
  const options: Array<{ modelId: string; llm?: unknown }> = [];
  const seen = new Set<string>();
  const push = (modelId: string, llm?: unknown) => {
    const id = modelId.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    options.push({ modelId: id, llm });
  };

  if (input.fallbackLlm) {
    push(fallbackModelId(input.fallbackLlm) || "fallback", input.fallbackLlm);
  }
  push(configuredTierModel("hard"));
  push(configuredTierModel("medium"));
  push(configuredTierModel("easy"));

  let best: WindowReroute | null = null;
  for (const opt of options) {
    const window = resolveMemoryWindow({
      llm: opt.llm,
      model: opt.modelId,
      remember: false,
    });
    if (window.w < needed || window.w <= currentW) continue;
    if (!best || window.w < best.window.w) {
      best = { modelId: opt.modelId, window, llm: opt.llm };
    }
  }
  return best;
}

/**
 * If C_system + C_goal + W_out + W_mem^min fits W, keep the current model.
 * Else reroute to a larger window, else return an explicit error string.
 */
export function fitWindowForCall(input: {
  llm?: unknown;
  fallbackLlm?: unknown;
  systemTokens?: number;
  goalTokens?: number;
}): FitWindowResult {
  const window = resolveMemoryWindow({
    llm: input.llm,
    remember: true,
  });
  const needed = neededMemoryWindow({
    systemTokens: input.systemTokens,
    goalTokens: input.goalTokens,
    wOut: window.wOut,
    w: window.w,
  });
  if (needed <= window.w) {
    return { llm: input.llm, window, rerouted: false };
  }
  const reroute = rerouteForWindow({
    currentW: window.w,
    needed,
    llm: input.llm,
    fallbackLlm: input.fallbackLlm,
  });
  if (reroute) {
    rememberRoutedWindow(reroute.window);
    return {
      llm: reroute.llm ?? input.llm,
      window: reroute.window,
      rerouted: true,
      reroutedModel: reroute.modelId,
    };
  }
  return {
    llm: input.llm,
    window,
    rerouted: false,
    error: windowTooSmallMessage(needed, window.w),
  };
}

export const TaskRouter = {
  scoreDifficulty,
  routeModel,
  scoreAndRoute,
  detectTaskType,
  difficultyFromDelta,
  rerouteForWindow,
  fitWindowForCall,
  neededMemoryWindow,
};
