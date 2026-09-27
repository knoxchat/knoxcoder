export type CheckpointGraphShellState =
    | 'no-workspace'
    | 'not-initialized'
    | 'empty'
    | 'ready';

export interface CheckpointGraphShell {
    state: CheckpointGraphShellState;
    checkpointCount: number;
}

/**
 * Which shell the Checkpoint Graph panel shows before the lane table exists.
 * Workspace is checked first: an uninitialized engine in an empty window is
 * still "open a folder".
 */
export function resolveCheckpointGraphShell(input: {
    hasWorkspace: boolean;
    initialized: boolean;
    listableCount: number;
}): CheckpointGraphShell {
    if (!input.hasWorkspace) {
        return { state: 'no-workspace', checkpointCount: 0 };
    }
    if (!input.initialized) {
        return { state: 'not-initialized', checkpointCount: 0 };
    }
    const checkpointCount = Math.max(0, input.listableCount);
    if (checkpointCount === 0) {
        return { state: 'empty', checkpointCount: 0 };
    }
    return { state: 'ready', checkpointCount };
}
