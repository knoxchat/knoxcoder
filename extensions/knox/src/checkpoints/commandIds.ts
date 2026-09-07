/**
 * Canonical checkpoint command IDs.
 *
 * Palette, keybindings, and new code should use `knox.checkpoints.*`.
 * Older `knoxchat.checkpoints.*` and singular `knox.checkpoint.*` IDs stay
 * registered as aliases so existing keybindings and scripts keep working.
 */

import * as vscode from 'vscode';

export const CheckpointCommand = {
    create: 'knox.checkpoints.create',
    list: 'knox.checkpoints.list',
    restore: 'knox.checkpoints.restore',
    fileHistory: 'knox.checkpoints.fileHistory',
    analyze: 'knox.checkpoints.analyze',
    stats: 'knox.checkpoints.stats',
    export: 'knox.checkpoints.export',
    share: 'knox.checkpoints.share',
    import: 'knox.checkpoints.import',
    cleanup: 'knox.checkpoints.cleanup',
    undo: 'knox.checkpoints.undo',
    redo: 'knox.checkpoints.redo',
    toggleAuto: 'knox.checkpoints.toggleAuto',
    showUndoHistory: 'knox.checkpoints.showUndoHistory',
    health: 'knox.checkpoints.health',
    healthMetrics: 'knox.checkpoints.healthMetrics',
    runRecovery: 'knox.checkpoints.runRecovery',
    showConfiguration: 'knox.checkpoints.showConfiguration',
    createKnoxIgnore: 'knox.checkpoints.createKnoxIgnore',
    configureScanDepth: 'knox.checkpoints.configureScanDepth',
    configureMaxFileSize: 'knox.checkpoints.configureMaxFileSize',
    showScanMetrics: 'knox.checkpoints.showScanMetrics',
    resetConfiguration: 'knox.checkpoints.resetConfiguration',
    createBranch: 'knox.checkpoints.createBranch',
    switchBranch: 'knox.checkpoints.switchBranch',
    mergeBranch: 'knox.checkpoints.mergeBranch',
    deleteBranch: 'knox.checkpoints.deleteBranch',
    showInlineDiff: 'knox.checkpoints.showInlineDiff',
    hideDiff: 'knox.checkpoints.hideDiff',
    restoreLine: 'knox.checkpoints.restoreLine',
    restoreLineFromGutter: 'knox.checkpoints.restoreLineFromGutter',
    viewFileDiff: 'knox.checkpoints.viewFileDiff',
    restoreBlock: 'knox.checkpoints.restoreBlock',
    /** Registered on activate; not contributed — init already runs then. */
    init: 'knox.checkpoints.init',
    refreshTree: 'knox.checkpoints.refreshTree',
    loadMore: 'knox.checkpoints.loadMore',
    groupBy: 'knox.checkpoints.groupBy',
    showDetails: 'knox.checkpoints.showDetails',
    previewRestore: 'knox.checkpoints.previewRestore',
    diffWorkspace: 'knox.checkpoints.diffWorkspace',
    compareWith: 'knox.checkpoints.compareWith',
    delete: 'knox.checkpoints.delete',
    pin: 'knox.checkpoints.pin',
    copyId: 'knox.checkpoints.copyId',
    exportCheckpoint: 'knox.checkpoints.exportCheckpoint',
} as const;

export type CheckpointCommandId = (typeof CheckpointCommand)[keyof typeof CheckpointCommand];

export type CheckpointCommandAlias = {
    alias: string;
    canonical: CheckpointCommandId;
};

