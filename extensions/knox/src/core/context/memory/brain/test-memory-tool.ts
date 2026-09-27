#!/usr/bin/env npx tsx
/**
 * test-memory-tool.ts — Comprehensive debug & integration test for the Memory Brain tool.
 *
 * Exercises every dispatch action against a TEMPORARY test database so the real
 * brain.sqlite is never touched.  Reports pass/fail per action and a final summary.
 *
 * Usage:
 *   cd core && npx tsx context/memory/brain/test-memory-tool.ts
 *
 * The script:
 *  1. Patches getMemoryBrainSqlitePath to use a temp directory
 *  2. Calls BrainManager.dispatch() for every action with valid params
 *  3. Validates the result string (non-empty, no unhandled errors)
 *  4. Tests edge cases (missing params, bad IDs, duplicate stores)
 *  5. Prints a summary with pass / fail / skip counts
 */

import fs from "fs";
import os from "os";
import path from "path";
// Type-only import is safe — erased at compile time, doesn't trigger module loading
import type { MemoryBrainAction } from "./types.js";

// ── Patch the DB path BEFORE importing any brain modules ────────────────────
// KNOX_GLOBAL_DIR controls ~/.knox — point it to a temp dir
// Must set BEFORE dynamic imports since paths.ts reads it at module init
const testDir = path.join(os.tmpdir(), `brain-test-${Date.now()}`);
fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
process.env.KNOX_GLOBAL_DIR = testDir;

// Dynamic imports to ensure KNOX_GLOBAL_DIR is set before paths.ts initializes
const { BrainManager } = await import("./BrainManager.js");

// ── Test Harness ────────────────────────────────────────────────────────────

interface TestResult {
  action: string;
  label: string;
  passed: boolean;
  error?: string;
  output?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function test(action: MemoryBrainAction, label: string, params: Record<string, any>, validator?: (output: string) => void): Promise<void> {
  const start = performance.now();
  try {
    const output = await BrainManager.dispatch(action, { action, ...params });
    const ms = performance.now() - start;

    if (!output || typeof output !== "string") {
      results.push({ action, label, passed: false, error: "Empty or non-string output", durationMs: ms });
      return;
    }
    if (output.toLowerCase().includes("error executing")) {
      results.push({ action, label, passed: false, error: `Dispatch error: ${output.substring(0, 200)}`, durationMs: ms });
      return;
    }

    if (validator) {
      validator(output);
    }

    results.push({ action, label, passed: true, output: output.substring(0, 120), durationMs: ms });
  } catch (err) {
    const ms = performance.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ action, label, passed: false, error: message.substring(0, 300), durationMs: ms });
  }
}

async function expectError(action: MemoryBrainAction, label: string, params: Record<string, any>): Promise<void> {
  const start = performance.now();
  try {
    const output = await BrainManager.dispatch(action, { action, ...params });
    const ms = performance.now() - start;
    // Some "errors" are returned as formatted strings (not thrown)
    if (output.toLowerCase().includes("not found") || output.toLowerCase().includes("error") || output.toLowerCase().includes("no ")) {
      results.push({ action, label, passed: true, output: output.substring(0, 120), durationMs: ms });
    } else {
      results.push({ action, label, passed: false, error: `Expected error but got: ${output.substring(0, 200)}`, durationMs: ms });
    }
  } catch {
    const ms = performance.now() - start;
    results.push({ action, label, passed: true, output: "(threw as expected)", durationMs: ms });
  }
}

// ── Saved IDs across tests ──────────────────────────────────────────────────
let storedMemoryId = 0;
let storedMemoryId2 = 0;
let storedEntityId = 0;
let storedEdgeId = 0;
let storedPatternId = 0;
let storedProcedureId = 0;
let storedCollectionId = 0;
let checkpointId = 0;

