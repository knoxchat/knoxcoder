/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxFindHit, knoxFindMatchRanges, KnoxSearchPattern } from '../../common/knoxFind.js';

/**
 * Highlight `pattern` matches inside a rendered thread row. Ranges are taken
 * from the visible DOM text (not the flattened search string) so markdown
 * tokens still light up.
 */
export function knoxApplyFindMarks(
	root: HTMLElement,
	pattern: KnoxSearchPattern | undefined,
	current?: IKnoxFindHit,
	rowId?: string,
): void {
	unwrapFindMarks(root);
	if (!pattern) {
		return;
	}
	const nodes = collectTextNodes(root);
	if (!nodes.length) {
		return;
	}
	const text = nodes.map(node => node.data).join('');
	const ranges = knoxFindMatchRanges(text, pattern);
	if (!ranges.length) {
		return;
	}
	const currentStart = current && current.rowId === rowId ? current.start : undefined;
	let currentMark: HTMLElement | undefined;
	for (let i = ranges.length - 1; i >= 0; i--) {
		const range = ranges[i];
		const mark = wrapRange(collectTextNodes(root), range.start, range.end);
		if (!mark) {
			continue;
		}
		mark.className = 'knox-find-match';
		if (current?.rowId === rowId && (currentStart === undefined || range.start === currentStart)) {
			currentMark = mark;
		}
	}
	if (!currentMark && current?.rowId === rowId) {
		currentMark = root.querySelector('.knox-find-match') as HTMLElement | null ?? undefined;
	}
	currentMark?.classList.add('knox-find-match-current');
}

function unwrapFindMarks(root: HTMLElement): void {
	const marks = root.querySelectorAll('mark.knox-find-match');
	for (const mark of marks) {
		const parent = mark.parentNode;
		if (!parent) {
			continue;
		}
		while (mark.firstChild) {
			parent.insertBefore(mark.firstChild, mark);
		}
		parent.removeChild(mark);
		parent.normalize();
	}
}

function collectTextNodes(root: Node): Text[] {
	const out: Text[] = [];
	const walk = (node: Node): void => {
		if (node.nodeType === 3) {
			out.push(node as Text);
			return;
		}
		if (node.nodeType !== 1) {
			return;
		}
		const el = node as HTMLElement;
		const tag = el.tagName;
		if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SCRIPT' || tag === 'STYLE') {
			return;
		}
		for (const child of Array.from(node.childNodes)) {
			walk(child);
		}
	};
	walk(root);
	return out;
}

function wrapRange(nodes: Text[], start: number, end: number): HTMLElement | undefined {
	let offset = 0;
	for (const node of nodes) {
		const length = node.data.length;
		const nodeStart = offset;
		const nodeEnd = offset + length;
		offset = nodeEnd;
		if (end <= nodeStart || start >= nodeEnd) {
			continue;
		}
		const localStart = Math.max(0, start - nodeStart);
		const localEnd = Math.min(length, end - nodeStart);
		if (localStart === localEnd) {
			continue;
		}
		const mid = node.splitText(localStart);
		mid.splitText(localEnd - localStart);
		const mark = mid.ownerDocument.createElement('mark');
		mid.parentNode?.insertBefore(mark, mid);
		mark.appendChild(mid);
		return mark;
	}
	return undefined;
}
