/**
 * Multi-Strategy Search Engine
 *
 * Orchestrates ripgrep, fuzzy, structural, and rule-based semantic search
 * in parallel with intelligent result fusion.
 */

import { ContextItem, Tool, ToolExtras } from "../..";
import { ToolExecutor } from "./ToolExecutor";
import { RelevanceEngine, QueryContext, QueryAnalysis } from "./RelevanceEngine";
import { ToolResult } from "./types";

/**
 * Search result with metadata
 */
export interface SearchResult {
  content: ContextItem;
  relevanceScore: number;
  strategy: string;
  matchType: 'exact' | 'fuzzy' | 'semantic' | 'structural';
  confidence: number;
  metadata: {
    sourceFile?: string;
    lineNumber?: number;
    context?: string[];
    matchedTerms?: string[];
    relatedResults?: string[];
    [key: string]: any; // Allow additional dynamic properties
  };
}

/**
 * Strategy execution result
 */
interface StrategyResult {
  strategy: string;
  results: SearchResult[];
  executionTime: number;
  success: boolean;
  error?: Error;
}

/**
 * Search configuration
 */
export interface SearchConfig {
  maxResults?: number;
  minConfidence?: number;
  strategies?: string[]; // Specific strategies to use
  parallelExecution?: boolean;
  progressiveRefinement?: boolean;
  contextLines?: number;
  includeFuzzy?: boolean;
  includeStructural?: boolean;
  timeoutMs?: number;
}

/**
 * Multi-Strategy Search Engine
 */
export class MultiStrategySearch {
  private static instance: MultiStrategySearch;
  private relevanceEngine: RelevanceEngine;
  private executor: ToolExecutor;
  
  // Strategy definitions
  private strategies: Map<string, SearchStrategyDefinition> = new Map();

  private constructor() {
    this.relevanceEngine = RelevanceEngine.getInstance();
    this.executor = ToolExecutor.getInstance();
    this.initializeStrategies();
  }

  public static getInstance(): MultiStrategySearch {
    if (!MultiStrategySearch.instance) {
      MultiStrategySearch.instance = new MultiStrategySearch();
    }
    return MultiStrategySearch.instance;
  }

  /**
   * Main search method - orchestrates all strategies
   */
  async search(
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig = {}
  ): Promise<SearchResult[]> {
    // Step 1: Analyze query
    const analysis = this.relevanceEngine.analyzeQuery(query, context);

    // Step 2: Select strategies
    const selectedStrategies = this.selectStrategies(analysis, config);

    // Step 3: Execute strategies
    const strategyResults = await this.executeStrategies(
      query,
      selectedStrategies,
      context,
      extras,
      config
    );

    // Step 4: Fuse results
    const fusedResults = this.fuseResults(strategyResults, analysis, context);

    // Step 5: Rank and filter
    const rankedResults = this.rankResults(fusedResults, query, analysis, context);

    // Step 6: Apply post-processing
    const finalResults = this.postProcess(
      rankedResults,
      config.maxResults || 50,
      config.minConfidence || 0.3
    );

    // Step 7: Progressive refinement if enabled
    if (config.progressiveRefinement && finalResults.length < (config.maxResults || 50) / 2) {
      const refinedResults = await this.refineSearch(
        query,
        finalResults,
        analysis,
        context,
        extras,
        config
      );
      return this.deduplicateResults([...finalResults, ...refinedResults]);
    }

    return finalResults;
  }

  /**
   * Exact match search strategy
   */
  private async exactMatchStrategy(
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      // Use exact search tool
      const searchArgs = {
        query,
        contextLines: config.contextLines || 2,
        maxResults: config.maxResults || 50,
      };

      const contextItems = await extras.ide.getSearchResults(query, searchArgs);
      
      // Parse and structure results
      const lines = contextItems.split('\n');
      let currentFile = '';
      let currentMatches: string[] = [];

      for (const line of lines) {
        if (line.startsWith('./') || line.startsWith('.\\')) {
          if (currentFile && currentMatches.length > 0) {
            results.push({
              content: {
                name: currentFile,
                description: `Exact matches for "${query}"`,
                content: currentMatches.join('\n'),
              },
              relevanceScore: 1.0,
              strategy: 'exact_match',
              matchType: 'exact',
              confidence: 0.95,
              metadata: {
                sourceFile: currentFile,
                matchedTerms: [query],
              },
            });
          }
          currentFile = line.trim();
          currentMatches = [];
        } else if (line.trim()) {
          currentMatches.push(line);
        }
      }

      // Add last file
      if (currentFile && currentMatches.length > 0) {
        results.push({
          content: {
            name: currentFile,
            description: `Exact matches for "${query}"`,
            content: currentMatches.join('\n'),
          },
          relevanceScore: 1.0,
          strategy: 'exact_match',
          matchType: 'exact',
          confidence: 0.95,
          metadata: {
            sourceFile: currentFile,
            matchedTerms: [query],
          },
        });
      }
    } catch (error) {
      console.error('Exact match strategy failed:', error);
    }

