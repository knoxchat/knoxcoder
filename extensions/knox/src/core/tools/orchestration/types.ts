/**
 * Type definitions for Tool Orchestration System
 */

import { ContextItem, Tool, ToolExtras } from "../..";

/**
 * Result of a tool execution within a pipeline
 */
export interface ToolResult {
  success: boolean;
  toolName: string;
  output: ContextItem[];
  error?: Error;
  executionTime: number;
  cached?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Pipeline step configuration
 */
export interface PipelineStep {
  id: string;
  tool: Tool;
  args: Record<string, any> | ((context: PipelineContext) => Record<string, any>);
  condition?: ToolCondition;
  transform?: (result: ToolResult, context: PipelineContext) => ToolResult;
  onError?: 'continue' | 'stop' | 'retry' | ((error: Error, context: PipelineContext) => Promise<'continue' | 'stop' | 'retry'>);
  retryConfig?: RetryConfig;
  timeout?: number;
  cache?: CacheConfig;
}

/**
 * Retry configuration for failed tool calls
 */
export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

/**
 * Cache configuration for tool results
 */
export interface CacheConfig {
  enabled: boolean;
  ttlMs: number;
  keyGenerator?: (args: Record<string, any>) => string;
  invalidateOn?: string[]; // Tool names that should invalidate this cache
}

/**
 * Condition for conditional tool execution
 */
export type ToolCondition = 
  | { type: 'always' }
  | { type: 'never' }
  | { type: 'if'; predicate: (context: PipelineContext) => boolean }
  | { type: 'ifResult'; stepId: string; check: (result: ToolResult) => boolean }
  | { type: 'ifAny'; conditions: ToolCondition[] }
  | { type: 'ifAll'; conditions: ToolCondition[] }
  | { type: 'ifNot'; condition: ToolCondition }
  | { type: 'ifError'; stepId: string }
  | { type: 'ifSuccess'; stepId: string }
  | { type: 'ifContains'; stepId: string; pattern: string | RegExp };

/**
 * Pipeline execution context - shared state across pipeline steps
 */
export interface PipelineContext {
  pipelineId: string;
  results: Map<string, ToolResult>;
  variables: Map<string, any>;
  startTime: number;
  currentStep: number;
  totalSteps: number;
  abortController: AbortController;
  extras: ToolExtras;
  metadata: Record<string, any>;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  parallelGroups?: ParallelGroup[];
  hooks?: PipelineHooks;
  timeout?: number;
  transactional?: boolean;
  rollbackSteps?: RollbackStep[];
}

/**
 * Parallel execution group - steps in the same group run concurrently
 */
export interface ParallelGroup {
  id: string;
  stepIds: string[];
  maxConcurrency?: number;
  waitForAll?: boolean; // If false, continues when first completes
  aggregateResults?: (results: ToolResult[]) => ToolResult;
}

/**
 * Rollback step for transactional pipelines
 */
export interface RollbackStep {
  forStepId: string;
  tool: Tool;
  args: (originalArgs: Record<string, any>, result: ToolResult, context: PipelineContext) => Record<string, any>;
}

/**
 * Pipeline lifecycle hooks
 */
export interface PipelineHooks {
  onStart?: (context: PipelineContext) => Promise<void>;
  onStepStart?: (step: PipelineStep, context: PipelineContext) => Promise<void>;
  onStepComplete?: (step: PipelineStep, result: ToolResult, context: PipelineContext) => Promise<void>;
  onStepError?: (step: PipelineStep, error: Error, context: PipelineContext) => Promise<void>;
  onComplete?: (context: PipelineContext) => Promise<void>;
  onError?: (error: Error, context: PipelineContext) => Promise<void>;
  onRollback?: (context: PipelineContext) => Promise<void>;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  success: boolean;
  pipelineId: string;
  results: Map<string, ToolResult>;
  aggregatedOutput: ContextItem[];
  executionTime: number;
  stepsExecuted: number;
  stepsFailed: number;
  stepsSkipped: number;
  rolledBack?: boolean;
  error?: Error;
}

/**
 * Event types for tool event system
 */
export type ToolEventType = 
  | 'tool:start'
  | 'tool:complete'
  | 'tool:error'
  | 'tool:retry'
  | 'tool:cache-hit'
  | 'tool:cache-miss'
  | 'pipeline:start'
  | 'pipeline:complete'
  | 'pipeline:error'
  | 'pipeline:rollback'
  | 'file:created'
  | 'file:modified'
  | 'file:deleted'
  | 'terminal:output'
  | 'search:results'
  | 'custom';

/**
 * Tool event for event-driven tool execution
 */
export interface ToolEvent {
  type: ToolEventType;
  timestamp: number;
  source: string;
  payload: any;
  metadata?: Record<string, any>;
}

/**
 * Event subscription for reactive tool execution
 */
export interface ToolEventSubscription {
  id: string;
  eventTypes: ToolEventType[];
  filter?: (event: ToolEvent) => boolean;
  handler: (event: ToolEvent, context: PipelineContext) => Promise<void>;
  pipeline?: PipelineConfig; // Optional pipeline to execute on event
}

/**
 * Tool transaction state
 */
export interface TransactionState {
  id: string;
  status: 'pending' | 'committed' | 'rolled-back' | 'failed';
  operations: TransactionOperation[];
  rollbackStack: RollbackOperation[];
  startTime: number;
  endTime?: number;
}

/**
 * Prior file bytes captured before a mutating tool (for defaultRollback).
 */
export interface TransactionPriorFileState {
  filepath: string;
  existed: boolean;
  content: string | null;
}

/**
 * Single operation in a transaction
 */
export interface TransactionOperation {
  stepId: string;
  toolName: string;
  args: Record<string, any>;
  result?: ToolResult;
  timestamp: number;
  /** Snapshot taken before execute for file-mutating tools. */
  priorFileState?: TransactionPriorFileState | null;
}

/**
 * Rollback operation to undo a transaction operation
 */
export interface RollbackOperation {
  forOperationStepId: string;
  toolName: string;
  args: Record<string, any>;
  executed: boolean;
  result?: ToolResult;
}

/**
 * Smart tool suggestion based on context
 */
export interface ToolSuggestion {
  tool: Tool;
  reason: string;
  confidence: number;
  suggestedArgs?: Record<string, any>;
  relatedTools?: string[];
}

/**
 * Tool dependency graph for intelligent ordering
 */
export interface ToolDependencyGraph {
  nodes: Map<string, ToolDependencyNode>;
  edges: Map<string, string[]>; // toolName -> dependsOn[]
}

/**
 * Node in the tool dependency graph
 */
export interface ToolDependencyNode {
  toolName: string;
  inputTypes: string[];
  outputTypes: string[];
  sideEffects: ('file-write' | 'terminal' | 'network' | 'none')[];
  reversible: boolean;
}

/**
 * Execution strategy for pipelines
 */
export type ExecutionStrategy = 
  | 'sequential' 
  | 'parallel' 
  | 'adaptive' // Automatically parallelizes independent steps
  | 'priority'; // Executes based on priority scores

/**
 * Priority configuration for priority-based execution
 */
export interface PriorityConfig {
  stepId: string;
  priority: number; // Higher = execute first
  preemptible?: boolean; // Can be interrupted by higher priority
}
