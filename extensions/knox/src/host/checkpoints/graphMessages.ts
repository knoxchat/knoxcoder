import type { FromWebviewProtocol } from 'core/protocol';
import * as vscode from 'vscode';

import { t } from '../i18n';
import type { VsCodeWebviewProtocol } from '../webviewProtocol';

import { CheckpointCommand } from './commandIds';
import { CheckpointChatIntegration } from './commands';
import { CheckpointManager, isWorkspaceMismatchError } from './CheckpointManager';
import { workspaceFileUri } from './CheckpointTreeProvider';
import { openCheckpointFileAtRevision, openCheckpointWorkingFile } from './openFileDiff';

const UI_STATE_KEY = 'checkpointGraph';

type UiState = NonNullable<FromWebviewProtocol['getCheckpointGraphUiState'][1]>;

function integration(): CheckpointChatIntegration | undefined {
    return CheckpointChatIntegration.getInstance();
}

function branchDeleteMessage(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('current branch')) {
        return t('checkpoint.graph.cannotDeleteActive');
    }
    if (text.includes('default main')) {
        return t('checkpoint.graph.cannotDeleteMain');
    }
    if (text.includes('checkpoints after the fork')) {
        return t('checkpoint.graph.cannotDeleteWithHistory');
    }
    return text;
}

/**
 * Messages the graph panel handles itself. The sidebar messenger is a
 * different webview, so restore, diff, and branch actions are registered here.
 * `notify` refreshes a visible graph after a mutation.
 */
