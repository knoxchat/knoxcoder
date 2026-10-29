import { readCheckpointRecord } from './persistence';
import { toPosixRelative } from './pathFilter';
import {
    detectRenamesAndCopies,
    posixDetectPath,
    snapshotIsDeleted,
    type LineageMatch,
} from './renameDetect';
import type { CheckpointEngineHost } from './host';
import type { CheckpointInfo, FileCheckpointVersion, FileHistoryOptions, FileSnapshot } from './types';
import { getCheckpointHistoryForWorkspace, resolveWorkspaceRelativePath } from './workspace';

export function snapshotContentIdentity(
    snapshot: Pick<FileSnapshot, 'hash' | 'content' | 'encoding' | 'deleted' | 'changeType'>,
): string {
    if (snapshot.deleted || snapshot.changeType === 'deleted') {
        return 'deleted';
    }
    if (snapshot.hash) {
        return `hash:${snapshot.hash}`;
    }
    if (snapshot.content != null) {
        return `content:${snapshot.encoding || 'utf8'}:${snapshot.content}`;
    }
    return 'unknown';
}

/**
 * Collapse a chronological snapshot chain into unique content versions for one
 * path. Consecutive checkpoints with the same hash (typical of deltas that
 * only captured other files) are not listed.
 */
export function uniqueFileVersionsFromSnapshots(
    checkpoints: Array<{
        info: Pick<CheckpointInfo, 'id' | 'description' | 'created'>;
        snapshots: FileSnapshot[];
    }>,
    relativePath: string,
): FileCheckpointVersion[] {
    const posixPath = toPosixRelative(relativePath);
    if (!posixPath) {
        return [];
    }

    const versions: FileCheckpointVersion[] = [];
    let lastIdentity: string | undefined;

    for (const { info, snapshots } of checkpoints) {
        const snapshot = snapshots.find((entry) => toPosixRelative(entry.relativePath) === posixPath);
        if (!snapshot) {
            continue;
        }
        const identity = snapshotContentIdentity(snapshot);
        if (identity === lastIdentity) {
            continue;
        }
        lastIdentity = identity;
        const deleted = identity === 'deleted';
        versions.push({
            checkpointId: info.id,
            description: info.description,
            created: info.created instanceof Date ? info.created : new Date(info.created),
            relativePath: snapshot.relativePath,
            hash: deleted ? undefined : snapshot.hash,
            deleted,
            size: deleted ? undefined : snapshot.size,
            encoding: deleted ? undefined : snapshot.encoding,
        });
    }

    return versions;
}

function lineageEdgesForCheckpoint(
    snapshots: FileSnapshot[],
    parentHashes: Map<string, string>,
): LineageMatch[] {
    const recorded: LineageMatch[] = [];
    const added = [];
    const removed = [];
    const deletedPaths = new Set<string>();

    for (const snapshot of snapshots) {
        const relativePath = posixDetectPath(snapshot.relativePath);
        if (snapshotIsDeleted(snapshot)) {
            deletedPaths.add(relativePath);
            removed.push({
                relativePath,
                hash: snapshot.hash || parentHashes.get(relativePath),
                content: snapshot.content,
                encoding: snapshot.encoding,
            });
            continue;
        }
        if (snapshot.renamedFrom) {
            recorded.push({
                kind: 'rename',
                from: posixDetectPath(snapshot.renamedFrom),
                to: relativePath,
                score: 100,
            });
        }
        const existed = parentHashes.has(relativePath);
        if (snapshot.changeType === 'created' || !existed) {
            added.push({
                relativePath,
                hash: snapshot.hash,
                content: snapshot.content,
                encoding: snapshot.encoding,
            });
        }
    }

    const recordedTo = new Set(recorded.map((match) => match.to));
    const detected = detectRenamesAndCopies(
        added.filter((file) => !recordedTo.has(file.relativePath)),
        removed,
    ).filter((match) => match.kind === 'rename');
    return [...recorded, ...detected];
}

function applySnapshotsToHashIndex(index: Map<string, string>, snapshots: FileSnapshot[]): void {
    for (const snapshot of snapshots) {
        const relativePath = posixDetectPath(snapshot.relativePath);
        if (snapshotIsDeleted(snapshot)) {
            index.delete(relativePath);
            continue;
        }
        if (snapshot.hash) {
            index.set(relativePath, snapshot.hash);
        }
    }
}

