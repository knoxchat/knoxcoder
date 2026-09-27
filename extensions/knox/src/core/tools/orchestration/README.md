# Tool Orchestration System

Library helpers used by opt-in tools (`builtin_enhanced_search`, `builtin_intelligent_chain`, composites).

## Product honesty (read first)

| Path | Reality |
|------|---------|
| Default chat / agent tools | Explicit list in `allTools` → `callTool` only |
| `SmartToolRouter` / `smartExecute` | **Not exported**, zero production callers — experimental only |
| `ToolTransaction` file rollback | Captures prior state; create → `removeFile`, edit → restore |
| Composites / advanced opt-in | In `allAvailableTools`; each has a `callTool` case |
| Unimplemented advanced defs | `unimplementedAdvancedTools` — not exposed |

Do not document SmartToolRouter as the product tool path. Prefer wiring new capabilities as explicit tools with implementations + tests.

## Overview

1. **Tool Pipelines** - Chain multiple tools with data flow (library)
2. **Parallel Execution** - Run independent tools concurrently
3. **Conditional Execution** - Execute tools based on dynamic conditions
4. **Result Caching** - Cache expensive tool results with TTL
5. **Transaction Support** - Default file create/edit rollback; terminal still needs custom handlers
6. **Event-Driven Tools** - Reactive execution based on events
7. **Smart Routing** - Experimental (`SmartToolRouter.ts`, not public API)

## Quick Start

### Basic Pipeline

```typescript
import { createPipeline } from 'core/tools/orchestration';
import { readFileTool, exactSearchTool } from 'core/tools';

const pipeline = createPipeline('my-pipeline', 'Read and search')
  .step(readFileTool, { filepath: 'src/index.ts' })
  .step(exactSearchTool, (ctx) => ({
    query: ctx.results.get('step-1')?.output[0]?.content?.match(/export\s+(\w+)/)?.[1] || 'export'
  }))
  .build();

const result = await pipeline.execute(extras);
```

### Parallel Execution

```typescript
import { ToolExecutor } from 'core/tools/orchestration';

const executor = ToolExecutor.getInstance();

const results = await executor.executeParallel([
  { tool: readFileTool, args: { filepath: 'file1.ts' } },
  { tool: readFileTool, args: { filepath: 'file2.ts' } },
  { tool: readFileTool, args: { filepath: 'file3.ts' } },
], extras, 3); // max 3 concurrent
```

### Conditional Execution

```typescript
import { createPipeline, ConditionBuilder } from 'core/tools/orchestration';

const pipeline = createPipeline('conditional', 'Conditional workflow')
  .namedStep('search', exactSearchTool, { query: 'TODO' })
  .namedStep('fix', refactorTool, 
    (ctx) => ({ target: ctx.results.get('search')?.output[0]?.content }),
    { condition: ConditionBuilder.ifOutputNotEmpty('search').build() }
  )
  .build();
```

### Transactional Operations

```typescript
import { atomic, TransactionManager } from 'core/tools/orchestration';

// Atomic execution with automatic rollback
const results = await atomic(extras, [
  { 
    tool: createNewFileTool, 
    args: { filepath: 'new.ts', contents: '// new file' },
    rollback: async (op) => {
      await extras.ide.deleteFile(op.args.filepath);
    }
  }
]);

// Manual transaction control
const manager = TransactionManager.getInstance();
const txn = manager.begin(extras);

try {
  await txn.execute(createNewFileTool, { filepath: 'a.ts', contents: '' });
  await txn.savepoint('after-first');
  await txn.execute(createNewFileTool, { filepath: 'b.ts', contents: '' });
  await txn.commit();
} catch (error) {
  await txn.rollbackToSavepoint('after-first');
}
```

### Event-Driven Execution

```typescript
import { onToolEvent, ToolEventEmitter } from 'core/tools/orchestration';

// Subscribe to events
const unsubscribe = onToolEvent('file-watch')
  .onEvents('file:created', 'file:modified')
  .filter(event => event.payload.filepath.endsWith('.ts'))
  .handle(async (event, ctx) => {
    console.log('TypeScript file changed:', event.payload.filepath);
  })
  .register();

// Emit events
const emitter = ToolEventEmitter.getInstance();
emitter.emit({
  type: 'file:modified',
  timestamp: Date.now(),
  source: 'watcher',
  payload: { filepath: 'src/index.ts' }
});
```

### Smart Tool Routing (experimental — not public API)

`SmartToolRouter` / `smartExecute` are **not** exported from `orchestration/index.ts`
and are unused by the product. For local experiments only:

```typescript
import { smartExecute } from 'core/tools/orchestration/SmartToolRouter';
```

Prefer explicit tools on `allTools` / `allAvailableTools` with `callTool` cases.

## Implemented opt-in tools

### Advanced (in `advancedTools` / `allAvailableTools`)

| Tool | Purpose |
|------|---------|
| `builtin_enhanced_search` | Multi-strategy search |
| `builtin_intelligent_chain` | Auto tool-chain from query |
| `builtin_generate_tests` | LLM test generation (also in default `allTools`) |

### Quarantined (definitions only — `unimplementedAdvancedTools`)

| Tool | Status |
|------|--------|
| `builtin_analyze_code` | No `callTool` impl |
| `builtin_multi_file_search` | No `callTool` impl |
| `builtin_refactor` | No `callTool` impl |
| `builtin_generate_docs` | No `callTool` impl |
| `builtin_git_operations` | No `callTool` impl |
| `builtin_analyze_performance` | No `callTool` impl |
| `builtin_analyze_dependencies` | No `callTool` impl |
| `builtin_explain_code` | No `callTool` impl |
| `builtin_scaffold_project` | No `callTool` impl |

