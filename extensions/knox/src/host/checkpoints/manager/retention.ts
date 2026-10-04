import { createKnoxLogger } from 'core/util/knoxLog';

import { foldSnapshotsIntoSuccessor } from '../checkpointReplay';
import { withStoreLock } from '../store/storeLock';
import { formatFileSize } from './format';
import type { CheckpointEngineHost } from './host';
import {
    computeDiskStorageBytes,
    gcUnreferencedCheckpointBlobs,
    getStoragePath,
    markCheckpointRemoved,
    mergeForeignIndexEntries,
    recordHealthIssue,
    readCheckpointRecord,
    saveCheckpointToDisk,
    toIndexRecord,
} from './persistence';
import { computeCheckpointFileStats, type CheckpointInfo, type FileSnapshot, type SkippedFile } from './types';
import { getCheckpointHistoryForWorkspace } from './workspace';

const log = createKnoxLogger('Checkpoints');

export interface RemoveCheckpointOptions {
    /**
     * Retention/quota/age eviction. Skips pinned checkpoints and will not
     * delete the last remaining reconstructable checkpoint in the workspace.
     */
    retention?: boolean;
}

function isPinned(checkpoint: Pick<CheckpointInfo, 'pinned'> | undefined): boolean {
    return checkpoint?.pinned === true;
}

function mergeSkippedFiles(
    current: SkippedFile[] | undefined,
    successor: SkippedFile[] | undefined,
): SkippedFile[] | undefined {
    if (!current?.length && !successor?.length) {
        return successor ?? current;
    }
    const merged = new Map<string, SkippedFile>();
    for (const skipped of current ?? []) {
        merged.set(skipped.path, skipped);
    }
    for (const skipped of successor ?? []) {
        merged.set(skipped.path, skipped);
    }
    return Array.from(merged.values());
}

export function removeFromHistory(host: CheckpointEngineHost, checkpointId: string): boolean {
    const initialLength = host.checkpointHistory.length;
    markCheckpointRemoved(host, checkpointId);
    host.checkpointHistory = host.checkpointHistory.filter((c) => c.id !== checkpointId);
    const wasRemoved = host.checkpointHistory.length < initialLength;
    if (wasRemoved) {
        void host.saveCheckpointHistory();
    }
    return wasRemoved;
}

/**
 * Copy hashes that exist only in `checkpointId` into its chronological successor
 * so deleting the earlier checkpoint cannot destroy the only copy of baseline bytes.
 */
