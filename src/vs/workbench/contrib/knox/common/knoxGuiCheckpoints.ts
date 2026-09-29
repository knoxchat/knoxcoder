/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiCheckpointBranch, IKnoxGuiCheckpointNode } from './knoxGuiState.js';
import { fuzzyTitleMatch, parseHistoryDate } from './knoxGuiOverlays.js';

export const CHECKPOINT_GRAPH_LANE_COLORS = [
	'#61afef', '#98c379', '#e5c07b', '#e06c75', '#c678dd', '#56b6c2', '#d19a66', '#abb2bf',
] as const;

export const CHECKPOINT_GRAPH_PAGE_SIZE = 100;
export const CHECKPOINT_SHELL_STATES = ['loading', 'no-workspace', 'not-initialized', 'empty', 'ready', 'failed'] as const;
export type KnoxCheckpointShellState = typeof CHECKPOINT_SHELL_STATES[number];

export function checkpointGraphLaneColor(colorIndex: number): string {
	const palette = CHECKPOINT_GRAPH_LANE_COLORS;
	const wrapped = ((colorIndex % palette.length) + palette.length) % palette.length;
	return palette[wrapped];
}

export interface CheckpointGraphLaneInput {
	id: string;
	parents: readonly string[];
}

export interface CheckpointGraphLaneSegment {
	from: number;
	to: number;
	lane: number;
	toLane: number;
	colorIndex: number;
	mergeCurve: boolean;
}

export interface CheckpointGraphLaneNode {
	id: string;
	lane: number;
	colorIndex: number;
	current: boolean;
	segments: CheckpointGraphLaneSegment[];
}

export interface CheckpointGraphLaneLayout {
	nodes: CheckpointGraphLaneNode[];
	segments: CheckpointGraphLaneSegment[];
	contentWidth: number;
}

const NULL_ROW = -1;

class LaneBranch {
	constructor(readonly colorIndex: number) { }
}

class LaneVertex {
	parents: LaneVertex[] = [];
	nextParent = 0;
	branch: LaneBranch | null = null;
	lane = 0;
	nextLane = 0;
	current = false;
	private connections: Array<{ connectsTo: LaneVertex | null; onBranch: LaneBranch } | undefined> = [];

	constructor(readonly row: number) { }

	getNextParent(): LaneVertex | null {
		return this.nextParent < this.parents.length ? this.parents[this.nextParent] : null;
	}

	registerParentProcessed(): void {
		this.nextParent += 1;
	}

	isMerge(): boolean {
		return this.parents.length > 1;
	}

	isNotOnBranch(): boolean {
		return this.branch === null;
	}

	addToBranch(branch: LaneBranch, lane: number): void {
		if (this.branch === null) {
			this.branch = branch;
			this.lane = lane;
		}
	}

	getPoint(): { row: number; lane: number } {
		return { row: this.row, lane: this.lane };
	}

	getNextPoint(): { row: number; lane: number } {
		return { row: this.row, lane: this.nextLane };
	}

	getPointConnectingTo(vertex: LaneVertex, onBranch: LaneBranch): { row: number; lane: number } | null {
		for (let lane = 0; lane < this.connections.length; lane += 1) {
			const connection = this.connections[lane];
			if (connection && connection.connectsTo === vertex && connection.onBranch === onBranch) {
				return { row: this.row, lane };
			}
		}
		return null;
	}

	registerUnavailablePoint(lane: number, connectsTo: LaneVertex | null, onBranch: LaneBranch): void {
		if (lane === this.nextLane) {
			this.nextLane = lane + 1;
			this.connections[lane] = { connectsTo, onBranch };
		}
	}
}

export function layoutCheckpointLanes(
	nodes: readonly CheckpointGraphLaneInput[],
	headId?: string | null,
): CheckpointGraphLaneLayout {
	if (nodes.length === 0) {
		return { nodes: [], segments: [], contentWidth: 0 };
	}
	const vertices = nodes.map((_, row) => new LaneVertex(row));
	const nullVertex = new LaneVertex(NULL_ROW);
	const segments: Array<{ from: { row: number; lane: number }; to: { row: number; lane: number }; colorIndex: number; mergeCurve: boolean }> = [];
	const availableColours: number[] = [];
	let headMarked = false;
	for (let row = 0; row < nodes.length; row += 1) {
		const vertex = vertices[row];
		for (const parentId of nodes[row].parents) {
			const parentRow = rowBelow(nodes, parentId, row);
			vertex.parents.push(parentRow === undefined ? nullVertex : vertices[parentRow]);
		}
		if (!headMarked && headId && nodes[row].id === headId) {
			vertex.current = true;
			headMarked = true;
		}
	}
	const addLine = (branch: LaneBranch, from: { row: number; lane: number }, to: { row: number; lane: number }, mergeCurve: boolean) => {
		segments.push({ from, to, colorIndex: branch.colorIndex, mergeCurve });
	};
	const getAvailableColour = (startAt: number): number => {
		for (let index = 0; index < availableColours.length; index += 1) {
			if (startAt > availableColours[index]) {
				return index;
			}
		}
		availableColours.push(0);
		return availableColours.length - 1;
	};
	const determinePath = (startAt: number) => {
		let vertex = vertices[startAt];
		let parentVertex = vertex.getNextParent();
		const linkingExtraParent = vertex.nextParent > 0;
		let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
		const parentBranch =
			parentVertex !== null
				&& parentVertex.row !== NULL_ROW
				&& vertex.isMerge()
				&& vertex.branch !== null
				&& parentVertex.branch !== null
				? parentVertex.branch
				: null;
		if (parentVertex !== null && parentBranch !== null) {
			const target = parentVertex;
			let found = false;
			for (let row = startAt + 1; row < vertices.length; row += 1) {
				const curVertex = vertices[row];
				const connected = curVertex.getPointConnectingTo(target, parentBranch);
				const curPoint = connected ?? curVertex.getNextPoint();
				if (connected !== null) {
					found = true;
				}
				addLine(parentBranch, lastPoint, curPoint, true);
				curVertex.registerUnavailablePoint(curPoint.lane, target, parentBranch);
				lastPoint = curPoint;
				if (found) {
					vertex.registerParentProcessed();
					break;
				}
			}
			if (!found) {
				vertex.registerParentProcessed();
			}
			return;
		}
		const branch = new LaneBranch(getAvailableColour(startAt));
		vertex.addToBranch(branch, lastPoint.lane);
		vertex.registerUnavailablePoint(lastPoint.lane, vertex, branch);
		let row = startAt + 1;
		let reachedExtraParent = false;
		for (; row < vertices.length; row += 1) {
			const curVertex = vertices[row];
			const curPoint =
				parentVertex !== null && parentVertex === curVertex && !parentVertex.isNotOnBranch()
					? curVertex.getPoint()
					: curVertex.getNextPoint();
			const stillApproachingExtraParent = linkingExtraParent && !reachedExtraParent;
			addLine(branch, lastPoint, curPoint, stillApproachingExtraParent);
			curVertex.registerUnavailablePoint(curPoint.lane, parentVertex, branch);
			lastPoint = curPoint;
			if (parentVertex !== null && parentVertex === curVertex) {
				vertex.registerParentProcessed();
				const parentVertexOnBranch = !parentVertex.isNotOnBranch();
				parentVertex.addToBranch(branch, curPoint.lane);
				vertex = parentVertex;
				parentVertex = vertex.getNextParent();
				if (stillApproachingExtraParent) {
					reachedExtraParent = true;
				}
				if (parentVertex === null || parentVertexOnBranch) {
					break;
				}
			}
		}
		if (row === vertices.length && parentVertex !== null && parentVertex.row === NULL_ROW) {
			vertex.registerParentProcessed();
		}
		availableColours[branch.colorIndex] = row;
	};
	let row = 0;
	while (row < vertices.length) {
		const vertex = vertices[row];
		if (vertex.getNextParent() !== null || vertex.isNotOnBranch()) {
			determinePath(row);
		} else {
			row += 1;
		}
	}
	const paletteLength = CHECKPOINT_GRAPH_LANE_COLORS.length;
	const byRow: CheckpointGraphLaneSegment[][] = vertices.map(() => []);
	const flat = segments.map(segment => {
		const shaped: CheckpointGraphLaneSegment = {
			from: segment.from.row,
			to: segment.to.row,
			lane: segment.from.lane,
			toLane: segment.to.lane,
			colorIndex: segment.colorIndex % paletteLength,
			mergeCurve: segment.mergeCurve,
		};
		byRow[segment.from.row]?.push(shaped);
		return shaped;
	});
	let contentWidth = 0;
	const laidOut = vertices.map((vertex, index) => {
		if (vertex.nextLane > contentWidth) {
			contentWidth = vertex.nextLane;
		}
		return {
			id: nodes[index].id,
			lane: vertex.lane,
			colorIndex: (vertex.branch?.colorIndex ?? 0) % paletteLength,
			current: vertex.current,
			segments: byRow[index],
		};
	});
	return { nodes: laidOut, segments: flat, contentWidth };
}

