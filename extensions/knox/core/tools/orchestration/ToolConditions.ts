/**
 * Tool Conditions - Conditional execution logic for pipelines
 * 
 * Features:
 * - Simple predicates
 * - Result-based conditions
 * - Logical operators (AND, OR, NOT)
 * - Pattern matching
 * - Custom condition functions
 */

import { PipelineContext, ToolCondition, ToolResult } from "./types.js";

/**
 * Evaluate a condition against the pipeline context
 */
export function evaluateCondition(
  condition: ToolCondition, 
  context: PipelineContext
): boolean {
  switch (condition.type) {
    case 'always':
      return true;

    case 'never':
      return false;

    case 'if':
      return condition.predicate(context);

    case 'ifResult':
      const result = context.results.get(condition.stepId);
      if (!result) return false;
      return condition.check(result);

    case 'ifAny':
      return condition.conditions.some(c => evaluateCondition(c, context));

    case 'ifAll':
      return condition.conditions.every(c => evaluateCondition(c, context));

    case 'ifNot':
      return !evaluateCondition(condition.condition, context);

    case 'ifError':
      const errorResult = context.results.get(condition.stepId);
      return errorResult ? !errorResult.success : false;

    case 'ifSuccess':
      const successResult = context.results.get(condition.stepId);
      return successResult ? successResult.success : false;

    case 'ifContains':
      const containsResult = context.results.get(condition.stepId);
      if (!containsResult) return false;
      const content = containsResult.output
        .map(item => item.content)
        .join('\n');
      if (typeof condition.pattern === 'string') {
        return content.includes(condition.pattern);
      }
      return condition.pattern.test(content);

    default:
      return false;
  }
}

/**
 * Condition builder for fluent API
 */
export class ConditionBuilder {
  private condition: ToolCondition;

  private constructor(condition: ToolCondition) {
    this.condition = condition;
  }

  /**
   * Always execute
   */
  static always(): ConditionBuilder {
    return new ConditionBuilder({ type: 'always' });
  }

  /**
   * Never execute
   */
  static never(): ConditionBuilder {
    return new ConditionBuilder({ type: 'never' });
  }

  /**
   * Execute if predicate is true
   */
  static if(predicate: (context: PipelineContext) => boolean): ConditionBuilder {
    return new ConditionBuilder({ type: 'if', predicate });
  }

  /**
   * Execute if step result matches check
   */
  static ifResult(stepId: string, check: (result: ToolResult) => boolean): ConditionBuilder {
    return new ConditionBuilder({ type: 'ifResult', stepId, check });
  }

  /**
   * Execute if step succeeded
   */
  static ifSuccess(stepId: string): ConditionBuilder {
    return new ConditionBuilder({ type: 'ifSuccess', stepId });
  }

  /**
   * Execute if step failed
   */
  static ifError(stepId: string): ConditionBuilder {
    return new ConditionBuilder({ type: 'ifError', stepId });
  }

  /**
   * Execute if step output contains pattern
   */
  static ifContains(stepId: string, pattern: string | RegExp): ConditionBuilder {
    return new ConditionBuilder({ type: 'ifContains', stepId, pattern });
  }

  /**
   * Execute if variable exists in context
   */
  static ifVariableExists(varName: string): ConditionBuilder {
    return new ConditionBuilder({
      type: 'if',
      predicate: (context) => context.variables.has(varName)
    });
  }

  /**
   * Execute if variable equals value
   */
  static ifVariableEquals(varName: string, value: any): ConditionBuilder {
    return new ConditionBuilder({
      type: 'if',
      predicate: (context) => context.variables.get(varName) === value
    });
  }

  /**
   * Execute if output is empty
   */
  static ifOutputEmpty(stepId: string): ConditionBuilder {
    return new ConditionBuilder({
      type: 'ifResult',
      stepId,
      check: (result) => result.output.length === 0 || 
        result.output.every(item => !item.content || item.content.trim() === '')
    });
  }

  /**
   * Execute if output is not empty
   */
  static ifOutputNotEmpty(stepId: string): ConditionBuilder {
    return new ConditionBuilder({
      type: 'ifResult',
      stepId,
      check: (result) => result.output.length > 0 && 
        result.output.some(item => item.content && item.content.trim() !== '')
    });
  }

  /**
   * Combine with AND
   */
  and(other: ConditionBuilder): ConditionBuilder {
    return new ConditionBuilder({
      type: 'ifAll',
      conditions: [this.condition, other.condition]
    });
  }

  /**
   * Combine with OR
   */
  or(other: ConditionBuilder): ConditionBuilder {
    return new ConditionBuilder({
      type: 'ifAny',
      conditions: [this.condition, other.condition]
    });
  }

