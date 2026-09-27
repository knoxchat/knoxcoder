/**
 * Tool Executor - Advanced tool execution with intelligent features
 * 
 * Features:
 * - Parallel tool execution with dependency resolution
 * - Automatic retry with exponential backoff
 * - Rate limiting and throttling
 * - Tool suggestion based on context
 * - Execution statistics and monitoring
 * - Smart scheduling based on tool characteristics
 */

import { ContextItem, Tool, ToolExtras } from "../..";
import { callToolRaw as callTool } from "../callTool.js";
import { ToolCache } from "./ToolCache.js";
import { ToolEventEmitter } from "./ToolEvents.js";
import { 
  ToolResult, 
  RetryConfig, 
  ToolDependencyGraph, 
  ToolDependencyNode,
  ToolSuggestion,
  ExecutionStrategy 
} from "./types.js";

/**
 * Execution options for tools
 */
interface ExecutionOptions {
  timeout?: number;
  retry?: RetryConfig;
  priority?: number;
  cache?: boolean;
  cacheTtl?: number;
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

/**
 * Execution statistics
 */
interface ExecutionStats {
  toolName: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  averageExecutionTime: number;
  lastExecutedAt: number;
  p50ExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;
}

/**
 * Rate limiter state
 */
interface RateLimiterState {
  tokens: number;
  lastRefill: number;
  windowMs: number;
  maxTokens: number;
}

/**
 * Advanced Tool Executor
 */
export class ToolExecutor {
  private static instance: ToolExecutor;
  private cache: ToolCache;
  private eventEmitter: ToolEventEmitter;
  private stats: Map<string, ExecutionStats> = new Map();
  private executionTimes: Map<string, number[]> = new Map();
  private rateLimiters: Map<string, RateLimiterState> = new Map();
  private dependencyGraph: ToolDependencyGraph;
  private pendingExecutions: Map<string, Promise<ToolResult>> = new Map();

  private constructor() {
    this.cache = ToolCache.getInstance();
    this.eventEmitter = ToolEventEmitter.getInstance();
    this.dependencyGraph = {
      nodes: new Map(),
      edges: new Map()
    };
    this.initializeDependencyGraph();
  }

  public static getInstance(): ToolExecutor {
    if (!ToolExecutor.instance) {
      ToolExecutor.instance = new ToolExecutor();
    }
    return ToolExecutor.instance;
  }

  /**
   * Execute a single tool with options
   */
  async execute(
    tool: Tool,
    args: Record<string, any>,
    extras: ToolExtras,
    options: ExecutionOptions = {}
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const toolName = tool.function.name;

    // Check rate limit
    if (options.rateLimit) {
      await this.waitForRateLimit(toolName, options.rateLimit);
    }

    // Check cache
    if (options.cache) {
      const cached = this.cache.get(toolName, args, {
        enabled: true,
        ttlMs: options.cacheTtl || 60000
      });
      if (cached) {
        return cached;
      }
    }

    // Emit start event
    this.eventEmitter.emit({
      type: 'tool:start',
      timestamp: Date.now(),
      source: toolName,
      payload: { args, options }
    });

    try {
      // Execute with timeout and retry
      const output = await this.executeWithRetry(
        () => this.executeWithTimeout(
          () => callTool(tool, args, extras),
          options.timeout || 30000
        ),
        options.retry
      );

      const result: ToolResult = {
        success: true,
        toolName,
        output,
        executionTime: Date.now() - startTime,
        cached: false
      };

      // Update stats
      this.recordExecution(toolName, result);

      // Cache result
      if (options.cache) {
        this.cache.set(toolName, args, result, {
          enabled: true,
          ttlMs: options.cacheTtl || 60000
        });
      }

      // Emit complete event
      this.eventEmitter.emit({
        type: 'tool:complete',
        timestamp: Date.now(),
        source: toolName,
        payload: { result }
      });

      return result;

    } catch (error) {
      const result: ToolResult = {
        success: false,
        toolName,
        output: [],
        error: error as Error,
        executionTime: Date.now() - startTime
      };

      this.recordExecution(toolName, result);

      this.eventEmitter.emit({
        type: 'tool:error',
        timestamp: Date.now(),
        source: toolName,
        payload: { error }
      });

      return result;
    }
  }

