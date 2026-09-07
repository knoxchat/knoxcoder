/**
 * Tool Pipeline - Advanced tool chaining with data flow
 * 
 * Features:
 * - Declarative pipeline definition
 * - Dynamic argument injection from previous results
 * - Conditional step execution
 * - Result transformation
 * - Parallel execution groups
 * - Transactional support with rollback
 */

import { ContextItem, Tool, ToolExtras } from "../..";
import { createKnoxLogger } from "../../util/knoxLog.js";
import { callToolRaw as callTool } from "../callTool.js";
import { ToolCache } from "./ToolCache.js";
import { evaluateCondition } from "./ToolConditions.js";
import { ToolEventEmitter } from "./ToolEvents.js";
import {
  PipelineConfig,
  PipelineContext,
  PipelineHooks,
  PipelineResult,
  PipelineStep,
  ParallelGroup,
  ToolResult,
  ExecutionStrategy,
  RollbackStep,
  TransactionState,
} from "./types.js";

const log = createKnoxLogger("ToolPipeline");

/**
 * Creates and executes tool pipelines with advanced orchestration
 */
export class ToolPipeline {
  private config: PipelineConfig;
  private cache: ToolCache;
  private eventEmitter: ToolEventEmitter;
  private transactionState?: TransactionState;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.cache = ToolCache.getInstance();
    this.eventEmitter = ToolEventEmitter.getInstance();
  }

  /**
   * Execute the pipeline
   */
  async execute(extras: ToolExtras): Promise<PipelineResult> {
    const context = this.createContext(extras);
    const startTime = Date.now();
    let stepsExecuted = 0;
    let stepsFailed = 0;
    let stepsSkipped = 0;
    const aggregatedOutput: ContextItem[] = [];

    try {
      // Emit pipeline start event
      this.eventEmitter.emit({
        type: 'pipeline:start',
        timestamp: Date.now(),
        source: this.config.id,
        payload: { config: this.config }
      });

      // Call onStart hook
      await this.config.hooks?.onStart?.(context);

      // Initialize transaction if transactional
      if (this.config.transactional) {
        this.transactionState = {
          id: `txn-${this.config.id}-${Date.now()}`,
          status: 'pending',
          operations: [],
          rollbackStack: [],
          startTime: Date.now()
        };
      }

      // Build execution plan based on parallel groups
      const executionPlan = this.buildExecutionPlan();

      // Execute each phase of the plan
      for (const phase of executionPlan) {
        if (context.abortController.signal.aborted) {
          break;
        }

        if (phase.type === 'sequential') {
          // Execute single step
          const result = await this.executeStep(phase.step, context);
          stepsExecuted++;
          
          if (result.success) {
            aggregatedOutput.push(...result.output);
          } else {
            stepsFailed++;
            if (this.shouldStopOnError(phase.step, result, context)) {
              throw result.error || new Error(`Step ${phase.step.id} failed`);
            }
          }
        } else if (phase.type === 'parallel') {
          // Execute parallel group
          const results = await this.executeParallelGroup(phase.group, context);
          stepsExecuted += results.length;
          
          for (const result of results) {
            if (result.success) {
              aggregatedOutput.push(...result.output);
            } else {
              stepsFailed++;
            }
          }
        } else if (phase.type === 'skipped') {
          stepsSkipped++;
        }
      }

      // Commit transaction if successful
      if (this.transactionState) {
        this.transactionState.status = 'committed';
        this.transactionState.endTime = Date.now();
      }

      // Call onComplete hook
      await this.config.hooks?.onComplete?.(context);

      // Emit pipeline complete event
      this.eventEmitter.emit({
        type: 'pipeline:complete',
        timestamp: Date.now(),
        source: this.config.id,
        payload: { 
          success: true,
          stepsExecuted,
          stepsFailed,
          stepsSkipped
        }
      });

      return {
        success: stepsFailed === 0,
        pipelineId: this.config.id,
        results: context.results,
        aggregatedOutput,
        executionTime: Date.now() - startTime,
        stepsExecuted,
        stepsFailed,
        stepsSkipped,
        rolledBack: false
      };

    } catch (error) {
      // Handle pipeline error
      await this.config.hooks?.onError?.(error as Error, context);

      // Attempt rollback if transactional
      let rolledBack = false;
      if (this.config.transactional && this.transactionState) {
        try {
          await this.rollback(context);
          rolledBack = true;
          this.transactionState.status = 'rolled-back';
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
          this.transactionState.status = 'failed';
        }
        this.transactionState.endTime = Date.now();
      }

      // Emit pipeline error event
      this.eventEmitter.emit({
        type: 'pipeline:error',
        timestamp: Date.now(),
        source: this.config.id,
        payload: { error, rolledBack }
      });

      return {
        success: false,
        pipelineId: this.config.id,
        results: context.results,
        aggregatedOutput,
        executionTime: Date.now() - startTime,
        stepsExecuted,
        stepsFailed: stepsFailed + 1,
        stepsSkipped,
        rolledBack,
        error: error as Error
      };
    }
  }

  /**
   * Execute a single pipeline step
   */
  private async executeStep(step: PipelineStep, context: PipelineContext): Promise<ToolResult> {
    const startTime = Date.now();
    context.currentStep++;

    try {
      // Check condition
      if (step.condition && !evaluateCondition(step.condition, context)) {
        return {
          success: true,
          toolName: step.tool.function.name,
          output: [],
          executionTime: 0,
          metadata: { skipped: true, reason: 'condition-not-met' }
        };
      }

      // Call onStepStart hook
      await this.config.hooks?.onStepStart?.(step, context);

      // Resolve dynamic arguments
      const args = typeof step.args === 'function' 
        ? step.args(context) 
        : { ...step.args };

      // Check cache
      if (step.cache?.enabled) {
        const cachedResult = this.cache.get(step.tool.function.name, args, step.cache);
        if (cachedResult) {
          this.eventEmitter.emit({
            type: 'tool:cache-hit',
            timestamp: Date.now(),
            source: step.tool.function.name,
            payload: { stepId: step.id }
          });
          context.results.set(step.id, cachedResult);
          return cachedResult;
        }
        this.eventEmitter.emit({
          type: 'tool:cache-miss',
          timestamp: Date.now(),
          source: step.tool.function.name,
          payload: { stepId: step.id }
        });
      }

      // Emit tool start event
      this.eventEmitter.emit({
        type: 'tool:start',
        timestamp: Date.now(),
        source: step.tool.function.name,
        payload: { stepId: step.id, args }
      });

      // Execute tool with timeout
      const output = await this.executeWithTimeout(
        () => callTool(step.tool, args, context.extras),
        step.timeout || this.config.timeout || 30000
      );

      let result: ToolResult = {
        success: true,
        toolName: step.tool.function.name,
        output,
        executionTime: Date.now() - startTime,
        cached: false
      };

      // Apply transformation if provided
      if (step.transform) {
        result = step.transform(result, context);
      }

      // Store result
      context.results.set(step.id, result);

      // Cache result if configured
      if (step.cache?.enabled) {
        this.cache.set(step.tool.function.name, args, result, step.cache);
      }

      // Record transaction operation
      if (this.transactionState) {
        this.transactionState.operations.push({
          stepId: step.id,
          toolName: step.tool.function.name,
          args,
          result,
          timestamp: Date.now()
        });

        // Add rollback operation if reversible
        const rollbackStep = this.config.rollbackSteps?.find(r => r.forStepId === step.id);
        if (rollbackStep) {
          this.transactionState.rollbackStack.push({
            forOperationStepId: step.id,
            toolName: rollbackStep.tool.function.name,
            args: rollbackStep.args(args, result, context),
            executed: false
          });
        }
      }

      // Call onStepComplete hook
      await this.config.hooks?.onStepComplete?.(step, result, context);

      // Emit tool complete event
      this.eventEmitter.emit({
        type: 'tool:complete',
        timestamp: Date.now(),
        source: step.tool.function.name,
        payload: { stepId: step.id, result }
      });

      return result;

    } catch (error) {
      // Handle error based on configuration
      await this.config.hooks?.onStepError?.(step, error as Error, context);

      // Emit tool error event
      this.eventEmitter.emit({
        type: 'tool:error',
        timestamp: Date.now(),
        source: step.tool.function.name,
        payload: { stepId: step.id, error }
      });

      // Retry if configured
      if (step.retryConfig && step.retryConfig.maxRetries > 0) {
        return await this.executeWithRetry(step, context, error as Error);
      }

      const result: ToolResult = {
        success: false,
        toolName: step.tool.function.name,
        output: [],
        error: error as Error,
        executionTime: Date.now() - startTime
      };

      context.results.set(step.id, result);
      return result;
    }
  }

  /**
   * Execute a step with retry logic
   */
  private async executeWithRetry(
    step: PipelineStep, 
    context: PipelineContext, 
    lastError: Error,
    attempt: number = 1
  ): Promise<ToolResult> {
    const config = step.retryConfig!;
    
    if (attempt > config.maxRetries) {
      return {
        success: false,
        toolName: step.tool.function.name,
        output: [],
        error: lastError,
        executionTime: 0,
        metadata: { retriesExhausted: true, attempts: attempt }
      };
    }

    // Calculate backoff delay
    const delay = config.backoffMs * Math.pow(config.backoffMultiplier, attempt - 1);
    
    this.eventEmitter.emit({
      type: 'tool:retry',
      timestamp: Date.now(),
      source: step.tool.function.name,
      payload: { stepId: step.id, attempt, delay }
    });

    await this.sleep(delay);

    try {
      // Create a temporary step without retry config to avoid infinite recursion
      const stepWithoutRetry = { ...step, retryConfig: undefined };
      return await this.executeStep(stepWithoutRetry, context);
    } catch (error) {
      return await this.executeWithRetry(step, context, error as Error, attempt + 1);
    }
  }

  /**
   * Execute a parallel group of steps
   */
  private async executeParallelGroup(
    group: ParallelGroup, 
    context: PipelineContext
  ): Promise<ToolResult[]> {
    const steps = group.stepIds
      .map(id => this.config.steps.find(s => s.id === id))
      .filter((s): s is PipelineStep => s !== undefined);

    const maxConcurrency = group.maxConcurrency || steps.length;
    const results: ToolResult[] = [];

    // Execute in batches based on maxConcurrency
    for (let i = 0; i < steps.length; i += maxConcurrency) {
      const batch = steps.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map(step => this.executeStep(step, context))
      );

      results.push(...batchResults);

      // If waitForAll is false, return on first success
      if (!group.waitForAll && batchResults.some(r => r.success)) {
        break;
      }
    }

    // Aggregate results if configured
    if (group.aggregateResults && results.length > 0) {
      const aggregated = group.aggregateResults(results);
      return [aggregated];
    }

    return results;
  }

  /**
   * Rollback all operations in reverse order
   */
  private async rollback(context: PipelineContext): Promise<void> {
    if (!this.transactionState) return;

    this.eventEmitter.emit({
      type: 'pipeline:rollback',
      timestamp: Date.now(),
      source: this.config.id,
      payload: { transactionId: this.transactionState.id }
    });

    await this.config.hooks?.onRollback?.(context);

    // Execute rollback operations in reverse order
    const rollbackStack = [...this.transactionState.rollbackStack].reverse();
    
    for (const rollbackOp of rollbackStack) {
      if (rollbackOp.executed) continue;

      try {
        const rollbackStep = this.config.rollbackSteps?.find(
          r => r.forStepId === rollbackOp.forOperationStepId
        );
        
        if (rollbackStep) {
          const result = await callTool(
            rollbackStep.tool, 
            rollbackOp.args, 
            context.extras
          );
          
          rollbackOp.result = {
            success: true,
            toolName: rollbackStep.tool.function.name,
            output: result,
            executionTime: 0
          };
        }
        
        rollbackOp.executed = true;
      } catch (error) {
        console.error(`Rollback operation failed for step ${rollbackOp.forOperationStepId}:`, error);
        rollbackOp.result = {
          success: false,
          toolName: rollbackOp.toolName,
          output: [],
          error: error as Error,
          executionTime: 0
        };
      }
    }
  }

  /**
   * Build execution plan from steps and parallel groups
   */
  private buildExecutionPlan(): ExecutionPhase[] {
    const plan: ExecutionPhase[] = [];
    const processedSteps = new Set<string>();

    // First, add parallel groups
    for (const group of this.config.parallelGroups || []) {
      plan.push({
        type: 'parallel',
        group
      });
      group.stepIds.forEach(id => processedSteps.add(id));
    }

    // Then, add remaining steps sequentially
    for (const step of this.config.steps) {
      if (!processedSteps.has(step.id)) {
        plan.push({
          type: 'sequential',
          step
        });
      }
    }

    return plan;
  }

  /**
   * Determine if pipeline should stop on step error
   */
  private shouldStopOnError(
    step: PipelineStep, 
    result: ToolResult, 
    context: PipelineContext
  ): boolean {
    if (!step.onError) return true;
    if (step.onError === 'continue') return false;
    if (step.onError === 'stop') return true;
    if (step.onError === 'retry') return false;
    return true;
  }

  /**
   * Create initial pipeline context
   */
  private createContext(extras: ToolExtras): PipelineContext {
    return {
      pipelineId: this.config.id,
      results: new Map(),
      variables: new Map(),
      startTime: Date.now(),
      currentStep: 0,
      totalSteps: this.config.steps.length,
      abortController: new AbortController(),
      extras,
      metadata: {}
    };
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>, 
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Abort the pipeline execution
   */
  abort(): void {
    // This would be called on the context's abortController
    log.debug(`Aborting pipeline ${this.config.id}`);
  }
}

