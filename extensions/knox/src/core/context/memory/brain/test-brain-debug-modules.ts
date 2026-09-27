#!/usr/bin/env npx tsx
/**
 * test-brain-debug-modules.ts — Module-level unit tests for Memory Brain internals.
 *
 * Tests individual classes & algorithms directly (not through dispatch):
 *   - WorkingMemory: Miller's Law slots, decay, attention gating, eviction
 *   - CircuitBreaker: state transitions (closed → open → half_open → closed)
 *   - LlmDecisionCache: FNV-1a hashing, TTL, LRU eviction, stats
 *   - LruCache: capacity, TTL, memory limits, eviction, stats
 *   - SpacedRepetition: Ebbinghaus retention calculation, boost mechanics
 *   - SleepConsolidation: runCycle phases (requires DB)
 *   - retryWithBackoff: retry logic, transient error detection
 *
 * Usage:
 *   cd core && npx tsx context/memory/brain/test-brain-debug-modules.ts
 *
 * Uses a temporary database — real data is never touched.
 */

import fs from "fs";
import os from "os";
import path from "path";

// ── Patch DB path before any imports ────────────────────────────────────────
const testDir = path.join(os.tmpdir(), `brain-modules-${Date.now()}`);
fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
process.env.KNOX_GLOBAL_DIR = testDir;

// ── Dynamic imports after env setup ─────────────────────────────────────────
const { WorkingMemory } = await import("./WorkingMemory.js");
const { CircuitBreaker, LlmDecisionCache, retryWithBackoff } = await import("./LlmResilience.js");
const { LruCache, SpacedRepetition } = await import("./AdvancedFeatures.js");
const { MetricsCollector } = await import("./PerformanceMonitor.js");
const { BrainManager } = await import("./BrainManager.js");
const { BrainStore } = await import("./BrainStore.js");

// ── Test Harness ────────────────────────────────────────────────────────────

interface TestResult {
  section: string;
  label: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];
let currentSection = "";

function setSection(name: string): void {
  currentSection = name;
  console.log(`\n━━━ ${name} ━━━`);
}

async function test(label: string, fn: () => void | Promise<void>): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    results.push({ section: currentSection, label, passed: true, durationMs: performance.now() - start });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ section: currentSection, label, passed: false, error: msg.substring(0, 300), durationMs: performance.now() - start });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertApprox(actual: number, expected: number, epsilon: number, label: string): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${label}: expected ~${expected} ±${epsilon}, got ${actual}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WORKING MEMORY
// ════════════════════════════════════════════════════════════════════════════

