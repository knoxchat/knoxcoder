/**
 * Types for the Memory Brain system.
 *
 * Human-brain-like persistent memory that spans all conversation sessions,
 * enabling unlimited context window with any LLM.
 *
 * Modeled after Knox-MS architecture patterns:
 * - Episodic memory (conversation turns / events)
 * - Semantic memory (facts, knowledge, summaries)
 * - Procedural memory (learned patterns, workflows)
 * - Knowledge graph (entities & relationships)
 * - Learning engine (pattern detection & suggestion)
 * - Auto-memory extraction (automatic fact extraction)
 * - Smart context builder (token-budgeted context assembly)
 * - Memory consolidation (hot → warm → cold tiering via importance decay)
 * - Self-management (health checks, optimization, auto-cleanup)
 * - Import/Export (backup & restore)
 */

export * from "./types/actions.js";
export * from "./types/entities.js";
export * from "./types/pipeline.js";
export * from "./types/config.js";
export * from "./types/misc.js";
