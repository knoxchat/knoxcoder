import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { t } from '../i18n';
import { CheckpointManager } from './CheckpointManager';
import { fileSetsOverlap } from './manager/pathFilter';

export enum ConflictType {
    CONCURRENT_CHECKPOINT = 'concurrent_checkpoint',
    SESSION_MISMATCH = 'session_mismatch',
    WORKSPACE_CHANGE = 'workspace_change',
    FILE_MODIFICATION = 'file_modification',
    RESTORATION_CONFLICT = 'restoration_conflict'
}

export enum ResolutionStrategy {
    AUTO_RESOLVE = 'auto_resolve',
    PROMPT_USER = 'prompt_user',
    QUEUE_OPERATION = 'queue_operation',
    CANCEL_OPERATION = 'cancel_operation',
    CREATE_BACKUP = 'create_backup'
}

export interface ConflictInfo {
    type: ConflictType;
    description: string;
    affectedFiles: string[];
    sessionId: string;
    timestamp: Date;
    severity: 'low' | 'medium' | 'high';
    suggestedResolution: ResolutionStrategy;
    metadata: { [key: string]: any };
}

export interface ResolutionResult {
    success: boolean;
    strategy: ResolutionStrategy;
    message: string;
    backupCheckpointId?: string;
    modifiedFiles: string[];
}

export interface AcquireOperationRequest {
    operation: string;
    sessionId: string;
    affectedFiles: string[];
    workspacePath?: string;
    promptOnOverlap?: boolean;
    metadata?: { [key: string]: any };
}

export interface OperationLease extends ResolutionResult {
    operationId: string;
    release: () => Promise<void>;
}

interface ActiveOperation {
    id: string;
    operation: string;
    sessionId: string;
    affectedFiles: string[];
    workspacePath?: string;
    done: Promise<void>;
    resolveDone: () => void;
}

function noopRelease(): Promise<void> {
    return Promise.resolve();
}

function deniedLease(result: ResolutionResult): OperationLease {
    return {
        ...result,
        operationId: '',
        release: noopRelease,
    };
}

/**
 * Serializes overlapping checkpoint mutations (create / restore / delete / import).
 * Non-overlapping file sets may proceed in parallel. Empty affectedFiles means
 * the whole workspace and therefore overlaps every other operation.
 */
export class CheckpointConflictResolver {
    private static instance: CheckpointConflictResolver | undefined;
    private readonly activeOperations = new Map<string, ActiveOperation>();
    private conflictHistory: ConflictInfo[] = [];
    private registryChain: Promise<void> = Promise.resolve();

    static getInstance(): CheckpointConflictResolver {
        if (!CheckpointConflictResolver.instance) {
            CheckpointConflictResolver.instance = new CheckpointConflictResolver();
        }
        return CheckpointConflictResolver.instance;
    }

    /**
     * Hold a lease until the caller finishes the mutation. Prefer this over
     * {@link resolveConflict}, which is kept for callers that only need a check.
     */
    async acquire(request: AcquireOperationRequest): Promise<OperationLease> {
        const sessionId = request.sessionId || 'workspace';
        const affectedFiles = [...request.affectedFiles];
        const metadata = request.metadata ?? {};

        while (true) {
            const decision = await this.withRegistry(() => {
                const overlapping = this.findOverlapping(affectedFiles, request.workspacePath);
                if (overlapping.length === 0) {
                    return { kind: 'register' as const };
                }
                return {
                    kind: 'overlap' as const,
                    overlapping,
                    wait: overlapping.map((op) => op.done),
                };
            });

            if (decision.kind === 'register') {
                const op = await this.withRegistry(() => {
                    const stillOverlapping = this.findOverlapping(affectedFiles, request.workspacePath);
                    if (stillOverlapping.length > 0) {
                        return null;
                    }
                    return this.register(request.operation, sessionId, affectedFiles, request.workspacePath);
                });
                if (!op) {
                    continue;
                }
                return {
                    success: true,
                    strategy: ResolutionStrategy.AUTO_RESOLVE,
                    message: 'No conflicts detected',
                    modifiedFiles: affectedFiles,
                    operationId: op.id,
                    release: () => this.release(op.id),
                };
            }

            const conflict: ConflictInfo = {
                type: ConflictType.CONCURRENT_CHECKPOINT,
                description: `Concurrent checkpoint operations on overlapping files (${decision.overlapping.map((op) => op.operation).join(', ')})`,
                affectedFiles,
                sessionId,
                timestamp: new Date(),
                severity: 'high',
                suggestedResolution: request.promptOnOverlap
                    ? ResolutionStrategy.PROMPT_USER
                    : ResolutionStrategy.QUEUE_OPERATION,
                metadata: {
                    concurrentOperations: decision.overlapping.map((op) => op.id),
                    ...metadata,
                },
            };
            this.conflictHistory.push(conflict);

            if (request.promptOnOverlap) {
                const prompted = await this.promptUser(conflict, conflict.metadata.concurrentOperations[0] ?? '');
                if (!prompted.success) {
                    return deniedLease(prompted);
                }
            }

            await Promise.all(decision.wait);
        }
    }