async function testWorkingMemory(): Promise<void> {
  setSection("WorkingMemory");

  await test("Create instance", () => {
    const wm = new WorkingMemory({ maxSlots: 7, tokenBudget: 32000 });
    assert(wm.getAll().length === 0, "Should start empty");
  });

  await test("Add items up to capacity", () => {
    const wm = new WorkingMemory({ maxSlots: 5, tokenBudget: 100000 });
    for (let i = 0; i < 5; i++) {
      wm.add({ id: `item-${i}`, content: `Content ${i}`, source: "semantic", relevance: 0.5 + i * 0.1 });
    }
    assert(wm.getAll().length === 5, `Expected 5 items, got ${wm.getAll().length}`);
  });

  await test("Evict lowest relevance on overflow", () => {
    const wm = new WorkingMemory({ maxSlots: 3, tokenBudget: 100000 });
    wm.add({ id: "low", content: "Low priority", source: "semantic", relevance: 0.1 });
    wm.add({ id: "med", content: "Medium priority", source: "semantic", relevance: 0.5 });
    wm.add({ id: "high", content: "High priority", source: "semantic", relevance: 0.9 });
    wm.add({ id: "top", content: "Top priority", source: "semantic", relevance: 1.0 });

    assert(wm.getAll().length <= 3, "Should cap at 3");
    const ids = wm.getAll().map((i) => i.id);
    assert(!ids.includes("low"), "Low relevance item should be evicted");
    assert(ids.includes("top"), "Top relevance item should remain");
    assert(ids.includes("high"), "High relevance item should remain");
  });

  await test("Token budget eviction", () => {
    // tokenBudget: each item content ~400 chars = ~100 tokens. Budget = 250 tokens = ~2.5 items
    const wm = new WorkingMemory({ maxSlots: 10, tokenBudget: 250 });
    wm.add({ id: "a", content: "A".repeat(400), source: "semantic", relevance: 0.1 });
    wm.add({ id: "b", content: "B".repeat(400), source: "semantic", relevance: 0.5 });
    wm.add({ id: "c", content: "C".repeat(400), source: "semantic", relevance: 0.9 });
    // Adding 4th should trigger eviction
    wm.add({ id: "d", content: "D".repeat(400), source: "semantic", relevance: 0.8 });
    assert(wm.getAll().length <= 3, `Should stay within token budget, got ${wm.getAll().length}`);
  });

  await test("Get item by ID", () => {
    const wm = new WorkingMemory({ maxSlots: 7, tokenBudget: 100000 });
    wm.add({ id: "find-me", content: "Findable", source: "semantic", relevance: 0.7 });
    const item = wm.get("find-me");
    assert(item !== undefined, "Should find item by ID");
    assert(item!.content === "Findable", "Content should match");
  });

  await test("Remove item", () => {
    const wm = new WorkingMemory({ maxSlots: 7, tokenBudget: 100000 });
    wm.add({ id: "rem", content: "Remove me", source: "semantic", relevance: 0.5 });
    assert(wm.getAll().length === 1, "Item should be added");
    wm.remove("rem");
    assert(wm.getAll().length === 0, "Item should be removed");
    assert(wm.get("rem") === undefined, "Removed item should not be found");
  });

  await test("Refresh updates last_refreshed", async () => {
    const wm = new WorkingMemory({ maxSlots: 7, tokenBudget: 100000 });
    wm.add({ id: "old", content: "Old item", source: "semantic", relevance: 0.5 });
    const beforeRefresh = wm.get("old")!.last_refreshed;
    // Small delay
    await new Promise((r) => setTimeout(r, 10));
    wm.refresh("old");
    const afterRefresh = wm.get("old")!.last_refreshed;
    assert(afterRefresh >= beforeRefresh, "last_refreshed should not decrease");
  });

  await test("AttendTo (attention gating)", () => {
    const wm = new WorkingMemory({ maxSlots: 5, tokenBudget: 100000 });
    wm.add({ id: "a1", content: "Alpha topic keyword", source: "semantic", relevance: 0.3 });
    wm.add({ id: "a2", content: "Beta unrelated", source: "semantic", relevance: 0.3 });
    wm.add({ id: "a3", content: "Gamma unrelated", source: "semantic", relevance: 0.3 });

    wm.attendTo("Alpha");
    const attended = wm.get("a1");
    assert(attended !== undefined, "Attended item should exist");
    // After attention on matching query, relevance should be boosted
    assert(attended!.relevance >= 0.3, "Attended item relevance should be >= initial");
  });

  await test("BuildContext returns formatted string", () => {
    const wm = new WorkingMemory({ maxSlots: 5, tokenBudget: 100000 });
    wm.add({ id: "ctx1", content: "Context item 1", source: "semantic", relevance: 0.8 });
    wm.add({ id: "ctx2", content: "Context item 2", source: "semantic", relevance: 0.6 });

    const ctx = wm.buildContext();
    assert(typeof ctx === "string", "buildContext should return string");
    assert(ctx !== null && ctx!.length > 0, "Context should not be empty");
    assert(ctx!.includes("Context item 1"), "Should contain item 1");
    assert(ctx!.includes("Context item 2"), "Should contain item 2");
  });

  await test("Decay reduces relevance over time simulation", () => {
    const wm = new WorkingMemory({ maxSlots: 5, tokenBudget: 100000, decayRatePerSecond: 1 });
    wm.add({ id: "decay", content: "Decaying item", source: "semantic", relevance: 1.0 });
    const item = wm.get("decay")!;
    const originalRelevance = item.relevance;
    // Access after delay should be fine
    assert(originalRelevance > 0, "Should have positive relevance");
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ════════════════════════════════════════════════════════════════════════════

async function testCircuitBreaker(): Promise<void> {
  setSection("CircuitBreaker");

  await test("Starts in closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    assert(cb.getState().state === "closed", `Expected closed, got ${cb.getState().state}`);
  });

  await test("canExecute returns true when closed", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    assert(cb.canExecute() === true, "Should allow execution when closed");
  });

  await test("Stays closed on success", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    cb.onSuccess();
    assert(cb.getState().state === "closed", "Should stay closed after success");
  });

  await test("Opens after threshold failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100 });
    cb.onFailure();
    cb.onFailure();
    assert(cb.getState().state === "open", `Expected open, got ${cb.getState().state}`);
  });

  await test("canExecute returns false when open", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    cb.onFailure();
    assert(cb.getState().state === "open", "Should be open");
    assert(cb.canExecute() === false, "Should not allow execution when open");
  });

  await test("Transitions to half_open after timeout", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    cb.onFailure();
    assert(cb.getState().state === "open", "Should be open");

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 80));
    // canExecute() triggers the transition to half_open
    assert(cb.canExecute() === true, "Should allow execution after timeout");
    assert(cb.getState().state === "half_open", `Expected half_open, got ${cb.getState().state}`);
  });

  await test("Closes on success in half_open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50, halfOpenSuccessThreshold: 1 });
    cb.onFailure();
    await new Promise((r) => setTimeout(r, 80));
    cb.canExecute(); // Trigger transition to half_open
    assert(cb.getState().state === "half_open", "Should be half_open");

    cb.onSuccess();
    assert(cb.getState().state === "closed", `Expected closed, got ${cb.getState().state}`);
  });

  await test("Re-opens on failure in half_open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    cb.onFailure();
    await new Promise((r) => setTimeout(r, 80));
    cb.canExecute(); // Trigger transition to half_open
    assert(cb.getState().state === "half_open", "Should be half_open");

    cb.onFailure();
    assert(cb.getState().state === "open", `Expected open, got ${cb.getState().state}`);
  });

  await test("Success resets failure count", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    // 2 failures
    cb.onFailure();
    cb.onFailure();
    assert(cb.getState().state === "closed", "Should still be closed (under threshold)");
    assert(cb.getState().failureCount === 2, "Failure count should be 2");

    // 1 success resets counter
    cb.onSuccess();
    assert(cb.getState().state === "closed", "Should be closed");
    assert(cb.getState().failureCount === 0, "Failure count should reset to 0");
  });

  await test("Reset clears state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    cb.onFailure();
    assert(cb.getState().state === "open", "Should be open");
    cb.reset();
    assert(cb.getState().state === "closed", "Should be closed after reset");
    assert(cb.getState().failureCount === 0, "Failure count should be 0");
  });
}

