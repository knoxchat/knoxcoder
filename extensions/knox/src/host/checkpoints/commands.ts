/**
 * VSCode commands for checkpoint functionality
 */


import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { primaryWorkspaceFsPath } from '../util/primaryWorkspace';
import { t } from '../i18n';
import { CheckpointManager, type ImportCheckpointsOptions } from './CheckpointManager';
import { importBundleWithWorkspacePrompt, loadSharedCheckpointPanel, revealSharedBundle, shareCheckpointsInteractive } from './shareCommands';
import { isAiAutoCheckpointsEnabled } from './checkpointSettings';
import { CheckpointSessionManager, SessionType } from './SessionManager';
import { COMPARE_CATALOG_LIMIT, CHECKPOINT_LIST_PAGE_SIZE, checkpointMatchesQuery, checkpointMatchesSession, checkpointSessionId, isListableCheckpoint, paginateItems, searchablePaths, type CheckpointListQuery } from './manager/listQuery';
import { serializeBranch } from './manager/branchLogic';
import { buildCheckpointTimeline } from './manager/timeline';
import { getCheckpointConfiguration, saveCheckpointConfiguration } from './checkpointConfiguration';
import { CheckpointRestoreOps } from './chatRestoreOps';

export { registerCheckpointCommands } from './registerCommands';

/**
 * Create an automatic checkpoint (called by agent system)
 */
export async function createAutomaticCheckpoint(description?: string): Promise<string | undefined> {
    const checkpointManager = CheckpointManager.getInstance();
    
    if (!checkpointManager.isReady()) {
        console.warn('Checkpoint system not ready, skipping automatic checkpoint');
        return undefined;
    }
    
    try {
        return await checkpointManager.createCheckpointForMessage(
            `auto-${randomUUID()}`,
            description || 'Automatic checkpoint',
        );
    } catch (error) {
        console.error('Failed to create automatic checkpoint:', error);
        return undefined;
    }
}

/**
 * Integration with agent chat system
 */
export class CheckpointChatIntegration {
    private static instance: CheckpointChatIntegration | undefined;
    private checkpointManager: CheckpointManager;
    private sessionManager: CheckpointSessionManager;
    private readonly restoreOps = new CheckpointRestoreOps(() => this.checkpointManager);
    
    private constructor() {
        this.checkpointManager = CheckpointManager.getInstance();
        this.sessionManager = CheckpointSessionManager.getInstance();
    }
    
    static getInstance(): CheckpointChatIntegration {
        if (!CheckpointChatIntegration.instance) {
            CheckpointChatIntegration.instance = new CheckpointChatIntegration();
        }
        return CheckpointChatIntegration.instance;
    }
    
    /**
     * Called after agent completes a response
     */
    async afterAgentResponse(messageId: string, description?: string, stableId?: string, conversationContext?: any): Promise<string | undefined> {
        if (!this.checkpointManager.isReady()) {
            return undefined;
        }
        
        try {
            const workspacePath = primaryWorkspaceFsPath();
            if (!workspacePath) {
                console.warn('No workspace available for checkpoint');
                return undefined;
            }

            const autoCheckpointsEnabled = isAiAutoCheckpointsEnabled();
            
            if (!autoCheckpointsEnabled) {
                console.debug('Auto-checkpoints disabled, skipping checkpoint creation');
                return undefined;
            }

            // Check if this is a context-only checkpoint (for user messages)
            const isContextOnly = conversationContext && conversationContext.role === 'user';
            
            // Quick check: only create checkpoint if there are changes OR if it's a context-only checkpoint
            const hasChanges = await this.checkpointManager.hasWorkspaceChanges();
            if (!hasChanges && !isContextOnly) {
                console.debug('No workspace changes detected, skipping checkpoint creation');
                return undefined;
            }
            
            // For context-only checkpoints (user messages), skip if no changes but still create metadata checkpoint
            if (isContextOnly && !hasChanges) {
                console.debug('Creating context-only checkpoint for user message (no file changes)');
            }

            await this.sessionManager.getSession(SessionType.CHAT, workspacePath);

            const finalDescription = description || `Agent response - ${new Date().toLocaleTimeString()}`;
            return await this.checkpointManager.createCheckpointForMessage(messageId, finalDescription, stableId);
        } catch (error) {
            console.error('Failed to create post-response checkpoint:', error);
            return undefined;
        }
    }
    
