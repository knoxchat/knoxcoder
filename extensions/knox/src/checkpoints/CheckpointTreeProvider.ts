import * as vscode from 'vscode';

import { t } from '../i18n';
import { tryResolveSandboxedWorkspacePath } from './checkpointPath';
import { CheckpointManager, CheckpointInfo } from './CheckpointManager';
import {
    CheckpointCommand,
    CHECKPOINT_TREE_VIEW_ID,
    checkpointIdFromArg,
    registerCanonicalCommand,
} from './commandIds';
import type { CheckpointDiffResult, CheckpointFileDiff } from './manager/types';
import { listedCheckpointFileCount } from './manager/types';

/** How many checkpoints per page in the tree */
export const PAGE_SIZE = 25;

/** Cache TTL in milliseconds */
const CACHE_TTL_MS = 10_000;

export const CHECKPOINT_DIFF_SCHEME = 'knox-checkpoint';

export type CheckpointType = 'manual' | 'auto' | 'ai' | 'merge' | 'unknown';
export type CheckpointGroupMode = 'date' | 'session' | 'pin';

export interface CheckpointGroup {
    id: string;
    checkpoints: CheckpointInfo[];
}

export function inferCheckpointType(cp: CheckpointInfo): CheckpointType {
    const desc = (cp.description ?? '').toLowerCase();
    if (desc.includes('merge') || desc.includes('conflict')) { return 'merge'; }
    if (desc.includes('agent') || desc.includes('ai') || cp.conversationContext) { return 'ai'; }
    if (desc.startsWith('auto') || desc.includes('interval') || desc.includes('automatic')) { return 'auto'; }
    return 'manual';
}

export function groupByDate(checkpoints: CheckpointInfo[], now = new Date()): CheckpointGroup[] {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const thisWeekStart = new Date(today.getTime() - today.getDay() * 86400000);

    const groups: CheckpointGroup[] = [
        { id: 'today', checkpoints: [] },
        { id: 'yesterday', checkpoints: [] },
        { id: 'thisWeek', checkpoints: [] },
        { id: 'older', checkpoints: [] },
    ];

    for (const cp of checkpoints) {
        const created = cp.created.getTime();
        if (created >= today.getTime()) { groups[0].checkpoints.push(cp); }
        else if (created >= yesterday.getTime()) { groups[1].checkpoints.push(cp); }
        else if (created >= thisWeekStart.getTime()) { groups[2].checkpoints.push(cp); }
        else { groups[3].checkpoints.push(cp); }
    }

    return groups.filter((group) => group.checkpoints.length > 0);
}

export function groupBySession(checkpoints: CheckpointInfo[]): CheckpointGroup[] {
    const sessionMap = new Map<string, CheckpointInfo[]>();

    for (const cp of checkpoints) {
        let sessionKey: string;
        if (cp.sessionId || cp.conversationContext?.sessionId) {
            sessionKey = `session:${cp.sessionId || cp.conversationContext?.sessionId}`;
        } else if (cp.conversationContext) {
            sessionKey = 'aiSession';
        } else if (cp.messageId) {
            sessionKey = `chat:${cp.messageId}`;
        } else {
            sessionKey = 'manual';
        }

        const existing = sessionMap.get(sessionKey);
        if (existing) {
            existing.push(cp);
        } else {
            sessionMap.set(sessionKey, [cp]);
        }
    }

    return Array.from(sessionMap.entries())
        .map(([id, cps]) => ({ id, checkpoints: cps }))
        .filter((group) => group.checkpoints.length > 0);
}

export function groupByPin(checkpoints: CheckpointInfo[]): CheckpointGroup[] {
    const pinned = checkpoints.filter((cp) => cp.pinned);
    const unpinned = checkpoints.filter((cp) => !cp.pinned);
    const groups: CheckpointGroup[] = [];
    if (pinned.length > 0) {
        groups.push({ id: 'pinned', checkpoints: pinned });
    }
    if (unpinned.length > 0) {
        groups.push({ id: 'unpinned', checkpoints: unpinned });
    }
    return groups;
}

