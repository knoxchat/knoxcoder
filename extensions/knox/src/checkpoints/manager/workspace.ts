import * as path from 'path';

import { tryResolveSandboxedWorkspacePath, type SandboxResult } from '../checkpointPath';
import {
    canonicalizeWorkspacePath,
    findContainingWorkspaceFolder,
    workspacePathsEqual,
    workspaceStorageKey,
} from '../store/workspaceStore';
import type { CheckpointEngineHost } from './host';
import type { CheckpointInfo } from './types';

export {
    canonicalizeWorkspacePath,
    findContainingWorkspaceFolder,
    workspacePathsEqual,
    workspaceStorageKey,
};

/** @deprecated Use canonicalizeWorkspacePath */
export function normalizeWorkspacePath(workspacePath: string): string {
    return canonicalizeWorkspacePath(workspacePath);
}

export function getCheckpointHistoryForWorkspace(
    history: CheckpointInfo[],
    workspacePath?: string,
): CheckpointInfo[] {
    if (!workspacePath) {
        return [];
    }

    const currentKey = workspaceStorageKey(workspacePath);
    return history.filter((checkpoint) => {
        if (checkpoint.workspaceKey) {
            return checkpoint.workspaceKey === currentKey;
        }
        if (!checkpoint.workspacePath) {
            return false;
        }
        return workspacePathsEqual(checkpoint.workspacePath, workspacePath);
    });
}

export function checkpointWorkspaceFolders(
    host: Pick<CheckpointEngineHost, 'workspaceFolderPaths' | 'currentWorkspacePath'>,
): string[] {
    if (host.workspaceFolderPaths.length > 0) {
        return host.workspaceFolderPaths;
    }
    return host.currentWorkspacePath ? [host.currentWorkspacePath] : [];
}

export function getLastCheckpointTime(host: CheckpointEngineHost): number {
    if (host.checkpointHistory.length === 0) {
        return host.sessionStartTime;
    }
    return host.lastCheckpointTime;
}

export function workspaceHasBaseline(host: CheckpointEngineHost): boolean {
    return getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    ).some((checkpoint) => checkpoint.captureMode === 'baseline');
}

export function resolveWorkspaceRelativePath(
    host: Pick<CheckpointEngineHost, 'currentWorkspacePath'>,
    relativePath: string,
): SandboxResult {
    if (!host.currentWorkspacePath) {
        return { ok: false, reason: 'no workspace' };
    }
    return tryResolveSandboxedWorkspacePath(host.currentWorkspacePath, relativePath);
}

export function checkpointHasUnsafePaths(
    checkpoint: CheckpointInfo,
    workspacePath?: string,
): boolean {
    const paths = [
        ...(checkpoint.fileSnapshots?.map((snapshot) => snapshot.relativePath) ?? []),
        ...(checkpoint.fileInventory ?? []),
        ...(checkpoint.skippedFiles?.map((skipped) => skipped.path) ?? []),
    ];
    return paths.some((relativePath) => {
        const resolved = workspacePath
            ? tryResolveSandboxedWorkspacePath(workspacePath, relativePath)
            : tryResolveSandboxedWorkspacePath('/workspace', relativePath, path.posix);
        return !resolved.ok;
    });
}
