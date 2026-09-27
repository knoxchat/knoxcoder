/**
 * Tool Orchestration System (library / opt-in)
 *
 * Default chat path uses explicit tools via `callTool` only.
 * SmartToolRouter is intentionally NOT exported — it has no production
 * callers and must not be advertised as the product tool path.
 *
 * Public surface used by opt-in tools:
 * - MultiStrategySearch / RelevanceEngine → builtin_enhanced_search
 * - IntelligentChainOrchestrator → builtin_intelligent_chain
 * - ToolCache / conditions helpers → composite implementations
 *
 * ToolPipeline / ToolTransaction remain available for experiments.
 * File create/edit rollback uses captured prior state + IDE.removeFile/writeFile.
 */

export * from "./ToolPipeline.js";
export * from "./ToolExecutor.js";
export * from "./ToolCache.js";
export * from "./ToolTransaction.js";
export * from "./ToolConditions.js";
export * from "./ToolEvents.js";
export * from "./RelevanceEngine.js";
export * from "./MultiStrategySearch.js";
export * from "./IntelligentChainOrchestrator.js";
export * from "./types.js";

// SmartToolRouter / smartExecute: experimental, not part of public API.
// Import from "./SmartToolRouter.js" directly only for local experiments.

