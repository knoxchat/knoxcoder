import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';

import {
    collectStashBaseCheckpointIds,
    loadStashIndex,
    saveStashIndex,
    STASH_ID_PREFIX,
    toStashListItem,
    type CheckpointStashEntry,
    type CheckpointStashListItem,
} from '../store/stashIndex';
import { getBlob, hashBlobBytes } from '../store/blobStore';
import { readBlobOptions } from './blobCrypto';
import { findBranchById, lineageCheckpoints, replayHashState, snapshotToHashState, threeWayMergeHashes } from './branchLogic';
import { captureWorkspaceState } from './capture';
import { detectFileEncoding } from './fileClassification';
import type { CheckpointEngineHost } from './host';
import {
    getStoragePath,
    initializeStorageDirectories,
    readCheckpointRecord,
} from './persistence';
import { removeEmptyDirectories, restoreCheckpoint, writeSnapshotContent } from './restore';
import type { FileHashState, FileSnapshot } from './types';
import { getCheckpointHistoryForWorkspace, resolveWorkspaceRelativePath } from './workspace';

const log = createKnoxLogger('Checkpoints');

export interface StashPushOptions {
    message?: string;
}

export interface StashPushResult {
    success: boolean;
    empty: boolean;
    stashId?: string;
    fileCount?: number;
    message?: string;
}

export interface StashApplyResult {
    success: boolean;
    empty?: boolean;
    stashId?: string;
    restoredFiles: string[];
    removedFiles: string[];
    conflicts: Array<{ path: string }>;
    message?: string;
}

export function generateStashId(): string {
    return `${STASH_ID_PREFIX}${randomUUID()}`;
}

function workspaceHistory(host: CheckpointEngineHost) {
    return getCheckpointHistoryForWorkspace(host.checkpointHistory, host.currentWorkspacePath);
}

function activeHeadId(host: CheckpointEngineHost): string | undefined {
    const active = host.activeBranchId
        ? findBranchById(host.branches ?? [], host.activeBranchId)
        : undefined;
    if (active?.headCheckpointId) {
        return active.headCheckpointId;
    }
    const history = workspaceHistory(host).sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
    );
    return history[history.length - 1]?.id;
}

