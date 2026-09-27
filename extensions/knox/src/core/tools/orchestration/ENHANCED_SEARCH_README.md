# Enhanced Tool Calling System

## Overview

Multi-strategy codebase search and tool orchestration using **ripgrep (exact match)**, fuzzy match, structural analysis, and rule-based semantic expansion — fused with multi-dimensional relevance scoring.

## Search Approach

Memory retrieval uses SQLite FTS5 BM25 (`RetrievalFusion`). Codebase search uses:

- **Exact match** — ripgrep for high-precision keyword search
- **Fuzzy match** — typo tolerance and identifier variations
- **Structural** — functions, classes, imports
- **Semantic (rule-based)** — synonym expansion and concept mapping (no ML models)

### Multi-Dimensional Relevance Scoring

Five combined signals:

1. **Syntactic Relevance** (25% weight)
   - Keyword and pattern matching
   - Entity recognition (file paths, search terms)
   - Modifier detection (all, recent, changed)

2. **Semantic Relevance** (30% weight)
   - Rule-based concept mapping
   - Synonym expansion
   - Intent alignment
   - Task decomposition understanding

3. **Structural Relevance** (20% weight)
   - Code structure awareness
   - File type compatibility
   - Scope appropriateness
   - Repository structure understanding

4. **Behavioral Relevance** (15% weight)
   - Historical success rates
   - Pattern matching from execution history
   - Learning from past successes
   - Recency bias for recent patterns

5. **Contextual Relevance** (10% weight)
   - Time constraints (fast vs thorough)
   - Cost awareness
   - Workspace state (unsaved changes)
   - Available resources

**Result**: Accurate, explainable, adaptive relevance scoring without vector stores.

---

## Key Components

### 1. Relevance Engine (`RelevanceEngine.ts`)

**Purpose**: Multi-dimensional relevance scoring for tools

**Features**:
- Query analysis and intent extraction
- 5-signal relevance scoring
- Learning from execution outcomes
- Adaptive weight adjustment
- Confidence scoring with variance analysis

**Usage**:
```typescript
const engine = RelevanceEngine.getInstance();
const analysis = engine.analyzeQuery(query, context);
const rankedTools = engine.rankTools(tools, query, context);
```

**Key Methods**:
- `analyzeQuery()` - Deep query understanding
- `scoreToolRelevance()` - Multi-signal scoring
- `rankTools()` - Sort tools by relevance
- `recordExecution()` - Learn from outcomes

---

### 2. Multi-Strategy Search (`MultiStrategySearch.ts`)

**Purpose**: Parallel execution of multiple search strategies with result fusion

**Strategies**:

1. **Exact Match** (Priority: 1)
   - High-precision keyword matching
   - Uses ripgrep for speed
   - Confidence: 95%

2. **Fuzzy Search** (Priority: 2)
   - Typo tolerance
   - Case variations
   - CamelCase/snake_case conversions
   - Confidence: 70%

3. **Structural Search** (Priority: 3)
   - Function/class declarations
   - Import statements
   - Code patterns
   - Confidence: 85%

4. **Semantic Search** (Priority: 4)
   - Synonym expansion
   - Concept mapping
   - Intent-based variations
   - Confidence: 80%

5. **Context-Aware** (Priority: 5)
   - File type filtering
   - Scope awareness
   - Recent action consideration
   - Confidence: 88%

**Usage**:
```typescript
const search = MultiStrategySearch.getInstance();
const results = await search.search(query, context, extras, {
  maxResults: 50,
  includeFuzzy: true,
  includeStructural: true,
  progressiveRefinement: true,
  parallelExecution: true
});
```

**Features**:
- Parallel strategy execution
- Intelligent result fusion
- Deduplication with signature matching
- Progressive refinement for better results
- Adaptive strategy selection

---

### 3. Intelligent Chain Orchestrator (`IntelligentChainOrchestrator.ts`)

**Purpose**: Automatic tool sequence generation from natural language

**Features**:
- Natural language understanding
- Automatic chain generation
- Dependency-aware execution
- Dynamic branching
- Error recovery
- Pattern library learning

**Usage**:
```typescript
const orchestrator = IntelligentChainOrchestrator.getInstance();
const result = await orchestrator.orchestrate(
  "Find all error handlers and analyze their complexity",
  context,
  extras
);
```

**Built-in Patterns**:
- `search-read`: Search → Read files
- `find-modify`: Search → Read → Modify
- Auto-learns new patterns from successful executions

**Chain Types**:
- **Search-focused**: Multi-strategy search → Optional analysis → Optional read
- **Modify-focused**: Find target → Read → Modify → Validate
- **Analyze-focused**: Find target → Analyze → Report
- **Multi-step**: Parse sequential operations → Generate chain

---

## Enhanced Search Tool

**Tool Name**: `builtin_enhanced_search`

**What Makes It Powerful**:

1. **Parallel Multi-Strategy Execution**
   - All strategies run concurrently
   - Results fused intelligently
   - Best results from each strategy

2. **Intelligent Result Fusion**
   - Deduplication based on content similarity
   - Score merging (keep highest)
   - Confidence aggregation

3. **Context-Aware Ranking**
   - File type preference
   - Scope appropriateness
   - Recent usage patterns
   - Project structure awareness

4. **Progressive Refinement**
   - Auto-expands search if few results
   - Learns from matched content
   - Iterative improvement

