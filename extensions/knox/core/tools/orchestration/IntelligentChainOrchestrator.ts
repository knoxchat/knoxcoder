/**
 * Intelligent Tool Chain Orchestrator
 * 
 * Automatically determines and executes optimal tool sequences
 * based on query analysis and learned patterns.
 * 
 * Features:
 * - Automatic tool sequence generation from natural language
 * - Dependency-aware execution planning
 * - Dynamic branching based on intermediate results
 * - Error recovery and alternative path selection
 * - Learning from successful execution patterns
 */

import { ContextItem, Tool, ToolExtras } from "../..";
import { createKnoxLogger } from "../../util/knoxLog.js";
import { RelevanceEngine, QueryContext } from "./RelevanceEngine";
import { MultiStrategySearch, SearchResult } from "./MultiStrategySearch";
import { ToolExecutor } from "./ToolExecutor";
import { ToolResult } from "./types";
import { allAvailableTools } from "../index";

const log = createKnoxLogger("IntelligentChain");

/**
 * Tool chain step
 */
export interface ChainStep {
  id: string;
  tool: Tool;
  args: Record<string, any> | ((context: ChainContext) => Record<string, any>);
  condition?: (context: ChainContext) => boolean;
  onSuccess?: (result: ToolResult, context: ChainContext) => void;
  onFailure?: (error: Error, context: ChainContext) => 'retry' | 'skip' | 'stop' | 'alternative';
  timeout?: number;
  retries?: number;
}

/**
 * Execution branch for conditional logic
 */
export interface ExecutionBranch {
  condition: (context: ChainContext) => boolean;
  steps: ChainStep[];
  description: string;
}

/**
 * Tool chain definition
 */
export interface ToolChain {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
  branches?: ExecutionBranch[];
  rollbackSteps?: ChainStep[];
  metadata?: Record<string, any>;
}

/**
 * Chain execution context
 */
export interface ChainContext {
  chainId: string;
  stepResults: Map<string, ToolResult>;
  variables: Map<string, any>;
  currentStep: number;
  totalSteps: number;
  startTime: number;
  errors: Array<{ step: string; error: Error }>;
  extras: ToolExtras;
}

/**
 * Chain execution result
 */
export interface ChainExecutionResult {
  success: boolean;
  chainId: string;
  results: ToolResult[];
  executionTime: number;
  stepsCompleted: number;
  totalSteps: number;
  errors: Array<{ step: string; error: Error }>;
  output: ContextItem[];
}

/**
 * Intelligent Tool Chain Orchestrator
 */
export class IntelligentChainOrchestrator {
  private static instance: IntelligentChainOrchestrator;
  private relevanceEngine: RelevanceEngine;
  private searchEngine: MultiStrategySearch;
  private executor: ToolExecutor;
  private tools: Tool[];
  
  // Pattern library - stores successful patterns
  private patternLibrary: Map<string, ToolChain> = new Map();
  private executionHistory: Array<{
    query: string;
    chain: ToolChain;
    success: boolean;
    executionTime: number;
  }> = [];

  private constructor() {
    this.relevanceEngine = RelevanceEngine.getInstance();
    this.searchEngine = MultiStrategySearch.getInstance();
    this.executor = ToolExecutor.getInstance();
    this.tools = allAvailableTools;
    this.initializePatterns();
  }

  public static getInstance(): IntelligentChainOrchestrator {
    if (!IntelligentChainOrchestrator.instance) {
      IntelligentChainOrchestrator.instance = new IntelligentChainOrchestrator();
    }
    return IntelligentChainOrchestrator.instance;
  }

  /**
   * Main method - automatically generate and execute tool chain from query
   */
  async orchestrate(
    query: string,
    context: QueryContext,
    extras: ToolExtras
  ): Promise<ChainExecutionResult> {
    // Step 1: Analyze query
    const analysis = this.relevanceEngine.analyzeQuery(query, context);

    // Step 2: Check for matching patterns
    const matchingPattern = this.findMatchingPattern(query, analysis);

    // Step 3: Generate or use chain
    const chain = matchingPattern || this.generateChain(query, analysis, context);

    // Step 4: Execute chain
    const result = await this.executeChain(chain, context, extras);

    // Step 5: Learn from execution
    this.recordExecution(query, chain, result);

    return result;
  }