export async function foldCheckpointIntoSuccessor(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<boolean> {
    const target = host.checkpointHistory.find((cp) => cp.id === checkpointId);
    if (!target) {
        return false;
    }

    const history = getCheckpointHistoryForWorkspace(host.checkpointHistory, target.workspacePath)
        .sort((a, b) => a.created.getTime() - b.created.getTime());
    const index = history.findIndex((cp) => cp.id === checkpointId);
    if (index < 0) {
        return false;
    }
    if (index >= history.length - 1) {
        // Newest (or sole) checkpoint: nothing to fold into.
        return true;
    }

    const current = history[index];
    const successor = history[index + 1];

    const currentRecord = await readCheckpointRecord(host, current.id);
    const successorRecord = await readCheckpointRecord(host, successor.id);
    if (currentRecord.status !== 'ok') {
        // Pre-CAS / index-only rows have no per-id JSON. There is nothing to
        // merge; allow delete to drop the ghost index entry.
        log.warn(
            `Skipping fold for ${checkpointId}: current manifest is ${currentRecord.status}` +
            (currentRecord.status === 'corrupt' ? ` (${currentRecord.reason})` : ''),
        );
        return true;
    }
    if (successorRecord.status !== 'ok') {
        log.error(
            `Cannot fold checkpoint ${checkpointId}: successor manifest is ${successorRecord.status}` +
            (successorRecord.status === 'corrupt' ? ` (${successorRecord.reason})` : ''),
        );
        return false;
    }

    const currentSnapshots: FileSnapshot[] = currentRecord.checkpoint.fileSnapshots ?? [];
    const successorSnapshots: FileSnapshot[] = successorRecord.checkpoint.fileSnapshots ?? [];
    const merged = foldSnapshotsIntoSuccessor(currentSnapshots, successorSnapshots);

    successor.fileSnapshots = merged;
    successor.fileInventory = successorRecord.checkpoint.fileInventory?.length
        ? successorRecord.checkpoint.fileInventory
        : merged.filter((snapshot) => !snapshot.deleted && snapshot.changeType !== 'deleted')
            .map((snapshot) => snapshot.relativePath);
    successor.skippedFiles = mergeSkippedFiles(
        currentRecord.checkpoint.skippedFiles,
        successorRecord.checkpoint.skippedFiles,
    );
    if (current.captureMode === 'baseline' || index === 0) {
        successor.captureMode = 'baseline';
    }
    successor.schemaVersion = successorRecord.checkpoint.schemaVersion;
    successor.contentSha256 = successorRecord.checkpoint.contentSha256;
    successor.fileStats = computeCheckpointFileStats(successor);
    successor.pinned = successor.pinned ?? successorRecord.checkpoint.pinned;

    // Reconstruct walks parentCheckpointId. After the deleted node is gone,
    // children must skip to its parent or the successor cannot replay earlier
    // hashes that were not copied into this fold (delete-middle).
    const deletedParentId = current.parentCheckpointId;
    for (const checkpoint of host.checkpointHistory) {
        if (checkpoint.parentCheckpointId === current.id) {
            checkpoint.parentCheckpointId = deletedParentId;
        }
    }

    await saveCheckpointToDisk(host, successor);
    Object.assign(successor, toIndexRecord(successor));
    await host.saveCheckpointHistory();
    log.info(`🔗 Folded checkpoint ${checkpointId.substring(0, 8)} into successor ${successor.id.substring(0, 8)}`);
    return true;
}

export async function removeFromHistoryAndDisk(
    host: CheckpointEngineHost,
    checkpointId: string,
    options?: RemoveCheckpointOptions,
): Promise<boolean> {
    const target = host.checkpointHistory.find((cp) => cp.id === checkpointId);
    if (!target) {
        return false;
    }

    if (options?.retention && isPinned(target)) {
        log.info(`📌 Skipping pinned checkpoint ${checkpointId.substring(0, 8)} during retention`);
        return false;
    }

    if (options?.retention) {
        const remaining = getCheckpointHistoryForWorkspace(
            host.checkpointHistory,
            target.workspacePath ?? host.currentWorkspacePath,
        );
        if (remaining.length <= 1) {
            log.info(`🛡️ Keeping sole remaining checkpoint ${checkpointId.substring(0, 8)}`);
            return false;
        }
    }

    log.info(`🗑️ Deleting checkpoint: ${checkpointId}`);

    try {
        const folded = await foldCheckpointIntoSuccessor(host, checkpointId);
        if (!folded) {
            if (options?.retention) {
                log.error(`Refusing to evict checkpoint ${checkpointId}: fold into successor failed`);
                return false;
            }
            log.warn(`Fold failed for ${checkpointId}; proceeding with user-requested delete`);
        }
    } catch (error) {
        if (options?.retention) {
            log.error(`Failed to fold checkpoint ${checkpointId} into successor:`, error);
            return false;
        }
        log.warn(`Fold threw for ${checkpointId}; proceeding with user-requested delete:`, error);
    }

    for (const [messageId, mappedId] of Object.entries(host.messageCheckpoints)) {
        if (mappedId === checkpointId) {
            delete host.messageCheckpoints[messageId];
        }
    }
    for (const [stableId, mappedId] of Object.entries(host.stableIdCheckpoints)) {
        if (mappedId === checkpointId) {
            delete host.stableIdCheckpoints[stableId];
        }
    }

    const wasRemoved = removeFromHistory(host, checkpointId);

    if (wasRemoved) {
        try {
            await host.deleteCheckpointFromDisk(checkpointId);
        } catch (error) {
            log.error(`Failed to delete checkpoint ${checkpointId} from disk:`, error);
        }
        await host.appendAuditEvent({
            action: 'delete',
            resourceId: checkpointId,
            outcome: 'success',
        }).catch(() => false);
        await host.recordStorageSnapshot().catch(() => false);
    }

    return wasRemoved;
}

export async function setCheckpointPinned(
    host: CheckpointEngineHost,
    checkpointId: string,
    pinned: boolean,
): Promise<boolean> {
    const info = host.checkpointHistory.find((cp) => cp.id === checkpointId);
    if (!info) {
        return false;
    }

    info.pinned = pinned;
    const record = await readCheckpointRecord(host, checkpointId);
    if (record.status === 'ok') {
        record.checkpoint.pinned = pinned;
        await saveCheckpointToDisk(host, record.checkpoint);
        Object.assign(info, toIndexRecord({ ...record.checkpoint, pinned }));
    }

    await host.saveCheckpointHistory();
    log.info(`${pinned ? '📌' : '📍'} Checkpoint ${checkpointId.substring(0, 8)} ${pinned ? 'pinned' : 'unpinned'}`);
    await host.appendAuditEvent({
        action: pinned ? 'pin' : 'unpin',
        resourceId: checkpointId,
        outcome: 'success',
    }).catch(() => false);
    return true;
}

const MAX_CHECKPOINT_TAG_LENGTH = 80;

/**
 * Add or remove one label on a checkpoint. Tags are names, same role as a
 * Git Graph tag pill. Kind classification still reads `merge` when present.
 */
export async function setCheckpointTag(
    host: CheckpointEngineHost,
    checkpointId: string,
    tag: string,
    present: boolean,
): Promise<boolean> {
    const info = host.checkpointHistory.find((cp) => cp.id === checkpointId);
    if (!info) {
        return false;
    }
    const trimmed = tag.trim();
    if (!trimmed || trimmed.length > MAX_CHECKPOINT_TAG_LENGTH) {
        return false;
    }
    const tags = [...(info.tags ?? [])];
    const index = tags.indexOf(trimmed);
    if (present) {
        if (index >= 0) {
            return true;
        }
        tags.push(trimmed);
    } else if (index < 0) {
        return false;
    } else {
        tags.splice(index, 1);
    }
    info.tags = tags;
    const record = await readCheckpointRecord(host, checkpointId);
    if (record.status === 'ok') {
        record.checkpoint.tags = tags;
        await saveCheckpointToDisk(host, record.checkpoint);
        Object.assign(info, toIndexRecord({ ...record.checkpoint, tags }));
    }
    await host.saveCheckpointHistory();
    return true;
}

function workspaceHistoryOldestFirst(
    host: CheckpointEngineHost,
    workspacePath?: string,
): CheckpointInfo[] {
    return getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        workspacePath ?? host.currentWorkspacePath,
    ).sort((a, b) => a.created.getTime() - b.created.getTime());
}