function rowBelow(nodes: readonly CheckpointGraphLaneInput[], parentId: string, fromRow: number): number | undefined {
	for (let row = fromRow + 1; row < nodes.length; row += 1) {
		if (nodes[row].id === parentId) {
			return row;
		}
	}
	return undefined;
}

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

export type KnoxRestorePreviewAction = 'overwrite' | 'create' | 'delete';
export type KnoxCheckpointDiffStatus = 'added' | 'deleted' | 'modified' | 'unchanged';
export type KnoxCheckpointDiffView = 'split' | 'unified';

export interface IKnoxGuiRestorePreviewFile {
	relativePath: string;
	action: KnoxRestorePreviewAction;
	additions: number;
	deletions: number;
	hunkCount: number;
}

export interface IKnoxGuiRestorePreview {
	checkpointId: string;
	description: string;
	modified: number;
	added: number;
	deleted: number;
	files: IKnoxGuiRestorePreviewFile[];
	writePaths: string[];
	extraPaths: string[];
	skippedFiles: Array<{ path: string; reason: string }>;
}

export interface IKnoxGuiCheckpointFileSnapshot {
	relativePath: string;
	content: string;
	encoding: string;
	size: number;
}

export interface IKnoxGuiCheckpointDiffFile {
	relativePath: string;
	status: KnoxCheckpointDiffStatus;
	oldContent: string | null;
	newContent: string | null;
	oldEncoding?: string;
	newEncoding?: string;
	isBinary: boolean;
	additions: number;
	deletions: number;
}

export interface IKnoxGuiCheckpointDiff {
	oldCheckpoint: { id: string; description: string; created: string };
	newCheckpoint: { id: string; description: string; created: string };
	files: IKnoxGuiCheckpointDiffFile[];
}

export interface IKnoxGuiCheckpointFileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children?: IKnoxGuiCheckpointFileTreeNode[];
}

export interface IKnoxGuiDiffLine {
	type: 'context' | 'added' | 'removed';
	oldLineNum: number | null;
	newLineNum: number | null;
	content: string;
}

export interface IKnoxGuiDiffHunk {
	oldStart: number;
	newStart: number;
	lines: IKnoxGuiDiffLine[];
}

export const CHECKPOINT_CHART_MIN_DAYS = 14;
/** KN-375: match PerformanceDashboard + KN-327 engine default. */
export const CHECKPOINT_DASHBOARD_HISTORY_DAYS = 30;
export const CHECKPOINT_ANALYSIS_GROUP_LIMIT = 50;

export interface IKnoxGuiCheckpointConfig {
	maxCheckpoints: number;
	retentionDays: number;
	maxStorageBytes: number;
	maxFilesPerCheckpoint: number;
	maxFileSizeBytes: number;
	captureBinaryFiles: boolean;
	enableCompression: boolean;
	encryptAtRest: boolean;
	enableAutoCheckpoints: boolean;
	trackedExtensions: string[];
	autoCleanup: boolean;
	cleanupIntervalHours: number;
	autoEnabled: boolean;
	autoMinIntervalMs: number;
	autoFileChangeThreshold: number;
	autoShowNotifications: boolean;
}

export const DEFAULT_CHECKPOINT_CONFIG: IKnoxGuiCheckpointConfig = {
	maxCheckpoints: 1000,
	retentionDays: 7,
	maxStorageBytes: 1_000_000_000,
	maxFilesPerCheckpoint: 10_000,
	maxFileSizeBytes: 5_242_880,
	captureBinaryFiles: true,
	enableCompression: true,
	encryptAtRest: false,
	enableAutoCheckpoints: true,
	trackedExtensions: ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'md', 'txt'],
	autoCleanup: true,
	cleanupIntervalHours: 24,
	autoEnabled: true,
	autoMinIntervalMs: 60_000,
	autoFileChangeThreshold: 5,
	autoShowNotifications: false,
};

export const CHECKPOINT_CLEANUP_INTERVALS = [
	{ value: 1, key: 'hourly' },
	{ value: 6, key: 'every6Hours' },
	{ value: 12, key: 'every12Hours' },
	{ value: 24, key: 'daily' },
	{ value: 72, key: 'every3Days' },
	{ value: 168, key: 'weekly' },
] as const;

const STORAGE_UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };

export function parseStorageBytes(value: string): number | null {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
	if (!match) {
		return null;
	}
	const size = Number(match[1]);
	const unit = (match[2]?.toUpperCase() ?? 'B');
	if (!Number.isFinite(size) || size <= 0 || !STORAGE_UNITS[unit]) {
		return null;
	}
	return Math.round(size * STORAGE_UNITS[unit]);
}

export function formatCheckpointBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

export function parseTrackedExtensions(value: string): string[] {
	return Array.from(new Set(value.split(',').map(ext => ext.trim().replace(/^\.+/, '').toLowerCase()).filter(Boolean)));
}