  /**
   * Execute multiple tools in parallel with proper concurrency control.
   *
   * Uses a semaphore-style approach instead of the broken promise-settlement
   * detection pattern. Each slot tracks its own completion.
   */
  async executeParallel(
    executions: Array<{
      tool: Tool;
      args: Record<string, any>;
      options?: ExecutionOptions;
    }>,
    extras: ToolExtras,
    maxConcurrency: number = 5
  ): Promise<ToolResult[]> {
    if (executions.length === 0) return [];

    // Pre-allocate results array to maintain order
    const results: ToolResult[] = new Array(executions.length);
    let nextIndex = 0;

    // Semaphore-based concurrency limiter
    const runWithConcurrency = async (): Promise<void> => {
      const active = new Set<Promise<void>>();

      for (let i = 0; i < executions.length; i++) {
        const exec = executions[i];
        const idx = i;

        const task = (async () => {
          try {
            results[idx] = await this.execute(exec.tool, exec.args, extras, exec.options);
          } catch (error) {
            results[idx] = {
              success: false,
              toolName: exec.tool.function.name,
              output: [],
              error: error instanceof Error ? error : new Error(String(error)),
              executionTime: 0,
            };
          }
        })();

        active.add(task);
        task.finally(() => active.delete(task));

        // When at capacity, wait for one slot to free up
        if (active.size >= maxConcurrency) {
          await Promise.race(active);
        }
      }

      // Wait for all remaining tasks
      if (active.size > 0) {
        await Promise.all(active);
      }
    };

    await runWithConcurrency();
    return results;
  }

  /**
   * Execute tools with automatic dependency resolution
   */
  async executeWithDependencies(
    tools: Array<{
      tool: Tool;
      args: Record<string, any>;
      options?: ExecutionOptions;
      dependsOn?: string[];
    }>,
    extras: ToolExtras
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();
    const executed = new Set<string>();
    const pending = new Map(tools.map(t => [t.tool.function.name, t]));

    while (pending.size > 0) {
      // Find tools with satisfied dependencies
      const ready: typeof tools[0][] = [];
      
      for (const [name, toolInfo] of pending) {
        const deps = toolInfo.dependsOn || [];
        if (deps.every(dep => executed.has(dep))) {
          ready.push(toolInfo);
        }
      }

      if (ready.length === 0 && pending.size > 0) {
        throw new Error('Circular dependency detected or unresolvable dependencies');
      }

      // Execute ready tools in parallel
      const readyResults = await this.executeParallel(
        ready.map(t => ({ tool: t.tool, args: t.args, options: t.options })),
        extras
      );

      // Record results
      for (let i = 0; i < ready.length; i++) {
        const name = ready[i].tool.function.name;
        results.set(name, readyResults[i]);
        executed.add(name);
        pending.delete(name);
      }
    }

    return results;
  }

  /**
   * Execute with intelligent scheduling based on tool characteristics
   */
  async executeIntelligent(
    tools: Array<{
      tool: Tool;
      args: Record<string, any>;
      options?: ExecutionOptions;
    }>,
    extras: ToolExtras,
    strategy: ExecutionStrategy = 'adaptive'
  ): Promise<ToolResult[]> {
    switch (strategy) {
      case 'sequential':
        return this.executeSequential(tools, extras);
      
      case 'parallel':
        return this.executeParallel(tools, extras);
      
      case 'adaptive':
        return this.executeAdaptive(tools, extras);
      
      case 'priority':
        return this.executePriority(tools, extras);
      
      default:
        return this.executeSequential(tools, extras);
    }
  }