async function hashStateAtCheckpoint(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<Map<string, FileHashState> | null> {
    const history = workspaceHistory(host);
    const chain = lineageCheckpoints(history, checkpointId);
    if (!chain) {
        return null;
    }
    const loaded: Array<{ fileSnapshots?: FileSnapshot[] }> = [];
    for (const checkpoint of chain) {
        const result = await readCheckpointRecord(host, checkpoint.id);
        if (result.status !== 'ok') {
            return null;
        }
        loaded.push({ fileSnapshots: result.checkpoint.fileSnapshots });
    }
    return replayHashState(loaded);
}

async function workspaceHashState(
    host: CheckpointEngineHost,
    relativePath: string,
): Promise<FileHashState | undefined> {
    const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
    if (!sandboxed.ok) {
        return undefined;
    }
    try {
        const bytes = await fs.readFile(sandboxed.fullPath);
        return {
            hash: hashBlobBytes(bytes),
            encoding: detectFileEncoding(relativePath, bytes),
            size: bytes.length,
        };
    } catch {
        return undefined;
    }
}

function stashTheirsState(
    base: Map<string, FileHashState>,
    snapshots: FileSnapshot[],
): Map<string, FileHashState> {
    const theirs = new Map(base);
    for (const snapshot of snapshots) {
        const next = snapshotToHashState(snapshot);
        if (next.deleted) {
            theirs.delete(snapshot.relativePath);
        } else {
            theirs.set(snapshot.relativePath, next);
        }
    }
    return theirs;
}

async function applyMergedPaths(
    host: CheckpointEngineHost,
    merged: Map<string, FileHashState>,
    unionPaths: Iterable<string>,
): Promise<{ restoredFiles: string[]; removedFiles: string[] }> {
    const now = new Date();
    const writes: FileSnapshot[] = [];
    const deletes: string[] = [];
    for (const relativePath of [...new Set(unionPaths)].sort()) {
        const state = merged.get(relativePath);
        if (!state || state.deleted || !state.hash) {
            deletes.push(relativePath);
            continue;
        }
        writes.push({
            relativePath,
            hash: state.hash,
            encoding: state.encoding,
            lastModified: now,
            size: state.size,
            changeType: 'modified',
        });
    }

    const blobOpts = await readBlobOptions(host);
    const storagePath = getStoragePath(host);
    for (const snapshot of writes) {
        if (!snapshot.hash) {
            continue;
        }
        await getBlob(storagePath, snapshot.hash, blobOpts);
    }

    const restoredFiles: string[] = [];
    const removedFiles: string[] = [];
    for (const snapshot of writes) {
        await writeSnapshotContent(host, snapshot);
        restoredFiles.push(snapshot.relativePath);
    }
    for (const relativePath of deletes) {
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (!sandboxed.ok) {
            continue;
        }
        try {
            await fs.unlink(sandboxed.fullPath);
            removedFiles.push(relativePath);
            await removeEmptyDirectories(host, path.dirname(sandboxed.fullPath));
        } catch (error: unknown) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return { restoredFiles, removedFiles };
}

export async function listStash(host: CheckpointEngineHost): Promise<CheckpointStashListItem[]> {
    if (!host.initialized || !host.currentWorkspacePath) {
        return [];
    }
    const entries = await loadStashIndex(getStoragePath(host));
    return entries.map(toStashListItem);
}

export async function stashBaseCheckpointIds(host: CheckpointEngineHost): Promise<Set<string>> {
    if (!host.initialized) {
        return new Set();
    }
    return collectStashBaseCheckpointIds(getStoragePath(host));
}

export async function stashPush(
    host: CheckpointEngineHost,
    options?: StashPushOptions,
): Promise<StashPushResult> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return { success: false, empty: false, message: 'Checkpoint system is not ready' };
    }

    await initializeStorageDirectories(host);
    const captured = await captureWorkspaceState(host, 'delta');
    if (captured.fileSnapshots.length === 0) {
        log.info('Stash push skipped: working tree matches the current checkpoint');
        return { success: true, empty: true, fileCount: 0 };
    }

    const headId = activeHeadId(host);
    const entry: CheckpointStashEntry = {
        id: generateStashId(),
        message: options?.message?.trim() || undefined,
        createdAt: new Date(),
        baseCheckpointId: headId,
        branchId: host.activeBranchId,
        fileSnapshots: captured.fileSnapshots.map((snapshot) => ({
            relativePath: snapshot.relativePath,
            hash: snapshot.hash,
            encoding: snapshot.encoding,
            lastModified: snapshot.lastModified,
            size: snapshot.size,
            deleted: snapshot.deleted,
            changeType: snapshot.changeType,
        })),
        skippedFiles: captured.skippedFiles.length ? captured.skippedFiles : undefined,
    };

    const storagePath = getStoragePath(host);
    const entries = await loadStashIndex(storagePath);
    entries.unshift(entry);
    await saveStashIndex(storagePath, entries);

    if (headId) {
        const restored = await restoreCheckpoint(host, headId, {
            createBackup: false,
            conflictResolution: 'overwrite',
            cleanupExtraFiles: true,
        });
        if (!restored.success) {
            await host.appendAuditEvent({
                action: 'stash',
                resourceId: entry.id,
                outcome: 'failure',
                error: restored.failedFiles[0]?.error ?? 'restore head failed',
                details: { op: 'push', fileCount: entry.fileSnapshots.length, baseCheckpointId: headId },
            }).catch(() => false);
            return {
                success: false,
                empty: false,
                stashId: entry.id,
                fileCount: entry.fileSnapshots.length,
                message: restored.failedFiles[0]?.error ?? 'Could not restore the checkpoint head after stashing',
            };
        }
    }

    await host.appendAuditEvent({
        action: 'stash',
        resourceId: entry.id,
        outcome: 'success',
        counts: { files: entry.fileSnapshots.length },
        details: { op: 'push', baseCheckpointId: headId },
    }).catch(() => false);
    log.info(`Stashed ${entry.fileSnapshots.length} file(s) as ${entry.id}`);
    return {
        success: true,
        empty: false,
        stashId: entry.id,
        fileCount: entry.fileSnapshots.length,
    };
}

