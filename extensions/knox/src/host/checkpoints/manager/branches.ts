import { createKnoxLogger } from 'core/util/knoxLog';

import { t } from '../../i18n';
import { isAutoStashOnCheckoutEnabled } from '../checkpointSettings';

import { generateCheckpointId } from '../checkpointId';
import { applySnapshotHashes, captureWorkspaceState } from './capture';
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
import { restoreCheckpoint } from './restore';
import { enforceRetentionPolicies } from './retention';
import { applyMergedHashState, beginConflict, inProgressMergeMessage, overlappingDirtyConflicts, resolveContentConflicts } from './mergeState';
import { stashPush } from './stash';
import type {
    BranchCheckoutMode,
    BranchMergeResult,
    CheckpointBranch,
    CheckpointInfo,
    CheckoutCheckpointOptions,
    CheckoutCheckpointResult,
    FileHashState,
    SwitchBranchOptions,
    SwitchBranchResult,
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

function ensureDefaultBranchSync(
    host: CheckpointEngineHost,
    baseCheckpointId: string,
): CheckpointBranch {
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

export function bindCheckpointToActiveLine(
    host: CheckpointEngineHost,
    checkpoint: CheckpointInfo,
): void {
    if (!Array.isArray(host.branches)) {
        host.branches = [];
    }
    if (host.detachedFrom) {
        const parentId = host.detachedFrom.checkpointId;
        if (parentId && parentId !== checkpoint.id) {
            checkpoint.parentCheckpointId = parentId;
        }
        host.detachedFrom = {
            checkpointId: checkpoint.id,
            previousBranchId: host.detachedFrom.previousBranchId,
        };
        return;
    }
    const active = (host.activeBranchId
        ? findBranchById(host.branches, host.activeBranchId)
        : undefined) ?? ensureDefaultBranchSync(host, checkpoint.id);
    const previous = workspaceHistory(host).find((item) => item.id === active.headCheckpointId)
        ?? latestCheckpoint(host);
    if (previous && previous.id !== checkpoint.id) {
        checkpoint.parentCheckpointId = previous.id;
    }
    checkpoint.branchId = active.id;
    active.headCheckpointId = checkpoint.id;
}

export async function ensureDefaultBranch(
    host: CheckpointEngineHost,
    baseCheckpointId: string,
): Promise<CheckpointBranch> {
    return ensureDefaultBranchSync(host, baseCheckpointId);
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
    host.detachedFrom = undefined;
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

/** MC-62: `what-if/<recipe>` (then `-2`, `-3`, ...) so repeated adapt runs never collide. */
export function whatIfBranchName(existing: readonly { name: string }[], recipeId: string): string {
    const stem = `what-if/${recipeId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'recipe'}`;
    const taken = new Set(existing.map((branch) => branch.name));
    if (!taken.has(stem)) {
        return stem;
    }
    let n = 2;
    while (taken.has(`${stem}-${n}`)) {
        n++;
    }
    return `${stem}-${n}`;
}

/**
 * MC-62: before an adapt-mode replay, fork a branch at the pre-replay checkpoint. The replay then
 * lands on that branch, so the user can switch back to the previous line and compare the replay
 * with an LLM-generated result. Never throws: a failed fork means "replay without a branch".
 */
export async function createWhatIfBranch(
    host: CheckpointEngineHost,
    baseCheckpointId: string,
    recipeId: string,
    intent?: string,
): Promise<CheckpointBranch | null> {
    try {
        const name = whatIfBranchName(host.branches ?? [], recipeId);
        const note = intent?.trim() ? `Recipe replay: ${intent.trim().slice(0, 80)}` : 'Recipe replay';
        return await createBranch(host, name, baseCheckpointId, note);
    } catch (error) {
        log.warn('What-if branch not created:', error instanceof Error ? error.message : error);
        return null;
    }
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

async function workspaceDiffersFromHead(host: CheckpointEngineHost): Promise<boolean> {
    if (!host.initialized || !host.currentWorkspacePath) {
        return false;
    }
    const captured = await captureWorkspaceState(host, 'delta');
    return captured.fileSnapshots.length > 0;
}

async function stashDirtyTreeBeforeCheckout(
    host: CheckpointEngineHost,
    options: { autoStash?: boolean; message: string },
): Promise<{ ok: true; stashed: boolean; stashId?: string } | { ok: false; refused: 'dirty' | 'stash_failed'; message: string }> {
    const dirty = await workspaceDiffersFromHead(host);
    if (!dirty) {
        return { ok: true, stashed: false };
    }
    const autoStash = options.autoStash ?? isAutoStashOnCheckoutEnabled();
    if (!autoStash) {
        return {
            ok: false,
            refused: 'dirty',
            message: t('checkpoint.checkout.refusedDirty'),
        };
    }
    const pushed = await stashPush(host, { message: options.message });
    if (!pushed.success) {
        return {
            ok: false,
            refused: 'stash_failed',
            message: pushed.message ?? t('checkpoint.checkout.stashFailed'),
        };
    }
    return { ok: true, stashed: !pushed.empty, stashId: pushed.stashId };
}

async function restoreCheckedOutHead(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<{ ok: true; restoredFiles: string[]; removedFiles: string[] } | { ok: false; message: string }> {
    const restored = await restoreCheckpoint(host, checkpointId, {
        createBackup: false,
        conflictResolution: 'overwrite',
        cleanupExtraFiles: true,
    });
    if (!restored.success) {
        return {
            ok: false,
            message: restored.failedFiles[0]?.error ?? t('checkpoint.checkout.restoreFailed'),
        };
    }
    return {
        ok: true,
        restoredFiles: restored.restoredFiles,
        removedFiles: restored.removedFiles,
    };
}

function pointerOnlySwitchResult(
    branch: CheckpointBranch,
    checkout: BranchCheckoutMode,
): SwitchBranchResult {
    return {
        success: true,
        checkout,
        branchId: branch.id,
        headCheckpointId: branch.headCheckpointId,
    };
}

export async function switchBranch(
    host: CheckpointEngineHost,
    branchId: string,
    options?: SwitchBranchOptions,
): Promise<SwitchBranchResult> {
    const checkout: BranchCheckoutMode = options?.checkout ?? 'none';
    const branch = findBranchById(host.branches, branchId);
    if (!branch) {
        return {
            success: false,
            checkout,
            refused: 'missing',
            message: t('checkpoint.checkout.missingBranch'),
        };
    }

    const alreadyOnBranch = host.activeBranchId === branch.id && !host.detachedFrom;
    if (alreadyOnBranch && checkout === 'none') {
        return pointerOnlySwitchResult(branch, checkout);
    }

    let stashed = false;
    let stashId: string | undefined;
    let restoredFiles: string[] = [];
    let removedFiles: string[] = [];

    if (checkout === 'hard') {
        const parked = await stashDirtyTreeBeforeCheckout(host, {
            autoStash: options?.autoStash,
            message: t('checkpoint.checkout.stashMessage', { name: branch.name }),
        });
        if (!parked.ok) {
            await host.appendAuditEvent({
                action: 'checkout',
                resourceId: branch.id,
                outcome: 'failure',
                error: parked.message,
                details: { op: 'switch', checkout, refused: parked.refused, name: branch.name },
            }).catch(() => false);
            return {
                success: false,
                checkout,
                branchId: branch.id,
                headCheckpointId: branch.headCheckpointId,
                refused: parked.refused,
                message: parked.message,
            };
        }
        stashed = parked.stashed;
        stashId = parked.stashId;

        const restored = await restoreCheckedOutHead(host, branch.headCheckpointId);
        if (!restored.ok) {
            await host.appendAuditEvent({
                action: 'checkout',
                resourceId: branch.id,
                outcome: 'failure',
                error: restored.message,
                details: { op: 'switch', checkout, name: branch.name, stashId },
            }).catch(() => false);
            return {
                success: false,
                checkout,
                branchId: branch.id,
                headCheckpointId: branch.headCheckpointId,
                stashed,
                stashId,
                refused: 'restore_failed',
                message: restored.message,
            };
        }
        restoredFiles = restored.restoredFiles;
        removedFiles = restored.removedFiles;
    }

    host.activeBranchId = branch.id;
    host.detachedFrom = undefined;
    await host.saveCheckpointHistory();
    await rebuildSnapshotHashIndexFromDisk(host);
    await host.appendAuditEvent({
        action: checkout === 'hard' ? 'checkout' : 'branch',
        resourceId: branch.id,
        outcome: 'success',
        details: {
            op: 'switch',
            checkout,
            name: branch.name,
            headCheckpointId: branch.headCheckpointId,
            ...(stashId ? { stashId } : {}),
        },
    }).catch(() => false);
    log.info(
        checkout === 'hard'
            ? `Checked out checkpoint branch ${branch.name} (head ${branch.headCheckpointId})`
            : `Switched checkpoint branch to ${branch.name} (head ${branch.headCheckpointId})`,
    );
    return {
        success: true,
        checkout,
        branchId: branch.id,
        headCheckpointId: branch.headCheckpointId,
        stashed,
        stashId,
        restoredFiles,
        removedFiles,
    };
}

export async function checkoutCheckpoint(
    host: CheckpointEngineHost,
    checkpointId: string,
    options?: CheckoutCheckpointOptions,
): Promise<CheckoutCheckpointResult> {
    const checkpoint = workspaceHistory(host).find((item) => item.id === checkpointId)
        ?? host.checkpointHistory.find((item) => item.id === checkpointId);
    if (!checkpoint) {
        return {
            success: false,
            checkout: 'hard',
            refused: 'missing',
            message: t('checkpoint.checkout.missingCheckpoint'),
        };
    }

    const owningBranch = (host.branches ?? []).find(
        (branch) => branch.headCheckpointId === checkpointId,
    );
    if (owningBranch) {
        const switched = await switchBranch(host, owningBranch.id, {
            checkout: 'hard',
            autoStash: options?.autoStash,
        });
        return {
            ...switched,
            checkpointId,
            detached: false,
        };
    }

    const parked = await stashDirtyTreeBeforeCheckout(host, {
        autoStash: options?.autoStash,
        message: t('checkpoint.checkout.stashMessageDetached', { id: checkpointId.slice(0, 11) }),
    });
    if (!parked.ok) {
        await host.appendAuditEvent({
            action: 'checkout',
            resourceId: checkpointId,
            outcome: 'failure',
            error: parked.message,
            details: { op: 'detached', refused: parked.refused },
        }).catch(() => false);
        return {
            success: false,
            checkout: 'hard',
            checkpointId,
            refused: parked.refused,
            message: parked.message,
        };
    }

    const restored = await restoreCheckedOutHead(host, checkpointId);
    if (!restored.ok) {
        await host.appendAuditEvent({
            action: 'checkout',
            resourceId: checkpointId,
            outcome: 'failure',
            error: restored.message,
            details: { op: 'detached', stashId: parked.stashId },
        }).catch(() => false);
        return {
            success: false,
            checkout: 'hard',
            checkpointId,
            stashed: parked.stashed,
            stashId: parked.stashId,
            refused: 'restore_failed',
            message: restored.message,
        };
    }

    host.detachedFrom = {
        checkpointId,
        previousBranchId: host.activeBranchId,
    };
    await host.saveCheckpointHistory();
    await rebuildSnapshotHashIndexFromDisk(host);
    await host.appendAuditEvent({
        action: 'checkout',
        resourceId: checkpointId,
        outcome: 'success',
        details: {
            op: 'detached',
            previousBranchId: host.detachedFrom.previousBranchId,
            ...(parked.stashId ? { stashId: parked.stashId } : {}),
        },
    }).catch(() => false);
    log.info(`Checked out checkpoint ${checkpointId} (detached)`);
    return {
        success: true,
        checkout: 'hard',
        checkpointId,
        detached: true,
        branchId: host.activeBranchId,
        headCheckpointId: checkpointId,
        stashed: parked.stashed,
        stashId: parked.stashId,
        restoredFiles: restored.restoredFiles,
        removedFiles: restored.removedFiles,
    };
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

export async function renameBranch(
    host: CheckpointEngineHost,
    branchId: string,
    name: string,
): Promise<void> {
    const branch = findBranchById(host.branches, branchId);
    if (!branch) {
        throw new Error(t('checkpoint.graph.branchMissing'));
    }
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error(t('checkpoint.graph.branchNameRequired'));
    }
    const existing = findBranchByName(host.branches ?? [], trimmed);
    if (existing && existing.id !== branch.id) {
        throw new Error(t('checkpoint.graph.branchExists'));
    }
    branch.name = trimmed;
    await host.saveCheckpointHistory();
    await host.appendAuditEvent({
        action: 'branch',
        resourceId: branch.id,
        outcome: 'success',
        details: { op: 'rename', name: trimmed },
    }).catch(() => false);
    log.info(`Renamed checkpoint branch ${branch.id} to ${trimmed}`);
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
    const busy = await inProgressMergeMessage(host);
    if (busy) {
        return { success: false, conflicts: [], message: busy };
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

    const hashed = threeWayMergeHashes(baseState, sourceState, targetState);
    const content = await resolveContentConflicts(host, hashed.conflicts, targetState, sourceState);
    const merged = new Map(hashed.merged);
    for (const [relativePath, state] of content.merged) {
        merged.set(relativePath, state);
    }
    const conflicts = content.remaining;
    const dirty = await overlappingDirtyConflicts(host, targetState, merged, sourceState);
    if (dirty.length > 0) {
        await host.appendAuditEvent({
            action: 'branch',
            resourceId: target.id,
            outcome: 'failure',
            error: `dirty: ${dirty.map((conflict) => conflict.path).join(', ')}`,
            details: { op: 'merge', sourceBranchId, targetBranchId, dirty: true },
        }).catch(() => false);
        return {
            success: false,
            conflicts: dirty.map((conflict) => ({ path: conflict.path })),
            message: 'Working tree has overlapping uncheckpointed changes',
        };
    }
    if (conflicts.length > 0) {
        await beginConflict(host, {
            operation: 'merge',
            sourceId: source.id,
            targetId: target.id,
            sourceHeadId: source.headCheckpointId,
            targetHeadId: target.headCheckpointId,
            targetBranchId: target.id,
            lcaId,
            conflictPaths: conflicts.map((conflict) => conflict.path),
            preMergeCheckpointId: target.headCheckpointId,
            sourceName: source.name,
            targetName: target.name,
            oursLabel: target.name,
            theirsLabel: source.name,
        }, targetState, sourceState, merged, conflicts);
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
                mergeInProgress: true,
            },
        }).catch(() => false);
        return { success: false, conflicts, mergeInProgress: true };
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
        parentCheckpointIds: [target.headCheckpointId, source.headCheckpointId],
        changedPaths: changedPathsFromSnapshots(snapshots),
    };

    await applyMergedHashState(host, targetState, merged);
    host.checkpointHistory.push(checkpointInfo);
    target.headCheckpointId = checkpointId;
    host.activeBranchId = target.id;
    host.detachedFrom = undefined;
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
