/**
 * Cherry-pick one checkpoint's delta onto HEAD (CP-41).
 * Inverse mode is the apply engine for revert (CP-42).
 *
 * Three-way: base = parent (or source when inverse), ours = onto/HEAD,
 * theirs = source (or parent when inverse). Renames from CP-40 are remapped
 * so a.ts → b.ts applies as one path. Conflicts write markers and wait
 * for continue/abort (CP-43). Overlapping dirty files refuse without writes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { generateCheckpointId } from '../checkpointId';
import { getBlob, hashBlobBytes } from '../store/blobStore';
import { readBlobOptions } from './blobCrypto';
import { bindCheckpointToActiveLine } from './branches';
import {
    findBranchById,
    hashKey,
    lineageCheckpoints,
    replayHashState,
    snapshotToHashState,
    threeWayMergeHashes,
} from './branchLogic';
import { applySnapshotHashes } from './capture';
import { detectFileEncoding } from './fileClassification';
import { changedPathsFromSnapshots } from './listQuery';
import type { CheckpointEngineHost } from './host';
import {
    initializeStorageDirectories,
    readCheckpointRecord,
    saveCheckpointToDisk,
} from './persistence';
import { beginConflict, inProgressMergeMessage, overlappingDirtyConflicts, resolveContentConflicts } from './mergeState';
import { posixDetectPath, snapshotIsDeleted } from './renameDetect';
import { enforceRetentionPolicies } from './retention';
import { removeEmptyDirectories, writeSnapshotContent } from './restore';
import type {
    CheckpointInfo,
    CherryPickOptions,
    CherryPickResult,
    FileHashState,
    FileSnapshot,
    RevertOptions,
} from './types';
import { getCheckpointHistoryForWorkspace, resolveWorkspaceRelativePath, workspaceStorageKey } from './workspace';

const log = createKnoxLogger('Checkpoints');

export type CheckpointDeltaMode = 'forward' | 'inverse';

export interface ApplyCheckpointDeltaOptions extends CherryPickOptions {
    mode?: CheckpointDeltaMode;
    tags?: string[];
    description?: string;
    label?: string;
    intent?: string;
    auditAction?: 'cherry_pick' | 'revert';
    /** Override first-parent when reverting a merge (`git -m`). */
    parentId?: string;
}

function workspaceHistory(host: CheckpointEngineHost): CheckpointInfo[] {
    return getCheckpointHistoryForWorkspace(host.checkpointHistory, host.currentWorkspacePath);
}