    async release(operationId: string): Promise<void> {
        if (!operationId) {
            return;
        }
        await this.withRegistry(() => {
            const op = this.activeOperations.get(operationId);
            if (!op) {
                return;
            }
            this.activeOperations.delete(operationId);
            op.resolveDone();
        });
    }

    /**
     * Detect and resolve conflicts before checkpoint operations.
     * The returned lease must be {@link OperationLease.release}d after the
     * mutation finishes; otherwise later overlapping ops wait forever.
     */
    async resolveConflict(
        operation: string,
        sessionId: string,
        affectedFiles: string[],
        metadata: { [key: string]: any } = {},
    ): Promise<OperationLease> {
        try {
            return await this.acquire({
                operation,
                sessionId,
                affectedFiles,
                workspacePath: metadata.workspacePath,
                promptOnOverlap: metadata.promptOnOverlap === true,
                metadata,
            });
        } catch (error) {
            console.error('❌ Error resolving checkpoint conflict:', error);
            return deniedLease({
                success: false,
                strategy: ResolutionStrategy.CANCEL_OPERATION,
                message: `Conflict resolution failed: ${error}`,
                modifiedFiles: [],
            });
        }
    }

    private findOverlapping(affectedFiles: string[], workspacePath?: string): ActiveOperation[] {
        return [...this.activeOperations.values()].filter((op) =>
            fileSetsOverlap(workspacePath ?? op.workspacePath, affectedFiles, op.affectedFiles),
        );
    }

    private register(
        operation: string,
        sessionId: string,
        affectedFiles: string[],
        workspacePath?: string,
    ): ActiveOperation {
        let resolveDone: () => void = () => undefined;
        const done = new Promise<void>((resolve) => {
            resolveDone = resolve;
        });
        const op: ActiveOperation = {
            id: `${operation}_${sessionId.slice(0, 8)}_${randomUUID()}`,
            operation,
            sessionId,
            affectedFiles,
            workspacePath,
            done,
            resolveDone,
        };
        this.activeOperations.set(op.id, op);
        return op;
    }

    private withRegistry<T>(fn: () => T | Promise<T>): Promise<T> {
        let release!: () => void;
        const next = new Promise<void>((resolve) => {
            release = resolve;
        });
        const previous = this.registryChain;
        this.registryChain = previous.then(() => next, () => next);
        return previous.then(async () => {
            try {
                return await fn();
            } finally {
                release();
            }
        });
    }

    /**
     * Execute conflict resolution strategy (kept for strategy-unit tests).
     * Does not register a live lease — use {@link acquire} for real ops.
     */
    async executeResolution(conflict: ConflictInfo, operationId: string): Promise<ResolutionResult> {
        switch (conflict.suggestedResolution) {
            case ResolutionStrategy.AUTO_RESOLVE:
                return this.autoResolve(conflict, operationId);

            case ResolutionStrategy.PROMPT_USER:
                return this.promptUser(conflict, operationId);

            case ResolutionStrategy.QUEUE_OPERATION:
                return this.queueOperation(conflict, operationId);

            case ResolutionStrategy.CREATE_BACKUP:
                return this.createBackup(conflict, operationId);

            case ResolutionStrategy.CANCEL_OPERATION:
                return {
                    success: false,
                    strategy: ResolutionStrategy.CANCEL_OPERATION,
                    message: `Operation cancelled due to ${conflict.type}`,
                    modifiedFiles: [],
                };

            default:
                return this.autoResolve(conflict, operationId);
        }
    }

