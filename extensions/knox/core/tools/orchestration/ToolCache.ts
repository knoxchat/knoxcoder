/**
 * Tool Cache - Intelligent caching for tool results
 * 
 * Features:
 * - TTL-based cache expiration
 * - Custom key generation
 * - Cache invalidation triggers
 * - Memory-efficient LRU eviction
 * - Cache statistics and monitoring
 */

import { CacheConfig, ToolResult } from "./types.js";

interface CacheEntry {
  result: ToolResult;
  createdAt: number;
  ttlMs: number;
  accessCount: number;
  lastAccessedAt: number;
  key: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  totalEntries: number;
  memoryEstimate: number;
}

/**
 * LRU Cache implementation for tool results
 */
export class ToolCache {
  private static instance: ToolCache;
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries: number = 1000;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalEntries: 0,
    memoryEstimate: 0
  };

  // Invalidation subscriptions: toolName -> cache keys to invalidate
  private invalidationMap: Map<string, Set<string>> = new Map();

  protected constructor() {
    // Start cleanup interval
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  public static getInstance(): ToolCache {
    if (!ToolCache.instance) {
      ToolCache.instance = new ToolCache();
    }
    return ToolCache.instance;
  }

  /**
   * Set maximum cache entries
   */
  setMaxEntries(max: number): void {
    this.maxEntries = max;
    this.evictIfNeeded();
  }

  /**
   * Get cached result
   */
  get(toolName: string, args: Record<string, any>, config: CacheConfig): ToolResult | null {
    const key = this.generateKey(toolName, args, config.keyGenerator);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update access info
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    this.stats.hits++;

    // Return result with cached flag
    return { ...entry.result, cached: true };
  }

  /**
   * Set cached result
   */
  set(
    toolName: string, 
    args: Record<string, any>, 
    result: ToolResult, 
    config: CacheConfig
  ): void {
    const key = this.generateKey(toolName, args, config.keyGenerator);

    // Evict if at capacity
    this.evictIfNeeded();

    const entry: CacheEntry = {
      result,
      createdAt: Date.now(),
      ttlMs: config.ttlMs,
      accessCount: 0,
      lastAccessedAt: Date.now(),
      key
    };

    this.cache.set(key, entry);
    this.stats.totalEntries = this.cache.size;

    // Register invalidation triggers
    if (config.invalidateOn) {
      for (const triggerTool of config.invalidateOn) {
        if (!this.invalidationMap.has(triggerTool)) {
          this.invalidationMap.set(triggerTool, new Set());
        }
        this.invalidationMap.get(triggerTool)!.add(key);
      }
    }

    this.updateMemoryEstimate();
  }

  /**
   * Invalidate cache entries triggered by a tool execution
   */
  invalidateFor(toolName: string): void {
    const keysToInvalidate = this.invalidationMap.get(toolName);
    if (keysToInvalidate) {
      for (const key of keysToInvalidate) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
      this.invalidationMap.delete(toolName);
      this.stats.totalEntries = this.cache.size;
    }
  }

  /**
   * Invalidate all cache entries for a specific tool
   */
  invalidateTool(toolName: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(`${toolName}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.stats.evictions++;
    }
    this.stats.totalEntries = this.cache.size;
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.stats.evictions++;
    }
    this.stats.totalEntries = this.cache.size;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.invalidationMap.clear();
    this.stats.totalEntries = 0;
    this.stats.memoryEstimate = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get hit rate percentage
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return (this.stats.hits / total) * 100;
  }

  /**
   * Generate cache key
   */
  private generateKey(
    toolName: string, 
    args: Record<string, any>, 
    customGenerator?: (args: Record<string, any>) => string
  ): string {
    if (customGenerator) {
      return `${toolName}:${customGenerator(args)}`;
    }
    // Default: stable JSON stringification
    return `${toolName}:${this.stableStringify(args)}`;
  }

  /**
   * Stable JSON stringify (sorts keys for consistency)
   */
  private stableStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.stableStringify(item)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(key => 
      JSON.stringify(key) + ':' + this.stableStringify(obj[key])
    ).join(',') + '}';
  }

  /**
   * Evict least recently used entries if at capacity
   */
  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxEntries) {
      // Find LRU entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }
    this.stats.totalEntries = this.cache.size;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > entry.ttlMs) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    this.stats.totalEntries = this.cache.size;
    this.updateMemoryEstimate();
  }

  /**
   * Estimate memory usage
   */
  private updateMemoryEstimate(): void {
    let estimate = 0;
    for (const entry of this.cache.values()) {
      // Rough estimate: key + result content
      estimate += entry.key.length * 2; // UTF-16
      for (const item of entry.result.output) {
        estimate += (item.content?.length || 0) * 2;
        estimate += (item.name?.length || 0) * 2;
        estimate += (item.description?.length || 0) * 2;
      }
    }
    this.stats.memoryEstimate = estimate;
  }
}

/**
 * Cache decorator factory for tool implementations
 */
export function cacheable(config: CacheConfig) {
  const cache = ToolCache.getInstance();
  
  return function<T extends (...args: any[]) => Promise<any>>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> | void {
    const originalMethod = descriptor.value!;

    descriptor.value = async function(this: any, ...args: any[]) {
      const toolName = propertyKey;
      const toolArgs = args[0] as Record<string, any>;

      // Check cache
      const cached = cache.get(toolName, toolArgs, config);
      if (cached) {
        return cached.output;
      }

      // Execute and cache
      const result = await originalMethod.apply(this, args);
      cache.set(toolName, toolArgs, {
        success: true,
        toolName,
        output: result,
        executionTime: 0
      }, config);

      return result;
    } as T;

    return descriptor;
  };
}

/**
 * Smart cache with predictive warming
 */
export class SmartCache extends ToolCache {
  private accessPatterns: Map<string, string[]> = new Map();
  private patternWindow: number = 10;

  /**
   * Record access pattern for predictive caching
   */
  recordPattern(toolName: string, args: Record<string, any>): void {
    const key = this.generatePatternKey(toolName, args);
    const pattern = this.accessPatterns.get(key) || [];
    pattern.push(key);
    
    // Keep only recent patterns
    if (pattern.length > this.patternWindow) {
      pattern.shift();
    }
    
    this.accessPatterns.set(key, pattern);
  }

  /**
   * Predict and pre-warm cache based on patterns
   */
  predictNext(currentTool: string): string[] {
    const predictions: Map<string, number> = new Map();
    
    for (const [, pattern] of this.accessPatterns.entries()) {
      for (let i = 0; i < pattern.length - 1; i++) {
        if (pattern[i].startsWith(currentTool)) {
          const nextTool = pattern[i + 1].split(':')[0];
          predictions.set(nextTool, (predictions.get(nextTool) || 0) + 1);
        }
      }
    }

    // Return sorted predictions
    return [...predictions.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool]) => tool)
      .slice(0, 3);
  }

  private generatePatternKey(toolName: string, args: Record<string, any>): string {
    return `${toolName}:${JSON.stringify(args)}`;
  }
}
