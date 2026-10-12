

// ══════════════════════════════════════════════════════════════════════════════
// 26. LRU Cache Layer
// ══════════════════════════════════════════════════════════════════════════════

interface LruEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
  sizeEstimate: number;
}

export interface LruCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  max_size: number;
  hit_rate: number;
  total_memory_bytes: number;
  avg_entry_age_ms: number;
  hottest_keys: Array<{ key: string; hits: number }>;
}

export interface LruCacheConfig {
  maxEntries: number;
  ttlMs: number;
  maxMemoryBytes: number;
}

/**
 * General-purpose LRU cache with TTL, memory limits, and detailed statistics.
 * Used to cache frequently accessed memories, search results, and entity lookups.
 */
export class LruCache<T = any> {
  private cache = new Map<string, LruEntry<T>>();
  private config: LruCacheConfig;
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private totalMemoryBytes = 0;

  constructor(config?: Partial<LruCacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 500,
      ttlMs: config?.ttlMs ?? 30 * 60 * 1000, // 30 minutes
      maxMemoryBytes: config?.maxMemoryBytes ?? 10 * 1024 * 1024, // 10MB
    };
  }

  /**
   * Get a value from cache. Returns undefined if not found or expired.
   * Promotes the entry to most-recently-used position.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.remove(key);
      this.stats.misses++;
      return undefined;
    }

    // Promote to MRU (re-insert to maintain order)
    this.cache.delete(key);
    entry.lastAccessedAt = Date.now();
    entry.hitCount++;
    this.cache.set(key, entry);
    this.stats.hits++;

    return entry.value;
  }

  /**
   * Set a value in cache. Evicts LRU entries if at capacity.
   */
  set(key: string, value: T, sizeEstimate?: number): void {
    const size = sizeEstimate ?? this.estimateSize(value);

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.remove(key);
    }

    // Evict until we have room
    while (
      this.cache.size >= this.config.maxEntries ||
      this.totalMemoryBytes + size > this.config.maxMemoryBytes
    ) {
      if (this.cache.size === 0) break;
      this.evictLru();
    }

    const entry: LruEntry<T> = {
      key,
      value,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      hitCount: 0,
      sizeEstimate: size,
    };

    this.cache.set(key, entry);
    this.totalMemoryBytes += size;
  }

  /**
   * Check if a key exists (without promoting it).
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.remove(key);
      return false;
    }
    return true;
  }

  /**
   * Remove a key from cache.
   */
  remove(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.totalMemoryBytes -= entry.sizeEstimate;
    this.cache.delete(key);
    return true;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.totalMemoryBytes = 0;
  }

  /**
   * Evict expired entries.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.config.ttlMs) {
        this.remove(key);
        this.stats.evictions++;
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Get cache statistics.
   */
  getStats(): LruCacheStats {
    const now = Date.now();
    let totalAge = 0;
    const entries = Array.from(this.cache.values());
    for (const e of entries) {
      totalAge += now - e.createdAt;
    }

    // Top 10 hottest keys
    const hottest = entries
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10)
      .map((e) => ({ key: e.key, hits: e.hitCount }));

    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
      max_size: this.config.maxEntries,
      hit_rate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      total_memory_bytes: this.totalMemoryBytes,
      avg_entry_age_ms: entries.length > 0 ? totalAge / entries.length : 0,
      hottest_keys: hottest,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  private evictLru(): void {
    // Map iteration order = insertion order; first entry is LRU
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.remove(firstKey);
      this.stats.evictions++;
    }
  }

  private estimateSize(value: T): number {
    if (typeof value === "string") return value.length * 2;
    if (typeof value === "number") return 8;
    if (value === null || value === undefined) return 0;
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 256; // default estimate
    }
  }
}
