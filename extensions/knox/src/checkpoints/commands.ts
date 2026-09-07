/**
 * VSCode commands for checkpoint functionality
 */

import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { getCheckpointConfigPath, getKnoxGlobalPath } from 'core/util/paths';

import { t } from '../i18n';

import { CheckpointManager, isWorkspaceMismatchError, type ImportCheckpointsOptions } from './CheckpointManager';
import { CheckpointCommand, checkpointIdFromArg, registerCanonicalCommand } from './commandIds';
import { showFileCheckpointHistory } from './fileHistoryCommands';
import { showCheckpointAnalysis } from './analysisCommands';
import {
    importBundleWithWorkspacePrompt,
    loadSharedCheckpointPanel,
    revealSharedBundle,
    shareCheckpointsInteractive,
} from './shareCommands';
import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import {
    AUTO_CHECKPOINT_DEFAULTS,
    defaultCheckpointConfig,
    isAiAutoCheckpointsEnabled,
} from './checkpointSettings';
import { notifyCheckpointRestored } from './notifyRestore';
import { CheckpointSessionManager, SessionType } from './SessionManager';
import {
    COMPARE_CATALOG_LIMIT,
    CHECKPOINT_LIST_PAGE_SIZE,
    checkpointMatchesQuery,
    checkpointMatchesSession,
    checkpointSessionId,
    isListableCheckpoint,
    paginateItems,
    searchablePaths,
    type CheckpointListQuery,
} from './manager/listQuery';
import { serializeBranch } from './manager/branchLogic';
import { buildCheckpointTimeline } from './manager/timeline';
import { 
    registerCheckpointCommands as registerNewCheckpointCommands 
} from './CheckpointCommands';
import { registerAutoCheckpointCommands } from './AutoCheckpointSystem';
import { registerInlineDiffCommands } from './InlineDiffDecorator';
import { registerCheckpointTreeView } from './CheckpointTreeProvider';

/**
 * Register all checkpoint-related commands
 */
