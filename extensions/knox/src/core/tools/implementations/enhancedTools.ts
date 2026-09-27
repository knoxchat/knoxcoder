/**
 * Implementation for Enhanced Search Tool
 */

import { ToolExtras } from "../..";
import { t } from "../../i18n/index.js";
import { ToolImpl } from "./index";
import { MultiStrategySearch, SearchConfig, SearchResult } from "../orchestration/MultiStrategySearch.js";
import { QueryContext } from "../orchestration/RelevanceEngine.js";

export interface EnhancedSearchArgs {
  query: string;
  maxResults?: number;
  minConfidence?: number;
  includeFuzzy?: boolean;
  includeStructural?: boolean;
  contextLines?: number;
  fileType?: string;
  scope?: 'file' | 'directory' | 'project' | 'global';
  progressiveRefinement?: boolean;
  strategies?: string[];
}

export const enhancedSearchImpl: ToolImpl = async (args: EnhancedSearchArgs, extras: ToolExtras) => {
  // Validate required arguments
  if (!args.query || typeof args.query !== 'string') {
    throw new Error(t("missingRequiredParam", { param: "query" }));
  }

  // Get the multi-strategy search engine
  const searchEngine = MultiStrategySearch.getInstance();

  // Build search config
  const config: SearchConfig = {
    maxResults: args.maxResults || 50,
    minConfidence: args.minConfidence || 0.3,
    includeFuzzy: args.includeFuzzy !== false,
    includeStructural: args.includeStructural !== false,
    contextLines: args.contextLines || 2,
    progressiveRefinement: args.progressiveRefinement !== false,
    parallelExecution: true,
    strategies: args.strategies,
    timeoutMs: 10000,
  };

  // Build query context
  const context: QueryContext = {
    fileType: args.fileType,
    scope: args.scope || 'project',
    timeConstraint: 'normal',
    costConstraint: 'medium',
  };

  // Execute enhanced search
  const results = await searchEngine.search(args.query, context, extras, config);

  // Format results as ContextItems
  const contextItems = results.map((result: SearchResult, index: number) => ({
    name: result.metadata.sourceFile || `Result ${index + 1}`,
    description: `${result.matchType} match (confidence: ${(result.confidence * 100).toFixed(0)}%, relevance: ${(result.relevanceScore * 100).toFixed(0)}%) - Strategy: ${result.strategy}`,
    content: result.content.content,
  }));

  // Add summary at the beginning
  const summary = {
    name: "Enhanced Search Summary",
    description: `Found ${results.length} results for "${args.query}"`,
    content: `Enhanced Multi-Strategy Search Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Query: "${args.query}"
Total Results: ${results.length}
Strategies Used: ${[...new Set(results.map((r: SearchResult) => r.strategy))].join(', ')}

Match Type Distribution:
- Exact: ${results.filter((r: SearchResult) => r.matchType === 'exact').length}
- Semantic: ${results.filter((r: SearchResult) => r.matchType === 'semantic').length}
- Fuzzy: ${results.filter((r: SearchResult) => r.matchType === 'fuzzy').length}
- Structural: ${results.filter((r: SearchResult) => r.matchType === 'structural').length}

Average Confidence: ${(results.reduce((sum: number, r: SearchResult) => sum + r.confidence, 0) / results.length * 100).toFixed(1)}%
Average Relevance: ${(results.reduce((sum: number, r: SearchResult) => sum + r.relevanceScore, 0) / results.length * 100).toFixed(1)}%

This search used multiple strategies in parallel (ripgrep, fuzzy, structural, rule-based semantic).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`,
  };

  return [summary, ...contextItems];
};

/**
 * Implementation for Intelligent Chain Tool
 */
import { IntelligentChainOrchestrator } from "../orchestration/IntelligentChainOrchestrator.js";

export interface IntelligentChainArgs {
  description: string;
  context?: {
    currentFile?: string;
    scope?: 'file' | 'directory' | 'project' | 'global';
    timeConstraint?: 'fast' | 'normal' | 'thorough';
  };
}

export const intelligentChainImpl: ToolImpl = async (args: IntelligentChainArgs, extras: ToolExtras) => {
  // Validate required arguments
  if (!args.description || typeof args.description !== 'string') {
    throw new Error(t("missingRequiredParam", { param: "description" }));
  }

  // Get the orchestrator
  const orchestrator = IntelligentChainOrchestrator.getInstance();

  // Build context
  const context: QueryContext = {
    currentFile: args.context?.currentFile,
    scope: args.context?.scope || 'project',
    timeConstraint: args.context?.timeConstraint || 'normal',
    costConstraint: 'medium',
  };

  // Execute intelligent chain
  const result = await orchestrator.orchestrate(args.description, context, extras);

  // Format results
  const summary = {
    name: "Task Chain Execution Summary",
    description: `Executed ${result.stepsCompleted}/${result.totalSteps} steps in ${result.executionTime}ms`,
    content: `Intelligent Task Chain Execution
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task: "${args.description}"
Status: ${result.success ? '✓ Success' : '✗ Failed'}
Chain ID: ${result.chainId}

Execution Details:
- Steps Completed: ${result.stepsCompleted}/${result.totalSteps}
- Total Time: ${result.executionTime}ms
- Errors: ${result.errors.length}

${result.errors.length > 0 ? `
Errors Encountered:
${result.errors.map((e: { step: string; error: Error }) => `  - ${e.step}: ${e.error.message}`).join('\n')}
` : ''}

The orchestrator automatically generated and executed an optimal tool sequence
based on your natural language description.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`,
  };

  return [summary, ...result.output];
};