function toNumber(value: unknown, fallback: number): number {
	const numberValue = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function normalizeCheckpointConfig(value: Partial<IKnoxGuiCheckpointConfig> | null | undefined): IKnoxGuiCheckpointConfig {
	return {
		maxCheckpoints: toNumber(value?.maxCheckpoints, DEFAULT_CHECKPOINT_CONFIG.maxCheckpoints),
		retentionDays: toNumber(value?.retentionDays, DEFAULT_CHECKPOINT_CONFIG.retentionDays),
		maxStorageBytes: toNumber(value?.maxStorageBytes, DEFAULT_CHECKPOINT_CONFIG.maxStorageBytes),
		maxFilesPerCheckpoint: toNumber(value?.maxFilesPerCheckpoint, DEFAULT_CHECKPOINT_CONFIG.maxFilesPerCheckpoint),
		maxFileSizeBytes: toNumber(value?.maxFileSizeBytes, DEFAULT_CHECKPOINT_CONFIG.maxFileSizeBytes),
		captureBinaryFiles: typeof value?.captureBinaryFiles === 'boolean' ? value.captureBinaryFiles : DEFAULT_CHECKPOINT_CONFIG.captureBinaryFiles,
		enableCompression: typeof value?.enableCompression === 'boolean' ? value.enableCompression : DEFAULT_CHECKPOINT_CONFIG.enableCompression,
		encryptAtRest: typeof value?.encryptAtRest === 'boolean' ? value.encryptAtRest : DEFAULT_CHECKPOINT_CONFIG.encryptAtRest,
		enableAutoCheckpoints: typeof value?.enableAutoCheckpoints === 'boolean' ? value.enableAutoCheckpoints : DEFAULT_CHECKPOINT_CONFIG.enableAutoCheckpoints,
		trackedExtensions: Array.isArray(value?.trackedExtensions) ? value.trackedExtensions.map(String) : DEFAULT_CHECKPOINT_CONFIG.trackedExtensions,
		autoCleanup: typeof value?.autoCleanup === 'boolean' ? value.autoCleanup : DEFAULT_CHECKPOINT_CONFIG.autoCleanup,
		cleanupIntervalHours: toNumber(value?.cleanupIntervalHours, DEFAULT_CHECKPOINT_CONFIG.cleanupIntervalHours),
		autoEnabled: typeof value?.autoEnabled === 'boolean' ? value.autoEnabled : DEFAULT_CHECKPOINT_CONFIG.autoEnabled,
		autoMinIntervalMs: toNumber(value?.autoMinIntervalMs, DEFAULT_CHECKPOINT_CONFIG.autoMinIntervalMs),
		autoFileChangeThreshold: toNumber(value?.autoFileChangeThreshold, DEFAULT_CHECKPOINT_CONFIG.autoFileChangeThreshold),
		autoShowNotifications: typeof value?.autoShowNotifications === 'boolean' ? value.autoShowNotifications : DEFAULT_CHECKPOINT_CONFIG.autoShowNotifications,
	};
}

export function validateCheckpointConfig(config: IKnoxGuiCheckpointConfig): Partial<Record<keyof IKnoxGuiCheckpointConfig, boolean>> {
	return {
		maxCheckpoints: !(Number.isInteger(config.maxCheckpoints) && config.maxCheckpoints >= 1 && config.maxCheckpoints <= 10000),
		retentionDays: !(Number.isInteger(config.retentionDays) && config.retentionDays >= 1 && config.retentionDays <= 365),
		maxStorageBytes: !(config.maxStorageBytes >= 1024 * 1024),
		maxFilesPerCheckpoint: !(Number.isInteger(config.maxFilesPerCheckpoint) && config.maxFilesPerCheckpoint >= 1 && config.maxFilesPerCheckpoint <= 100000),
		maxFileSizeBytes: !(config.maxFileSizeBytes >= 1024),
		autoMinIntervalMs: !(Number.isInteger(config.autoMinIntervalMs) && config.autoMinIntervalMs >= 1000 && config.autoMinIntervalMs <= 3_600_000),
		autoFileChangeThreshold: !(Number.isInteger(config.autoFileChangeThreshold) && config.autoFileChangeThreshold >= 1 && config.autoFileChangeThreshold <= 10000),
	};
}

/** `CheckpointConfig.tsx` `getValidationErrors`: per-field i18n keys; storage sizes are validated from the raw text. */
export function checkpointConfigFieldErrors(config: IKnoxGuiCheckpointConfig, storageInput: string, fileSizeInput: string): Partial<Record<keyof IKnoxGuiCheckpointConfig, string>> {
	const numeric = validateCheckpointConfig(config);
	const errors: Partial<Record<keyof IKnoxGuiCheckpointConfig, string>> = {};
	const fileSize = parseStorageBytes(fileSizeInput);
	if (fileSize === null || fileSize < 1024) {
		errors.maxFileSizeBytes = 'checkpointInvalidFileSize';
	}
	if (numeric.maxCheckpoints) {
		errors.maxCheckpoints = 'checkpointInvalidMaxCheckpoints';
	}
	if (numeric.retentionDays) {
		errors.retentionDays = 'checkpointInvalidRetentionDays';
	}
	const storage = parseStorageBytes(storageInput);
	if (storage === null || storage < 1024 * 1024) {
		errors.maxStorageBytes = 'checkpointInvalidStorageSize';
	}
	if (numeric.maxFilesPerCheckpoint) {
		errors.maxFilesPerCheckpoint = 'checkpointInvalidMaxFiles';
	}
	if (numeric.autoMinIntervalMs) {
		errors.autoMinIntervalMs = 'checkpointInvalidAutoInterval';
	}
	if (numeric.autoFileChangeThreshold) {
		errors.autoFileChangeThreshold = 'checkpointInvalidAutoFileThreshold';
	}
	return errors;
}

/** `hasChanges`: an unparseable storage input that differs from the saved value also counts as a change. */
export function checkpointConfigIsDirty(draft: IKnoxGuiCheckpointConfig, original: IKnoxGuiCheckpointConfig | undefined, storageInput: string): boolean {
	const saved = original ?? DEFAULT_CHECKPOINT_CONFIG;
	return checkpointConfigHasChanges(draft, saved) || (parseStorageBytes(storageInput) === null && storageInput.trim() !== formatCheckpointBytes(saved.maxStorageBytes));
}

/** `getNumberValue`: `parseInt`, falling back when the field is empty or non-numeric. */
export function checkpointConfigNumber(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function checkpointConfigHasErrors(errors: Partial<Record<keyof IKnoxGuiCheckpointConfig, boolean>>): boolean {
	return Object.values(errors).some(Boolean);
}

export function restorePreviewActionKey(action: KnoxRestorePreviewAction): string {
	if (action === 'overwrite') {
		return 'restorePreviewWillOverwrite';
	}
	if (action === 'create') {
		return 'restorePreviewWillCreate';
	}
	return 'restorePreviewWillDelete';
}

export function buildCheckpointFileTree(paths: readonly string[]): IKnoxGuiCheckpointFileTreeNode[] {
	interface Internal { name: string; path: string; isDirectory: boolean; children?: Record<string, Internal> }
	const root: Record<string, Internal> = {};
	for (const relativePath of paths) {
		const parts = relativePath.split('/').filter(Boolean);
		let current = root;
		let currentPath = '';
		parts.forEach((part, index) => {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const isFile = index === parts.length - 1;
			if (!current[part]) {
				current[part] = { name: part, path: currentPath, isDirectory: !isFile, children: isFile ? undefined : {} };
			}
			if (!isFile && current[part].children) {
				current = current[part].children!;
			}
		});
	}
	const convert = (obj: Record<string, Internal>): IKnoxGuiCheckpointFileTreeNode[] => Object.values(obj)
		.map(node => ({
			name: node.name,
			path: node.path,
			isDirectory: node.isDirectory,
			children: node.children ? convert(node.children) : undefined,
		}))
		.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
	return convert(root);
}

export function countLineDelta(fromText: string, toText: string): { additions: number; deletions: number; hunkCount: number } {
	if (fromText === toText) {
		return { additions: 0, deletions: 0, hunkCount: 0 };
	}
	const fromLines = fromText.length === 0 ? [] : fromText.split('\n');
	const toLines = toText.length === 0 ? [] : toText.split('\n');
	const remaining = new Map<string, number>();
	for (const line of fromLines) {
		remaining.set(line, (remaining.get(line) ?? 0) + 1);
	}
	let common = 0;
	for (const line of toLines) {
		const count = remaining.get(line) ?? 0;
		if (count > 0) {
			common += 1;
			remaining.set(line, count - 1);
		}
	}
	const deletions = fromLines.length - common;
	const additions = toLines.length - common;
	const max = Math.max(fromLines.length, toLines.length);
	let inHunk = false;
	let hunkCount = 0;
	for (let i = 0; i < max; i += 1) {
		const changed = fromLines[i] !== toLines[i];
		if (changed && !inHunk) {
			hunkCount += 1;
			inHunk = true;
		} else if (!changed) {
			inHunk = false;
		}
	}
	return { additions, deletions, hunkCount: Math.max(hunkCount, additions > 0 || deletions > 0 ? 1 : 0) };
}

export function computeLineDiff(oldText: string, newText: string): IKnoxGuiDiffLine[] {
	const a = oldText.length === 0 ? [] : oldText.split('\n');
	const b = newText.length === 0 ? [] : newText.split('\n');
	const n = a.length;
	const m = b.length;
	if (n * m > 250_000) {
		const lines: IKnoxGuiDiffLine[] = [];
		a.forEach((content, index) => lines.push({ type: 'removed', oldLineNum: index + 1, newLineNum: null, content }));
		b.forEach((content, index) => lines.push({ type: 'added', oldLineNum: null, newLineNum: index + 1, content }));
		return lines;
	}
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = 1; i <= n; i += 1) {
		for (let j = 1; j <= m; j += 1) {
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	const lines: IKnoxGuiDiffLine[] = [];
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			lines.push({ type: 'context', oldLineNum: i, newLineNum: j, content: a[i - 1] });
			i -= 1;
			j -= 1;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			lines.push({ type: 'added', oldLineNum: null, newLineNum: j, content: b[j - 1] });
			j -= 1;
		} else {
			lines.push({ type: 'removed', oldLineNum: i, newLineNum: null, content: a[i - 1] });
			i -= 1;
		}
	}
	return lines.reverse();
}

export function groupDiffHunks(lines: IKnoxGuiDiffLine[], context = 3): IKnoxGuiDiffHunk[] {
	const changeIndexes: number[] = [];
	lines.forEach((line, index) => {
		if (line.type !== 'context') {
			changeIndexes.push(index);
		}
	});
	if (!changeIndexes.length) {
		return lines.length ? [{ oldStart: lines[0]?.oldLineNum ?? 1, newStart: lines[0]?.newLineNum ?? 1, lines }] : [];
	}
	const hunks: IKnoxGuiDiffHunk[] = [];
	let start = Math.max(0, changeIndexes[0] - context);
	let prev = changeIndexes[0];
	const flush = (endIndex: number) => {
		const end = Math.min(lines.length, endIndex + context + 1);
		const slice = lines.slice(start, end);
		hunks.push({
			oldStart: slice.find(line => line.oldLineNum != null)?.oldLineNum ?? 1,
			newStart: slice.find(line => line.newLineNum != null)?.newLineNum ?? 1,
			lines: slice,
		});
	};
	for (let i = 1; i <= changeIndexes.length; i += 1) {
		const index = changeIndexes[i];
		if (index === undefined || index - prev > context * 2 + 1) {
			flush(prev);
			if (index !== undefined) {
				start = Math.max(0, index - context);
				prev = index;
			}
		} else {
			prev = index;
		}
	}
	return hunks;
}

export interface IKnoxGuiTextRange {
	start: number;
	end: number;
}

export function wordAltRanges(before: string, after: string): { before: IKnoxGuiTextRange[]; after: IKnoxGuiTextRange[] } {
	const a = splitDiffTokens(before);
	const b = splitDiffTokens(after);
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = 1; i <= n; i += 1) {
		for (let j = 1; j <= m; j += 1) {
			dp[i][j] = a[i - 1].text === b[j - 1].text ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	const keepA = new Array<boolean>(n).fill(false);
	const keepB = new Array<boolean>(m).fill(false);
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1].text === b[j - 1].text) {
			keepA[i - 1] = true;
			keepB[j - 1] = true;
			i -= 1;
			j -= 1;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			j -= 1;
		} else {
			i -= 1;
		}
	}
	return {
		before: tokenChangeRanges(a, keepA, before.length),
		after: tokenChangeRanges(b, keepB, after.length),
	};
}