    /**
     * Get checkpoint ID for a message
     */
    getCheckpointForMessage(messageId: string): string | undefined {
        return this.checkpointManager.getCheckpointForMessage(messageId);
    }
    
    /**
     * Get checkpoint ID for a stable identifier
     */
    getCheckpointForStableId(stableId: string): string | undefined {
        return this.checkpointManager.getCheckpointForStableId(stableId);
    }
    
    /**
     * Restore a checkpoint by ID (direct restore without confirmation).
     */
    restoreCheckpointDirect(
        ...args: Parameters<CheckpointRestoreOps['restoreCheckpointDirect']>
    ): ReturnType<CheckpointRestoreOps['restoreCheckpointDirect']> {
        return this.restoreOps.restoreCheckpointDirect(...args);
    }

    /**
     * Restore a checkpoint by ID (with preview counts, then confirmation)
     */
    restoreCheckpoint(checkpointId: string): Promise<void> {
        return this.restoreOps.restoreCheckpoint(checkpointId);
    }

    /**
     * Create a manual checkpoint with session isolation
     */
    async createManualCheckpoint(description: string): Promise<string | undefined> {
        if (!this.checkpointManager.isReady()) {
            console.warn('Checkpoint system not initialized');
            return undefined;
        }

        try {
            const workspacePath = primaryWorkspaceFsPath();
            if (!workspacePath) {
                console.warn('No workspace available for checkpoint');
                return undefined;
            }

            await this.sessionManager.getSession(SessionType.MANUAL, workspacePath);

            const checkpointId = await this.checkpointManager.createManualCheckpoint({
                description: `Manual: ${description}`,
                tags: ['manual'],
            });

            return checkpointId;
        } catch (error) {
            console.error('Failed to create manual checkpoint:', error);
            throw error;
        }
    }

    /**
     * Get all checkpoints for display
     */
    getCheckpointHistory() {
        return this.checkpointManager.getCheckpointHistory();
    }

    /**
     * Get checkpoints filtered by current workspace
     */
    getCheckpointHistoryForWorkspace(workspacePath?: string) {
        return this.checkpointManager.getCheckpointHistoryForWorkspace(workspacePath);
    }
    
    /**
     * List checkpoints for the webview. Lean metadata only (CP-08/CP-32):
     * paginated, searchable by description/id/tag/path/session, no file bytes.
     */
    async listCheckpoints(params?: CheckpointListQuery): Promise<{
        checkpoints: any[];
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
        compareCatalog: Array<{ id: string; description: string; dateCreated: string }>;
        activeWorkspacePath?: string;
        workspaceFolders: Array<{ path: string; name: string }>;
    }> {
        const history = this.checkpointManager.getCheckpointHistoryForWorkspace();
        const listable = history
            .filter((checkpoint) => isListableCheckpoint(checkpoint))
            .sort((a, b) => b.created.getTime() - a.created.getTime());

        const filtered = listable.filter((checkpoint) =>
            checkpointMatchesSession(checkpoint, params?.sessionId, params?.thisSessionOnly)
            && checkpointMatchesQuery(checkpoint, params?.query),
        );

        const page = paginateItems(filtered, params?.offset ?? 0, params?.limit ?? CHECKPOINT_LIST_PAGE_SIZE);
        const toListItem = (checkpoint: typeof filtered[number]) => {
            const stats = checkpoint.fileStats ?? {
                total: 0,
                created: 0,
                deleted: 0,
                modified: 0,
            };
            return {
                id: checkpoint.id,
                description: checkpoint.description,
                dateCreated: checkpoint.created.toISOString(),
                workspacePath: checkpoint.workspacePath,
                messageId: checkpoint.messageId,
                sessionId: checkpointSessionId(checkpoint),
                conversationContext: checkpoint.conversationContext,
                pinned: checkpoint.pinned === true,
                tags: checkpoint.tags ?? [],
                changedPaths: searchablePaths(checkpoint),
                fileStats: {
                    total: stats.total,
                    created: stats.created,
                    deleted: stats.deleted,
                    modified: stats.modified,
                },
            };
        };

        const workspaceFolders = this.checkpointManager.getWorkspaceFolderPaths().map((folderPath) => ({
            path: folderPath,
            name: path.basename(folderPath) || folderPath,
        }));

        return {
            checkpoints: page.items.map(toListItem),
            total: page.total,
            offset: page.offset,
            limit: page.limit,
            hasMore: page.hasMore,
            compareCatalog: listable.slice(0, COMPARE_CATALOG_LIMIT).map((checkpoint) => ({
                id: checkpoint.id,
                description: checkpoint.description,
                dateCreated: checkpoint.created.toISOString(),
            })),
            activeWorkspacePath: this.checkpointManager.getCurrentWorkspacePath(),
            workspaceFolders,
        };
    }