  /**
   * Execute sequentially
   */
  private async executeSequential(
    tools: Array<{
      tool: Tool;
      args: Record<string, any>;
      options?: ExecutionOptions;
    }>,
    extras: ToolExtras
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    
    for (const exec of tools) {
      const result = await this.execute(exec.tool, exec.args, extras, exec.options);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Execute with adaptive parallelization
   */
  private async executeAdaptive(
    tools: Array<{
      tool: Tool;
      args: Record<string, any>;
      options?: ExecutionOptions;
    }>,
    extras: ToolExtras
  ): Promise<ToolResult[]> {
    // Group tools by their characteristics
    const readOnlyTools: typeof tools = [];
    const writeTools: typeof tools = [];
    
    for (const exec of tools) {
      const node = this.dependencyGraph.nodes.get(exec.tool.function.name);
      if (node && node.sideEffects.includes('none')) {
        readOnlyTools.push(exec);
      } else {
        writeTools.push(exec);
      }
    }

    // Execute read-only tools in parallel, write tools sequentially
    const [readResults, writeResults] = await Promise.all([
      this.executeParallel(readOnlyTools, extras),
      this.executeSequential(writeTools, extras)
    ]);

    // Merge results in original order
    const results: ToolResult[] = [];
    let readIndex = 0, writeIndex = 0;
    
    for (const exec of tools) {
      const node = this.dependencyGraph.nodes.get(exec.tool.function.name);
      if (node && node.sideEffects.includes('none')) {
        results.push(readResults[readIndex++]);
      } else {
        results.push(writeResults[writeIndex++]);
      }
    }

    return results;
  }

  /**
   * Execute by priority
   */
  private async executePriority(
    tools: Array<{
      tool: Tool;
      args: Record<string, any>;
      options?: ExecutionOptions;
    }>,
    extras: ToolExtras
  ): Promise<ToolResult[]> {
    // Sort by priority (higher first)
    const sorted = [...tools].sort((a, b) => 
      (b.options?.priority || 0) - (a.options?.priority || 0)
    );

    return this.executeSequential(sorted, extras);
  }

  /**
   * Get tool suggestions based on current context
   */
  suggestTools(
    context: {
      recentTools: string[];
      currentFile?: string;
      currentTask?: string;
      availableTools: Tool[];
    }
  ): ToolSuggestion[] {
    const suggestions: ToolSuggestion[] = [];

    // Analyze patterns from recent tools
    const lastTool = context.recentTools[context.recentTools.length - 1];
    
    if (lastTool) {
      // Suggest related tools based on common patterns
      const patterns: Record<string, string[]> = {
        'builtin_exact_search': ['builtin_read_file', 'builtin_view_subdirectory'],
        'builtin_read_file': ['builtin_create_new_file', 'builtin_exact_search'],
        'builtin_view_subdirectory': ['builtin_read_file', 'builtin_exact_search'],
        'builtin_view_repo_map': ['builtin_view_subdirectory', 'builtin_read_file'],
        'builtin_search_web': ['builtin_create_new_file', 'builtin_run_terminal_command'],
        'builtin_view_diff': ['builtin_read_file', 'builtin_run_terminal_command']
      };

      const related = patterns[lastTool] || [];
      for (const toolName of related) {
        const tool = context.availableTools.find(t => t.function.name === toolName);
        if (tool) {
          suggestions.push({
            tool,
            reason: `Commonly used after ${lastTool}`,
            confidence: 0.7,
            relatedTools: related
          });
        }
      }
    }

    // Suggest based on file extension
    if (context.currentFile) {
      const ext = context.currentFile.split('.').pop()?.toLowerCase();
      const fileBasedSuggestions: Record<string, string[]> = {
        'ts': ['builtin_exact_search', 'builtin_run_terminal_command'],
        'js': ['builtin_exact_search', 'builtin_run_terminal_command'],
        'json': ['builtin_read_file'],
        'md': ['builtin_read_file', 'builtin_search_web']
      };

      const suggested = fileBasedSuggestions[ext || ''] || [];
      for (const toolName of suggested) {
        const tool = context.availableTools.find(t => t.function.name === toolName);
        if (tool && !suggestions.find(s => s.tool.function.name === toolName)) {
          suggestions.push({
            tool,
            reason: `Useful for .${ext} files`,
            confidence: 0.5
          });
        }
      }
    }

    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get execution statistics
   */
  getStats(toolName?: string): ExecutionStats | ExecutionStats[] | undefined {
    if (toolName) {
      return this.stats.get(toolName);
    }
    return [...this.stats.values()];
  }

  /**
   * Clear execution statistics
   */
  clearStats(): void {
    this.stats.clear();
    this.executionTimes.clear();
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    config?: RetryConfig,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!config || attempt >= config.maxRetries) {
        throw error;
      }

      // Check if error is retryable
      if (config.retryableErrors && config.retryableErrors.length > 0) {
        const errorMessage = (error as Error).message;
        const isRetryable = config.retryableErrors.some(e => 
          errorMessage.includes(e)
        );
        if (!isRetryable) {
          throw error;
        }
      }

      // Exponential backoff
      const delay = config.backoffMs * Math.pow(config.backoffMultiplier, attempt - 1);
      await this.sleep(delay);

      this.eventEmitter.emit({
        type: 'tool:retry',
        timestamp: Date.now(),
        source: 'ToolExecutor',
        payload: { attempt, delay }
      });

      return this.executeWithRetry(fn, config, attempt + 1);
    }
  }

  /**
   * Wait for rate limit
   */
  private async waitForRateLimit(
    toolName: string,
    config: { maxCalls: number; windowMs: number }
  ): Promise<void> {
    let limiter = this.rateLimiters.get(toolName);
    
    if (!limiter) {
      limiter = {
        tokens: config.maxCalls,
        lastRefill: Date.now(),
        windowMs: config.windowMs,
        maxTokens: config.maxCalls
      };
      this.rateLimiters.set(toolName, limiter);
    }

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = now - limiter.lastRefill;
    const refillAmount = Math.floor(elapsed / limiter.windowMs) * limiter.maxTokens;
    
    if (refillAmount > 0) {
      limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + refillAmount);
      limiter.lastRefill = now;
    }

    // Wait if no tokens available
    if (limiter.tokens <= 0) {
      const waitTime = limiter.windowMs - (now - limiter.lastRefill);
      await this.sleep(waitTime);
      limiter.tokens = limiter.maxTokens;
      limiter.lastRefill = Date.now();
    }

    limiter.tokens--;
  }

