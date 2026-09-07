/**
 * LlmResilience — Circuit breaker, retry with exponential backoff,
 * and LLM decision cache.
 *
 * Mirrors Knox-MS resilience patterns:
 * - Circuit breaker (Closed → Open → Half-Open) to prevent cascading failures
 * - Retry with exponential backoff + jitter for transient errors
 * - Decision cache to avoid redundant LLM calls for similar prompts
 */

import type { ILLM } from "../../../index.js";

// ── Circuit Breaker ──────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** How long the circuit stays open before half-open probe (ms) */
  resetTimeoutMs: number;
  /** Number of successful half-open probes to close the circuit */
  halfOpenSuccessThreshold: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 60_000,
      halfOpenSuccessThreshold: config?.halfOpenSuccessThreshold ?? 2,
    };
  }

  /**
   * Check if the circuit allows a request.
   */
  canExecute(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      // Check if reset timeout has elapsed
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = "half_open";
        this.successCount = 0;
        return true;
      }
      return false;
    }

    // half_open — allow probes
    return true;
  }

  /**
   * Record a successful execution.
   */
  onSuccess(): void {
    if (this.state === "half_open") {
      this.successCount++;
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.state = "closed";
        this.failureCount = 0;
      }
    } else if (this.state === "closed") {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed execution.
   */
  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      // Half-open probe failed — go back to open
      this.state = "open";
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = "open";
    }
  }

  /**
   * Get current state for diagnostics.
   */
  getState(): { state: CircuitState; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset the circuit breaker.
   */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

// ── Retry with Exponential Backoff ───────────────────────────────────────────

interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in ms */
  baseDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs: number;
  /** Jitter factor (0-1) — randomness added to prevent thundering herd */
  jitterFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitterFactor: 0.3,
};

/**
 * Execute a function with exponential backoff retry.
 * Only retries on transient errors (network, rate limit, timeout).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on non-transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      if (attempt === cfg.maxRetries) {
        break;
      }

      // Exponential backoff: base * 2^attempt
      const delay = Math.min(
        cfg.baseDelayMs * Math.pow(2, attempt),
        cfg.maxDelayMs,
      );

      // Add jitter
      const jitter = delay * cfg.jitterFactor * Math.random();
      const totalDelay = delay + jitter;

      await sleep(totalDelay);
    }
  }

  throw lastError ?? new Error("Retry exhausted");
}

/**
 * Determine if an error is transient (worth retrying).
 */
function isTransientError(error: any): boolean {
  if (!error) return false;

  const message = (error.message ?? "").toLowerCase();
  const status = error.status ?? error.statusCode ?? 0;

  // HTTP 429 (rate limit), 502/503/504 (server errors)
  if ([429, 502, 503, 504].includes(status)) return true;

  // Network errors
  if (message.includes("econnrefused") || message.includes("econnreset") ||
      message.includes("etimedout") || message.includes("epipe") ||
      message.includes("network") || message.includes("socket hang up") ||
      message.includes("fetch failed")) return true;

  // Rate limit errors
  if (message.includes("rate limit") || message.includes("too many requests") ||
      message.includes("throttl")) return true;

  // Timeout errors
  if (message.includes("timeout") || message.includes("timed out") ||
      message.includes("deadline exceeded")) return true;

  // Temporary service errors
  if (message.includes("temporarily unavailable") || message.includes("service unavailable") ||
      message.includes("internal server error") || message.includes("overloaded")) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── LLM Decision Cache ──────────────────────────────────────────────────────

interface CacheEntry {
  response: string;
  createdAt: number;
  hitCount: number;
}

interface DecisionCacheConfig {
  /** Maximum number of cached entries */
  maxEntries: number;
  /** TTL for cache entries in ms (default: 1 hour) */
  ttlMs: number;
}

/**
 * In-memory LRU-ish cache for LLM responses.
 * Keys are hashed from the prompt content.
 * Uses TTL eviction + LRU eviction when at capacity.
 */
export class LlmDecisionCache {
  private cache = new Map<string, CacheEntry>();
  private config: DecisionCacheConfig;
  private stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(config?: Partial<DecisionCacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 200,
      ttlMs: config?.ttlMs ?? 60 * 60 * 1000, // 1 hour
    };
  }

  /**
   * Get a cached response for a prompt.
   * Returns null if not cached or expired.
   */
  get(prompt: string): string | null {
    const key = this.hashPrompt(prompt);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.hitCount++;
    this.stats.hits++;

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.response;
  }

  /**
   * Store a response in the cache.
   */
  set(prompt: string, response: string): void {
    const key = this.hashPrompt(prompt);

    // Evict if at capacity
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(key)) {
      // Remove oldest entry (first in Map iteration order = LRU)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        this.stats.evictions++;
      }
    }

    this.cache.set(key, {
      response,
      createdAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * Get cache statistics.
   */
  getStats(): { hits: number; misses: number; evictions: number; size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
    };
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Evict expired entries.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.config.ttlMs) {
        this.cache.delete(key);
        evicted++;
      }
    }
    this.stats.evictions += evicted;
    return evicted;
  }

  /**
   * Hash a prompt to a cache key.
   * Uses a simple FNV-1a hash for speed.
   */
  private hashPrompt(prompt: string): string {
    // Normalize whitespace for better cache hits
    const normalized = prompt.trim().replace(/\s+/g, " ");

    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = (hash * 0x01000193) | 0; // FNV prime, force 32-bit
    }
    return hash.toString(36);
  }
}

