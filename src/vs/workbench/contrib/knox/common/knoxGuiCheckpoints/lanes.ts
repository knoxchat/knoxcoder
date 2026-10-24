/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Git-style lane assignment for the checkpoint graph. */

export const CHECKPOINT_GRAPH_LANE_COLORS = [
	'#61afef', '#98c379', '#e5c07b', '#e06c75', '#c678dd', '#56b6c2', '#d19a66', '#abb2bf',
] as const;

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