  /**
   * Generate a tool chain from natural language query
   */
  private generateChain(
    query: string,
    analysis: any,
    context: QueryContext
  ): ToolChain {
    const steps: ChainStep[] = [];
    const chainId = `chain-${Date.now()}`;

    // Determine chain type based on intent
    if (analysis.intent.primary === 'search') {
      steps.push(...this.generateSearchChain(query, analysis, context));
    } else if (analysis.intent.primary === 'modify') {
      steps.push(...this.generateModifyChain(query, analysis, context));
    } else if (analysis.intent.primary === 'analyze') {
      steps.push(...this.generateAnalyzeChain(query, analysis, context));
    } else if (analysis.requiresMultipleSteps) {
      steps.push(...this.generateMultiStepChain(query, analysis, context));
    } else {
      // Simple single-step chain
      const tool = this.selectBestTool(query, context);
      if (tool) {
        steps.push({
          id: 'step-1',
          tool,
          args: this.extractArgsFromQuery(query, tool),
        });
      }
    }

    return {
      id: chainId,
      name: `Generated chain for: ${query.substring(0, 50)}`,
      description: `Auto-generated tool chain for intent: ${analysis.intent.primary}`,
      steps,
    };
  }

  /**
   * Generate a search-focused chain
   */
  private generateSearchChain(
    query: string,
    analysis: any,
    context: QueryContext
  ): ChainStep[] {
    const steps: ChainStep[] = [];

    // Step 1: Multi-strategy search
    const searchTool = this.tools.find(t => t.function.name === 'builtin_multi_file_search')
      || this.tools.find(t => t.function.name === 'builtin_exact_search');

    if (searchTool) {
      steps.push({
        id: 'search-step',
        tool: searchTool,
        args: this.extractSearchArgs(query, analysis),
        onSuccess: (result, ctx) => {
          // Store search results in context
          ctx.variables.set('searchResults', result.output);
        },
      });
    }

    // Step 2: If results are code files, optionally analyze them
    if (analysis.intent.modifiers.has('analyze') || query.toLowerCase().includes('analyze')) {
      const analyzeTool = this.tools.find(t => t.function.name === 'builtin_analyze_code');
      if (analyzeTool) {
        steps.push({
          id: 'analyze-step',
          tool: analyzeTool,
          args: (ctx) => {
            const searchResults = ctx.variables.get('searchResults') || [];
            return {
              filepath: searchResults[0]?.name || '',
            };
          },
          condition: (ctx) => {
            const results = ctx.variables.get('searchResults') || [];
            return results.length > 0;
          },
        });
      }
    }

    // Step 3: If asked to show/read, open the file
    if (analysis.intent.secondary.includes('read') || query.toLowerCase().includes('show')) {
      const readTool = this.tools.find(t => t.function.name === 'builtin_read_file');
      if (readTool) {
        steps.push({
          id: 'read-step',
          tool: readTool,
          args: (ctx) => {
            const searchResults = ctx.variables.get('searchResults') || [];
            return {
              filepath: searchResults[0]?.name || '',
            };
          },
          condition: (ctx) => {
            const results = ctx.variables.get('searchResults') || [];
            return results.length > 0;
          },
        });
      }
    }

    return steps;
  }

