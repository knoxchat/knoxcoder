/**
 * One hard cap for every non-transcript inject (K-072).
 *
 * Priority, high to low: pinned memory → task plan → last oracle / restore
 * → turn context → codebase/rust/serial cards → retrieved memory → skill
 * names → recipe stub (protected) → recipe hint → hook context.
 *
 * Override with `KNOX_TURN_INJECT_CAP` (minimum 500).
 */

import type { ChatMessage } from "..";
import { CODEBASE_CARD_MARKER } from "./codebaseCard";
import { RUST_POLICY_MARKER } from "./rustPolicy";
import { SERIAL_CONTEXT_MARKER } from "./serialContext";
import { TURN_CONTEXT_MARKER } from "./turnContext";
import { TASK_EXECUTION_PLAN_MARKER } from "../tools/planStore";

export const DEFAULT_TURN_INJECT_CAP = 12_000;
export const MIN_TURN_INJECT_CAP = 500;

export type TurnInjectKind =
  | "pinned_memory"
  | "plan"
  | "oracle"
  | "turn_context"
  | "cards"
  | "retrieved_memory"
  | "skill"
  | "recipe_stub"
  | "recipe"
  | "hooks";

export interface TurnInjectBlock {
  kind: TurnInjectKind;
  text: string;
}

const PRIORITY: Record<TurnInjectKind, number> = {
  pinned_memory: 0,
  plan: 1,
  oracle: 2,
  turn_context: 3,
  cards: 4,
  retrieved_memory: 5,
  skill: 6,
  recipe_stub: 7,
  recipe: 8,
  hooks: 9,
};

const PROTECTED_KINDS = new Set<TurnInjectKind>(["pinned_memory", "plan", "recipe_stub"]);

export function getTurnInjectCap(): number {
  const raw = Number(process.env.KNOX_TURN_INJECT_CAP);
  if (Number.isFinite(raw) && raw >= MIN_TURN_INJECT_CAP) {
    return Math.floor(raw);
  }
  return DEFAULT_TURN_INJECT_CAP;
}

/** Same 4-chars ≈ 1 token heuristic as Memory Brain. */
export function estimateTurnInjectTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTurnInjectTokens(text: string, tokens: number): string {
  if (tokens <= 0) {
    return "";
  }
  const maxChars = tokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  const suffix = "\n... (inject truncated)";
  const keep = Math.max(0, maxChars - suffix.length);
  return `${text.slice(0, keep)}${suffix}`;
}

/**
 * Keep blocks that fit the cap. Pinned memory and the task plan are never
 * dropped before unpinned / lower-priority injects; they truncate last.
 */
export function applyTurnBudget(
  blocks: readonly TurnInjectBlock[],
  cap = getTurnInjectCap(),
): TurnInjectBlock[] {
  const nonempty = blocks
    .map((block, index) => ({
      kind: block.kind,
      text: block.text.trim(),
      index,
    }))
    .filter((block) => block.text.length > 0);
  const ranked = [...nonempty].sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.index - b.index,
  );

  const selected: typeof nonempty = [];
  let used = 0;
  for (const block of ranked) {
    const cost = estimateTurnInjectTokens(block.text);
    if (used + cost <= cap) {
      selected.push(block);
      used += cost;
      continue;
    }
    const remaining = cap - used;
    if (remaining <= 0) {
      continue;
    }
    if (PROTECTED_KINDS.has(block.kind)) {
      const text = truncateToTurnInjectTokens(block.text, remaining);
      if (text) {
        selected.push({ ...block, text });
        used = cap;
      }
    }
  }

  return selected
    .sort((a, b) => a.index - b.index)
    .map(({ kind, text }) => ({ kind, text }));
}

export function formatTurnBudgetInject(
  blocks: readonly TurnInjectBlock[],
  cap = getTurnInjectCap(),
): string {
  return applyTurnBudget(blocks, cap)
    .map((block) => block.text)
    .join("\n\n");
}