export function registerCheckpointCommands(context: vscode.ExtensionContext): void {
    const checkpointManager = CheckpointManager.getInstance();
    
    // Init runs on activate; keep the command registered for scripts, not the palette.
    registerCanonicalCommand(context, CheckpointCommand.init, async () => {
        try {
            await checkpointManager.initialize(context);
            vscode.window.showInformationMessage(t('checkpoint.initialized'));
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedInit', { error }));
        }
    });
    
    // Create a manual checkpoint with options
    registerCanonicalCommand(context, CheckpointCommand.create, async () => {
        try {
            const description = await vscode.window.showInputBox({
                prompt: t('checkpoint.enterDescription'),
                placeHolder: t('checkpoint.descPlaceholder'),
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return t('checkpoint.descCannotBeEmpty');
                    }
                    if (value.length > 100) {
                        return t('checkpoint.descMaxLength');
                    }
                    return null;
                }
            });
            
            if (!description) {
                return; // User cancelled
            }
            
            const checkpointId = await checkpointManager.createManualCheckpoint({
                description: description.trim()
            });
            
            if (checkpointId) {
                vscode.window.showInformationMessage(
                    t('checkpoint.created', { id: checkpointId.substring(0, 8) }),
                    t('checkpoint.viewHistory')
                ).then(selection => {
                    if (selection === t('checkpoint.viewHistory')) {
                        vscode.commands.executeCommand(CheckpointCommand.list);
                    }
                });
            } else {
                vscode.window.showInformationMessage(t('checkpoint.noChanges'));
            }
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedCreate', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.list, async () => {
        try {
            await checkpointManager.showCheckpointList();
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedShow', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.stats, async () => {
        try {
            const stats = await checkpointManager.getCheckpointStatistics();
            const storagePath = checkpointManager.getCurrentStoragePath();
            
            const message = [
                t('checkpoint.statsTitle'),
                '',
                t('checkpoint.totalCheckpoints', { count: stats.totalCheckpoints }),
                t('checkpoint.activeSessions', { count: stats.totalSessions }),
                t('checkpoint.storageUsed', { size: formatBytes(stats.totalStorageBytes) }),
                t('checkpoint.filesTracked', { count: stats.filesTracked }),
                t('checkpoint.averageSize', { size: formatBytes(stats.avgCheckpointSize) }),
                '',
                t('checkpoint.storageLocation', { path: storagePath }),
                '',
                stats.oldestCheckpoint ? t('checkpoint.oldest', { date: formatDate(stats.oldestCheckpoint) }) : '',
                stats.newestCheckpoint ? t('checkpoint.newest', { date: formatDate(stats.newestCheckpoint) }) : '',
            ].filter(line => line !== '').join('\n');
            
            const action = await vscode.window.showInformationMessage(
                message,
                { modal: false },
                t('checkpoint.openStorageFolder'),
                t('checkpoint.exportData'),
                t('checkpoint.cleanupOld'),
                t('checkpoint.viewHistory')
            );
            
            switch (action) {
                case t('checkpoint.openStorageFolder'):
                    vscode.env.openExternal(vscode.Uri.file(storagePath));
                    break;
                case t('checkpoint.exportData'):
                    vscode.commands.executeCommand(CheckpointCommand.export);
                    break;
                case t('checkpoint.cleanupOld'):
                    vscode.commands.executeCommand(CheckpointCommand.cleanup);
                    break;
                case t('checkpoint.viewHistory'):
                    vscode.commands.executeCommand(CheckpointCommand.list);
                    break;
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedStats', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.cleanup, async () => {
        try {
            const retentionDays = await vscode.window.showInputBox({
                prompt: t('checkpoint.enterRetention'),
                value: '7',
                validateInput: (value) => {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 1 || num > 365) {
                        return t('checkpoint.retentionValidation');
                    }
                    return null;
                }
            });
            
            if (!retentionDays) {
                return; // User cancelled
            }
            
            const days = parseInt(retentionDays);
            const deletedCount = await checkpointManager.cleanupOldCheckpoints(days);
            
            if (deletedCount > 0) {
                vscode.window.showInformationMessage(
                    t('checkpoint.cleanedUp', { count: deletedCount, days })
                );
            } else {
                vscode.window.showInformationMessage(t('checkpoint.noOldCheckpoints'));
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedCleanup', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.export, async () => {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`knox-checkpoints-${new Date().toISOString().split('T')[0]}.knoxcp.json`),
                filters: {
                    'Knox Checkpoint Bundles': ['json'],
                    'All Files': ['*']
                }
            });
            
            if (!uri) {
                return; // User cancelled
            }
            
            await checkpointManager.exportCheckpoints(uri.fsPath);
            
            const action = await vscode.window.showInformationMessage(
                t('checkpoint.exportedSuccess', { path: uri.fsPath }),
                t('checkpoint.openFile'),
                t('checkpoint.showInExplorer')
            );
            
            if (action === t('checkpoint.openFile')) {
                vscode.commands.executeCommand('vscode.open', uri);
            } else if (action === t('checkpoint.showInExplorer')) {
                vscode.commands.executeCommand('revealFileInOS', uri);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedExport', { error }));
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.share, async () => {
        try {
            await shareCheckpointsInteractive();
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.share.failed', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.import, async () => {
        try {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    'Knox Checkpoint Bundles': ['json'],
                    'All Files': ['*']
                }
            });
            
            if (!uris || uris.length === 0) {
                return; // User cancelled
            }
            
            const mergeOption = await vscode.window.showQuickPick([
                {
                    label: t('checkpoint.mergeExisting'),
                    description: t('checkpoint.mergeExistingDesc'),
                    value: 'merge' as const,
                },
                {
                    label: t('checkpoint.importAsNewIds'),
                    description: t('checkpoint.importAsNewIdsDesc'),
                    value: 'remap' as const,
                },
                {
                    label: t('checkpoint.replaceExisting'),
                    description: t('checkpoint.replaceExistingDesc'),
                    value: 'replace' as const,
                }
            ], {
                placeHolder: t('checkpoint.handleImported')
            });
            
            if (!mergeOption) {
                return; // User cancelled
            }

            const importOptions: ImportCheckpointsOptions = {
                merge: mergeOption.value !== 'replace',
                remapIds: mergeOption.value === 'remap',
            };

            let importedCount: number;
            try {
                importedCount = await importBundleWithWorkspacePrompt(uris[0].fsPath, importOptions);
            } catch (error) {
                if (!isWorkspaceMismatchError(error)) {
                    throw error;
                }
                return;
            }
            
            vscode.window.showInformationMessage(
                t('checkpoint.importedSuccess', { count: importedCount }),
                t('checkpoint.viewHistory')
            ).then(selection => {
                if (selection === t('checkpoint.viewHistory')) {
                    vscode.commands.executeCommand(CheckpointCommand.list);
                }
            });
            
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedImport', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.restore, async (checkpointId?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(checkpointId) ?? '';

            if (!targetCheckpointId) {
                const history = checkpointManager.getCheckpointHistoryForWorkspace();
                if (history.length === 0) {
                    vscode.window.showInformationMessage(t('checkpoint.noCheckpoints'));
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    [...history]
                        .sort((a, b) => b.created.getTime() - a.created.getTime())
                        .map((checkpoint) => ({
                            label: `$(history) ${checkpoint.description}`,
                            description: checkpoint.created.toLocaleString(),
                            detail: `ID: ${checkpoint.id.substring(0, 8)}...`,
                            checkpoint,
                        })),
                    {
                        placeHolder: t('checkpoint.auto.selectCheckpoint'),
                        matchOnDescription: true,
                        matchOnDetail: true,
                    },
                );

                if (!selected) {
                    return;
                }
                targetCheckpointId = selected.checkpoint.id;
            }

            await CheckpointChatIntegration.getInstance().restoreCheckpoint(targetCheckpointId);
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedRestore', { error }));
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.fileHistory, async (arg?: unknown) => {
        try {
            await showFileCheckpointHistory(arg);
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedRestore', { error }));
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.analyze, async (arg?: unknown) => {
        try {
            await showCheckpointAnalysis(arg);
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.analysis.failed', { error }));
        }
    });
    
    // Register new configuration and enhancement commands
    registerNewCheckpointCommands(context);
    
    // Register auto-checkpoint system commands (undo/redo, branching, auto-checkpoints)
    registerAutoCheckpointCommands(context);
    
    // Register inline diff decorator commands (show/hide diff in editor)
    registerInlineDiffCommands(context);

    registerCheckpointTreeView(context);
    
    console.log('📋 Checkpoint commands registered');
}

// Helper functions for formatting
function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 Bytes';
    }
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date: Date): string {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

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
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
     * Applies the same write + extra-delete set as previewRestore so GUI/agent
     * Restore All matches the preview the user already saw.
     */
    async restoreCheckpointDirect(
        checkpointId: string,
        options?: { rewindMemory?: boolean },
    ): Promise<{
        success: boolean;
        restoredFiles: string[];
        failedFiles: Array<{ path: string; error: string }>;
        skippedFiles: Array<{ path: string; reason: string }>;
        message?: string;
        memoryRewound?: boolean;
        memoryMessage?: string;
    }> {
        const empty = {
            restoredFiles: [] as string[],
            failedFiles: [] as Array<{ path: string; error: string }>,
            skippedFiles: [] as Array<{ path: string; reason: string }>,
        };
        try {
            const checkpointInfo = this.checkpointManager.getCheckpointInfo(checkpointId);
            if (!checkpointInfo) {
                return { success: false, ...empty, message: t('checkpoint.notFound') };
            }

            const skippedFiles = (checkpointInfo.skippedFiles ?? []).map((skipped) => ({
                path: skipped.path,
                reason: skipped.reason,
            }));

            const result = await this.applyRestorePreview(checkpointId, {
                createBackup: true,
                conflictResolution: 'overwrite',
            });
            
            if (result.success) {
                vscode.window.showInformationMessage(
                    t('checkpoint.restoredFiles', { count: result.restoredFiles.length }),
                    { modal: false }
                );
                const notified = await notifyCheckpointRestored(
                    checkpointId,
                    result.restoredFiles,
                    { rewindMemory: options?.rewindMemory },
                );
                return {
                    success: true,
                    restoredFiles: result.restoredFiles,
                    failedFiles: result.failedFiles,
                    skippedFiles,
                    memoryRewound: notified.memoryRewound,
                    memoryMessage: notified.memoryMessage,
                };
            } else {
                vscode.window.showWarningMessage(
                    t('checkpoint.restoreErrors', { count: result.failedFiles.length }),
                    { modal: false }
                );
                return {
                    success: false,
                    restoredFiles: result.restoredFiles,
                    failedFiles: result.failedFiles,
                    skippedFiles,
                    message: 'Partial failure',
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(t('checkpoint.failedRestoreMsg', { error: errorMsg }), { modal: false });
            return { success: false, ...empty, message: errorMsg };
        }
    }

    /**
     * Apply preview writePaths + extraPaths (or a full restore if preview is unavailable).
     */
    private async applyRestorePreview(
        checkpointId: string,
        options?: {
            createBackup?: boolean;
            conflictResolution?: 'overwrite' | 'prompt';
        },
    ): Promise<{
        success: boolean;
        restoredFiles: string[];
        failedFiles: Array<{ path: string; error: string }>;
        removedFiles?: string[];
        conflicts?: Array<{ path: string; type: string }>;
        alreadyCurrent: boolean;
    }> {
        let preview: Awaited<ReturnType<CheckpointManager['previewRestore']>> = null;
        try {
            preview = await this.checkpointManager.previewRestore(checkpointId);
        } catch (error) {
            console.error('Failed to preview restore:', error);
        }

        if (preview && preview.writePaths.length === 0 && preview.extraPaths.length === 0) {
            return {
                success: true,
                restoredFiles: [],
                failedFiles: [],
                removedFiles: [],
                conflicts: [],
                alreadyCurrent: true,
            };
        }

        if (preview) {
            if (options?.createBackup !== false) {
                await this.checkpointManager.createManualCheckpoint({
                    description: `Pre-restore backup for ${checkpointId}`,
                    allowEmpty: true,
                    forceBaseline: true,
                });
            }
            const result = await this.checkpointManager.restoreCheckpointFiles(
                checkpointId,
                [...preview.writePaths, ...preview.extraPaths],
            );
            return {
                success: result.success,
                restoredFiles: result.restoredFiles,
                failedFiles: result.failedFiles,
                alreadyCurrent: false,
            };
        }

        const result = await this.checkpointManager.restoreCheckpoint(checkpointId, {
            createBackup: options?.createBackup !== false,
            conflictResolution: options?.conflictResolution ?? 'overwrite',
            cleanupExtraFiles: true,
        });
        return {
            success: result.success,
            restoredFiles: result.restoredFiles,
            failedFiles: result.failedFiles,
            removedFiles: result.removedFiles,
            conflicts: result.conflicts,
            alreadyCurrent: false,
        };
    }
    
    /**
     * Restore a checkpoint by ID (with preview counts, then confirmation)
     */
    async restoreCheckpoint(checkpointId: string): Promise<void> {
        const checkpointInfo = this.checkpointManager.getCheckpointInfo(checkpointId);
        if (!checkpointInfo) {
            vscode.window.showErrorMessage(t('checkpoint.notFound'));
            return;
        }

        let preview: Awaited<ReturnType<CheckpointManager['previewRestore']>> = null;
        try {
            preview = await this.checkpointManager.previewRestore(checkpointId);
        } catch (error) {
            console.error('Failed to preview restore:', error);
        }

        const counts = preview
            ? t('checkpoint.restorePreview', {
                modified: preview.modified,
                added: preview.added,
                deleted: preview.deleted,
            })
            : t('checkpoint.restorePreviewUnavailable');
        const question = preview && preview.files.length === 0
            ? t('checkpoint.restorePreviewEmpty', { description: checkpointInfo.description })
            : t('checkpoint.restoreQuestion', { description: checkpointInfo.description });

        const restoreAll = t('checkpoint.restoreAll');
        const restoreSelected = t('checkpoint.restoreSelected');
        const restoreWithMemory = t('checkpoint.restoreWithMemory');
        const cancel = t('checkpoint.cancel');
        const action = await vscode.window.showInformationMessage(
            `${question}\n${counts}`,
            { modal: true },
            restoreAll,
            restoreSelected,
            restoreWithMemory,
            cancel,
        );

        if (!action || action === cancel) {
            return;
        }

        try {
            if (action === restoreSelected) {
                const files = preview?.files ?? [];
                if (files.length === 0) {
                    vscode.window.showInformationMessage(t('checkpoint.workspaceCorrectState'));
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    files.map((file) => ({
                        label: file.relativePath,
                        description: t(`checkpoint.restoreAction.${file.action}`),
                        detail: t('checkpoint.restoreHunkDetail', {
                            additions: file.additions,
                            deletions: file.deletions,
                            hunks: file.hunkCount,
                        }),
                        picked: file.action !== 'delete',
                        relativePath: file.relativePath,
                    })),
                    {
                        canPickMany: true,
                        placeHolder: t('checkpoint.restorePreviewPick'),
                    },
                );
                if (!picked || picked.length === 0) {
                    return;
                }
                const result = await this.checkpointManager.restoreCheckpointFiles(
                    checkpointId,
                    picked.map((item) => item.relativePath),
                );
                if (result.success) {
                    vscode.window.showInformationMessage(
                        t('checkpoint.filesRestoredSuccess', { count: result.restoredFiles.length }),
                    );
                } else if (result.failedFiles.length > 0) {
                    vscode.window.showWarningMessage(
                        t('checkpoint.filesRestoredWithErrors', { count: result.failedFiles.length }),
                    );
                }
                return;
            }

            const result = await this.applyRestorePreview(checkpointId, {
                createBackup: true,
                conflictResolution: 'prompt',
            });

            const totalChanges = result.restoredFiles.length + (result.removedFiles?.length || 0);

            if (result.success) {
                void notifyCheckpointRestored(checkpointId, result.restoredFiles, {
                    rewindMemory: action === restoreWithMemory,
                });
            }

            if (result.alreadyCurrent || (result.success && totalChanges === 0 && !(result.conflicts?.length))) {
                vscode.window.showInformationMessage(
                    t('checkpoint.workspaceCorrectState')
                );
                return;
            }

            if (result.success && totalChanges > 0) {
                let message = t('checkpoint.restoredSuccessDetail', { restored: result.restoredFiles.length });
                if (result.removedFiles && result.removedFiles.length > 0) {
                    message += t('checkpoint.filesRemoved', { removed: result.removedFiles.length });
                }
                message += '.';
                vscode.window.showInformationMessage(message);
            } else if (result.failedFiles.length > 0 && totalChanges > 0) {
                let message = t('checkpoint.restoredWithIssues', { restored: result.restoredFiles.length });
                if (result.removedFiles && result.removedFiles.length > 0) {
                    message += t('checkpoint.filesRemoved', { removed: result.removedFiles.length });
                }
                message += t('checkpoint.filesFailed', { failed: result.failedFiles.length });
                vscode.window.showWarningMessage(message);
            } else if (result.failedFiles.length > 0) {
                vscode.window.showErrorMessage(
                    t('checkpoint.restorationFailed', { failed: result.failedFiles.length })
                );
            } else if (totalChanges === 0 && (result.conflicts?.length ?? 0) > 0) {
                console.log('ℹ️ User cancelled checkpoint restoration');
            }
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedRestore', { error }));
        }
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
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    
    /**
     * Get checkpoint configuration
     */
    async getConfiguration(): Promise<any> {
        try {
            const defaultConfig = {
                ...defaultCheckpointConfig(),
                autoEnabled: AUTO_CHECKPOINT_DEFAULTS.enabled,
                autoMinIntervalMs: AUTO_CHECKPOINT_DEFAULTS.minIntervalMs,
                autoFileChangeThreshold: AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold,
                autoShowNotifications: AUTO_CHECKPOINT_DEFAULTS.showNotifications,
            };

            // Try to load from global config file first (~/.knox/checkpoint-config.json)
            let fileConfig = null;
            try {
                const fs = require('fs').promises;
                const configPath = getCheckpointConfigPath();
                
                if (require('fs').existsSync(configPath)) {
                    const configContent = await fs.readFile(configPath, 'utf8');
                    fileConfig = JSON.parse(configContent);
                    console.log('✅ Loaded checkpoint configuration from', configPath);
                }
            } catch (fileError) {
                console.warn('⚠️ Failed to load configuration from ~/.knox/checkpoint-config.json:', fileError);
            }

            // Load from VSCode settings
            const config = vscode.workspace.getConfiguration('knox.checkpoints');
            const auto = vscode.workspace.getConfiguration('knox.checkpoints.auto');
            const vscodeConfig: Record<string, any> = {
                maxCheckpoints: config.get('maxCheckpoints'),
                retentionDays: config.get('retentionDays'),
                maxStorageBytes: config.get('maxStorageBytes'),
                maxFilesPerCheckpoint: config.get('maxFilesPerCheckpoint'),
                maxFileSizeBytes: config.get('maxFileSizeBytes'),
                captureBinaryFiles: config.get('captureBinaryFiles'),
                enableCompression: config.get('enableCompression'),
                encryptAtRest: config.get('encryptAtRest'),
                enableAutoCheckpoints: config.get('enableAutoCheckpoints'),
                trackedExtensions: config.get('trackedExtensions'),
                autoCleanup: config.get('autoCleanup'),
                cleanupIntervalHours: config.get('cleanupIntervalHours'),
                autoEnabled: auto.get('enabled', AUTO_CHECKPOINT_DEFAULTS.enabled),
                autoMinIntervalMs: auto.get('minIntervalMs', AUTO_CHECKPOINT_DEFAULTS.minIntervalMs),
                autoFileChangeThreshold: auto.get(
                    'fileChangeThreshold',
                    AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold,
                ),
                autoShowNotifications: auto.get(
                    'showNotifications',
                    AUTO_CHECKPOINT_DEFAULTS.showNotifications,
                ),
            };

            // Remove undefined values from vscodeConfig
            Object.keys(vscodeConfig).forEach((key: string) => {
                if (vscodeConfig[key] === undefined) {
                    delete vscodeConfig[key];
                }
            });
            
            // Merge configs: defaults < file config < VSCode settings
            let configData = { ...defaultConfig, ...fileConfig, ...vscodeConfig };
            
            // Apply capture-related settings to the TypeScript manager runtime
            try {
                CheckpointManager.getInstance().applyRuntimeConfig(configData);
            } catch (runtimeError) {
                console.warn('⚠️ Failed to apply runtime configuration:', runtimeError);
            }
            
            return configData;
        } catch (error) {
            console.error('Failed to get checkpoint configuration:', error);
            // Return defaults on error
            return defaultCheckpointConfig();
        }
    }
    
    /**
     * Save checkpoint configuration
     */
    async saveConfiguration(config: any): Promise<boolean> {
        try {
            // 1. Save to global config file (~/.knox/checkpoint-config.json)
            try {
                const fs = require('fs').promises;
                const configPath = getCheckpointConfigPath();
                const knoxDir = getKnoxGlobalPath();
                
                // Ensure the directory exists
                await fs.mkdir(knoxDir, { recursive: true });
                
                // Write the config file with pretty formatting
                const configContent = JSON.stringify(config, null, 2);
                await fs.writeFile(configPath, configContent, 'utf8');
                console.log('✅ Checkpoint configuration saved to', configPath);
            } catch (fileError) {
                console.error('❌ Failed to save configuration to ~/.knox/checkpoint-config.json:', fileError);
                // Don't fail the entire operation, continue with VSCode settings
            }

            // 2. Save to VSCode settings (for backward compatibility and IDE integration)
            const workspaceConfig = vscode.workspace.getConfiguration('knox.checkpoints');
            const autoConfig = vscode.workspace.getConfiguration('knox.checkpoints.auto');
            
            await Promise.all([
                workspaceConfig.update('maxCheckpoints', config.maxCheckpoints, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('retentionDays', config.retentionDays, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('maxStorageBytes', config.maxStorageBytes, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('maxFilesPerCheckpoint', config.maxFilesPerCheckpoint, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('maxFileSizeBytes', config.maxFileSizeBytes, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('captureBinaryFiles', config.captureBinaryFiles, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('enableCompression', config.enableCompression, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('encryptAtRest', config.encryptAtRest, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('enableAutoCheckpoints', config.enableAutoCheckpoints, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('trackedExtensions', config.trackedExtensions, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('autoCleanup', config.autoCleanup, vscode.ConfigurationTarget.Global),
                workspaceConfig.update('cleanupIntervalHours', config.cleanupIntervalHours, vscode.ConfigurationTarget.Global),
                autoConfig.update(
                    'enabled',
                    typeof config.autoEnabled === 'boolean'
                        ? config.autoEnabled
                        : AUTO_CHECKPOINT_DEFAULTS.enabled,
                    vscode.ConfigurationTarget.Global,
                ),
                autoConfig.update(
                    'minIntervalMs',
                    typeof config.autoMinIntervalMs === 'number'
                        ? config.autoMinIntervalMs
                        : AUTO_CHECKPOINT_DEFAULTS.minIntervalMs,
                    vscode.ConfigurationTarget.Global,
                ),
                autoConfig.update(
                    'fileChangeThreshold',
                    typeof config.autoFileChangeThreshold === 'number'
                        ? config.autoFileChangeThreshold
                        : AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold,
                    vscode.ConfigurationTarget.Global,
                ),
                autoConfig.update(
                    'showNotifications',
                    typeof config.autoShowNotifications === 'boolean'
                        ? config.autoShowNotifications
                        : AUTO_CHECKPOINT_DEFAULTS.showNotifications,
                    vscode.ConfigurationTarget.Global,
                ),
            ]);
            
            // 3. Apply capture-related settings to the TypeScript manager immediately
            try {
                CheckpointManager.getInstance().applyRuntimeConfig(config);
                void CheckpointManager.getInstance().enforceRetentionPolicies();
                AutoCheckpointSystem.getInstance().reloadConfiguration();
                console.log('✅ Checkpoint configuration saved to global config file and VS Code settings');
            } catch (runtimeError) {
                console.warn('⚠️ Failed to apply runtime configuration:', runtimeError);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to save checkpoint configuration:', error);
            return false;
        }
    }
}