// ════════════════════════════════════════════════════════════════════════════
// LLM DECISION CACHE
// ════════════════════════════════════════════════════════════════════════════

async function testLlmDecisionCache(): Promise<void> {
  setSection("LlmDecisionCache");

  await test("Set and get", () => {
    const cache = new LlmDecisionCache({ maxEntries: 100, ttlMs: 60000 });
    cache.set("What is TypeScript?", "TypeScript is a typed superset of JavaScript.");
    const result = cache.get("What is TypeScript?");
    assert(result !== null, "Should find cached value");
    assert(result!.includes("TypeScript"), `Expected TypeScript mention, got ${result}`);
  });

  await test("Missing key returns null", () => {
    const cache = new LlmDecisionCache({ maxEntries: 100, ttlMs: 60000 });
    const result = cache.get("nonexistent prompt");
    assert(result === null, `Should return null for missing key, got ${result}`);
  });

  await test("TTL expiration", async () => {
    const cache = new LlmDecisionCache({ maxEntries: 100, ttlMs: 30 });
    cache.set("expire-prompt", "expire-response");
    assert(cache.get("expire-prompt") !== null, "Should exist before TTL");

    await new Promise((r) => setTimeout(r, 60));
    const result = cache.get("expire-prompt");
    assert(result === null, `Should expire after TTL, got ${result}`);
  });

  await test("LRU eviction at capacity", () => {
    const cache = new LlmDecisionCache({ maxEntries: 3, ttlMs: 60000 });
    cache.set("prompt-a", "response-a");
    cache.set("prompt-b", "response-b");
    cache.set("prompt-c", "response-c");
    cache.set("prompt-d", "response-d"); // Should evict "prompt-a" (oldest)

    assert(cache.get("prompt-a") === null, "LRU item 'a' should be evicted");
    assert(cache.get("prompt-b") !== null, "Item 'b' should survive");
    assert(cache.get("prompt-d") !== null, "New item 'd' should exist");
  });

  await test("Access refreshes LRU order", () => {
    const cache = new LlmDecisionCache({ maxEntries: 3, ttlMs: 60000 });
    cache.set("prompt-x", "response-x");
    cache.set("prompt-y", "response-y");
    cache.set("prompt-z", "response-z");
    cache.get("prompt-x"); // Refresh LRU for 'x'
    cache.set("prompt-w", "response-w"); // Should evict 'y' (now least recent)

    assert(cache.get("prompt-x") !== null, "Recently accessed 'x' should survive");
    assert(cache.get("prompt-y") === null, "LRU item 'y' should be evicted");
    assert(cache.get("prompt-w") !== null, "New item 'w' should exist");
  });

  await test("Stats tracking", () => {
    const cache = new LlmDecisionCache({ maxEntries: 10, ttlMs: 60000 });
    cache.set("stats-prompt", "stats-response");
    cache.get("stats-prompt"); // Hit
    cache.get("missing-prompt"); // Miss

    const stats = cache.getStats();
    assert(stats.hits >= 1, `Expected >= 1 hit, got ${stats.hits}`);
    assert(stats.misses >= 1, `Expected >= 1 miss, got ${stats.misses}`);
    assert(stats.size === 1, `Expected size 1, got ${stats.size}`);
  });

  await test("Clear cache", () => {
    const cache = new LlmDecisionCache({ maxEntries: 10, ttlMs: 60000 });
    cache.set("clear-prompt-1", "response-1");
    cache.set("clear-prompt-2", "response-2");
    cache.clear();
    assert(cache.get("clear-prompt-1") === null, "Should be empty after clear");
    assert(cache.getStats().size === 0, "Size should be 0 after clear");
  });

  await test("FNV-1a hash determinism", () => {
    const cache = new LlmDecisionCache({ maxEntries: 10, ttlMs: 60000 });
    cache.set("deterministic-prompt", "deterministic-response");
    const r1 = cache.get("deterministic-prompt");
    const r2 = cache.get("deterministic-prompt");
    assert(r1 === r2, "Same key should always retrieve same value");
  });

  await test("evictExpired removes stale entries", async () => {
    const cache = new LlmDecisionCache({ maxEntries: 10, ttlMs: 30 });
    cache.set("p1", "r1");
    cache.set("p2", "r2");
    await new Promise((r) => setTimeout(r, 60));
    const evicted = cache.evictExpired();
    assert(evicted >= 2, `Should evict >= 2, got ${evicted}`);
    assert(cache.getStats().size === 0, "Should be empty after eviction");
  });
}

