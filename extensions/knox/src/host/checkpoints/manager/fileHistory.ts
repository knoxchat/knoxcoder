import { readCheckpointRecord } from './persistence';
import { toPosixRelative } from './pathFilter';
import type { CheckpointEngineHost } from './host';
import type { CheckpointInfo, FileCheckpointVersion, FileSnapshot } from './types';
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

/**
 * Cheap per-file timeline: walk manifests for hash changes, without hydrating
 * blob contents.
 */
export async function listFileCheckpointHistory(
    host: CheckpointEngineHost,
    relativePath: string,
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

    return uniqueFileVersionsFromSnapshots(loaded, posixPath);
}