  /**
   * Generate a modification-focused chain
   */
  private generateModifyChain(
    query: string,
    analysis: any,
    context: QueryContext
  ): ChainStep[] {
    const steps: ChainStep[] = [];

    // Step 1: Search for target file/code
    const searchTool = this.tools.find(t => t.function.name === 'builtin_exact_search');
    if (searchTool && !analysis.intent.entities.has('filepath')) {
      steps.push({
        id: 'find-target',
        tool: searchTool,
        args: this.extractSearchArgs(query, analysis),
        onSuccess: (result, ctx) => {
          ctx.variables.set('targetFiles', result.output);
        },
      });
    }

    // Step 2: Read the file to understand context
    const readTool = this.tools.find(t => t.function.name === 'builtin_read_file');
    if (readTool) {
      steps.push({
        id: 'read-target',
        tool: readTool,
        args: (ctx) => {
          const filepath = analysis.intent.entities.get('filepath')
            || ctx.variables.get('targetFiles')?.[0]?.name;
          return { filepath };
        },
        onSuccess: (result, ctx) => {
          ctx.variables.set('currentContent', result.output[0]?.content);
        },
      });
    }

    // Step 3: Perform modification using smart editor
    const editTool = this.tools.find(t => t.function.name === 'composite_smart_edit');
    if (editTool) {
      steps.push({
        id: 'modify-file',
        tool: editTool,
        args: (ctx) => {
          const filepath = analysis.intent.entities.get('filepath')
            || ctx.variables.get('targetFiles')?.[0]?.name;
          return {
            filepath,
            modification: {
              type: 'refactor',
              description: query,
            },
            validate: true,
          };
        },
      });
    }

    return steps;
  }

  /**
   * Generate an analysis-focused chain
   */
  private generateAnalyzeChain(
    query: string,
    analysis: any,
    context: QueryContext
  ): ChainStep[] {
    const steps: ChainStep[] = [];

    // Step 1: Get target file/code
    if (analysis.intent.entities.has('filepath')) {
      const readTool = this.tools.find(t => t.function.name === 'builtin_read_file');
      if (readTool) {
        steps.push({
          id: 'read-file',
          tool: readTool,
          args: { filepath: analysis.intent.entities.get('filepath') },
        });
      }
    } else {
      // Search for target
      const searchTool = this.tools.find(t => t.function.name === 'builtin_exact_search');
      if (searchTool) {
        steps.push({
          id: 'find-target',
          tool: searchTool,
          args: this.extractSearchArgs(query, analysis),
          onSuccess: (result, ctx) => {
            ctx.variables.set('targetFiles', result.output);
          },
        });
      }
    }

    // Step 2: Analyze code
    const analyzeTool = this.tools.find(t => t.function.name === 'builtin_analyze_code');
    if (analyzeTool) {
      steps.push({
        id: 'analyze',
        tool: analyzeTool,
        args: (ctx) => {
          const filepath = analysis.intent.entities.get('filepath')
            || ctx.variables.get('targetFiles')?.[0]?.name;
          return {
            filepath,
            analysisType: this.determineAnalysisType(query),
            includeMetrics: true,
          };
        },
      });
    }

    return steps;
  }

  /**
   * Generate a multi-step chain for complex queries
   */
  private generateMultiStepChain(
    query: string,
    analysis: any,
    context: QueryContext
  ): ChainStep[] {
    const steps: ChainStep[] = [];

    // Parse query for sequential operations
    const operations = this.parseSequentialOperations(query);

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const tool = this.selectBestTool(operation, context);

      if (tool) {
        steps.push({
          id: `step-${i + 1}`,
          tool,
          args: this.extractArgsFromQuery(operation, tool),
          onSuccess: (result, ctx) => {
            // Store intermediate results
            ctx.variables.set(`step${i + 1}Result`, result.output);
          },
        });
      }
    }

