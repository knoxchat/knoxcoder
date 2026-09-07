import * as fs from 'fs';

import { hashBlobBytes } from '../store/blobStore';
import type { ResolvedFileState } from '../checkpointReplay';
import { captureCompleteFileInventory } from './capture';
import { classificationOptionsFrom, classifyFileBuffer } from './fileClassification';
import type { CheckpointEngineHost } from './host';
import { reconstructStateAtCheckpoint } from './restore';
import { hydrateCheckpointSnapshots } from './persistence';
import type { CheckpointDiffResult, CheckpointFileDiff, CheckpointInfo, FileSnapshot } from './types';
import { getCheckpointHistoryForWorkspace, resolveWorkspaceRelativePath } from './workspace';

export async function computeCheckpointDiff(
    host: CheckpointEngineHost,
    checkpointId: string,
    compareToCheckpointId?: string,
): Promise<CheckpointDiffResult | null> {
    const history = getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    ).sort((a, b) => a.created.getTime() - b.created.getTime());

    const targetIndex = history.findIndex((cp) => cp.id === checkpointId);
    if (targetIndex === -1) {
        return null;
    }

    let baseIndex: number;
    if (compareToCheckpointId) {
        baseIndex = history.findIndex((cp) => cp.id === compareToCheckpointId);
        if (baseIndex === -1) {
            return null;
        }
    } else {
        baseIndex = targetIndex - 1;
    }

    const lowIndex = Math.min(baseIndex, targetIndex);
    const highIndex = Math.max(baseIndex, targetIndex);
    const target = history[highIndex];
    const base = lowIndex >= 0 ? history[lowIndex] : null;

    const toMeta = (cp: CheckpointInfo) => ({
        id: cp.id,
        description: cp.description,
        created: cp.created.toISOString(),
    });

    if (!base || lowIndex === highIndex) {
        return {
            oldCheckpoint: null,
            newCheckpoint: toMeta(target),
            files: [],
        };
    }

    const snapshotCache = new Map<string, FileSnapshot[]>();
    const getSnapshots = async (cp: CheckpointInfo): Promise<FileSnapshot[]> => {
        const cached = snapshotCache.get(cp.id);
        if (cached) {
            return cached;
        }
        let snapshots = cp.fileSnapshots;
        if (!snapshots || snapshots.length === 0) {
            const fromDisk = await host.loadCheckpointFromDisk(cp.id);
            snapshots = fromDisk?.fileSnapshots || [];
        } else {
            snapshots = await hydrateCheckpointSnapshots(host, snapshots);
        }
        snapshotCache.set(cp.id, snapshots);
        return snapshots;
    };

    const changedPaths = new Set<string>();
    for (let i = lowIndex + 1; i <= highIndex; i++) {
        const snapshots = await getSnapshots(history[i]);
        for (const snapshot of snapshots) {
            changedPaths.add(snapshot.relativePath);
        }
    }

    if (changedPaths.size === 0) {
        return {
            oldCheckpoint: toMeta(base),
            newCheckpoint: toMeta(target),
            files: [],
        };
    }

    type Resolved = { content: string; encoding: string } | null;
    const newContent = new Map<string, Resolved>();
    const oldContent = new Map<string, Resolved>();
    const unresolvedNew = new Set(changedPaths);
    const unresolvedOld = new Set(changedPaths);

    for (let i = highIndex; i >= 0 && (unresolvedNew.size > 0 || unresolvedOld.size > 0); i--) {
        if (i <= lowIndex && unresolvedOld.size === 0) {
            break;
        }
        const snapshots = await getSnapshots(history[i]);
        for (const snapshot of snapshots) {
            const p = snapshot.relativePath;
            if (!changedPaths.has(p)) {
                continue;
            }
            const resolved: Resolved = (snapshot.deleted || snapshot.changeType === 'deleted')
                ? null
                : { content: snapshot.content ?? '', encoding: snapshot.encoding || 'utf8' };
            if (unresolvedNew.has(p)) {
                newContent.set(p, resolved);
                unresolvedNew.delete(p);
            }
            if (i <= lowIndex && unresolvedOld.has(p)) {
                oldContent.set(p, resolved);
                unresolvedOld.delete(p);
            }
        }
    }

    const files: CheckpointFileDiff[] = [];
    for (const p of Array.from(changedPaths).sort()) {
        const oldR = oldContent.get(p) ?? null;
        const newR = newContent.get(p) ?? null;

        if (oldR === null && newR === null) {
            continue;
        }
        if (oldR !== null && newR !== null && oldR.content === newR.content) {
            continue;
        }

        files.push({
            relativePath: p,
            status: oldR === null ? 'added' : newR === null ? 'deleted' : 'modified',
            oldContent: oldR?.content ?? null,
            newContent: newR?.content ?? null,
            oldEncoding: oldR?.encoding,
            newEncoding: newR?.encoding,
        });
    }

    return {
        oldCheckpoint: toMeta(base),
        newCheckpoint: toMeta(target),
        files,
    };
}

