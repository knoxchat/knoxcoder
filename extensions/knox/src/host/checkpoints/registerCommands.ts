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
import { registerBlameCommands } from './BlameDecorator';
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

    registerCanonicalCommand(context, CheckpointCommand.checkout, async (arg?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(arg) ?? '';
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
                            label: checkpoint.label || checkpoint.description || checkpoint.id,
                            description: checkpoint.created.toLocaleString(),
                            detail: checkpoint.id,
                            checkpoint,
                        })),
                    { placeHolder: t('checkpoint.checkout.pickCheckpoint') },
                );
                if (!selected) {
                    return;
                }
                targetCheckpointId = selected.checkpoint.id;
            }
            const result = await checkpointManager.checkoutCheckpoint(targetCheckpointId);
            if (!result.success) {
                vscode.window.showErrorMessage(
                    t('checkpoint.checkout.failed', { error: result.message || 'unknown error' }),
                );
                return result;
            }
            vscode.window.showInformationMessage(
                result.detached
                    ? t('checkpoint.checkout.detached', { id: targetCheckpointId.slice(0, 11) })
                    : t('checkpoint.checkout.switched', { name: result.branchId ?? targetCheckpointId.slice(0, 11) }),
            );
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.checkout.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.stash, async (arg?: unknown) => {
        try {
            let message = checkpointDescriptionFromArg(arg);
            if (message === undefined && !checkpointSkipConfirmFromArg(arg)) {
                message = await vscode.window.showInputBox({
                    prompt: t('checkpoint.stash.enterMessage'),
                    placeHolder: t('checkpoint.stash.messagePlaceholder'),
                });
                if (message === undefined) {
                    return;
                }
            }
            const result = await checkpointManager.stashPush({ message: message?.trim() || undefined });
            if (result.empty) {
                vscode.window.showInformationMessage(t('checkpoint.stash.empty'));
                return result;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(t('checkpoint.stash.pushed', { count: result.fileCount ?? 0 }));
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.stashPop, async (arg?: unknown) => {
        try {
            const stashId = checkpointIdFromArg(arg);
            const result = await checkpointManager.stashPop(stashId);
            if (result.empty) {
                vscode.window.showInformationMessage(t('checkpoint.stash.none'));
                return result;
            }
            if (result.conflicts.length > 0) {
                vscode.window.showWarningMessage(
                    t('checkpoint.stash.conflicts', { paths: result.conflicts.map((conflict) => conflict.path).join(', ') }),
                );
                return result;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error: result.message || 'unknown error' }));
                return result;
            }
            const files = (result.restoredFiles?.length ?? 0) + (result.removedFiles?.length ?? 0);
            vscode.window.showInformationMessage(t('checkpoint.stash.popped', { id: (result.stashId ?? '').slice(0, 11), files }));
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.stashList, async () => {
        try {
            const listed = await checkpointManager.stashList();
            if (listed.length === 0) {
                vscode.window.showInformationMessage(t('checkpoint.stash.none'));
                return listed;
            }
            const selected = await vscode.window.showQuickPick(
                listed.map((entry) => ({
                    label: entry.message || entry.id,
                    description: entry.createdAt.toLocaleString(),
                    detail: `${entry.fileCount} file(s) · ${entry.id}`,
                    entry,
                })),
                { placeHolder: t('checkpoint.stash.listPlaceholder') },
            );
            if (!selected) {
                return listed;
            }
            const action = await vscode.window.showQuickPick(
                [
                    { label: t('checkpoint.stash.popAction'), value: 'pop' as const },
                    { label: t('checkpoint.stash.applyAction'), value: 'apply' as const },
                    { label: t('checkpoint.stash.dropAction'), value: 'drop' as const },
                ],
                { placeHolder: selected.entry.id },
            );
            if (!action) {
                return listed;
            }
            if (action.value === 'drop') {
                const dropped = await checkpointManager.stashDrop(selected.entry.id);
                if (dropped.success) {
                    vscode.window.showInformationMessage(t('checkpoint.stash.dropped', { id: selected.entry.id.slice(0, 11) }));
                } else {
                    vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error: dropped.message || 'unknown error' }));
                }
                return listed;
            }
            const result = action.value === 'pop'
                ? await checkpointManager.stashPop(selected.entry.id)
                : await checkpointManager.stashApply(selected.entry.id);
            if (result.conflicts.length > 0) {
                vscode.window.showWarningMessage(
                    t('checkpoint.stash.conflicts', { paths: result.conflicts.map((conflict) => conflict.path).join(', ') }),
                );
                return listed;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error: result.message || 'unknown error' }));
                return listed;
            }
            const files = (result.restoredFiles?.length ?? 0) + (result.removedFiles?.length ?? 0);
            vscode.window.showInformationMessage(
                t(action.value === 'pop' ? 'checkpoint.stash.popped' : 'checkpoint.stash.applied', {
                    id: (result.stashId ?? '').slice(0, 11),
                    files,
                }),
            );
            return listed;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.stash.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.cherryPick, async (arg?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(arg) ?? '';
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
                            label: checkpoint.label || checkpoint.description || checkpoint.id,
                            description: checkpoint.created.toLocaleString(),
                            detail: checkpoint.id,
                            checkpoint,
                        })),
                    { placeHolder: t('checkpoint.cherryPick.pickCheckpoint') },
                );
                if (!selected) {
                    return;
                }
                targetCheckpointId = selected.checkpoint.id;
            }
            const result = await checkpointManager.cherryPick(targetCheckpointId);
            if (result.conflicts.length > 0) {
                vscode.window.showWarningMessage(
                    t('checkpoint.cherryPick.conflicts', { paths: result.conflicts.map((conflict) => conflict.path).join(', ') }),
                );
                return result;
            }
            if (result.empty) {
                vscode.window.showInformationMessage(t('checkpoint.cherryPick.empty'));
                return result;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(
                    t('checkpoint.cherryPick.failed', { error: result.message || 'unknown error' }),
                );
                return result;
            }
            vscode.window.showInformationMessage(
                t('checkpoint.cherryPick.applied', { id: (result.checkpointId ?? '').slice(0, 11) }),
            );
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.cherryPick.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.revert, async (arg?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(arg) ?? '';
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
                            label: checkpoint.label || checkpoint.description || checkpoint.id,
                            description: checkpoint.created.toLocaleString(),
                            detail: checkpoint.id,
                            checkpoint,
                        })),
                    { placeHolder: t('checkpoint.revert.pickCheckpoint') },
                );
                if (!selected) {
                    return;
                }
                targetCheckpointId = selected.checkpoint.id;
            }
            const result = await checkpointManager.revertCheckpoint(targetCheckpointId);
            if (result.conflicts.length > 0) {
                vscode.window.showWarningMessage(
                    t('checkpoint.revert.conflicts', { paths: result.conflicts.map((conflict) => conflict.path).join(', ') }),
                );
                return result;
            }
            if (result.empty) {
                vscode.window.showInformationMessage(t('checkpoint.revert.empty'));
                return result;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(
                    t('checkpoint.revert.failed', { error: result.message || 'unknown error' }),
                );
                return result;
            }
            vscode.window.showInformationMessage(
                t('checkpoint.revert.applied', { id: (result.checkpointId ?? '').slice(0, 11) }),
            );
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.revert.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.mergeContinue, async () => {
        try {
            const result = await checkpointManager.mergeContinue();
            if (result.conflicts.length > 0) {
                vscode.window.showWarningMessage(
                    t('checkpoint.merge.unresolved', { paths: result.conflicts.map((conflict) => conflict.path).join(', ') }),
                );
                return result;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.merge.continueFailed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(t('checkpoint.merge.continued', { id: (result.checkpointId ?? '').slice(0, 11) }));
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.merge.continueFailed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.materializeWorktree, async (arg?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(arg) ?? '';
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
                            label: checkpoint.label || checkpoint.description || checkpoint.id,
                            description: checkpoint.created.toLocaleString(),
                            detail: checkpoint.id,
                            checkpoint,
                        })),
                    { placeHolder: t('checkpoint.worktree.pickCheckpoint') },
                );
                if (!selected) {
                    return;
                }
                targetCheckpointId = selected.checkpoint.id;
            }
            const result = await checkpointManager.materializeWorktree(targetCheckpointId);
            if (!result.success || !result.path) {
                vscode.window.showErrorMessage(t('checkpoint.worktree.failed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(t('checkpoint.worktree.created', { path: result.path }));
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.path));
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.worktree.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.removeWorktree, async () => {
        try {
            const worktrees = await checkpointManager.listWorktrees();
            if (worktrees.length === 0) {
                vscode.window.showInformationMessage(t('checkpoint.worktree.none'));
                return;
            }
            const selected = await vscode.window.showQuickPick(
                worktrees.map((item) => ({
                    label: item.path,
                    description: item.checkpointId.slice(0, 11),
                    detail: item.id,
                    item,
                })),
                { placeHolder: t('checkpoint.worktree.pickRemove') },
            );
            if (!selected) {
                return;
            }
            const result = await checkpointManager.removeWorktree(selected.item.id);
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.worktree.failed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(t('checkpoint.worktree.removed', { id: selected.item.id.slice(0, 11) }));
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.worktree.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.bisectStart, async (arg?: unknown) => {
        try {
            const history = checkpointManager.getCheckpointHistoryForWorkspace();
            if (history.length === 0) {
                vscode.window.showInformationMessage(t('checkpoint.noCheckpoints'));
                return;
            }
            const items = [...history]
                .sort((a, b) => b.created.getTime() - a.created.getTime())
                .map((checkpoint) => ({
                    label: checkpoint.label || checkpoint.description || checkpoint.id,
                    description: checkpoint.created.toLocaleString(),
                    detail: checkpoint.id,
                    checkpoint,
                }));
            const bad = await vscode.window.showQuickPick(items, { placeHolder: t('checkpoint.bisect.pickBad') });
            if (!bad) {
                return;
            }
            const good = await vscode.window.showQuickPick(
                [{ label: '(branch base)', checkpoint: undefined as { id: string } | undefined }, ...items],
                { placeHolder: t('checkpoint.bisect.pickGood') },
            );
            const result = await checkpointManager.bisectStart({
                bad: checkpointIdFromArg(arg) || bad.checkpoint.id,
                good: good?.checkpoint?.id,
            });
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.bisect.failed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(
                result.firstBadId
                    ? t('checkpoint.bisect.found', { id: result.firstBadId.slice(0, 11) })
                    : t('checkpoint.bisect.started', { id: (result.currentId ?? '').slice(0, 11), remaining: result.remaining }),
            );
            CheckpointGraphView.notifyHistoryChanged();
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.bisect.failed', { error }));
            return undefined;
        }
    });

    const markBisect = (verdict: 'good' | 'bad' | 'skip') => async () => {
        try {
            const result = await checkpointManager.bisectMark(verdict);
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.bisect.failed', { error: result.message || t('checkpoint.bisect.none') }));
                return result;
            }
            vscode.window.showInformationMessage(
                result.firstBadId
                    ? t('checkpoint.bisect.found', { id: result.firstBadId.slice(0, 11) })
                    : t('checkpoint.bisect.stepped', { verdict, id: (result.currentId ?? '').slice(0, 11), remaining: result.remaining }),
            );
            CheckpointGraphView.notifyHistoryChanged();
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.bisect.failed', { error }));
            return undefined;
        }
    };
    registerCanonicalCommand(context, CheckpointCommand.bisectGood, markBisect('good'));
    registerCanonicalCommand(context, CheckpointCommand.bisectBad, markBisect('bad'));
    registerCanonicalCommand(context, CheckpointCommand.bisectSkip, markBisect('skip'));
    registerCanonicalCommand(context, CheckpointCommand.bisectReset, async () => {
        try {
            const result = await checkpointManager.bisectReset();
            vscode.window.showInformationMessage(t('checkpoint.bisect.reset'));
            CheckpointGraphView.notifyHistoryChanged();
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.bisect.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.exportPatch, async (arg?: unknown) => {
        try {
            let targetCheckpointId = checkpointIdFromArg(arg) ?? '';
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
                            label: checkpoint.label || checkpoint.description || checkpoint.id,
                            description: checkpoint.created.toLocaleString(),
                            detail: checkpoint.id,
                            checkpoint,
                        })),
                    { placeHolder: t('checkpoint.patch.pickCheckpoint') },
                );
                if (!selected) {
                    return;
                }
                targetCheckpointId = selected.checkpoint.id;
            }
            const exported = await checkpointManager.exportPatch(targetCheckpointId);
            if (!exported.success || !exported.patch) {
                vscode.window.showErrorMessage(t('checkpoint.patch.failed', { error: exported.message || 'unknown error' }));
                return exported;
            }
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`knox-checkpoint-${targetCheckpointId.slice(0, 12)}.patch`),
                filters: {
                    [t('checkpoint.patch.filter')]: ['patch', 'diff'],
                    [t('checkpoint.graph.allFilesFilter')]: ['*'],
                },
            });
            if (!uri) {
                return exported;
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(exported.patch, 'utf8'));
            vscode.window.showInformationMessage(t('checkpoint.patch.exported', { id: targetCheckpointId.slice(0, 11) }));
            return { ...exported, path: uri.fsPath };
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.patch.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.applyPatch, async (arg?: unknown) => {
        try {
            let patchText = typeof arg === 'string' && arg.includes('diff --git') ? arg : '';
            if (!patchText) {
                const uri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: {
                        [t('checkpoint.patch.filter')]: ['patch', 'diff'],
                        [t('checkpoint.graph.allFilesFilter')]: ['*'],
                    },
                    openLabel: t('checkpoint.patch.pickFile'),
                });
                if (!uri?.[0]) {
                    return;
                }
                patchText = Buffer.from(await vscode.workspace.fs.readFile(uri[0])).toString('utf8');
            }
            const result = await checkpointManager.applyPatch(patchText);
            if (result.conflicts.length > 0) {
                vscode.window.showErrorMessage(t('checkpoint.patch.conflicts', {
                    paths: result.conflicts.map((conflict) => conflict.path).join(', '),
                }));
                return result;
            }
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.patch.failed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(t('checkpoint.patch.applied', { id: (result.checkpointId ?? '').slice(0, 11) }));
            CheckpointGraphView.notifyHistoryChanged();
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.patch.failed', { error }));
            return undefined;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.mergeAbort, async () => {
        try {
            const result = await checkpointManager.mergeAbort();
            if (!result.success) {
                vscode.window.showErrorMessage(t('checkpoint.merge.abortFailed', { error: result.message || 'unknown error' }));
                return result;
            }
            vscode.window.showInformationMessage(t('checkpoint.merge.aborted'));
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.merge.abortFailed', { error }));
            return undefined;
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
    registerBlameCommands(context);
    
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