  /**
   * Record execution for statistics
   */
  private recordExecution(toolName: string, result: ToolResult): void {
    let stats = this.stats.get(toolName);
    
    if (!stats) {
      stats = {
        toolName,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        averageExecutionTime: 0,
        lastExecutedAt: 0,
        p50ExecutionTime: 0,
        p95ExecutionTime: 0,
        p99ExecutionTime: 0
      };
      this.stats.set(toolName, stats);
      this.executionTimes.set(toolName, []);
    }

    stats.totalExecutions++;
    stats.lastExecutedAt = Date.now();
    
    if (result.success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    // Track execution times
    const times = this.executionTimes.get(toolName)!;
    times.push(result.executionTime);
    
    // Keep only last 1000 executions
    if (times.length > 1000) {
      times.shift();
    }

    // Calculate statistics
    stats.averageExecutionTime = times.reduce((a, b) => a + b, 0) / times.length;
    
    const sorted = [...times].sort((a, b) => a - b);
    stats.p50ExecutionTime = sorted[Math.floor(sorted.length * 0.5)];
    stats.p95ExecutionTime = sorted[Math.floor(sorted.length * 0.95)];
    stats.p99ExecutionTime = sorted[Math.floor(sorted.length * 0.99)];
  }

  /**
   * Initialize dependency graph with built-in tools
   */
  private initializeDependencyGraph(): void {
    const nodes: ToolDependencyNode[] = [
      {
        toolName: 'builtin_read_file',
        inputTypes: ['filepath'],
        outputTypes: ['file_content'],
        sideEffects: ['none'],
        reversible: true
      },
      {
        toolName: 'builtin_create_new_file',
        inputTypes: ['filepath', 'content'],
        outputTypes: [],
        sideEffects: ['file-write'],
        reversible: true
      },
      {
        toolName: 'builtin_run_terminal_command',
        inputTypes: ['command'],
        outputTypes: ['terminal_output'],
        sideEffects: ['terminal'],
        reversible: false
      },
      {
        toolName: 'builtin_view_subdirectory',
        inputTypes: ['path'],
        outputTypes: ['directory_listing'],
        sideEffects: ['none'],
        reversible: true
      },
      {
        toolName: 'builtin_view_repo_map',
        inputTypes: [],
        outputTypes: ['repo_structure'],
        sideEffects: ['none'],
        reversible: true
      },
      {
        toolName: 'builtin_exact_search',
        inputTypes: ['query'],
        outputTypes: ['search_results'],
        sideEffects: ['none'],
        reversible: true
      },
      {
        toolName: 'builtin_search_web',
        inputTypes: ['query'],
        outputTypes: ['web_results'],
        sideEffects: ['network'],
        reversible: true
      },
      {
        toolName: 'builtin_view_diff',
        inputTypes: [],
        outputTypes: ['diff'],
        sideEffects: ['none'],
        reversible: true
      }
    ];

    for (const node of nodes) {
      this.dependencyGraph.nodes.set(node.toolName, node);
    }

    // Define edges (dependencies)
    // For example, creating a file might depend on reading the directory first
    this.dependencyGraph.edges.set('builtin_create_new_file', ['builtin_view_subdirectory']);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a fluent execution builder
 */
export function executeTool(tool: Tool): ToolExecutionBuilder {
  return new ToolExecutionBuilder(tool);
}

/**
 * Fluent builder for tool execution
 */
class ToolExecutionBuilder {
  private tool: Tool;
  private args: Record<string, any> = {};
  private options: ExecutionOptions = {};

  constructor(tool: Tool) {
    this.tool = tool;
  }

  withArgs(args: Record<string, any>): this {
    this.args = args;
    return this;
  }

  withTimeout(ms: number): this {
    this.options.timeout = ms;
    return this;
  }

  withRetry(config: RetryConfig): this {
    this.options.retry = config;
    return this;
  }

  withCache(ttlMs: number = 60000): this {
    this.options.cache = true;
    this.options.cacheTtl = ttlMs;
    return this;
  }

  withRateLimit(maxCalls: number, windowMs: number): this {
    this.options.rateLimit = { maxCalls, windowMs };
    return this;
  }

  withPriority(priority: number): this {
    this.options.priority = priority;
    return this;
  }

  async execute(extras: ToolExtras): Promise<ToolResult> {
    return ToolExecutor.getInstance().execute(
      this.tool,
      this.args,
      extras,
      this.options
    );
  }
}
