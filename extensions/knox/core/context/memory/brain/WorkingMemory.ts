/**
 * WorkingMemory — Limited-capacity active workspace (prefrontal cortex model).
 *
 * Mirrors Knox-MS "working memory" / "scratch pad" concept:
 * - Fixed capacity (configurable slot count, default 7 ± 2 like Miller's Law)
 * - Attention gating: only the most relevant items stay active
 * - Automatic eviction: least-relevant items drop out as new ones enter
 * - Token-budgeted: total content respects a token budget
 * - Decay: items lose activation over time unless refreshed
 * - Integration with ContextBuilder for seamless context injection
 *
 * Working memory is session-scoped and ephemeral (lives in-memory, not DB).
 * It serves as the "currently thinking about" buffer between long-term
 * memory (BrainStore) and the LLM context window.
 */

import { getMemoryConfig, getWorkingMemoryOptions } from "./memoryConfigAccess.js";
import { contentWords } from "./RetrievalQuery.js";

/** REL-06: mismatch decay per attendTo when an item does not overlap the query. */
export const WM_MISMATCH_DECAY = 0.25;
/** REL-06: relevance floor after mismatch decay (was 0.1). */
export const WM_MISMATCH_FLOOR = 0;
/** REL-06: evict after attendTo when relevance falls below this. */
export const WM_EVICT_BELOW = 0.2;
/** REL-06: buildContext injects only items at or above this relevance. */
export const WM_INJECT_MIN_RELEVANCE = 0.35;
/** REL-06: Thalamus replaces this slot instead of accumulating `salient:${Date.now()}`. */
export const CURRENT_TURN_SLOT_ID = "current-turn";

function getWmMismatchDecay(): number {
  const n = getMemoryConfig().wm_mismatch_decay;
  return Number.isFinite(n) ? n : WM_MISMATCH_DECAY;
}

function getWmInjectMinRelevance(): number {
  const n = getMemoryConfig().wm_inject_min_relevance;
  return Number.isFinite(n) ? n : WM_INJECT_MIN_RELEVANCE;
}

export interface WorkingMemoryItem {
  id: string;
  content: string;
  source: "semantic" | "episodic" | "graph" | "user" | "tool";
  relevance: number;   // 0.0–1.0, decays over time
  added_at: number;     // Date.now()
  last_refreshed: number;
  token_count: number;
  metadata?: Record<string, any>;
}

export interface WorkingMemoryStats {
  slot_count: number;
  max_slots: number;
  total_tokens: number;
  token_budget: number;
  oldest_item_age_ms: number;
  average_relevance: number;
}

export class WorkingMemory {
  private items: Map<string, WorkingMemoryItem> = new Map();
  private maxSlots: number;
  private tokenBudget: number;
  private decayRate: number; // relevance decay per second
  private ttlMs: number; // item age limit

  constructor(options?: {
    maxSlots?: number;
    tokenBudget?: number;
    decayRatePerSecond?: number;
    ttlSeconds?: number;
  }) {
    const defaults = getWorkingMemoryOptions();
    this.maxSlots = options?.maxSlots ?? defaults.maxSlots;
    this.tokenBudget = options?.tokenBudget ?? defaults.tokenBudget;
    this.decayRate = options?.decayRatePerSecond ?? defaults.decayRatePerSecond;
    this.ttlMs = (options?.ttlSeconds ?? defaults.ttlSeconds) * 1000;
  }

  // ── Core Operations ────────────────────────────────────────────────────────