    return results;
  }

  /**
   * Fuzzy search strategy - finds approximate matches
   */
  private async fuzzySearchStrategy(
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!config.includeFuzzy) {
      return results;
    }

    try {
      // Generate fuzzy variations of the query
      const fuzzyQueries = this.generateFuzzyVariations(query);

      // Execute searches for each variation
      for (const fuzzyQuery of fuzzyQueries) {
        const searchArgs = {
          query: fuzzyQuery,
          contextLines: config.contextLines || 2,
          maxResults: Math.floor((config.maxResults || 50) / fuzzyQueries.length),
        };

        try {
          const contextItems = await extras.ide.getSearchResults(fuzzyQuery, searchArgs);
          
          // Parse results
          const parsed = this.parseSearchResults(contextItems, fuzzyQuery);
          
          // Add fuzzy results with lower confidence
          for (const item of parsed) {
            results.push({
              ...item,
              relevanceScore: item.relevanceScore * 0.8, // Lower score for fuzzy
              strategy: 'fuzzy_search',
              matchType: 'fuzzy',
              confidence: 0.7,
            });
          }
        } catch (error) {
          // Continue with other variations
          console.warn(`Fuzzy search failed for "${fuzzyQuery}":`, error);
        }
      }
    } catch (error) {
      console.error('Fuzzy search strategy failed:', error);
    }

    return results;
  }

  /**
   * Structural search strategy - searches based on code structure
   */
  private async structuralSearchStrategy(
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!config.includeStructural) {
      return results;
    }

    try {
      // Detect structural patterns in query
      const structuralPattern = this.detectStructuralPattern(query);

      if (structuralPattern) {
        // Search for structural patterns
        const searchArgs = {
          query: structuralPattern.pattern,
          contextLines: config.contextLines || 3,
          maxResults: config.maxResults || 50,
        };

        const contextItems = await extras.ide.getSearchResults(
          structuralPattern.pattern,
          searchArgs
        );

        const parsed = this.parseSearchResults(contextItems, query);

        // Add structural results
        for (const item of parsed) {
          results.push({
            ...item,
            relevanceScore: item.relevanceScore * 0.9,
            strategy: 'structural_search',
            matchType: 'structural',
            confidence: 0.85,
            metadata: {
              ...item.metadata,
              structureType: structuralPattern.type,
            },
          });
        }
      }
    } catch (error) {
      console.error('Structural search strategy failed:', error);
    }

    return results;
  }

  /**
   * Semantic search strategy — rule-based synonym and concept expansion
   */
  private async semanticSearchStrategy(
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      // Generate semantic variations using synonym expansion and concept mapping
      const semanticQueries = this.generateSemanticVariations(query);

      // Execute searches with semantic queries
      const allResults: SearchResult[] = [];

      for (const { variation, weight } of semanticQueries) {
        const searchArgs = {
          query: variation,
          contextLines: config.contextLines || 2,
          maxResults: Math.floor((config.maxResults || 50) / semanticQueries.length),
        };

        try {
          const contextItems = await extras.ide.getSearchResults(variation, searchArgs);
          const parsed = this.parseSearchResults(contextItems, variation);

          for (const item of parsed) {
            allResults.push({
              ...item,
              relevanceScore: item.relevanceScore * weight,
              strategy: 'semantic_search',
              matchType: 'semantic',
              confidence: 0.75 * weight,
            });
          }
        } catch (error) {
          console.warn(`Semantic search failed for "${variation}":`, error);
        }
      }

      results.push(...allResults);
    } catch (error) {
      console.error('Semantic search strategy failed:', error);
    }

    return results;
  }

  /**
   * Context-aware search - uses surrounding context
   */
  private async contextAwareStrategy(
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      // Use context to refine search
      let enhancedQuery = query;

      if (context.currentFile) {
        // Add file type context
        const fileType = context.fileType || this.extractFileType(context.currentFile);
        if (fileType) {
          enhancedQuery = `${query} (in ${fileType} files)`;
        }
      }

      // Execute context-enhanced search
      const searchArgs = {
        query,
        fileType: context.fileType,
        contextLines: config.contextLines || 3,
        maxResults: config.maxResults || 50,
      };

      const contextItems = await extras.ide.getSearchResults(query, searchArgs);
      const parsed = this.parseSearchResults(contextItems, query);

      for (const item of parsed) {
        results.push({
          ...item,
          relevanceScore: item.relevanceScore * 1.1, // Boost for context relevance
          strategy: 'context_aware',
          matchType: 'exact',
          confidence: 0.88,
        });
      }
    } catch (error) {
      console.error('Context-aware strategy failed:', error);
    }

    return results;
  }

  // ===== HELPER METHODS =====

  private initializeStrategies(): void {
    this.strategies.set('exact_match', {
      name: 'exact_match',
      priority: 1,
      executor: this.exactMatchStrategy.bind(this),
      cost: 'low',
      expectedAccuracy: 0.95,
    });

    this.strategies.set('fuzzy_search', {
      name: 'fuzzy_search',
      priority: 2,
      executor: this.fuzzySearchStrategy.bind(this),
      cost: 'medium',
      expectedAccuracy: 0.75,
    });

    this.strategies.set('structural_search', {
      name: 'structural_search',
      priority: 3,
      executor: this.structuralSearchStrategy.bind(this),
      cost: 'medium',
      expectedAccuracy: 0.85,
    });

    this.strategies.set('semantic_search', {
      name: 'semantic_search',
      priority: 4,
      executor: this.semanticSearchStrategy.bind(this),
      cost: 'medium',
      expectedAccuracy: 0.80,
    });

    this.strategies.set('context_aware', {
      name: 'context_aware',
      priority: 5,
      executor: this.contextAwareStrategy.bind(this),
      cost: 'low',
      expectedAccuracy: 0.88,
    });
  }

  private selectStrategies(analysis: QueryAnalysis, config: SearchConfig): string[] {
    if (config.strategies && config.strategies.length > 0) {
      return config.strategies;
    }

    const strategies: string[] = ['exact_match']; // Always include exact match

    // Add fuzzy for complex queries or when explicitly enabled
    if (config.includeFuzzy || analysis.complexity !== 'simple') {
      strategies.push('fuzzy_search');
    }

    // Add structural for code-related queries
    if (this.isCodeStructureQuery(analysis)) {
      strategies.push('structural_search');
    }

    // Add semantic for conceptual queries
    if (analysis.complexity === 'complex' || analysis.intent.secondary.length > 0) {
      strategies.push('semantic_search');
    }

    // Always add context-aware if context is available
    strategies.push('context_aware');

    return strategies;
  }

  private async executeStrategies(
    query: string,
    strategies: string[],
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<StrategyResult[]> {
    const results: StrategyResult[] = [];

    if (config.parallelExecution !== false) {
      // Execute strategies in parallel
      const promises = strategies.map(async (strategyName) => {
        const strategy = this.strategies.get(strategyName);
        if (!strategy) return null;

        const startTime = Date.now();
        try {
          const searchResults = await Promise.race([
            strategy.executor(query, context, extras, config),
            this.timeout(config.timeoutMs || 10000),
          ]);

          return {
            strategy: strategyName,
            results: searchResults as SearchResult[],
            executionTime: Date.now() - startTime,
            success: true,
          };
        } catch (error) {
          return {
            strategy: strategyName,
            results: [],
            executionTime: Date.now() - startTime,
            success: false,
            error: error as Error,
          };
        }
      });

      const settled = await Promise.all(promises);
      results.push(...settled.filter((r): r is NonNullable<typeof r> => r !== null));
    } else {
      // Execute strategies sequentially
      for (const strategyName of strategies) {
        const strategy = this.strategies.get(strategyName);
        if (!strategy) continue;

        const startTime = Date.now();
        try {
          const searchResults = await strategy.executor(query, context, extras, config);
          results.push({
            strategy: strategyName,
            results: searchResults,
            executionTime: Date.now() - startTime,
            success: true,
          });
        } catch (error) {
          results.push({
            strategy: strategyName,
            results: [],
            executionTime: Date.now() - startTime,
            success: false,
            error: error as Error,
          });
        }
      }
    }

    return results;
  }

  private fuseResults(
    strategyResults: StrategyResult[],
    analysis: QueryAnalysis,
    context: QueryContext
  ): SearchResult[] {
    const allResults: SearchResult[] = [];

    // Collect all results
    for (const strategyResult of strategyResults) {
      if (strategyResult.success) {
        allResults.push(...strategyResult.results);
      }
    }

    // Deduplicate based on content similarity
    return this.deduplicateResults(allResults);
  }

  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const deduplicated: SearchResult[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      // Create a signature for deduplication
      const signature = this.createResultSignature(result);

      if (!seen.has(signature)) {
        seen.add(signature);
        deduplicated.push(result);
      } else {
        // If duplicate, merge scores (keep highest)
        const existing = deduplicated.find(
          (r) => this.createResultSignature(r) === signature
        );
        if (existing && result.relevanceScore > existing.relevanceScore) {
          existing.relevanceScore = result.relevanceScore;
          existing.confidence = Math.max(existing.confidence, result.confidence);
        }
      }
    }

    return deduplicated;
  }

  private rankResults(
    results: SearchResult[],
    query: string,
    analysis: QueryAnalysis,
    context: QueryContext
  ): SearchResult[] {
    return results.sort((a, b) => {
      // Primary sort: relevance score
      if (Math.abs(a.relevanceScore - b.relevanceScore) > 0.05) {
        return b.relevanceScore - a.relevanceScore;
      }

      // Secondary sort: confidence
      if (Math.abs(a.confidence - b.confidence) > 0.05) {
        return b.confidence - a.confidence;
      }

      // Tertiary sort: match type preference (exact > semantic > fuzzy)
      const matchTypePriority = { exact: 3, semantic: 2, structural: 2, fuzzy: 1 };
      const aPriority = matchTypePriority[a.matchType] || 0;
      const bPriority = matchTypePriority[b.matchType] || 0;

      return bPriority - aPriority;
    });
  }

  private postProcess(
    results: SearchResult[],
    maxResults: number,
    minConfidence: number
  ): SearchResult[] {
    // Filter by minimum confidence
    const filtered = results.filter((r) => r.confidence >= minConfidence);

    // Limit to max results
    return filtered.slice(0, maxResults);
  }

  private async refineSearch(
    query: string,
    currentResults: SearchResult[],
    analysis: QueryAnalysis,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ): Promise<SearchResult[]> {
    // Extract terms from current results to expand search
    const expandedTerms = this.extractExpandedTerms(currentResults, query);

    // Execute additional searches with expanded terms
    const refinedResults: SearchResult[] = [];

    for (const term of expandedTerms.slice(0, 3)) {
      // Limit expansion
      try {
        const searchArgs = {
          query: term,
          contextLines: config.contextLines || 2,
          maxResults: 10,
        };

        const contextItems = await extras.ide.getSearchResults(term, searchArgs);
        const parsed = this.parseSearchResults(contextItems, term);

        for (const item of parsed) {
          refinedResults.push({
            ...item,
            relevanceScore: item.relevanceScore * 0.6, // Lower score for refined results
            strategy: 'refined_search',
            confidence: 0.65,
          });
        }
      } catch (error) {
        console.warn(`Refinement search failed for "${term}":`, error);
      }
    }

    return refinedResults;
  }

  private generateFuzzyVariations(query: string): string[] {
    const variations: string[] = [query];

    // Case variations
    variations.push(query.toLowerCase());
    variations.push(query.toUpperCase());

    // Common typos and variations
    variations.push(query.replace(/s$/, '')); // Remove trailing 's'
    variations.push(query + 's'); // Add trailing 's'

    // Regex patterns for common variations
    if (query.includes('_')) {
      variations.push(query.replace(/_/g, ''));
      variations.push(query.replace(/_/g, ' '));
    }

    if (query.includes('-')) {
      variations.push(query.replace(/-/g, ''));
      variations.push(query.replace(/-/g, ' '));
    }

    // CamelCase variations
    if (/[a-z][A-Z]/.test(query)) {
      variations.push(query.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
      variations.push(query.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
    }

    return [...new Set(variations)];
  }

  private generateSemanticVariations(query: string): Array<{ variation: string; weight: number }> {
    const variations: Array<{ variation: string; weight: number }> = [];

    // Synonym expansion (rule-based)
    const synonymMap: Record<string, string[]> = {
      function: ['method', 'procedure', 'func', 'def'],
      class: ['type', 'interface', 'struct'],
      variable: ['var', 'let', 'const', 'field'],
      error: ['exception', 'failure', 'issue', 'problem'],
      search: ['find', 'locate', 'lookup', 'query'],
      read: ['get', 'fetch', 'load', 'retrieve'],
      write: ['save', 'store', 'persist', 'update'],
      delete: ['remove', 'erase', 'clear'],
    };

    const words = query.toLowerCase().split(/\s+/);

    for (const word of words) {
      if (synonymMap[word]) {
        for (const synonym of synonymMap[word]) {
          const variation = query.replace(new RegExp(`\\b${word}\\b`, 'gi'), synonym);
          variations.push({ variation, weight: 0.8 });
        }
      }
    }

    // Add original with full weight
    variations.unshift({ variation: query, weight: 1.0 });

    return variations;
  }

  private detectStructuralPattern(query: string): { pattern: string; type: string } | null {
    // Detect structural patterns like function declarations, class definitions, etc.
    
    if (/\b(function|def|func)\s+\w+/.test(query)) {
      return { pattern: '(function|def|func)\\s+\\w+', type: 'function_declaration' };
    }

    if (/\b(class|interface|struct)\s+\w+/.test(query)) {
      return { pattern: '(class|interface|struct)\\s+\\w+', type: 'type_declaration' };
    }

    if (/\bimport\s+/.test(query)) {
      return { pattern: 'import\\s+', type: 'import_statement' };
    }

    return null;
  }

  private parseSearchResults(content: string, query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lines = content.split('\n');
    let currentFile = '';
    let currentMatches: string[] = [];

    for (const line of lines) {
      if (line.startsWith('./') || line.startsWith('.\\')) {
        if (currentFile && currentMatches.length > 0) {
          results.push({
            content: {
              name: currentFile,
              description: `Matches for "${query}"`,
              content: currentMatches.join('\n'),
            },
            relevanceScore: 0.8,
            strategy: 'unknown',
            matchType: 'exact',
            confidence: 0.75,
            metadata: {
              sourceFile: currentFile,
              matchedTerms: [query],
            },
          });
        }
        currentFile = line.trim();
        currentMatches = [];
      } else if (line.trim()) {
        currentMatches.push(line);
      }
    }

    if (currentFile && currentMatches.length > 0) {
      results.push({
        content: {
          name: currentFile,
          description: `Matches for "${query}"`,
          content: currentMatches.join('\n'),
        },
        relevanceScore: 0.8,
        strategy: 'unknown',
        matchType: 'exact',
        confidence: 0.75,
        metadata: {
          sourceFile: currentFile,
          matchedTerms: [query],
        },
      });
    }

    return results;
  }

  private createResultSignature(result: SearchResult): string {
    // Create unique signature for deduplication
    const file = result.metadata.sourceFile || result.content.name;
    const contentHash = result.content.content.substring(0, 100);
    return `${file}:${contentHash}`;
  }

  private extractExpandedTerms(results: SearchResult[], originalQuery: string): string[] {
    const terms = new Set<string>();

    // Extract terms from matched content
    for (const result of results.slice(0, 5)) {
      const content = result.content.content;
      const words = content.match(/\b\w{3,}\b/g) || [];

      for (const word of words) {
        if (word.toLowerCase() !== originalQuery.toLowerCase() && word.length > 3) {
          terms.add(word);
        }
      }
    }

    return Array.from(terms).slice(0, 5);
  }

  private isCodeStructureQuery(analysis: QueryAnalysis): boolean {
    const keywords = ['function', 'class', 'interface', 'method', 'type', 'struct', 'import', 'export'];
    const queryLower = JSON.stringify(analysis.intent).toLowerCase();

    return keywords.some((kw) => queryLower.includes(kw));
  }

  private extractFileType(filepath: string): string | null {
    const match = filepath.match(/\.([a-z]+)$/i);
    return match ? match[1] : null;
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Strategy timeout')), ms)
    );
  }
}

/**
 * Search strategy definition
 */
interface SearchStrategyDefinition {
  name: string;
  priority: number;
  executor: (
    query: string,
    context: QueryContext,
    extras: ToolExtras,
    config: SearchConfig
  ) => Promise<SearchResult[]>;
  cost: 'low' | 'medium' | 'high';
  expectedAccuracy: number;
}
