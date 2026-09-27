/**
 * Relevance Engine — multi-dimensional relevance scoring.
 *
 * Combines syntactic, semantic, structural, and behavioral signals
 * to rank search results and select tools/strategies.
 */

import { Tool } from "../..";
import { ToolResult } from "./types";

/**
 * Relevance score with breakdown
 */
export interface RelevanceScore {
  total: number; // 0-1
  breakdown: {
    syntactic: number; // Keyword and pattern matching
    semantic: number; // Conceptual similarity
    structural: number; // Code structure awareness
    behavioral: number; // Based on past success
    contextual: number; // Current context relevance
  };
  confidence: number; // Confidence in the score
  reasoning: string[]; // Human-readable reasons for the score
}

/**
 * Query analysis result
 */
export interface QueryAnalysis {
  intent: {
    primary: string;
    secondary: string[];
    entities: Map<string, string>;
    modifiers: Set<string>; // e.g., "all", "recent", "changed"
  };
  complexity: 'simple' | 'moderate' | 'complex';
  scope: 'file' | 'directory' | 'project' | 'global';
  requiresMultipleSteps: boolean;
  suggestedStrategies: SearchStrategy[];
  estimatedResults: number;
}

/**
 * Search strategy
 */
export interface SearchStrategy {
  name: string;
  tools: string[];
  priority: number;
  costEstimate: 'low' | 'medium' | 'high';
  expectedAccuracy: number; // 0-1
}

/**
 * Learning data point
 */
interface LearningDataPoint {
  query: string;
  toolsUsed: string[];
  success: boolean;
  executionTime: number;
  userFeedback?: 'positive' | 'negative' | 'neutral';
  timestamp: number;
}

/**
 * Relevance Engine
 */
export class RelevanceEngine {
  private static instance: RelevanceEngine;
  private learningData: LearningDataPoint[] = [];
  private toolSuccessRates: Map<string, { success: number; total: number }> = new Map();
  private queryPatterns: Map<string, Set<string>> = new Map(); // Intent -> Tool names
  private contextWeights: Map<string, number> = new Map();

  private constructor() {
    this.initializeWeights();
  }

  public static getInstance(): RelevanceEngine {
    if (!RelevanceEngine.instance) {
      RelevanceEngine.instance = new RelevanceEngine();
    }
    return RelevanceEngine.instance;
  }

  /**
   * Initialize default context weights
   */
  private initializeWeights(): void {
    // These weights can be adjusted based on learning
    this.contextWeights.set('syntactic', 0.25);
    this.contextWeights.set('semantic', 0.30);
    this.contextWeights.set('structural', 0.20);
    this.contextWeights.set('behavioral', 0.15);
    this.contextWeights.set('contextual', 0.10);
  }

  /**
   * Analyze a query to understand intent and requirements
   */
  analyzeQuery(query: string, context: QueryContext): QueryAnalysis {
    const intent = this.extractIntent(query);
    const complexity = this.assessComplexity(query, intent);
    const scope = this.determineScope(query, context);
    const requiresMultipleSteps = this.detectMultiStep(query, intent);
    const suggestedStrategies = this.suggestStrategies(query, intent, complexity);
    const estimatedResults = this.estimateResultCount(query, scope);

    return {
      intent,
      complexity,
      scope,
      requiresMultipleSteps,
      suggestedStrategies,
      estimatedResults,
    };
  }

