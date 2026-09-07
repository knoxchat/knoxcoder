/**
 * Tool Transaction - Atomic operations with rollback support
 * 
 * Features:
 * - ACID-like semantics for tool operations
 * - Automatic rollback on failure
 * - Savepoints for partial rollback
 * - Transaction isolation
 * - Nested transactions
 */

import { ContextItem, Tool, ToolExtras } from "../..";
import { callToolRaw as callTool } from "../callTool.js";
import { ToolEventEmitter } from "./ToolEvents.js";
import {
  applyDefaultFileRollback,
  capturePriorFileState,
  isFileMutatingTool,
} from "./transactionRollback.js";
import { TransactionOperation } from "./types.js";

type TransactionStatus = 'active' | 'committed' | 'rolled-back' | 'failed';

interface Savepoint {
  id: string;
  operationIndex: number;
  timestamp: number;
}

/**
 * Tool Transaction Manager - Manages atomic tool operations
 */
export class ToolTransaction {
  private id: string;
  private status: TransactionStatus = 'active';
  private operations: TransactionOperation[] = [];
  private rollbackHandlers: Map<string, (op: TransactionOperation) => Promise<void>> = new Map();
  private savepoints: Savepoint[] = [];
  private startTime: number;
  private endTime?: number;
  private extras: ToolExtras;
  private eventEmitter: ToolEventEmitter;
  private parentTransaction?: ToolTransaction;
  private childTransactions: ToolTransaction[] = [];

  constructor(extras: ToolExtras, parentTransaction?: ToolTransaction) {
    this.id = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.startTime = Date.now();
    this.extras = extras;
    this.eventEmitter = ToolEventEmitter.getInstance();
    this.parentTransaction = parentTransaction;

    if (parentTransaction) {
      parentTransaction.childTransactions.push(this);
    }
  }

  /**
   * Get transaction ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get transaction status
   */
  getStatus(): TransactionStatus {
    return this.status;
  }

  /**
   * Execute a tool within this transaction
   */
  async execute(
    tool: Tool,
    args: Record<string, any>,
    rollbackHandler?: (op: TransactionOperation) => Promise<void>
  ): Promise<ContextItem[]> {
    if (this.status !== 'active') {
      throw new Error(`Cannot execute in transaction with status: ${this.status}`);
    }

    const operationId = `op-${this.operations.length + 1}`;
    const toolName = tool.function.name;
    const operation: TransactionOperation = {
      stepId: operationId,
      toolName,
      args,
      timestamp: Date.now(),
    };

    // Capture prior file state so defaultRollback can restore/delete.
    if (isFileMutatingTool(toolName)) {
      try {
        operation.priorFileState = await capturePriorFileState(
          toolName,
          args,
          this.extras.ide,
        );
      } catch {
        operation.priorFileState = null;
      }
    }

    try {
      // Execute the tool
      const output = await callTool(tool, args, this.extras);
      
      operation.result = {
        success: true,
        toolName: tool.function.name,
        output,
        executionTime: Date.now() - operation.timestamp
      };

      // Record operation
      this.operations.push(operation);

      // Register rollback handler if provided
      if (rollbackHandler) {
        this.rollbackHandlers.set(operationId, rollbackHandler);
      }

      return output;

    } catch (error) {
      operation.result = {
        success: false,
        toolName: tool.function.name,
        output: [],
        error: error as Error,
        executionTime: Date.now() - operation.timestamp
      };

      this.operations.push(operation);

      // Auto-rollback on error by default
      await this.rollback();
      throw error;
    }
  }

  /**
   * Create a savepoint
   */
  savepoint(name: string): string {
    const savepoint: Savepoint = {
      id: name,
      operationIndex: this.operations.length,
      timestamp: Date.now()
    };
    this.savepoints.push(savepoint);
    return name;
  }

  /**
   * Rollback to a savepoint
   */
  async rollbackToSavepoint(savepointName: string): Promise<void> {
    const savepoint = this.savepoints.find(s => s.id === savepointName);
    if (!savepoint) {
      throw new Error(`Savepoint not found: ${savepointName}`);
    }

    // Rollback operations after savepoint
    const operationsToRollback = this.operations.slice(savepoint.operationIndex).reverse();
    
    for (const operation of operationsToRollback) {
      await this.rollbackOperation(operation);
    }

    // Remove rolled back operations
    this.operations = this.operations.slice(0, savepoint.operationIndex);

    // Remove savepoints after this one
    const savepointIndex = this.savepoints.findIndex(s => s.id === savepointName);
    this.savepoints = this.savepoints.slice(0, savepointIndex + 1);
  }

  /**
   * Commit the transaction
   */
  async commit(): Promise<void> {
    if (this.status !== 'active') {
      throw new Error(`Cannot commit transaction with status: ${this.status}`);
    }

    // Commit child transactions first
    for (const child of this.childTransactions) {
      if (child.getStatus() === 'active') {
        await child.commit();
      }
    }

    this.status = 'committed';
    this.endTime = Date.now();

    this.eventEmitter.emit({
      type: 'pipeline:complete',
      timestamp: Date.now(),
      source: this.id,
      payload: {
        transactionId: this.id,
        operationCount: this.operations.length,
        duration: this.endTime - this.startTime
      }
    });
  }

  /**
   * Rollback the entire transaction
   */
  async rollback(): Promise<void> {
    if (this.status === 'rolled-back') {
      return; // Already rolled back
    }

    // Rollback child transactions first
    for (const child of this.childTransactions) {
      if (child.getStatus() === 'active') {
        await child.rollback();
      }
    }

    this.eventEmitter.emit({
      type: 'pipeline:rollback',
      timestamp: Date.now(),
      source: this.id,
      payload: { transactionId: this.id }
    });

    // Rollback operations in reverse order
    const operationsToRollback = [...this.operations].reverse();
    
    for (const operation of operationsToRollback) {
      try {
        await this.rollbackOperation(operation);
      } catch (error) {
        console.error(`Rollback failed for operation ${operation.stepId}:`, error);
        this.status = 'failed';
        throw error;
      }
    }

    this.status = 'rolled-back';
    this.endTime = Date.now();
  }