// ── Resilient LLM Wrapper ────────────────────────────────────────────────────

/**
 * Wraps an ILLM instance with circuit breaker, retry, and caching.
 */
export class ResilientLlm {
  private static circuitBreaker = new CircuitBreaker();
  private static cache = new LlmDecisionCache();

  /**
   * Execute an LLM completion with full resilience:
   * 1. Check circuit breaker
   * 2. Check decision cache
   * 3. Retry with exponential backoff
   * 4. Record success/failure for circuit breaker
   * 5. Cache the response
   */
  static async complete(
    llm: ILLM,
    prompt: string,
    options?: { maxTokens?: number; skipCache?: boolean; abortSignal?: AbortSignal },
  ): Promise<string> {
    // 1. Circuit breaker check
    if (!ResilientLlm.circuitBreaker.canExecute()) {
      throw new Error("Circuit breaker is open — LLM provider appears unavailable");
    }

    if (options?.abortSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // 2. Cache check (unless skipCache)
    if (!options?.skipCache) {
      const cached = ResilientLlm.cache.get(prompt);
      if (cached) return cached;
    }

    // 3. Execute with retry
    const signal = options?.abortSignal ?? new AbortController().signal;
    try {
      const response = await retryWithBackoff(
        () => llm.complete(prompt, signal, {
          maxTokens: options?.maxTokens,
        }),
        { maxRetries: 2 },
      );

      // 4. Record success
      ResilientLlm.circuitBreaker.onSuccess();

      // 5. Cache the response
      const trimmed = response.trim();
      if (!options?.skipCache) {
        ResilientLlm.cache.set(prompt, trimmed);
      }

      return trimmed;
    } catch (error) {
      // 4. Record failure
      ResilientLlm.circuitBreaker.onFailure();
      throw error;
    }
  }

  /**
   * Get circuit breaker and cache diagnostics.
   */
  static getDiagnostics(): {
    circuitBreaker: { state: CircuitState; failureCount: number; lastFailureTime: number };
    cache: { hits: number; misses: number; evictions: number; size: number; hitRate: number };
  } {
    return {
      circuitBreaker: ResilientLlm.circuitBreaker.getState(),
      cache: ResilientLlm.cache.getStats(),
    };
  }

  /**
   * Reset all resilience state (for testing or manual recovery).
   */
  static reset(): void {
    ResilientLlm.circuitBreaker.reset();
    ResilientLlm.cache.clear();
  }

  /**
   * Evict expired cache entries.
   */
  static evictExpiredCache(): number {
    return ResilientLlm.cache.evictExpired();
  }
}