  /**
   * Score the relevance of a tool for a given query
   */
  scoreToolRelevance(
    tool: Tool,
    query: string,
    context: QueryContext,
    analysis: QueryAnalysis
  ): RelevanceScore {
    const reasoning: string[] = [];
    
    // 1. Syntactic relevance - keyword and pattern matching
    const syntactic = this.scoreSyntactic(tool, query, analysis, reasoning);
    
    // 2. Semantic relevance - conceptual understanding
    const semantic = this.scoreSemantic(tool, query, analysis, reasoning);
    
    // 3. Structural relevance - code structure awareness
    const structural = this.scoreStructural(tool, context, reasoning);
    
    // 4. Behavioral relevance - based on past success
    const behavioral = this.scoreBehavioral(tool, query, analysis, reasoning);
    
    // 5. Contextual relevance - current context fit
    const contextual = this.scoreContextual(tool, context, reasoning);

    // Calculate weighted total
    const total = 
      syntactic * this.contextWeights.get('syntactic')! +
      semantic * this.contextWeights.get('semantic')! +
      structural * this.contextWeights.get('structural')! +
      behavioral * this.contextWeights.get('behavioral')! +
      contextual * this.contextWeights.get('contextual')!;

    // Calculate confidence based on agreement between signals
    const signals = [syntactic, semantic, structural, behavioral, contextual];
    const variance = this.calculateVariance(signals);
    const confidence = Math.max(0, 1 - variance);

    return {
      total,
      breakdown: {
        syntactic,
        semantic,
        structural,
        behavioral,
        contextual,
      },
      confidence,
      reasoning,
    };
  }

  /**
   * Rank tools by relevance
   */
  rankTools(
    tools: Tool[],
    query: string,
    context: QueryContext
  ): Array<{ tool: Tool; score: RelevanceScore }> {
    const analysis = this.analyzeQuery(query, context);
    
    const scored = tools.map(tool => ({
      tool,
      score: this.scoreToolRelevance(tool, query, context, analysis),
    }));

    // Sort by total score (descending), then by confidence
    return scored.sort((a, b) => {
      if (Math.abs(a.score.total - b.score.total) > 0.05) {
        return b.score.total - a.score.total;
      }
      return b.score.confidence - a.score.confidence;
    });
  }

  /**
   * Record execution outcome for learning
   */
  recordExecution(
    query: string,
    toolsUsed: string[],
    result: ToolResult,
    userFeedback?: 'positive' | 'negative' | 'neutral'
  ): void {
    const dataPoint: LearningDataPoint = {
      query,
      toolsUsed,
      success: result.success,
      executionTime: result.executionTime,
      userFeedback,
      timestamp: Date.now(),
    };

    this.learningData.push(dataPoint);

    // Update success rates
    for (const toolName of toolsUsed) {
      const stats = this.toolSuccessRates.get(toolName) || { success: 0, total: 0 };
      stats.total++;
      if (result.success) stats.success++;
      this.toolSuccessRates.set(toolName, stats);
    }

    // Update query patterns
    const intent = this.extractIntent(query);
    const intentKey = intent.primary;
    if (!this.queryPatterns.has(intentKey)) {
      this.queryPatterns.set(intentKey, new Set());
    }
    toolsUsed.forEach(tool => this.queryPatterns.get(intentKey)!.add(tool));

    // Adapt weights based on feedback
    if (userFeedback === 'positive' || (result.success && result.executionTime < 1000)) {
      this.adaptWeights(dataPoint);
    }

    // Prune old data (keep last 1000 entries)
    if (this.learningData.length > 1000) {
      this.learningData = this.learningData.slice(-1000);
    }
  }

  // ===== PRIVATE SCORING METHODS =====

  private scoreSyntactic(
    tool: Tool,
    query: string,
    analysis: QueryAnalysis,
    reasoning: string[]
  ): number {
    let score = 0;
    const toolName = tool.function.name.toLowerCase();
    const toolDesc = (tool.function.description || '').toLowerCase();
    const queryLower = query.toLowerCase();

    // Direct tool name match
    if (queryLower.includes(toolName.replace('builtin_', '').replace(/_/g, ' '))) {
      score += 0.4;
      reasoning.push('Tool name matches query');
    }

    // Intent-based keywords
    const intentKeywords = this.getIntentKeywords(analysis.intent.primary);
    for (const keyword of intentKeywords) {
      if (toolDesc.includes(keyword)) {
        score += 0.15;
        reasoning.push(`Keyword "${keyword}" in tool description`);
      }
    }

    // Entity matches
    for (const [entityType, entityValue] of analysis.intent.entities) {
      if (this.toolHandlesEntity(tool, entityType, entityValue)) {
        score += 0.2;
        reasoning.push(`Handles ${entityType}: ${entityValue}`);
      }
    }

    // Modifier compatibility
    for (const modifier of analysis.intent.modifiers) {
      if (this.toolSupportsModifier(tool, modifier)) {
        score += 0.1;
      }
    }

    return Math.min(score, 1.0);
  }

