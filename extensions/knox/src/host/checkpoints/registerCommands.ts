import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { CheckpointManager, isWorkspaceMismatchError, type ImportCheckpointsOptions } from './CheckpointManager';
import { CheckpointGraphView } from './CheckpointGraphView';
import { CheckpointCommand, checkpointDescriptionFromArg, checkpointIdFromArg, checkpointSkipConfirmFromArg, registerCanonicalCommand } from './commandIds';
import { showFileCheckpointHistory } from './fileHistoryCommands';
import { showCheckpointAnalysis } from './analysisCommands';
import { importBundleWithWorkspacePrompt, shareCheckpointsInteractive } from './shareCommands';
import { registerCheckpointCommands as registerNewCheckpointCommands } from './CheckpointCommands';
import { registerAutoCheckpointCommands } from './autoCheckpointCommands';
import { registerInlineDiffCommands } from './InlineDiffDecorator';
import { CheckpointChatIntegration } from './commands';

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
    registerCanonicalCommand(context, CheckpointCommand.create, async (arg?: unknown) => {
        try {
            let description = checkpointDescriptionFromArg(arg);
            const scripted = Boolean(description);
            if (!description) {
                description = await vscode.window.showInputBox({
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
            }
            
            if (!description) {
                return; // User cancelled
            }
            
            const checkpointId = await checkpointManager.createManualCheckpoint({
                description: description.trim()
            });
            
            if (checkpointId && !scripted) {
                vscode.window.showInformationMessage(
                    t('checkpoint.created', { id: checkpointId.substring(0, 8) }),
                    t('checkpoint.viewHistory')
                ).then(selection => {
                    if (selection === t('checkpoint.viewHistory')) {
                        vscode.commands.executeCommand(CheckpointCommand.view);
                    }
                });
            } else if (!checkpointId && !scripted) {
                vscode.window.showInformationMessage(t('checkpoint.noChanges'));
            }
            return checkpointId;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedCreate', { error }));
            return undefined;
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.view, () => {
        try {
            CheckpointGraphView.createOrShow(context);
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedShow', { error }));
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
                    vscode.commands.executeCommand(CheckpointCommand.view);
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
                    vscode.commands.executeCommand(CheckpointCommand.view);
                }
            });
            
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedImport', { error }));
        }
    });
    
    registerCanonicalCommand(context, CheckpointCommand.restore, async (checkpointId?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(checkpointId) ?? '';

            if (targetCheckpointId && checkpointSkipConfirmFromArg(checkpointId)) {
                return await CheckpointChatIntegration.getInstance().restoreCheckpointDirect(
                    targetCheckpointId,
                    { silent: true },
                );
            }

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
