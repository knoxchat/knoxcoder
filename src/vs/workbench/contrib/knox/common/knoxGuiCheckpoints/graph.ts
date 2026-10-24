/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiCheckpointBranch, IKnoxGuiCheckpointNode } from '../knoxGuiState.js';
import { CHECKPOINT_GRAPH_LANE_COLORS, checkpointGraphLaneColor, type CheckpointGraphLaneLayout, type CheckpointGraphLaneSegment } from './lanes.js';

/** Graph pagination, drawing, filters, and path-tree helpers. */

export const CHECKPOINT_GRAPH_PAGE_SIZE = 100;

/** Synthetic row for files that differ from the active head. Not a stored checkpoint. */
export const CHECKPOINT_GRAPH_WORKING_TREE_ID = '__working_tree__';
export const CHECKPOINT_GRAPH_DETAILS_HEIGHT = 240;
export const CHECKPOINT_GRAPH_ROW_HEIGHT = 28;
export const CHECKPOINT_GRAPH_LANE_GAP = 16;
export const CHECKPOINT_GRAPH_LANE_PAD = 12;
export const CHECKPOINT_GRAPH_VERTEX_RADIUS = 4;
export const CHECKPOINT_GRAPH_LIMIT = 500;
export const CHECKPOINT_LIST_PAGE_SIZE = 50;
const GRAPH_WINDOW_OVERSCAN = 8;
const GRAPH_WINDOW_FALLBACK_HEIGHT = CHECKPOINT_GRAPH_ROW_HEIGHT * 24;

export const CHECKPOINT_GRAPH_KIND_I18N: Record<string, string> = {
	manual: 'checkpointGraph.kindManual',
	auto: 'checkpointGraph.kindAuto',
	ai: 'checkpointGraph.kindAi',
	merge: 'checkpointGraph.kindMerge',
	'branch-point': 'checkpointGraph.kindBranch',
};

export const CHECKPOINT_GRAPH_KIND_CLASS: Record<string, string> = {
	manual: 'knox-gui-cp-kind-manual',
	auto: 'knox-gui-cp-kind-auto',
	ai: 'knox-gui-cp-kind-ai',
	merge: 'knox-gui-cp-kind-merge',
	'branch-point': 'knox-gui-cp-kind-branch',
};

export const CHECKPOINT_GRAPH_COLUMN_WIDTHS = { date: 152, kind: 104, id: 112 } as const;
export type KnoxCheckpointGraphColumn = 'date' | 'kind' | 'id';
export type KnoxCheckpointGraphFileView = 'list' | 'tree';
export type KnoxCheckpointDetailsLocation = 'inline' | 'dock';
export type KnoxCheckpointDateStyle = 'relative' | 'absolute';
export type KnoxCheckpointBranchFilter = { branchIds?: string[]; activeBranchOnly?: boolean };

export interface IKnoxGuiCheckpointGraphUi {
	hiddenColumns: KnoxCheckpointGraphColumn[];
	columnWidths: Record<KnoxCheckpointGraphColumn, number>;
	mute: boolean;
	detailsLocation: KnoxCheckpointDetailsLocation;
	dateStyle: KnoxCheckpointDateStyle;
	laneColors: string[];
	fileView: KnoxCheckpointGraphFileView;
	branchIds?: string[];
	activeBranchOnly?: boolean;
}

export interface CheckpointGraphExpand {
	at: number;
	y: number;
}

export interface CheckpointGraphPath {
	d: string;
	colorIndex: number;
}

export interface CheckpointGraphVertex {
	id: string;
	cx: number;
	cy: number;
	colorIndex: number;
	current: boolean;
}

export interface CheckpointGraphDrawing {
	width: number;
	height: number;
	paths: CheckpointGraphPath[];
	vertices: CheckpointGraphVertex[];
}

export interface CheckpointGraphLineageNode {
	id: string;
	parents: readonly string[];
}

export interface CheckpointGraphLineageLane {
	id: string;
	lane: number;
}

export interface CheckpointGraphMatchFields {
	id: string;
	shortId: string;
	description: string;
	tags: readonly string[];
	changedPaths?: readonly string[];
}