/**
 * Execution phase type for internal planning
 */
type ExecutionPhase = 
  | { type: 'sequential'; step: PipelineStep }
  | { type: 'parallel'; group: ParallelGroup }
  | { type: 'skipped'; stepId: string; reason: string };

/**
 * Pipeline builder for fluent API
 */
export class PipelineBuilder {
  private config: PipelineConfig;
  private currentStepIndex = 0;

  constructor(id: string, name: string) {
    this.config = {
      id,
      name,
      steps: [],
      parallelGroups: [],
      hooks: {}
    };
  }

  /**
   * Add a description
   */
  description(desc: string): this {
    this.config.description = desc;
    return this;
  }

  /**
   * Add a step to the pipeline
   */
  step(
    tool: Tool, 
    args: PipelineStep['args'],
    options?: Partial<Omit<PipelineStep, 'id' | 'tool' | 'args'>>
  ): this {
    const step: PipelineStep = {
      id: `step-${++this.currentStepIndex}`,
      tool,
      args,
      ...options
    };
    this.config.steps.push(step);
    return this;
  }

  /**
   * Add a named step
   */
  namedStep(
    id: string,
    tool: Tool, 
    args: PipelineStep['args'],
    options?: Partial<Omit<PipelineStep, 'id' | 'tool' | 'args'>>
  ): this {
    const step: PipelineStep = {
      id,
      tool,
      args,
      ...options
    };
    this.config.steps.push(step);
    return this;
  }

  /**
   * Add a parallel group
   */
  parallel(stepIds: string[], options?: Partial<Omit<ParallelGroup, 'id' | 'stepIds'>>): this {
    this.config.parallelGroups!.push({
      id: `parallel-${this.config.parallelGroups!.length + 1}`,
      stepIds,
      ...options
    });
    return this;
  }

  /**
   * Set pipeline hooks
   */
  hooks(hooks: PipelineHooks): this {
    this.config.hooks = { ...this.config.hooks, ...hooks };
    return this;
  }

  /**
   * Make pipeline transactional
   */
  transactional(rollbackSteps?: RollbackStep[]): this {
    this.config.transactional = true;
    this.config.rollbackSteps = rollbackSteps;
    return this;
  }

  /**
   * Set timeout
   */
  timeout(ms: number): this {
    this.config.timeout = ms;
    return this;
  }

  /**
   * Build the pipeline
   */
  build(): ToolPipeline {
    return new ToolPipeline(this.config);
  }
}

/**
 * Create a new pipeline builder
 */
export function createPipeline(id: string, name: string): PipelineBuilder {
  return new PipelineBuilder(id, name);
}
