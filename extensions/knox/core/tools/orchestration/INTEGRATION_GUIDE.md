# Enhanced Tool Calling Integration Guide

## Quick Start

### 1. Using Enhanced Search

The enhanced search tool combines ripgrep, fuzzy, structural, and rule-based semantic strategies:

```typescript
import { enhancedSearchTool } from './tools/definitions/advanced/enhancedSearch';
import { callTool } from './tools/callTool';

// Basic usage
const results = await callTool(
  enhancedSearchTool,
  {
    query: "authentication middleware",
    maxResults: 50,
    includeFuzzy: true,
    includeStructural: true,
  },
  extras
);

// Advanced usage with specific strategies
const advancedResults = await callTool(
  enhancedSearchTool,
  {
    query: "error handling functions",
    strategies: ['exact_match', 'structural_search', 'semantic_search'],
    minConfidence: 0.5,
    contextLines: 3,
    fileType: 'ts',
    scope: 'project',
  },
  extras
);
```

### 2. Using Intelligent Chain Orchestration

Automatically execute complex multi-step tasks:

```typescript
import { intelligentChainTool } from './tools/definitions/advanced/enhancedSearch';

// The orchestrator will automatically:
// 1. Understand your intent
// 2. Select appropriate tools
// 3. Execute them in optimal order
// 4. Handle errors and dependencies

const result = await callTool(
  intelligentChainTool,
  {
    description: "Find all authentication code and analyze its security",
    context: {
      scope: 'project',
      timeConstraint: 'thorough'
    }
  },
  extras
);
```

### 3. Direct API Usage

For more control, use the engines directly:

```typescript
import { 
  RelevanceEngine, 
  MultiStrategySearch, 
  IntelligentChainOrchestrator 
} from './tools/orchestration';

// Relevance Engine
const relevanceEngine = RelevanceEngine.getInstance();
const analysis = relevanceEngine.analyzeQuery(query, context);
const rankedTools = relevanceEngine.rankTools(allTools, query, context);

// Multi-Strategy Search
const searchEngine = MultiStrategySearch.getInstance();
const searchResults = await searchEngine.search(query, context, extras, {
  maxResults: 50,
  parallelExecution: true,
  progressiveRefinement: true
});

// Intelligent Chain Orchestrator
const orchestrator = IntelligentChainOrchestrator.getInstance();
const chainResult = await orchestrator.orchestrate(query, context, extras);
```

## Integration Examples

### Example 1: Smart Code Search

```typescript
// Instead of simple text search, use enhanced search
async function smartCodeSearch(query: string) {
  const searchEngine = MultiStrategySearch.getInstance();
  
  const results = await searchEngine.search(
    query,
    {
      scope: 'project',
      fileType: 'ts',
      timeConstraint: 'normal'
    },
    extras,
    {
      maxResults: 50,
      includeFuzzy: true,
      includeStructural: true,
      progressiveRefinement: true
    }
  );
  
  // Results are ranked by relevance with multi-dimensional scoring
  console.log(`Found ${results.length} results`);
  console.log(`Match types:`, results.map(r => r.matchType));
  console.log(`Strategies:`, results.map(r => r.strategy));
  
  return results;
}
```

### Example 2: Automatic Task Execution

```typescript
// Let the orchestrator handle complex tasks automatically
async function executeComplexTask(description: string) {
  const orchestrator = IntelligentChainOrchestrator.getInstance();
  
  const result = await orchestrator.orchestrate(
    description,
    {
      scope: 'project',
      timeConstraint: 'normal',
      costConstraint: 'medium'
    },
    extras
  );
  
  if (result.success) {
    console.log(`Completed ${result.stepsCompleted} steps in ${result.executionTime}ms`);
    return result.output;
  } else {
    console.error('Task failed:', result.errors);
    throw new Error('Task execution failed');
  }
}

// Examples:
await executeComplexTask("Find all API endpoints and document them");
await executeComplexTask("Search for TODOs and create issues for them");
await executeComplexTask("Locate database queries and check for SQL injection");
```

### Example 3: Custom Tool Selection

```typescript
// Use relevance engine for intelligent tool selection
async function selectBestToolsForQuery(query: string, availableTools: Tool[]) {
  const relevanceEngine = RelevanceEngine.getInstance();
  
  // Analyze query
  const analysis = relevanceEngine.analyzeQuery(query, {
    scope: 'project',
    currentFile: getCurrentFile()
  });
  
  console.log('Intent:', analysis.intent.primary);
  console.log('Complexity:', analysis.complexity);
  console.log('Suggested strategies:', analysis.suggestedStrategies);
  
  // Rank tools
  const rankedTools = relevanceEngine.rankTools(availableTools, query, {
    scope: 'project'
  });
  
  // Show top 3 with reasoning
  rankedTools.slice(0, 3).forEach(({ tool, score }) => {
    console.log(`\n${tool.displayTitle} (score: ${score.total.toFixed(2)})`);
    console.log('Reasoning:', score.reasoning.join(', '));
    console.log('Breakdown:', score.breakdown);
  });
  
  return rankedTools.map(r => r.tool);
}
```

