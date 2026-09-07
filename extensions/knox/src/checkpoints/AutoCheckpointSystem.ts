/**
 * Auto-Checkpoint System for Knox
 * 
 * Provides automatic checkpoint creation based on:
 * - Time intervals
 * - File change thresholds
 * - AI operation completion
 * - Manual triggers
 * 
 * Also implements an undo/redo stack for quick navigation between checkpoints.
 */

import * as vscode from 'vscode';
import { createKnoxLogger } from 'core/util/knoxLog';
import { t } from '../i18n';
import { CheckpointManager, CheckpointInfo } from './CheckpointManager';
import { CheckpointCommand, registerCanonicalCommand } from './commandIds';
import {
    AUTO_CHECKPOINT_DEFAULTS,
    isAiAutoCheckpointsEnabled,
    readAutoCheckpointSettings,
    type AutoCheckpointSettings,
} from './checkpointSettings';
import { loadUndoStackState, saveUndoStackState } from './store/durableState';
import type { WorkspaceFileEventKind } from './manager/watcher';

const log = createKnoxLogger('AutoCheckpoint');

export type AutoCheckpointConfig = AutoCheckpointSettings;

export interface UndoRedoState {
    currentIndex: number;
    stack: string[]; // Checkpoint IDs
    maxSize: number;
}

export interface CheckpointBranch {
    id: string;
    name: string;
    headCheckpointId: string;
    baseCheckpointId: string;
    parentBranchId?: string;
    checkpoints: string[];
    createdAt: Date;
    description: string;
}

/**
 * Manages automatic checkpoint creation and undo/redo functionality
 */
export class AutoCheckpointSystem {
    private static instance: AutoCheckpointSystem | undefined;
    private config: AutoCheckpointConfig;
    private checkpointManager: CheckpointManager;
    private undoRedoState: UndoRedoState;
    private branches: Map<string, CheckpointBranch> = new Map();
    private currentBranchId: string | null = null;
    
    // Tracking state
    private lastCheckpointTime: number = Date.now();
    private pendingChanges: Set<string> = new Set();
    private debounceTimer: NodeJS.Timeout | undefined;
    private intervalTimer: NodeJS.Timeout | undefined;
    private isCreatingCheckpoint: boolean = false;
    private configurationWatchRegistered = false;
    private fileEventSubscriptionRegistered = false;
    private fileEventDisposable: vscode.Disposable | undefined;
    private workspaceChangeDisposable: vscode.Disposable | undefined;
    private checkpointCreatedSubscriptionRegistered = false;
    private extensionContext: vscode.ExtensionContext | undefined;
    private initialized = false;
    private initPromise: Promise<void> | undefined;
    
    // Event emitters
    private _onAutoCheckpointCreated = new vscode.EventEmitter<CheckpointInfo>();
    private _onUndoRedoChanged = new vscode.EventEmitter<UndoRedoState>();
    private _onBranchChanged = new vscode.EventEmitter<string>();
    
    public readonly onAutoCheckpointCreated = this._onAutoCheckpointCreated.event;
    public readonly onUndoRedoChanged = this._onUndoRedoChanged.event;
    public readonly onBranchChanged = this._onBranchChanged.event;
    
    private constructor() {
        this.checkpointManager = CheckpointManager.getInstance();
        this.config = this.getDefaultConfig();
        this.undoRedoState = {
            currentIndex: -1,
            stack: [],
            maxSize: 50,
        };
    }
    
    static getInstance(): AutoCheckpointSystem {
        if (!AutoCheckpointSystem.instance) {
            AutoCheckpointSystem.instance = new AutoCheckpointSystem();
        }
        return AutoCheckpointSystem.instance;
    }
    
    private getDefaultConfig(): AutoCheckpointConfig {
        return { ...AUTO_CHECKPOINT_DEFAULTS };
    }
    
