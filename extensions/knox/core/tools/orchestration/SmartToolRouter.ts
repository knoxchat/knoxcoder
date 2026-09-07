/**
 * @experimental — NOT on the default chat path and not exported from
 * `orchestration/index.ts`. Zero production callers as of P2-02.
 *
 * Prefer explicit tool calls through `callTool`. Keep this file only as a
 * reference for a future optional "smart route" mode (perfect-impl P2-02 B).
 *
 * Features (library-only):
 * - Natural language intent understanding
 * - Automatic tool selection based on context
 * - Multi-tool orchestration for complex requests
 */

import { ContextItem, Tool, ToolExtras } from "../..";
import { allTools } from "../index.js";
import { advancedTools } from "../definitions/advanced/index.js";
import { compositeTools } from "../definitions/composite/index.js";
import { ToolExecutor } from "./ToolExecutor.js";
import { createPipeline, PipelineBuilder } from "./ToolPipeline.js";
import { ToolEventEmitter } from "./ToolEvents.js";

/**
 * Intent detected from user request
 */
interface DetectedIntent {
  primary: string;
  secondary: string[];
  confidence: number;
  entities: Record<string, string>;
  suggestedTools: string[];
  requiresMultipleTools: boolean;
}

/**
 * Routing decision
 */
interface RoutingDecision {
  selectedTools: Tool[];
  executionOrder: 'sequential' | 'parallel' | 'pipeline';
  pipeline?: PipelineBuilder;
  reasoning: string;
  estimatedCost: 'low' | 'medium' | 'high';
}

/**
 * Smart Tool Router
 */
export class SmartToolRouter {
  private static instance: SmartToolRouter;
  private allAvailableTools: Tool[];
  private intentPatterns: Map<string, IntentPattern>;
  private executionHistory: ExecutionRecord[];
  private eventEmitter: ToolEventEmitter;

  private constructor() {
    // Combine all tool definitions
    this.allAvailableTools = [
      ...allTools,
      ...advancedTools,
      ...compositeTools
    ];
    this.intentPatterns = new Map();
    this.executionHistory = [];
    this.eventEmitter = ToolEventEmitter.getInstance();
    
    this.initializeIntentPatterns();
  }

  public static getInstance(): SmartToolRouter {
    if (!SmartToolRouter.instance) {
      SmartToolRouter.instance = new SmartToolRouter();
    }
    return SmartToolRouter.instance;
  }

  /**
   * Route a natural language request to appropriate tools
   */
  async route(request: string, context: RoutingContext): Promise<RoutingDecision> {
    // Step 1: Detect intent
    const intent = this.detectIntent(request, context);
    
    // Step 2: Select tools based on intent
    const selectedTools = this.selectTools(intent, context);
    
    // Step 3: Determine execution strategy
    const executionOrder = this.determineExecutionOrder(selectedTools, intent);
    
    // Step 4: Build pipeline if needed
    let pipeline: PipelineBuilder | undefined;
    if (executionOrder === 'pipeline') {
      pipeline = this.buildPipeline(selectedTools, intent, context);
    }
    
    // Step 5: Estimate cost
    const estimatedCost = this.estimateCost(selectedTools, executionOrder);
    
    // Generate reasoning
    const reasoning = this.generateReasoning(intent, selectedTools, executionOrder);
    
    return {
      selectedTools,
      executionOrder,
      pipeline,
      reasoning,
      estimatedCost
    };
  }

