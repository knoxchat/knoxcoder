/**
 * In-progress merge / cherry-pick / revert (CP-43).
 * Persist merge-head.json, write conflict markers, continue or abort.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { generateCheckpointId } from '../checkpointId';
import { getBlob, hashBlobBytes, putBlob } from '../store/blobStore';
import { writeFileAtomic } from '../store/atomicWrite';
import { readBlobOptions, writeBlobOptions } from './blobCrypto';
import {
    fileHasConflictMarkers,
    formatConflictMarkers,
    hashKey,
    hashStateToSnapshots,
    threeWayMergeHashes,
    threeWayMergeText,
} from './branchLogic';
import { applySnapshotHashes } from './capture';
import { detectFileEncoding } from './fileClassification';
import { changedPathsFromSnapshots } from './listQuery';
import type { CheckpointEngineHost } from './host';
import {
    getStoragePath,
    initializeStorageDirectories,
    saveCheckpointToDisk,
} from './persistence';
import { restoreCheckpoint, writeSnapshotContent } from './restore';
import { enforceRetentionPolicies } from './retention';
import { stashApply } from './stash';
import type {
    BranchMergeConflict,
    CheckpointInfo,
    CheckpointMergeState,
    FileHashState,
    FileSnapshot,
    MergeContinueResult,
} from './types';
import { resolveWorkspaceRelativePath, workspaceStorageKey } from './workspace';

const log = createKnoxLogger('Checkpoints');

export const MERGE_STATE_FILENAME = 'merge-head.json';

export function mergeStatePath(host: CheckpointEngineHost): string {
    return path.join(getStoragePath(host), MERGE_STATE_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAutoMerged(value: unknown): CheckpointMergeState['autoMerged'] {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const entries: NonNullable<CheckpointMergeState['autoMerged']> = [];
    for (const item of value) {
        if (!isRecord(item) || typeof item.path !== 'string' || typeof item.encoding !== 'string' || typeof item.size !== 'number') {
            continue;
        }
        entries.push({
            path: item.path,
            encoding: item.encoding,
            size: item.size,
            hash: typeof item.hash === 'string' ? item.hash : undefined,
            deleted: item.deleted === true ? true : undefined,
        });
    }
    return entries;
}

function parseMergeState(value: unknown): CheckpointMergeState | null {
    if (!isRecord(value) || typeof value.operation !== 'string' || !Array.isArray(value.conflictPaths)) {
        return null;
    }
    if (value.operation !== 'merge' && value.operation !== 'cherry_pick' && value.operation !== 'revert') {
        return null;
    }
    if (typeof value.sourceId !== 'string' || typeof value.targetId !== 'string' || typeof value.targetHeadId !== 'string') {
        return null;
    }
    return {
        operation: value.operation,
        sourceId: value.sourceId,
        targetId: value.targetId,
        targetHeadId: value.targetHeadId,
        conflictPaths: value.conflictPaths.filter((path): path is string => typeof path === 'string'),
        sourceHeadId: typeof value.sourceHeadId === 'string' ? value.sourceHeadId : undefined,
        targetBranchId: typeof value.targetBranchId === 'string' ? value.targetBranchId : undefined,
        lcaId: typeof value.lcaId === 'string' ? value.lcaId : undefined,
        autoMergedPaths: Array.isArray(value.autoMergedPaths)
            ? value.autoMergedPaths.filter((path): path is string => typeof path === 'string')
            : undefined,
        autoMerged: parseAutoMerged(value.autoMerged),
        inventory: Array.isArray(value.inventory)
            ? value.inventory.filter((path): path is string => typeof path === 'string')
            : undefined,
        preMergeCheckpointId: typeof value.preMergeCheckpointId === 'string' ? value.preMergeCheckpointId : undefined,
        stashId: typeof value.stashId === 'string' ? value.stashId : undefined,
        sourceName: typeof value.sourceName === 'string' ? value.sourceName : undefined,
        targetName: typeof value.targetName === 'string' ? value.targetName : undefined,
        oursLabel: typeof value.oursLabel === 'string' ? value.oursLabel : undefined,
        theirsLabel: typeof value.theirsLabel === 'string' ? value.theirsLabel : undefined,
        description: typeof value.description === 'string' ? value.description : undefined,
        label: typeof value.label === 'string' ? value.label : undefined,
        intent: typeof value.intent === 'string' ? value.intent : undefined,
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    };
}

export async function loadMergeState(host: CheckpointEngineHost): Promise<CheckpointMergeState | null> {
    try {
        return parseMergeState(JSON.parse(await fs.readFile(mergeStatePath(host), 'utf8')));
    } catch {
        return null;
    }
}

export async function inProgressMergeMessage(host: CheckpointEngineHost): Promise<string | undefined> {
    const state = await loadMergeState(host);
    if (!state) {
        return undefined;
    }
    return `A ${state.operation.replace('_', '-')} is already in progress. Continue or abort it first.`;
}

export async function overlappingDirtyConflicts(
    host: CheckpointEngineHost,
    ours: Map<string, FileHashState>,
    merged: Map<string, FileHashState>,
    theirs?: Map<string, FileHashState>,
): Promise<Array<{ path: string }>> {
    const conflicts: Array<{ path: string }> = [];
    const paths = new Set<string>([
        ...ours.keys(),
        ...merged.keys(),
        ...(theirs?.keys() ?? []),
    ]);
    for (const relativePath of [...paths].sort()) {
        if (hashKey(ours.get(relativePath)) === hashKey(merged.get(relativePath))) {
            continue;
        }
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (!sandboxed.ok) {
            continue;
        }
        let liveHash: string | undefined;
        try {
            const bytes = await fs.readFile(sandboxed.fullPath);
            liveHash = hashBlobBytes(bytes);
        } catch {
            liveHash = undefined;
        }
        const headHash = hashKey(ours.get(relativePath));
        const desiredHash = hashKey(merged.get(relativePath));
        const theirsHash = hashKey(theirs?.get(relativePath));
        if (liveHash !== headHash && liveHash !== desiredHash && liveHash !== theirsHash) {
            conflicts.push({ path: relativePath });
        }
    }
    return conflicts;
}

export async function saveMergeState(host: CheckpointEngineHost, state: CheckpointMergeState): Promise<void> {
    await initializeStorageDirectories(host);
    await writeFileAtomic(mergeStatePath(host), `${JSON.stringify(state, null, 2)}\n`);
}

export async function clearMergeState(host: CheckpointEngineHost): Promise<void> {
    try {
        await fs.unlink(mergeStatePath(host));
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

async function textFromHash(
    host: CheckpointEngineHost,
    hash: string | undefined,
): Promise<string | undefined> {
    if (!hash) {
        return '';
    }
    try {
        const bytes = await getBlob(getStoragePath(host), hash, await readBlobOptions(host));
        if (bytes.includes(0)) {
            return undefined;
        }
        return bytes.toString('utf8');
    } catch {
        return undefined;
    }
}

export async function resolveContentConflicts(
    host: CheckpointEngineHost,
    conflicts: BranchMergeConflict[],
    ours: Map<string, FileHashState>,
    theirs: Map<string, FileHashState>,
): Promise<{ merged: Map<string, FileHashState>; remaining: BranchMergeConflict[] }> {
    const merged = new Map<string, FileHashState>();
    const remaining: BranchMergeConflict[] = [];
    const writeOpts = await writeBlobOptions(host);
    for (const conflict of conflicts) {
        const [baseText, oursText, theirsText] = await Promise.all([
            textFromHash(host, conflict.baseHash),
            textFromHash(host, conflict.targetHash ?? hashKey(ours.get(conflict.path))),
            textFromHash(host, conflict.sourceHash ?? hashKey(theirs.get(conflict.path))),
        ]);
        if (baseText === undefined || oursText === undefined || theirsText === undefined) {
            remaining.push(conflict);
            continue;
        }
        const resolved = threeWayMergeText(baseText, oursText, theirsText);
        if ('conflict' in resolved) {
            remaining.push(conflict);
            continue;
        }
        const bytes = Buffer.from(resolved.content, 'utf8');
        const hash = await putBlob(getStoragePath(host), bytes, writeOpts);
        merged.set(conflict.path, {
            hash,
            encoding: detectFileEncoding(conflict.path, bytes),
            size: bytes.length,
        });
    }
    return { merged, remaining };
}

export async function writeConflictFiles(
    host: CheckpointEngineHost,
    conflicts: BranchMergeConflict[],
    ours: Map<string, FileHashState>,
    theirs: Map<string, FileHashState>,
    oursLabel: string,
    theirsLabel: string,
): Promise<void> {
    for (const conflict of conflicts) {
        const [oursText, theirsText] = await Promise.all([
            textFromHash(host, conflict.targetHash ?? hashKey(ours.get(conflict.path))),
            textFromHash(host, conflict.sourceHash ?? hashKey(theirs.get(conflict.path))),
        ]);
        if (oursText === undefined || theirsText === undefined) {
            continue;
        }
        const marked = formatConflictMarkers(oursText, theirsText, oursLabel, theirsLabel);
        const sandboxed = resolveWorkspaceRelativePath(host, conflict.path);
        if (!sandboxed.ok) {
            continue;
        }
        await fs.mkdir(path.dirname(sandboxed.fullPath), { recursive: true });
        await fs.writeFile(sandboxed.fullPath, marked);
    }
}

export async function applyMergedHashState(
    host: CheckpointEngineHost,
    ours: Map<string, FileHashState>,
    merged: Map<string, FileHashState>,
): Promise<void> {
    const now = new Date();
    const paths = new Set<string>([...ours.keys(), ...merged.keys()]);
    for (const relativePath of [...paths].sort()) {
        if (hashKey(ours.get(relativePath)) === hashKey(merged.get(relativePath))) {
            continue;
        }
        const state = merged.get(relativePath);
        if (!state || state.deleted || !state.hash) {
            const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
            if (sandboxed.ok) {
                try {
                    await fs.unlink(sandboxed.fullPath);
                } catch (error: unknown) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                        throw error;
                    }
                }
            }
            continue;
        }
        await writeSnapshotContent(host, {
            relativePath,
            hash: state.hash,
            encoding: state.encoding,
            lastModified: now,
            size: state.size,
            changeType: 'modified',
        });
    }
}

export async function beginConflict(
    host: CheckpointEngineHost,
    state: CheckpointMergeState,
    ours: Map<string, FileHashState>,
    theirs: Map<string, FileHashState>,
    merged: Map<string, FileHashState>,
    conflicts: BranchMergeConflict[],
): Promise<void> {
    await applyMergedHashState(host, ours, merged);
    await writeConflictFiles(
        host,
        conflicts,
        ours,
        theirs,
        state.oursLabel || 'HEAD',
        state.theirsLabel || state.sourceName || 'theirs',
    );
    const conflictSet = new Set(conflicts.map((conflict) => conflict.path));
    const autoMerged = [...merged.entries()].map(([relativePath, fileState]) => ({
        path: relativePath,
        hash: fileState.hash,
        encoding: fileState.encoding,
        size: fileState.size,
        deleted: fileState.deleted,
    }));
    await saveMergeState(host, {
        ...state,
        conflictPaths: conflicts.map((conflict) => conflict.path),
        autoMerged,
        autoMergedPaths: autoMerged
            .map((entry) => entry.path)
            .filter((relativePath) =>
                !conflictSet.has(relativePath)
                && hashKey(ours.get(relativePath)) !== hashKey(merged.get(relativePath)),
            ),
        inventory: [...merged.keys()].filter((relativePath) => Boolean(hashKey(merged.get(relativePath)))).sort(),
        createdAt: state.createdAt || new Date().toISOString(),
    });
}

async function resolvedConflictSnapshots(
    host: CheckpointEngineHost,
    state: CheckpointMergeState,
): Promise<{ snapshots: FileSnapshot[]; message?: string }> {
    const now = new Date();
    const snapshots: FileSnapshot[] = [];
    for (const relativePath of state.conflictPaths) {
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (!sandboxed.ok) {
            return { snapshots: [], message: `Unsafe conflict path ${relativePath}` };
        }
        try {
            const bytes = await fs.readFile(sandboxed.fullPath);
            const content = bytes.toString('utf8');
            if (fileHasConflictMarkers(content)) {
                return { snapshots: [], message: `Unresolved conflict markers in ${relativePath}` };
            }
            const hash = await putBlob(getStoragePath(host), bytes, await writeBlobOptions(host));
            snapshots.push({
                relativePath,
                hash,
                encoding: detectFileEncoding(relativePath, bytes),
                lastModified: now,
                size: bytes.length,
                changeType: 'modified',
            });
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                snapshots.push({
                    relativePath,
                    encoding: 'utf8',
                    lastModified: now,
                    size: 0,
                    deleted: true,
                    changeType: 'deleted',
                });
                continue;
            }
            throw error;
        }
    }
    return { snapshots };
}

export async function mergeContinue(host: CheckpointEngineHost): Promise<MergeContinueResult> {
    await host.whenReady();
    const state = await loadMergeState(host);
    if (!state) {
        return { success: false, conflicts: [], message: 'No merge in progress' };
    }
    const resolved = await resolvedConflictSnapshots(host, state);
    if (resolved.message) {
        return { success: false, conflicts: state.conflictPaths.map((path) => ({ path })), message: resolved.message };
    }

    await initializeStorageDirectories(host);
    const now = new Date();
    const checkpointId = generateCheckpointId();
    const isMerge = state.operation === 'merge';
    const resolvedPaths = new Set(resolved.snapshots.map((snapshot) => snapshot.relativePath));
    const autoSnapshots: FileSnapshot[] = (state.autoMerged ?? [])
        .filter((entry) => !resolvedPaths.has(entry.path))
        .map((entry) => ({
            relativePath: entry.path,
            hash: entry.hash,
            encoding: entry.encoding,
            lastModified: now,
            size: entry.size,
            deleted: entry.deleted,
            changeType: entry.deleted ? 'deleted' : 'modified',
        }));
    const snapshots = [...autoSnapshots, ...resolved.snapshots];
    const inventory = [...new Set([
        ...(state.inventory ?? []),
        ...snapshots.filter((snapshot) => !snapshot.deleted).map((snapshot) => snapshot.relativePath),
    ])].filter((relativePath) => !snapshots.some((snapshot) => snapshot.relativePath === relativePath && snapshot.deleted)).sort();

    const checkpointInfo: CheckpointInfo = {
        id: checkpointId,
        description: state.description || (
            isMerge
                ? `Merge ${state.sourceName || state.sourceId} into ${state.targetName || state.targetId}`
                : state.operation === 'revert'
                    ? `Revert "${state.sourceName || state.sourceId}"`
                    : state.sourceName || `Cherry-pick ${state.sourceId}`
        ),
        created: now,
        workspacePath: host.currentWorkspacePath,
        workspaceKey: host.currentWorkspacePath
            ? workspaceStorageKey(host.currentWorkspacePath)
            : undefined,
        fileSnapshots: snapshots,
        fileInventory: inventory,
        captureMode: isMerge ? 'baseline' : 'delta',
        skippedFiles: [],
        tags: state.tags ?? (isMerge
            ? ['merge', state.sourceName || '', state.targetName || '']
            : state.operation === 'revert'
                ? ['revert', state.sourceId]
                : ['cherry-pick', state.sourceId]),
        branchId: state.targetBranchId,
        parentCheckpointId: state.targetHeadId,
        parentCheckpointIds: isMerge && state.sourceHeadId
            ? [state.targetHeadId, state.sourceHeadId]
            : [state.targetHeadId],
        changedPaths: changedPathsFromSnapshots(snapshots),
        ...(state.label ? { label: state.label } : {}),
        ...(state.intent ? { intent: state.intent } : {}),
    };

    if (state.targetBranchId) {
        const branch = host.branches.find((item) => item.id === state.targetBranchId);
        if (branch) {
            branch.headCheckpointId = checkpointId;
            host.activeBranchId = branch.id;
        }
    }
    host.detachedFrom = undefined;
    host.checkpointHistory.push(checkpointInfo);
    await saveCheckpointToDisk(host, checkpointInfo);
    await host.saveCheckpointHistory();
    applySnapshotHashes(host, snapshots);
    host.lastCheckpointTime = Date.now();
    host.fireCheckpointCreated(checkpointId);
    await clearMergeState(host);
    await host.appendAuditEvent({
        action: state.operation === 'revert' ? 'revert' : state.operation === 'cherry_pick' ? 'cherry_pick' : 'branch',
        resourceId: checkpointId,
        outcome: 'success',
        details: { op: 'continue', operation: state.operation },
    }).catch(() => false);
    await host.recordStorageSnapshot().catch(() => false);
    await enforceRetentionPolicies(host);
    log.info(`Continued ${state.operation} as ${checkpointId}`);
    return { success: true, checkpointId, conflicts: [] };
}

export async function mergeAbort(host: CheckpointEngineHost): Promise<{ success: boolean; message?: string }> {
    await host.whenReady();
    const state = await loadMergeState(host);
    if (!state) {
        return { success: true };
    }
    if (state.preMergeCheckpointId) {
        const restored = await restoreCheckpoint(host, state.preMergeCheckpointId, {
            createBackup: false,
            conflictResolution: 'overwrite',
            cleanupExtraFiles: true,
        });
        if (!restored.success) {
            return { success: false, message: restored.failedFiles[0]?.error ?? 'Could not restore the pre-merge tree' };
        }
    }
    if (state.stashId) {
        await stashApply(host, state.stashId);
    }
    await clearMergeState(host);
    await host.appendAuditEvent({
        action: 'branch',
        outcome: 'success',
        details: { op: 'abort', operation: state.operation },
    }).catch(() => false);
    log.info(`Aborted ${state.operation}`);
    return { success: true };
}

export { threeWayMergeHashes, hashStateToSnapshots };