    /**
     * Initialize the auto-checkpoint system
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.initialized) {
            return;
        }
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = this.initializeInner(context);
        try {
            await this.initPromise;
            this.initialized = true;
        } finally {
            this.initPromise = undefined;
        }
    }

    private async initializeInner(context: vscode.ExtensionContext): Promise<void> {
        this.extensionContext = context;
        this.loadConfiguration();
        if (!this.configurationWatchRegistered) {
            context.subscriptions.push(
                vscode.workspace.onDidChangeConfiguration((event) => {
                    if (event.affectsConfiguration('knox.checkpoints.auto')) {
                        this.reloadConfiguration();
                    }
                }),
            );
            this.configurationWatchRegistered = true;
        }

        this.subscribeToWorkspaceFileEvents(context);
        this.setupIntervalTimer();
        await this.loadUndoRedoState(context);
        try {
            const listed = await this.checkpointManager.listBranches();
            this.cacheBranches(listed);
            this.currentBranchId = this.checkpointManager.getActiveBranch?.()?.id ?? null;
        } catch (error) {
            log.debug('Could not load checkpoint branches:', error);
        }

        try {
            const { CheckpointSessionManager } = await import('./SessionManager');
            await CheckpointSessionManager.getInstance().initialize();
        } catch (error) {
            log.debug('Checkpoint session restore skipped:', error);
        }

        if (!this.workspaceChangeDisposable) {
            this.workspaceChangeDisposable = this.checkpointManager.onActiveWorkspaceChanged(() => {
                void this.loadUndoRedoState(context);
                void this.getBranches().then((branches) => {
                    this.currentBranchId = this.checkpointManager.getActiveBranch?.()?.id
                        ?? branches[0]?.id
                        ?? null;
                });
            });
            context.subscriptions.push(this.workspaceChangeDisposable);
        }

        if (!this.checkpointCreatedSubscriptionRegistered) {
            this.checkpointManager.onCheckpointCreated(checkpointId => {
                this.addToUndoStack(checkpointId);
            });
            this.checkpointCreatedSubscriptionRegistered = true;
        }

        log.info('✅ Auto-checkpoint system initialized');
    }
    
    /**
     * Load configuration from VS Code settings.
     */
    loadConfiguration(): void {
        this.config = readAutoCheckpointSettings();
        this.undoRedoState.maxSize = this.config.maxUndoStack;
    }