  private scoreSemantic(
    tool: Tool,
    query: string,
    analysis: QueryAnalysis,
    reasoning: string[]
  ): number {
    let score = 0;

    // Intent alignment
    const intentScore = this.scoreIntentAlignment(tool, analysis.intent.primary);
    score += intentScore * 0.5;
    if (intentScore > 0.7) {
      reasoning.push(`Strong intent alignment (${analysis.intent.primary})`);
    }

    // Concept mapping (rule-based semantic understanding)
    const conceptScore = this.scoreConceptAlignment(tool, query, analysis);
    score += conceptScore * 0.3;

    // Task decomposition fit
    if (analysis.requiresMultipleSteps && this.isCompositeCapable(tool)) {
      score += 0.2;
      reasoning.push('Composite tool for multi-step task');
    }

    return Math.min(score, 1.0);
  }

  private scoreStructural(
    tool: Tool,
    context: QueryContext,
    reasoning: string[]
  ): number {
    let score = 0;

    // File type compatibility
    if (context.fileType && this.toolSupportsFileType(tool, context.fileType)) {
      score += 0.3;
      reasoning.push(`Supports ${context.fileType} files`);
    }

    // Scope appropriateness
    const scopeScore = this.scoreScopeMatch(tool, context.scope || 'project');
    score += scopeScore * 0.4;

    // Repository structure awareness
    if (context.repoStructure && this.toolAwareOfStructure(tool)) {
      score += 0.3;
      reasoning.push('Structure-aware tool');
    }

    return Math.min(score, 1.0);
  }

  private scoreBehavioral(
    tool: Tool,
    query: string,
    analysis: QueryAnalysis,
    reasoning: string[]
  ): number {
    let score = 0;
    const toolName = tool.function.name;

    // Historical success rate
    const stats = this.toolSuccessRates.get(toolName);
    if (stats && stats.total > 5) {
      const successRate = stats.success / stats.total;
      score += successRate * 0.5;
      if (successRate > 0.8) {
        reasoning.push(`High success rate (${(successRate * 100).toFixed(0)}%)`);
      }
    }

    // Pattern matching from history
    const intentKey = analysis.intent.primary;
    const historicalTools = this.queryPatterns.get(intentKey);
    if (historicalTools && historicalTools.has(toolName)) {
      score += 0.3;
      reasoning.push('Used successfully for similar queries');
    }

    // Recent usage boost (recency bias)
    const recentUsage = this.learningData
      .slice(-50)
      .filter(d => d.toolsUsed.includes(toolName) && d.success);
    if (recentUsage.length > 5) {
      score += 0.2;
      reasoning.push('Recently successful');
    }

    return Math.min(score, 1.0);
  }

  private scoreContextual(
    tool: Tool,
    context: QueryContext,
    reasoning: string[]
  ): number {
    let score = 0;

    // Time-based relevance
    if (context.timeConstraint === 'fast' && this.isFastTool(tool)) {
      score += 0.3;
      reasoning.push('Fast execution tool');
    }

    // Cost awareness
    if (context.costConstraint === 'low' && tool.readonly) {
      score += 0.2;
      reasoning.push('Low-cost read-only tool');
    }

    // Current workspace state
    if (context.hasUnsavedChanges && tool.readonly) {
      score += 0.2;
      reasoning.push('Safe for unsaved changes');
    }

    // Available resources
    if (context.availableResources && this.toolFitsResources(tool, context.availableResources)) {
      score += 0.3;
    }

    return Math.min(score, 1.0);
  }

  // ===== HELPER METHODS =====

