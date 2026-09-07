import { isListableCheckpoint } from './listQuery';
import type { CheckpointBranch, CheckpointInfo } from './types';

export const CHECKPOINT_TIMELINE_LIMIT = 500;

export type CheckpointTimelineKind =
    | 'manual'
    | 'auto'
    | 'ai'
    | 'merge'
    | 'branch-point';

export const TIMELINE_BRANCH_COLORS = [
    '#61afef',
    '#98c379',
    '#e5c07b',
    '#e06c75',
    '#c678dd',
    '#56b6c2',
    '#d19a66',
    '#abb2bf',
];

export interface CheckpointTimelineItemDto {
    id: string;
    description: string;
    created: string;
    type: CheckpointTimelineKind;
    branchId?: string;
    parentId?: string;
    tags: string[];
    fileChanges?: {
        added: number;
        modified: number;
        deleted: number;
    };
    metadata?: {
        messageContent?: string;
        role?: string;
    };
    isIncremental: boolean;
}

export interface TimelineBranchDto {
    id: string;
    name: string;
    color: string;
    baseCheckpointId: string;
    checkpoints: string[];
    isActive: boolean;
}

export interface CheckpointTimelineDto {
    checkpoints: CheckpointTimelineItemDto[];
    branches: TimelineBranchDto[];
    activeBranchId?: string;
}

export function classifyCheckpointKind(
    checkpoint: Pick<CheckpointInfo, 'id' | 'tags' | 'conversationContext' | 'messageId' | 'description'>,
    branches: Array<Pick<CheckpointBranch, 'baseCheckpointId' | 'parentBranchId'>>,
): CheckpointTimelineKind {
    const tags = (checkpoint.tags ?? []).map((tag) => tag.toLowerCase());
    if (tags.includes('merge')) {
        return 'merge';
    }
    const role = checkpoint.conversationContext?.role;
    if (role === 'agent-turn' || role === 'assistant') {
        return 'ai';
    }
    if (checkpoint.messageId?.startsWith('auto-') || checkpoint.description?.startsWith('Auto:')) {
        return 'auto';
    }
    const isForkBase = branches.some(
        (branch) => branch.baseCheckpointId === checkpoint.id && Boolean(branch.parentBranchId),
    );
    if (isForkBase) {
        return 'branch-point';
    }
    return 'manual';
}

function createdIso(created: Date | string): string {
    if (created instanceof Date) {
        return created.toISOString();
    }
    return new Date(created).toISOString();
}

/**
 * Lean timeline payload for the GUI. Checkpoints are assigned to a branch
 * only when `branchId` matches — never dumped onto a default "main" line.
 */
export function buildCheckpointTimeline(input: {
    history: CheckpointInfo[];
    branches: CheckpointBranch[];
    activeBranchId?: string;
    limit?: number;
}): CheckpointTimelineDto {
    const limit = input.limit ?? CHECKPOINT_TIMELINE_LIMIT;
    const listable = input.history
        .filter((checkpoint) => isListableCheckpoint(checkpoint))
        .sort((a, b) => b.created.getTime() - a.created.getTime())
        .slice(0, limit);

    const branches: TimelineBranchDto[] = input.branches.map((branch, index) => ({
        id: branch.id,
        name: branch.name,
        color: TIMELINE_BRANCH_COLORS[index % TIMELINE_BRANCH_COLORS.length],
        baseCheckpointId: branch.baseCheckpointId,
        checkpoints: listable
            .filter((checkpoint) => checkpoint.branchId === branch.id)
            .map((checkpoint) => checkpoint.id),
        isActive: branch.id === input.activeBranchId,
    }));

    const checkpoints: CheckpointTimelineItemDto[] = listable.map((checkpoint) => {
        const stats = checkpoint.fileStats;
        return {
            id: checkpoint.id,
            description: checkpoint.description,
            created: createdIso(checkpoint.created),
            type: classifyCheckpointKind(checkpoint, input.branches),
            branchId: checkpoint.branchId,
            parentId: checkpoint.parentCheckpointId,
            tags: checkpoint.tags ?? [],
            fileChanges: stats
                ? {
                    added: stats.created,
                    modified: stats.modified,
                    deleted: stats.deleted,
                }
                : undefined,
            metadata: checkpoint.conversationContext
                ? {
                    messageContent: checkpoint.conversationContext.messageContent,
                    role: checkpoint.conversationContext.role,
                }
                : undefined,
            isIncremental: checkpoint.captureMode === 'delta',
        };
    });

    return {
        checkpoints,
        branches,
        activeBranchId: input.activeBranchId,
    };
}
