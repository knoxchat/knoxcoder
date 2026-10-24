import * as vscode from 'vscode';
import { t } from '../i18n';
import { CheckpointManager } from './CheckpointManager';
import { notifyCheckpointRestored } from './notifyRestore';

/** Restore operations behind CheckpointChatIntegration. */
export class CheckpointRestoreOps {
    constructor(private readonly getManager: () => CheckpointManager) {}

    private get checkpointManager(): CheckpointManager {
        return this.getManager();
    }

    /**
     * Restore a checkpoint by ID (direct restore without confirmation).
     * GUI Restore All and the agent restore tool use the journaled engine
     * (`restoreCheckpoint`) so a crash can roll back or recover on next init.
     * Preview still runs first so a no-op restore does not create a backup.
     */
    async restoreCheckpointDirect(
        checkpointId: string,
        options?: { rewindMemory?: boolean; silent?: boolean; cleanupExtraFiles?: boolean },
    ): Promise<{
        success: boolean;
        restoredFiles: string[];
        failedFiles: Array<{ path: string; error: string }>;
        skippedFiles: Array<{ path: string; reason: string }>;
        removedFiles?: string[];
        message?: string;
        memoryRewound?: boolean;
        memoryMessage?: string;
    }> {
        const empty = {
            restoredFiles: [] as string[],
            failedFiles: [] as Array<{ path: string; error: string }>,
            skippedFiles: [] as Array<{ path: string; reason: string }>,
            removedFiles: [] as string[],
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

            const result = await this.applyJournaledRestore(checkpointId, {
                createBackup: true,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: options?.cleanupExtraFiles,
            });
            
            if (result.success) {
                if (!options?.silent) {
                    vscode.window.showInformationMessage(
                        t('checkpoint.restoredFiles', { count: result.restoredFiles.length }),
                        { modal: false }
                    );
                }
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
                    removedFiles: result.removedFiles,
                    memoryRewound: notified.memoryRewound,
                    memoryMessage: notified.memoryMessage,
                };
            } else {
                if (!options?.silent) {
                    vscode.window.showWarningMessage(
                        t('checkpoint.restoreErrors', { count: result.failedFiles.length }),
                        { modal: false }
                    );
                }
                return {
                    success: false,
                    restoredFiles: result.restoredFiles,
                    failedFiles: result.failedFiles,
                    skippedFiles,
                    removedFiles: result.removedFiles,
                    message: 'Partial failure',
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (!options?.silent) {
                vscode.window.showErrorMessage(t('checkpoint.failedRestoreMsg', { error: errorMsg }), { modal: false });
            }
            return { success: false, ...empty, message: errorMsg };
        }
    }

    /**
     * Full Restore All through the journaled engine. Preview is only used to
     * skip a no-op; writes, extra-file cleanup, backup, and rollback all go
     * through `restoreCheckpoint`.
     */
    private async applyJournaledRestore(
        checkpointId: string,
        options?: {
            createBackup?: boolean;
            conflictResolution?: 'overwrite' | 'prompt';
            cleanupExtraFiles?: boolean;
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

        const result = await this.checkpointManager.restoreCheckpoint(checkpointId, {
            createBackup: options?.createBackup !== false,
            conflictResolution: options?.conflictResolution ?? 'overwrite',
            cleanupExtraFiles: options?.cleanupExtraFiles !== false,
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
                const writePaths = preview?.writePaths;
                const relativePaths = picked
                    .map((item) => item.relativePath)
                    .filter((relativePath) => !writePaths || writePaths.includes(relativePath));
                if (relativePaths.length === 0) {
                    vscode.window.showInformationMessage(t('checkpoint.workspaceCorrectState'));
                    return;
                }
                const result = await this.checkpointManager.restoreCheckpointFiles(
                    checkpointId,
                    relativePaths,
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

            const result = await this.applyJournaledRestore(checkpointId, {
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
}
