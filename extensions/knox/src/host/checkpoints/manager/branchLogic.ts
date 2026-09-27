import { randomUUID } from 'node:crypto';

import type {
    BranchMergeConflict,
    CheckpointBranch,
    CheckpointInfo,
    FileHashState,
    FileSnapshot,
} from './types';

export const DEFAULT_BRANCH_NAME = 'main';
export const BRANCH_ID_PREFIX = 'br_';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateBranchId(): string {
    return `${BRANCH_ID_PREFIX}${randomUUID()}`;
}

export function isBranchId(value: string): boolean {
    if (typeof value !== 'string' || !value.startsWith(BRANCH_ID_PREFIX)) {
        return false;
    }
    return UUID_RE.test(value.slice(BRANCH_ID_PREFIX.length));
}

export function serializeBranch(branch: CheckpointBranch) {
    return {
        id: branch.id,
        name: branch.name,
        headCheckpointId: branch.headCheckpointId,
        baseCheckpointId: branch.baseCheckpointId,
        parentBranchId: branch.parentBranchId,
        createdAt: branch.createdAt instanceof Date
            ? branch.createdAt.toISOString()
            : branch.createdAt,
        description: branch.description,
    };
}

export function parseBranch(value: unknown): CheckpointBranch | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim()) {
        return null;
    }
    if (typeof record.name !== 'string' || !record.name.trim()) {
        return null;
    }
    if (typeof record.headCheckpointId !== 'string' || !record.headCheckpointId.trim()) {
        return null;
    }
    if (typeof record.baseCheckpointId !== 'string' || !record.baseCheckpointId.trim()) {
        return null;
    }
    const createdAt = record.createdAt instanceof Date
        ? record.createdAt
        : new Date(typeof record.createdAt === 'string' || typeof record.createdAt === 'number'
            ? record.createdAt
            : Date.now());
    if (Number.isNaN(createdAt.getTime())) {
        return null;
    }
    return {
        id: record.id,
        name: record.name.trim(),
        headCheckpointId: record.headCheckpointId,
        baseCheckpointId: record.baseCheckpointId,
        parentBranchId: typeof record.parentBranchId === 'string' && record.parentBranchId.trim()
            ? record.parentBranchId
            : undefined,
        createdAt,
        description: typeof record.description === 'string' ? record.description : undefined,
    };
}

export function parseBranches(value: unknown): CheckpointBranch[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(parseBranch)
        .filter((branch): branch is CheckpointBranch => branch !== null);
}

export function defaultBranch(branches: CheckpointBranch[]): CheckpointBranch | undefined {
    return branches.find((branch) => branch.name === DEFAULT_BRANCH_NAME && !branch.parentBranchId)
        ?? branches.find((branch) => !branch.parentBranchId)
        ?? branches[0];
}

export function sortCheckpointsByCreated(a: CheckpointInfo, b: CheckpointInfo): number {
    const delta = a.created.getTime() - b.created.getTime();
    if (delta !== 0) {
        return delta;
    }
    return a.id.localeCompare(b.id);
}

export function chronologicalUpTo(
    history: CheckpointInfo[],
    targetId: string,
): CheckpointInfo[] | null {
    const sorted = [...history].sort(sortCheckpointsByCreated);
    const index = sorted.findIndex((checkpoint) => checkpoint.id === targetId);
    if (index === -1) {
        return null;
    }
    return sorted.slice(0, index + 1);
}

/**
 * Replay chain for a checkpoint. Prefers parentCheckpointId links so a feature
 * line does not pick up later commits from a sibling branch. Legacy checkpoints
 * without parents fall back to chronological history up to the target.
 */
export function lineageCheckpoints(
    history: CheckpointInfo[],
    targetId: string,
): CheckpointInfo[] | null {
    const byId = new Map(history.map((checkpoint) => [checkpoint.id, checkpoint]));
    const target = byId.get(targetId);
    if (!target) {
        return null;
    }

    if (!target.parentCheckpointId) {
        return chronologicalUpTo(history, targetId);
    }

    const chain: CheckpointInfo[] = [];
    const seen = new Set<string>();
    let cursor: CheckpointInfo | undefined = target;
    while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        chain.unshift(cursor);
        const parentId = cursor.parentCheckpointId;
        if (!parentId) {
            break;
        }
        cursor = byId.get(parentId);
        if (!cursor && parentId) {
            break;
        }
    }

    const root = chain[0];
    if (root && !root.parentCheckpointId) {
        const prefix = chronologicalUpTo(history, root.id) ?? [];
        const prefixWithoutRoot = prefix.filter((checkpoint) => checkpoint.id !== root.id);
        return [...prefixWithoutRoot, ...chain];
    }
    return chain;
}

export function lowestCommonAncestorId(
    history: CheckpointInfo[],
    sourceId: string,
    targetId: string,
): string | undefined {
    const sourceLine = lineageCheckpoints(history, sourceId);
    if (!sourceLine) {
        return undefined;
    }
    const sourceAncestors = new Set(sourceLine.map((checkpoint) => checkpoint.id));
    const targetLine = lineageCheckpoints(history, targetId);
    if (!targetLine) {
        return undefined;
    }
    for (let index = targetLine.length - 1; index >= 0; index--) {
        const id = targetLine[index].id;
        if (sourceAncestors.has(id)) {
            return id;
        }
    }
    return undefined;
}