/**
 * Follow rename lineage (recorded `renamedFrom`, then hash/content similarity)
 * and list unique content versions along that chain.
 */
export function uniqueFileVersionsFollowingRenames(
    checkpoints: Array<{
        info: Pick<CheckpointInfo, 'id' | 'description' | 'created'>;
        snapshots: FileSnapshot[];
    }>,
    relativePath: string,
): FileCheckpointVersion[] {
    const requested = posixDetectPath(relativePath);
    if (!requested) {
        return [];
    }

    const parentHashes = new Map<string, string>();
    const edgesByIndex: LineageMatch[][] = [];
    for (const { snapshots } of checkpoints) {
        edgesByIndex.push(lineageEdgesForCheckpoint(snapshots, parentHashes));
        applySnapshotsToHashIndex(parentHashes, snapshots);
    }

    let walkPath = requested;
    for (let i = edgesByIndex.length - 1; i >= 0; i--) {
        const edge = edgesByIndex[i].find((match) => match.to === walkPath);
        if (edge) {
            walkPath = edge.from;
        }
    }

    const versions: FileCheckpointVersion[] = [];
    let lastIdentity: string | undefined;
    let currentPath = walkPath;

    for (let i = 0; i < checkpoints.length; i++) {
        const { info, snapshots } = checkpoints[i];
        const edge = edgesByIndex[i].find((match) => match.from === currentPath);
        const snapshot = snapshots.find((entry) => posixDetectPath(entry.relativePath) === currentPath);
        const skipRenameDelete = Boolean(edge && snapshot && snapshotIsDeleted(snapshot));
        if (snapshot && !skipRenameDelete) {
            const identity = snapshotContentIdentity(snapshot);
            if (identity !== lastIdentity) {
                lastIdentity = identity;
                const deleted = identity === 'deleted';
                versions.push({
                    checkpointId: info.id,
                    description: info.description,
                    created: info.created instanceof Date ? info.created : new Date(info.created),
                    relativePath: snapshot.relativePath,
                    hash: deleted ? undefined : snapshot.hash,
                    deleted,
                    size: deleted ? undefined : snapshot.size,
                    encoding: deleted ? undefined : snapshot.encoding,
                });
            }
        }
        if (edge) {
            currentPath = edge.to;
            const dest = snapshots.find((entry) => posixDetectPath(entry.relativePath) === currentPath);
            if (dest && !snapshotIsDeleted(dest)) {
                const identity = snapshotContentIdentity(dest);
                if (identity !== lastIdentity) {
                    lastIdentity = identity;
                    versions.push({
                        checkpointId: info.id,
                        description: info.description,
                        created: info.created instanceof Date ? info.created : new Date(info.created),
                        relativePath: dest.relativePath,
                        hash: dest.hash,
                        deleted: false,
                        size: dest.size,
                        encoding: dest.encoding,
                    });
                }
            }
        }
    }

    return versions;
}

/**
 * Cheap per-file timeline: walk manifests for hash changes, without hydrating
 * blob contents. Follows renames by default (CP-40).
 */
export async function listFileCheckpointHistory(
    host: CheckpointEngineHost,
    relativePath: string,
    options?: FileHistoryOptions,
): Promise<FileCheckpointVersion[]> {
    if (!host.initialized || !host.currentWorkspacePath) {
        return [];
    }

    const posixPath = toPosixRelative(relativePath);
    if (!posixPath) {
        return [];
    }

    const sandboxed = resolveWorkspaceRelativePath(host, posixPath);
    if (!sandboxed.ok) {
        return [];
    }

    const history = getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    ).sort((a, b) => a.created.getTime() - b.created.getTime());

    const loaded: Array<{ info: CheckpointInfo; snapshots: FileSnapshot[] }> = [];
    for (const checkpoint of history) {
        const result = await readCheckpointRecord(host, checkpoint.id);
        if (result.status !== 'ok') {
            continue;
        }
        loaded.push({
            info: checkpoint,
            snapshots: result.checkpoint.fileSnapshots ?? [],
        });
    }

    if (options?.follow === false) {
        return uniqueFileVersionsFromSnapshots(loaded, posixPath);
    }
    return uniqueFileVersionsFollowingRenames(loaded, posixPath);
}