### Composite Tools

These tools automatically orchestrate multiple operations:

| Tool | What It Does |
|------|--------------|
| `composite_smart_edit` | Read → Analyze → Modify → Validate |
| `composite_implement_feature` | Plan → Create files → Add tests → Document |
| `composite_investigate_bug` | Search → Analyze → Git history → Report |
| `composite_code_review` | Diff → Quality check → Security scan → Report |
| `composite_migrate` | Analyze → Plan → Transform → Verify |
| `composite_health_check` | Quality + Dependencies + Tests + Security |
| `composite_learn_codebase` | Structure → Entry points → Learning path |

## Pipeline Features

### Result Transformation

```typescript
pipeline.step(searchTool, { query: 'error' }, {
  transform: (result, ctx) => ({
    ...result,
    output: result.output.map(item => ({
      ...item,
      content: item.content.toUpperCase()
    }))
  })
})
```

### Retry Configuration

```typescript
pipeline.step(webSearchTool, { query: 'npm package' }, {
  retryConfig: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    retryableErrors: ['timeout', 'network']
  }
})
```

### Caching

```typescript
pipeline.step(expensiveTool, args, {
  cache: {
    enabled: true,
    ttlMs: 60000, // 1 minute
    invalidateOn: ['builtin_create_new_file'] // Invalidate when files change
  }
})
```

### Error Handling

```typescript
pipeline.step(riskyTool, args, {
  onError: async (error, ctx) => {
    if (error.message.includes('recoverable')) {
      return 'retry';
    }
    return 'continue'; // or 'stop'
  }
})
```

## Execution Strategies

### Sequential (Default)
Tools execute one after another. Good for dependent operations.

### Parallel
Independent tools execute concurrently. Good for read-only operations.

### Adaptive
Automatically parallelizes independent steps while maintaining order for dependent ones.

### Priority-Based
Execute tools based on priority scores, with optional preemption.

## Cache System

The cache system provides:
- **TTL-based expiration**
- **Custom key generation**
- **Invalidation triggers**
- **LRU eviction**
- **Statistics tracking**

```typescript
const cache = ToolCache.getInstance();

// Get stats
const stats = cache.getStats();
console.log(`Hit rate: ${cache.getHitRate()}%`);

// Invalidate specific tool results
cache.invalidateTool('builtin_read_file');

// Invalidate by pattern
cache.invalidatePattern(/search/);
```

## Event System

Events flow through the system for reactive programming:

```
tool:start → tool:complete | tool:error
    ↓
tool:retry (if failed and retryable)
    ↓
tool:cache-hit | tool:cache-miss (if caching enabled)

pipeline:start → pipeline:complete | pipeline:error
                        ↓
              pipeline:rollback (if transactional)
```

### Event Utilities

```typescript
import { debounceEvents, throttleEvents, batchEvents } from 'core/tools/orchestration';

// Debounce rapid events
const debouncedHandler = debounceEvents(handler, 500);

// Throttle to max rate
const throttledHandler = throttleEvents(handler, 1000);

// Batch events for efficiency
const batchHandler = batchEvents(events => {
  console.log(`Processing ${events.length} events`);
}, { maxBatchSize: 10, maxWaitMs: 100 });
```

## Best Practices

1. **Use pipelines for complex workflows** - They provide better visibility and control
2. **Cache read-only operations** - Especially expensive searches and analyses
3. **Use transactions for write operations** - Enable rollback on failure
4. **Prefer explicit tools on `allTools`** — that is the product path
5. **Do not use SmartToolRouter in production** — experimental, not exported
6. **Subscribe to events** - For reactive, decoupled architectures

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Default path: allTools → callTool (not SmartToolRouter)     │
│  SmartToolRouter is experimental / unexported / unused       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      ToolPipeline                            │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│  │ Step 1  │ → │ Step 2  │ → │ Step 3  │                   │
│  └─────────┘   └─────────┘   └─────────┘                   │
│       ↓             ↓             ↓                         │
│   Condition     Transform      Cache                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      ToolExecutor                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Rate Limit   │  │    Retry     │  │   Timeout    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     ToolTransaction                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Execute     │  │  Savepoint   │  │   Rollback   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    ToolEventEmitter                          │
│  Events → Subscriptions → Handlers → Reactive Pipelines     │
└─────────────────────────────────────────────────────────────┘
```

## Migration Guide

### From Basic Tool Calls

Before:
```typescript
const result1 = await callTool(readFileTool, { filepath: 'a.ts' }, extras);
const result2 = await callTool(searchTool, { query: result1[0].content }, extras);
```

After:
```typescript
const results = await createPipeline('my-flow', 'Read and search')
  .namedStep('read', readFileTool, { filepath: 'a.ts' })
  .namedStep('search', searchTool, ctx => ({ 
    query: ctx.results.get('read')?.output[0]?.content 
  }))
  .build()
  .execute(extras);
```

### Adding Resilience

```typescript
// Add retry, caching, and transactions
const pipeline = createPipeline('resilient', 'Safe operations')
  .step(tool, args, {
    retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
    cache: { enabled: true, ttlMs: 60000 },
    timeout: 30000
  })
  .transactional([{
    forStepId: 'step-1',
    tool: rollbackTool,
    args: (original, result, ctx) => ({ undo: true })
  }])
  .build();
```
