import * as path from 'path';

import * as vscode from 'vscode';

import { createKnoxLogger } from 'core/util/knoxLog';

import { classificationOptionsFrom, shouldTrackFile } from './fileClassification';
import type { CheckpointEngineHost } from './host';
import { findContainingWorkspaceFolder } from './workspace';

const log = createKnoxLogger('Checkpoints');

export type WorkspaceFileEventKind = 'modified' | 'created' | 'deleted';

export interface WorkspaceFileEvent {
    uri: vscode.Uri;
    kind: WorkspaceFileEventKind;
    folderPath: string;
}

export const NOISY_PATH_SEGMENTS = [
    `${path.sep}node_modules${path.sep}`,
    `${path.sep}.git${path.sep}`,
    `${path.sep}dist${path.sep}`,
    `${path.sep}build${path.sep}`,
    `${path.sep}out${path.sep}`,
    `${path.sep}target${path.sep}`,
    `${path.sep}coverage${path.sep}`,
    `${path.sep}.knox${path.sep}`,
    `${path.sep}.knox-debug${path.sep}`,
    `${path.sep}__pycache__${path.sep}`,
];

export function isNoisyWatcherPath(fsPath: string): boolean {
    return NOISY_PATH_SEGMENTS.some((segment) => fsPath.includes(segment));
}

function foldersToWatch(host: CheckpointEngineHost): string[] {
    if (host.workspaceFolderPaths.length > 0) {
        return host.workspaceFolderPaths;
    }
    return host.currentWorkspacePath ? [host.currentWorkspacePath] : [];
}

export async function initializeFileWatcher(host: CheckpointEngineHost): Promise<void> {
    const folders = foldersToWatch(host);
    if (folders.length === 0) {
        return;
    }

    try {
        for (const folder of folders) {
            const pattern = new vscode.RelativePattern(folder, '**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            host.fileWatchers.push(watcher);
            host.fileWatcher = watcher;
            host.watcherDisposables.push(
                watcher.onDidChange((uri) => onFileChanged(host, uri, 'modified')),
                watcher.onDidCreate((uri) => onFileChanged(host, uri, 'created')),
                watcher.onDidDelete((uri) => onFileDeleted(host, uri)),
            );
        }

        log.info(`✅ File system watcher initialized for ${folders.length} workspace folder(s)`);
    } catch (error) {
        log.error('❌ Failed to initialize file system watcher:', error);
    }
}

export function onFileChanged(
    host: CheckpointEngineHost,
    uri: vscode.Uri,
    kind: WorkspaceFileEventKind = 'modified',
): void {
    const folder = findContainingWorkspaceFolder(foldersToWatch(host), uri.fsPath);
    if (!folder) {
        return;
    }

    if (isNoisyWatcherPath(uri.fsPath) || !shouldTrackFile(uri.fsPath, classificationOptionsFrom(host))) {
        return;
    }

    host.recordFileChangeForFolder(folder, uri.fsPath, false);
    host.notifyWorkspaceFileEvent({ uri, kind, folderPath: folder });

    if (host.watcherDebounceTimer) {
        clearTimeout(host.watcherDebounceTimer);
    }

    host.watcherDebounceTimer = setTimeout(() => {
        log.debug(`📝 File changed (watcher): ${path.relative(folder, uri.fsPath)}`);
    }, 500);
}

export function onFileDeleted(host: CheckpointEngineHost, uri: vscode.Uri): void {
    const folder = findContainingWorkspaceFolder(foldersToWatch(host), uri.fsPath);
    if (!folder) {
        return;
    }

    if (isNoisyWatcherPath(uri.fsPath)) {
        return;
    }

    host.recordFileChangeForFolder(folder, uri.fsPath, true);
    host.notifyWorkspaceFileEvent({ uri, kind: 'deleted', folderPath: folder });
    log.debug(`🗑️ File deleted (watcher): ${path.relative(folder, uri.fsPath)}`);
}

export function disposeFileWatcher(host: CheckpointEngineHost): void {
    for (const disposable of host.watcherDisposables) {
        disposable.dispose();
    }
    host.watcherDisposables = [];

    for (const watcher of host.fileWatchers) {
        watcher.dispose();
    }
    host.fileWatchers = [];
    host.fileWatcher = undefined;
    host.watcherTrusted = false;

    if (host.watcherDebounceTimer) {
        clearTimeout(host.watcherDebounceTimer);
        host.watcherDebounceTimer = undefined;
    }
}