export function summarizeDiffResult(diff: CheckpointDiffResult): {
    added: number;
    removed: number;
    modified: number;
} {
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (const file of diff.files) {
        if (file.status === 'added') {
            added++;
        } else if (file.status === 'deleted') {
            removed++;
        } else {
            modified++;
        }
    }
    return { added, removed, modified };
}

function checkpointTypeIcon(type: CheckpointType): vscode.ThemeIcon {
    switch (type) {
        case 'manual': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
        case 'auto':   return new vscode.ThemeIcon('gear', new vscode.ThemeColor('charts.gray'));
        case 'ai':     return new vscode.ThemeIcon('hubot', new vscode.ThemeColor('charts.purple'));
        case 'merge':  return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.orange'));
        default:       return new vscode.ThemeIcon('history');
    }
}

function groupLabel(group: CheckpointGroup): string {
    if (group.id.startsWith('session:')) {
        return t('checkpoint.tree.group.session', { id: group.id.slice('session:'.length).slice(0, 8) });
    }
    if (group.id.startsWith('chat:')) {
        return t('checkpoint.tree.group.chat', { id: group.id.slice('chat:'.length).slice(0, 8) });
    }
    const keyed = `checkpoint.tree.group.${group.id}`;
    const translated = t(keyed);
    return translated === keyed ? group.id : translated;
}

export class CheckpointDiffContentProvider implements vscode.TextDocumentContentProvider {
    private readonly contents = new Map<string, string>();

    set(uri: vscode.Uri, content: string): void {
        this.contents.set(uri.toString(), content);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

    uriFor(side: 'left' | 'right', checkpointId: string, relativePath: string, content: string): vscode.Uri {
        const uri = vscode.Uri.from({
            scheme: CHECKPOINT_DIFF_SCHEME,
            path: `/${encodeURIComponent(checkpointId)}/${relativePath.split('\\').join('/')}`,
            query: side,
        });
        this.set(uri, content);
        return uri;
    }
}

export function workspaceFileUri(
    workspacePath: string | undefined,
    relativePath: string,
): vscode.Uri | undefined {
    if (!workspacePath) {
        return undefined;
    }
    const sandboxed = tryResolveSandboxedWorkspacePath(workspacePath, relativePath);
    if (!sandboxed.ok) {
        return undefined;
    }
    return vscode.Uri.file(sandboxed.fullPath);
}

export function diffResourceUris(
    provider: CheckpointDiffContentProvider,
    diff: CheckpointDiffResult,
    file: CheckpointFileDiff,
    workspacePath?: string,
): { left: vscode.Uri; right: vscode.Uri; title: string } {
    const leftId = diff.oldCheckpoint?.id ?? 'empty';
    const left = provider.uriFor('left', leftId, file.relativePath, file.oldContent ?? '');

    let right: vscode.Uri;
    if (diff.newCheckpoint.id === 'workspace' && file.status !== 'deleted') {
        right = workspaceFileUri(workspacePath, file.relativePath)
            ?? provider.uriFor('right', 'workspace', file.relativePath, file.newContent ?? '');
    } else {
        right = provider.uriFor('right', diff.newCheckpoint.id, file.relativePath, file.newContent ?? '');
    }

    const title = `${file.relativePath} (${diff.oldCheckpoint?.description ?? 'checkpoint'} ↔ ${diff.newCheckpoint.description})`;
    return { left, right, title };
}

export async function openCheckpointDiffs(
    provider: CheckpointDiffContentProvider,
    diff: CheckpointDiffResult,
    workspacePath?: string,
): Promise<boolean> {
    if (diff.files.length === 0) {
        vscode.window.showInformationMessage(t('checkpoint.tree.diffEmpty'));
        return false;
    }

    const resources = diff.files.map((file) => diffResourceUris(provider, diff, file, workspacePath));
    if (resources.length === 1) {
        await vscode.commands.executeCommand('vscode.diff', resources[0].left, resources[0].right, resources[0].title);
        return true;
    }

    const title = `${diff.oldCheckpoint?.description ?? t('checkpoint.tree.checkpoint')} ↔ ${diff.newCheckpoint.description}`;
    try {
        await vscode.commands.executeCommand(
            'vscode.changes',
            title,
            resources.map((resource) => [resource.left, resource.right, resource.right]),
        );
        return true;
    } catch {
        const selected = await vscode.window.showQuickPick(
            diff.files.map((file, index) => ({
                label: file.relativePath,
                description: file.status,
                index,
            })),
            {
                canPickMany: true,
                placeHolder: t('checkpoint.tree.selectFilesToDiff'),
            },
        );
        if (!selected || selected.length === 0) {
            return false;
        }
        for (const item of selected.slice(0, 8)) {
            const resource = resources[item.index];
            await vscode.commands.executeCommand('vscode.diff', resource.left, resource.right, resource.title);
        }
        return true;
    }
}

export class CheckpointTreeProvider implements vscode.TreeDataProvider<CheckpointItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CheckpointItem | undefined | null | void> = new vscode.EventEmitter<CheckpointItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CheckpointItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private cachedHistory: CheckpointInfo[] | undefined;
    private cacheTimestamp = 0;
    private filterText = '';
    private loadedPages = 1;
    private groupBy: CheckpointGroupMode = 'date';