    /**
     * Re-read settings and restart timers so interval changes apply without reload.
     */
    reloadConfiguration(): void {
        this.loadConfiguration();
        if (this.config.enabled) {
            this.setupIntervalTimer();
        } else if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = undefined;
        }
        log.info(
            `⚙️ Auto-checkpoint config: enabled=${this.config.enabled}, ` +
            `minIntervalMs=${this.config.minIntervalMs}, maxIntervalMs=${this.config.maxIntervalMs}, ` +
            `fileChangeThreshold=${this.config.fileChangeThreshold}`,
        );
    }
    
    /**
     * Subscribe to CheckpointManager's per-folder watchers instead of creating
     * a second FileSystemWatcher (CP-31).
     */
    private subscribeToWorkspaceFileEvents(context: vscode.ExtensionContext): void {
        if (this.fileEventSubscriptionRegistered) {
            return;
        }
        this.fileEventDisposable = this.checkpointManager.onWorkspaceFileEvent((event) => {
            this.onFileChange(event.uri, event.kind);
        });
        context.subscriptions.push(this.fileEventDisposable);
        this.fileEventSubscriptionRegistered = true;
    }
    
    /** Fast path-based filter for watcher noise (build output, VCS internals, caches) */
    private static readonly NOISY_PATH_PATTERN = /[\\/](node_modules|\.git|dist|build|out|target|coverage|\.knox|\.knox-debug|__pycache__)[\\/]/;
    
    /**
     * Handle file change events
     */
    private onFileChange(uri: vscode.Uri, _changeType: WorkspaceFileEventKind | string): void {
        if (!this.config.enabled) return;
        
        if (AutoCheckpointSystem.NOISY_PATH_PATTERN.test(uri.fsPath)) return;
        
        this.pendingChanges.add(uri.fsPath);
        
        // Clear existing debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        // Set new debounce timer
        this.debounceTimer = setTimeout(() => {
            this.checkAutoCheckpointTrigger();
        }, this.config.debounceMs);
    }
    
    /**
     * Check if we should create an auto-checkpoint
     */
    private async checkAutoCheckpointTrigger(): Promise<void> {
        if (!this.config.enabled || this.isCreatingCheckpoint) return;
        
        const now = Date.now();
        const timeSinceLastCheckpoint = now - this.lastCheckpointTime;
        
        // Check if we've exceeded the minimum interval
        if (timeSinceLastCheckpoint < this.config.minIntervalMs) {
            return;
        }
        
        // Check if we've reached the file change threshold
        if (this.pendingChanges.size >= this.config.fileChangeThreshold) {
            await this.createAutoCheckpoint('file-changes');
            return;
        }
        
        // Force checkpoint if max interval exceeded
        if (timeSinceLastCheckpoint >= this.config.maxIntervalMs && this.pendingChanges.size > 0) {
            await this.createAutoCheckpoint('time-interval');
            return;
        }
    }
    
    /**
     * Set up interval timer for time-based checkpoints
     */
    private setupIntervalTimer(): void {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
        }
        
        this.intervalTimer = setInterval(() => {
            this.checkAutoCheckpointTrigger();
        }, this.config.minIntervalMs);
    }
    
    /**
     * Create an automatic checkpoint
     */
    private async createAutoCheckpoint(reason: string): Promise<void> {
        if (this.isCreatingCheckpoint) return;
        
        this.isCreatingCheckpoint = true;
        
        try {
            const changedFiles = Array.from(this.pendingChanges);
            const description = this.generateAutoDescription(reason, changedFiles);
            
            const checkpointId = await this.checkpointManager.createCheckpointForMessage(
                `auto-${Date.now()}`,
                description
            );
            
            if (checkpointId) {
                this.lastCheckpointTime = Date.now();
                this.pendingChanges.clear();
                
                // Emit event
                const checkpointInfo: CheckpointInfo = {
                    id: checkpointId,
                    description,
                    created: new Date(),
                };
                this._onAutoCheckpointCreated.fire(checkpointInfo);
                
                if (this.config.showNotifications) {
                    vscode.window.showInformationMessage(
                        t('checkpoint.auto.created', { description })
                    );
                }
                
                log.debug(`🔄 Auto-checkpoint created: ${checkpointId.substring(0, 8)} (${reason})`);
            }
        } catch (error) {
            log.error('Failed to create auto-checkpoint:', error);
        } finally {
            this.isCreatingCheckpoint = false;
        }
    }
    
    /**
     * Generate description for auto-checkpoint, including the affected file
     * names so checkpoints are recognizable in the list without opening details
     */
    private generateAutoDescription(reason: string, changedFiles: string[]): string {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const changeCount = changedFiles.length;
        const fileSummary = this.summarizeFiles(changedFiles);
        
        switch (reason) {
            case 'file-changes':
                return changeCount === 1
                    ? `Auto: ${fileSummary} changed at ${timeStr}`
                    : `Auto: ${changeCount} files changed (${fileSummary}) at ${timeStr}`;
            case 'time-interval':
                return fileSummary
                    ? `Auto: Periodic checkpoint (${fileSummary}) at ${timeStr}`
                    : `Auto: Periodic checkpoint at ${timeStr}`;
            case 'ai-operation':
                return `Auto: After AI operation at ${timeStr}`;
            case 'pre-risky':
                return `Auto: Safety checkpoint at ${timeStr}`;
            default:
                return `Auto: Checkpoint at ${timeStr}`;
        }
    }
    
    /**
     * Produce a short human-readable summary of changed files (up to 2 names)
     */
    private summarizeFiles(changedFiles: string[]): string {
        if (changedFiles.length === 0) {
            return '';
        }
        
        const names = changedFiles
            .slice(0, 2)
            .map(f => f.split(/[\\/]/).pop() || f);
        
        const extra = changedFiles.length - names.length;
        return extra > 0 ? `${names.join(', ')} +${extra} more` : names.join(', ');
    }
    
    /**
     * Trigger checkpoint after AI operation
     */
    async onAIOperationComplete(operationType: string): Promise<void> {
        if (!this.config.enabled || !this.config.checkpointAfterAI || !isAiAutoCheckpointsEnabled()) {
            return;
        }
        
        await this.createAutoCheckpoint('ai-operation');

        const sessionId = CheckpointManager.getInstance().getBoundAgentSessionId();
        if (!sessionId) {
            return;
        }
        try {
            const { recordSoulEvent } = await import("core/context/soul/recordSoulEvent");
            await recordSoulEvent({
                sessionId,
                kind: "tool_success",
                toolName: "ai_operation",
                files: [],
                ok: true,
                summary: `AI operation complete: ${operationType}`,
            });
        } catch {
            // Soul write is best-effort; the file CP already exists.
        }
    }
    
    /**
     * Trigger checkpoint before risky operation (mutating tools).
     * Respects minInterval to avoid thrashing on multi-tool turns.
     */
    async onBeforeRiskyOperation(operationType: string): Promise<void> {
        if (!this.config.enabled || !this.config.checkpointBeforeRisky) return;

        const timeSinceLast = Date.now() - this.lastCheckpointTime;
        if (timeSinceLast < this.config.minIntervalMs) {
            return;
        }

        await this.createAutoCheckpoint('pre-risky');
    }
    
    // ==================== Undo/Redo Stack ====================
    
    /**
     * Add checkpoint to undo stack
     */
    private addToUndoStack(checkpointId: string): void {
        // Remove any redo history
        if (this.undoRedoState.currentIndex < this.undoRedoState.stack.length - 1) {
            this.undoRedoState.stack = this.undoRedoState.stack.slice(
                0, 
                this.undoRedoState.currentIndex + 1
            );
        }
        
        // Add new checkpoint
        this.undoRedoState.stack.push(checkpointId);
        this.undoRedoState.currentIndex = this.undoRedoState.stack.length - 1;
        
        // Trim stack if exceeds max size
        while (this.undoRedoState.stack.length > this.undoRedoState.maxSize) {
            this.undoRedoState.stack.shift();
            this.undoRedoState.currentIndex--;
        }
        
        this._onUndoRedoChanged.fire(this.undoRedoState);
        void this.persistUndoRedoState();
    }
    
    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.undoRedoState.currentIndex > 0;
    }
    
    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.undoRedoState.currentIndex < this.undoRedoState.stack.length - 1;
    }
    
    /**
     * Undo to previous checkpoint
     */
    async undo(): Promise<boolean> {
        if (!this.canUndo()) {
            vscode.window.showWarningMessage(t('checkpoint.auto.noPrevious'));
            return false;
        }
        
        // First create a checkpoint of current state (so we can redo)
        const currentCheckpointId = await this.checkpointManager.createCheckpointForMessage(
            `undo-save-${Date.now()}`,
            'Auto: Pre-undo checkpoint'
        );
        
        // Move to previous checkpoint
        this.undoRedoState.currentIndex--;
        const targetCheckpointId = this.undoRedoState.stack[this.undoRedoState.currentIndex];
        
        try {
            // Restore the previous checkpoint
            await this.checkpointManager.restoreCheckpoint(targetCheckpointId);
            
            vscode.window.showInformationMessage(
                t('checkpoint.auto.undoneTo', { id: targetCheckpointId.substring(0, 8) })
            );
            
            this._onUndoRedoChanged.fire(this.undoRedoState);
            void this.persistUndoRedoState();
            return true;
        } catch (error) {
            // Restore index on failure
            this.undoRedoState.currentIndex++;
            log.error('Undo failed:', error);
            vscode.window.showErrorMessage(t('checkpoint.auto.failedUndo', { error: String(error) }));
            return false;
        }
    }
    
    /**
     * Redo to next checkpoint
     */
    async redo(): Promise<boolean> {
        if (!this.canRedo()) {
            vscode.window.showWarningMessage(t('checkpoint.auto.noRedo'));
            return false;
        }
        
        // Move to next checkpoint
        this.undoRedoState.currentIndex++;
        const targetCheckpointId = this.undoRedoState.stack[this.undoRedoState.currentIndex];
        
        try {
            // Restore the next checkpoint
            await this.checkpointManager.restoreCheckpoint(targetCheckpointId);
            
            vscode.window.showInformationMessage(
                t('checkpoint.auto.redoneTo', { id: targetCheckpointId.substring(0, 8) })
            );
            
            this._onUndoRedoChanged.fire(this.undoRedoState);
            void this.persistUndoRedoState();
            return true;
        } catch (error) {
            // Restore index on failure
            this.undoRedoState.currentIndex--;
            log.error('Redo failed:', error);
            vscode.window.showErrorMessage(t('checkpoint.auto.failedRedo', { error: String(error) }));
            return false;
        }
    }
    
    /**
     * Jump to specific checkpoint in stack
     */
    async jumpToCheckpoint(index: number): Promise<boolean> {
        if (index < 0 || index >= this.undoRedoState.stack.length) {
            return false;
        }
        
        const targetCheckpointId = this.undoRedoState.stack[index];
        
        try {
            await this.checkpointManager.restoreCheckpoint(targetCheckpointId);
            this.undoRedoState.currentIndex = index;

            this._onUndoRedoChanged.fire(this.undoRedoState);
            void this.persistUndoRedoState();
            return true;
        } catch (error) {
            log.error('Jump to checkpoint failed:', error);
            return false;
        }
    }
    
    /**
     * Get the undo/redo stack
     */
    getUndoRedoStack(): UndoRedoState {
        return { ...this.undoRedoState };
    }
    
    /**
     * Load undo/redo state: workspace store first (survives "clear all editor
     * state"), then ExtensionContext workspaceState as a migration fallback.
     */
    private async loadUndoRedoState(context: vscode.ExtensionContext): Promise<void> {
        const fromStore = await this.loadUndoStackFromWorkspaceStore();
        if (fromStore) {
            this.undoRedoState = this.normalizeUndoState(fromStore);
            return;
        }
        const savedState = context.workspaceState.get<UndoRedoState>('checkpointUndoRedoState');
        if (savedState) {
            this.undoRedoState = this.normalizeUndoState(savedState);
            await this.persistUndoRedoState();
        }
    }

    /**
     * Save undo/redo state to ExtensionContext and the workspace checkpoint store.
     */
    async saveUndoRedoState(context: vscode.ExtensionContext): Promise<void> {
        this.extensionContext = context;
        await this.persistUndoRedoState();
    }

    private normalizeUndoState(state: Partial<UndoRedoState> & Pick<UndoRedoState, 'stack'>): UndoRedoState {
        const stack = Array.isArray(state.stack) ? state.stack.filter((id) => typeof id === 'string') : [];
        const maxSize = typeof state.maxSize === 'number' && state.maxSize > 0
            ? state.maxSize
            : this.config.maxUndoStack;
        let currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : stack.length - 1;
        if (stack.length === 0) {
            currentIndex = -1;
        } else {
            currentIndex = Math.max(0, Math.min(currentIndex, stack.length - 1));
        }
        return { stack, currentIndex, maxSize };
    }

    private resolveUndoStoragePath(): string | undefined {
        if (typeof this.checkpointManager.getStoragePath !== 'function') {
            return undefined;
        }
        return this.checkpointManager.getStoragePath();
    }

    private async loadUndoStackFromWorkspaceStore(): Promise<UndoRedoState | null> {
        try {
            const storagePath = this.resolveUndoStoragePath();
            if (!storagePath) {
                return null;
            }
            const loaded = await loadUndoStackState(storagePath);
            return loaded ? { ...loaded } : null;
        } catch (error) {
            log.debug('Could not load undo stack from workspace store:', error);
            return null;
        }
    }

    private async persistUndoRedoState(): Promise<void> {
        try {
            if (this.extensionContext) {
                await this.extensionContext.workspaceState.update('checkpointUndoRedoState', this.undoRedoState);
            }
            const storagePath = this.resolveUndoStoragePath();
            if (storagePath) {
                await saveUndoStackState(storagePath, this.undoRedoState);
            }
        } catch (error) {
            log.debug('Could not persist undo stack:', error);
        }
    }
    
    // ==================== Branching ====================
    
    private toLocalBranch(branch: {
        id: string;
        name: string;
        headCheckpointId: string;
        baseCheckpointId: string;
        parentBranchId?: string;
        createdAt: Date | string;
        description?: string;
    }): CheckpointBranch {
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

    private cacheBranches(branches: Array<{
        id: string;
        name: string;
        headCheckpointId: string;
        baseCheckpointId: string;
        parentBranchId?: string;
        createdAt: Date | string;
        description?: string;
    }>): CheckpointBranch[] {
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
        const history = this.checkpointManager.getCheckpointHistoryForWorkspace?.()
            ?? this.checkpointManager.getCheckpointHistory();
        const currentCheckpointId = this.undoRedoState.stack[this.undoRedoState.currentIndex]
            || history[history.length - 1]?.id;
        if (!currentCheckpointId) {
            vscode.window.showWarningMessage(t('checkpoint.auto.noBranch'));
            return null;
        }

        try {
            const created = await this.checkpointManager.createBranch(name, currentCheckpointId, description);
            if (!created) {
                vscode.window.showErrorMessage(t('checkpoint.auto.failedCreateBranch'));
                return null;
            }

            const branch = this.toLocalBranch(created);
            this.branches.set(branch.id, branch);
            this.currentBranchId = branch.id;
            this._onBranchChanged.fire(branch.id);
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
     * Switch the active capture line. Does not restore the workspace unless the
     * user accepts the optional restore-to-head prompt from the command.
     */
    async switchBranch(branchId: string, options?: { offerRestore?: boolean }): Promise<boolean> {
        try {
            const switched = await this.checkpointManager.switchBranch(branchId);
            if (!switched) {
                vscode.window.showWarningMessage(t('checkpoint.auto.branchNotFound'));
                return false;
            }
            this.currentBranchId = branchId;
            this._onBranchChanged.fire(branchId);

            const branches = await this.checkpointManager.listBranches();
            this.cacheBranches(branches);
            const branch = branches.find((item: { id: string }) => item.id === branchId);
            if (branch) {
                vscode.window.showInformationMessage(t('checkpoint.auto.switchedBranch', { name: branch.name }));
            }

            if (options?.offerRestore && branch?.headCheckpointId) {
                const choice = await vscode.window.showInformationMessage(
                    t('checkpoint.auto.restoreHeadPrompt', { name: branch.name }),
                    t('checkpoint.auto.restoreHead'),
                    t('checkpoint.auto.keepWorkspace'),
                );
                if (choice === t('checkpoint.auto.restoreHead')) {
                    await this.checkpointManager.restoreCheckpoint(branch.headCheckpointId);
                }
            }
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
            const current = this.checkpointManager.getActiveBranch?.()
                ?? (this.currentBranchId ? { id: this.currentBranchId } : undefined);
            if (!current?.id) {
                vscode.window.showErrorMessage(t('checkpoint.auto.noCurrentBranchToMerge'));
                return false;
            }

            const result = await this.checkpointManager.mergeBranches(
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
            const listed = await this.checkpointManager.listBranches();
            return this.cacheBranches(listed);
        } catch {
            return [...this.branches.values()];
        }
    }

    getCurrentBranch(): CheckpointBranch | null {
        if (this.currentBranchId) {
            return this.branches.get(this.currentBranchId) || null;
        }
        const active = this.checkpointManager.getActiveBranch?.();
        return active ? this.toLocalBranch(active) : null;
    }

    async deleteBranch(branchId: string): Promise<boolean> {
        if (branchId === this.currentBranchId) {
            vscode.window.showWarningMessage(t('checkpoint.auto.cannotDeleteCurrent'));
            return false;
        }

        try {
            await this.checkpointManager.deleteBranch(branchId);
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
    
    // ==================== Configuration ====================
    
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<AutoCheckpointConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Restart interval timer if interval changed
        if (newConfig.minIntervalMs || newConfig.maxIntervalMs) {
            this.setupIntervalTimer();
        }
    }
    
    /**
     * Get current configuration
     */
    getConfig(): AutoCheckpointConfig {
        return { ...this.config };
    }
    
    /**
     * Enable/disable auto-checkpoints
     */
    setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;

        if (enabled) {
            this.setupIntervalTimer();
        } else if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = undefined;
        }

        void vscode.workspace.getConfiguration('knox.checkpoints.auto').update(
            'enabled',
            enabled,
            vscode.ConfigurationTarget.Global,
        );
    }
    
    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
        }
        
        this.fileEventDisposable?.dispose();
        this.fileEventDisposable = undefined;
        this.fileEventSubscriptionRegistered = false;
        this.workspaceChangeDisposable?.dispose();
        this.workspaceChangeDisposable = undefined;

        this._onAutoCheckpointCreated.dispose();
        this._onUndoRedoChanged.dispose();
        this._onBranchChanged.dispose();
    }
}