5. **Explainable Results**
   - Every result has reasoning
   - Confidence scores
   - Strategy breakdown
   - Match type indicators

**Example Usage**:
```json
{
  "query": "authentication middleware functions",
  "maxResults": 50,
  "minConfidence": 0.3,
  "includeFuzzy": true,
  "includeStructural": true,
  "progressiveRefinement": true
}
```

**Example Output**:
```
Enhanced Search Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Query: "authentication middleware functions"
Total Results: 24
Strategies Used: exact_match, structural_search, semantic_search, context_aware

Match Type Distribution:
- Exact: 8
- Semantic: 9
- Structural: 5
- Fuzzy: 2

Average Confidence: 78.3%
Average Relevance: 84.5%
```

---

## Intelligent Chain Tool

**Tool Name**: `builtin_intelligent_chain`

**Capabilities**:

1. **Automatic Tool Selection**
   - Analyzes natural language description
   - Selects best tools for each step
   - Considers dependencies

2. **Dynamic Execution Planning**
   - Sequential or parallel execution
   - Conditional branching
   - Error handling strategies

3. **Learning & Adaptation**
   - Stores successful patterns
   - Matches similar queries
   - Improves over time

**Example Chains**:

```
"Find all error handlers and analyze their complexity"
→ Search (exact_match) → Read files → Analyze code

"Search for config file and update timeout value"
→ Search → Read → Smart edit → Validate

"Locate authentication code, read it, and generate tests"
→ Search → Read → Analyze → Generate tests
```

---

## Performance Comparison

### Single-strategy grep-only search:
- One relevance dimension
- No learning or fusion
- Limited fuzzy/structural coverage

### Enhanced Tool Calling System:
- **5 relevance dimensions**
- **Adaptive learning**
- **Pattern recognition**
- **Multi-strategy fusion** (exact + fuzzy + structural + semantic)
- **Full explainability** with reasoning

### Speed:
- **Parallel execution**: 2-3x faster than sequential
- **Result caching**: Instant for repeated queries
- **Progressive refinement**: Only when needed

---

## Architecture Benefits

### 1. Modularity
- Each component is independent
- Easy to add new strategies
- Pluggable relevance signals

### 2. Scalability
- Parallel execution by default
- Efficient deduplication
- Resource-aware execution

### 3. Maintainability
- Clear separation of concerns
- Comprehensive documentation
- Type-safe implementation

### 4. Extensibility
- Easy to add new search strategies
- Custom relevance signals
- Pattern library expansion

---

## Configuration

### Relevance Engine Weights

Adjust in `RelevanceEngine.ts`:
```typescript
this.contextWeights.set('syntactic', 0.25);
this.contextWeights.set('semantic', 0.30);
this.contextWeights.set('structural', 0.20);
this.contextWeights.set('behavioral', 0.15);
this.contextWeights.set('contextual', 0.10);
```

### Search Strategies

Enable/disable in config:
```typescript
{
  strategies: ['exact_match', 'semantic_search'], // Specific strategies
  includeFuzzy: true,
  includeStructural: true,
  parallelExecution: true,
  progressiveRefinement: true
}
```

---

## Learning & Adaptation

### How It Learns:

1. **Execution Recording**
   - Records every tool execution
   - Tracks success/failure
   - Measures execution time

2. **Pattern Extraction**
   - Identifies successful patterns
   - Maps intents to tools
   - Stores query-tool associations

3. **Weight Adaptation**
   - Adjusts relevance weights
   - Based on success feedback
   - Continuous improvement

4. **Pattern Library Growth**
   - Auto-saves successful chains
   - Matches similar queries
   - Reduces planning overhead

### Data Stored:
- Last 1000 executions
- Tool success rates
- Query patterns by intent
- Successful chain patterns

---

## Advanced Features

### 1. Query Understanding
- Intent extraction (primary & secondary)
- Entity recognition (files, search terms)
- Complexity assessment
- Scope determination

### 2. Result Fusion
- Content-based deduplication
- Score merging strategies
- Confidence aggregation

### 3. Error Recovery
- Retry with exponential backoff
- Alternative path selection
- Graceful degradation

### 4. Cost Optimization
- Prefer read-only tools when appropriate
- Use composite tools to reduce calls
- Cache expensive operations

---

## Future Enhancements

1. **Machine Learning Integration**
   - Train models on execution history
   - Predict best tools/strategies
   - Personalized ranking

2. **More Search Strategies**
   - AST-based structural search
   - Graph-based dependency search
   - Cross-repository search

3. **Enhanced Pattern Library**
   - Community-shared patterns
   - Domain-specific chains
   - Auto-optimization

4. **Performance Monitoring**
   - Real-time metrics
   - A/B testing strategies
   - Optimization suggestions

---

## Conclusion

This enhanced tool calling system combines ripgrep, fuzzy match, structural analysis, and rule-based semantic expansion with:

✅ **Multi-dimensional relevance** (5 signals)
✅ **Parallel multi-strategy execution** (5 strategies in parallel)
✅ **Learning & adaptation** (improves over time)
✅ **Intelligent tool chaining** (auto-generates sequences)
✅ **Full explainability** (reasoning for every result)
✅ **Context awareness** (project structure, usage patterns)
✅ **Cost optimization** (smart tool selection)

**The result**: Fast, explainable codebase search with intelligent tool orchestration — no vector stores required.
