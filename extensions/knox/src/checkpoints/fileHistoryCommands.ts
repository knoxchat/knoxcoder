import * as path from 'node:path';

import * as vscode from 'vscode';

import { t } from '../i18n';
import { tryResolveSandboxedWorkspacePath } from './checkpointPath';
import { CheckpointManager } from './CheckpointManager';
import { findContainingWorkspaceFolder } from './manager/workspace';
import { toPosixRelative } from './manager/pathFilter';
import type { FileCheckpointVersion } from './manager/types';

export function uriFromFileHistoryArg(arg?: unknown): vscode.Uri | undefined {
    if (arg instanceof vscode.Uri) {
        return arg;
    }
    if (Array.isArray(arg) && arg[0] instanceof vscode.Uri) {
        return arg[0];
    }
    if (arg && typeof arg === 'object') {
        const maybe = arg as { uri?: unknown; resourceUri?: unknown };
        if (maybe.uri instanceof vscode.Uri) {
            return maybe.uri;
        }
        if (maybe.resourceUri instanceof vscode.Uri) {
            return maybe.resourceUri;
        }
    }
    return vscode.window.activeTextEditor?.document.uri;
}

function versionQuickPickItems(versions: FileCheckpointVersion[]) {
    return [...versions].reverse().map((version) => ({
        label: version.deleted
            ? `$(trash) ${t('checkpoint.fileHistory.deletedLabel')}`
            : `$(history) ${version.description}`,
        description: version.created.toLocaleString(),
        detail: version.deleted
            ? t('checkpoint.fileHistory.deletedDetail', { id: version.checkpointId.substring(0, 8) })
            : t('checkpoint.fileHistory.versionDetail', {
                id: version.checkpointId.substring(0, 8),
                hash: (version.hash ?? '').slice(0, 8),
            }),
        version,
    }));
}

export async function showFileCheckpointHistory(arg?: unknown): Promise<void> {
    const checkpointManager = CheckpointManager.getInstance();
    if (!checkpointManager.isReady()) {
        vscode.window.showErrorMessage(t('checkpoint.systemNotInit'));
        return;
    }

    const uri = uriFromFileHistoryArg(arg);
    if (!uri) {
        vscode.window.showInformationMessage(t('checkpoint.fileHistory.noFile'));
        return;
    }
    if (uri.scheme !== 'file') {
        vscode.window.showInformationMessage(t('checkpoint.fileHistory.notOnDisk'));
        return;
    }

    let stat: vscode.FileStat;
    try {
        stat = await vscode.workspace.fs.stat(uri);
    } catch {
        vscode.window.showErrorMessage(t('checkpoint.fileHistory.missingFile'));
        return;
    }
    if (stat.type & vscode.FileType.Directory) {
        vscode.window.showInformationMessage(t('checkpoint.fileHistory.notAFile'));
        return;
    }

    const folders = checkpointManager.workspaceFolderPaths.length > 0
        ? checkpointManager.workspaceFolderPaths
        : (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const folder = findContainingWorkspaceFolder(folders, uri.fsPath);
    if (!folder) {
        vscode.window.showErrorMessage(t('checkpoint.fileHistory.outsideWorkspace'));
        return;
    }

    const relativePath = toPosixRelative(path.relative(folder, uri.fsPath));
    const sandboxed = tryResolveSandboxedWorkspacePath(folder, relativePath);
    if (!sandboxed.ok || !relativePath || relativePath.startsWith('../') || relativePath === '..') {
        vscode.window.showErrorMessage(t('checkpoint.fileHistory.unsafePath'));
        return;
    }

    await checkpointManager.switchWorkspaceFolder(folder);
    const versions = await checkpointManager.listFileCheckpointHistory(relativePath);
    if (versions.length === 0) {
        vscode.window.showInformationMessage(t('checkpoint.fileHistory.empty', { path: relativePath }));
        return;
    }

    const selected = await vscode.window.showQuickPick(versionQuickPickItems(versions), {
        placeHolder: t('checkpoint.fileHistory.placeholder', { path: relativePath }),
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selected) {
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        selected.version.deleted
            ? t('checkpoint.fileHistory.confirmDelete', {
                path: relativePath,
                description: selected.version.description,
            })
            : t('checkpoint.fileHistory.confirmRestore', {
                path: relativePath,
                description: selected.version.description,
            }),
        { modal: true },
        t('checkpoint.restore'),
    );
    if (confirm !== t('checkpoint.restore')) {
        return;
    }

    const result = await checkpointManager.restoreCheckpointFiles(
        selected.version.checkpointId,
        [selected.version.relativePath],
    );
    if (result.success) {
        vscode.window.showInformationMessage(
            t('checkpoint.filesRestoredSuccess', { count: result.restoredFiles.length }),
        );
    } else {
        vscode.window.showWarningMessage(
            t('checkpoint.filesRestoredWithErrors', { count: result.failedFiles.length }),
        );
    }
}