function splitDiffTokens(text: string): Array<{ text: string; start: number }> {
	const tokens: Array<{ text: string; start: number }> = [];
	const re = /(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text))) {
		tokens.push({ text: match[0], start: match.index });
	}
	return tokens;
}

function tokenChangeRanges(tokens: Array<{ text: string; start: number }>, keep: boolean[], length: number): IKnoxGuiTextRange[] {
	const ranges: IKnoxGuiTextRange[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		if (keep[index] || /^\s+$/.test(tokens[index].text)) {
			continue;
		}
		const start = tokens[index].start;
		let end = start + tokens[index].text.length;
		while (index + 1 < tokens.length && (!keep[index + 1] || /^\s+$/.test(tokens[index + 1].text))) {
			index += 1;
			if (!keep[index]) {
				end = tokens[index].start + tokens[index].text.length;
			}
		}
		ranges.push({ start, end: Math.min(end, length) });
	}
	return ranges;
}

/** Pierre `lineDiffType: "word-alt"` — pair consecutive removed/added lines in a hunk. */
export function hunkWordAltRanges(lines: IKnoxGuiDiffLine[]): Array<IKnoxGuiTextRange[] | undefined> {
	const result: Array<IKnoxGuiTextRange[] | undefined> = lines.map(() => undefined);
	let index = 0;
	while (index < lines.length) {
		if (lines[index].type === 'context') {
			index += 1;
			continue;
		}
		const removed: number[] = [];
		const added: number[] = [];
		while (index < lines.length && lines[index].type !== 'context') {
			if (lines[index].type === 'removed') {
				removed.push(index);
			} else {
				added.push(index);
			}
			index += 1;
		}
		const pairs = Math.min(removed.length, added.length);
		for (let pair = 0; pair < pairs; pair += 1) {
			const spans = wordAltRanges(lines[removed[pair]].content, lines[added[pair]].content);
			result[removed[pair]] = spans.before;
			result[added[pair]] = spans.after;
		}
	}
	return result;
}

export interface IKnoxGuiSplitDiffRow {
	left?: number;
	right?: number;
}

/** Aligned split rows: context on both sides, each removed/added run paired row by row. Values index into `lines`. */
export function alignSplitDiffRows(lines: IKnoxGuiDiffLine[]): IKnoxGuiSplitDiffRow[] {
	const rows: IKnoxGuiSplitDiffRow[] = [];
	let index = 0;
	while (index < lines.length) {
		if (lines[index].type === 'context') {
			rows.push({ left: index, right: index });
			index += 1;
			continue;
		}
		const removed: number[] = [];
		const added: number[] = [];
		while (index < lines.length && lines[index].type !== 'context') {
			(lines[index].type === 'removed' ? removed : added).push(index);
			index += 1;
		}
		for (let row = 0; row < Math.max(removed.length, added.length); row += 1) {
			rows.push({ left: removed[row], right: added[row] });
		}
	}
	return rows;
}

