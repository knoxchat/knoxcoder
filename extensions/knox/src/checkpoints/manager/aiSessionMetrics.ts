import { isBinaryCheckpointEncoding } from '../store/blobStore';
import { isBinarySnapshotExtension } from './fileClassification';
import { pathMatchesPattern, toPosixRelative } from './pathFilter';
import { countLineDelta } from './restorePreview';
import type { CheckpointFileDiff } from './types';

export interface SessionLineCounts {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
}

type DiffCapable = {
    computeCheckpointDiff?: (
        checkpointId: string,
        compareToCheckpointId?: string,
    ) => Promise<{ files: CheckpointFileDiff[] } | null>;
    getCurrentWorkspacePath?: () => string | undefined;
};

type AuditCapable = {
    getAuditTrail?: (
        limit?: number,
        actionFilter?: string,
    ) => Promise<Array<{ timestamp: string; outcome?: string }>>;
};

function isTrackedPath(relativePath: string, trackedFiles: string[], workspacePath?: string): boolean {
    if (trackedFiles.length === 0) {
        return true;
    }
    const rel = toPosixRelative(relativePath);
    const workspace = workspacePath ?? '';
    return trackedFiles.some((tracked) => {
        const pat = toPosixRelative(tracked);
        return rel === pat
            || pathMatchesPattern(workspace, rel, tracked)
            || pathMatchesPattern(workspace, pat, relativePath);
    });
}

export function lineCountsFromDiff(
    files: CheckpointFileDiff[],
    trackedFiles: string[] = [],
    workspacePath?: string,
): SessionLineCounts {
    let linesAdded = 0;
    let linesDeleted = 0;
    let filesChanged = 0;
    for (const file of files) {
        if (!isTrackedPath(file.relativePath, trackedFiles, workspacePath)) {
            continue;
        }
        filesChanged += 1;
        const encoding = file.newEncoding || file.oldEncoding || 'utf8';
        if (encoding === 'base64' || isBinaryCheckpointEncoding(encoding) || isBinarySnapshotExtension(file.relativePath)) {
            continue;
        }
        const delta = countLineDelta(file.oldContent ?? '', file.newContent ?? '');
        linesAdded += delta.additions;
        linesDeleted += delta.deletions;
    }
    return { filesChanged, linesAdded, linesDeleted };
}

export async function measureSessionLineCounts(
    manager: DiffCapable,
    baselineCheckpointId: string | undefined,
    endCheckpointId: string | undefined,
    trackedFiles: string[] = [],
): Promise<SessionLineCounts | undefined> {
    if (!baselineCheckpointId || !endCheckpointId || typeof manager.computeCheckpointDiff !== 'function') {
        return undefined;
    }
    if (baselineCheckpointId === endCheckpointId) {
        return { filesChanged: 0, linesAdded: 0, linesDeleted: 0 };
    }
    const diff = await manager.computeCheckpointDiff(endCheckpointId, baselineCheckpointId);
    if (!diff) {
        return undefined;
    }
    return lineCountsFromDiff(
        diff.files,
        trackedFiles,
        manager.getCurrentWorkspacePath?.(),
    );
}

export async function countSessionRollbacks(
    manager: AuditCapable,
    startedAt: Date,
    endedAt: Date = new Date(),
): Promise<number | undefined> {
    if (typeof manager.getAuditTrail !== 'function') {
        return undefined;
    }
    const events = await manager.getAuditTrail(1000, 'restore');
    const startMs = startedAt.getTime();
    const endMs = endedAt.getTime();
    return events.filter((event) => {
        const ts = Date.parse(event.timestamp);
        return Number.isFinite(ts)
            && ts >= startMs
            && ts <= endMs
            && event.outcome !== 'failure';
    }).length;
}

export function newestCheckpointId(
    history: Array<{ id: string; created: Date }> | undefined,
): string | undefined {
    if (!history?.length) {
        return undefined;
    }
    const newest = [...history].sort((a, b) => b.created.getTime() - a.created.getTime())[0];
    return newest?.id;
}
