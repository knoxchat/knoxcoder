/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { arr, rec } from './parse.js';
import type { IKnoxGuiCheckpointDiff, IKnoxGuiCheckpointDiffFile, IKnoxGuiCheckpointFileTreeNode, IKnoxGuiDiffHunk, IKnoxGuiDiffLine, IKnoxGuiRestorePreview, IKnoxGuiRestorePreviewFile, KnoxCheckpointDiffStatus, KnoxRestorePreviewAction } from './types.js';

/** Line/word diffs, file trees, and restore-preview parsing. */

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
	// Trim the common prefix/suffix so large files with small edits stay cheap.
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		prefix += 1;
	}
	let suffix = 0;
	while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
		suffix += 1;
	}
	const midA = a.slice(prefix, a.length - suffix);
	const midB = b.slice(prefix, b.length - suffix);
	const lines: IKnoxGuiDiffLine[] = [];
	for (let k = 0; k < prefix; k += 1) {
		lines.push({ type: 'context', oldLineNum: k + 1, newLineNum: k + 1, content: a[k] });
	}
	for (const op of myersLineOps(midA, midB)) {
		if (op.type === 'context') {
			lines.push({ type: 'context', oldLineNum: prefix + op.i + 1, newLineNum: prefix + op.j + 1, content: midA[op.i] });
		} else if (op.type === 'added') {
			lines.push({ type: 'added', oldLineNum: null, newLineNum: prefix + op.j + 1, content: midB[op.j] });
		} else {
			lines.push({ type: 'removed', oldLineNum: prefix + op.i + 1, newLineNum: null, content: midA[op.i] });
		}
	}
	for (let k = 0; k < suffix; k += 1) {
		const i = a.length - suffix + k;
		const j = b.length - suffix + k;
		lines.push({ type: 'context', oldLineNum: i + 1, newLineNum: j + 1, content: a[i] });
	}
	return lines;
}

interface IMyersOp { type: 'context' | 'added' | 'removed'; i: number; j: number }

/** Myers O(ND) diff; falls back to replace-all of the (already trimmed) middle when edits are huge. */
function myersLineOps(a: string[], b: string[]): IMyersOp[] {
	const n = a.length;
	const m = b.length;
	const fallback = (): IMyersOp[] => {
		const ops: IMyersOp[] = [];
		a.forEach((_, i) => ops.push({ type: 'removed', i, j: -1 }));
		b.forEach((_, j) => ops.push({ type: 'added', i: -1, j }));
		return ops;
	};
	if (n === 0 || m === 0) {
		return fallback();
	}
	const max = Math.min(n + m, 4000);
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	const trace: Int32Array[] = [];
	let found = -1;
	for (let d = 0; d <= max && found < 0; d += 1) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
				x = v[offset + k + 1];
			} else {
				x = v[offset + k - 1] + 1;
			}
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x += 1;
				y += 1;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
	}
	if (found < 0) {
		return fallback();
	}
	const ops: IMyersOp[] = [];
	let x = n;
	let y = m;
	for (let d = found; d >= 0; d -= 1) {
		const vd = trace[d];
		const k = x - y;
		let prevK: number;
		if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) {
			prevK = k + 1;
		} else {
			prevK = k - 1;
		}
		const prevX = d === 0 ? 0 : vd[offset + prevK];
		const prevY = d === 0 ? 0 : prevX - prevK;
		while (x > prevX && y > prevY) {
			x -= 1;
			y -= 1;
			ops.push({ type: 'context', i: x, j: y });
		}
		if (d > 0) {
			if (x === prevX) {
				y -= 1;
				ops.push({ type: 'added', i: -1, j: y });
			} else {
				x -= 1;
				ops.push({ type: 'removed', i: x, j: -1 });
			}
		}
	}
	return ops.reverse();
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
			oldStart: slice.find(line => line.oldLineNum !== null)?.oldLineNum ?? 1,
			newStart: slice.find(line => line.newLineNum !== null)?.newLineNum ?? 1,
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