function extractId(output: string): number {
  const match = output.match(/ID:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ── Main Test Suite ─────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Memory Brain Tool — Integration Test Suite              ║");
  console.log("║     DB: " + path.join(testDir, "memory", "brain.sqlite").padEnd(52) + " ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ════════════════════════════════════════════════════════════════════════
  // 1. CORE MEMORY OPERATIONS
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 1. Core Memory Operations ━━━");

  await test("store", "Store a fact", {
    category: "fact",
    title: "TypeScript strict mode",
    content: "TypeScript strict mode enables stricter type checking and catches more errors at compile time.",
    keywords: "typescript,strict,compiler",
    importance: 0.8,
  }, (out) => {
    storedMemoryId = extractId(out);
    if (!storedMemoryId) throw new Error("No ID returned from store");
  });

  await test("store", "Store a preference", {
    category: "preference",
    title: "User prefers dark theme",
    content: "The user prefers dark mode in all IDEs and terminals.",
    keywords: "theme,dark,preference",
    importance: 0.6,
  }, (out) => {
    storedMemoryId2 = extractId(out);
  });

  await test("store", "Store with TTL", {
    category: "decision",
    title: "Use PostgreSQL for prod",
    content: "Decision: use PostgreSQL for the production database. Evaluated against MySQL and MongoDB.",
    keywords: "database,postgresql,decision",
    importance: 0.9,
    ttl_days: 30,
  });

  await test("store", "Store code pattern", {
    category: "code_pattern",
    title: "Singleton pattern in TS",
    content: "class Singleton { private static instance: Singleton; static get() { if (!this.instance) this.instance = new Singleton(); return this.instance; } }",
    keywords: "singleton,pattern,typescript",
    importance: 0.7,
  });

  await test("store", "Store with emotional valence", {
    category: "insight",
    title: "Critical prod incident",
    content: "Memory leak in WebSocket handler caused 3-hour outage. Root cause: unclosed connections in error path.",
    keywords: "outage,memory-leak,websocket",
    importance: 1.0,
    emotional_valence: "negative",
  });

  // Near-duplicate — should deduplicate
  await test("store", "Store near-duplicate (should dedup)", {
    category: "fact",
    title: "TypeScript strict mode setting",
    content: "TypeScript strict mode enables stricter type checking which catches more errors.",
    keywords: "typescript,strict,compiler",
    importance: 0.8,
  }, (out) => {
    if (!out.toLowerCase().includes("stored") && !out.toLowerCase().includes("memory")) {
      throw new Error("Dedup should still return a valid response");
    }
  });

  await test("recall", "Recall TypeScript memories", {
    query: "TypeScript strict mode",
    limit: 5,
  }, (out) => {
    if (!out.toLowerCase().includes("typescript")) throw new Error("Should find TypeScript memory");
  });

  await test("search", "Search for database decision", {
    query: "PostgreSQL database decision",
    limit: 5,
  });

  await test("recall", "Recall with category filter", {
    query: "dark theme",
    category: "preference",
    limit: 5,
  });

  await test("recall", "Recall with include_episodic=false", {
    query: "singleton pattern",
    include_episodic: false,
    limit: 3,
  });

  await test("delete", "Delete memory by ID", {
    id: storedMemoryId2,
  }, (out) => {
    if (!out.includes("deleted")) throw new Error("Should confirm deletion");
  });

  await expectError("delete", "Delete non-existent memory", { id: 99999 });

  // ════════════════════════════════════════════════════════════════════════
  // 2. SESSION OPERATIONS
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 2. Session Operations ━━━");

  await test("list_sessions", "List sessions (empty)", { limit: 10 });

  await test("get_stats", "Get brain stats", {}, (out) => {
    if (!out.toLowerCase().includes("memor") && !out.toLowerCase().includes("stat")) {
      throw new Error("Stats should mention memories or statistics");
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. KNOWLEDGE GRAPH
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 3. Knowledge Graph ━━━");

  await test("add_entity", "Add person entity", {
    name: "John Doe",
    entity_type: "person",
    description: "Lead backend engineer working on auth service",
    properties: JSON.stringify({ team: "platform", level: "senior" }),
  }, (out) => {
    storedEntityId = extractId(out);
    if (!storedEntityId) throw new Error("No entity ID");
  });

  await test("add_entity", "Add technology entity", {
    name: "PostgreSQL",
    entity_type: "technology",
    description: "Relational database management system",
  }, (out) => {
    const id2 = extractId(out);
    // Store for edge creation
    storedEdgeId = id2; // temporary re-use
  });

  await test("add_entity", "Add project entity", {
    name: "Auth Service",
    entity_type: "project",
    description: "Authentication and authorization microservice",
  });

  await test("add_edge", "Create relationship", {
    source_entity_id: storedEntityId,
    target_entity_id: storedEdgeId,
    relationship: "uses",
    weight: 0.9,
  }, (out) => {
    storedEdgeId = extractId(out);
  });

  await test("search_entities", "Search entities", {
    query: "John",
    limit: 5,
  }, (out) => {
    if (!out.toLowerCase().includes("john")) throw new Error("Should find John Doe");
  });

  await test("search_entities", "Search by type", {
    query: "database",
    entity_type: "technology",
    limit: 5,
  });

  await test("explore_graph", "Explore from entity", {
    entity_id: storedEntityId,
    depth: 2,
    limit: 10,
  });

  await test("get_graph_stats", "Get graph stats", {});

  await test("extract_entities", "Auto-extract entities from text", {
    text: "Alice and Bob discussed the React migration with the DevOps team at Google HQ.",
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. LEARNING ENGINE
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 4. Learning Engine ━━━");

  await test("learn_pattern", "Record success pattern", {
    goal_type: "debugging",
    pattern_signature: "binary-search-bisect",
    description: "Use git bisect to narrow down regression commits",
    success: true,
    tokens_used: 1200,
  }, (out) => {
    storedPatternId = extractId(out);
  });

  await test("learn_pattern", "Record failure pattern", {
    goal_type: "debugging",
    pattern_signature: "print-debugging",
    description: "Adding console.log everywhere to trace data flow",
    success: false,
    tokens_used: 3000,
  });

  await test("suggest_approach", "Get debugging suggestions", {
    query: "finding the commit that broke the build",
    goal_type: "debugging",
    limit: 5,
  });

  await test("get_patterns", "List all patterns", { limit: 10 });
  await test("get_patterns", "List by goal type", { goal_type: "debugging", limit: 10 });

  // ════════════════════════════════════════════════════════════════════════
  // 5. PROCEDURAL MEMORY
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 5. Procedural Memory ━━━");

  await test("store_procedure", "Store a procedure", {
    name: "Deploy to staging",
    description: "Standard procedure for deploying to staging environment",
    steps: ["Run tests locally", "Create PR", "Get code review", "Merge to main", "Trigger CI/CD pipeline", "Verify staging health"],
    trigger_pattern: "deploy staging",
    category: "devops",
  }, (out) => {
    storedProcedureId = extractId(out);
  });

  await test("get_procedures", "List procedures", { limit: 10 });

  if (storedProcedureId) {
    await test("execute_procedure", "Execute procedure (success)", {
      id: storedProcedureId,
      success: true,
    });

    await test("execute_procedure", "Execute procedure (failure)", {
      id: storedProcedureId,
      success: false,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6. AUTO-EXTRACT
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 6. Auto-Extract ━━━");

  await test("auto_extract", "Auto-extract from conversation", {
    content: "We decided to migrate from MySQL to PostgreSQL because of better JSON support and JSONB. The migration will be led by Sarah from the data team. We'll use pgloader for the actual migration tool.",
    role: "user",
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. CONTEXT BUILDER
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 7. Context Builder ━━━");

  await test("build_context", "Build context for query", {
    message: "How should we handle database migrations?",
    max_tokens: 2000,
    include_graph: true,
    include_procedures: true,
    include_patterns: true,
  });

  await test("build_context", "Build context minimal", {
    message: "TypeScript tips",
    max_tokens: 500,
    include_graph: false,
    include_procedures: false,
    include_patterns: false,
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. TAGS & COLLECTIONS
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 8. Tags & Collections ━━━");

  if (storedMemoryId) {
    await test("tag", "Tag a memory", {
      memory_type: "semantic",
      memory_id: storedMemoryId,
      tag: "important",
    });

    await test("tag", "Tag with second tag", {
      memory_type: "semantic",
      memory_id: storedMemoryId,
      tag: "typescript",
    });

    await test("search_by_tag", "Search by tag", {
      tag: "important",
      limit: 10,
    });

    await test("untag", "Remove a tag", {
      memory_type: "semantic",
      memory_id: storedMemoryId,
      tag: "important",
    });
  }

  await test("create_collection", "Create collection", {
    name: "Best Practices",
    description: "Collection of engineering best practices",
  }, (out) => {
    storedCollectionId = extractId(out);
  });

  await test("list_collections", "List collections", { limit: 10 });

  if (storedCollectionId && storedMemoryId) {
    await test("add_to_collection", "Add memory to collection", {
      collection_id: storedCollectionId,
      memory_type: "semantic",
      memory_id: storedMemoryId,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 9. ASSOCIATIONS
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 9. Associations ━━━");

  if (storedMemoryId) {
    await test("associate", "Create association", {
      source_type: "semantic",
      source_id: storedMemoryId,
      target_type: "semantic",
      target_id: storedMemoryId + 1, // second memory
      relationship: "related_to",
      strength: 0.8,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 10. MAINTENANCE
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 10. Maintenance ━━━");

  await test("get_health", "Health check", {});
  await test("optimize", "Optimize database", {});
  await test("get_config", "Get config", {});

  await test("update_config", "Update config value", {
    key: "max_hot_memories",
    value: "1000",
  });

  await test("consolidate", "Run consolidation", {});

  // ════════════════════════════════════════════════════════════════════════
  // 11. CHECKPOINT & ROLLBACK
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 11. Checkpoint & Rollback ━━━");

  await test("create_checkpoint", "Create checkpoint", {
    label: "test-checkpoint-v1",
  }, (out) => {
    checkpointId = extractId(out);
  });

  await test("list_checkpoints", "List checkpoints", { limit: 10 });

  // Store something after checkpoint
  await test("store", "Store post-checkpoint memory", {
    category: "fact",
    title: "Post-checkpoint fact",
    content: "This was stored after the checkpoint and should vanish on rollback.",
    keywords: "test,checkpoint",
    importance: 0.5,
  });

  if (checkpointId) {
    await test("diff_checkpoint", "Diff against checkpoint", {
      checkpoint_id: checkpointId,
    });

    await test("compress_checkpoint", "Compress checkpoint", {
      checkpoint_id: checkpointId,
    });

    await test("rollback_checkpoint", "Rollback to checkpoint", {
      checkpoint_id: checkpointId,
    }, (out) => {
      if (!out.toLowerCase().includes("rollback") && !out.toLowerCase().includes("restor")) {
        throw new Error("Should confirm rollback");
      }
    });

    // Verify post-checkpoint memory is gone
    await test("search", "Verify rollback worked", {
      query: "Post-checkpoint fact",
      limit: 5,
    }, (out) => {
      // The header always echoes the query, so strip it before checking
      const lines = out.split("\n").slice(1); // skip header line
      const body = lines.join("\n").toLowerCase();
      if (body.includes("post-checkpoint fact")) {
        throw new Error("Post-checkpoint memory should have been rolled back");
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 12. AUDIT LOG
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 12. Audit & Topics ━━━");

  await test("get_audit_log", "Get full audit log", { limit: 20 });
  await test("get_audit_log", "Filter audit by action", { audit_action: "memory:stored", limit: 10 });

  // ════════════════════════════════════════════════════════════════════════
  // 13. CROSS-SESSION SEARCH
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 13. Cross-Session Search ━━━");

  await test("search_backlogs", "Search backlogs", {
    query: "TypeScript",
    limit: 10,
    include_semantic: true,
  });

  // ════════════════════════════════════════════════════════════════════════
  // 14. EXPORT / IMPORT
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 14. Export / Import ━━━");

  await test("export", "Export memories", {});

  // ════════════════════════════════════════════════════════════════════════
  // 15. TIER C — CHECKPOINT STRATEGY & BATCH OPS
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 15. Checkpoint Strategy & Batch Ops ━━━");

  await test("checkpoint_strategy_config", "Get checkpoint strategy config", {});

  await test("update_checkpoint_strategy", "Update strategy to time-based", {
    mode: "time_based",
    time_interval_minutes: 30,
    max_checkpoints: 10,
  });

  await test("checkpoint_lifecycle_cleanup", "Lifecycle cleanup", {});

  await test("get_undoable_operations", "Get undoable operations", { limit: 10 });

  await test("batch_store", "Batch store memories", {
    items: [
      { category: "fact", title: "Batch fact 1", content: "Redis is an in-memory data store", keywords: "redis,cache", importance: 0.6 },
      { category: "fact", title: "Batch fact 2", content: "Docker containers provide process isolation", keywords: "docker,container", importance: 0.7 },
      { category: "insight", title: "Batch insight", content: "Microservices increase deployment flexibility", keywords: "microservices,architecture", importance: 0.8 },
    ],
  }, (out) => {
    if (!out.toLowerCase().includes("stored") && !out.toLowerCase().includes("batch")) throw new Error("Batch store should confirm stored count");
  });

  await test("batch_update_importance", "Batch update importance", {
    updates: [
      { id: storedMemoryId, importance_score: 0.95 },
    ],
  });

  await test("batch_move_tier", "Batch move tier", {
    target_type: "semantic",
    ids: [storedMemoryId],
    tier: "warm",
  });

  // ════════════════════════════════════════════════════════════════════════
  // 16. TIER D — ADVANCED FEATURES
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 16. Advanced Features (Tier D) ━━━");

  await test("five_tier_consolidate", "Five-tier consolidation", {});
  await test("get_tier_distribution", "Tier distribution", {});
  await test("get_tier_configs", "Tier configs", {});

  await test("update_tier_config", "Update tier config", {
    tier: "warm",
    max_age_hours: 336,
    importance_threshold: 0.3,
  });

  await test("root_cause_analysis", "Root cause analysis", {});

  await test("get_review_due", "Spaced repetition review-due", {
    retention_threshold: 0.5,
    limit: 10,
  });

  if (storedMemoryId) {
    await test("boost_memory", "Boost memory (spaced repetition)", {
      memory_id: storedMemoryId,
    });
  }

  await test("get_cache_stats", "LRU cache stats", {});
  await test("clear_cache", "Clear LRU cache", {});

  // ════════════════════════════════════════════════════════════════════════
  // 17. PERFORMANCE MONITOR (TIER B)
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 17. Performance Monitor ━━━");

  await test("get_metrics", "Get performance metrics", { window_ms: 60000 });
  await test("get_health_score", "Get health score", {});
  await test("get_capacity_forecast", "Capacity forecast", {});
  await test("heal", "Auto-heal", {});
  await test("get_healing_strategies", "Healing strategies", {});
  await test("get_consolidation_stats", "Consolidation stats", {});
  await test("store_metrics_snapshot", "Store metrics snapshot", {});
  await test("get_metrics_trend", "Metrics trend", { hours: 24 });

  // ════════════════════════════════════════════════════════════════════════
  // 18. LLM-ENHANCED (expect fallback without real LLM)
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 18. LLM-Enhanced (fallback mode) ━━━");

  await test("llm_extract_entities", "LLM entity extraction (fallback)", {
    text: "CEO Tim Cook announced that Apple will invest $1B in AI research at their Cupertino HQ.",
  });

  await test("llm_evaluate_importance", "LLM importance scoring (fallback)", {
    content: "We discovered a critical security vulnerability in the authentication module affecting all users.",
    role: "user",
    context: "Security review meeting",
  });

  // ════════════════════════════════════════════════════════════════════════
  // 19. EDGE CASES & ERROR HANDLING
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 19. Edge Cases ━━━");

  await expectError("delete", "Delete non-existent ID", { id: 999999 });
  await expectError("get_session", "Get non-existent session", { session_id: "non-existent-session-id" });
  await expectError("rollback_checkpoint", "Rollback non-existent checkpoint", { checkpoint_id: 999999 });
  await expectError("explore_graph", "Explore non-existent entity", { entity_id: 999999 });
  await expectError("execute_procedure", "Execute non-existent procedure", { id: 999999 });

  // Empty query searches
  await test("search", "Search with empty string", { query: "", limit: 5 });
  await test("recall", "Recall with empty string", { query: "", limit: 5 });

  // ════════════════════════════════════════════════════════════════════════
  // 20. BATCH DELETE (last — so earlier tests aren't affected)
  // ════════════════════════════════════════════════════════════════════════
  console.log("━━━ 20. Batch Delete ━━━");

  await test("batch_delete", "Batch delete by IDs", {
    ids: [storedMemoryId],
  });

  // Unknown action
  await test("unknown_action_xyz" as MemoryBrainAction, "Unknown action (should list available)", {}, (out) => {
    if (!out.toLowerCase().includes("unknown") && !out.toLowerCase().includes("available")) {
      throw new Error("Should mention unknown action or list available ones");
    }
  });
}

// ── Report ───────────────────────────────────────────────────────────────────

function printReport(): void {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     TEST RESULTS                           ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    const time = `${r.durationMs.toFixed(0)}ms`.padStart(6);
    const label = `[${r.action}] ${r.label}`.padEnd(55);
    console.log(`║ ${icon} ${time} ${label}║`);
    if (!r.passed && r.error) {
      const errLines = r.error.match(/.{1,58}/g) ?? [r.error];
      for (const line of errLines) {
        console.log(`║          ${line.padEnd(51)}║`);
      }
    }
  }

  console.log("╠══════════════════════════════════════════════════════════════╣");
  const total = results.length;
  const pct = total > 0 ? ((passed.length / total) * 100).toFixed(1) : "0.0";
  console.log(`║  Total: ${total}  |  Passed: ${passed.length}  |  Failed: ${failed.length}  |  ${pct}%`.padEnd(63) + "║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  if (failed.length > 0) {
    console.log("\n🔍 FAILED TESTS DETAIL:");
    for (const f of failed) {
      console.log(`\n  ❌ [${f.action}] ${f.label}`);
      console.log(`     Error: ${f.error}`);
    }
  }
}

// ── Cleanup & Run ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await runAllTests();
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    printReport();

    // Cleanup temp dir
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      console.log(`\n🧹 Cleaned up temp dir: ${testDir}`);
    } catch {}

    process.exit(results.some((r) => !r.passed) ? 1 : 0);
  }
}

main();
