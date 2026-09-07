import { createKnoxLogger } from 'core/util/knoxLog';

import { generateCheckpointId } from '../checkpointId';
import { applySnapshotHashes } from './capture';
import {
    DEFAULT_BRANCH_NAME,
    defaultBranch,
    findBranchById,
    findBranchByName,
    generateBranchId,
    hashStateToSnapshots,
    lineageCheckpoints,
    lowestCommonAncestorId,
    replayHashState,
    threeWayMergeHashes,
} from './branchLogic';
import { changedPathsFromSnapshots } from './listQuery';
import type { CheckpointEngineHost } from './host';
import {
    initializeStorageDirectories,
    readCheckpointRecord,
    rebuildSnapshotHashIndexFromDisk,
    saveCheckpointToDisk,
} from './persistence';
import { enforceRetentionPolicies } from './retention';
import type {
    BranchMergeResult,
    CheckpointBranch,
    CheckpointInfo,
    FileHashState,
} from './types';
import { getCheckpointHistoryForWorkspace, workspaceStorageKey } from './workspace';

const log = createKnoxLogger('Checkpoints');

function workspaceHistory(host: CheckpointEngineHost): CheckpointInfo[] {
    return getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    );
}

function latestCheckpoint(host: CheckpointEngineHost): CheckpointInfo | undefined {
    const history = workspaceHistory(host).sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
    );
    return history[history.length - 1];
}

export function bindCheckpointToActiveLine(
    host: CheckpointEngineHost,
    checkpoint: CheckpointInfo,
): void {
    if (!Array.isArray(host.branches)) {
        host.branches = [];
    }
    const active = host.activeBranchId
        ? findBranchById(host.branches, host.activeBranchId)
        : undefined;
    const previous = active
        ? workspaceHistory(host).find((item) => item.id === active.headCheckpointId)
        : latestCheckpoint(host);
    if (previous && previous.id !== checkpoint.id) {
        checkpoint.parentCheckpointId = previous.id;
    }
    if (active) {
        checkpoint.branchId = active.id;
        active.headCheckpointId = checkpoint.id;
    }
}

export async function ensureDefaultBranch(
    host: CheckpointEngineHost,
    baseCheckpointId: string,
): Promise<CheckpointBranch> {
    if (!Array.isArray(host.branches)) {
        host.branches = [];
    }
    const existing = defaultBranch(host.branches);
    if (existing) {
        if (!host.activeBranchId) {
            host.activeBranchId = existing.id;
        }
        return existing;
    }

    const history = workspaceHistory(host);
    const oldest = history[0];
    const latest = history[history.length - 1];
    const headId = latest?.id ?? baseCheckpointId;
    const baseId = oldest?.id ?? baseCheckpointId;
    const main: CheckpointBranch = {
        id: generateBranchId(),
        name: DEFAULT_BRANCH_NAME,
        headCheckpointId: headId,
        baseCheckpointId: baseId,
        createdAt: oldest?.created ?? new Date(),
        description: 'Default checkpoint line',
    };
    host.branches.push(main);
    host.activeBranchId = main.id;
    return main;
}

export async function createBranch(
    host: CheckpointEngineHost,
    name: string,
    baseCheckpointId: string,
    description: string = '',
): Promise<CheckpointBranch | null> {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('Branch name is required');
    }
    if (!host.initialized || !host.currentWorkspacePath) {
        return null;
    }
    const base = workspaceHistory(host).find((checkpoint) => checkpoint.id === baseCheckpointId)
        ?? host.checkpointHistory.find((checkpoint) => checkpoint.id === baseCheckpointId);
    if (!base) {
        throw new Error(`Checkpoint ${baseCheckpointId} not found`);
    }
    if (findBranchByName(host.branches, trimmed)) {
        throw new Error(`Branch "${trimmed}" already exists`);
    }

    const parent = await ensureDefaultBranch(host, baseCheckpointId);
    const branch: CheckpointBranch = {
        id: generateBranchId(),
        name: trimmed,
        headCheckpointId: baseCheckpointId,
        baseCheckpointId,
        parentBranchId: (host.activeBranchId && host.activeBranchId !== parent.id)
            ? host.activeBranchId
            : parent.id,
        createdAt: new Date(),
        description: description.trim() || undefined,
    };
    host.branches.push(branch);
    host.activeBranchId = branch.id;
    await host.saveCheckpointHistory();
    await rebuildSnapshotHashIndexFromDisk(host);
    await host.appendAuditEvent({
        action: 'branch',
        resourceId: branch.id,
        outcome: 'success',
        details: {
            op: 'create',
            name: branch.name,
            baseCheckpointId,
            parentBranchId: branch.parentBranchId,
        },
    }).catch(() => false);
    log.info(`Created checkpoint branch ${branch.name} (${branch.id}) from ${baseCheckpointId}`);
    return branch;
}

export async function listBranches(host: CheckpointEngineHost): Promise<CheckpointBranch[]> {
    return [...(host.branches ?? [])];
}

export function getActiveBranch(host: CheckpointEngineHost): CheckpointBranch | undefined {
    if (!host.activeBranchId) {
        return defaultBranch(host.branches);
    }
    return findBranchById(host.branches, host.activeBranchId) ?? defaultBranch(host.branches);
}

export async function switchBranch(
    host: CheckpointEngineHost,
    branchId: string,
): Promise<boolean> {
    const branch = findBranchById(host.branches, branchId);
    if (!branch) {
        return false;
    }
    host.activeBranchId = branch.id;
    await host.saveCheckpointHistory();
    await rebuildSnapshotHashIndexFromDisk(host);
    await host.appendAuditEvent({
        action: 'branch',
        resourceId: branch.id,
        outcome: 'success',
        details: { op: 'switch', name: branch.name, headCheckpointId: branch.headCheckpointId },
    }).catch(() => false);
    log.info(`Switched checkpoint branch to ${branch.name} (head ${branch.headCheckpointId})`);
    return true;
}