export interface IKnoxGuiDiffSegment {
	kind: 'lines' | 'gap';
	start: number;
	end: number;
}

/** Splits a full line diff into visible runs (changes plus `context` lines) and collapsible unchanged gaps. */
export function buildDiffSegments(lines: IKnoxGuiDiffLine[], context = 3): IKnoxGuiDiffSegment[] {
	const visible = lines.map(() => false);
	lines.forEach((line, index) => {
		if (line.type !== 'context') {
			for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near += 1) {
				visible[near] = true;
			}
		}
	});
	const segments: IKnoxGuiDiffSegment[] = [];
	lines.forEach((_line, index) => {
		const kind = visible[index] ? 'lines' : 'gap';
		const last = segments[segments.length - 1];
		if (last?.kind === kind) {
			last.end = index + 1;
		} else {
			segments.push({ kind, start: index, end: index + 1 });
		}
	});
	return segments;
}

export function checkpointDiffChangedFiles<T extends { status: string }>(files: T[]): T[] {
	return files.filter(file => file.status !== 'unchanged');
}

export function checkpointDiffSummary(files: Array<{ status: string; additions: number; deletions: number }>): { filesChanged: number; additions: number; deletions: number } {
	const changed = checkpointDiffChangedFiles(files);
	return {
		filesChanged: changed.length,
		additions: changed.reduce((sum, file) => sum + file.additions, 0),
		deletions: changed.reduce((sum, file) => sum + file.deletions, 0),
	};
}

export function checkpointDiffContentBytes(content: string | null, encoding?: string): number | undefined {
	if (content === null) {
		return undefined;
	}
	return encoding === 'base64' ? Math.floor(content.replace(/=+$/, '').length * 3 / 4) : content.length;
}

export function checkpointRiskChipClass(level: string): string {
	switch (level) {
		case 'Low': return 'odp-chip-green';
		case 'Medium': return 'odp-chip-yellow';
		case 'High': return 'odp-chip-orange';
		case 'Critical': return 'odp-chip-red';
		default: return 'odp-chip-muted';
	}
}

export function checkpointScopeChipClass(scope: string): string {
	switch (scope) {
		case 'Isolated': return 'odp-chip-muted';
		case 'Module': return 'odp-chip-blue';
		case 'CrossModule': return 'odp-chip-purple';
		case 'SystemWide': return 'odp-chip-red';
		default: return 'odp-chip-muted';
	}
}

export function checkpointImpactChipClass(level: string): string {
	switch (level) {
		case 'High': return 'odp-chip-red';
		case 'Medium': return 'odp-chip-yellow';
		default: return 'odp-chip-green';
	}
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
}): string {
	return JSON.stringify(input);
}

export function utcDayKey(iso: string): string {
	const parsed = Date.parse(iso);
	if (!Number.isFinite(parsed)) {
		return iso.slice(0, 10);
	}
	return new Date(parsed).toISOString().slice(0, 10);
}

export function formatChartTick(isoDay: string): string {
	const [, month, day] = isoDay.split('-');
	return month && day ? `${Number(month)}/${Number(day)}` : isoDay;
}

