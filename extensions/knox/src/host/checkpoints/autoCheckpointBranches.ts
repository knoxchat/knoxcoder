import * as vscode from 'vscode';
import { createKnoxLogger } from 'core/util/knoxLog';
import { t } from '../i18n';
import type { CheckpointManager } from './CheckpointManager';
import type { CheckpointBranch } from './AutoCheckpointSystem';

const log = createKnoxLogger('AutoCheckpoint');

type BranchLike = {
    id: string;
    name: string;
    headCheckpointId: string;
    baseCheckpointId: string;
    parentBranchId?: string;
    createdAt: Date | string;
    description?: string;
};

export interface BranchControllerDeps {
    /** Checkpoint the undo stack currently points at, if any. */
    currentUndoCheckpointId(): string | undefined;
    onChanged(branchId: string): void;
}

/** Branch operations for AutoCheckpointSystem (split out; no logic change). */
export class AutoCheckpointBranches {
    readonly branches: Map<string, CheckpointBranch> = new Map();
    currentBranchId: string | null = null;

    constructor(
        private readonly manager: () => CheckpointManager,
        private readonly deps: BranchControllerDeps,
    ) {}

    
    toLocalBranch(branch: BranchLike): CheckpointBranch {
        return {
            id: branch.id,
            name: branch.name,
            headCheckpointId: branch.headCheckpointId,
            baseCheckpointId: branch.baseCheckpointId,
            parentBranchId: branch.parentBranchId,
            checkpoints: [branch.headCheckpointId],
            createdAt: branch.createdAt instanceof Date ? branch.createdAt : new Date(branch.createdAt),
            description: branch.description || '',
        };
    }

    cacheBranches(branches: BranchLike[]): CheckpointBranch[] {
        this.branches.clear();
        const mapped = branches.map((branch) => this.toLocalBranch(branch));
        for (const branch of mapped) {
            this.branches.set(branch.id, branch);
        }
        return mapped;
    }

    /**
     * Create a new branch from the current checkpoint. Does not restore files.
     */
    async createBranch(name: string, description: string = ''): Promise<CheckpointBranch | null> {
        const history = this.manager().getCheckpointHistoryForWorkspace?.()
            ?? this.manager().getCheckpointHistory();
        const currentCheckpointId = this.deps.currentUndoCheckpointId()
            || history[history.length - 1]?.id;
        if (!currentCheckpointId) {
            vscode.window.showWarningMessage(t('checkpoint.auto.noBranch'));
            return null;
        }

        try {
            const created = await this.manager().createBranch(name, currentCheckpointId, description);
            if (!created) {
                vscode.window.showErrorMessage(t('checkpoint.auto.failedCreateBranch'));
                return null;
            }

            const branch = this.toLocalBranch(created);
            this.branches.set(branch.id, branch);
            this.currentBranchId = branch.id;
            this.deps.onChanged(branch.id);
            vscode.window.showInformationMessage(t('checkpoint.auto.createdBranch', { name: branch.name }));
            return branch;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.debug('Failed to create checkpoint branch:', message);
            vscode.window.showErrorMessage(message);
            return null;
        }
    }

    /**
     * Switch the active capture line and restore that line's head (CP-39).
     */
    async switchBranch(branchId: string, options?: { offerRestore?: boolean }): Promise<boolean> {
        try {
            const switched = await this.manager().switchBranch(branchId);
            if (!switched.success) {
                vscode.window.showWarningMessage(
                    switched.message || t('checkpoint.auto.branchNotFound'),
                );
                return false;
            }
            this.currentBranchId = branchId;
            this.deps.onChanged(branchId);

            const branches = await this.manager().listBranches();
            this.cacheBranches(branches);
            const branch = branches.find((item: { id: string }) => item.id === branchId);
            if (branch) {
                vscode.window.showInformationMessage(
                    t('checkpoint.auto.checkedOutBranch', { name: branch.name }),
                );
            }
            void options;
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.debug('Failed to switch checkpoint branch:', message);
            vscode.window.showErrorMessage(message);
            return false;
        }
    }

    /**
     * Merge a branch into the current branch using three-way file hashes.
     */
    async mergeBranch(sourceBranchId: string, strategy: string = 'ThreeWay'): Promise<boolean> {
        try {
            const current = this.manager().getActiveBranch?.()
                ?? (this.currentBranchId ? { id: this.currentBranchId } : undefined);
            if (!current?.id) {
                vscode.window.showErrorMessage(t('checkpoint.auto.noCurrentBranchToMerge'));
                return false;
            }

            const result = await this.manager().mergeBranches(
                sourceBranchId,
                current.id,
                strategy,
            );

            if (result.success) {
                const sourceBranch = this.branches.get(sourceBranchId);
                vscode.window.showInformationMessage(
                    t('checkpoint.auto.mergedBranch', { name: sourceBranch?.name || sourceBranchId }),
                );
                return true;
            }
            if (result.conflicts && result.conflicts.length > 0) {
                const paths = result.conflicts.map((conflict: { path: string }) => conflict.path).join(', ');
                vscode.window.showWarningMessage(
                    t('checkpoint.auto.mergeConflicts', { count: result.conflicts.length, paths }),
                );
            }
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.debug('Failed to merge checkpoint branch:', message);
            vscode.window.showErrorMessage(message);
            return false;
        }
    }

    async getBranches(): Promise<CheckpointBranch[]> {
        try {
            const listed = await this.manager().listBranches();
            return this.cacheBranches(listed);
        } catch {
            return [...this.branches.values()];
        }
    }

    getCurrentBranch(): CheckpointBranch | null {
        if (this.currentBranchId) {
            return this.branches.get(this.currentBranchId) || null;
        }
        const active = this.manager().getActiveBranch?.();
        return active ? this.toLocalBranch(active) : null;
    }

    async deleteBranch(branchId: string): Promise<boolean> {
        if (branchId === this.currentBranchId) {
            vscode.window.showWarningMessage(t('checkpoint.auto.cannotDeleteCurrent'));
            return false;
        }

        try {
            await this.manager().deleteBranch(branchId);
            this.branches.delete(branchId);
            vscode.window.showInformationMessage(t('checkpoint.auto.deletedBranch'));
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.debug('Failed to delete checkpoint branch:', message);
            vscode.window.showErrorMessage(message);
            return false;
        }
    }
    
}