    return steps;
  }

  /**
   * Execute a tool chain
   */
  private async executeChain(
    chain: ToolChain,
    context: QueryContext,
    extras: ToolExtras
  ): Promise<ChainExecutionResult> {
    const startTime = Date.now();
    const chainContext: ChainContext = {
      chainId: chain.id,
      stepResults: new Map(),
      variables: new Map(),
      currentStep: 0,
      totalSteps: chain.steps.length,
      startTime,
      errors: [],
      extras,
    };

    const results: ToolResult[] = [];
    const allOutput: ContextItem[] = [];
    let stepsCompleted = 0;

    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      chainContext.currentStep = i;

      // Check condition
      if (step.condition && !step.condition(chainContext)) {
        log.debug(`Skipping step ${step.id} - condition not met`);
        continue;
      }

      try {
        // Resolve args
        const args = typeof step.args === 'function'
          ? step.args(chainContext)
          : step.args;

        // Execute step with timeout
        const stepResult = await this.executeStep(step, args, extras, step.timeout);

        // Store result
        chainContext.stepResults.set(step.id, stepResult);
        results.push(stepResult);
        allOutput.push(...stepResult.output);
        stepsCompleted++;

        // Call success handler
        if (step.onSuccess) {
          step.onSuccess(stepResult, chainContext);
        }

        // Check for branch conditions
        if (chain.branches) {
          const matchedBranch = chain.branches.find(b => b.condition(chainContext));
          if (matchedBranch) {
            log.debug(`Taking branch: ${matchedBranch.description}`);
            // Execute branch steps
            for (const branchStep of matchedBranch.steps) {
              const branchArgs = typeof branchStep.args === 'function'
                ? branchStep.args(chainContext)
                : branchStep.args;
              
              const branchResult = await this.executeStep(branchStep, branchArgs, extras);
              chainContext.stepResults.set(branchStep.id, branchResult);
              results.push(branchResult);
              allOutput.push(...branchResult.output);
              stepsCompleted++;
            }
          }
        }
      } catch (error) {
        const err = error as Error;
        chainContext.errors.push({ step: step.id, error: err });

        // Handle failure
        if (step.onFailure) {
          const action = step.onFailure(err, chainContext);

          if (action === 'retry' && (step.retries || 0) > 0) {
            // Retry logic
            log.debug(`Retrying step ${step.id}...`);
            i--; // Retry this step
            continue;
          } else if (action === 'skip') {
            log.debug(`Skipping step ${step.id} after error`);
            continue;
          } else if (action === 'stop') {
            log.info(`Stopping chain execution after error in ${step.id}`);
            break;
          }
        } else {
          // Default: continue to next step
          log.warn(`Error in step ${step.id}, continuing:`, err);
        }
      }
    }

    return {
      success: chainContext.errors.length === 0,
      chainId: chain.id,
      results,
      executionTime: Date.now() - startTime,
      stepsCompleted,
      totalSteps: chain.steps.length,
      errors: chainContext.errors,
      output: allOutput,
    };
  }

  /**
   * Execute a single chain step
   */
  private async executeStep(
    step: ChainStep,
    args: Record<string, any>,
    extras: ToolExtras,
    timeout?: number
  ): Promise<ToolResult> {
    return await this.executor.execute(step.tool, args, extras, {
      timeout: timeout || 30000,
      retry: step.retries ? { maxRetries: step.retries, backoffMs: 1000, backoffMultiplier: 2 } : undefined,
    });
  }

  // ===== HELPER METHODS =====

  private initializePatterns(): void {
    // Only register patterns whose tools are actually routable via callTool.
    const search = this.tools.find(
      (t) => t.function.name === "builtin_exact_search",
    );
    const read = this.tools.find(
      (t) => t.function.name === "builtin_read_file",
    );
    const edit = this.tools.find(
      (t) => t.function.name === "composite_smart_edit",
    );

    if (search && read) {
      this.patternLibrary.set("search-read", {
        id: "search-read",
        name: "Search and Read",
        description: "Search for files and read the results",
        steps: [
          {
            id: "search",
            tool: search,
            args: (ctx) => ({ query: ctx.variables.get("searchTerm") }),
            onSuccess: (result, ctx) => {
              ctx.variables.set("searchResults", result.output);
            },
          },
          {
            id: "read",
            tool: read,
            args: (ctx) => {
              const results = ctx.variables.get("searchResults") || [];
              return { filepath: results[0]?.name || "" };
            },
            condition: (ctx) =>
              (ctx.variables.get("searchResults") || []).length > 0,
          },
        ],
      });
    }

    if (search && read && edit) {
      this.patternLibrary.set("find-modify", {
        id: "find-modify",
        name: "Find and Modify",
        description: "Find code and modify it via composite_smart_edit",
        steps: [
          {
            id: "search",
            tool: search,
            args: (ctx) => ({ query: ctx.variables.get("searchTerm") }),
          },
          {
            id: "read",
            tool: read,
            args: (ctx) => ({ filepath: ctx.variables.get("targetFile") }),
          },
          {
            id: "modify",
            tool: edit,
            args: (ctx) => ({
              filepath: ctx.variables.get("targetFile"),
              modification: ctx.variables.get("modification"),
            }),
          },
        ],
      });
    }
  }

  private findMatchingPattern(query: string, analysis: any): ToolChain | null {
    // Check if query matches a known pattern
    const queryLower = query.toLowerCase();

    if (/search.*(?:and|then).*read/i.test(queryLower)) {
      return this.patternLibrary.get('search-read') || null;
    }

    if (/find.*(?:and|then).*(?:modify|edit|change)/i.test(queryLower)) {
      return this.patternLibrary.get('find-modify') || null;
    }

    // Check execution history for similar queries
    const similarExecution = this.executionHistory
      .filter(e => e.success)
      .find(e => this.querySimilarity(query, e.query) > 0.8);

    if (similarExecution) {
      return similarExecution.chain;
    }

    return null;
  }

  private selectBestTool(query: string, context: QueryContext): Tool | null {
    const ranked = this.relevanceEngine.rankTools(this.tools, query, context);
    return ranked.length > 0 ? ranked[0].tool : null;
  }

  private extractArgsFromQuery(query: string, tool: Tool): Record<string, any> {
    const args: Record<string, any> = {};
    const params = tool.function.parameters?.properties || {};

    // Extract common parameters
    if ('query' in params || 'search' in params) {
      const searchMatch = query.match(/(?:search|find)\s+['"`]?([^'"`\n]+?)['"`]?(?:\s|$)/i);
      if (searchMatch) {
        args.query = searchMatch[1].trim();
      }
    }

    if ('filepath' in params || 'path' in params) {
      const fileMatch = query.match(/['"`]([^'"`]+\.[a-zA-Z]+)['"`]/);
      if (fileMatch) {
        args.filepath = fileMatch[1];
      }
    }

    if ('command' in params) {
      const cmdMatch = query.match(/(?:run|execute)\s+['"`]?([^'"`\n]+?)['"`]?(?:\s|$)/i);
      if (cmdMatch) {
        args.command = cmdMatch[1].trim();
      }
    }

    return args;
  }

  private extractSearchArgs(query: string, analysis: any): Record<string, any> {
    const args: Record<string, any> = {};

    // Extract search term
    const searchTerm = analysis.intent.entities.get('searchTerm');
    if (searchTerm) {
      args.query = searchTerm;
    } else {
      // Extract from query
      const match = query.match(/(?:search|find)\s+['"`]?([^'"`\n]+?)['"`]?(?:\s|$)/i);
      if (match) {
        args.query = match[1].trim();
      }
    }

    // Extract file type if mentioned
    const fileTypeMatch = query.match(/\.([a-z]+)\s+files?|([a-z]+)\s+files?/i);
    if (fileTypeMatch) {
      args.fileType = fileTypeMatch[1] || fileTypeMatch[2];
    }

    return args;
  }

  private determineAnalysisType(query: string): string {
    if (/security|vulnerability|cve/i.test(query)) return 'security';
    if (/complex|metrics|cyclomatic/i.test(query)) return 'complexity';
    if (/structure|architecture/i.test(query)) return 'structure';
    if (/dependency|import/i.test(query)) return 'dependencies';
    if (/pattern|anti-pattern/i.test(query)) return 'patterns';
    return 'full';
  }

  private parseSequentialOperations(query: string): string[] {
    // Split on sequential indicators
    const separators = /\s+(?:and then|then|and|,)\s+/i;
    const operations = query.split(separators);

    return operations.map(op => op.trim()).filter(op => op.length > 0);
  }

  private querySimilarity(query1: string, query2: string): number {
    // Simple similarity calculation
    const words1 = new Set(query1.toLowerCase().split(/\s+/));
    const words2 = new Set(query2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  private recordExecution(
    query: string,
    chain: ToolChain,
    result: ChainExecutionResult
  ): void {
    this.executionHistory.push({
      query,
      chain,
      success: result.success,
      executionTime: result.executionTime,
    });

    // Store successful patterns
    if (result.success && result.executionTime < 5000) {
      const patternKey = `pattern-${this.executionHistory.length}`;
      this.patternLibrary.set(patternKey, chain);
    }

    // Prune old history
    if (this.executionHistory.length > 500) {
      this.executionHistory = this.executionHistory.slice(-500);
    }
  }
}