    async setActiveWorkspace(workspacePath: string): Promise<boolean> {
        try {
            await this.checkpointManager.switchWorkspaceFolder(workspacePath);
            return true;
        } catch (error) {
            console.error('Failed to switch checkpoint workspace:', error);
            return false;
        }
    }
    
    /**
     * Get detailed checkpoint information including file snapshots
     */
    async getCheckpointDetails(checkpointId: string): Promise<any | null> {
        try {
            // Load from disk first (the source of truth used by restore) with an
            // in-memory fallback, so details never diverge from what restore does
            const checkpoint = await this.checkpointManager.getCheckpointWithSnapshots(checkpointId);
            
            if (!checkpoint) {
                return null;
            }
            
            // Return comprehensive checkpoint data
            return {
                id: checkpoint.id,
                description: checkpoint.description,
                created: checkpoint.created.toISOString(),
                workspacePath: checkpoint.workspacePath,
                messageId: checkpoint.messageId,
                conversationContext: checkpoint.conversationContext,
                fileSnapshots: checkpoint.fileSnapshots || []
            };
        } catch (error) {
            console.error('Failed to get checkpoint details:', error);
            return null;
        }
    }
    
    /**
     * Compute an accurate file diff between a checkpoint and a baseline
     * (defaults to the immediately preceding checkpoint). Reconstructs true
     * file contents at both points instead of comparing raw delta snapshots.
     */
    async computeCheckpointDiff(checkpointId: string, compareToCheckpointId?: string, compareToWorkspace?: boolean): Promise<any | null> {
        try {
            if (compareToWorkspace) {
                return await this.checkpointManager.computeCheckpointDiffAgainstWorkspace(checkpointId);
            }
            return await this.checkpointManager.computeCheckpointDiff(checkpointId, compareToCheckpointId);
        } catch (error) {
            console.error('Failed to compute checkpoint diff:', error);
            return null;
        }
    }

    async previewRestore(checkpointId: string) {
        return this.checkpointManager.previewRestore(checkpointId);
    }
    
    /**
     * Restore only the specified files from a checkpoint (selective restore)
     */
    async restoreCheckpointFiles(checkpointId: string, relativePaths: string[]): Promise<{
        success: boolean;
        restoredFiles: string[];
        failedFiles: Array<{ path: string; error: string }>;
    }> {
        try {
            const result = await this.checkpointManager.restoreCheckpointFiles(checkpointId, relativePaths);
            
            if (result.success) {
                vscode.window.showInformationMessage(
                    t('checkpoint.filesRestoredSuccess', { count: result.restoredFiles.length })
                );
            } else if (result.failedFiles.length > 0) {
                vscode.window.showWarningMessage(
                    t('checkpoint.filesRestoredWithErrors', { count: result.failedFiles.length })
                );
            }
            
            return result;
        } catch (error) {
            console.error('Failed to restore checkpoint files:', error);
            return { success: false, restoredFiles: [], failedFiles: [{ path: relativePaths.join(', '), error: error instanceof Error ? error.message : String(error) }] };
        }
    }
    