  private extractIntent(query: string): QueryAnalysis['intent'] {
    const queryLower = query.toLowerCase();
    const entities = new Map<string, string>();
    const modifiers = new Set<string>();

    // Extract file paths
    const fileMatch = query.match(/['"`]([^'"`]+\.[a-zA-Z]+)['"`]|(\S+\.(ts|js|tsx|jsx|py|java|cpp|rs))/);
    if (fileMatch) {
      entities.set('filepath', fileMatch[1] || fileMatch[2]);
    }

    // Extract search terms
    const searchMatch = query.match(/(?:search|find|look for|grep)\s+['"`]?([^'"`\n]+?)['"`]?(?:\s|$)/i);
    if (searchMatch) {
      entities.set('searchTerm', searchMatch[1].trim());
    }

    // Extract modifiers
    const modifierPatterns = ['all', 'recent', 'changed', 'modified', 'new', 'deleted', 'recursive'];
    for (const mod of modifierPatterns) {
      if (queryLower.includes(mod)) {
        modifiers.add(mod);
      }
    }

    // Determine primary intent
    let primary = 'unknown';
    const secondary: string[] = [];

    if (/\b(read|view|show|display|open|cat)\b/.test(queryLower)) {
      primary = 'read';
    } else if (/\b(search|find|look|grep|locate)\b/.test(queryLower)) {
      primary = 'search';
    } else if (/\b(create|write|add|insert|new)\b/.test(queryLower)) {
      primary = 'create';
    } else if (/\b(edit|modify|change|update|refactor)\b/.test(queryLower)) {
      primary = 'modify';
    } else if (/\b(delete|remove|rm)\b/.test(queryLower)) {
      primary = 'delete';
    } else if (/\b(run|execute|compile|build|test)\b/.test(queryLower)) {
      primary = 'execute';
    } else if (/\b(analyze|inspect|review|check)\b/.test(queryLower)) {
      primary = 'analyze';
    }

    // Detect secondary intents
    if (queryLower.includes(' and ') || queryLower.includes(' then ')) {
      const parts = queryLower.split(/\s+and\s+|\s+then\s+/);
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (/\b(search|find)\b/.test(part)) secondary.push('search');
        if (/\b(modify|edit)\b/.test(part)) secondary.push('modify');
      }
    }

    return { primary, secondary, entities, modifiers };
  }

  private assessComplexity(query: string, intent: QueryAnalysis['intent']): 'simple' | 'moderate' | 'complex' {
    let complexity = 0;

    // Length factor
    if (query.length > 100) complexity++;
    if (query.length > 200) complexity++;

    // Multiple entities
    if (intent.entities.size > 2) complexity++;

    // Multiple intents
    if (intent.secondary.length > 0) complexity += 2;

    // Conditional logic
    if (/\b(if|when|unless|where)\b/.test(query.toLowerCase())) complexity++;

    // Nested operations
    if (/\b(and then|after|before|followed by)\b/.test(query.toLowerCase())) complexity++;

    if (complexity === 0) return 'simple';
    if (complexity <= 2) return 'moderate';
    return 'complex';
  }

  private determineScope(query: string, context: QueryContext): 'file' | 'directory' | 'project' | 'global' {
    if (context.currentFile && /\b(this|current|here)\s+file\b/i.test(query)) {
      return 'file';
    }
    if (/\b(directory|folder|dir)\b/i.test(query)) {
      return 'directory';
    }
    if (/\b(everywhere|all|entire|whole|global)\b/i.test(query)) {
      return 'global';
    }
    return 'project'; // Default
  }

  private detectMultiStep(query: string, intent: QueryAnalysis['intent']): boolean {
    // Multiple intents indicate multi-step
    if (intent.secondary.length > 0) return true;

    // Sequential indicators
    if (/\b(and then|after|before|followed by|first|then|finally)\b/.test(query.toLowerCase())) {
      return true;
    }

    // Conditional logic often requires multiple steps
    if (/\b(if|when|unless)\b/.test(query.toLowerCase())) {
      return true;
    }

    return false;
  }

  private suggestStrategies(
    query: string,
    intent: QueryAnalysis['intent'],
    complexity: 'simple' | 'moderate' | 'complex'
  ): SearchStrategy[] {
    const strategies: SearchStrategy[] = [];

    // For search intents
    if (intent.primary === 'search') {
      strategies.push({
        name: 'exact_match',
        tools: ['builtin_exact_search'],
        priority: 1,
        costEstimate: 'low',
        expectedAccuracy: 0.9,
      });

      strategies.push({
        name: 'multi_file_search',
        tools: ['builtin_multi_file_search', 'builtin_exact_search'],
        priority: 2,
        costEstimate: 'medium',
        expectedAccuracy: 0.85,
      });

      if (complexity === 'complex') {
        strategies.push({
          name: 'comprehensive_search',
          tools: ['builtin_multi_file_search', 'builtin_analyze_code', 'builtin_exact_search'],
          priority: 3,
          costEstimate: 'high',
          expectedAccuracy: 0.95,
        });
      }
    }

    // For read intents
    if (intent.primary === 'read') {
      strategies.push({
        name: 'direct_read',
        tools: ['builtin_read_file'],
        priority: 1,
        costEstimate: 'low',
        expectedAccuracy: 1.0,
      });
    }

    // For analyze intents
    if (intent.primary === 'analyze') {
      strategies.push({
        name: 'code_analysis',
        tools: ['builtin_analyze_code', 'builtin_read_file'],
        priority: 1,
        costEstimate: 'medium',
        expectedAccuracy: 0.85,
      });
    }

    return strategies;
  }

  private estimateResultCount(query: string, scope: 'file' | 'directory' | 'project' | 'global'): number {
    const baseEstimates = {
      file: 10,
      directory: 50,
      project: 200,
      global: 1000,
    };

    let estimate = baseEstimates[scope];

    // Adjust for specificity
    if (/\b(specific|exact|precise)\b/i.test(query)) {
      estimate *= 0.3;
    }
    if (/\b(all|every|entire)\b/i.test(query)) {
      estimate *= 2;
    }

    return Math.round(estimate);
  }

  private getIntentKeywords(intent: string): string[] {
    const keywordMap: Record<string, string[]> = {
      read: ['read', 'view', 'show', 'display', 'get', 'fetch'],
      search: ['search', 'find', 'locate', 'grep', 'match', 'filter'],
      create: ['create', 'new', 'add', 'insert', 'write', 'generate'],
      modify: ['modify', 'edit', 'change', 'update', 'alter', 'refactor'],
      delete: ['delete', 'remove', 'clear', 'clean'],
      execute: ['run', 'execute', 'compile', 'build', 'test', 'launch'],
      analyze: ['analyze', 'inspect', 'review', 'check', 'examine', 'investigate'],
    };

    return keywordMap[intent] || [];
  }

  private toolHandlesEntity(tool: Tool, entityType: string, entityValue: string): boolean {
    const params = tool.function.parameters?.properties || {};

    if (entityType === 'filepath' && ('filepath' in params || 'path' in params || 'file' in params)) {
      return true;
    }
    if (entityType === 'searchTerm' && ('query' in params || 'search' in params || 'term' in params)) {
      return true;
    }

    return false;
  }

  private toolSupportsModifier(tool: Tool, modifier: string): boolean {
    const desc = (tool.function.description || '').toLowerCase();
    return desc.includes(modifier);
  }

  private scoreIntentAlignment(tool: Tool, intent: string): number {
    const toolName = tool.function.name.toLowerCase();
    const toolDesc = (tool.function.description || '').toLowerCase();

    const intentMap: Record<string, string[]> = {
      read: ['read', 'view', 'get'],
      search: ['search', 'find', 'grep'],
      create: ['create', 'new', 'write'],
      modify: ['edit', 'modify', 'refactor'],
      analyze: ['analyze', 'inspect'],
    };

    const keywords = intentMap[intent] || [];
    let score = 0;

    for (const keyword of keywords) {
      if (toolName.includes(keyword)) score += 0.5;
      if (toolDesc.includes(keyword)) score += 0.3;
    }

    return Math.min(score, 1.0);
  }

  private scoreConceptAlignment(tool: Tool, query: string, analysis: QueryAnalysis): number {
    // Rule-based semantic understanding
    const queryLower = query.toLowerCase();
    const toolDesc = (tool.function.description || '').toLowerCase();

    let score = 0;

    // Concept clusters
    const conceptClusters = [
      ['search', 'find', 'locate', 'discover', 'lookup'],
      ['read', 'view', 'show', 'display', 'get', 'fetch'],
      ['modify', 'edit', 'change', 'update', 'alter', 'transform'],
      ['create', 'generate', 'make', 'build', 'construct', 'add'],
      ['analyze', 'inspect', 'examine', 'review', 'investigate', 'explore'],
    ];

    for (const cluster of conceptClusters) {
      const queryHas = cluster.some(c => queryLower.includes(c));
      const toolHas = cluster.some(c => toolDesc.includes(c));
      if (queryHas && toolHas) {
        score += 0.3;
      }
    }

    return Math.min(score, 1.0);
  }

  private isCompositeCapable(tool: Tool): boolean {
    return tool.group === 'Composite' || tool.function.name.startsWith('composite_');
  }

  private toolSupportsFileType(tool: Tool, fileType: string): boolean {
    const desc = (tool.function.description || '').toLowerCase();
    const params = tool.function.parameters?.properties || {};

    // Check if tool mentions file type
    if (desc.includes(fileType)) return true;

    // Check if tool has file type parameter
    if ('fileType' in params) return true;

    return false;
  }

  private scoreScopeMatch(tool: Tool, scope: string): number {
    const toolName = tool.function.name.toLowerCase();
    const toolDesc = (tool.function.description || '').toLowerCase();

    if (scope === 'file' && (toolName.includes('file') || toolName.includes('read'))) {
      return 1.0;
    }
    if (scope === 'directory' && (toolName.includes('directory') || toolName.includes('subdirectory'))) {
      return 1.0;
    }
    if (scope === 'project' && (toolName.includes('search') || toolName.includes('repo'))) {
      return 0.8;
    }

    return 0.5; // Default moderate match
  }

  private toolAwareOfStructure(tool: Tool): boolean {
    const structureAwareTools = [
      'builtin_view_repo_map',
      'builtin_view_subdirectory',
      'builtin_analyze_code',
      'builtin_multi_file_search',
    ];

    return structureAwareTools.includes(tool.function.name);
  }

  private isFastTool(tool: Tool): boolean {
    // Read-only tools are generally fast
    if (tool.readonly) return true;

    // Specific fast tools
    const fastTools = ['builtin_read_file', 'builtin_view_diff'];
    return fastTools.includes(tool.function.name);
  }

  private toolFitsResources(tool: Tool, resources: QueryContext['availableResources']): boolean {
    if (!resources) return true;

    // Check memory constraints
    const heavyTools = ['builtin_multi_file_search', 'builtin_analyze_code'];
    if (resources.memory === 'low' && heavyTools.includes(tool.function.name)) {
      return false;
    }

    return true;
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return variance;
  }

  private adaptWeights(dataPoint: LearningDataPoint): void {
    // Simple adaptive learning - adjust weights based on success
    // In a real implementation, this could use more sophisticated ML
    const learningRate = 0.01;

    // If execution was fast and successful, slightly increase behavioral weight
    if (dataPoint.success && dataPoint.executionTime < 500) {
      const current = this.contextWeights.get('behavioral')!;
      this.contextWeights.set('behavioral', Math.min(current + learningRate, 0.3));
    }
  }
}

/**
 * Query context
 */
export interface QueryContext {
  currentFile?: string;
  fileType?: string;
  scope?: 'file' | 'directory' | 'project' | 'global';
  repoStructure?: any;
  hasUnsavedChanges?: boolean;
  timeConstraint?: 'fast' | 'normal' | 'thorough';
  costConstraint?: 'low' | 'medium' | 'high';
  availableResources?: {
    memory: 'low' | 'medium' | 'high';
    cpu: 'low' | 'medium' | 'high';
  };
  recentActions?: string[];
  userPreferences?: {
    preferredTools?: string[];
    excludedTools?: string[];
  };
}
