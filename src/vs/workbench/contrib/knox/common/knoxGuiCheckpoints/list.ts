/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiCheckpointBranch, IKnoxGuiCheckpointNode } from '../knoxGuiState.js';
import { fuzzyTitleMatch, parseHistoryDate } from '../knoxGuiOverlays.js';

/** List, timeline, shell, and panel-tab helpers. */

export const CHECKPOINT_SHELL_STATES = ['loading', 'no-workspace', 'not-initialized', 'empty', 'ready', 'failed'] as const;
export type KnoxCheckpointShellState = typeof CHECKPOINT_SHELL_STATES[number];

export function filterCheckpoints(
	nodes: IKnoxGuiCheckpointNode[],
	opts: { query?: string; sessionId?: string; thisSession?: boolean; kinds?: string[] },
): IKnoxGuiCheckpointNode[] {
	const query = opts.query?.trim().toLowerCase();
	return nodes.filter(node => {
		if (opts.thisSession && opts.sessionId && node.sessionId !== opts.sessionId) {
			return false;
		}
		if (opts.kinds?.length && !opts.kinds.includes(node.kind)) {
			return false;
		}
		if (!query) {
			return true;
		}
		return checkpointMatchesQuery(node, opts.query!.trim());
	});
}

/**
 * `Checkpoints/index.tsx`: MiniSearch (`fuzzy: 0.1`) over description, id,
 * tags, session and paths, plus id prefix and substring checks.
 */
export function checkpointMatchesQuery(node: Pick<IKnoxGuiCheckpointNode, 'id' | 'description' | 'tags' | 'sessionId' | 'changedPaths'>, query: string): boolean {
	const needle = query.toLowerCase();
	const fields = [node.description, node.id, node.tags.join(' '), node.sessionId ?? '', node.changedPaths.join(' ')];
	return fields.some(text => fuzzyTitleMatch(text, query))
		|| node.id.toLowerCase().startsWith(needle)
		|| node.description.toLowerCase().includes(needle)
		|| node.tags.some(tag => tag.toLowerCase().includes(needle))
		|| Boolean(node.sessionId?.toLowerCase().includes(needle))
		|| node.changedPaths.some(path => path.toLowerCase().includes(needle));
}

export function checkpointShellMessageKey(state: string | undefined): string {
	if (!state || state === 'loading') {
		return 'checkpointGraph.loading';
	}
	if (state === 'no-workspace') {
		return 'checkpointGraph.noWorkspace';
	}
	if (state === 'not-initialized') {
		return 'checkpointGraph.notInitialized';
	}
	if (state === 'empty') {
		return 'checkpointGraph.empty';
	}
	if (state === 'ready') {
		return 'checkpointGraph.ready';
	}
	return 'checkpointGraph.failed';
}

export function checkpointShellAction(state: string | undefined): { action: string; key: string } | undefined {
	if (state === 'no-workspace') {
		return { action: 'openFolder', key: 'checkpointGraph.openFolder' };
	}
	if (state === 'not-initialized' || state === 'failed') {
		return { action: 'retryInit', key: 'checkpointGraph.retry' };
	}
	if (state === 'empty') {
		return { action: 'createCheckpoint', key: 'checkpointGraph.create' };
	}
	return undefined;
}

export function checkpointShellViewState(shell: string | undefined, nodeCount: number, checkpointCount?: number): string {
	if (!shell) {
		return 'loading';
	}
	if (shell === 'ready' && (checkpointCount ?? nodeCount) === 0) {
		return 'empty';
	}
	return shell;
}

export type KnoxCheckpointDateSection = 'today' | 'thisWeek' | 'thisMonth' | 'earlierCheckpoints';

export function groupCheckpointsByDate(nodes: IKnoxGuiCheckpointNode[], now = Date.now()): Array<{ header: KnoxCheckpointDateSection; checkpoints: IKnoxGuiCheckpointNode[] }> {
	const yesterday = now - 1000 * 60 * 60 * 24;
	const lastWeek = now - 1000 * 60 * 60 * 24 * 7;
	const lastMonth = now - 1000 * 60 * 60 * 24 * 30;
	const groups: Array<{ header: KnoxCheckpointDateSection; checkpoints: IKnoxGuiCheckpointNode[] }> = [];
	let current: KnoxCheckpointDateSection | '' = '';
	let bucket: IKnoxGuiCheckpointNode[] = [];
	const flush = () => {
		if (current && bucket.length) {
			groups.push({ header: current, checkpoints: bucket });
		}
	};
	for (const node of nodes) {
		const time = parseHistoryDate(node.created).getTime();
		let section: KnoxCheckpointDateSection;
		if (time > yesterday) {
			section = 'today';
		} else if (time > lastWeek) {
			section = 'thisWeek';
		} else if (time > lastMonth) {
			section = 'thisMonth';
		} else {
			section = 'earlierCheckpoints';
		}
		if (section !== current) {
			flush();
			current = section;
			bucket = [node];
		} else {
			bucket.push(node);
		}
	}
	flush();
	return groups;
}

