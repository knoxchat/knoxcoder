/**
 * MEM-27 — W is the routed model's window, never the 10M stored ceiling.
 *
 * W      = resolveContextWindow(llm).contextLength
 * W_out  = that model's reserved completion tokens (maxTokens)
 *
 * Live inject is W_mem = min(w_mem_tokens, W − occupancy − W_out) (MEM-28).
 */

import {
  resolveContextWindow,
  type ContextWindow,
} from "../../../agent/contextBudget.js";
import { MEMORY_CONTEXT_TOKEN_CEILING } from "./types.js";

export interface MemoryWindow {
  /** W(Model(x)) — tokens the routed model can see in one call. */
  w: number;
  /** W_out — reserved completion tokens. */
  wOut: number;
  model: string;
  source: ContextWindow["source"];
}

export interface MemoryWindowInput {
  llm?: unknown;
  model?: string;
  contextLength?: number;
  maxTokens?: number;
  completionOptions?: { maxTokens?: number };
  /**
   * When true (default if `llm` or `model` is present), store this window as
   * the live routed W for dashboard / later builds.
   */
  remember?: boolean;
}

let lastRoutedWindow: MemoryWindow | null = null;

export function isMemoryContextCeiling(value?: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MEMORY_CONTEXT_TOKEN_CEILING
  );
}

export function rememberRoutedWindow(window: MemoryWindow): MemoryWindow {
  lastRoutedWindow = window;
  return window;
}

export function getLastRoutedWindow(): MemoryWindow | null {
  return lastRoutedWindow;
}

export function resetRoutedWindow(): void {
  lastRoutedWindow = null;
}

function positiveInt(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function fromContextWindow(window: ContextWindow): MemoryWindow {
  return {
    w: window.contextLength,
    wOut: window.maxTokens,
    model: window.model,
    source: window.source,
  };
}

function buildLlmInput(input?: MemoryWindowInput): unknown | null {
  if (!input) {
    return null;
  }
  const record = (input.llm ?? {}) as {
    model?: string;
    contextLength?: number;
    completionOptions?: { maxTokens?: number };
  };
  const model =
    (typeof input.model === "string" && input.model.trim()) ||
    (typeof record.model === "string" ? record.model : "");
  const contextLength = positiveInt(input.contextLength) ?? positiveInt(record.contextLength);
  const completionOptions =
    input.completionOptions ??
    record.completionOptions ??
    (positiveInt(input.maxTokens)
      ? { maxTokens: positiveInt(input.maxTokens) }
      : undefined);
  if (!input.llm && !model && contextLength === undefined) {
    return null;
  }
  return {
    ...(input.llm && typeof input.llm === "object" ? input.llm : {}),
    model,
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(completionOptions ? { completionOptions } : {}),
  };
}

/**
 * Resolve W / W_out from the routed model (same helper as the agent loop).
 * Never returns the 10M stored ceiling.
 */
export function resolveMemoryWindow(input?: MemoryWindowInput): MemoryWindow {
  const explicit = buildLlmInput(input);
  if (explicit) {
    const window = fromContextWindow(resolveContextWindow(explicit));
    const shouldRemember = input?.remember ?? Boolean(input?.llm || input?.model);
    if (shouldRemember) {
      rememberRoutedWindow(window);
    }
    return window;
  }
  if (lastRoutedWindow) {
    return lastRoutedWindow;
  }
  return fromContextWindow(resolveContextWindow({}));
}

/** Caller max_tokens is an inject cap, not W. Ignore the 10M stored ceiling. */
export function sanitizeInjectOverride(value?: number): number | undefined {
  const n = positiveInt(value);
  if (n === undefined || isMemoryContextCeiling(n)) {
    return undefined;
  }
  return n;
}

/** Fields ContextBuilder needs so W follows the routed model. */
export function memoryWindowBuildFields(input?: {
  llm?: unknown;
  model?: string;
  w?: number;
  w_out?: number;
  max_tokens?: number;
  system_tokens?: number;
  goal_tokens?: number;
  recent_tokens?: number;
}): {
  llm?: unknown;
  model?: string;
  w?: number;
  w_out?: number;
  max_tokens?: number;
  system_tokens?: number;
  goal_tokens?: number;
  recent_tokens?: number;
} {
  return {
    llm: input?.llm,
    model: input?.model,
    w: input?.w,
    w_out: input?.w_out,
    max_tokens: sanitizeInjectOverride(input?.max_tokens),
    system_tokens: input?.system_tokens,
    goal_tokens: input?.goal_tokens,
    recent_tokens: input?.recent_tokens,
  };
}