/** Legacy IDs kept as executeCommand forwards. Do not contribute these to the palette. */
export const CHECKPOINT_COMMAND_ALIASES: readonly CheckpointCommandAlias[] = [
    { alias: 'knoxchat.checkpoints.create', canonical: CheckpointCommand.create },
    { alias: 'knoxchat.checkpoints.list', canonical: CheckpointCommand.list },
    { alias: 'knoxchat.checkpoints.restore', canonical: CheckpointCommand.restore },
    { alias: 'knoxchat.checkpoints.healthCheck', canonical: CheckpointCommand.health },
    { alias: 'knoxchat.checkpoints.showMetrics', canonical: CheckpointCommand.healthMetrics },
    { alias: 'knoxchat.checkpoints.runRecovery', canonical: CheckpointCommand.runRecovery },
    { alias: 'knox.checkpoint.undo', canonical: CheckpointCommand.undo },
    { alias: 'knox.checkpoint.redo', canonical: CheckpointCommand.redo },
    { alias: 'knox.checkpoint.toggleAuto', canonical: CheckpointCommand.toggleAuto },
    { alias: 'knox.checkpoint.showHistory', canonical: CheckpointCommand.showUndoHistory },
    { alias: 'knox.checkpoint.createBranch', canonical: CheckpointCommand.createBranch },
    { alias: 'knox.checkpoint.switchBranch', canonical: CheckpointCommand.switchBranch },
    { alias: 'knox.checkpoint.showConfiguration', canonical: CheckpointCommand.showConfiguration },
    { alias: 'knox.checkpoint.createKnoxIgnore', canonical: CheckpointCommand.createKnoxIgnore },
    { alias: 'knox.checkpoint.configureScanDepth', canonical: CheckpointCommand.configureScanDepth },
    { alias: 'knox.checkpoint.configureMaxFileSize', canonical: CheckpointCommand.configureMaxFileSize },
    { alias: 'knox.checkpoint.showMetrics', canonical: CheckpointCommand.showScanMetrics },
    { alias: 'knox.checkpoint.resetConfiguration', canonical: CheckpointCommand.resetConfiguration },
    { alias: 'knox.checkpoint.showInlineDiff', canonical: CheckpointCommand.showInlineDiff },
    { alias: 'knox.checkpoint.hideDiff', canonical: CheckpointCommand.hideDiff },
    { alias: 'knox.checkpoint.restoreLine', canonical: CheckpointCommand.restoreLine },
    { alias: 'knox.checkpoint.restoreLineFromGutter', canonical: CheckpointCommand.restoreLineFromGutter },
    { alias: 'knox.checkpoint.viewFileDiff', canonical: CheckpointCommand.viewFileDiff },
    { alias: 'knox.checkpoint.restoreBlock', canonical: CheckpointCommand.restoreBlock },
    { alias: 'knoxchat.checkpoints.loadMore', canonical: CheckpointCommand.loadMore },
    { alias: 'knoxchat.checkpoints.groupBy', canonical: CheckpointCommand.groupBy },
    { alias: 'knoxchat.checkpoints.showDetails', canonical: CheckpointCommand.showDetails },
    { alias: 'knoxchat.checkpoints.delete', canonical: CheckpointCommand.delete },
    { alias: 'knoxchat.checkpoints.pin', canonical: CheckpointCommand.pin },
    { alias: 'knoxchat.checkpoints.compareWith', canonical: CheckpointCommand.compareWith },
    { alias: 'knoxchat.checkpoints.exportCheckpoint', canonical: CheckpointCommand.exportCheckpoint },
    { alias: 'knoxchat.checkpoints.copyId', canonical: CheckpointCommand.copyId },
];

/**
 * Commands that belong in the Command Palette.
 * Init and healthMetrics stay unlisted.
 */
export const CHECKPOINT_PALETTE_COMMANDS: readonly CheckpointCommandId[] = [
    CheckpointCommand.create,
    CheckpointCommand.list,
    CheckpointCommand.restore,
    CheckpointCommand.fileHistory,
    CheckpointCommand.showInlineDiff,
    CheckpointCommand.hideDiff,
    CheckpointCommand.analyze,
    CheckpointCommand.stats,
    CheckpointCommand.export,
    CheckpointCommand.share,
    CheckpointCommand.import,
    CheckpointCommand.cleanup,
    CheckpointCommand.undo,
    CheckpointCommand.redo,
    CheckpointCommand.toggleAuto,
    CheckpointCommand.showUndoHistory,
    CheckpointCommand.createBranch,
    CheckpointCommand.switchBranch,
    CheckpointCommand.mergeBranch,
    CheckpointCommand.deleteBranch,
    CheckpointCommand.health,
    CheckpointCommand.runRecovery,
    CheckpointCommand.showConfiguration,
    CheckpointCommand.createKnoxIgnore,
    CheckpointCommand.configureScanDepth,
    CheckpointCommand.configureMaxFileSize,
    CheckpointCommand.showScanMetrics,
    CheckpointCommand.resetConfiguration,
];

/**
 * Tree/context commands. Contributed so Explorer menus work, but hidden
 * from the Command Palette (`menus.commandPalette` when: false).
 */
export const CHECKPOINT_TREE_COMMANDS: readonly CheckpointCommandId[] = [
    CheckpointCommand.refreshTree,
    CheckpointCommand.loadMore,
    CheckpointCommand.groupBy,
    CheckpointCommand.showDetails,
    CheckpointCommand.previewRestore,
    CheckpointCommand.diffWorkspace,
    CheckpointCommand.compareWith,
    CheckpointCommand.delete,
    CheckpointCommand.pin,
    CheckpointCommand.copyId,
    CheckpointCommand.exportCheckpoint,
];

export const CHECKPOINT_TREE_VIEW_ID = 'knox.checkpoints.view';

export function checkpointIdFromArg(arg?: unknown): string | undefined {
    if (typeof arg === 'string') {
        const id = arg.trim();
        return id.length > 0 ? id : undefined;
    }
    if (arg && typeof arg === 'object') {
        const id = (arg as { checkpointId?: unknown }).checkpointId;
        if (typeof id === 'string' && id.trim()) {
            return id.trim();
        }
    }
    return undefined;
}

export function aliasesFor(canonical: CheckpointCommandId): string[] {
    return CHECKPOINT_COMMAND_ALIASES
        .filter((entry) => entry.canonical === canonical)
        .map((entry) => entry.alias);
}

export function registerCanonicalCommand(
    context: vscode.ExtensionContext,
    id: CheckpointCommandId,
    handler: (...args: any[]) => unknown,
): void {
    const wrapped = async (...args: any[]) => {
        const { CheckpointManager } = await import('./CheckpointManager');
        await CheckpointManager.getInstance().initialize(context);
        return handler(...args);
    };
    context.subscriptions.push(vscode.commands.registerCommand(id, wrapped));
    for (const alias of aliasesFor(id)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(alias, (...args: unknown[]) =>
                vscode.commands.executeCommand(id, ...args),
            ),
        );
    }
}
