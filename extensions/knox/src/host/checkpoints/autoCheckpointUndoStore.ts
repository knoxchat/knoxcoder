import type * as vscode from 'vscode';
import { createKnoxLogger } from 'core/util/knoxLog';
import type { CheckpointManager } from './CheckpointManager';
import type { UndoRedoState } from './AutoCheckpointSystem';
import { loadUndoStackState, saveUndoStackState } from './store/durableState';

const log = createKnoxLogger('AutoCheckpoint');

export function normalizeUndoState(
    state: Partial<UndoRedoState> & Pick<UndoRedoState, 'stack'>,
    defaultMaxSize: number,
): UndoRedoState {
    const stack = Array.isArray(state.stack) ? state.stack.filter((id) => typeof id === 'string') : [];
    const maxSize = typeof state.maxSize === 'number' && state.maxSize > 0
        ? state.maxSize
        : defaultMaxSize;
    let currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : stack.length - 1;
    if (stack.length === 0) {
        currentIndex = -1;
    } else {
        currentIndex = Math.max(0, Math.min(currentIndex, stack.length - 1));
    }
    return { stack, currentIndex, maxSize };
}

function resolveUndoStoragePath(manager: CheckpointManager): string | undefined {
    if (typeof manager.getStoragePath !== 'function') {
        return undefined;
    }
    return manager.getStoragePath();
}

export async function loadUndoRedoFromWorkspaceStore(manager: CheckpointManager): Promise<UndoRedoState | null> {
    try {
        const storagePath = resolveUndoStoragePath(manager);
        if (!storagePath) {
            return null;
        }
        const loaded = await loadUndoStackState(storagePath);
        return loaded ? { ...loaded } : null;
    } catch (error) {
        log.debug('Could not load undo stack from workspace store:', error);
        return null;
    }
}

export async function persistUndoRedo(
    manager: CheckpointManager,
    state: UndoRedoState,
    extensionContext: vscode.ExtensionContext | undefined,
): Promise<void> {
    try {
        if (extensionContext) {
            await extensionContext.workspaceState.update('checkpointUndoRedoState', state);
        }
        const storagePath = resolveUndoStoragePath(manager);
        if (storagePath) {
            await saveUndoStackState(storagePath, state);
        }
    } catch (error) {
        log.debug('Could not persist undo stack:', error);
    }
}