  /**
   * Rollback a single operation
   */
  private async rollbackOperation(operation: TransactionOperation): Promise<void> {
    const handler = this.rollbackHandlers.get(operation.stepId);
    
    if (handler) {
      await handler(operation);
    } else {
      // Default rollback strategies based on tool type
      await this.defaultRollback(operation);
    }
  }

  /**
   * Default rollback for file-mutating tools using captured prior state.
   * Terminal commands cannot be auto-rolled back (warn only).
   * Explicit `rollback` handlers still take precedence when provided.
   * Not used by the default chat path.
   */
  private async defaultRollback(operation: TransactionOperation): Promise<void> {
    // Skip failed ops that never mutated successfully (except we still
    // attempt restore if a partial write may have occurred).
    if (operation.result?.success === false && !operation.priorFileState) {
      return;
    }

    await applyDefaultFileRollback(
      operation.toolName,
      operation.args,
      operation.priorFileState,
      this.extras.ide,
    );
  }

  /**
   * Begin a nested transaction
   */
  beginNested(): ToolTransaction {
    return new ToolTransaction(this.extras, this);
  }

  /**
   * Get transaction summary
   */
  getSummary(): TransactionSummary {
    return {
      id: this.id,
      status: this.status,
      operationCount: this.operations.length,
      savepointCount: this.savepoints.length,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime,
      operations: this.operations.map(op => ({
        stepId: op.stepId,
        toolName: op.toolName,
        success: op.result?.success ?? false,
        timestamp: op.timestamp
      })),
      childTransactions: this.childTransactions.map(c => c.getSummary())
    };
  }
}

/**
 * Transaction summary type
 */
interface TransactionSummary {
  id: string;
  status: TransactionStatus;
  operationCount: number;
  savepointCount: number;
  startTime: number;
  endTime?: number;
  duration: number;
  operations: {
    stepId: string;
    toolName: string;
    success: boolean;
    timestamp: number;
  }[];
  childTransactions: TransactionSummary[];
}

/**
 * Transaction manager - Manages multiple transactions
 */
export class TransactionManager {
  private static instance: TransactionManager;
  private activeTransactions: Map<string, ToolTransaction> = new Map();
  private completedTransactions: TransactionSummary[] = [];
  private maxCompletedHistory: number = 100;

  private constructor() {}

  public static getInstance(): TransactionManager {
    if (!TransactionManager.instance) {
      TransactionManager.instance = new TransactionManager();
    }
    return TransactionManager.instance;
  }

  /**
   * Begin a new transaction
   */
  begin(extras: ToolExtras): ToolTransaction {
    const transaction = new ToolTransaction(extras);
    this.activeTransactions.set(transaction.getId(), transaction);
    return transaction;
  }

  /**
   * Get active transaction by ID
   */
  get(id: string): ToolTransaction | undefined {
    return this.activeTransactions.get(id);
  }

  /**
   * Complete a transaction (commit or rollback)
   */
  async complete(id: string, commit: boolean = true): Promise<void> {
    const transaction = this.activeTransactions.get(id);
    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    if (commit) {
      await transaction.commit();
    } else {
      await transaction.rollback();
    }

    // Move to completed
    this.completedTransactions.push(transaction.getSummary());
    if (this.completedTransactions.length > this.maxCompletedHistory) {
      this.completedTransactions.shift();
    }

    this.activeTransactions.delete(id);
  }

  /**
   * Get all active transactions
   */
  getActiveTransactions(): ToolTransaction[] {
    return [...this.activeTransactions.values()];
  }

  /**
   * Get completed transaction history
   */
  getCompletedTransactions(): TransactionSummary[] {
    return [...this.completedTransactions];
  }

  /**
   * Rollback all active transactions
   */
  async rollbackAll(): Promise<void> {
    for (const transaction of this.activeTransactions.values()) {
      try {
        await transaction.rollback();
        this.completedTransactions.push(transaction.getSummary());
      } catch (error) {
        console.error(`Failed to rollback transaction ${transaction.getId()}:`, error);
      }
    }
    this.activeTransactions.clear();
  }
}

/**
 * Transaction decorator for functions
 */
export function transactional(extras: ToolExtras) {
  return function<T extends (...args: any[]) => Promise<any>>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> | void {
    const originalMethod = descriptor.value!;

    descriptor.value = async function(this: any, ...args: any[]) {
      const manager = TransactionManager.getInstance();
      const transaction = manager.begin(extras);

      try {
        // Execute the method
        const result = await originalMethod.apply(this, args);
        
        // Commit on success
        await transaction.commit();
        
        return result;
      } catch (error) {
        // Rollback on error
        await transaction.rollback();
        throw error;
      }
    } as T;

    return descriptor;
  };
}

/**
 * Execute multiple tools atomically
 */
export async function atomic(
  extras: ToolExtras,
  operations: Array<{
    tool: Tool;
    args: Record<string, any>;
    rollback?: (op: TransactionOperation) => Promise<void>;
  }>
): Promise<ContextItem[][]> {
  const transaction = new ToolTransaction(extras);
  const results: ContextItem[][] = [];

  try {
    for (const op of operations) {
      const result = await transaction.execute(op.tool, op.args, op.rollback);
      results.push(result);
    }

    await transaction.commit();
    return results;
  } catch (error) {
    // Transaction already rolled back in execute()
    throw error;
  }
}