export async function deleteBranch(
    host: CheckpointEngineHost,
    branchId: string,
): Promise<boolean> {
    const branch = findBranchById(host.branches, branchId);
    if (!branch) {
        return false;
    }
    if (branch.id === host.activeBranchId) {
        throw new Error('Cannot delete the current branch');
    }
    const main = defaultBranch(host.branches);
    if (main && branch.id === main.id) {
        throw new Error('Cannot delete the default main branch');
    }
    const uniqueHeads = branch.headCheckpointId !== branch.baseCheckpointId;
    if (uniqueHeads) {
        throw new Error('Cannot delete a branch that has checkpoints after the fork');
    }
    host.branches = host.branches.filter((item) => item.id !== branchId);
    await host.saveCheckpointHistory();
    await host.appendAuditEvent({
        action: 'branch',
        resourceId: branch.id,
        outcome: 'success',
        details: { op: 'delete', name: branch.name },
    }).catch(() => false);
    return true;
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
    const loaded: Array<{ fileSnapshots?: CheckpointInfo['fileSnapshots'] }> = [];
    for (const checkpoint of chain) {
        const result = await readCheckpointRecord(host, checkpoint.id);
        if (result.status !== 'ok') {
            return null;
        }
        loaded.push({ fileSnapshots: result.checkpoint.fileSnapshots });
    }
    return replayHashState(loaded);
}

export async function mergeBranches(
    host: CheckpointEngineHost,
    sourceBranchId: string,
    targetBranchId: string,
    _strategy: string = 'ThreeWay',
): Promise<BranchMergeResult> {
    const source = findBranchById(host.branches, sourceBranchId);
    const target = findBranchById(host.branches, targetBranchId);
    if (!source || !target) {
        return { success: false, conflicts: [] };
    }
    if (source.id === target.id) {
        return { success: true, conflicts: [] };
    }

    const history = workspaceHistory(host);
    const lcaId = lowestCommonAncestorId(history, source.headCheckpointId, target.headCheckpointId);
    if (!lcaId) {
        return {
            success: false,
            conflicts: [{ path: '*', sourceHash: source.headCheckpointId, targetHash: target.headCheckpointId }],
        };
    }

    const [baseState, sourceState, targetState] = await Promise.all([
        hashStateAtCheckpoint(host, lcaId),
        hashStateAtCheckpoint(host, source.headCheckpointId),
        hashStateAtCheckpoint(host, target.headCheckpointId),
    ]);
    if (!baseState || !sourceState || !targetState) {
        return { success: false, conflicts: [] };
    }

    const { merged, conflicts } = threeWayMergeHashes(baseState, sourceState, targetState);
    if (conflicts.length > 0) {
        await host.appendAuditEvent({
            action: 'branch',
            resourceId: target.id,
            outcome: 'failure',
            error: `merge conflicts: ${conflicts.map((conflict) => conflict.path).join(', ')}`,
            details: {
                op: 'merge',
                sourceBranchId,
                targetBranchId,
                conflictCount: conflicts.length,
            },
        }).catch(() => false);
        return { success: false, conflicts };
    }

    const unionPaths = new Set<string>([
        ...baseState.keys(),
        ...sourceState.keys(),
        ...targetState.keys(),
    ]);
    const { snapshots, inventory } = hashStateToSnapshots(merged, unionPaths);
    const identicalToTarget =
        snapshots.filter((snapshot) => !snapshot.deleted).length === targetState.size
        && snapshots.every((snapshot) => {
            if (snapshot.deleted) {
                return !targetState.has(snapshot.relativePath);
            }
            return targetState.get(snapshot.relativePath)?.hash === snapshot.hash;
        });
    if (identicalToTarget) {
        return { success: true, conflicts: [] };
    }

    await initializeStorageDirectories(host);
    const checkpointId = generateCheckpointId();
    const checkpointInfo: CheckpointInfo = {
        id: checkpointId,
        description: `Merge ${source.name} into ${target.name}`,
        created: new Date(),
        workspacePath: host.currentWorkspacePath,
        workspaceKey: host.currentWorkspacePath
            ? workspaceStorageKey(host.currentWorkspacePath)
            : undefined,
        fileSnapshots: snapshots,
        fileInventory: inventory,
        captureMode: 'baseline',
        skippedFiles: [],
        tags: ['merge', source.name, target.name],
        branchId: target.id,
        parentCheckpointId: target.headCheckpointId,
        changedPaths: changedPathsFromSnapshots(snapshots),
    };

    host.checkpointHistory.push(checkpointInfo);
    target.headCheckpointId = checkpointId;
    host.activeBranchId = target.id;
    await saveCheckpointToDisk(host, checkpointInfo);
    await host.saveCheckpointHistory();
    applySnapshotHashes(host, snapshots);
    host.lastCheckpointTime = Date.now();
    host.fireCheckpointCreated(checkpointId);
    await host.appendAuditEvent({
        action: 'branch',
        resourceId: checkpointId,
        outcome: 'success',
        details: {
            op: 'merge',
            sourceBranchId,
            targetBranchId,
            mergeCheckpointId: checkpointId,
        },
    }).catch(() => false);
    await host.recordStorageSnapshot().catch(() => false);
    await enforceRetentionPolicies(host);
    log.info(`Merged branch ${source.name} into ${target.name} as ${checkpointId}`);
    return { success: true, mergeCheckpointId: checkpointId, conflicts: [] };
}
