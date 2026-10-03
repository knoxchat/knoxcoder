/**
 * Prompt-cache helpers for OpenAI-compatible gateways (K-030).
 *
 * Anthropic's native provider already sets `cache_control` itself. Routed
 * through OpenRouter, Anthropic and Gemini models need explicit breakpoints in
 * the OpenAI-shaped body; OpenAI/DeepSeek cache automatically on a stable
 * prefix and need nothing here (only the stable ordering in `constructMessages`).
 */

/** Models behind OpenRouter that honour explicit `cache_control` breakpoints. */
export function supportsExplicitCacheControl(model: string | undefined): boolean {
  const m = (model ?? "").toLowerCase();
  return m.startsWith("anthropic/") || m.startsWith("google/gemini");
}

type AnyMessage = { role?: string; content?: unknown; [k: string]: unknown };

function withBreakpoint(msg: AnyMessage): AnyMessage {
  const marker = { cache_control: { type: "ephemeral" } };
  if (typeof msg.content === "string") {
    if (!msg.content) {
      return msg;
    }
    return { ...msg, content: [{ type: "text", text: msg.content, ...marker }] };
  }
  if (Array.isArray(msg.content) && msg.content.length) {
    const parts = [...msg.content];
    // Breakpoint goes on the last text part only.
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i] as { type?: string };
      if (p && p.type === "text") {
        parts[i] = { ...(p as object), ...marker };
        return { ...msg, content: parts };
      }
    }
  }
  return msg;
}

/**
 * Returns a copy of `messages` with at most 3 cache breakpoints: the first
 * system message (the stable prompt prefix) and the last two user messages.
 * Never mutates the input and never exceeds the 4-breakpoint provider limit.
 */
export function applyCacheBreakpoints<T extends AnyMessage>(messages: T[]): T[] {
  const marked = new Set<number>();
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    marked.add(firstSystem);
  }
  let users = 0;
  for (let i = messages.length - 1; i >= 0 && users < 2; i--) {
    if (messages[i].role === "user") {
      marked.add(i);
      users++;
    }
  }
  return messages.map((m, i) => (marked.has(i) ? (withBreakpoint(m) as T) : m));
}

export interface ReportedUsage {
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Normalizes OpenAI / OpenRouter / Anthropic usage objects. */
export function extractUsage(u: unknown): ReportedUsage | undefined {
  if (!u || typeof u !== "object") {
    return undefined;
  }
  const o = u as Record<string, any>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const promptTokens = num(o.prompt_tokens ?? o.input_tokens);
  const completionTokens = num(o.completion_tokens ?? o.output_tokens);
  const cacheReadTokens = num(
    o.prompt_tokens_details?.cached_tokens ??
      o.cache_read_input_tokens ??
      o.prompt_cache_hit_tokens,
  );
  const cacheWriteTokens = num(
    o.prompt_tokens_details?.cache_write_tokens ?? o.cache_creation_input_tokens,
  );
  if (!promptTokens && !completionTokens) {
    return undefined;
  }
  return {
    ...(promptTokens ? { promptTokens } : {}),
    ...(completionTokens ? { completionTokens } : {}),
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
  };
}