export async function enforceMaxCheckpoints(host: CheckpointEngineHost): Promise<void> {
    if (!host.currentWorkspacePath || host.maxCheckpoints < 1) {
        return;
    }

    const workspaceHistory = workspaceHistoryOldestFirst(host);
    let overflow = workspaceHistory.length - host.maxCheckpoints;
    if (overflow <= 0) {
        return;
    }

    log.info(`📉 Enforcing maxCheckpoints=${host.maxCheckpoints} (removing ${overflow} unpinned)`);
    for (const checkpoint of workspaceHistory) {
        if (overflow <= 0) {
            break;
        }
        const remaining = workspaceHistoryOldestFirst(host);
        if (remaining.length <= 1) {
            break;
        }
        const removed = await removeFromHistoryAndDisk(host, checkpoint.id, { retention: true });
        if (removed) {
            overflow--;
        }
    }
}

export async function enforceStorageQuota(host: CheckpointEngineHost): Promise<void> {
    if (!host.currentWorkspacePath || host.maxStorageBytes < 1) {
        return;
    }

    let usage = await computeDiskStorageBytes(host);
    if (usage <= host.maxStorageBytes) {
        return;
    }

    // Orphaned blobs (failed captures, other windows' leftovers) cost nothing to
    // reclaim; do that before evicting any real checkpoint.
    const gc = await gcUnreferencedCheckpointBlobs(host);
    if (gc.deleted > 0) {
        usage = await computeDiskStorageBytes(host);
        if (usage <= host.maxStorageBytes) {
            return;
        }
    }

    log.info(
        `📉 Enforcing maxStorageBytes=${formatFileSize(host.maxStorageBytes)} (current ${formatFileSize(usage)})`,
    );
    let deletedCount = 0;
    let bytesReclaimed = 0;
    const candidates = workspaceHistoryOldestFirst(host);

    for (const checkpoint of candidates) {
        usage = await computeDiskStorageBytes(host);
        if (usage <= host.maxStorageBytes) {
            break;
        }
        const remaining = workspaceHistoryOldestFirst(host);
        if (remaining.length <= 1) {
            break;
        }
        const before = usage;
        const removed = await removeFromHistoryAndDisk(host, checkpoint.id, { retention: true });
        if (!removed) {
            continue;
        }
        deletedCount++;
        usage = await computeDiskStorageBytes(host);
        bytesReclaimed += Math.max(0, before - usage);
    }

    if (deletedCount > 0) {
        log.info(
            `📉 Storage quota reclaimed ${formatFileSize(bytesReclaimed)} by deleting ${deletedCount} unpinned checkpoint(s)`,
        );
    } else if (usage > host.maxStorageBytes) {
        const message =
            `Storage still over quota (${formatFileSize(usage)} > ${formatFileSize(host.maxStorageBytes)}); ` +
            'remaining checkpoints are pinned or the sole baseline. Unpin or delete some, or raise the quota.';
        log.warn(`⚠️ ${message}`);
        recordHealthIssue(host, { kind: 'quota_exceeded', message });
    }
}