/**
 * Register auto-checkpoint commands
 */
export function registerAutoCheckpointCommands(context: vscode.ExtensionContext): void {
    const autoCheckpoint = AutoCheckpointSystem.getInstance();
    const ensure = () => autoCheckpoint.initialize(context);

    registerCanonicalCommand(context, CheckpointCommand.undo, async () => {
        await ensure();
        await autoCheckpoint.undo();
    });

    registerCanonicalCommand(context, CheckpointCommand.redo, async () => {
        await ensure();
        await autoCheckpoint.redo();
    });

    registerCanonicalCommand(context, CheckpointCommand.createBranch, async () => {
        const name = await vscode.window.showInputBox({
            prompt: t('checkpoint.auto.enterBranchName'),
            placeHolder: t('checkpoint.auto.branchPlaceholder'),
        });
        if (!name?.trim()) {
            return;
        }
        await ensure();
        await autoCheckpoint.createBranch(name.trim());
    });
    registerCanonicalCommand(context, CheckpointCommand.switchBranch, async () => {
        await ensure();
        const branches = await autoCheckpoint.getBranches();
        if (branches.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.auto.noBranches'));
            return;
        }
        const current = autoCheckpoint.getCurrentBranch();
        const selected = await vscode.window.showQuickPick(
            branches.map((branch) => ({
                label: `${branch.id === current?.id ? '$(arrow-right) ' : ''}${branch.name}`,
                description: branch.id === current?.id ? '(current)' : branch.headCheckpointId.substring(0, 8),
                branchId: branch.id,
            })),
            { placeHolder: t('checkpoint.auto.selectBranch') },
        );
        if (selected) {
            await autoCheckpoint.switchBranch(selected.branchId, { offerRestore: true });
        }
    });
    registerCanonicalCommand(context, CheckpointCommand.mergeBranch, async () => {
        await ensure();
        const branches = await autoCheckpoint.getBranches();
        const current = autoCheckpoint.getCurrentBranch();
        const sources = branches.filter((branch) => branch.id !== current?.id);
        if (!current) {
            vscode.window.showErrorMessage(t('checkpoint.auto.noCurrentBranchToMerge'));
            return;
        }
        if (sources.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.auto.noBranches'));
            return;
        }
        const selected = await vscode.window.showQuickPick(
            sources.map((branch) => ({
                label: branch.name,
                description: branch.headCheckpointId.substring(0, 8),
                branchId: branch.id,
            })),
            { placeHolder: t('checkpoint.auto.selectMergeSource') },
        );
        if (selected) {
            await autoCheckpoint.mergeBranch(selected.branchId);
        }
    });
    registerCanonicalCommand(context, CheckpointCommand.deleteBranch, async () => {
        await ensure();
        const branches = await autoCheckpoint.getBranches();
        const current = autoCheckpoint.getCurrentBranch();
        const deletable = branches.filter((branch) => branch.id !== current?.id);
        if (deletable.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.auto.noBranches'));
            return;
        }
        const selected = await vscode.window.showQuickPick(
            deletable.map((branch) => ({
                label: branch.name,
                description: branch.headCheckpointId.substring(0, 8),
                branchId: branch.id,
            })),
            { placeHolder: t('checkpoint.auto.selectDeleteBranch') },
        );
        if (selected) {
            await autoCheckpoint.deleteBranch(selected.branchId);
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.toggleAuto, async () => {
        await ensure();
        const config = autoCheckpoint.getConfig();
        autoCheckpoint.setEnabled(!config.enabled);

        vscode.window.showInformationMessage(
            t('checkpoint.auto.toggled', { status: config.enabled ? 'disabled' : 'enabled' })
        );
    });

    registerCanonicalCommand(context, CheckpointCommand.showUndoHistory, async () => {
        await ensure();
        const state = autoCheckpoint.getUndoRedoStack();
        const items = [];
        for (let i = 0; i < state.stack.length; i++) {
            const checkpointId = state.stack[i];
            const isCurrent = i === state.currentIndex;

            items.push({
                label: `${isCurrent ? '$(arrow-right) ' : ''}${checkpointId.substring(0, 8)}`,
                description: isCurrent ? '(current)' : '',
                index: i,
            });
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: t('checkpoint.auto.selectCheckpoint'),
        });

        if (selected) {
            await autoCheckpoint.jumpToCheckpoint(selected.index);
        }
    });
    
    // Save state on deactivation
    context.subscriptions.push({
        dispose: async () => {
            await autoCheckpoint.saveUndoRedoState(context);
            autoCheckpoint.dispose();
        }
    });
}