  /**
   * Add an item to working memory. If at capacity, evicts least relevant.
   * Returns the evicted item id (if any), or null.
   */
  add(item: Omit<WorkingMemoryItem, "added_at" | "last_refreshed" | "token_count">): string | null {
    this.evictExpired();
    const tokenCount = Math.ceil(item.content.length / 4);
    const now = Date.now();
    let evictedId: string | null = null;

    // If item already exists, refresh it
    const existing = this.items.get(item.id);
    if (existing) {
      existing.content = item.content;
      existing.relevance = item.relevance;
      existing.last_refreshed = now;
      existing.token_count = tokenCount;
      existing.metadata = item.metadata;
      // current-turn is replaced each turn — restart TTL from this upsert
      if (item.id === CURRENT_TURN_SLOT_ID) {
        existing.added_at = now;
      }
      return null;
    }

    // Evict if at capacity
    if (this.items.size >= this.maxSlots) {
      evictedId = this.evictLeastRelevant();
    }

    // Evict until within token budget
    while (this.currentTokens() + tokenCount > this.tokenBudget && this.items.size > 0) {
      evictedId = this.evictLeastRelevant();
    }

    this.items.set(item.id, {
      ...item,
      added_at: now,
      last_refreshed: now,
      token_count: tokenCount,
    });

    return evictedId;
  }