export interface CheckpointGraphTimeLabel {
	absolute: string;
	relativeKey?: 'checkpointGraph.justNow' | 'checkpointGraph.minuteAgo' | 'checkpointGraph.minutesAgo' | 'checkpointGraph.hourAgo' | 'checkpointGraph.hoursAgo' | 'checkpointGraph.dayAgo' | 'checkpointGraph.daysAgo';
	count?: number;
}

export interface CheckpointGraphPathTreeNode {
	name: string;
	path: string;
	file: boolean;
	children: CheckpointGraphPathTreeNode[];
}

export function defaultCheckpointGraphLaneColors(): string[] {
	return [...CHECKPOINT_GRAPH_LANE_COLORS];
}

export function defaultCheckpointGraphUi(): IKnoxGuiCheckpointGraphUi {
	return {
		hiddenColumns: [],
		columnWidths: { ...CHECKPOINT_GRAPH_COLUMN_WIDTHS },
		mute: true,
		detailsLocation: 'inline',
		dateStyle: 'relative',
		laneColors: defaultCheckpointGraphLaneColors(),
		fileView: 'list',
	};
}

export function parseCheckpointGraphUi(value: unknown): IKnoxGuiCheckpointGraphUi {
	const base = defaultCheckpointGraphUi();
	const rec = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
	if (!rec) {
		return base;
	}
	const hidden = Array.isArray(rec.hiddenColumns)
		? rec.hiddenColumns.filter((column): column is KnoxCheckpointGraphColumn => column === 'date' || column === 'kind' || column === 'id')
		: base.hiddenColumns;
	const widths = rec.columnWidths && typeof rec.columnWidths === 'object' ? rec.columnWidths as Record<string, unknown> : {};
	const colors = Array.isArray(rec.laneColors) ? rec.laneColors.map(String).filter(color => /^#[0-9a-fA-F]{6}$/.test(color)) : [];
	return {
		hiddenColumns: hidden,
		columnWidths: {
			date: Number(widths.date) || CHECKPOINT_GRAPH_COLUMN_WIDTHS.date,
			kind: Number(widths.kind) || CHECKPOINT_GRAPH_COLUMN_WIDTHS.kind,
			id: Number(widths.id) || CHECKPOINT_GRAPH_COLUMN_WIDTHS.id,
		},
		mute: rec.mute !== false,
		detailsLocation: rec.detailsLocation === 'dock' ? 'dock' : 'inline',
		dateStyle: rec.dateStyle === 'absolute' ? 'absolute' : 'relative',
		laneColors: colors.length ? colors : base.laneColors,
		fileView: rec.fileView === 'tree' ? 'tree' : 'list',
		branchIds: Array.isArray(rec.branchIds) ? rec.branchIds.map(String) : undefined,
		activeBranchOnly: rec.activeBranchOnly === true ? true : undefined,
	};
}

export function checkpointGraphFilterFromUi(ui: IKnoxGuiCheckpointGraphUi): KnoxCheckpointBranchFilter {
	if (ui.activeBranchOnly) {
		return { activeBranchOnly: true };
	}
	if (ui.branchIds) {
		return { branchIds: ui.branchIds };
	}
	return {};
}

export function checkpointGraphGridColumns(svgWidth: number, hidden: readonly KnoxCheckpointGraphColumn[], widths: Record<KnoxCheckpointGraphColumn, number>): string {
	const parts = [`${svgWidth}px`, 'minmax(0,1fr)'];
	for (const column of ['date', 'kind', 'id'] as const) {
		if (!hidden.includes(column)) {
			parts.push(`${widths[column]}px`);
		}
	}
	return parts.join(' ');
}

export function checkpointGraphRowTop(index: number, expand?: CheckpointGraphExpand): number {
	const top = index * CHECKPOINT_GRAPH_ROW_HEIGHT;
	if (expand && expand.at >= 0 && expand.y > 0 && index > expand.at) {
		return top + expand.y;
	}
	return top;
}

/** Scroll that brings `[top, bottom)` fully into view (bottom first), or undefined when it already fits or nothing is measured yet. */
export function checkpointGraphRevealScroll(top: number, bottom: number, scrollTop: number, viewport: number): number | undefined {
	if (viewport <= 0) {
		return undefined;
	}
	if (bottom > scrollTop + viewport) {
		return bottom - viewport;
	}
	return top < scrollTop ? top : undefined;
}

export function checkpointGraphFindScroll(top: number, scrollTop: number, viewport: number): number | undefined {
	return top < scrollTop || top + CHECKPOINT_GRAPH_ROW_HEIGHT > scrollTop + viewport ? top : undefined;
}

/** `GraphMenu`: flip left / up when the menu would overflow the window, keeping an 8px margin. */
export function checkpointGraphMenuPosition(x: number, y: number, width: number, height: number, windowWidth: number, windowHeight: number): { x: number; y: number } {
	return {
		x: x + width > windowWidth ? Math.max(8, x - width) : x,
		y: y + height > windowHeight ? Math.max(8, y - height) : y,
	};
}

export function checkpointGraphWindow(
	count: number,
	scrollTop: number,
	viewportHeight: number,
	expand?: CheckpointGraphExpand,
): { start: number; end: number } {
	if (count <= 0) {
		return { start: 0, end: 0 };
	}
	const height = viewportHeight > 0 ? viewportHeight : GRAPH_WINDOW_FALLBACK_HEIGHT;
	const top = Math.max(0, scrollTop);
	const stretch = expand && expand.at >= 0 && expand.y > 0 ? expand : undefined;
	const start = Math.max(0, graphRowIndexAt(top, stretch) - GRAPH_WINDOW_OVERSCAN);
	const end = Math.min(count, exclusiveGraphRowEnd(top + height, stretch) + GRAPH_WINDOW_OVERSCAN);
	return { start, end };
}

function graphRowIndexAt(y: number, expand?: CheckpointGraphExpand): number {
	const row = CHECKPOINT_GRAPH_ROW_HEIGHT;
	if (!expand || y < 0) {
		return Math.floor(Math.max(0, y) / row);
	}
	const headerEnd = (expand.at + 1) * row;
	if (y < headerEnd) {
		return Math.floor(y / row);
	}
	if (y < headerEnd + expand.y) {
		return expand.at;
	}
	return Math.floor((y - expand.y) / row);
}

function exclusiveGraphRowEnd(bottom: number, expand?: CheckpointGraphExpand): number {
	const row = CHECKPOINT_GRAPH_ROW_HEIGHT;
	if (!expand) {
		return Math.ceil(bottom / row);
	}
	const headerEnd = (expand.at + 1) * row;
	if (bottom <= headerEnd) {
		return Math.ceil(bottom / row);
	}
	if (bottom <= headerEnd + expand.y) {
		return expand.at + 1;
	}
	return Math.ceil((bottom - expand.y) / row);
}

export function drawCheckpointGraph(layout: CheckpointGraphLaneLayout, expand?: CheckpointGraphExpand): CheckpointGraphDrawing {
	const stretch = expand && expand.at >= 0 && expand.y > 0 ? expand : undefined;
	const width = CHECKPOINT_GRAPH_LANE_PAD + Math.max(0, layout.contentWidth - 1) * CHECKPOINT_GRAPH_LANE_GAP + CHECKPOINT_GRAPH_LANE_PAD;
	const height = layout.nodes.length * CHECKPOINT_GRAPH_ROW_HEIGHT + (stretch ? stretch.y : 0);
	return {
		width,
		height,
		paths: layout.segments.map(segment => ({
			d: graphSegmentPath(segment, stretch),
			colorIndex: segment.colorIndex,
		})),
		vertices: layout.nodes.map((node, index) => ({
			id: node.id,
			cx: graphLaneX(node.lane),
			cy: graphCenterY(index, stretch),
			colorIndex: node.colorIndex,
			current: node.current,
		})),
	};
}

function graphLaneX(lane: number): number {
	return CHECKPOINT_GRAPH_LANE_PAD + lane * CHECKPOINT_GRAPH_LANE_GAP;
}

function graphCenterY(row: number, expand?: CheckpointGraphExpand): number {
	return checkpointGraphRowTop(row, expand) + CHECKPOINT_GRAPH_ROW_HEIGHT / 2;
}

function graphSegmentPath(segment: CheckpointGraphLaneSegment, expand?: CheckpointGraphExpand): string {
	const x1 = graphLaneX(segment.lane);
	const x2 = graphLaneX(segment.toLane);
	const y1 = graphCenterY(segment.from, expand);
	const y2 = graphCenterY(segment.to, expand);
	const crosses = expand !== undefined && segment.from <= expand.at && segment.to > expand.at;
	if (x1 !== x2 && crosses) {
		const curveEnd = y2 - expand.y;
		const bend = CHECKPOINT_GRAPH_ROW_HEIGHT * 0.8;
		return `M${fmtGraph(x1)},${fmtGraph(y1)} C${fmtGraph(x1)},${fmtGraph(y1 + bend)} ${fmtGraph(x2)},${fmtGraph(curveEnd - bend)} ${fmtGraph(x2)},${fmtGraph(curveEnd)} L${fmtGraph(x2)},${fmtGraph(y2)}`;
	}
	if (x1 === x2) {
		return `M${fmtGraph(x1)},${fmtGraph(y1)} L${fmtGraph(x2)},${fmtGraph(y2)}`;
	}
	const bend = Math.min(CHECKPOINT_GRAPH_ROW_HEIGHT * 0.8, Math.abs(y2 - y1) * 0.8);
	const direction = y2 >= y1 ? 1 : -1;
	return `M${fmtGraph(x1)},${fmtGraph(y1)} C${fmtGraph(x1)},${fmtGraph(y1 + direction * bend)} ${fmtGraph(x2)},${fmtGraph(y2 - direction * bend)} ${fmtGraph(x2)},${fmtGraph(y2)}`;
}

function fmtGraph(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function checkpointAncestorIds(nodes: readonly CheckpointGraphLineageNode[], headId: string | null): Set<string> {
	const byId = new Map(nodes.map(node => [node.id, node]));
	const seen = new Set<string>();
	const stack = headId ? [headId] : [];
	while (stack.length > 0) {
		const id = stack.pop();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		const node = byId.get(id);
		if (!node) {
			continue;
		}
		for (const parent of node.parents) {
			stack.push(parent);
		}
	}
	return seen;
}

export function checkpointLaneNeighbor(
	nodes: readonly CheckpointGraphLineageNode[],
	lanes: readonly CheckpointGraphLineageLane[],
	id: string,
	direction: 'up' | 'down',
): string | undefined {
	const index = nodes.findIndex(node => node.id === id);
	const lane = lanes.find(item => item.id === id)?.lane;
	if (index < 0 || lane === undefined) {
		return undefined;
	}
	const sameLane = (candidate: string | undefined) => candidate !== undefined && lanes.find(item => item.id === candidate)?.lane === lane;
	if (direction === 'down') {
		const parentId = nodes[index]?.parents[0];
		return sameLane(parentId) ? parentId : undefined;
	}
	for (let row = index - 1; row >= 0; row -= 1) {
		const candidate = nodes[row];
		if (candidate?.parents[0] === id && sameLane(candidate.id)) {
			return candidate.id;
		}
	}
	return undefined;
}

export function checkpointGraphMatches(node: CheckpointGraphMatchFields, branchNames: readonly string[], query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return false;
	}
	if (node.id.toLowerCase().includes(needle) || node.shortId.toLowerCase().includes(needle)) {
		return true;
	}
	if (node.description.toLowerCase().includes(needle)) {
		return true;
	}
	if (node.tags.some(tag => tag.toLowerCase().includes(needle))) {
		return true;
	}
	if ((node.changedPaths ?? []).some(path => path.toLowerCase().includes(needle))) {
		return true;
	}
	return branchNames.some(name => name.toLowerCase().includes(needle));
}

export function formatCheckpointGraphTime(created: string, nowMs = Date.now()): CheckpointGraphTimeLabel {
	const date = new Date(created);
	const time = date.getTime();
	if (!Number.isFinite(time)) {
		return { absolute: created };
	}
	const absolute = date.toLocaleString();
	const elapsed = Math.max(0, nowMs - time);
	if (elapsed < 60_000) {
		return { absolute, relativeKey: 'checkpointGraph.justNow' };
	}
	if (elapsed < 60 * 60_000) {
		const count = Math.floor(elapsed / 60_000);
		return { absolute, relativeKey: count === 1 ? 'checkpointGraph.minuteAgo' : 'checkpointGraph.minutesAgo', count };
	}
	if (elapsed < 24 * 60 * 60_000) {
		const count = Math.floor(elapsed / (60 * 60_000));
		return { absolute, relativeKey: count === 1 ? 'checkpointGraph.hourAgo' : 'checkpointGraph.hoursAgo', count };
	}
	if (elapsed < 7 * 24 * 60 * 60_000) {
		const count = Math.floor(elapsed / (24 * 60 * 60_000));
		return { absolute, relativeKey: count === 1 ? 'checkpointGraph.dayAgo' : 'checkpointGraph.daysAgo', count };
	}
	return { absolute };
}

export function withWorkingTreeNode(
	nodes: readonly IKnoxGuiCheckpointNode[],
	headId: string | undefined,
	paths: readonly string[],
	label: string,
): Array<IKnoxGuiCheckpointNode & { workingTree?: boolean }> {
	if (!paths.length || !headId) {
		return [...nodes];
	}
	return [{
		id: CHECKPOINT_GRAPH_WORKING_TREE_ID,
		description: label,
		created: new Date().toISOString(),
		kind: 'manual',
		tags: [],
		fileChanges: { added: 0, modified: paths.length, deleted: 0 },
		changedPaths: [...paths],
		shortId: '',
		pinned: false,
		parents: [headId],
		workingTree: true,
	}, ...nodes];
}

export function checkpointGraphHeadsById(branches: readonly IKnoxGuiCheckpointBranch[]): Map<string, IKnoxGuiCheckpointBranch[]> {
	const heads = new Map<string, IKnoxGuiCheckpointBranch[]>();
	for (const branch of branches) {
		const list = heads.get(branch.headCheckpointId);
		if (list) {
			list.push(branch);
		} else {
			heads.set(branch.headCheckpointId, [branch]);
		}
	}
	return heads;
}

export function checkpointBranchIsFiltered(branch: IKnoxGuiCheckpointBranch, filter: KnoxCheckpointBranchFilter): boolean {
	if (filter.activeBranchOnly) {
		return branch.isActive;
	}
	if (!filter.branchIds) {
		return true;
	}
	return filter.branchIds.includes(branch.id);
}

export function checkpointFilterAfterBranchToggle(
	branch: IKnoxGuiCheckpointBranch,
	filter: KnoxCheckpointBranchFilter,
	branches: readonly IKnoxGuiCheckpointBranch[],
): KnoxCheckpointBranchFilter {
	const selected = checkpointBranchIsFiltered(branch, filter);
	const ids = branches.map(item => item.id);
	let next: string[];
	if (!filter.branchIds && !filter.activeBranchOnly) {
		next = ids.filter(id => id !== branch.id);
	} else if (filter.activeBranchOnly) {
		next = selected ? ids.filter(id => id !== branch.id) : [branch.id];
	} else if (selected) {
		next = (filter.branchIds ?? []).filter(id => id !== branch.id);
	} else {
		next = [...(filter.branchIds ?? []), branch.id];
	}
	if (next.length === ids.length) {
		return {};
	}
	return { branchIds: next };
}

export function buildCheckpointPathTree(paths: readonly string[]): CheckpointGraphPathTreeNode[] {
	interface BuildNode { name: string; path: string; file: boolean; children: Map<string, BuildNode> }
	const root = new Map<string, BuildNode>();
	for (const relative of paths) {
		const parts = relative.split('/').filter(part => part.length > 0);
		let level = root;
		let current = '';
		for (let index = 0; index < parts.length; index += 1) {
			const part = parts[index] ?? '';
			current = current ? `${current}/${part}` : part;
			const file = index === parts.length - 1;
			let node = level.get(part);
			if (!node) {
				node = { name: part, path: current, file, children: new Map() };
				level.set(part, node);
			} else if (file) {
				node.file = true;
				node.path = current;
			}
			level = node.children;
		}
	}
	const sortNodes = (nodes: BuildNode[]): CheckpointGraphPathTreeNode[] =>
		nodes
			.map(node => ({
				name: node.name,
				path: node.path,
				file: node.file,
				children: sortNodes([...node.children.values()]),
			}))
			.sort((left, right) => {
				if (left.file !== right.file) {
					return left.file ? 1 : -1;
				}
				return left.name.localeCompare(right.name);
			});
	return sortNodes([...root.values()]);
}

export function selectCheckpointIdRange(orderedIds: readonly string[], fromId: string, toId: string): string[] {
	const startIndex = orderedIds.indexOf(fromId);
	const endIndex = orderedIds.indexOf(toId);
	if (startIndex < 0 && endIndex < 0) {
		return [];
	}
	if (startIndex < 0) {
		return [toId];
	}
	if (endIndex < 0) {
		return [fromId];
	}
	const start = Math.min(startIndex, endIndex);
	const end = Math.max(startIndex, endIndex);
	return orderedIds.slice(start, end + 1);
}

export function checkpointKindI18nKey(kind: string): string {
	return CHECKPOINT_GRAPH_KIND_I18N[kind] ?? 'checkpointGraph.kindManual';
}

export function checkpointKindClass(kind: string): string {
	return CHECKPOINT_GRAPH_KIND_CLASS[kind] ?? CHECKPOINT_GRAPH_KIND_CLASS.manual;
}

export function resolveCheckpointLaneColor(colorIndex: number, palette: readonly string[]): string {
	const custom = palette[colorIndex % palette.length];
	return custom && /^#[0-9a-fA-F]{6}$/.test(custom) ? custom : checkpointGraphLaneColor(colorIndex);
}

const CHECKPOINT_GRAPH_LANE_COLORS_LIGHT = ['#4078f2', '#50a14f', '#c18401', '#e45649', '#a626a4', '#0184bc', '#986801', '#383a42'] as const;

export function remapCheckpointBranchColor(color: string, light: boolean): string {
	if (!light) {
		return color;
	}
	const index = CHECKPOINT_GRAPH_LANE_COLORS.indexOf(color as typeof CHECKPOINT_GRAPH_LANE_COLORS[number]);
	if (index >= 0) {
		return CHECKPOINT_GRAPH_LANE_COLORS_LIGHT[index];
	}
	return color;
}

export function checkpointThemeIsLight(): boolean {
	if (typeof document === 'undefined') {
		return false;
	}
	const kind = document.documentElement.getAttribute('data-vscode-theme-kind') ?? '';
	if (kind.includes('light')) {
		return true;
	}
	return document.body.classList.contains('vscode-light');
}

export function checkpointGraphForceMountKey(input: {
	checkpoints: ReadonlyArray<{ id: string; parents: readonly string[]; description: string; kind: string; created: string; pinned: boolean; tags: readonly string[]; changedPaths: readonly string[] }>;
	branches: ReadonlyArray<{ id: string; name: string; headCheckpointId: string; isActive: boolean; color?: string }>;
	ui: unknown;
	workingTreePaths?: readonly string[];
	headId?: string;
	workspace?: string;
	hasMore: boolean;
	loadMoreError?: string;
	findOpen: boolean;
	findQuery: string;
	findIndex: number;
	findOpenDetails: boolean;
	openId: string | null;
	menu: unknown;
	prompt: unknown;
	promptValue: string;
	settingsOpen: boolean;
	compare: unknown;
	comparePaths: unknown;
	compareError: unknown;
	armCompare: boolean;
	scrollTop: number;
	viewport: number;
	pendingHead: boolean;
	expandedFolders: readonly string[];
	/** The cached graph holds translated text, so a language switch must invalidate it. */
	language?: string;
}): string {
	return JSON.stringify(input);
}