    constructor(private checkpointManager: CheckpointManager) {}

    refresh(): void {
        this.cachedHistory = undefined;
        this.cacheTimestamp = 0;
        this._onDidChangeTreeData.fire();
    }

    setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.loadedPages = 1;
        this._onDidChangeTreeData.fire();
    }

    loadMore(): void {
        this.loadedPages++;
        this._onDidChangeTreeData.fire();
    }

    setGroupBy(mode: CheckpointGroupMode): void {
        this.groupBy = mode;
        this.loadedPages = 1;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CheckpointItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CheckpointItem): Promise<CheckpointItem[]> {
        if (!element) {
            const history = this.getVisibleHistory();
            if (history.length === 0) {
                const empty = new CheckpointItem(
                    t('checkpoint.tree.empty'),
                    vscode.TreeItemCollapsibleState.None,
                    'empty',
                );
                empty.iconPath = new vscode.ThemeIcon('history');
                empty.command = {
                    command: CheckpointCommand.create,
                    title: t('checkpoint.tree.create'),
                };
                return [empty];
            }

            const groups = this.groupCheckpoints(history);
            const items = groups.map((group) => {
                const item = new CheckpointItem(
                    `${groupLabel(group)} (${group.checkpoints.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'dateGroup',
                );
                item.dateGroupCheckpoints = group.checkpoints;
                item.iconPath = this.groupBy === 'session'
                    ? new vscode.ThemeIcon('symbol-event')
                    : this.groupBy === 'pin'
                        ? new vscode.ThemeIcon('pinned')
                        : new vscode.ThemeIcon('calendar');
                return item;
            });

            const stats = new CheckpointItem(
                t('checkpoint.tree.statistics'),
                vscode.TreeItemCollapsibleState.Collapsed,
                'stats',
            );
            stats.iconPath = new vscode.ThemeIcon('graph');
            items.push(stats);
            return items;
        }

        if (element.contextValue === 'dateGroup' && element.dateGroupCheckpoints) {
            const cps = element.dateGroupCheckpoints;
            const limit = this.loadedPages * PAGE_SIZE;
            const items: CheckpointItem[] = cps.slice(0, limit).map((cp) => this.makeCheckpointItem(cp));

            if (cps.length > limit) {
                const remaining = cps.length - limit;
                const loadMoreItem = new CheckpointItem(
                    t('checkpoint.tree.loadMore', { remaining }),
                    vscode.TreeItemCollapsibleState.None,
                    'loadMore',
                );
                loadMoreItem.iconPath = new vscode.ThemeIcon('ellipsis');
                loadMoreItem.command = {
                    command: CheckpointCommand.loadMore,
                    title: t('checkpoint.tree.loadMoreTitle'),
                };
                items.push(loadMoreItem);
            }
            return items;
        }

        if (element.contextValue === 'stats') {
            try {
                const stats = await this.checkpointManager.getCheckpointStatistics();
                return [
                    this.makeStat(t('checkpoint.tree.statTotal', { count: stats.totalCheckpoints })),
                    this.makeStat(t('checkpoint.tree.statStorage', { size: this.formatBytes(stats.totalStorageBytes) })),
                    this.makeStat(t('checkpoint.tree.statSessions', { count: stats.totalSessions })),
                ];
            } catch {
                return [this.makeStat(t('checkpoint.tree.statsUnavailable'))];
            }
        }

        return [];
    }

    getVisibleHistory(): CheckpointInfo[] {
        const sorted = [...this.getHistoryCached()].sort((a, b) => b.created.getTime() - a.created.getTime());
        if (!this.filterText) {
            return sorted;
        }
        return sorted.filter((cp) =>
            cp.description?.toLowerCase().includes(this.filterText)
            || cp.id.toLowerCase().includes(this.filterText)
            || (cp.tags ?? []).some((tag) => tag.toLowerCase().includes(this.filterText)),
        );
    }

    private groupCheckpoints(history: CheckpointInfo[]): CheckpointGroup[] {
        if (this.groupBy === 'session') {
            return groupBySession(history);
        }
        if (this.groupBy === 'pin') {
            return groupByPin(history);
        }
        return groupByDate(history);
    }

    private getHistoryCached(): CheckpointInfo[] {
        const now = Date.now();
        if (this.cachedHistory && now - this.cacheTimestamp < CACHE_TTL_MS) {
            return this.cachedHistory;
        }
        this.cachedHistory = this.checkpointManager.getCheckpointHistoryForWorkspace();
        this.cacheTimestamp = now;
        return this.cachedHistory;
    }

    private makeCheckpointItem(cp: CheckpointInfo): CheckpointItem {
        const cpType = inferCheckpointType(cp);
        const fileCount = listedCheckpointFileCount(cp);
        const item = new CheckpointItem(
            cp.description || cp.id,
            vscode.TreeItemCollapsibleState.None,
            cp.pinned ? 'checkpointPinned' : 'checkpoint',
        );
        item.checkpointId = cp.id;
        item.description = cp.pinned
            ? t('checkpoint.tree.pinnedMeta', { date: cp.created.toLocaleString() })
            : cp.created.toLocaleString();
        item.tooltip = new vscode.MarkdownString(
            `**${cp.description}**\n\n` +
            `- **ID:** \`${cp.id}\`\n` +
            `- **Created:** ${cp.created.toLocaleString()}\n` +
            `- **Type:** ${cpType}\n` +
            (cp.pinned ? `- **Pinned:** yes\n` : '') +
            `- **Files:** ${fileCount}\n` +
            (cp.tags?.length ? `- **Tags:** ${cp.tags.join(', ')}\n` : ''),
        );
        item.iconPath = cp.pinned
            ? new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.yellow'))
            : checkpointTypeIcon(cpType);
        item.command = {
            command: CheckpointCommand.showDetails,
            title: t('checkpoint.tree.showDetails'),
            arguments: [cp.id],
        };
        return item;
    }

    private makeStat(label: string): CheckpointItem {
        const item = new CheckpointItem(label, vscode.TreeItemCollapsibleState.None, 'stat');
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) { return '0 Bytes'; }
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

export class CheckpointItem extends vscode.TreeItem {
    dateGroupCheckpoints?: CheckpointInfo[];
    checkpointId?: string;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
    ) {
        super(label, collapsibleState);
    }
}

function checkpointArgId(arg?: CheckpointItem | string): string | undefined {
    return checkpointIdFromArg(arg);
}

export function registerCheckpointTreeView(context: vscode.ExtensionContext): void {
    const checkpointManager = CheckpointManager.getInstance();
    const provider = new CheckpointTreeProvider(checkpointManager);
    const diffContents = new CheckpointDiffContentProvider();

    const treeView = vscode.window.createTreeView(CHECKPOINT_TREE_VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    context.subscriptions.push(treeView);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(CHECKPOINT_DIFF_SCHEME, diffContents),
    );
    context.subscriptions.push(checkpointManager.onCheckpointCreated(() => provider.refresh()));
    context.subscriptions.push(checkpointManager.onActiveWorkspaceChanged(() => provider.refresh()));

    registerCanonicalCommand(context, CheckpointCommand.refreshTree, () => {
        provider.refresh();
    });

    registerCanonicalCommand(context, CheckpointCommand.loadMore, () => {
        provider.loadMore();
    });

    registerCanonicalCommand(context, CheckpointCommand.groupBy, async () => {
        const pick = await vscode.window.showQuickPick(
            [
                { label: t('checkpoint.tree.groupByDate'), description: t('checkpoint.tree.groupByDateDetail'), value: 'date' as const },
                { label: t('checkpoint.tree.groupBySession'), description: t('checkpoint.tree.groupBySessionDetail'), value: 'session' as const },
                { label: t('checkpoint.tree.groupByPin'), description: t('checkpoint.tree.groupByPinDetail'), value: 'pin' as const },
            ],
            { placeHolder: t('checkpoint.tree.selectGrouping') },
        );
        if (pick) {
            provider.setGroupBy(pick.value);
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.showDetails, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }

        const checkpoint = checkpointManager.getCheckpointInfo(checkpointId);
        if (!checkpoint) {
            vscode.window.showWarningMessage(t('checkpoint.notFound'));
            return;
        }

        const restoreLabel = t('checkpoint.restore');
        const previewLabel = t('checkpoint.tree.preview');
        const diffLabel = t('checkpoint.tree.diffWorkspace');
        const compareLabel = t('checkpoint.tree.compare');
        const pinLabel = checkpoint.pinned
            ? t('checkpoint.tree.unpin')
            : t('checkpoint.tree.pin');

        const action = await vscode.window.showInformationMessage(
            [
                checkpoint.description,
                t('checkpoint.tree.detailsId', { id: checkpoint.id }),
                t('checkpoint.tree.detailsCreated', {
                    date: checkpoint.created.toLocaleString(),
                }),
                t('checkpoint.tree.detailsFiles', {
                    count: listedCheckpointFileCount(checkpoint),
                }),
            ].join('\n'),
            restoreLabel,
            previewLabel,
            diffLabel,
            pinLabel,
            compareLabel,
        );

        switch (action) {
            case restoreLabel:
                await vscode.commands.executeCommand(CheckpointCommand.restore, checkpoint.id);
                break;
            case previewLabel:
                await vscode.commands.executeCommand(CheckpointCommand.previewRestore, checkpoint.id);
                break;
            case diffLabel:
                await vscode.commands.executeCommand(CheckpointCommand.diffWorkspace, checkpoint.id);
                break;
            case pinLabel:
                await vscode.commands.executeCommand(CheckpointCommand.pin, checkpoint.id);
                break;
            case compareLabel:
                await vscode.commands.executeCommand(CheckpointCommand.compareWith, checkpoint.id);
                break;
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.previewRestore, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }
        await vscode.commands.executeCommand(CheckpointCommand.restore, checkpointId);
    });

    registerCanonicalCommand(context, CheckpointCommand.diffWorkspace, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }
        try {
            const diff = await checkpointManager.computeCheckpointDiffAgainstWorkspace(checkpointId);
            if (!diff) {
                vscode.window.showWarningMessage(t('checkpoint.tree.compareUnavailableShort'));
                return;
            }
            await openCheckpointDiffs(diffContents, diff, checkpointManager.getCurrentWorkspacePath());
        } catch (error) {
            vscode.window.showErrorMessage(
                t('checkpoint.tree.failedDiff', { error: error instanceof Error ? error.message : String(error) }),
            );
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.compareWith, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }

        const base = checkpointManager.getCheckpointInfo(checkpointId);
        if (!base) {
            vscode.window.showWarningMessage(t('checkpoint.notFound'));
            return;
        }

        const otherItems = checkpointManager
            .getCheckpointHistoryForWorkspace()
            .filter((cp) => cp.id !== checkpointId)
            .sort((a, b) => b.created.getTime() - a.created.getTime())
            .map((cp) => ({
                label: cp.description,
                description: cp.created.toLocaleString(),
                detail: cp.id.slice(0, 8),
                checkpoint: cp,
            }));

        if (otherItems.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.tree.noOtherCheckpoints'));
            return;
        }

        const selected = await vscode.window.showQuickPick(otherItems, {
            placeHolder: t('checkpoint.tree.comparePlaceholder'),
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (!selected) {
            return;
        }

        try {
            const diff = await checkpointManager.computeCheckpointDiff(checkpointId, selected.checkpoint.id);
            if (!diff) {
                vscode.window.showWarningMessage(t('checkpoint.tree.compareUnavailableShort'));
                return;
            }

            const counts = summarizeDiffResult(diff);
            const openDiffs = t('checkpoint.tree.openDiffs');
            const action = await vscode.window.showInformationMessage(
                t('checkpoint.tree.compareSummary', {
                    base: base.description,
                    baseId: base.id.slice(0, 8),
                    other: selected.checkpoint.description,
                    otherId: selected.checkpoint.id.slice(0, 8),
                    added: counts.added,
                    removed: counts.removed,
                    modified: counts.modified,
                }),
                { modal: true },
                openDiffs,
            );
            if (action === openDiffs) {
                await openCheckpointDiffs(diffContents, diff, checkpointManager.getCurrentWorkspacePath());
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                t('checkpoint.tree.failedDiff', { error: error instanceof Error ? error.message : String(error) }),
            );
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.delete, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }

        const checkpoint = checkpointManager.getCheckpointInfo(checkpointId);
        const deleteLabel = t('checkpoint.tree.delete');
        const confirm = await vscode.window.showWarningMessage(
            t('checkpoint.tree.deleteConfirm', {
                name: checkpoint?.description ?? checkpointId,
            }),
            { modal: true },
            deleteLabel,
        );

        if (confirm !== deleteLabel) {
            return;
        }

        const deleted = await checkpointManager.removeFromHistoryAndDisk(checkpointId);
        if (deleted) {
            provider.refresh();
            vscode.window.showInformationMessage(
                t('checkpoint.tree.deleted', { id: checkpointId.slice(0, 8) }),
            );
        } else {
            vscode.window.showWarningMessage(t('checkpoint.tree.failedDelete'));
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.pin, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }

        const checkpoint = checkpointManager.getCheckpointInfo(checkpointId);
        if (!checkpoint) {
            vscode.window.showWarningMessage(t('checkpoint.notFound'));
            return;
        }

        const next = !checkpoint.pinned;
        const success = await checkpointManager.setCheckpointPinned(checkpointId, next);
        if (success) {
            provider.refresh();
            vscode.window.showInformationMessage(
                t(next ? 'checkpoint.tree.pinned' : 'checkpoint.tree.unpinned', {
                    id: checkpointId.slice(0, 8),
                }),
            );
        } else {
            vscode.window.showWarningMessage(t('checkpoint.tree.failedPin'));
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.exportCheckpoint, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }

        const checkpoint = checkpointManager.getCheckpointInfo(checkpointId);
        if (!checkpoint) {
            vscode.window.showWarningMessage(t('checkpoint.notFound'));
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`checkpoint-${checkpointId.slice(0, 8)}.knoxcp.json`),
            filters: { 'Knox Checkpoint Bundles': ['json'] },
        });

        if (!uri) {
            return;
        }

        try {
            await checkpointManager.exportCheckpoints(uri.fsPath, { checkpointIds: [checkpointId] });
            vscode.window.showInformationMessage(
                t('checkpoint.tree.exported', { id: checkpointId.slice(0, 8) }),
            );
        } catch (error) {
            vscode.window.showErrorMessage(t('checkpoint.failedExport', { error }));
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.copyId, async (arg?: CheckpointItem | string) => {
        const checkpointId = checkpointArgId(arg);
        if (!checkpointId) {
            return;
        }

        await vscode.env.clipboard.writeText(checkpointId);
        vscode.window.showInformationMessage(
            t('checkpoint.tree.copiedId', { id: checkpointId.slice(0, 8) }),
        );
    });
}