  /**
   * Execute based on routing decision
   */
  async execute(
    decision: RoutingDecision, 
    extras: ToolExtras
  ): Promise<ContextItem[]> {
    const executor = ToolExecutor.getInstance();
    const results: ContextItem[] = [];
    
    if (decision.pipeline) {
      // Execute pipeline
      const pipelineResult = await decision.pipeline.build().execute(extras);
      for (const result of pipelineResult.results.values()) {
        results.push(...result.output);
      }
    } else if (decision.executionOrder === 'parallel') {
      // Execute tools in parallel
      const parallelResults = await executor.executeParallel(
        decision.selectedTools.map(tool => ({ tool, args: {} })),
        extras
      );
      for (const result of parallelResults) {
        results.push(...result.output);
      }
    } else {
      // Execute sequentially
      for (const tool of decision.selectedTools) {
        const result = await executor.execute(tool, {}, extras);
        results.push(...result.output);
      }
    }
    
    // Record execution for learning
    this.recordExecution(decision, results);
    
    return results;
  }

  /**
   * Detect intent from natural language request
   */
  private detectIntent(request: string, context: RoutingContext): DetectedIntent {
    const lowerRequest = request.toLowerCase();
    const entities: Record<string, string> = {};
    const suggestedTools: string[] = [];
    
    // Extract entities (file paths, search terms, etc.)
    const filePathMatch = request.match(/['"`]([^'"`]+\.[a-z]+)['"`]|(\S+\.[a-z]+)/i);
    if (filePathMatch) {
      entities.filepath = filePathMatch[1] || filePathMatch[2];
    }
    
    const searchTermMatch = request.match(/(?:search|find|look for)\s+['"`]?([^'"`]+?)['"`]?(?:\s|$)/i);
    if (searchTermMatch) {
      entities.searchTerm = searchTermMatch[1];
    }
    
    // Detect primary intent
    let primary = 'unknown';
    let confidence = 0;
    
    for (const [intentName, pattern] of this.intentPatterns) {
      const score = this.scoreIntent(lowerRequest, pattern);
      if (score > confidence) {
        confidence = score;
        primary = intentName;
        suggestedTools.push(...pattern.suggestedTools);
      }
    }
    
    // Detect secondary intents (for compound requests)
    const secondary: string[] = [];
    if (lowerRequest.includes(' and ') || lowerRequest.includes(' then ')) {
      for (const [intentName, pattern] of this.intentPatterns) {
        if (intentName !== primary) {
          const score = this.scoreIntent(lowerRequest, pattern);
          if (score > 0.3) {
            secondary.push(intentName);
          }
        }
      }
    }
    
    return {
      primary,
      secondary,
      confidence,
      entities,
      suggestedTools: [...new Set(suggestedTools)],
      requiresMultipleTools: secondary.length > 0 || suggestedTools.length > 1
    };
  }

  /**
   * Score how well a request matches an intent pattern
   */
  private scoreIntent(request: string, pattern: IntentPattern): number {
    let score = 0;
    
    for (const keyword of pattern.keywords) {
      if (request.includes(keyword)) {
        score += pattern.keywordWeights?.[keyword] || 1;
      }
    }
    
    // Bonus for multiple keyword matches
    const matchCount = pattern.keywords.filter(k => request.includes(k)).length;
    if (matchCount > 1) {
      score *= 1 + (matchCount * 0.1);
    }
    
    // Apply anti-patterns (negative matches)
    if (pattern.antiPatterns) {
      for (const anti of pattern.antiPatterns) {
        if (request.includes(anti)) {
          score *= 0.5;
        }
      }
    }
    
    // Normalize to 0-1
    return Math.min(score / pattern.maxScore, 1);
  }

  /**
   * Select appropriate tools based on detected intent
   */
  private selectTools(intent: DetectedIntent, context: RoutingContext): Tool[] {
    const selected: Tool[] = [];
    
    // Start with suggested tools from intent
    for (const toolName of intent.suggestedTools) {
      const tool = this.allAvailableTools.find(t => t.function.name === toolName);
      if (tool) {
        selected.push(tool);
      }
    }
    
    // If no tools suggested, use context-based selection
    if (selected.length === 0) {
      selected.push(...this.selectByContext(context));
    }
    
    // Apply cost optimization if requested
    if (context.optimizeCost) {
      return this.optimizeToolSelection(selected, intent);
    }
    
    return selected;
  }

  /**
   * Select tools based on context
   */
  private selectByContext(context: RoutingContext): Tool[] {
    const selected: Tool[] = [];
    
    // If there's a current file, suggest file-related tools
    if (context.currentFile) {
      const readTool = this.allAvailableTools.find(t => 
        t.function.name === 'builtin_read_file'
      );
      if (readTool) selected.push(readTool);
    }
    
    // If there are recent searches, suggest search tools
    if (context.recentActions?.includes('search')) {
      const searchTool = this.allAvailableTools.find(t => 
        t.function.name === 'builtin_exact_search'
      );
      if (searchTool) selected.push(searchTool);
    }
    
    return selected;
  }

  /**
   * Optimize tool selection for cost
   */
  private optimizeToolSelection(tools: Tool[], intent: DetectedIntent): Tool[] {
    // Prefer read-only tools when possible
    const readOnlyTools = tools.filter(t => t.readonly);
    const writeTools = tools.filter(t => !t.readonly);
    
    // If intent confidence is low, stick with read-only tools
    if (intent.confidence < 0.7 && readOnlyTools.length > 0) {
      return readOnlyTools;
    }
    
    // Use composite tools to reduce number of calls
    const compositeAlternative = this.findCompositeAlternative(tools);
    if (compositeAlternative && tools.length > 2) {
      return [compositeAlternative];
    }
    
    return tools;
  }

  /**
   * Find a composite tool that can replace multiple individual tools
   */
  private findCompositeAlternative(tools: Tool[]): Tool | null {
    const toolNames = tools.map(t => t.function.name);
    
    // Check if composite tools can cover these tools
    const compositeMatches = compositeTools.filter(ct => {
      const desc = ct.function.description?.toLowerCase() || '';
      return toolNames.some(name => desc.includes(name.replace('builtin_', '')));
    });
    
    return compositeMatches[0] || null;
  }

  /**
   * Determine execution order for selected tools
   */
  private determineExecutionOrder(
    tools: Tool[], 
    intent: DetectedIntent
  ): 'sequential' | 'parallel' | 'pipeline' {
    // Single tool - sequential
    if (tools.length <= 1) {
      return 'sequential';
    }
    
    // Check for dependencies
    const hasDependencies = this.checkDependencies(tools);
    if (hasDependencies) {
      return 'pipeline';
    }
    
    // All read-only tools can run in parallel
    if (tools.every(t => t.readonly)) {
      return 'parallel';
    }
    
    // Complex intents need pipelines
    if (intent.requiresMultipleTools) {
      return 'pipeline';
    }
    
    return 'sequential';
  }

  /**
   * Check if tools have dependencies on each other
   */
  private checkDependencies(tools: Tool[]): boolean {
    const dependencies: Record<string, string[]> = {
      'builtin_create_new_file': ['builtin_read_file'],
      'composite_smart_edit': ['builtin_read_file'],
      'builtin_refactor': ['builtin_analyze_code']
    };
    
    for (const tool of tools) {
      const deps = dependencies[tool.function.name];
      if (deps) {
        if (deps.some(dep => tools.some(t => t.function.name === dep))) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Build a pipeline for multi-tool execution
   */
  private buildPipeline(
    tools: Tool[], 
    intent: DetectedIntent, 
    context: RoutingContext
  ): PipelineBuilder {
    const pipeline = createPipeline(
      `auto-${Date.now()}`,
      `Auto-generated pipeline for: ${intent.primary}`
    );
    
    // Add tools in logical order
    const orderedTools = this.orderTools(tools, intent);
    
    for (let i = 0; i < orderedTools.length; i++) {
      const tool = orderedTools[i];
      
      // Generate args based on intent entities
      const args = this.generateToolArgs(tool, intent, context);
      
      pipeline.namedStep(
        `step-${i + 1}`,
        tool,
        (ctx) => args,
        {
          retryConfig: {
            maxRetries: 2,
            backoffMs: 1000,
            backoffMultiplier: 2
          }
        }
      );
    }
    
    return pipeline;
  }

  /**
   * Order tools based on dependencies and logic
   */
  private orderTools(tools: Tool[], intent: DetectedIntent): Tool[] {
    // Simple ordering: read-only first, then write tools
    const readOnly = tools.filter(t => t.readonly);
    const write = tools.filter(t => !t.readonly);
    
    return [...readOnly, ...write];
  }

  /**
   * Generate arguments for a tool based on intent
   */
  private generateToolArgs(
    tool: Tool, 
    intent: DetectedIntent, 
    context: RoutingContext
  ): Record<string, any> {
    const args: Record<string, any> = {};
    const params = tool.function.parameters?.properties || {};
    
    for (const [param, schema] of Object.entries(params)) {
      // Try to fill from intent entities
      if (intent.entities[param]) {
        args[param] = intent.entities[param];
      }
      // Try to fill from context
      else if (param === 'filepath' && context.currentFile) {
        args[param] = context.currentFile;
      }
      else if (param === 'query' && intent.entities.searchTerm) {
        args[param] = intent.entities.searchTerm;
      }
    }
    
    return args;
  }

  /**
   * Estimate cost of tool execution
   */
  private estimateCost(
    tools: Tool[], 
    executionOrder: string
  ): 'low' | 'medium' | 'high' {
    // Base cost on number of tools and their types
    let score = tools.length;
    
    // Write tools are more expensive
    score += tools.filter(t => !t.readonly).length * 2;
    
    // Composite tools have overhead
    score += tools.filter(t => t.function.name.startsWith('composite_')).length * 3;
    
    // Parallel execution reduces perceived cost
    if (executionOrder === 'parallel') {
      score *= 0.7;
    }
    
    if (score <= 2) return 'low';
    if (score <= 5) return 'medium';
    return 'high';
  }

  /**
   * Generate reasoning for the routing decision
   */
  private generateReasoning(
    intent: DetectedIntent,
    tools: Tool[],
    executionOrder: string
  ): string {
    const parts: string[] = [];
    
    parts.push(`Detected intent: ${intent.primary} (confidence: ${Math.round(intent.confidence * 100)}%)`);
    
    if (intent.secondary.length > 0) {
      parts.push(`Secondary intents: ${intent.secondary.join(', ')}`);
    }
    
    parts.push(`Selected ${tools.length} tool(s): ${tools.map(t => t.displayTitle).join(', ')}`);
    parts.push(`Execution strategy: ${executionOrder}`);
    
    if (intent.entities.filepath) {
      parts.push(`Target file: ${intent.entities.filepath}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Record execution for learning
   */
  private recordExecution(decision: RoutingDecision, results: ContextItem[]): void {
    this.executionHistory.push({
      timestamp: Date.now(),
      tools: decision.selectedTools.map(t => t.function.name),
      executionOrder: decision.executionOrder,
      success: results.length > 0,
      resultCount: results.length
    });
    
    // Keep only recent history
    if (this.executionHistory.length > 1000) {
      this.executionHistory.shift();
    }
  }

  /**
   * Initialize intent patterns for detection
   */
  private initializeIntentPatterns(): void {
    this.intentPatterns.set('read', {
      keywords: ['read', 'view', 'show', 'display', 'get', 'open', 'look at'],
      keywordWeights: { 'read': 2, 'view': 1.5, 'show': 1 },
      maxScore: 5,
      suggestedTools: ['builtin_read_file', 'builtin_read_currently_open_file']
    });
    
    this.intentPatterns.set('search', {
      keywords: ['search', 'find', 'look for', 'grep', 'where is', 'locate'],
      keywordWeights: { 'search': 2, 'find': 2, 'grep': 2.5 },
      maxScore: 5,
      suggestedTools: ['builtin_exact_search', 'builtin_multi_file_search']
    });
    
    this.intentPatterns.set('create', {
      keywords: ['create', 'new', 'make', 'add', 'generate', 'write'],
      keywordWeights: { 'create': 2, 'new': 1.5, 'generate': 2 },
      maxScore: 5,
      suggestedTools: ['builtin_create_new_file', 'builtin_scaffold_project'],
      antiPatterns: ['search', 'find', 'read']
    });
    
    this.intentPatterns.set('modify', {
      keywords: ['edit', 'change', 'modify', 'update', 'fix', 'refactor'],
      keywordWeights: { 'edit': 2, 'modify': 2, 'refactor': 2.5 },
      maxScore: 5,
      suggestedTools: ['composite_smart_edit', 'builtin_refactor']
    });
    
    this.intentPatterns.set('analyze', {
      keywords: ['analyze', 'check', 'review', 'inspect', 'examine', 'audit'],
      keywordWeights: { 'analyze': 2, 'review': 2, 'audit': 2 },
      maxScore: 5,
      suggestedTools: ['builtin_analyze_code', 'composite_code_review', 'composite_health_check']
    });
    
    this.intentPatterns.set('run', {
      keywords: ['run', 'execute', 'start', 'launch', 'test'],
      keywordWeights: { 'run': 2, 'execute': 2, 'test': 1.5 },
      maxScore: 5,
      suggestedTools: ['builtin_run_terminal_command']
    });
    
    this.intentPatterns.set('explore', {
      keywords: ['structure', 'tree', 'directory', 'folder', 'navigate', 'browse'],
      keywordWeights: { 'structure': 2, 'tree': 2, 'directory': 1.5 },
      maxScore: 5,
      suggestedTools: ['builtin_view_repo_map', 'builtin_view_subdirectory']
    });
    
    this.intentPatterns.set('debug', {
      keywords: ['bug', 'error', 'issue', 'problem', 'debug', 'investigate', 'troubleshoot'],
      keywordWeights: { 'bug': 2, 'debug': 2, 'investigate': 2 },
      maxScore: 5,
      suggestedTools: ['composite_investigate_bug', 'builtin_view_diff']
    });
    
    this.intentPatterns.set('document', {
      keywords: ['document', 'doc', 'explain', 'describe', 'readme'],
      keywordWeights: { 'document': 2, 'explain': 1.5, 'readme': 2 },
      maxScore: 5,
      suggestedTools: ['builtin_generate_docs', 'builtin_explain_code']
    });
    
    this.intentPatterns.set('learn', {
      keywords: ['learn', 'understand', 'how does', 'what is', 'explain'],
      keywordWeights: { 'learn': 2, 'understand': 2, 'explain': 1.5 },
      maxScore: 5,
      suggestedTools: ['composite_learn_codebase', 'builtin_explain_code']
    });
  }

  /**
   * Get all available tools
   */
  getAllTools(): Tool[] {
    return [...this.allAvailableTools];
  }

  /**
   * Get execution history
   */
  getHistory(): ExecutionRecord[] {
    return [...this.executionHistory];
  }
}

/**
 * Intent pattern definition
 */
interface IntentPattern {
  keywords: string[];
  keywordWeights?: Record<string, number>;
  maxScore: number;
  suggestedTools: string[];
  antiPatterns?: string[];
}

/**
 * Routing context
 */
interface RoutingContext {
  currentFile?: string;
  recentActions?: string[];
  workspaceInfo?: any;
  optimizeCost?: boolean;
}

/**
 * Execution record for learning
 */
interface ExecutionRecord {
  timestamp: number;
  tools: string[];
  executionOrder: string;
  success: boolean;
  resultCount: number;
}

/**
 * Convenience function to route and execute
 */
export async function smartExecute(
  request: string,
  extras: ToolExtras,
  context?: RoutingContext
): Promise<{ results: ContextItem[]; decision: RoutingDecision }> {
  const router = SmartToolRouter.getInstance();
  const decision = await router.route(request, context || {});
  const results = await router.execute(decision, extras);
  return { results, decision };
}