    private async autoResolve(conflict: ConflictInfo, operationId: string): Promise<ResolutionResult> {
        console.log(`🔄 Auto-resolving conflict: ${conflict.description}`);

        if (conflict.severity === 'low') {
            return {
                success: true,
                strategy: ResolutionStrategy.AUTO_RESOLVE,
                message: 'Conflict auto-resolved, proceeding with operation',
                modifiedFiles: conflict.affectedFiles,
            };
        }

        return this.createBackup(conflict, operationId);
    }

    private async promptUser(conflict: ConflictInfo, operationId: string): Promise<ResolutionResult> {
        const continueLabel = t('checkpoint.conflict.continueWithBackup');
        const queueLabel = t('checkpoint.conflict.queueOperation');
        const cancelLabel = t('checkpoint.conflict.cancelOperation');

        const choice = await vscode.window.showWarningMessage(
            t('checkpoint.conflict.prompt', { description: conflict.description }),
            { modal: true },
            continueLabel,
            queueLabel,
            cancelLabel,
        );

        switch (choice) {
            case continueLabel:
                return this.createBackup(conflict, operationId);

            case queueLabel:
                return this.queueOperation(conflict, operationId);

            default:
                return {
                    success: false,
                    strategy: ResolutionStrategy.CANCEL_OPERATION,
                    message: t('checkpoint.conflict.cancelledByUser'),
                    modifiedFiles: [],
                };
        }
    }

    private async queueOperation(conflict: ConflictInfo, operationId: string): Promise<ResolutionResult> {
        console.log(`⏳ Queueing operation: ${operationId}`);

        const concurrentOps = (conflict.metadata.concurrentOperations as string[]) || [];
        await Promise.all(
            concurrentOps.map((opId) => this.activeOperations.get(opId)?.done ?? Promise.resolve()),
        );

        return {
            success: true,
            strategy: ResolutionStrategy.QUEUE_OPERATION,
            message: 'Operation queued and will proceed after conflicts resolve',
            modifiedFiles: conflict.affectedFiles,
        };
    }

    private async createBackup(conflict: ConflictInfo, operationId: string): Promise<ResolutionResult> {
        try {
            console.log(`💾 Creating backup before resolving conflict: ${conflict.description}`);

            const checkpointManager = CheckpointManager.getInstance();
            const backupId = await checkpointManager.createManualCheckpoint({
                description: `Backup before conflict resolution - ${conflict.type}`,
                tags: ['backup', 'conflict-resolution'],
                includeFiles: conflict.affectedFiles.length > 0 ? conflict.affectedFiles : undefined,
            });

            return {
                success: true,
                strategy: ResolutionStrategy.CREATE_BACKUP,
                message: 'Backup created, proceeding with operation',
                backupCheckpointId: backupId,
                modifiedFiles: conflict.affectedFiles,
            };
        } catch (error) {
            console.error('❌ Failed to create backup:', error);
            return {
                success: false,
                strategy: ResolutionStrategy.CANCEL_OPERATION,
                message: `Failed to create backup: ${error}`,
                modifiedFiles: [],
            };
        }
    }

    getConflictStats(): {
        totalConflicts: number;
        conflictsByType: { [key: string]: number };
        recentConflicts: ConflictInfo[];
        activeOperations: number;
    } {
        const conflictsByType: { [key: string]: number } = {};
        for (const conflict of this.conflictHistory) {
            conflictsByType[conflict.type] = (conflictsByType[conflict.type] || 0) + 1;
        }

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentConflicts = this.conflictHistory.filter((c) => c.timestamp > oneHourAgo);

        return {
            totalConflicts: this.conflictHistory.length,
            conflictsByType,
            recentConflicts,
            activeOperations: this.activeOperations.size,
        };
    }

    cleanupHistory(): void {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        this.conflictHistory = this.conflictHistory.filter((c) => c.timestamp > oneDayAgo);
    }

    dispose(): void {
        for (const op of this.activeOperations.values()) {
            op.resolveDone();
        }
        this.activeOperations.clear();
        this.conflictHistory = [];
    }
}
