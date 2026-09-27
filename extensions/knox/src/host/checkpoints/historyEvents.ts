import * as vscode from 'vscode';

const historyChanged = new vscode.EventEmitter<void>();
const sessionChanged = new vscode.EventEmitter<string | null>();

let activeChatSessionId: string | null = null;

/**
 * Checkpoint history changed (create, delete, pin, restore, branch, import).
 * The sidebar and the graph panel are separate webviews; both listen here.
 */
export const onCheckpointHistoryChanged = historyChanged.event;

export function notifyCheckpointHistoryChanged(): void {
    historyChanged.fire();
}

/** Chat session the sidebar is showing. The graph panel has no chat of its own. */
export const onActiveChatSessionChanged = sessionChanged.event;

export function getActiveChatSessionId(): string | null {
    return activeChatSessionId;
}

export function setActiveChatSessionId(sessionId: string | null): void {
    const next = sessionId || null;
    if (next === activeChatSessionId) {
        return;
    }
    activeChatSessionId = next;
    sessionChanged.fire(next);
}