export function formatCheckpointAge(created: string, now = Date.now()): { key: string; count?: number } {
	const time = parseHistoryDate(created).getTime();
	if (isNaN(time)) {
		return { key: 'checkpointGraph.justNow' };
	}
	const delta = Math.max(0, now - time);
	const minutes = Math.floor(delta / 60000);
	if (minutes < 1) {
		return { key: 'checkpointGraph.justNow' };
	}
	if (minutes === 1) {
		return { key: 'checkpointGraph.minuteAgo' };
	}
	if (minutes < 60) {
		return { key: 'checkpointGraph.minutesAgo', count: minutes };
	}
	const hours = Math.floor(minutes / 60);
	if (hours === 1) {
		return { key: 'checkpointGraph.hourAgo' };
	}
	if (hours < 24) {
		return { key: 'checkpointGraph.hoursAgo', count: hours };
	}
	const days = Math.floor(hours / 24);
	if (days === 1) {
		return { key: 'checkpointGraph.dayAgo' };
	}
	return { key: 'checkpointGraph.daysAgo', count: days };
}

/**
 * `CheckpointTableRow.tsx` `formatDate` (`yesterday: true`) and `CheckpointTimeline.tsx`
 * `formatRelativeTime`: relative within a week, otherwise the caller formats `date`.
 */
export function checkpointRelativeAge(created: string, yesterday: boolean, now = Date.now()): { key: string; count?: number } | { date: Date } {
	const date = parseHistoryDate(created);
	const delta = now - date.getTime();
	if (isNaN(delta)) {
		return { key: 'justNow' };
	}
	const minutes = Math.floor(delta / 60000);
	const hours = Math.floor(delta / 3600000);
	const days = Math.floor(delta / 86400000);
	if (minutes < 1) {
		return { key: 'justNow' };
	}
	if (hours < 1) {
		return { key: 'minutesAgo', count: minutes };
	}
	if (hours < 24) {
		return { key: 'hoursAgo', count: hours };
	}
	if (yesterday && days === 1) {
		return { key: 'yesterday' };
	}
	if (days < 7) {
		return { key: 'daysAgo', count: days };
	}
	return { date };
}

export function activeHeadId(branches: IKnoxGuiCheckpointBranch[]): string | undefined {
	return branches.find(branch => branch.isActive)?.headCheckpointId;
}

export function chronologicalCheckpointPair<T extends { created: string }>(left: T, right: T): [T, T] {
	return parseHistoryDate(left.created).getTime() <= parseHistoryDate(right.created).getTime()
		? [left, right]
		: [right, left];
}

export const CHECKPOINT_PANEL_TABS = ['graph', 'checkpoints', 'timeline', 'analysis', 'share', 'configuration', 'dashboard'] as const;
export type KnoxCheckpointPanelTab = typeof CHECKPOINT_PANEL_TABS[number];

export const CHECKPOINT_TAB_I18N_KEY: Record<KnoxCheckpointPanelTab, string> = {
	graph: 'checkpointGraph.tab',
	checkpoints: 'checkpoints',
	timeline: 'checkpointTimeline.tab',
	analysis: 'checkpointAnalysis.tab',
	share: 'checkpointShare.tab',
	configuration: 'configuration',
	dashboard: 'checkpointDashboard.tab',
};

export const CHECKPOINT_TAB_ICON: Record<KnoxCheckpointPanelTab, string> = {
	graph: 'git-branch',
	checkpoints: 'rotate-ccw',
	timeline: 'history',
	analysis: 'info',
	share: 'share-2',
	configuration: 'settings',
	dashboard: 'bar-chart-3',
};

/** `CheckpointTimeline.tsx` filter: substring over description, id and tags, one kind, newest first, grouped by calendar day. */
export function groupTimelineCheckpoints<T extends { id: string; description: string; created: string; kind: string; tags?: string[] }>(nodes: readonly T[], query: string, kind: string | null): { count: number; groups: Array<{ day: string; nodes: T[] }> } {
	const term = query.toLowerCase();
	const filtered = nodes
		.filter(node => !term || node.description.toLowerCase().includes(term) || node.id.toLowerCase().includes(term) || (node.tags ?? []).some(tag => tag.toLowerCase().includes(term)))
		.filter(node => !kind || node.kind === kind)
		.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
	const groups: Array<{ day: string; nodes: T[] }> = [];
	for (const node of filtered) {
		const day = new Date(node.created).toDateString();
		if (groups[groups.length - 1]?.day !== day) {
			groups.push({ day, nodes: [] });
		}
		groups[groups.length - 1].nodes.push(node);
	}
	return { count: filtered.length, groups };
}