## Configuration

### Adjust Relevance Weights

```typescript
// In your initialization code
import { RelevanceEngine } from './tools/orchestration';

const engine = RelevanceEngine.getInstance();

// Customize weights based on your needs
// Default: syntactic=0.25, semantic=0.30, structural=0.20, behavioral=0.15, contextual=0.10
// Example: Prioritize behavioral learning
engine['contextWeights'].set('syntactic', 0.20);
engine['contextWeights'].set('semantic', 0.25);
engine['contextWeights'].set('structural', 0.15);
engine['contextWeights'].set('behavioral', 0.30); // Increased
engine['contextWeights'].set('contextual', 0.10);
```

### Customize Search Strategies

```typescript
// Add custom search strategies
import { MultiStrategySearch } from './tools/orchestration';

const searchEngine = MultiStrategySearch.getInstance();

// Strategies are auto-initialized, but you can configure behavior:
const results = await searchEngine.search(query, context, extras, {
  strategies: ['exact_match', 'semantic_search'], // Use specific strategies
  parallelExecution: true,
  progressiveRefinement: false, // Disable refinement for speed
  timeoutMs: 5000, // 5 second timeout
  maxResults: 100,
  minConfidence: 0.4 // Higher threshold
});
```

## Best Practices

### 1. Choose the Right Tool

- **Simple exact searches**: Use `exactSearchTool`
- **Complex/fuzzy searches**: Use `enhancedSearchTool`
- **Multi-step tasks**: Use `intelligentChainTool`
- **Custom orchestration**: Use APIs directly

### 2. Provide Context

```typescript
// Good: Provide rich context
const context: QueryContext = {
  currentFile: getCurrentFile(),
  fileType: 'typescript',
  scope: 'project',
  timeConstraint: 'normal',
  hasUnsavedChanges: hasUnsavedChanges(),
  recentActions: getRecentActions()
};

// Better results with more context
const results = await searchEngine.search(query, context, extras);
```

### 3. Handle Results

```typescript
// Results include rich metadata
results.forEach(result => {
  console.log(`File: ${result.metadata.sourceFile}`);
  console.log(`Match type: ${result.matchType}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Relevance: ${result.relevanceScore}`);
  console.log(`Strategy: ${result.strategy}`);
});
```

### 4. Learn from Execution

```typescript
// Record executions to improve over time
const relevanceEngine = RelevanceEngine.getInstance();

relevanceEngine.recordExecution(
  query,
  toolsUsed,
  result,
  userFeedback // 'positive' | 'negative' | 'neutral'
);
```

## Performance Tips

1. **Use parallel execution** when possible:
   ```typescript
   { parallelExecution: true }
   ```

2. **Set appropriate timeouts**:
   ```typescript
   { timeoutMs: 10000 } // 10 seconds
   ```

3. **Limit results** for faster execution:
   ```typescript
   { maxResults: 20 }
   ```

4. **Use progressive refinement** only when needed:
   ```typescript
   { progressiveRefinement: false }
   ```

5. **Enable caching** in ToolExecutor:
   ```typescript
   { cache: true, cacheTtl: 60000 }
   ```

## Monitoring & Debugging

```typescript
// Enable detailed logging
console.log('Query analysis:', analysis);
console.log('Selected strategies:', strategies);
console.log('Execution time:', result.executionTime);
console.log('Steps completed:', result.stepsCompleted);

// Check performance metrics
const executor = ToolExecutor.getInstance();
const metrics = executor['stats']; // Access internal stats
console.log('Tool statistics:', metrics);

// View learning data
const engine = RelevanceEngine.getInstance();
const learningData = engine['learningData'];
console.log('Recent executions:', learningData.slice(-10));
```

## Troubleshooting

### Issue: Low confidence scores

**Solution**: Provide more context, use progressive refinement
```typescript
{
  minConfidence: 0.2, // Lower threshold
  progressiveRefinement: true
}
```

### Issue: Too many results

**Solution**: Increase confidence threshold, limit results
```typescript
{
  minConfidence: 0.5, // Higher threshold
  maxResults: 20
}
```

### Issue: Slow execution

**Solution**: Disable some strategies, reduce timeout
```typescript
{
  strategies: ['exact_match', 'context_aware'], // Fast strategies only
  timeoutMs: 3000,
  parallelExecution: true
}
```

### Issue: Chain execution fails

**Solution**: Check step dependencies, add error handlers
```typescript
const result = await orchestrator.orchestrate(query, context, extras);
if (!result.success) {
  console.error('Failed steps:', result.errors);
  // Retry with simpler query or different approach
}
```

## Summary

The enhanced tool calling system provides:

✅ **5 relevance signals** fused for ranking
✅ **Parallel multi-strategy search** for comprehensive results
✅ **Automatic learning** from execution patterns
✅ **Intelligent orchestration** of multi-step tasks
✅ **Full explainability** with detailed reasoning

Use it to build more intelligent, adaptive, and powerful code search and automation features!