    /**
     * Get previous checkpoint for diff comparison
     */
    async getPreviousCheckpoint(checkpointId: string): Promise<any | null> {
        try {
            // Get the checkpoint history for the current workspace
            const history = this.checkpointManager.getCheckpointHistoryForWorkspace();
            
            // Find the current checkpoint's index
            const currentIndex = history.findIndex(cp => cp.id === checkpointId);
            
            if (currentIndex === -1 || currentIndex === history.length - 1) {
                // Checkpoint not found or it's the last (oldest) checkpoint
                return null;
            }
            
            // Get the previous checkpoint (next in array since sorted newest to oldest)
            const previousCheckpoint = history[currentIndex + 1];
            const detailed = await this.checkpointManager.getCheckpointWithSnapshots(previousCheckpoint.id);
            const source = detailed ?? previousCheckpoint;

            return {
                id: source.id,
                description: source.description,
                created: source.created.toISOString(),
                workspacePath: source.workspacePath,
                messageId: source.messageId,
                conversationContext: source.conversationContext,
                fileSnapshots: source.fileSnapshots || []
            };
        } catch (error) {
            console.error('Failed to get previous checkpoint:', error);
            return null;
        }
    }
    
    /**
     * Delete a checkpoint
     */
    async deleteCheckpoint(checkpointId: string): Promise<boolean> {
        try {
            // Remove from history and delete the JSON file from disk
            const success = await this.checkpointManager.removeFromHistoryAndDisk(checkpointId);
            return success;
        } catch (error) {
            console.error('Failed to delete checkpoint:', error);
            return false;
        }
    }

    async pinCheckpoint(checkpointId: string, pinned: boolean): Promise<boolean> {
        try {
            return await this.checkpointManager.setCheckpointPinned(checkpointId, pinned);
        } catch (error) {
            console.error('Failed to pin checkpoint:', error);
            return false;
        }
    }

    async getPerformanceDashboard(historyDays: number = 30) {
        return this.checkpointManager.getPerformanceDashboard(historyDays);
    }

    async shareCheckpoints(options?: {
        checkpointIds?: string[];
        description?: string;
        filePath?: string;
    }) {
        return shareCheckpointsInteractive(options);
    }

    async listSharedBundles() {
        return this.checkpointManager.listSharedBundles();
    }

    async getSharedCheckpointPanel(limit: number = 100) {
        return loadSharedCheckpointPanel(limit);
    }

    async importSharedBundle(filePath: string, importOptions?: ImportCheckpointsOptions) {
        return importBundleWithWorkspacePrompt(filePath, importOptions);
    }

    async revealSharedBundle(filePath: string) {
        return revealSharedBundle(filePath);
    }

    async getCheckpointTimeline(limit?: number) {
        const history = this.checkpointManager.getCheckpointHistoryForWorkspace();
        const branches = await this.checkpointManager.listBranches();
        const active = this.checkpointManager.getActiveBranch();
        return buildCheckpointTimeline({
            history,
            branches,
            activeBranchId: active?.id,
            limit,
        });
    }

    async createCheckpointBranch(name: string, baseCheckpointId: string, description?: string) {
        const branch = await this.checkpointManager.createBranch(
            name,
            baseCheckpointId,
            description ?? '',
        );
        return {
            success: Boolean(branch),
            branch: branch ? serializeBranch(branch) : null,
        };
    }

    async switchCheckpointBranch(branchId: string) {
        const success = await this.checkpointManager.switchBranch(branchId);
        return { success };
    }

    async analyzeCheckpoint(checkpointId: string) {
        const analysis = await this.checkpointManager.analyzeCheckpoint(checkpointId);
        return { success: Boolean(analysis), analysis };
    }

    async suggestCheckpointGroups(limit?: number) {
        const groups = await this.checkpointManager.suggestCheckpointGroups(limit);
        return { success: true, groups };
    }
    
    async getConfiguration(): Promise<any> {
        return getCheckpointConfiguration();
    }

    async saveConfiguration(config: any): Promise<boolean> {
        return saveCheckpointConfiguration(config);
    }
}
