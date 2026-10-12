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
import {
    AUTO_CHECKPOINT_DEFAULTS,
    isAiAutoCheckpointsEnabled,
    readAutoCheckpointSettings,
    type AutoCheckpointSettings,
} from './checkpointSettings';
import { AutoCheckpointBranches } from './autoCheckpointBranches';
import { generateAutoDescription } from './autoCheckpointDescriptions';
import {
    loadUndoRedoFromWorkspaceStore,
    normalizeUndoState,
    persistUndoRedo,
} from './autoCheckpointUndoStore';
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
            this.branchOps.cacheBranches(listed);
            this.branchOps.currentBranchId = this.checkpointManager.getActiveBranch?.()?.id ?? null;
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
                    this.branchOps.currentBranchId = this.checkpointManager.getActiveBranch?.()?.id
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
            const description = generateAutoDescription(reason, changedFiles);
            
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
    
    /** Restore files, then rewind memory on a best-effort basis. */
    private async restoreAndRewind(targetCheckpointId: string): Promise<void> {
        const result = await this.checkpointManager.restoreCheckpoint(targetCheckpointId);
        if (result.success) {
            try {
                const { notifyCheckpointRestored } = await import('./notifyRestore');
                await notifyCheckpointRestored(targetCheckpointId, result.restoredFiles, {
                    rewindMemory: true,
                });
            } catch {
                // Memory rewind is best-effort; files already restored.
            }
        }
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
            await this.restoreAndRewind(targetCheckpointId);

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
            await this.restoreAndRewind(targetCheckpointId);

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
            await this.restoreAndRewind(targetCheckpointId);
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
        return normalizeUndoState(state, this.config.maxUndoStack);
    }

    private async loadUndoStackFromWorkspaceStore(): Promise<UndoRedoState | null> {
        return loadUndoRedoFromWorkspaceStore(this.checkpointManager);
    }

    private async persistUndoRedoState(): Promise<void> {
        await persistUndoRedo(this.checkpointManager, this.undoRedoState, this.extensionContext);
    }

    // ==================== Branching ====================
    private readonly branchOps = new AutoCheckpointBranches(
        () => this.checkpointManager,
        {
            currentUndoCheckpointId: () => this.undoRedoState.stack[this.undoRedoState.currentIndex],
            onChanged: (id) => this._onBranchChanged.fire(id),
        },
    );

    createBranch(name: string, description: string = ''): Promise<CheckpointBranch | null> {
        return this.branchOps.createBranch(name, description);
    }

    switchBranch(branchId: string, options?: { offerRestore?: boolean }): Promise<boolean> {
        return this.branchOps.switchBranch(branchId, options);
    }

    mergeBranch(sourceBranchId: string, strategy: string = 'ThreeWay'): Promise<boolean> {
        return this.branchOps.mergeBranch(sourceBranchId, strategy);
    }

    getBranches(): Promise<CheckpointBranch[]> {
        return this.branchOps.getBranches();
    }

    getCurrentBranch(): CheckpointBranch | null {
        return this.branchOps.getCurrentBranch();
    }

    deleteBranch(branchId: string): Promise<boolean> {
        return this.branchOps.deleteBranch(branchId);
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