export function activeHeadId(host: CheckpointEngineHost): string | undefined {
    if (host.detachedFrom?.checkpointId) {
        return host.detachedFrom.checkpointId;
    }
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

export function firstParentId(checkpoint: Pick<CheckpointInfo, 'parentCheckpointId' | 'parentCheckpointIds'>): string | undefined {
    if (checkpoint.parentCheckpointId) {
        return checkpoint.parentCheckpointId;
    }
    const parents = checkpoint.parentCheckpointIds ?? [];
    return parents[0];
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

function collectRenameMap(snapshots: FileSnapshot[] | undefined, invert: boolean): Map<string, string> {
    const map = new Map<string, string>();
    for (const snapshot of snapshots ?? []) {
        if (!snapshot.renamedFrom || snapshotIsDeleted(snapshot)) {
            continue;
        }
        const from = posixDetectPath(snapshot.renamedFrom);
        const to = posixDetectPath(snapshot.relativePath);
        if (!from || !to || from === to) {
            continue;
        }
        if (invert) {
            map.set(to, from);
        } else {
            map.set(from, to);
        }
    }
    return map;
}

function remapHashState(
    state: Map<string, FileHashState>,
    renames: Map<string, string>,
): Map<string, FileHashState> {
    if (renames.size === 0) {
        return new Map(state);
    }
    const remapped = new Map(state);
    for (const [from, to] of renames) {
        if (remapped.has(from) && !remapped.has(to)) {
            remapped.set(to, remapped.get(from)!);
            remapped.delete(from);
        }
    }
    return remapped;
}

function deltaSnapshots(
    ours: Map<string, FileHashState>,
    merged: Map<string, FileHashState>,
    renames: Map<string, string>,
    now: Date,
): FileSnapshot[] {
    const snapshots: FileSnapshot[] = [];
    const paths = new Set<string>([...ours.keys(), ...merged.keys()]);
    const renameByDest = new Map<string, string>();
    for (const [from, to] of renames) {
        renameByDest.set(to, from);
    }
    for (const relativePath of [...paths].sort()) {
        const before = hashKey(ours.get(relativePath));
        const after = hashKey(merged.get(relativePath));
        if (before === after) {
            continue;
        }
        if (!after) {
            snapshots.push({
                relativePath,
                encoding: ours.get(relativePath)?.encoding || 'utf8',
                lastModified: now,
                size: 0,
                deleted: true,
                changeType: 'deleted',
            });
            continue;
        }
        const state = merged.get(relativePath)!;
        const renamedFrom = !before ? renameByDest.get(relativePath) : undefined;
        snapshots.push({
            relativePath,
            hash: state.hash,
            encoding: state.encoding,
            lastModified: now,
            size: state.size,
            changeType: before ? 'modified' : 'created',
            ...(renamedFrom ? { renamedFrom } : {}),
        });
    }
    return snapshots;
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

async function applyPathChanges(
    host: CheckpointEngineHost,
    ours: Map<string, FileHashState>,
    merged: Map<string, FileHashState>,
): Promise<{ restoredFiles: string[]; removedFiles: string[] }> {
    const now = new Date();
    const writes: FileSnapshot[] = [];
    const deletes: string[] = [];
    const paths = new Set<string>([...ours.keys(), ...merged.keys()]);
    for (const relativePath of [...paths].sort()) {
        const before = hashKey(ours.get(relativePath));
        const after = hashKey(merged.get(relativePath));
        if (before === after) {
            continue;
        }
        if (!after) {
            deletes.push(relativePath);
            continue;
        }
        const state = merged.get(relativePath)!;
        writes.push({
            relativePath,
            hash: state.hash,
            encoding: state.encoding,
            lastModified: now,
            size: state.size,
            changeType: before ? 'modified' : 'created',
        });
    }

    const blobOpts = await readBlobOptions(host);
    const storagePath = host.getStoragePath();
    for (const snapshot of writes) {
        if (!snapshot.hash) {
            continue;
        }
        await getBlob(storagePath, snapshot.hash, blobOpts);
    }

    const restoredFiles: string[] = [];
    const removedFiles: string[] = [];
    for (const snapshot of writes) {
        const live = await workspaceHashState(host, snapshot.relativePath);
        if (hashKey(live) === hashKey(snapshotToHashState(snapshot))) {
            continue;
        }
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

function failedResult(
    sourceId: string,
    ontoId: string | undefined,
    message: string,
    conflicts: Array<{ path: string }> = [],
): CherryPickResult {
    return {
        success: false,
        sourceId,
        ontoId,
        restoredFiles: [],
        removedFiles: [],
        conflicts,
        message,
    };
}

export async function applyCheckpointDelta(
    host: CheckpointEngineHost,
    sourceId: string,
    options?: ApplyCheckpointDeltaOptions,
): Promise<CherryPickResult> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return failedResult(sourceId, undefined, 'Checkpoint system is not ready');
    }
    const busy = await inProgressMergeMessage(host);
    if (busy) {
        return failedResult(sourceId, undefined, busy);
    }

    const history = workspaceHistory(host);
    const source = history.find((checkpoint) => checkpoint.id === sourceId)
        ?? host.checkpointHistory.find((checkpoint) => checkpoint.id === sourceId);
    if (!source) {
        return failedResult(sourceId, undefined, `Checkpoint ${sourceId} not found`);
    }

    const parentId = options?.parentId || firstParentId(source);
    if (!parentId) {
        return failedResult(sourceId, undefined, 'Cannot cherry-pick a root checkpoint (no parent delta)');
    }

    const ontoId = options?.onto?.trim() || activeHeadId(host);
    if (!ontoId) {
        return failedResult(sourceId, undefined, 'No checkpoint to apply onto');
    }

    const mode = options?.mode ?? 'forward';
    const auditAction = options?.auditAction ?? (mode === 'inverse' ? 'revert' : 'cherry_pick');
    const baseId = mode === 'inverse' ? sourceId : parentId;
    const theirsId = mode === 'inverse' ? parentId : sourceId;

    const [baseState, theirsState, oursState, sourceRecord] = await Promise.all([
        hashStateAtCheckpoint(host, baseId),
        hashStateAtCheckpoint(host, theirsId),
        hashStateAtCheckpoint(host, ontoId),
        readCheckpointRecord(host, sourceId),
    ]);
    if (!baseState || !theirsState || !oursState) {
        return failedResult(sourceId, ontoId, 'Could not reconstruct parent, source, or HEAD');
    }

    const sourceSnapshots = sourceRecord.status === 'ok'
        ? sourceRecord.checkpoint.fileSnapshots
        : source.fileSnapshots;
    const renames = collectRenameMap(sourceSnapshots, mode === 'inverse');
    const remappedBase = remapHashState(baseState, renames);
    const remappedOurs = remapHashState(oursState, renames);

    const hashed = threeWayMergeHashes(remappedBase, theirsState, remappedOurs);
    const content = await resolveContentConflicts(host, hashed.conflicts, remappedOurs, theirsState);
    const merged = new Map(hashed.merged);
    for (const [relativePath, state] of content.merged) {
        merged.set(relativePath, state);
    }
    const conflicts = content.remaining;
    const dirty = await overlappingDirtyConflicts(host, remappedOurs, merged, theirsState);
    if (dirty.length > 0) {
        await host.appendAuditEvent({
            action: auditAction,
            resourceId: sourceId,
            outcome: 'failure',
            error: `dirty: ${dirty.map((conflict) => conflict.path).join(', ')}`,
            details: { ontoId, conflictCount: dirty.length, mode, dirty: true },
        }).catch(() => false);
        return {
            success: false,
            sourceId,
            ontoId,
            restoredFiles: [],
            removedFiles: [],
            conflicts: dirty,
            message: 'Working tree has overlapping uncheckpointed changes',
        };
    }
    if (conflicts.length > 0) {
        await beginConflict(host, {
            operation: auditAction === 'revert' ? 'revert' : 'cherry_pick',
            sourceId,
            targetId: ontoId,
            sourceHeadId: sourceId,
            targetHeadId: ontoId,
            targetBranchId: host.activeBranchId,
            conflictPaths: conflicts.map((conflict) => conflict.path),
            preMergeCheckpointId: ontoId,
            sourceName: source.label || source.description,
            oursLabel: 'HEAD',
            theirsLabel: source.label || source.description || sourceId.slice(0, 11),
            tags: mode === 'inverse' ? ['revert', sourceId] : ['cherry-pick', sourceId],
            description: mode === 'inverse'
                ? `Revert "${source.label || source.description}"`
                : source.description,
            label: source.label,
            intent: source.intent,
        }, remappedOurs, theirsState, merged, conflicts);
        await host.appendAuditEvent({
            action: auditAction,
            resourceId: sourceId,
            outcome: 'failure',
            error: `conflicts: ${conflicts.map((conflict) => conflict.path).join(', ')}`,
            details: { ontoId, conflictCount: conflicts.length, mode, mergeInProgress: true },
        }).catch(() => false);
        return {
            success: false,
            sourceId,
            ontoId,
            restoredFiles: [],
            removedFiles: [],
            conflicts: conflicts.map((conflict) => ({ path: conflict.path })),
            mergeInProgress: true,
        };
    }

    const now = new Date();
    const snapshots = deltaSnapshots(oursState, merged, renames, now);
    if (snapshots.length === 0) {
        await host.appendAuditEvent({
            action: auditAction,
            resourceId: sourceId,
            outcome: 'success',
            details: { ontoId, empty: true, mode },
        }).catch(() => false);
        return {
            success: true,
            empty: true,
            sourceId,
            ontoId,
            restoredFiles: [],
            removedFiles: [],
            conflicts: [],
        };
    }

    const applied = await applyPathChanges(host, oursState, merged);
    await initializeStorageDirectories(host);

    const inventory = [...merged.entries()]
        .filter(([, state]) => Boolean(hashKey(state)))
        .map(([relativePath]) => relativePath)
        .sort();
    const defaultTags = mode === 'inverse' ? ['revert', sourceId] : ['cherry-pick', sourceId];
    const tags = [...new Set((options?.tags?.length ? options.tags : defaultTags).map((tag) => tag.trim()).filter(Boolean))];
    const sourceLabel = source.label || source.description;
    const checkpointId = generateCheckpointId();
    const checkpointInfo: CheckpointInfo = {
        id: checkpointId,
        description: options?.description
            || (mode === 'inverse'
                ? `Revert "${sourceLabel}"`
                : source.description),
        created: now,
        workspacePath: host.currentWorkspacePath,
        workspaceKey: host.currentWorkspacePath
            ? workspaceStorageKey(host.currentWorkspacePath)
            : undefined,
        fileSnapshots: snapshots,
        fileInventory: inventory,
        captureMode: 'delta',
        skippedFiles: [],
        tags,
        ...(options?.label !== undefined
            ? (options.label ? { label: options.label } : {})
            : (source.label ? { label: source.label } : {})),
        ...(options?.intent !== undefined
            ? (options.intent ? { intent: options.intent } : {})
            : (source.intent ? { intent: source.intent } : {})),
        changedPaths: changedPathsFromSnapshots(snapshots),
    };
    bindCheckpointToActiveLine(host, checkpointInfo);
    if (checkpointInfo.parentCheckpointId !== ontoId) {
        checkpointInfo.parentCheckpointId = ontoId;
    }

    host.checkpointHistory.push(checkpointInfo);
    await saveCheckpointToDisk(host, checkpointInfo);
    await host.saveCheckpointHistory();
    applySnapshotHashes(host, snapshots);
    host.lastCheckpointTime = Date.now();
    host.fireCheckpointCreated(checkpointId);
    await host.appendAuditEvent({
        action: auditAction,
        resourceId: checkpointId,
        outcome: 'success',
        counts: { files: snapshots.length },
        details: { sourceId, ontoId, mode },
    }).catch(() => false);
    await host.recordStorageSnapshot().catch(() => false);
    await enforceRetentionPolicies(host);
    log.info(`${auditAction} ${sourceId} onto ${ontoId} as ${checkpointId}`);
    return {
        success: true,
        checkpointId,
        sourceId,
        ontoId,
        restoredFiles: applied.restoredFiles,
        removedFiles: applied.removedFiles,
        conflicts: [],
    };
}

export async function cherryPick(
    host: CheckpointEngineHost,
    sourceId: string,
    options?: CherryPickOptions,
): Promise<CherryPickResult> {
    return applyCheckpointDelta(host, sourceId, {
        ...options,
        mode: 'forward',
        auditAction: 'cherry_pick',
    });
}

export function isMergeCheckpoint(
    checkpoint: Pick<CheckpointInfo, 'parentCheckpointIds'>,
): boolean {
    return (checkpoint.parentCheckpointIds?.length ?? 0) > 1;
}

export async function revertCheckpoint(
    host: CheckpointEngineHost,
    sourceId: string,
    options?: RevertOptions,
): Promise<CherryPickResult> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return failedResult(sourceId, undefined, 'Checkpoint system is not ready');
    }
    const history = workspaceHistory(host);
    const source = history.find((checkpoint) => checkpoint.id === sourceId)
        ?? host.checkpointHistory.find((checkpoint) => checkpoint.id === sourceId);
    if (!source) {
        return failedResult(sourceId, undefined, `Checkpoint ${sourceId} not found`);
    }
    if (isMergeCheckpoint(source) && options?.mainline == null) {
        return failedResult(
            sourceId,
            undefined,
            'Cannot revert a merge checkpoint without mainline (pass mainline: 1 for the first parent)',
        );
    }
    const parents = source.parentCheckpointIds?.length
        ? source.parentCheckpointIds
        : (source.parentCheckpointId ? [source.parentCheckpointId] : []);
    const mainline = options?.mainline ?? 1;
    const parentId = parents[mainline - 1];
    if (!parentId) {
        return failedResult(sourceId, undefined, `Merge checkpoint has no parent at mainline ${mainline}`);
    }
    const sourceLabel = source.label || source.description;
    return applyCheckpointDelta(host, sourceId, {
        onto: options?.onto,
        mode: 'inverse',
        parentId,
        tags: ['revert', sourceId],
        description: `Revert "${sourceLabel}"`,
        label: `Revert "${sourceLabel}"`,
        intent: '',
        auditAction: 'revert',
    });
}
