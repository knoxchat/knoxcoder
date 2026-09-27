import { checkpointSessionId, isListableCheckpoint, searchablePaths } from './listQuery';
import {
    CHECKPOINT_TIMELINE_LIMIT,
    TIMELINE_BRANCH_COLORS,
    classifyCheckpointKind,
    type CheckpointTimelineKind,
} from './timeline';
import type { CheckpointBranch, CheckpointInfo } from './types';

export interface CheckpointGraphFileChanges {
    added: number;
    modified: number;
    deleted: number;
}

export interface CheckpointGraphNode {
    id: string;
    description: string;
    /** ISO-8601. */
    created: string;
    kind: CheckpointTimelineKind;
    branchId?: string;
    /** From `parentCheckpointIds` when stored, otherwise `parentCheckpointId`. */
    parents: string[];
    tags: string[];
    fileChanges: CheckpointGraphFileChanges;
    /** Relative paths only, capped. Never file bytes. */
    changedPaths: string[];
    sessionId?: string;
    /** `cp_` plus the next 8 characters of the id. */
    shortId: string;
    pinned: boolean;
}

export interface CheckpointGraphBranch {
    id: string;
    name: string;
    headCheckpointId: string;
    baseCheckpointId: string;
    color: string;
    isActive: boolean;
}

export interface CheckpointGraphPayload {
    nodes: CheckpointGraphNode[];
    branches: CheckpointGraphBranch[];
    /** Active branch head, or null when there is no active branch. */
    headCheckpointId: string | null;
    /** True when the limit cut off older checkpoints. */
    hasMore: boolean;
}

export interface CheckpointGraphQuery {
    history: CheckpointInfo[];
    branches: CheckpointBranch[];
    activeBranchId?: string;
    limit?: number;
    /**
     * Omitted: every checkpoint. An array: a checkpoint is included if its
     * `branchId` is selected or it is the `baseCheckpointId` of a selected
     * branch (the fork point stays on the page). An empty array selects
     * nothing. The branch catalog is not filtered, so colors stay tied to
     * the full branch list.
     */
    branchIds?: string[];
}

function createdIso(created: Date | string): string {
    if (created instanceof Date) {
        return created.toISOString();
    }
    return new Date(created).toISOString();
}

function createdMillis(created: Date | string): number {
    const time = created instanceof Date ? created.getTime() : new Date(created).getTime();
    return Number.isFinite(time) ? time : 0;
}

/** Display id: `cp_` plus 8 characters. Ids that already start with `cp_` keep that prefix. */
export function checkpointGraphShortId(id: string): string {
    if (id.startsWith('cp_')) {
        return `cp_${id.slice('cp_'.length, 'cp_'.length + 8)}`;
    }
    return id.slice(0, 8);
}

function graphLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return CHECKPOINT_TIMELINE_LIMIT;
    }
    const size = Math.trunc(limit);
    if (size <= 0) {
        return 0;
    }
    return Math.min(size, CHECKPOINT_TIMELINE_LIMIT);
}

function selectedBranchIds(branchIds: string[] | undefined): Set<string> | undefined {
    if (!branchIds) {
        return undefined;
    }
    return new Set(branchIds.map((id) => id.trim()).filter((id) => id.length > 0));
}

/**
 * Lean graph payload. File snapshots and file bytes are never copied.
 * Changed paths and the session id are copied so row details render inline.
 * Nodes are newest-first (`created` descending, then `id` ascending).
 */
export function buildCheckpointGraph(input: CheckpointGraphQuery): CheckpointGraphPayload {
    const limit = graphLimit(input.limit);
    const selected = selectedBranchIds(input.branchIds);
    const forkBases = new Set<string>();
    if (selected) {
        for (const branch of input.branches) {
            if (!selected.has(branch.id)) {
                continue;
            }
            const base = branch.baseCheckpointId?.trim();
            if (base) {
                forkBases.add(base);
            }
        }
    }

    const listable = input.history
        .filter((checkpoint) => isListableCheckpoint(checkpoint))
        .filter((checkpoint) => {
            if (!selected) {
                return true;
            }
            if (checkpoint.branchId && selected.has(checkpoint.branchId)) {
                return true;
            }
            return forkBases.has(checkpoint.id);
        })
        .sort((a, b) => {
            const byTime = createdMillis(b.created) - createdMillis(a.created);
            if (byTime !== 0) {
                return byTime;
            }
            if (a.id < b.id) {
                return -1;
            }
            if (a.id > b.id) {
                return 1;
            }
            return 0;
        });
    const page = listable.slice(0, limit);

    const active = input.activeBranchId
        ? input.branches.find((branch) => branch.id === input.activeBranchId)
        : undefined;
    const head = active?.headCheckpointId?.trim();

    return {
        nodes: page.map((checkpoint) => {
            const stats = checkpoint.fileStats;
            const sessionId = checkpointSessionId(checkpoint);
            return {
                id: checkpoint.id,
                description: checkpoint.description ?? '',
                created: createdIso(checkpoint.created),
                kind: classifyCheckpointKind(checkpoint, input.branches),
                branchId: checkpoint.branchId,
                parents: graphParents(checkpoint),
                tags: [...(checkpoint.tags ?? [])],
                fileChanges: {
                    added: stats?.created ?? 0,
                    modified: stats?.modified ?? 0,
                    deleted: stats?.deleted ?? 0,
                },
                changedPaths: searchablePaths(checkpoint),
                sessionId,
                shortId: checkpointGraphShortId(checkpoint.id),
                pinned: checkpoint.pinned === true,
            };
        }),
        branches: input.branches.map((branch, index) => ({
            id: branch.id,
            name: branch.name,
            headCheckpointId: branch.headCheckpointId,
            baseCheckpointId: branch.baseCheckpointId,
            color: TIMELINE_BRANCH_COLORS[index % TIMELINE_BRANCH_COLORS.length],
            isActive: branch.id === input.activeBranchId,
        })),
        headCheckpointId: head ? head : null,
        hasMore: listable.length > page.length,
    };
}

function graphParents(checkpoint: CheckpointInfo): string[] {
    const stored = checkpoint.parentCheckpointIds
        ?.map((id) => id.trim())
        .filter((id) => id.length > 0);
    if (stored && stored.length > 0) {
        return stored;
    }
    const parent = checkpoint.parentCheckpointId?.trim();
    return parent ? [parent] : [];
}