export async function enforceRetentionPolicies(host: CheckpointEngineHost): Promise<void> {
    // One window prunes at a time; the lock is re-entrant for the nested
    // delete/GC calls. Pull in checkpoints other windows created first so the
    // count and byte quota reflect the shared store, not this window's view.
    await withStoreLock(getStoragePath(host), async () => {
        await mergeForeignIndexEntries(host);
        await enforceMaxCheckpoints(host);
        await enforceStorageQuota(host);
    });
}

export async function cleanupOldCheckpoints(
    host: CheckpointEngineHost,
    retentionDays: number = 7,
): Promise<number> {
    log.info(`🧹 Cleaning up checkpoints older than ${retentionDays} days`);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const checkpointsToRemove = host.checkpointHistory
        .filter((checkpoint) => checkpoint.created < cutoffDate)
        .sort((a, b) => a.created.getTime() - b.created.getTime());

    let deletedCount = 0;
    for (const checkpoint of checkpointsToRemove) {
        const remaining = getCheckpointHistoryForWorkspace(
            host.checkpointHistory,
            checkpoint.workspacePath ?? host.currentWorkspacePath,
        );
        if (remaining.length <= 1) {
            break;
        }
        const removed = await removeFromHistoryAndDisk(host, checkpoint.id, { retention: true });
        if (removed) {
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        log.info(`🧹 Cleaned up ${deletedCount} old checkpoints from history and disk`);
    }

    return deletedCount;
}