export function registerCheckpointGraphMessages(
    protocol: VsCodeWebviewProtocol,
    context: vscode.ExtensionContext,
    notify: () => void,
): void {
    protocol.on('getCheckpointGraphUiState', () => {
        return context.workspaceState.get<UiState>(UI_STATE_KEY) ?? null;
    });

    protocol.on('saveCheckpointGraphUiState', async (msg) => {
        await context.workspaceState.update(UI_STATE_KEY, msg.data);
    });

    protocol.on('openCheckpointFileDiff', async (msg) => {
        await vscode.commands.executeCommand(
            CheckpointCommand.viewFileDiff,
            msg.data.checkpointId,
            msg.data.relativePath,
            msg.data.compareToCheckpointId,
            msg.data.compareToWorkspace === true,
        );
    });

    protocol.on('openCheckpointFileAtRevision', async (msg) => {
        await openCheckpointFileAtRevision(msg.data);
    });

    protocol.on('openCheckpointWorkingFile', async (msg) => {
        await openCheckpointWorkingFile(msg.data.relativePath);
    });

    protocol.on('copyCheckpointFilePath', async (msg) => {
        const relative = msg.data.relativePath;
        if (!msg.data.absolute) {
            await vscode.env.clipboard.writeText(relative);
            return;
        }
        const uri = workspaceFileUri(
            CheckpointManager.getInstance().getCurrentWorkspacePath(),
            relative,
        );
        await vscode.env.clipboard.writeText(uri?.fsPath ?? relative);
    });

    protocol.on('renameCheckpointBranch', async (msg) => {
        try {
            await CheckpointManager.getInstance().renameBranch(msg.data.branchId, msg.data.name);
            notify();
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message };
        }
    });

    protocol.on('setCheckpointTag', async (msg) => {
        const trimmed = msg.data.tag.trim();
        if (!trimmed) {
            return { success: false, message: t('checkpoint.graph.tagEmpty') };
        }
        if (trimmed.length > 80) {
            return { success: false, message: t('checkpoint.graph.tagTooLong') };
        }
        const success = await CheckpointManager.getInstance().setCheckpointTag(
            msg.data.checkpointId,
            trimmed,
            msg.data.present,
        );
        if (success) {
            notify();
            return { success: true };
        }
        return { success: false, message: t('checkpoint.graph.tagMissing') };
    });

    protocol.on('copyText', async (msg) => {
        await vscode.env.clipboard.writeText(msg.data.text);
    });

    protocol.on('checkpointWorkingTree', async () => {
        const manager = CheckpointManager.getInstance();
        const head = manager.getActiveBranch()?.headCheckpointId;
        if (!head) {
            return { paths: [] as string[] };
        }
        try {
            const diff = await manager.computeCheckpointDiffAgainstWorkspace(head);
            return { paths: (diff?.files ?? []).map((file) => file.relativePath) };
        } catch (error) {
            console.error('Working tree scan failed:', error);
            return { paths: [] as string[] };
        }
    });

    protocol.on('computeCheckpointDiff', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, diff: null };
        }
        const diff = await chat.computeCheckpointDiff(
            msg.data.checkpointId,
            msg.data.compareToCheckpointId,
            msg.data.compareToWorkspace,
        );
        return { success: !!diff, diff };
    });

    protocol.on('previewRestore', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, preview: null, message: t('checkpoint.graph.integrationUnavailable') };
        }
        try {
            const preview = await chat.previewRestore(msg.data.checkpointId);
            return { success: !!preview, preview };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, preview: null, message };
        }
    });

    protocol.on('restoreCheckpoint', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false };
        }
        try {
            const result = await chat.restoreCheckpointDirect(msg.data.checkpointId, {
                rewindMemory: msg.data.rewindMemory,
            });
            notify();
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message };
        }
    });

    protocol.on('restoreCheckpointFiles', async (msg) => {
        const chat = integration();
        if (!chat) {
            return {
                success: false,
                restoredFiles: [],
                failedFiles: msg.data.relativePaths.map((path) => ({
                    path,
                    error: t('checkpoint.graph.integrationUnavailable'),
                })),
            };
        }
        const result = await chat.restoreCheckpointFiles(msg.data.checkpointId, msg.data.relativePaths);
        if (result.success) {
            notify();
        }
        return result;
    });

    protocol.on('pinCheckpoint', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false };
        }
        const success = await chat.pinCheckpoint(msg.data.checkpointId, msg.data.pinned);
        if (success) {
            notify();
        }
        return { success };
    });

    protocol.on('deleteCheckpoints', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false };
        }
        const results = await Promise.all(
            msg.data.checkpointIds.map(async (id) => ({
                checkpointId: id,
                success: await chat.deleteCheckpoint(id),
            })),
        );
        const success = results.every((result) => result.success);
        if (success) {
            notify();
        }
        return { success, results };
    });

    protocol.on('createCheckpointBranch', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, branch: null, message: t('checkpoint.graph.integrationUnavailable') };
        }
        try {
            const result = await chat.createCheckpointBranch(
                msg.data.name,
                msg.data.baseCheckpointId,
                msg.data.description,
            );
            if (result.success) {
                notify();
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, branch: null, message };
        }
    });

    protocol.on('switchCheckpointBranch', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, message: t('checkpoint.graph.integrationUnavailable') };
        }
        try {
            const result = await chat.switchCheckpointBranch(msg.data.branchId);
            if (result.success) {
                notify();
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message };
        }
    });

    protocol.on('mergeCheckpointBranches', async (msg) => {
        try {
            const result = await CheckpointManager.getInstance().mergeBranches(
                msg.data.sourceBranchId,
                msg.data.targetBranchId,
            );
            if (result.success) {
                notify();
            }
            return {
                success: result.success,
                conflicts: result.conflicts.map((conflict) => ({ path: conflict.path })),
                message: result.success ? undefined : t('checkpoint.graph.mergeFailed'),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, conflicts: [], message };
        }
    });

    protocol.on('deleteCheckpointBranch', async (msg) => {
        try {
            const success = await CheckpointManager.getInstance().deleteBranch(msg.data.branchId);
            if (success) {
                notify();
            }
            return { success };
        } catch (error) {
            return { success: false, message: branchDeleteMessage(error) };
        }
    });

    protocol.on('exportCheckpoint', async (msg) => {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`knox-checkpoint-${msg.data.checkpointId.slice(0, 12)}.knoxcp.json`),
            filters: {
                [t('checkpoint.graph.bundleFilter')]: ['json'],
                [t('checkpoint.graph.allFilesFilter')]: ['*'],
            },
        });
        if (!uri) {
            return { success: false, cancelled: true };
        }
        try {
            await CheckpointManager.getInstance().exportCheckpoints(uri.fsPath, {
                checkpointIds: [msg.data.checkpointId],
            });
            return { success: true };
        } catch (error) {
            console.error('Checkpoint export failed:', error);
            vscode.window.showErrorMessage(t('checkpoint.failedExport', {
                error: error instanceof Error ? error.message : String(error),
            }));
            return { success: false };
        }
    });

    protocol.on('setActiveCheckpointWorkspace', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false };
        }
        const success = await chat.setActiveWorkspace(msg.data.workspacePath);
        if (success) {
            notify();
        }
        return { success };
    });

    protocol.on('listCheckpoints', async (msg) => {
        const chat = integration();
        if (!chat) {
            return {
                checkpoints: [],
                total: 0,
                offset: 0,
                limit: 0,
                hasMore: false,
                compareCatalog: [],
                workspaceFolders: [],
            };
        }
        const listed = await chat.listCheckpoints(msg.data);
        return {
            checkpoints: listed.checkpoints || [],
            total: listed.total ?? listed.checkpoints?.length ?? 0,
            offset: listed.offset ?? 0,
            limit: listed.limit ?? listed.checkpoints?.length ?? 0,
            hasMore: listed.hasMore === true,
            compareCatalog: listed.compareCatalog || [],
            activeWorkspacePath: listed.activeWorkspacePath,
            workspaceFolders: listed.workspaceFolders || [],
        };
    });

    protocol.on('getCheckpointDetails', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, details: null };
        }
        const details = await chat.getCheckpointDetails(msg.data.checkpointId);
        return { success: !!details, details };
    });

    protocol.on('getPreviousCheckpoint', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, details: null };
        }
        const details = await chat.getPreviousCheckpoint(msg.data.checkpointId);
        return { success: !!details, details };
    });

    protocol.on('getPerformanceDashboard', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, data: null };
        }
        try {
            const data = await chat.getPerformanceDashboard(msg.data?.historyDays);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to load checkpoint performance dashboard:', error);
            return { success: false, data: null };
        }
    });

    protocol.on('getSharedCheckpointBundles', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, bundles: [], auditRecords: [] };
        }
        try {
            const panel = await chat.getSharedCheckpointPanel(msg.data?.limit);
            return { success: true, bundles: panel.bundles, auditRecords: panel.auditRecords };
        } catch (error) {
            console.error('Failed to load shared checkpoint bundles:', error);
            return { success: false, bundles: [], auditRecords: [] };
        }
    });

    protocol.on('shareCheckpoints', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, bundle: null, message: t('checkpoint.graph.integrationUnavailable') };
        }
        try {
            const bundle = await chat.shareCheckpoints(msg.data);
            if (!bundle) {
                return { success: false, cancelled: true, bundle: null };
            }
            notify();
            return { success: true, bundle };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, bundle: null, message };
        }
    });

    protocol.on('importSharedBundle', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, message: t('checkpoint.graph.integrationUnavailable') };
        }
        try {
            const importedCount = await chat.importSharedBundle(msg.data.filePath, {
                merge: msg.data.merge !== false,
                remapIds: msg.data.remapIds === true,
            });
            notify();
            return { success: true, importedCount };
        } catch (error) {
            if (isWorkspaceMismatchError(error)) {
                return { success: false, cancelled: true, message: error.message };
            }
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message };
        }
    });

    protocol.on('getCheckpointTimeline', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, checkpoints: [], branches: [] };
        }
        try {
            const timeline = await chat.getCheckpointTimeline(msg.data?.limit);
            return { success: true, ...timeline };
        } catch (error) {
            console.error('Failed to load checkpoint timeline:', error);
            return { success: false, checkpoints: [], branches: [] };
        }
    });

    protocol.on('analyzeCheckpoint', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, analysis: null, message: t('checkpoint.graph.integrationUnavailable') };
        }
        try {
            return await chat.analyzeCheckpoint(msg.data.checkpointId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, analysis: null, message };
        }
    });

    protocol.on('suggestCheckpointGroups', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, groups: [] };
        }
        try {
            return await chat.suggestCheckpointGroups(msg.data?.limit);
        } catch (error) {
            console.error('Failed to suggest checkpoint groups:', error);
            return { success: false, groups: [] };
        }
    });

    protocol.on('revealSharedBundle', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { success: false, message: t('checkpoint.graph.integrationUnavailable') };
        }
        const success = await chat.revealSharedBundle(msg.data.filePath);
        return { success };
    });

    protocol.on('getCheckpointConfig', async () => {
        const chat = integration();
        if (!chat) {
            return { status: 'error', config: null };
        }
        const config = await chat.getConfiguration();
        return { status: 'success', config };
    });

    protocol.on('saveCheckpointConfig', async (msg) => {
        const chat = integration();
        if (!chat) {
            return { status: 'error' };
        }
        const success = await chat.saveConfiguration(msg.data.config);
        return { status: success ? 'success' : 'error' };
    });
}
