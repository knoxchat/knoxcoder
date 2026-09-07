import * as vscode from 'vscode';

import { t } from '../i18n';
import { CheckpointManager, isWorkspaceMismatchError, type ImportCheckpointsOptions, type SharedCheckpointBundle } from './CheckpointManager';
import { CheckpointCommand } from './commandIds';
import { isListableCheckpoint } from './manager/listQuery';
import { auditEventToPanelRecord } from './manager/shareBundles';

export async function importBundleWithWorkspacePrompt(
    filePath: string,
    importOptions: ImportCheckpointsOptions = {},
): Promise<number> {
    const checkpointManager = CheckpointManager.getInstance();
    try {
        return await checkpointManager.importCheckpoints(filePath, importOptions);
    } catch (error) {
        if (!isWorkspaceMismatchError(error)) {
            throw error;
        }
        const importAnyway = t('checkpoint.importWrongWorkspaceAction');
        const confirmed = await vscode.window.showWarningMessage(
            t('checkpoint.importWrongWorkspaceConfirm', {
                workspace: error.workspaceHint ?? error.workspaceKey ?? t('checkpoint.importUnknownWorkspace'),
            }),
            { modal: true },
            importAnyway,
        );
        if (confirmed !== importAnyway) {
            throw error;
        }
        return checkpointManager.importCheckpoints(filePath, {
            ...importOptions,
            allowWorkspaceMismatch: true,
        });
    }
}

export async function shareCheckpointsInteractive(options?: {
    checkpointIds?: string[];
    description?: string;
    filePath?: string;
}): Promise<SharedCheckpointBundle | undefined> {
    const checkpointManager = CheckpointManager.getInstance();
    if (!checkpointManager.isReady()) {
        vscode.window.showErrorMessage(t('checkpoint.systemNotInit'));
        return undefined;
    }

    const history = checkpointManager.getCheckpointHistoryForWorkspace()
        .filter(isListableCheckpoint)
        .sort((a, b) => b.created.getTime() - a.created.getTime());
    if (history.length === 0) {
        vscode.window.showInformationMessage(t('checkpoint.noCheckpoints'));
        return undefined;
    }

    let checkpointIds = options?.checkpointIds?.filter((id) => id.trim().length > 0) ?? [];
    if (checkpointIds.length === 0) {
        const selected = await vscode.window.showQuickPick(
            history.map((checkpoint) => ({
                label: `$(export) ${checkpoint.description}`,
                description: checkpoint.created.toLocaleString(),
                detail: checkpoint.id,
                picked: true,
                checkpointId: checkpoint.id,
            })),
            {
                canPickMany: true,
                placeHolder: t('checkpoint.share.selectCheckpoints'),
                matchOnDescription: true,
                matchOnDetail: true,
            },
        );
        if (!selected || selected.length === 0) {
            return undefined;
        }
        checkpointIds = selected.map((item) => item.checkpointId);
    }

    let description = options?.description?.trim() ?? '';
    if (!options?.description) {
        const entered = await vscode.window.showInputBox({
            prompt: t('checkpoint.share.enterDescription'),
            placeHolder: t('checkpoint.share.descPlaceholder'),
            value: t('checkpoint.share.defaultDescription', { count: checkpointIds.length }),
        });
        if (entered === undefined) {
            return undefined;
        }
        description = entered.trim();
    }

    let filePath = options?.filePath;
    if (!filePath) {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
                `knox-share-${new Date().toISOString().split('T')[0]}.knoxcp.json`,
            ),
            filters: {
                'Knox Checkpoint Bundles': ['json'],
                'All Files': ['*'],
            },
        });
        if (!uri) {
            return undefined;
        }
        filePath = uri.fsPath;
    }

    const bundle = await checkpointManager.shareCheckpoints(filePath, {
        checkpointIds,
        description: description || t('checkpoint.share.defaultDescription', { count: checkpointIds.length }),
    });

    const openFile = t('checkpoint.openFile');
    const showInExplorer = t('checkpoint.showInExplorer');
    const action = await vscode.window.showInformationMessage(
        t('checkpoint.share.success', { path: bundle.filePath, count: bundle.checkpointCount }),
        openFile,
        showInExplorer,
    );
    if (action === openFile) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(bundle.filePath));
    } else if (action === showInExplorer) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(bundle.filePath));
    }
    return bundle;
}

export async function revealSharedBundle(filePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    } catch {
        vscode.window.showWarningMessage(t('checkpoint.share.fileMissing', { path: filePath }));
        return false;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
    return true;
}

export async function loadSharedCheckpointPanel(limit: number = 100): Promise<{
    bundles: SharedCheckpointBundle[];
    auditRecords: ReturnType<typeof auditEventToPanelRecord>[];
}> {
    const checkpointManager = CheckpointManager.getInstance();
    const [bundles, events] = await Promise.all([
        checkpointManager.listSharedBundles(),
        checkpointManager.getAuditTrail(limit),
    ]);
    return {
        bundles,
        auditRecords: events.map((event, index) => auditEventToPanelRecord(event, index)),
    };
}