export function snapshotToHashState(snapshot: FileSnapshot): FileHashState {
    const deleted = snapshot.deleted === true || snapshot.changeType === 'deleted';
    return {
        hash: deleted ? undefined : snapshot.hash,
        encoding: snapshot.encoding || 'utf8',
        size: deleted ? 0 : snapshot.size,
        deleted,
    };
}

export function replayHashState(
    checkpoints: Array<{ fileSnapshots?: FileSnapshot[] }>,
): Map<string, FileHashState> {
    const state = new Map<string, FileHashState>();
    for (const checkpoint of checkpoints) {
        for (const snapshot of checkpoint.fileSnapshots ?? []) {
            const relativePath = snapshot.relativePath;
            if (!relativePath) {
                continue;
            }
            const next = snapshotToHashState(snapshot);
            if (next.deleted) {
                state.delete(relativePath);
            } else {
                state.set(relativePath, next);
            }
        }
    }
    return state;
}

export function hashKey(state: FileHashState | undefined): string {
    if (!state || state.deleted || !state.hash) {
        return '';
    }
    return state.hash;
}

/**
 * Three-way merge on content hashes. Equal hashes auto-resolve; both sides
 * changing a path to different hashes is a conflict (never silently overwrite).
 */
export function threeWayMergeHashes(
    base: Map<string, FileHashState>,
    source: Map<string, FileHashState>,
    target: Map<string, FileHashState>,
): { merged: Map<string, FileHashState>; conflicts: BranchMergeConflict[] } {
    const paths = new Set<string>([...base.keys(), ...source.keys(), ...target.keys()]);
    const merged = new Map<string, FileHashState>();
    const conflicts: BranchMergeConflict[] = [];

    for (const relativePath of [...paths].sort()) {
        const baseState = base.get(relativePath);
        const sourceState = source.get(relativePath);
        const targetState = target.get(relativePath);
        const baseHash = hashKey(baseState);
        const sourceHash = hashKey(sourceState);
        const targetHash = hashKey(targetState);

        if (sourceHash === targetHash) {
            if (targetState && !targetState.deleted && targetHash) {
                merged.set(relativePath, targetState);
            } else if (sourceState && !sourceState.deleted && sourceHash) {
                merged.set(relativePath, sourceState);
            }
            continue;
        }

        if (sourceHash === baseHash) {
            if (targetState && !targetState.deleted && targetHash) {
                merged.set(relativePath, targetState);
            }
            continue;
        }

        if (targetHash === baseHash) {
            if (sourceState && !sourceState.deleted && sourceHash) {
                merged.set(relativePath, sourceState);
            }
            continue;
        }

        conflicts.push({
            path: relativePath,
            baseHash: baseHash || undefined,
            sourceHash: sourceHash || undefined,
            targetHash: targetHash || undefined,
        });
    }

    return { merged, conflicts };
}

export function hashStateToSnapshots(
    merged: Map<string, FileHashState>,
    unionPaths: Iterable<string>,
): { snapshots: FileSnapshot[]; inventory: string[] } {
    const now = new Date();
    const snapshots: FileSnapshot[] = [];
    const inventory: string[] = [];
    const live = new Set(merged.keys());

    for (const relativePath of [...live].sort()) {
        const state = merged.get(relativePath);
        if (!state || state.deleted || !state.hash) {
            continue;
        }
        inventory.push(relativePath);
        snapshots.push({
            relativePath,
            hash: state.hash,
            encoding: state.encoding,
            lastModified: now,
            size: state.size,
            changeType: 'modified',
        });
    }

    for (const relativePath of [...new Set(unionPaths)].sort()) {
        if (live.has(relativePath)) {
            continue;
        }
        snapshots.push({
            relativePath,
            encoding: 'utf8',
            lastModified: now,
            size: 0,
            deleted: true,
            changeType: 'deleted',
        });
    }

    return { snapshots, inventory };
}

export function findBranchById(
    branches: CheckpointBranch[],
    branchId: string,
): CheckpointBranch | undefined {
    return branches.find((branch) => branch.id === branchId);
}

export function findBranchByName(
    branches: CheckpointBranch[],
    name: string,
): CheckpointBranch | undefined {
    const needle = name.trim().toLowerCase();
    return branches.find((branch) => branch.name.trim().toLowerCase() === needle);
}

/** Recover named lines from manifests when the index was lost (parent links stay on CPs). */
export function synthesizeBranchesFromHistory(history: CheckpointInfo[]): CheckpointBranch[] {
    const byBranch = new Map<string, CheckpointInfo[]>();
    for (const checkpoint of history) {
        if (!checkpoint.branchId) {
            continue;
        }
        const list = byBranch.get(checkpoint.branchId) ?? [];
        list.push(checkpoint);
        byBranch.set(checkpoint.branchId, list);
    }
    if (byBranch.size === 0) {
        return [];
    }
    const branches: CheckpointBranch[] = [];
    for (const [id, checkpoints] of byBranch) {
        const ordered = [...checkpoints].sort(sortCheckpointsByCreated);
        const oldest = ordered[0];
        const newest = ordered[ordered.length - 1];
        branches.push({
            id,
            name: id,
            headCheckpointId: newest.id,
            baseCheckpointId: oldest.parentCheckpointId ?? oldest.id,
            createdAt: oldest.created instanceof Date ? oldest.created : new Date(oldest.created),
        });
    }
    return branches;
}