  /**
   * Negate condition
   */
  not(): ConditionBuilder {
    return new ConditionBuilder({
      type: 'ifNot',
      condition: this.condition
    });
  }

  /**
   * Build the condition
   */
  build(): ToolCondition {
    return this.condition;
  }
}

/**
 * Predefined common conditions
 */
export const CommonConditions = {
  /**
   * Execute only if previous step found files
   */
  filesFound: (stepId: string) => ConditionBuilder.ifOutputNotEmpty(stepId).build(),

  /**
   * Execute only if no errors in previous step
   */
  noErrors: (stepId: string) => ConditionBuilder.ifSuccess(stepId).build(),

  /**
   * Execute only if search found results
   */
  searchHasResults: (stepId: string) => ConditionBuilder.ifResult(stepId, (result) => {
    const content = result.output.map(item => item.content).join('');
    return content.length > 0 && !content.includes('No results found');
  }).build(),

  /**
   * Execute only if file exists check passed
   */
  fileExists: (stepId: string) => ConditionBuilder.ifResult(stepId, (result) => {
    return result.success && result.output.length > 0;
  }).build(),

  /**
   * Execute only if command succeeded
   */
  commandSucceeded: (stepId: string) => ConditionBuilder.ifResult(stepId, (result) => {
    const content = result.output.map(item => item.content).join('');
    return result.success && !content.toLowerCase().includes('error');
  }).build(),

  /**
   * Execute only in development mode
   */
  isDevelopment: () => ConditionBuilder.if((context) => 
    context.variables.get('environment') === 'development' ||
    process.env.NODE_ENV === 'development'
  ).build(),

  /**
   * Execute based on time of day
   */
  duringBusinessHours: () => ConditionBuilder.if(() => {
    const hour = new Date().getHours();
    return hour >= 9 && hour < 17;
  }).build(),

  /**
   * Execute if step took longer than threshold
   */
  stepWasSlow: (stepId: string, thresholdMs: number) => ConditionBuilder.ifResult(
    stepId, 
    (result) => result.executionTime > thresholdMs
  ).build()
};

/**
 * Create condition from expression string (simple DSL)
 * Examples:
 * - "step1.success"
 * - "step1.success && step2.success"
 * - "step1.contains('error')"
 * - "!step1.empty"
 */
export function parseConditionExpression(expression: string): ToolCondition {
  // Simple parser for common patterns
  const trimmed = expression.trim();

  // Handle NOT
  if (trimmed.startsWith('!')) {
    return {
      type: 'ifNot',
      condition: parseConditionExpression(trimmed.slice(1))
    };
  }

  // Handle AND
  if (trimmed.includes(' && ')) {
    const parts = trimmed.split(' && ');
    return {
      type: 'ifAll',
      conditions: parts.map(p => parseConditionExpression(p))
    };
  }

  // Handle OR
  if (trimmed.includes(' || ')) {
    const parts = trimmed.split(' || ');
    return {
      type: 'ifAny',
      conditions: parts.map(p => parseConditionExpression(p))
    };
  }

  // Handle step.success
  const successMatch = trimmed.match(/^(\w+)\.success$/);
  if (successMatch) {
    return { type: 'ifSuccess', stepId: successMatch[1] };
  }

  // Handle step.error
  const errorMatch = trimmed.match(/^(\w+)\.error$/);
  if (errorMatch) {
    return { type: 'ifError', stepId: errorMatch[1] };
  }

  // Handle step.contains('pattern')
  const containsMatch = trimmed.match(/^(\w+)\.contains\(['"](.+)['"]\)$/);
  if (containsMatch) {
    return { type: 'ifContains', stepId: containsMatch[1], pattern: containsMatch[2] };
  }

  // Handle step.empty
  const emptyMatch = trimmed.match(/^(\w+)\.empty$/);
  if (emptyMatch) {
    return {
      type: 'ifResult',
      stepId: emptyMatch[1],
      check: (result) => result.output.length === 0
    };
  }

  // Default: always
  console.warn(`Could not parse condition expression: ${expression}, defaulting to always`);
  return { type: 'always' };
}

/**
 * Condition validator
 */
export function validateCondition(
  condition: ToolCondition, 
  availableStepIds: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  function validate(cond: ToolCondition): void {
    switch (cond.type) {
      case 'ifResult':
      case 'ifError':
      case 'ifSuccess':
      case 'ifContains':
        if (!availableStepIds.includes(cond.stepId)) {
          errors.push(`Condition references unknown step: ${cond.stepId}`);
        }
        break;
      case 'ifAny':
      case 'ifAll':
        cond.conditions.forEach(validate);
        break;
      case 'ifNot':
        validate(cond.condition);
        break;
    }
  }

  validate(condition);

  return {
    valid: errors.length === 0,
    errors
  };
}