  /**
   * Refresh an item's relevance (prevents decay).
   */
  refresh(id: string, newRelevance?: number): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.last_refreshed = Date.now();
    if (newRelevance !== undefined) {
      item.relevance = Math.max(0, Math.min(1, newRelevance));
    }
    return true;
  }

  /**
   * Remove an item from working memory.
   */
  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Get an item by id.
   */
  get(id: string): WorkingMemoryItem | undefined {
    const item = this.items.get(id);
    if (item) {
      // Apply decay on read
      this.applyDecay(item);
    }
    return item;
  }

  /**
   * Get all items sorted by decayed relevance (highest first).
   */
  getAll(): WorkingMemoryItem[] {
    this.evictExpired();
    const items = Array.from(this.items.values());
    for (const item of items) this.applyDecay(item);
    return items.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Clear all items.
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * REL-06: isolate M₂ on topic shift / new-task. Task A scratch must not
   * ride into Task B. Continuation turns must not call this.
   */
  flushOnTopicShift(): void {
    this.clear();
  }

  /**
   * Get stats about current working memory state.
   */
  getStats(): WorkingMemoryStats {
    const items = this.getAll();
    const now = Date.now();
    return {
      slot_count: items.length,
      max_slots: this.maxSlots,
      total_tokens: this.currentTokens(),
      token_budget: this.tokenBudget,
      oldest_item_age_ms: items.length > 0
        ? now - Math.min(...items.map((i) => i.added_at))
        : 0,
      average_relevance: items.length > 0
        ? items.reduce((sum, i) => sum + i.relevance, 0) / items.length
        : 0,
    };
  }

  // ── Attention Gating ───────────────────────────────────────────────────────

  /**
   * Gate attention: given a new query, boost relevance of items that match
   * and decay items that don't. This models selective attention.
   *
   * REL-06: mismatch decay is −0.25 with floor 0; evict below 0.2.
   * Continuation filler (no content words) is a no-op so Task A is not
   * punished by `"continue"` / `"ok"`.
   */
  attendTo(query: string): void {
    this.evictExpired();
    const queryWordSet = new Set(contentWords(query));
    if (queryWordSet.size === 0) return;

    for (const item of this.items.values()) {
      const itemWords = new Set(contentWords(item.content));
      let overlap = 0;
      for (const w of queryWordSet) {
        if (itemWords.has(w)) overlap++;
      }

      const matchRatio = overlap / queryWordSet.size;

      if (matchRatio > 0.2) {
        item.relevance = Math.min(1.0, item.relevance + matchRatio * 0.3);
        item.last_refreshed = Date.now();
      } else {
        const decay = getWmMismatchDecay();
        item.relevance = Math.max(WM_MISMATCH_FLOOR, item.relevance - decay);
      }
    }

    this.evictBelowThreshold(WM_EVICT_BELOW);
  }

  /**
   * Build a context string from working memory contents.
   * Returns formatted text suitable for injection into LLM context.
   *
   * REL-06: inject only items with relevance ≥ 0.35 that overlap the
   * retrieval query (or the current-turn user slot).
   */
  buildContext(query?: string): string | null {
    const items = this.getAll();
    const queryWords = query ? contentWords(query) : [];
    const injected = items.filter((item) => this.shouldInject(item, queryWords));
    if (injected.length === 0) return null;

    const lines: string[] = ["=== Active Working Memory ==="];
    for (const item of injected) {
      lines.push(`[${item.source}|rel:${item.relevance.toFixed(2)}] ${item.content}`);
    }
    return lines.join("\n");
  }

  /** Whether an item may appear in C_immediate for this retrieval query. */
  shouldInject(item: WorkingMemoryItem, queryWords: string[]): boolean {
    if (item.relevance < getWmInjectMinRelevance()) return false;
    if (item.id === CURRENT_TURN_SLOT_ID && item.source === "user") return true;
    if (queryWords.length === 0) return true;
    const itemWords = new Set(contentWords(item.content));
    return queryWords.some((w) => itemWords.has(w));
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private applyDecay(item: WorkingMemoryItem): void {
    const elapsed = (Date.now() - item.last_refreshed) / 1000;
    const decay = elapsed * this.decayRate;
    item.relevance = Math.max(0, item.relevance - decay);
  }

  private currentTokens(): number {
    let total = 0;
    for (const item of this.items.values()) {
      total += item.token_count;
    }
    return total;
  }

  private evictLeastRelevant(): string | null {
    let minRelevance = Infinity;
    let minId: string | null = null;

    for (const [id, item] of this.items) {
      this.applyDecay(item);
      if (item.relevance < minRelevance) {
        minRelevance = item.relevance;
        minId = id;
      }
    }

    if (minId) {
      this.items.delete(minId);
    }
    return minId;
  }

  private evictBelowThreshold(threshold: number): void {
    const toRemove: string[] = [];
    for (const [id, item] of this.items) {
      if (item.relevance < threshold) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.items.delete(id);
    }
  }

  /** Evict items older than TTL (M₂ ~30s retention). */
  private evictExpired(): void {
    if (this.ttlMs <= 0) return;
    const now = Date.now();
    const toRemove: string[] = [];
    for (const [id, item] of this.items) {
      if (now - item.added_at > this.ttlMs) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.items.delete(id);
    }
  }

  // ── Persistence (P4.1) ─────────────────────────────────────────────────────

  /**
   * Serialize working memory state to a JSON-safe object.
   * Called on session close to persist state to DB.
   */
  serialize(): WorkingMemoryState {
    const items: WorkingMemoryItem[] = [];
    for (const item of this.items.values()) {
      this.applyDecay(item);
      items.push({ ...item });
    }
    return {
      items,
      maxSlots: this.maxSlots,
      tokenBudget: this.tokenBudget,
      decayRate: this.decayRate,
      serializedAt: Date.now(),
    };
  }

  /**
   * Restore working memory from a serialized state.
   * Called on session open to restore state from DB.
   * Applies decay for the time elapsed since serialization.
   */
  restore(state: WorkingMemoryState): void {
    this.items.clear();
    this.maxSlots = state.maxSlots ?? this.maxSlots;
    this.tokenBudget = state.tokenBudget ?? this.tokenBudget;
    this.decayRate = state.decayRate ?? this.decayRate;

    const now = Date.now();
    const elapsed = (now - (state.serializedAt ?? now)) / 1000;

    for (const item of state.items) {
      // Apply decay for time since serialization
      const decay = elapsed * this.decayRate;
      const decayedRelevance = Math.max(0, item.relevance - decay);

      // Only restore items that would survive REL-06 eviction
      if (decayedRelevance >= WM_EVICT_BELOW) {
        this.items.set(item.id, {
          ...item,
          relevance: decayedRelevance,
          last_refreshed: now,
        });
      }
    }
  }
}

/**
 * Serializable state for working memory persistence.
 */
export interface WorkingMemoryState {
  items: WorkingMemoryItem[];
  maxSlots: number;
  tokenBudget: number;
  decayRate: number;
  serializedAt: number;
}