export async function stashApply(
    host: CheckpointEngineHost,
    stashId?: string,
): Promise<StashApplyResult> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return {
            success: false,
            restoredFiles: [],
            removedFiles: [],
            conflicts: [],
            message: 'Checkpoint system is not ready',
        };
    }

    const storagePath = getStoragePath(host);
    const entries = await loadStashIndex(storagePath);
    const target = stashId
        ? entries.find((entry) => entry.id === stashId)
        : entries[0];
    if (!target) {
        return {
            success: true,
            empty: true,
            restoredFiles: [],
            removedFiles: [],
            conflicts: [],
        };
    }

    const stashPaths = target.fileSnapshots.map((snapshot) => snapshot.relativePath);
    let baseState = new Map<string, FileHashState>();
    if (target.baseCheckpointId) {
        const reconstructed = await hashStateAtCheckpoint(host, target.baseCheckpointId);
        if (!reconstructed) {
            return {
                success: false,
                stashId: target.id,
                restoredFiles: [],
                removedFiles: [],
                conflicts: [],
                message: `Stash base checkpoint ${target.baseCheckpointId} is no longer reconstructable`,
            };
        }
        baseState = reconstructed;
    }

    const theirs = stashTheirsState(baseState, target.fileSnapshots);
    const ours = new Map<string, FileHashState>();
    const union = new Set<string>(stashPaths);
    for (const relativePath of union) {
        const current = await workspaceHashState(host, relativePath);
        if (current) {
            ours.set(relativePath, current);
        }
    }

    const scopedBase = new Map<string, FileHashState>();
    const scopedTheirs = new Map<string, FileHashState>();
    const scopedOurs = new Map<string, FileHashState>();
    for (const relativePath of union) {
        const base = baseState.get(relativePath);
        const source = theirs.get(relativePath);
        const targetState = ours.get(relativePath);
        if (base) {
            scopedBase.set(relativePath, base);
        }
        if (source) {
            scopedTheirs.set(relativePath, source);
        }
        if (targetState) {
            scopedOurs.set(relativePath, targetState);
        }
    }

    const { merged, conflicts } = threeWayMergeHashes(scopedBase, scopedTheirs, scopedOurs);
    if (conflicts.length > 0) {
        await host.appendAuditEvent({
            action: 'stash',
            resourceId: target.id,
            outcome: 'failure',
            error: `conflicts: ${conflicts.map((conflict) => conflict.path).join(', ')}`,
            details: { op: 'apply', conflictCount: conflicts.length },
        }).catch(() => false);
        return {
            success: false,
            stashId: target.id,
            restoredFiles: [],
            removedFiles: [],
            conflicts: conflicts.map((conflict) => ({ path: conflict.path })),
        };
    }

    const applied = await applyMergedPaths(host, merged, union);
    await host.appendAuditEvent({
        action: 'stash',
        resourceId: target.id,
        outcome: 'success',
        counts: { files: applied.restoredFiles.length + applied.removedFiles.length },
        details: { op: 'apply' },
    }).catch(() => false);
    return {
        success: true,
        stashId: target.id,
        restoredFiles: applied.restoredFiles,
        removedFiles: applied.removedFiles,
        conflicts: [],
    };
}

export async function stashDrop(
    host: CheckpointEngineHost,
    stashId?: string,
): Promise<{ success: boolean; stashId?: string; empty?: boolean; message?: string }> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return { success: false, message: 'Checkpoint system is not ready' };
    }
    const storagePath = getStoragePath(host);
    const entries = await loadStashIndex(storagePath);
    if (entries.length === 0) {
        return { success: true, empty: true };
    }
    const id = stashId ?? entries[0]?.id;
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) {
        return { success: false, stashId: id, message: `Stash ${id} not found` };
    }
    await saveStashIndex(storagePath, next);
    await host.appendAuditEvent({
        action: 'stash',
        resourceId: id,
        outcome: 'success',
        details: { op: 'drop' },
    }).catch(() => false);
    return { success: true, stashId: id };
}

export async function stashPop(
    host: CheckpointEngineHost,
    stashId?: string,
): Promise<StashApplyResult> {
    const applied = await stashApply(host, stashId);
    if (!applied.success || applied.empty) {
        return applied;
    }
    const dropped = await stashDrop(host, applied.stashId);
    if (!dropped.success) {
        return {
            ...applied,
            success: false,
            message: dropped.message ?? 'Applied the stash but could not drop it from the stack',
        };
    }
    await host.appendAuditEvent({
        action: 'stash',
        resourceId: applied.stashId,
        outcome: 'success',
        details: { op: 'pop' },
    }).catch(() => false);
    return applied;
}

export async function stashClear(host: CheckpointEngineHost): Promise<{ success: boolean; dropped: number }> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return { success: false, dropped: 0 };
    }
    const storagePath = getStoragePath(host);
    const entries = await loadStashIndex(storagePath);
    await saveStashIndex(storagePath, []);
    await host.appendAuditEvent({
        action: 'stash',
        outcome: 'success',
        counts: { dropped: entries.length },
        details: { op: 'clear' },
    }).catch(() => false);
    return { success: true, dropped: entries.length };
}