export async function computeCheckpointDiffAgainstWorkspace(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<CheckpointDiffResult | null> {
    if (!host.currentWorkspacePath) {
        return null;
    }

    const history = getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    ).sort((a, b) => a.created.getTime() - b.created.getTime());
    const targetIndex = history.findIndex((cp) => cp.id === checkpointId);
    if (targetIndex === -1) {
        return null;
    }
    const target = history[targetIndex];

    const stateAtCheckpoint = await reconstructStateAtCheckpoint(host, checkpointId);
    if (!stateAtCheckpoint) {
        return null;
    }

    const candidatePaths = new Set(stateAtCheckpoint.keys());
    for (let i = targetIndex + 1; i < history.length; i++) {
        let snapshots = history[i].fileSnapshots;
        if (!snapshots || snapshots.length === 0) {
            const fromDisk = await host.loadCheckpointFromDisk(history[i].id);
            snapshots = fromDisk?.fileSnapshots || [];
        }
        for (const snapshot of snapshots) {
            candidatePaths.add(snapshot.relativePath);
        }
    }
    for (const relativePath of await captureCompleteFileInventory(host)) {
        candidatePaths.add(relativePath);
    }

    const files: CheckpointFileDiff[] = [];

    for (const p of Array.from(candidatePaths).sort()) {
        const oldR = stateAtCheckpoint.get(p) ?? null;
        const sandboxed = resolveWorkspaceRelativePath(host, p);
        if (!sandboxed.ok) {
            continue;
        }
        const fullPath = sandboxed.fullPath;

        let newR: ResolvedFileState | null = null;
        try {
            const stats = await fs.promises.stat(fullPath);
            if (stats.size <= host.maxFileSize) {
                const buffer = await fs.promises.readFile(fullPath);
                if (oldR?.hash && hashBlobBytes(buffer) === oldR.hash) {
                    continue;
                }
                const classified = classifyFileBuffer(fullPath, buffer, classificationOptionsFrom(host));
                if (classified) {
                    newR = classified;
                }
            }
        } catch {
            // File no longer exists on disk
        }

        if (oldR === null && newR === null) {
            continue;
        }
        if (oldR !== null && newR !== null && newR.content === oldR.content) {
            continue;
        }

        files.push({
            relativePath: p,
            status: oldR === null ? 'added' : newR === null ? 'deleted' : 'modified',
            oldContent: oldR?.content ?? null,
            newContent: newR?.content ?? null,
            oldEncoding: oldR?.encoding,
            newEncoding: newR?.encoding,
        });
    }

    return {
        oldCheckpoint: {
            id: target.id,
            description: target.description,
            created: target.created.toISOString(),
        },
        newCheckpoint: {
            id: 'workspace',
            description: 'Current workspace',
            created: new Date().toISOString(),
        },
        files,
    };
}