/** `PerformanceDashboard.tsx` `formatDuration`. */
export function formatCheckpointDuration(ms: number): string {
	return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** `PerformanceDashboard.tsx` `formatBytes` (trailing `.0` dropped). */
export function formatDashboardBytes(bytes: number): string {
	if (!bytes) {
		return '0 B';
	}
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
	return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

/** Recharts `interval` for the day axis: every label up to 8 days, then about 7 labels. */
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

export function checkpointChartTickInterval(length: number): number {
	return length <= 8 ? 0 : Math.max(0, Math.ceil(length / 7) - 1);
}

/** Recharts `getNiceTickValues([0, max], tickCount, false)` for a `[0, 'auto']` YAxis with `allowDecimals={false}`: always `tickCount` integer ticks. */
export function checkpointChartYTicks(max: number, tickCount = 5): number[] {
	const count = Math.max(tickCount, 2);
	if (!(max > 0)) {
		return Array.from({ length: count }, (_, i) => i);
	}
	const precise = (value: number) => Number(value.toPrecision(12));
	for (let correction = 0; ; correction++) {
		const rough = max / (count - 1);
		const digits = Math.floor(Math.log10(rough)) + 1;
		const unit = Math.pow(10, digits);
		const scale = digits !== 1 ? 0.05 : 0.1;
		const step = Math.ceil(precise((Math.ceil(precise(rough / unit / scale)) + correction) * scale * unit));
		if (Math.ceil(precise(max / step)) + 1 <= count) {
			return Array.from({ length: count }, (_, i) => i * step);
		}
	}
}

export function compactAxisNumber(value: number): string {
	if (Math.abs(value) >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${millions >= 10 || millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
	}
	if (Math.abs(value) >= 1_000) {
		const thousands = value / 1_000;
		return `${thousands >= 10 || thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
	}
	return String(Math.round(value));
}

export function fillDailyCounts(
	points: Array<{ bucket: string; count: number }>,
	minDays = CHECKPOINT_CHART_MIN_DAYS,
): Array<{ date: string; count: number; iso: string }> {
	const byDay = new Map<string, number>();
	for (const point of points) {
		const key = utcDayKey(point.bucket);
		byDay.set(key, (byDay.get(key) ?? 0) + point.count);
	}
	const keys = [...byDay.keys()].sort();
	const end = keys.length > 0
		? new Date(`${keys[keys.length - 1]}T00:00:00.000Z`)
		: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
	const paddedStart = new Date(end);
	paddedStart.setUTCDate(paddedStart.getUTCDate() - (Math.max(minDays, 1) - 1));
	const dataStart = keys.length > 0 ? new Date(`${keys[0]}T00:00:00.000Z`) : paddedStart;
	const start = dataStart < paddedStart ? dataStart : paddedStart;
	const maxSpanMs = 30 * 24 * 60 * 60 * 1000;
	const clampedStart = end.getTime() - start.getTime() > maxSpanMs
		? new Date(end.getTime() - maxSpanMs)
		: start;
	const rows: Array<{ date: string; count: number; iso: string }> = [];
	for (let cursor = new Date(clampedStart); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
		const iso = cursor.toISOString().slice(0, 10);
		rows.push({ iso, date: formatChartTick(iso), count: byDay.get(iso) ?? 0 });
	}
	return rows;
}

export function fillDailyCarryForward(
	points: Array<{ bucket: string; value: number }>,
	minDays = CHECKPOINT_CHART_MIN_DAYS,
): Array<{ date: string; value: number; iso: string }> {
	const byDay = new Map<string, number>();
	for (const point of [...points].sort((a, b) => a.bucket.localeCompare(b.bucket))) {
		byDay.set(utcDayKey(point.bucket), point.value);
	}
	const skeleton = fillDailyCounts([...byDay.entries()].map(([bucket, count]) => ({ bucket, count })), minDays);
	let last = 0;
	return skeleton.map(row => {
		if (byDay.has(row.iso)) {
			last = byDay.get(row.iso) ?? last;
		}
		return { date: row.date, iso: row.iso, value: last };
	});
}

export function checkpointConfigHasChanges(draft: IKnoxGuiCheckpointConfig, original?: IKnoxGuiCheckpointConfig): boolean {
	return JSON.stringify(draft) !== JSON.stringify(original ?? DEFAULT_CHECKPOINT_CONFIG);
}

export function buildCheckpointDiffFiles(
	files: Array<{ relativePath: string; status?: string; oldContent: string | null; newContent: string | null; oldEncoding?: string; newEncoding?: string }>,
): IKnoxGuiCheckpointDiffFile[] {
	return files.map(file => {
		const isBinary = file.oldEncoding === 'base64' || file.newEncoding === 'base64';
		let status: KnoxCheckpointDiffStatus = 'modified';
		if (file.status === 'added' || (!file.oldContent && file.newContent !== null)) {
			status = 'added';
		} else if (file.status === 'deleted' || (file.oldContent !== null && file.newContent === null)) {
			status = 'deleted';
		} else if ((file.oldContent ?? '') === (file.newContent ?? '')) {
			status = 'unchanged';
		}
		const delta = isBinary ? { additions: 0, deletions: 0 } : countLineDelta(file.oldContent ?? '', file.newContent ?? '');
		return {
			relativePath: file.relativePath,
			status,
			oldContent: file.oldContent,
			newContent: file.newContent,
			oldEncoding: file.oldEncoding,
			newEncoding: file.newEncoding,
			isBinary,
			additions: delta.additions,
			deletions: delta.deletions,
		};
	});
}

function rec(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function arr(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function parseRestorePreview(value: unknown): IKnoxGuiRestorePreview | undefined {
	const root = rec(value);
	const preview = rec(root?.preview) ?? (root?.checkpointId ? root : undefined);
	if (!preview || typeof preview.checkpointId !== 'string') {
		return undefined;
	}
	return {
		checkpointId: String(preview.checkpointId),
		description: String(preview.description ?? ''),
		modified: Number(preview.modified ?? 0),
		added: Number(preview.added ?? 0),
		deleted: Number(preview.deleted ?? 0),
		files: arr(preview.files).map((item): IKnoxGuiRestorePreviewFile => {
			const file = rec(item) ?? {};
			const action: KnoxRestorePreviewAction = file.action === 'create' || file.action === 'delete' ? file.action : 'overwrite';
			return {
				relativePath: String(file.relativePath ?? ''),
				action,
				additions: Number(file.additions ?? 0),
				deletions: Number(file.deletions ?? 0),
				hunkCount: Number(file.hunkCount ?? 0),
			};
		}).filter(file => file.relativePath),
		writePaths: arr(preview.writePaths).map(String),
		extraPaths: arr(preview.extraPaths).map(String),
		skippedFiles: arr(preview.skippedFiles).map(item => {
			const file = rec(item) ?? {};
			return { path: String(file.path ?? ''), reason: String(file.reason ?? '') };
		}),
	};
}

export interface IKnoxGuiCheckpointDetailsSnapshot extends IKnoxGuiCheckpointFileSnapshot {
	lastModified: string;
}

export interface IKnoxGuiCheckpointDetails {
	id: string;
	description: string;
	created: string;
	workspacePath?: string;
	messageId?: string;
	conversationContext?: { role: string; messageContent: string; index: number; timestamp: string };
	fileSnapshots: IKnoxGuiCheckpointDetailsSnapshot[];
}

export type KnoxCheckpointDetailsTab = 'basic' | 'files' | 'diff';

/** View state of the checkpoint details modal (`CheckpointTableRow.tsx`). */
export interface IKnoxGuiCheckpointDetailsView {
	id: string;
	loading: boolean;
	details?: IKnoxGuiCheckpointDetails;
	tab: KnoxCheckpointDetailsTab;
	selectedFile?: string;
	expandedDirs: Set<string>;
	/** `previous`, `workspace`, or a checkpoint id. */
	compareTarget: string;
	diff?: IKnoxGuiCheckpointDiff;
	diffLoading: boolean;
	diffSeq: number;
	restoringFile?: string;
	wrap: boolean;
	copied: boolean;
}

/** `getCheckpointDetails` / `getPreviousCheckpoint` both answer `{ success, details }`. */
export function parseCheckpointDetails(value: unknown): IKnoxGuiCheckpointDetails | undefined {
	const root = rec(value);
	if (root && root.success === false) {
		return undefined;
	}
	const details = rec(root?.details) ?? (typeof root?.id === 'string' ? root : undefined);
	if (!details || typeof details.id !== 'string') {
		return undefined;
	}
	const context = rec(details.conversationContext);
	return {
		id: details.id,
		description: String(details.description ?? ''),
		created: String(details.created ?? ''),
		workspacePath: typeof details.workspacePath === 'string' ? details.workspacePath : undefined,
		messageId: typeof details.messageId === 'string' ? details.messageId : undefined,
		conversationContext: context ? {
			role: String(context.role ?? ''),
			messageContent: String(context.messageContent ?? ''),
			index: Number(context.index ?? 0),
			timestamp: String(context.timestamp ?? ''),
		} : undefined,
		fileSnapshots: arr(details.fileSnapshots).map(item => {
			const file = rec(item) ?? {};
			const content = String(file.content ?? '');
			const encoding = String(file.encoding ?? 'utf8');
			return {
				relativePath: String(file.relativePath ?? ''),
				content,
				encoding,
				size: Number(file.size ?? content.length),
				lastModified: String(file.lastModified ?? details.created ?? ''),
			};
		}).filter(file => file.relativePath),
	};
}

export function checkpointDetailsDefaultTab(details: IKnoxGuiCheckpointDetails): KnoxCheckpointDetailsTab {
	return details.fileSnapshots.length ? 'files' : 'basic';
}

/**
 * `CheckpointTableRow.tsx` `loadPreviousCheckpointFallback`: when the host
 * cannot reconstruct a diff, compare the raw snapshots of the previous
 * checkpoint against this one.
 */
export function diffFromCheckpointSnapshots(oldDetails: IKnoxGuiCheckpointDetails, newDetails: IKnoxGuiCheckpointDetails): IKnoxGuiCheckpointDiff {
	const oldByPath = new Map(oldDetails.fileSnapshots.map(file => [file.relativePath, file]));
	const newByPath = new Map(newDetails.fileSnapshots.map(file => [file.relativePath, file]));
	const paths = [...new Set([...oldByPath.keys(), ...newByPath.keys()])].sort();
	return {
		oldCheckpoint: { id: oldDetails.id, description: oldDetails.description, created: oldDetails.created },
		newCheckpoint: { id: newDetails.id, description: newDetails.description, created: newDetails.created },
		files: buildCheckpointDiffFiles(paths.map(relativePath => {
			const before = oldByPath.get(relativePath);
			const after = newByPath.get(relativePath);
			return {
				relativePath,
				oldContent: before ? before.content : null,
				newContent: after ? after.content : null,
				oldEncoding: before?.encoding,
				newEncoding: after?.encoding,
			};
		})),
	};
}

/** `checkpointListQuery.ts`: every other checkpoint, newest first. */
export function compareCheckpointTargets<T extends { id: string; created: string }>(catalog: readonly T[], currentId: string): T[] {
	return catalog
		.filter(checkpoint => checkpoint.id !== currentId)
		.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
}

/** `FileTreeView.tsx`: expand the folders leading to the first file. */
export function checkpointTreeAncestors(relativePath: string): string[] {
	const parts = relativePath.split('/').filter(Boolean).slice(0, -1);
	return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** `FileTreeView.tsx` / `CodeViewer.tsx` `formatFileSize`. */
export function formatSnapshotSize(bytes: number): string {
	if (!bytes) {
		return '0 B';
	}
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

const CHECKPOINT_IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	ico: 'image/x-icon',
	bmp: 'image/bmp',
	avif: 'image/avif',
};

export function checkpointImageMime(relativePath: string, encoding: string | undefined): string | undefined {
	if (encoding !== 'base64') {
		return undefined;
	}
	return CHECKPOINT_IMAGE_MIME[relativePath.split('.').pop()?.toLowerCase() ?? ''];
}

export const CHECKPOINT_TREE_WIDTH = { default: 320, min: 200, max: 500 } as const;

/** `ResizableSplitter.tsx`: bounds tighten to 15%–60% of the container. */
export function clampCheckpointTreeWidth(width: number, containerWidth: number): number {
	const min = Math.max(CHECKPOINT_TREE_WIDTH.min, containerWidth * 0.15);
	const max = Math.min(CHECKPOINT_TREE_WIDTH.max, containerWidth * 0.6);
	return Math.round(Math.max(min, Math.min(max, width)));
}

export function parseCheckpointDiff(value: unknown, fallbackNewDescription?: string): IKnoxGuiCheckpointDiff | undefined {
	const root = rec(value);
	const diff = rec(root?.diff) ?? root;
	if (!diff) {
		return undefined;
	}
	const oldCp = rec(diff.oldCheckpoint);
	const newCp = rec(diff.newCheckpoint);
	if (!newCp) {
		return undefined;
	}
	const files = buildCheckpointDiffFiles(arr(diff.files).map(item => {
		const file = rec(item) ?? {};
		return {
			relativePath: String(file.relativePath ?? ''),
			status: typeof file.status === 'string' ? file.status : undefined,
			oldContent: file.oldContent === null || file.oldContent === undefined ? null : String(file.oldContent),
			newContent: file.newContent === null || file.newContent === undefined ? null : String(file.newContent),
			oldEncoding: file.oldEncoding ? String(file.oldEncoding) : undefined,
			newEncoding: file.newEncoding ? String(file.newEncoding) : undefined,
		};
	}).filter(file => file.relativePath));
	return {
		oldCheckpoint: {
			id: String(oldCp?.id ?? 'workspace'),
			description: String(oldCp?.description ?? ''),
			created: String(oldCp?.created ?? ''),
		},
		newCheckpoint: {
			id: String(newCp.id ?? ''),
			description: String(newCp.description ?? fallbackNewDescription ?? ''),
			created: String(newCp.created ?? ''),
		},
		files,
	};
}

export function parsePerformanceDashboard(value: unknown): {
	currentStorage?: { totalBytes: number; checkpointCount: number; blobCount?: number };
	storageHistory: Array<{ timestamp: string; totalBytes: number; checkpointCount: number }>;
	creationFrequency: Array<{ bucket: string; count: number }>;
	restorationEvents: Array<{ timestamp: string; checkpointId: string; success: boolean; durationMs: number; filesRestored: number; filesFailed: number; error?: string }>;
	aiSessionMetrics: Array<{ sessionId: string; startedAt: string; filesChanged: number; linesAdded?: number; linesDeleted?: number; checkpointsCreated: number; rollbacks?: number; durationSeconds: number }>;
	summary: {
		totalCheckpointsCreated: number;
		totalRestorations: number;
		restorationSuccessRate: number;
		avgCreationTimeMs: number;
		totalAiSessions: number;
		avgChangesPerSession: number;
		totalRollbacks: number;
	};
} | undefined {
	const root = rec(value);
	const data = rec(root?.data) ?? root;
	if (!data) {
		return undefined;
	}
	const summary = rec(data.summary) ?? {};
	const storage = rec(data.currentStorage);
	return {
		currentStorage: storage ? {
			totalBytes: Number(storage.totalBytes ?? 0),
			checkpointCount: Number(storage.checkpointCount ?? 0),
			blobCount: storage.blobCount !== undefined ? Number(storage.blobCount) : undefined,
		} : undefined,
		storageHistory: arr(data.storageHistory).map(item => {
			const row = rec(item) ?? {};
			return { timestamp: String(row.timestamp ?? ''), totalBytes: Number(row.totalBytes ?? 0), checkpointCount: Number(row.checkpointCount ?? 0) };
		}),
		creationFrequency: arr(data.creationFrequency).map(item => {
			const row = rec(item) ?? {};
			return { bucket: String(row.bucket ?? ''), count: Number(row.count ?? 0) };
		}),
		restorationEvents: arr(data.restorationEvents).map(item => {
			const row = rec(item) ?? {};
			return {
				timestamp: String(row.timestamp ?? ''),
				checkpointId: String(row.checkpointId ?? ''),
				success: Boolean(row.success),
				durationMs: Number(row.durationMs ?? 0),
				filesRestored: Number(row.filesRestored ?? 0),
				filesFailed: Number(row.filesFailed ?? 0),
				error: row.error ? String(row.error) : undefined,
			};
		}),
		aiSessionMetrics: arr(data.aiSessionMetrics).map(item => {
			const row = rec(item) ?? {};
			return {
				sessionId: String(row.sessionId ?? ''),
				startedAt: String(row.startedAt ?? ''),
				filesChanged: Number(row.filesChanged ?? 0),
				linesAdded: typeof row.linesAdded === 'number' ? row.linesAdded : undefined,
				linesDeleted: typeof row.linesDeleted === 'number' ? row.linesDeleted : undefined,
				checkpointsCreated: Number(row.checkpointsCreated ?? 0),
				rollbacks: row.rollbacks !== undefined ? Number(row.rollbacks) : undefined,
				durationSeconds: Number(row.durationSeconds ?? 0),
			};
		}),
		summary: {
			totalCheckpointsCreated: Number(summary.totalCheckpointsCreated ?? 0),
			totalRestorations: Number(summary.totalRestorations ?? 0),
			restorationSuccessRate: Number(summary.restorationSuccessRate ?? 0),
			avgCreationTimeMs: Number(summary.avgCreationTimeMs ?? 0),
			totalAiSessions: Number(summary.totalAiSessions ?? 0),
			avgChangesPerSession: Number(summary.avgChangesPerSession ?? 0),
			totalRollbacks: Number(summary.totalRollbacks ?? 0),
		},
	};
}

export function parseCheckpointAnalysis(value: unknown): {
	checkpointId: string;
	generatedDescription: string;
	riskAssessment: { level: 'Low' | 'Medium' | 'High' | 'Critical'; score: number; factors: Array<{ category: string; description: string; weight: number; affectedFiles: string[] }>; recommendations: string[] };
	impactAnalysis: { affectedFeatures: Array<{ name: string; impactLevel: string; changedFiles: string[] }>; affectedLayers: string[]; scope: string; uniqueDirectories?: number; testFilesChanged?: boolean; linesAdded?: number; linesDeleted?: number };
	counts?: { changed: number; created?: number; deleted?: number; modified?: number; tests?: number; config?: number; lockfile?: number };
	groupingSuggestion?: { groupName: string; rationale: string; confidence: number; checkpointIds: string[]; kind?: string };
} | undefined {
	const root = rec(value);
	const analysis = rec(root?.analysis) ?? root;
	if (!analysis) {
		return undefined;
	}
	const risk = rec(analysis.riskAssessment) ?? {};
	const impact = rec(analysis.impactAnalysis) ?? {};
	const counts = rec(analysis.counts);
	const level = risk.level === 'Medium' || risk.level === 'High' || risk.level === 'Critical' ? risk.level : 'Low';
	return {
		checkpointId: String(analysis.checkpointId ?? ''),
		generatedDescription: String(analysis.generatedDescription ?? ''),
		riskAssessment: {
			level,
			score: Number(risk.score ?? 0),
			factors: arr(risk.factors).map(item => {
				const factor = rec(item) ?? {};
				return {
					category: String(factor.category ?? ''),
					description: String(factor.description ?? ''),
					weight: Number(factor.weight ?? 0),
					affectedFiles: arr(factor.affectedFiles).map(String),
				};
			}),
			recommendations: arr(risk.recommendations).map(String),
		},
		impactAnalysis: {
			affectedFeatures: arr(impact.affectedFeatures).map(item => {
				const feature = rec(item) ?? {};
				return { name: String(feature.name ?? ''), impactLevel: String(feature.impactLevel ?? 'Low'), changedFiles: arr(feature.changedFiles).map(String) };
			}),
			affectedLayers: arr(impact.affectedLayers).map(String),
			scope: String(impact.scope ?? 'Isolated'),
			uniqueDirectories: impact.uniqueDirectories !== undefined ? Number(impact.uniqueDirectories) : undefined,
			testFilesChanged: impact.testFilesChanged !== undefined ? Boolean(impact.testFilesChanged) : undefined,
			linesAdded: impact.linesAdded !== undefined ? Number(impact.linesAdded) : undefined,
			linesDeleted: impact.linesDeleted !== undefined ? Number(impact.linesDeleted) : undefined,
		},
		counts: counts ? {
			changed: Number(counts.changed ?? 0),
			created: counts.created !== undefined ? Number(counts.created) : undefined,
			deleted: counts.deleted !== undefined ? Number(counts.deleted) : undefined,
			modified: counts.modified !== undefined ? Number(counts.modified) : undefined,
			tests: counts.tests !== undefined ? Number(counts.tests) : undefined,
			config: counts.config !== undefined ? Number(counts.config) : undefined,
			lockfile: counts.lockfile !== undefined ? Number(counts.lockfile) : undefined,
		} : undefined,
		groupingSuggestion: parseGroupingSuggestion(analysis.groupingSuggestion),
	};
}

function parseGroupingSuggestion(value: unknown): { groupName: string; rationale: string; confidence: number; checkpointIds: string[]; kind?: string } | undefined {
	const row = rec(value);
	if (!row) {
		return undefined;
	}
	return {
		groupName: String(row.groupName ?? ''),
		rationale: String(row.rationale ?? ''),
		confidence: Number(row.confidence ?? 0),
		checkpointIds: arr(row.checkpointIds).map(String),
		kind: row.kind ? String(row.kind) : undefined,
	};
}

export function parseSuggestedCheckpointGroups(value: unknown): Array<{ groupName: string; rationale: string; confidence: number; checkpointIds: string[]; kind?: string }> {
	const root = rec(value);
	return arr(root?.groups).map(parseGroupingSuggestion).filter((group): group is NonNullable<typeof group> => Boolean(group?.groupName || group?.checkpointIds.length));
}

export function parseShareBundles(value: unknown): {
	bundles: Array<{ id: string; description: string; sharedAt: string; checkpointCount: number; checkpointIds: string[]; filePath: string; sharedBy: string; machineId: string; exists: boolean }>;
	auditRecords: Array<{ id: string; timestamp: string; userId: string; machineId: string; action: string; resourceType: string; resourceId: string; outcome: string; details: string }>;
} {
	const root = rec(value);
	return {
		bundles: arr(root?.bundles).map(item => {
			const row = rec(item) ?? {};
			return {
				id: String(row.id ?? ''),
				description: String(row.description ?? ''),
				sharedAt: String(row.sharedAt ?? ''),
				checkpointCount: Number(row.checkpointCount ?? 0),
				checkpointIds: arr(row.checkpointIds).map(String),
				filePath: String(row.filePath ?? ''),
				sharedBy: String(row.sharedBy ?? ''),
				machineId: String(row.machineId ?? ''),
				exists: row.exists !== false,
			};
		}),
		auditRecords: arr(root?.auditRecords).map(item => {
			const row = rec(item) ?? {};
			return {
				id: String(row.id ?? ''),
				timestamp: String(row.timestamp ?? ''),
				userId: String(row.userId ?? ''),
				machineId: String(row.machineId ?? ''),
				action: String(row.action ?? ''),
				resourceType: String(row.resourceType ?? ''),
				resourceId: String(row.resourceId ?? ''),
				outcome: String(row.outcome ?? ''),
				details: String(row.details ?? ''),
			};
		}),
	};
}

/** `core/context/soul.formatRestoreNotice` — injected into the next stream after `checkpointRestored`. */
export function formatRestoreNotice(input: {
	checkpointId: string;
	description?: string;
	restoredFiles: string[];
	memoryRewound?: boolean;
	memoryMessage?: string;
}): string {
	const files = input.restoredFiles.length > 0
		? input.restoredFiles.slice(0, 20).join(', ')
		: '(see checkpoint details)';
	const extra = input.restoredFiles.length > 20
		? ` (+${input.restoredFiles.length - 20} more)`
		: '';
	const memoryLine = input.memoryRewound
		? ['Working memory was rewound to this checkpoint.', input.memoryMessage || ''].filter(Boolean).join(' ')
		: [
			'Memory was not rewound.',
			`Use builtin_workspace_checkpoint action=restore checkpoint_id=${input.checkpointId} rewind_memory=true if you also want working memory to match this disk state.`,
		].join(' ');
	return [
		'## Workspace restore',
		`The workspace was restored to checkpoint ${input.checkpointId}${input.description ? ` (${input.description})` : ''}.`,
		`Restored files: ${files}${extra}`,
		memoryLine,
		'Do not assume later edits still exist. Re-read files before editing.',
	].join('\n');
}

export function parseCheckpointRestored(data: unknown): { sessionId?: string; checkpointId: string; notice: string } | undefined {
	const row = rec(data);
	if (!row) {
		return undefined;
	}
	const checkpointId = String(row.checkpointId ?? row.id ?? '');
	const sessionId = row.sessionId ? String(row.sessionId) : undefined;
	if (!checkpointId && !sessionId) {
		return undefined;
	}
	const restoredFiles = arr(row.restoredFiles).map(String);
	const id = checkpointId || 'unknown';
	return {
		sessionId,
		checkpointId: id,
		notice: formatRestoreNotice({
			checkpointId: id,
			description: row.description ? String(row.description) : undefined,
			restoredFiles,
			memoryRewound: row.memoryRewound === true,
			memoryMessage: row.memoryMessage ? String(row.memoryMessage) : undefined,
		}),
	};
}
