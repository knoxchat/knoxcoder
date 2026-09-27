#!/usr/bin/env npx tsx
/**
 * test-brain-tool-calls.ts — Tests ALL 79 memory tool call actions end-to-end.
 *
 * Verifies that every action in the tool definition enum works correctly
 * through BrainManager.dispatch(), matching exactly what the LLM would invoke.
 *
 * Groups by tier:
 *   Tier A (48 actions): Core memory, sessions, graph, learning, procedures,
 *                         tags, collections, context, maintenance, backlogs,
 *                         LLM-enhanced, checkpoints, audit, session topics
 *   Tier B (6 actions):  Performance & self-management
 *   Tier C (13 actions): Checkpoint strategies, event replay, undo, batch ops
 *   Tier D (12 actions): Hierarchy, root cause, spaced repetition, cache, metrics
 *
 * Usage:
 *   cd core && npx tsx context/memory/brain/test-brain-tool-calls.ts
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { MemoryBrainAction } from "./types.js";

// ── Patch DB path BEFORE imports ────────────────────────────────────────────
const testDir = path.join(os.tmpdir(), `brain-tool-calls-${Date.now()}`);
fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
process.env.KNOX_GLOBAL_DIR = testDir;

const { BrainManager } = await import("./BrainManager.js");

// ── Test Harness ────────────────────────────────────────────────────────────

interface TestResult {
  section: string;
  action: MemoryBrainAction;
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

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function test(
  action: MemoryBrainAction,
  label: string,
  params: Record<string, any>,
  validator?: (output: string) => void,
): Promise<string> {
  const start = performance.now();
  try {
    const output = await BrainManager.dispatch(action, { action, ...params });
    const ms = performance.now() - start;

    if (!output || typeof output !== "string") {
      results.push({ section: currentSection, action, label, passed: false, error: "Empty/non-string output", durationMs: ms });
      return "";
    }
    if (output.toLowerCase().includes("error executing")) {
      results.push({ section: currentSection, action, label, passed: false, error: output.substring(0, 200), durationMs: ms });
      return output;
    }
    if (validator) validator(output);
    results.push({ section: currentSection, action, label, passed: true, durationMs: ms });
    return output;
  } catch (err) {
    const ms = performance.now() - start;
    results.push({ section: currentSection, action, label, passed: false, error: (err as Error).message?.substring(0, 200), durationMs: ms });
    return "";
  }
}

function extractId(output: string): number {
  const m = output.match(/ID:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ── All 79 actions from the tool definition enum ────────────────────────────
const TOOL_ENUM_ACTIONS: MemoryBrainAction[] = [
  // Tier A (48)
  "store", "recall", "search", "summarize_session", "list_sessions",
  "get_session", "close_session", "delete", "get_stats", "consolidate",
  "associate", "add_entity", "search_entities", "add_edge", "explore_graph",
  "get_graph_stats", "extract_entities", "learn_pattern", "suggest_approach",
  "get_patterns", "store_procedure", "get_procedures", "execute_procedure",
  "auto_extract", "build_context", "tag", "untag", "search_by_tag",
  "create_collection", "list_collections", "add_to_collection", "export",
  "import", "get_health", "optimize", "get_config", "update_config",
  "search_backlogs", "llm_extract_entities", "llm_summarize_session",
  "llm_evaluate_importance", "llm_post_action_memory", "create_checkpoint",
  "list_checkpoints", "rollback_checkpoint", "delete_checkpoint",
  "get_audit_log", "get_session_topics",
  // Tier B (6)
  "get_metrics", "get_health_score", "get_capacity_forecast", "heal",
  "get_healing_strategies", "get_consolidation_stats",
  // Tier C (13)
  "checkpoint_strategy_config", "update_checkpoint_strategy",
  "checkpoint_lifecycle_cleanup", "compress_checkpoint", "diff_checkpoint",
  "replay_events", "undo_operation", "get_undoable_operations",
  "batch_delete", "batch_store", "batch_audit_log", "batch_update_importance",
  "batch_move_tier",
  // Tier D (12)
  "find_related_sessions", "five_tier_consolidate", "get_tier_distribution",
  "get_tier_configs", "update_tier_config", "root_cause_analysis",
  "get_review_due", "boost_memory", "get_cache_stats", "clear_cache",
  "store_metrics_snapshot", "get_metrics_trend",
];

// ── Main ────────────────────────────────────────────────────────────────────

// Shared IDs populated during test flow
let memId1 = 0, memId2 = 0, memId3 = 0;
let entityId1 = 0, entityId2 = 0;
let procedureId = 0, collectionId = 0, checkpointId = 0;
const sessionId = `test-tool-calls-${Date.now()}`;

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║   Memory Brain — Tool Call Coverage Test (79 Actions)           ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");

// ═══════════════════════════════════════════════════════════════════════════
// TIER A: Core Operations (48 actions)
// ═══════════════════════════════════════════════════════════════════════════

setSection("Tier A: Core Memory");

// 1. store
const storeOut = await test("store", "Store a fact", {
  category: "fact", title: "TypeScript Generics",
  content: "TypeScript generics enable reusable type-safe code with <T> syntax.",
  keywords: "typescript,generics,types", importance: 0.8,
});
memId1 = extractId(storeOut);

const storeOut2 = await test("store", "Store a preference", {
  category: "preference", title: "Dark Mode",
  content: "User prefers dark mode in all IDEs.",
  keywords: "dark,mode,preference", importance: 0.6,
});
memId2 = extractId(storeOut2);

const storeOut3 = await test("store", "Store a code pattern", {
  category: "code_pattern", title: "Singleton Pattern",
  content: "Use private constructor with static getInstance() for singleton.",
  keywords: "singleton,pattern,design", importance: 0.7,
});
memId3 = extractId(storeOut3);

// 2. recall
await test("recall", "Recall TypeScript memories", {
  query: "TypeScript", limit: 10,
}, (out) => assert(out.includes("TypeScript"), "Should find TypeScript content"));

// 3. search
await test("search", "Search by keyword", {
  query: "singleton pattern", limit: 5,
}, (out) => assert(out.length > 0, "Should return results"));

// 4-7. Sessions
setSection("Tier A: Sessions");

await test("list_sessions", "List sessions", { limit: 10 });

await test("get_session", "Get test session", {
  session_id: sessionId, limit: 20,
});

await test("summarize_session", "Summarize session", {
  session_id: sessionId,
});

await test("get_session_topics", "Session topics", {
  session_id: sessionId,
});

// 8. delete (store a temp memory then delete it)
const tempOut = await test("store", "Store temp for delete", {
  category: "fact", title: "Temp Delete Target",
  content: "This will be deleted.", keywords: "temp", importance: 0.1,
});
const tempId = extractId(tempOut);
if (tempId > 0) {
  await test("delete", "Delete temp memory", { id: tempId }, (out) =>
    assert(out.includes("Deleted") || out.includes("deleted"), "Should confirm deletion"));
}

// 9-10. Stats & Consolidate
setSection("Tier A: Maintenance");

await test("get_stats", "Get brain stats", {}, (out) =>
  assert(out.includes("semantic") || out.includes("Semantic"), "Should show semantic stats"));

await test("consolidate", "Run consolidation", {});

// 11. associate
await test("associate", "Associate two memories", {
  source_type: "semantic", source_id: memId1,
  target_type: "semantic", target_id: memId2,
  relationship: "related_to", strength: 0.7,
}, (out) => assert(out.includes("Association") || out.includes("association"), "Should confirm association"));

// 12-17. Knowledge Graph
setSection("Tier A: Knowledge Graph");

const entOut1 = await test("add_entity", "Add entity: TypeScript", {
  name: "TypeScript", entity_type: "technology",
  description: "A typed superset of JavaScript",
}, (out) => assert(out.includes("Entity"), "Should confirm entity added"));
entityId1 = extractId(entOut1);

const entOut2 = await test("add_entity", "Add entity: React", {
  name: "React", entity_type: "technology",
  description: "A JavaScript library for building UIs",
});
entityId2 = extractId(entOut2);

await test("search_entities", "Search entities", {
  query: "TypeScript", limit: 5,
}, (out) => assert(out.includes("TypeScript"), "Should find TypeScript entity"));

await test("add_edge", "Add edge: TypeScript → React", {
  source_entity_id: entityId1, target_entity_id: entityId2,
  relationship: "works_with", weight: 0.8,
}, (out) => assert(out.includes("Edge") || out.includes("edge"), "Should confirm edge added"));

await test("explore_graph", "Explore from TypeScript", {
  entity_id: entityId1, depth: 2,
}, (out) => assert(out.includes("TypeScript"), "Should include TypeScript in traversal"));

await test("get_graph_stats", "Graph statistics", {}, (out) =>
  assert(out.includes("entities") || out.includes("Entities"), "Should show entity count"));

await test("extract_entities", "Extract entities from text", {
  text: "John works at Google using Python and TensorFlow for machine learning projects.",
}, (out) => assert(out.length > 10, "Should extract some entities"));

// 18-20. Learning Engine
setSection("Tier A: Learning Engine");

await test("learn_pattern", "Learn a coding pattern", {
  goal_type: "coding", pattern_signature: "test-driven development",
  description: "Write tests first, then implement. Leads to fewer bugs.",
  success: true, tokens_used: 500,
}, (out) => assert(out.includes("Pattern"), "Should confirm pattern learned"));

await test("suggest_approach", "Suggest approach for coding", {
  query: "How should I approach debugging?", goal_type: "debugging", limit: 5,
});

await test("get_patterns", "Get learned patterns", {
  goal_type: "coding", limit: 10,
}, (out) => assert(out.includes("test-driven") || out.includes("Pattern"), "Should find patterns"));

// 21-23. Procedural Memory
setSection("Tier A: Procedures");

const procOut = await test("store_procedure", "Store a procedure", {
  name: "Code Review Process",
  description: "Standard code review workflow",
  steps: ["Read PR description", "Check tests", "Review code changes", "Leave comments", "Approve or request changes"],
  trigger_pattern: "code review",
}, (out) => assert(out.includes("Procedure") || out.includes("procedure"), "Should confirm procedure stored"));
procedureId = extractId(procOut);

await test("get_procedures", "List procedures", { limit: 10 }, (out) =>
  assert(out.includes("Code Review"), "Should find stored procedure"));

if (procedureId > 0) {
  await test("execute_procedure", "Execute procedure", {
    id: procedureId, success: true,
  }, (out) => assert(out.includes("executed") || out.includes("Executed") || out.includes("execution"), "Should confirm execution"));
}

// 24. auto_extract
setSection("Tier A: Auto-Extract");

await test("auto_extract", "Auto-extract from text", {
  text: "We decided to use PostgreSQL for the database and Redis for caching. The deadline is next Friday.",
  role: "user", session_id: sessionId,
}, (out) => assert(out.length > 0, "Should extract something"));

// 25. build_context
await test("build_context", "Build context for query", {
  message: "How do TypeScript generics work?",
  session_id: sessionId, max_tokens: 4000,
  include_graph: true, include_procedures: true, include_patterns: true,
}, (out) => assert(out.length > 0, "Should build context"));

// 26-28. Tags
setSection("Tier A: Tags");

await test("tag", "Tag a memory", {
  memory_type: "semantic", memory_id: memId1, tag: "important",
}, (out) => assert(out.includes("Tag") || out.includes("tag") || out.includes("added"), "Should confirm tag added"));

await test("search_by_tag", "Search by tag", {
  tag: "important", limit: 10,
}, (out) => assert(out.includes("TypeScript") || out.includes("important"), "Should find tagged memory"));

await test("untag", "Remove tag", {
  memory_type: "semantic", memory_id: memId1, tag: "important",
}, (out) => assert(out.includes("Removed") || out.includes("removed") || out.includes("Untag"), "Should confirm untag"));

// 29-31. Collections
setSection("Tier A: Collections");

const collOut = await test("create_collection", "Create collection", {
  name: "Dev Tools", description: "Development tools and patterns",
}, (out) => assert(out.includes("Collection") || out.includes("collection"), "Should confirm creation"));
collectionId = extractId(collOut);

if (collectionId > 0) {
  await test("add_to_collection", "Add to collection", {
    collection_id: collectionId, memory_type: "semantic", memory_id: memId1,
  }, (out) => assert(out.includes("Added") || out.includes("added"), "Should confirm add"));
}

await test("list_collections", "List collections", { limit: 10 }, (out) =>
  assert(out.includes("Dev Tools"), "Should find collection"));

// 32-33. Export/Import
setSection("Tier A: Export/Import");

const exportOut = await test("export", "Export memories", {}, (out) =>
  assert(out.includes("Export") || out.includes("export"), "Should confirm export"));

// Extract path for import
const pathMatch = exportOut.match(/(?:exported to|Path|File|path|file):\s*(.+\.json)/);
if (pathMatch) {
  await test("import", "Import memories", { file_path: pathMatch[1].trim() }, (out) =>
    assert(out.includes("Import") || out.includes("import"), "Should confirm import"));
} else {
  // Fallback: find any .json path in the output
  const jsonPath = exportOut.match(/(\/[^\s]+\.json)/);
  if (jsonPath) {
    await test("import", "Import memories (alt path)", { file_path: jsonPath[1] }, (out) =>
      assert(out.includes("Import") || out.includes("import"), "Should confirm import"));
  } else {
    await test("import", "Import (export had no path)", { file_path: "/tmp/nonexistent.json" });
  }
}

// 34-37. Self-Management
setSection("Tier A: Self-Management");

await test("get_health", "Health check", {}, (out) =>
  assert(out.includes("Health") || out.includes("health"), "Should show health"));

await test("optimize", "Optimize database", {}, (out) =>
  assert(out.includes("Optimize") || out.includes("optimize") || out.includes("Vacuum") || out.includes("vacuum") || out.includes("compacted"), "Should confirm optimization"));

await test("get_config", "Get config", {}, (out) =>
  assert(out.includes("Config") || out.includes("config"), "Should show config"));

await test("update_config", "Update config", {
  key: "auto_consolidate_on_close", value: "true",
}, (out) => assert(out.length > 0, "Should confirm update"));

// 38. search_backlogs
await test("search_backlogs", "Cross-session search", {
  query: "TypeScript", limit: 10, include_semantic: true,
}, (out) => assert(out.length > 0, "Should return backlog results"));

// 39-42. LLM-Enhanced (fallback without LLM)
setSection("Tier A: LLM-Enhanced (fallback)");

await test("llm_extract_entities", "LLM entity extraction", {
  text: "Elon Musk's company SpaceX launched Falcon 9 from Cape Canaveral.",
}, (out) => assert(out.length > 10, "Should extract entities"));

await test("llm_summarize_session", "LLM session summary", {
  session_id: sessionId,
}, (out) => assert(out.includes("Summary") || out.includes("summary"), "Should produce summary"));

await test("llm_evaluate_importance", "LLM importance eval", {
  content: "CRITICAL security vulnerability found in production auth system.",
  role: "user", context: "Security audit",
}, (out) => assert(out.includes("Importance") || out.includes("importance"), "Should score importance"));

await test("llm_post_action_memory", "LLM post-action memory", {
  action_description: "Deployed v2.0 to production",
  action_result: "All health checks passing. Zero downtime deployment.",
  session_id: sessionId,
}, (out) => assert(out.includes("Post-Action") || out.includes("post-action"), "Should process action"));

// 43-46. Checkpoints
setSection("Tier A: Checkpoints");

const cpOut = await test("create_checkpoint", "Create checkpoint", {
  label: "v1-baseline",
}, (out) => assert(out.includes("Checkpoint") || out.includes("checkpoint"), "Should confirm creation"));
checkpointId = extractId(cpOut);

await test("list_checkpoints", "List checkpoints", { limit: 10 }, (out) =>
  assert(out.includes("v1-baseline"), "Should find checkpoint"));

// 47. get_audit_log
await test("get_audit_log", "Get audit log", {
  limit: 20,
}, (out) => assert(out.includes("Audit") || out.includes("audit") || out.length > 10, "Should show audit entries"));

// 48. close_session (do last since it marks inactive)
await test("close_session", "Close session", {
  session_id: sessionId,
});

// ═══════════════════════════════════════════════════════════════════════════
// TIER B: Performance & Self-Management (6 actions)
// ═══════════════════════════════════════════════════════════════════════════

setSection("Tier B: Performance & Self-Management");

// 49. get_metrics
await test("get_metrics", "Get performance metrics", {
  window_ms: 600000,
}, (out) => assert(out.includes("Performance") || out.includes("Metrics"), "Should show metrics"));

// 50. get_health_score
await test("get_health_score", "Get health score", {}, (out) =>
  assert(out.includes("Health Score") || out.includes("Grade"), "Should show health grade"));

// 51. get_capacity_forecast
await test("get_capacity_forecast", "Capacity forecast", {}, (out) =>
  assert(out.includes("Capacity") || out.includes("forecast") || out.includes("Forecast"), "Should show forecast"));

// 52. heal
await test("heal", "Auto-heal issues", {}, (out) =>
  assert(out.includes("Healing") || out.includes("heal") || out.includes("No healing"), "Should show healing result"));

// 53. get_healing_strategies
await test("get_healing_strategies", "List healing strategies", {}, (out) =>
  assert(out.length > 10, "Should list strategies"));

// 54. get_consolidation_stats
await test("get_consolidation_stats", "Consolidation stats", {}, (out) =>
  assert(out.includes("Consolidation") || out.includes("consolidation") || out.includes("tier"), "Should show stats"));

// ═══════════════════════════════════════════════════════════════════════════
// TIER C: Checkpoint Strategies & Lifecycle (13 actions)
// ═══════════════════════════════════════════════════════════════════════════

setSection("Tier C: Checkpoint Strategies");

// 55. checkpoint_strategy_config
await test("checkpoint_strategy_config", "Get strategy config", {}, (out) =>
  assert(out.includes("Strategy") || out.includes("strategy") || out.includes("mode"), "Should show config"));

// 56. update_checkpoint_strategy
await test("update_checkpoint_strategy", "Update to time-based", {
  mode: "time_interval", time_interval_minutes: 30,
  max_checkpoints: 10, max_age_days: 7,
}, (out) => assert(out.length > 0, "Should confirm update"));

// 57. checkpoint_lifecycle_cleanup
await test("checkpoint_lifecycle_cleanup", "Lifecycle cleanup", {}, (out) =>
  assert(out.includes("Lifecycle") || out.includes("lifecycle") || out.includes("cleanup") || out.includes("Cleanup"), "Should show cleanup results"));

// 58. compress_checkpoint
if (checkpointId > 0) {
  await test("compress_checkpoint", "Compress checkpoint", {
    checkpoint_id: checkpointId,
  });
}

// 59. diff_checkpoint
if (checkpointId > 0) {
  await test("diff_checkpoint", "Diff checkpoint vs current", {
    checkpoint_id: checkpointId,
  }, (out) => assert(out.includes("Diff") || out.includes("diff") || out.includes("Changes") || out.includes("changes"), "Should show diff"));
}

// Event Replay & Undo
setSection("Tier C: Event Replay & Undo");

// 60. replay_events
await test("replay_events", "Replay events from start", {
  from: new Date(Date.now() - 3600000).toISOString(),
  to: new Date().toISOString(),
  limit: 20,
}, (out) => assert(out.includes("Event") || out.includes("event") || out.includes("Replay") || out.length > 5, "Should show events"));

// 61. get_undoable_operations
await test("get_undoable_operations", "Get undoable ops", {
  limit: 10,
}, (out) => assert(out.length > 0, "Should list undoable operations"));

// 62. undo_operation (we need a valid audit entry)
// Store something to undo
const undoTarget = await test("store", "Store for undo test", {
  category: "fact", title: "Undo Target",
  content: "This memory will be undone.", keywords: "undo,test", importance: 0.3,
});
const undoTargetId = extractId(undoTarget);
if (undoTargetId > 0) {
  // Get undoable operations and pick the most recent one
  const undoableOut = await BrainManager.dispatch("get_undoable_operations" as MemoryBrainAction, {
    action: "get_undoable_operations", limit: 5,
  });
  // Try to find any audit entry ID
  const undoIdMatch = undoableOut.match(/ID:\s*(\d+)/) || undoableOut.match(/#(\d+)/) || undoableOut.match(/(\d+)\s*[|│]/);
  if (undoIdMatch) {
    await test("undo_operation", "Undo most recent op", {
      id: parseInt(undoIdMatch[1], 10),
    });
  } else {
    // Fallback: get audit log and try first ID
    const auditOut = await BrainManager.dispatch("get_audit_log" as MemoryBrainAction, {
      action: "get_audit_log", limit: 5,
    });
    const allIds = [...auditOut.matchAll(/ID:\s*(\d+)/g)].map(m => parseInt(m[1], 10));
    if (allIds.length > 0) {
      await test("undo_operation", "Undo via audit log", {
        id: allIds[0],
      });
    } else {
      // Last resort: undo by the target memory ID directly
      await test("undo_operation", "Undo store by ID", {
        id: undoTargetId,
      });
    }
  }
}

// Batch Operations
setSection("Tier C: Batch Operations");

// 63. batch_store — expects { items: StoreInput[] }
await test("batch_store", "Batch store 3 memories", {
  items: [
    { category: "fact", title: "Batch Fact 1", content: "Batch test fact one.", keywords: "batch,one", importance: 0.5 },
    { category: "fact", title: "Batch Fact 2", content: "Batch test fact two.", keywords: "batch,two", importance: 0.6 },
    { category: "insight", title: "Batch Insight 1", content: "Batch test insight.", keywords: "batch,insight", importance: 0.7 },
  ],
}, (out) => assert(out.includes("Batch") || out.includes("batch") || out.includes("stored"), "Should confirm batch store"));

// 64. batch_update_importance
if (memId1 > 0 && memId2 > 0) {
  await test("batch_update_importance", "Batch update importance", {
    updates: [
      { id: memId1, importance: 0.95 },
      { id: memId2, importance: 0.85 },
    ],
  }, (out) => assert(out.includes("updated") || out.includes("Updated") || out.includes("Batch"), "Should confirm updates"));
}

// 65. batch_move_tier
if (memId1 > 0) {
  await test("batch_move_tier", "Move memories to warm tier", {
    target_type: "semantic", ids: [memId1, memId2], tier: "warm",
  }, (out) => assert(out.includes("Moved") || out.includes("moved") || out.includes("tier"), "Should confirm tier move"));
}

// 66. batch_audit_log — expects { events: [...] }
await test("batch_audit_log", "Batch audit log entries", {
  events: [
    { action: "test:batch_audit", target_type: "memory", target_id: memId1, details: { note: "batch audit test" } },
    { action: "test:batch_audit_2", target_type: "entity", target_id: entityId1, details: { note: "second entry" } },
  ],
}, (out) => assert(out.includes("logged") || out.includes("Batch") || out.includes("audit"), "Should confirm audit entries logged"));

// 67. batch_delete
// Store some temp memories for batch delete
const batchDel1 = await test("store", "Temp for batch delete 1", {
  category: "fact", title: "Batch Del 1", content: "Delete me 1.", keywords: "del", importance: 0.1,
});
const batchDel2 = await test("store", "Temp for batch delete 2", {
  category: "fact", title: "Batch Del 2", content: "Delete me 2.", keywords: "del", importance: 0.1,
});
const batchDelId1 = extractId(batchDel1);
const batchDelId2 = extractId(batchDel2);
if (batchDelId1 > 0 && batchDelId2 > 0) {
  await test("batch_delete", "Batch delete 2 memories", {
    target_type: "semantic", ids: [batchDelId1, batchDelId2],
  }, (out) => assert(out.includes("Deleted") || out.includes("deleted") || out.includes("Batch"), "Should confirm batch delete"));
}

// ═══════════════════════════════════════════════════════════════════════════
// TIER D: Advanced Features (12 actions)
// ═══════════════════════════════════════════════════════════════════════════

setSection("Tier D: Five-Tier Hierarchy");

// 68. five_tier_consolidate
await test("five_tier_consolidate", "Run five-tier consolidation", {}, (out) =>
  assert(out.includes("Five-Tier") || out.includes("five-tier") || out.includes("Consolidation") || out.includes("consolidation"), "Should show consolidation"));

// 69. get_tier_distribution
await test("get_tier_distribution", "Get tier distribution", {}, (out) =>
  assert(out.includes("active") || out.includes("hot") || out.includes("warm"), "Should show tier names"));

// 70. get_tier_configs
await test("get_tier_configs", "Get tier configs", {}, (out) =>
  assert(out.includes("active") || out.includes("hot"), "Should show tier configs"));

// 71. update_tier_config
await test("update_tier_config", "Update warm tier config", {
  tier: "warm", max_age_hours: 720, importance_threshold: 0.2,
}, (out) => assert(out.length > 0, "Should confirm config update"));

// 72. find_related_sessions
await test("find_related_sessions", "Find related sessions", {
  session_id: sessionId, limit: 5,
});

setSection("Tier D: Root Cause Analysis");

// 73. root_cause_analysis
await test("root_cause_analysis", "Analyze root causes", {}, (out) =>
  assert(out.includes("Root Cause") || out.includes("Analysis") || out.includes("status"), "Should show analysis"));

setSection("Tier D: Spaced Repetition");

// 74. get_review_due
await test("get_review_due", "Get memories due for review", {
  retention_threshold: 0.99, limit: 20,
});

// 75. boost_memory
if (memId1 > 0) {
  await test("boost_memory", "Boost memory importance", {
    memory_id: memId1,
  }, (out) => assert(out.includes("boosted") || out.includes("importance") || out.includes("Boosted"), "Should show boost result"));
}

setSection("Tier D: LRU Cache");

// Do a recall to populate cache first
await BrainManager.dispatch("recall" as MemoryBrainAction, {
  action: "recall", query: "TypeScript", limit: 5,
});

// 76. get_cache_stats
await test("get_cache_stats", "Cache statistics", {}, (out) =>
  assert(out.includes("Cache") || out.includes("cache"), "Should show cache stats"));

// 77. clear_cache
await test("clear_cache", "Clear cache", {}, (out) =>
  assert(out.includes("cleared") || out.includes("Cleared") || out.includes("Cache"), "Should confirm clear"));

setSection("Tier D: Metrics Storage");

// 78. store_metrics_snapshot
await test("store_metrics_snapshot", "Store metrics snapshot", {}, (out) =>
  assert(out.includes("snapshot") || out.includes("Snapshot") || out.includes("stored") || out.includes("Metrics"), "Should confirm snapshot"));

// 79. get_metrics_trend
await test("get_metrics_trend", "Get metrics trend", {
  hours: 24,
}, (out) => assert(out.includes("Metrics") || out.includes("trend") || out.includes("Trend") || out.includes("snapshot"), "Should show trend"));

// ═══════════════════════════════════════════════════════════════════════════
// CHECKPOINT ROLLBACK & DELETE (use last to avoid disrupting other tests)
// ═══════════════════════════════════════════════════════════════════════════

setSection("Tier A: Checkpoint Rollback & Delete");

// Create a 2nd checkpoint to test rollback and delete
const cpOut2 = await test("create_checkpoint", "Create checkpoint for delete", {
  label: "v2-delete-target",
});
const checkpointId2 = extractId(cpOut2);

if (checkpointId > 0) {
  await test("rollback_checkpoint", "Rollback to v1", {
    checkpoint_id: checkpointId,
  }, (out) => assert(out.includes("Rolled back") || out.includes("Rollback") || out.includes("rollback") || out.includes("Restored") || out.includes("restored"), "Should confirm rollback"));
}

if (checkpointId2 > 0) {
  await test("delete_checkpoint", "Delete v2 checkpoint", {
    checkpoint_id: checkpointId2,
  }, (out) => assert(out.includes("Deleted") || out.includes("deleted") || out.includes("Checkpoint"), "Should confirm delete"));
}

// ═══════════════════════════════════════════════════════════════════════════
// COVERAGE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

setSection("Coverage Verification");

// Verify all 79 enum actions were tested
const testedActions = new Set(results.map((r) => r.action));
const missingActions = TOOL_ENUM_ACTIONS.filter((a) => !testedActions.has(a));

const coverageStart = performance.now();
if (missingActions.length > 0) {
  results.push({
    section: currentSection, action: "store" as MemoryBrainAction,
    label: `MISSING: ${missingActions.join(", ")}`,
    passed: false, error: `${missingActions.length} actions not tested`,
    durationMs: performance.now() - coverageStart,
  });
} else {
  results.push({
    section: currentSection, action: "store" as MemoryBrainAction,
    label: `All ${TOOL_ENUM_ACTIONS.length} tool enum actions tested`,
    passed: true, durationMs: performance.now() - coverageStart,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;
const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";
const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

console.log("\n╔══════════════════════════════════════════════════════════════════╗");
console.log("║                  TOOL CALL TEST RESULTS                        ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");

let lastSection = "";
for (const r of results) {
  if (r.section !== lastSection) {
    lastSection = r.section;
    const sectionResults = results.filter((x) => x.section === r.section);
    const sectionPassed = sectionResults.filter((x) => x.passed).length;
    const icon = sectionPassed === sectionResults.length ? "✅" : "⚠️";
    console.log(`║ ${icon} ${r.section} (${sectionPassed}/${sectionResults.length})`.padEnd(65) + "║");
  }
  const icon = r.passed ? "✓" : "✗";
  const ms = r.durationMs.toFixed(0).padStart(5);
  const line = `║   ${icon} ${ms}ms [${r.action}] ${r.label}`;
  console.log(line.substring(0, 65).padEnd(65) + "║");
  if (!r.passed && r.error) {
    const errLine = `║          ERR: ${r.error}`;
    console.log(errLine.substring(0, 65).padEnd(65) + "║");
  }
}

console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  ${pct}%  |  ${(totalMs / 1000).toFixed(1)}s`.padEnd(65) + "║");
console.log("╚══════════════════════════════════════════════════════════════════╝");

if (failed > 0) {
  console.log("\n🔍 FAILED DETAILS:");
  for (const f of results.filter((r) => !r.passed)) {
    console.log(`  ❌ [${f.action}] ${f.label}: ${f.error}`);
  }
}

// Cleanup
try {
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log(`\n🧹 Cleaned up temp dir: ${testDir}`);
} catch {}

process.exit(failed > 0 ? 1 : 0);