export function splitPinnedMemory(text: string): {
  pinned: string;
  retrieved: string;
} {
  const pinned: string[] = [];
  const retrieved: string[] = [];
  let header = "";
  for (const line of text.split("\n")) {
    if (/^#{1,3}\s/.test(line) || /^=== /.test(line)) {
      if (!header) {
        header = line;
      }
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    if (/\[pinned\]/i.test(line)) {
      pinned.push(line);
    } else {
      retrieved.push(line);
    }
  }
  return {
    pinned: pinned.length ? ["=== Pinned Memory ===", ...pinned].join("\n") : "",
    retrieved: retrieved.length
      ? [header || "=== Relevant Knowledge from Memory ===", ...retrieved].join(
          "\n",
        )
      : "",
  };
}

export function classifyTurnInjectText(text: string): TurnInjectKind {
  const trimmed = text.trim();
  if (!trimmed) {
    return "retrieved_memory";
  }
  if (
    trimmed.includes(TASK_EXECUTION_PLAN_MARKER) ||
    /^## Task Execution Plan/m.test(trimmed)
  ) {
    return "plan";
  }
  if (trimmed.includes(TURN_CONTEXT_MARKER)) {
    return "turn_context";
  }
  if (
    trimmed.includes(CODEBASE_CARD_MARKER) ||
    trimmed.includes(RUST_POLICY_MARKER) ||
    trimmed.includes(SERIAL_CONTEXT_MARKER)
  ) {
    return "cards";
  }
  if (
    /<hook_context>/i.test(trimmed) ||
    trimmed.includes("## Hook Context")
  ) {
    return "hooks";
  }
  if (
    /<skill_relevance>/i.test(trimmed) ||
    /suggested skill/i.test(trimmed)
  ) {
    return "skill";
  }
  if (/<verified_recipe_stub\b/i.test(trimmed)) {
    return "recipe_stub";
  }
  if (/<verified_recipe\b/i.test(trimmed) || (/recipe/i.test(trimmed) && /hint|replay|adapt/i.test(trimmed))) {
    return "recipe";
  }
  if (
    /restored to /i.test(trimmed) ||
    /oracle/i.test(trimmed) ||
    /rewind/i.test(trimmed)
  ) {
    return "oracle";
  }
  if (/\[pinned\]/i.test(trimmed) && !/^\[[a-z_]+\]/m.test(trimmed.replace(/\[pinned\]/gi, ""))) {
    return "pinned_memory";
  }
  return "retrieved_memory";
}

/** Split a GUI/host `injectedContext` blob into budgeted blocks. */
export function classifyInjectedContext(text: string): TurnInjectBlock[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const chunks = trimmed.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  const blocks: TurnInjectBlock[] = [];
  for (const chunk of chunks) {
    if (
      chunk.includes("## Relevant Memory Context") ||
      chunk.includes("=== Relevant Knowledge from Memory ===") ||
      /\[pinned\]/i.test(chunk)
    ) {
      const split = splitPinnedMemory(chunk);
      if (split.pinned) {
        blocks.push({ kind: "pinned_memory", text: split.pinned });
      }
      if (split.retrieved) {
        blocks.push({ kind: "retrieved_memory", text: split.retrieved });
      }
      continue;
    }
    blocks.push({ kind: classifyTurnInjectText(chunk), text: chunk });
  }
  return blocks;
}

function systemText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
  }
  return "";
}

/**
 * Re-pack leading system injects (everything after the stable prompt) plus
 * extra blocks so the union stays ≤ the turn cap.
 */
export function applyTurnInjectToMessages(
  messages: ChatMessage[],
  extra: readonly TurnInjectBlock[] = [],
  cap = getTurnInjectCap(),
): ChatMessage[] {
  if (!messages.length && extra.length === 0) {
    return messages;
  }
  const prompt = messages[0]?.role === "system" ? messages[0] : undefined;
  const rest = prompt ? messages.slice(1) : messages;
  const existing: TurnInjectBlock[] = [];
  const after: ChatMessage[] = [];
  let seenTranscript = false;
  for (const message of rest) {
    if (!seenTranscript && message.role === "system") {
      const text = systemText(message).trim();
      if (text) {
        existing.push({ kind: classifyTurnInjectText(text), text });
      }
      continue;
    }
    seenTranscript = true;
    after.push(message);
  }
  const kept = applyTurnBudget([...existing, ...extra], cap);
  const next: ChatMessage[] = [];
  if (prompt) {
    next.push(prompt);
  }
  for (const block of kept) {
    next.push({ role: "system", content: block.text });
  }
  next.push(...after);
  return next;
}