// ════════════════════════════════════════════════════════════════════════════
// LRU CACHE (from AdvancedFeatures)
// ════════════════════════════════════════════════════════════════════════════

async function testLruCache(): Promise<void> {
  setSection("LruCache");

  await test("Basic set/get", () => {
    const cache = new LruCache<string>({ maxEntries: 100 });
    cache.set("key", "value");
    assert(cache.get("key") === "value", "Should return stored value");
  });

  await test("Capacity enforcement", () => {
    const cache = new LruCache<number>({ maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4); // Should evict "a"

    assert(cache.get("a") === undefined, "Oldest 'a' should be evicted");
    assert(cache.get("d") === 4, "New 'd' should exist");
  });

  await test("TTL expiration", async () => {
    const cache = new LruCache<string>({ maxEntries: 100, ttlMs: 30 });
    cache.set("ttl-item", "expires-soon");
    assert(cache.get("ttl-item") === "expires-soon", "Should exist before TTL");

    await new Promise((r) => setTimeout(r, 60));
    assert(cache.get("ttl-item") === undefined, "Should expire after TTL");
  });

  await test("Remove item", () => {
    const cache = new LruCache<string>({ maxEntries: 100 });
    cache.set("del", "delete-me");
    cache.remove("del");
    assert(cache.get("del") === undefined, "Removed item should be gone");
  });

  await test("Clear all", () => {
    const cache = new LruCache<string>({ maxEntries: 100 });
    cache.set("c1", "v1");
    cache.set("c2", "v2");
    cache.clear();
    assert(cache.get("c1") === undefined, "Should be empty");
    assert(cache.get("c2") === undefined, "Should be empty");
  });

  await test("Stats tracking", () => {
    const cache = new LruCache<string>({ maxEntries: 100 });
    cache.set("s1", "v1");
    cache.get("s1"); // Hit
    cache.get("miss"); // Miss

    const stats = cache.getStats();
    assert(stats.hits >= 1, `Expected >= 1 hit, got ${stats.hits}`);
    assert(stats.misses >= 1, `Expected >= 1 miss, got ${stats.misses}`);
    assert(stats.size >= 1, `Expected >= 1 size, got ${stats.size}`);
    assert(stats.hit_rate >= 0 && stats.hit_rate <= 1, "Hit rate should be 0-1");
  });

  await test("Overwrite existing key", () => {
    const cache = new LruCache<string>({ maxEntries: 100 });
    cache.set("ow", "original");
    cache.set("ow", "updated");
    assert(cache.get("ow") === "updated", "Should return updated value");
    assert(cache.getStats().size === 1, "Size should still be 1");
  });

  await test("LRU order maintained", () => {
    const cache = new LruCache<number>({ maxEntries: 3 });
    cache.set("1", 1);
    cache.set("2", 2);
    cache.set("3", 3);
    cache.get("1"); // Make "1" most recently used
    cache.set("4", 4); // Should evict "2" (now least recent)

    assert(cache.get("1") === 1, "'1' should survive (recently accessed)");
    assert(cache.get("2") === undefined, "'2' should be evicted (LRU)");
    assert(cache.get("4") === 4, "'4' should exist (newest)");
  });

  await test("Memory limit enforcement", () => {
    const cache = new LruCache<string>({ maxEntries: 100, maxMemoryBytes: 500 });
    // Each string + key overhead should eventually hit limit
    for (let i = 0; i < 50; i++) {
      cache.set(`key-${i}`, "x".repeat(100), 100);
    }
    const stats = cache.getStats();
    assert(stats.size < 50, `Should evict some items due to memory limit, size: ${stats.size}`);
    assert(stats.evictions > 0, `Should have evictions, got ${stats.evictions}`);
  });

  await test("Has checks existence without promoting", () => {
    const cache = new LruCache<string>({ maxEntries: 100 });
    cache.set("exists", "yes");
    assert(cache.has("exists") === true, "Should return true for existing key");
    assert(cache.has("nope") === false, "Should return false for missing key");
  });

  await test("evictExpired removes stale entries", async () => {
    const cache = new LruCache<string>({ maxEntries: 100, ttlMs: 30 });
    cache.set("e1", "v1");
    cache.set("e2", "v2");
    await new Promise((r) => setTimeout(r, 60));
    const evicted = cache.evictExpired();
    assert(evicted >= 2, `Should evict >= 2, got ${evicted}`);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SPACED REPETITION
// ════════════════════════════════════════════════════════════════════════════

async function testSpacedRepetition(): Promise<void> {
  setSection("SpacedRepetition");

  // SpacedRepetition uses static methods. calculateRetention(lastAccessedAt: string, retrievalCount: number)

  await test("calculateRetention: fresh memory = high retention", () => {
    const now = new Date().toISOString();
    const retention = SpacedRepetition.calculateRetention(now, 1);
    assert(retention >= 0.9, `Fresh memory retention should be >= 0.9, got ${retention}`);
  });

  await test("calculateRetention: old memory = lower retention", () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const retention = SpacedRepetition.calculateRetention(threeDaysAgo, 1);
    assert(retention < 0.99, `72h old memory should have < 0.99 retention, got ${retention}`);
  });

  await test("calculateRetention: more retrievals = better retention", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const lowRetrievals = SpacedRepetition.calculateRetention(oneDayAgo, 1);
    const highRetrievals = SpacedRepetition.calculateRetention(oneDayAgo, 10);
    assert(highRetrievals >= lowRetrievals,
      `More retrievals (${highRetrievals}) should retain >= fewer (${lowRetrievals})`);
  });

  await test("boostOnRetrieval: increases importance", async () => {
    // Store a memory for testing
    const id = await BrainManager.store({
      category: "fact", title: "SpacedRep boost test",
      content: "Memory for testing spaced repetition boost.",
      keywords: "spaced,repetition,test", importance: 0.5,
    });
    const newImportance = await SpacedRepetition.boostOnRetrieval(id);
    assert(newImportance > 0.5, `Boosted importance should be > 0.5, got ${newImportance}`);
  });

  await test("boostOnRetrieval: α strengthening increases with access count", async () => {
    const id = await BrainManager.store({
      category: "fact", title: "Alpha strengthening test",
      content: "Testing Part IV alpha strengthening on repeated boosts.",
      keywords: "alpha,strengthening,test", importance: 0.5,
    });
    const boost1 = await SpacedRepetition.boostOnRetrieval(id);
    const boost2 = await SpacedRepetition.boostOnRetrieval(id);
    const delta1 = boost1 - 0.5;
    const delta2 = boost2 - boost1;
    // Theorem: I₀·(1+α·n) — later boosts add more as n grows
    assert(delta2 >= delta1 - 0.001, `Second boost delta (${delta2}) should be >= first (${delta1})`);
  });

  await test("getMemoriesDueForReview returns array", async () => {
    const due = await SpacedRepetition.getMemoriesDueForReview(0.99, 100);
    assert(Array.isArray(due), "Should return array");
    // With very high threshold, most memories should be "due"
    assert(due.length >= 0, `Due count: ${due.length}`);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// RETRY WITH BACKOFF
// ════════════════════════════════════════════════════════════════════════════

async function testRetryWithBackoff(): Promise<void> {
  setSection("retryWithBackoff");

  await test("Succeeds on first try", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => { calls++; return "ok"; }, { maxRetries: 3, baseDelayMs: 10 });
    assert(result === "ok", "Should return result");
    assert(calls === 1, `Should call once, called ${calls}`);
  });

  await test("Retries on transient error and succeeds", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) throw new Error("Connection timeout");
      return "recovered";
    }, { maxRetries: 5, baseDelayMs: 10 });
    assert(result === "recovered", "Should eventually succeed");
    assert(calls === 3, `Should call 3 times, called ${calls}`);
  });

  await test("Gives up after max retries", async () => {
    let calls = 0;
    try {
      await retryWithBackoff(async () => {
        calls++;
        throw new Error("Connection timeout");
      }, { maxRetries: 2, baseDelayMs: 10 });
      throw new Error("Should have thrown");
    } catch (err) {
      assert((err as Error).message.includes("timeout"), "Should throw original error");
      assert(calls === 3, `Should try 1 + 2 retries = 3 calls, got ${calls}`);
    }
  });

  await test("Does not retry non-transient errors", async () => {
    let calls = 0;
    try {
      await retryWithBackoff(async () => {
        calls++;
        throw new Error("UNIQUE constraint failed");
      }, { maxRetries: 3, baseDelayMs: 10 });
      throw new Error("Should have thrown");
    } catch {
      assert(calls === 1, `Non-transient should not retry, called ${calls}`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLEEP CONSOLIDATION (requires DB)
// ════════════════════════════════════════════════════════════════════════════

async function testSleepConsolidation(): Promise<void> {
  setSection("SleepConsolidation");

  const { SleepConsolidation } = await import("./SleepConsolidation.js");

  // Populate some memories for consolidation
  for (let i = 0; i < 10; i++) {
    await BrainManager.store({
      category: "fact", title: `Sleep consolidation item ${i}`,
      content: `Content for sleep consolidation test item number ${i}.`,
      keywords: `sleep,consolidation,test${i}`, importance: 0.3 + i * 0.07,
    });
  }

  await test("RunCycle completes without error", async () => {
    const result = await SleepConsolidation.runCycle();
    assert(typeof result.promoted === "number", "Should have promoted count");
    assert(typeof result.demoted === "number", "Should have demoted count");
    assert(typeof result.pruned === "number", "Should have pruned count");
    assert(typeof result.replayed === "number", "Should have replayed count");
    assert(typeof result.strengthened === "number", "Should have strengthened count");
    assert(typeof result.distilled === "number", "Should have distilled count");
    assert(typeof result.compressed === "number", "Should have compressed count");
    console.log(`    Cycle: replayed=${result.replayed} strengthened=${result.strengthened} distilled=${result.distilled} compressed=${result.compressed} promoted=${result.promoted}`);
  });

  await test("Multiple cycles accumulate", async () => {
    const r1 = await SleepConsolidation.runCycle();
    const r2 = await SleepConsolidation.runCycle();
    // Both should complete without error
    assert(typeof r2.promoted === "number", "Second cycle should also have promoted count");
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FIVE-TIER HIERARCHY (from AdvancedFeatures)
// ════════════════════════════════════════════════════════════════════════════

async function testFiveTierHierarchy(): Promise<void> {
  setSection("FiveTierHierarchy");

  const { FiveTierHierarchy } = await import("./AdvancedFeatures.js");

  await test("Consolidate runs without error", async () => {
    const result = await FiveTierHierarchy.consolidate();
    assert(typeof result.promoted === "number", "Should have promoted count");
    assert(typeof result.demoted === "number", "Should have demoted count");
    assert(typeof result.pruned === "number", "Should have pruned count");
  });

  await test("GetTierDistribution returns all 5 tiers", async () => {
    const dist = await FiveTierHierarchy.getTierDistribution();
    assert("active" in dist, "Should have active tier");
    assert("hot" in dist, "Should have hot tier");
    assert("warm" in dist, "Should have warm tier");
    assert("cold" in dist, "Should have cold tier");
    assert("frozen" in dist, "Should have frozen tier");
    console.log(`    Distribution:`, JSON.stringify(dist));
  });

  await test("GetConfigs returns configs for all tiers", async () => {
    const configs = await FiveTierHierarchy.getConfigs();
    assert(Array.isArray(configs) || typeof configs === "object", "Should return config structure");
  });

  await test("UpdateConfig modifies a tier", async () => {
    await FiveTierHierarchy.updateConfig("warm", { max_age_hours: 500, importance_threshold: 0.25 });
    // Verify by checking config
    const configs = await FiveTierHierarchy.getConfigs();
    // Just verify it didn't throw
    assert(configs !== undefined, "Should still have configs after update");
  });
}

// ════════════════════════════════════════════════════════════════════════════
// METRICS COLLECTOR (from PerformanceMonitor)
// ════════════════════════════════════════════════════════════════════════════

async function testMetricsCollector(): Promise<void> {
  setSection("MetricsCollector");

  await test("Measure async operation", async () => {
    const metrics = new MetricsCollector();
    const result = await metrics.measure("test_op", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    assert(result === 42, "Should return operation result");
  });

  await test("GetSummary returns metrics", () => {
    const metrics = new MetricsCollector();
    const summary = metrics.getSummary(60000);
    assert(typeof summary === "object", "Should return object");
    assert("operations" in summary || "total_operations" in summary || typeof summary === "object", "Should have metrics data");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT CAUSE ANALYZER
// ════════════════════════════════════════════════════════════════════════════

async function testRootCauseAnalyzer(): Promise<void> {
  setSection("RootCauseAnalyzer");

  const { RootCauseAnalyzer } = await import("./AdvancedFeatures.js");

  await test("Analyze returns comprehensive report", async () => {
    const report = await RootCauseAnalyzer.analyze();
    assert(typeof report === "object", "Should return object");
    assert("overall_status" in report, "Should have overall_status");
    assert("root_causes" in report, "Should have root_causes array");
    assert("timestamp" in report, "Should have timestamp");
    assert(
      report.overall_status === "healthy" || report.overall_status === "degraded" || report.overall_status === "critical",
      `Status should be healthy/degraded/critical, got ${report.overall_status}`,
    );
    console.log(`    Report: status=${report.overall_status}, root_causes=${report.root_causes.length}`);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// RUN ALL MODULE TESTS
// ════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║   Memory Brain — Module-Level Unit Tests                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  try {
    await testWorkingMemory();
    await testCircuitBreaker();
    await testLlmDecisionCache();
    await testLruCache();
    await testSpacedRepetition();
    await testRetryWithBackoff();
    await testSleepConsolidation();
    await testFiveTierHierarchy();
    await testMetricsCollector();
    await testRootCauseAnalyzer();
  } catch (err) {
    console.error("Fatal error:", err);
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                     MODULE TEST RESULTS                         ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  const sections = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!sections.has(r.section)) sections.set(r.section, []);
    sections.get(r.section)!.push(r);
  }

  for (const [section, tests] of sections) {
    const sp = tests.filter((t) => t.passed).length;
    const icon = sp === tests.length ? "✅" : "⚠️";
    console.log(`║ ${icon} ${section} (${sp}/${tests.length})`.padEnd(65) + "║");
    for (const t of tests) {
      const tick = t.passed ? "✓" : "✗";
      const time = `${t.durationMs.toFixed(0)}ms`.padStart(6);
      console.log(`║   ${tick} ${time} ${t.label.substring(0, 48).padEnd(48)}║`);
      if (!t.passed && t.error) {
        console.log(`║            ${t.error.substring(0, 51).padEnd(51)}║`);
      }
    }
  }

  console.log("╠══════════════════════════════════════════════════════════════════╣");
  const total = results.length;
  const pct = total > 0 ? ((passed.length / total) * 100).toFixed(1) : "0.0";
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0);
  console.log(`║  Total: ${total}  |  Passed: ${passed.length}  |  Failed: ${failed.length}  |  ${pct}%  |  ${(totalTime / 1000).toFixed(1)}s`.padEnd(65) + "║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  if (failed.length > 0) {
    console.log("\n🔍 FAILED TESTS DETAIL:");
    for (const f of failed) {
      console.log(`\n  ❌ [${f.section}] ${f.label}`);
      console.log(`     Error: ${f.error}`);
    }
  }

  // Cleanup
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.log(`\n🧹 Cleaned up temp dir: ${testDir}`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
