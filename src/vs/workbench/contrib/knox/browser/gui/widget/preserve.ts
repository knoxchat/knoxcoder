/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface IDomPoint {
	path: number[];
	names: string[];
	offset: number;
}

interface IScrollEntry {
	path: number[];
	names: string[];
	top: number;
	left: number;
	key?: string;
}

export interface IKnoxGuiDomSnapshot {
	selection?: { anchor: IDomPoint; focus: IDomPoint };
	scrolls: IScrollEntry[];
}

const TEST_ID_TOKEN = /^[\w.-]+$/;

/**
 * Unique (or ancestor-qualified) overflow hosts. Graph canvas scroll is omitted: it has
 * its own `checkpointGraphScrollTop` restore that can change during the same render.
 */
const STABLE_SCROLL_CLASSES = new Set([
	'knox-gui-overlay',
	'knox-gui-page',
	'knox-gui-memory-body',
	'knox-gui-cpl-list',
	'knox-gui-timeline-list',
	'knox-gui-attached-body',
	'knox-gui-text-dialog-panel',
	'knox-gui-modal-dialog',
	'knox-gui-code-edit-list',
	'knox-gui-code-edit-snippet',
	'knox-gui-batch-list',
	'knox-gui-popover',
	'knox-gui-add-file-options',
	'knox-gui-input-code-body',
	'knox-gui-graph-details',
	'knox-gui-graph-conflicts',
	'knox-gui-cp-config-sections',
]);

function pathTo(root: Node, node: Node): { path: number[]; names: string[] } | undefined {
	const path: number[] = [];
	const names: string[] = [];
	let current: Node | null = node;
	while (current && current !== root) {
		const parent: Node | null = current.parentNode;
		if (!parent) {
			return undefined;
		}
		path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
		names.unshift(current.nodeName);
		current = parent;
	}
	return current === root ? { path, names } : undefined;
}

function resolve(root: Node, path: number[], names: string[]): Node | undefined {
	let current: Node = root;
	for (let i = 0; i < path.length; i++) {
		const next = current.childNodes[path[i]];
		if (!next || next.nodeName !== names[i]) {
			return undefined;
		}
		current = next;
	}
	return current;
}

function nodeLength(node: Node): number {
	return node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : node.childNodes.length;
}

function testIdOf(el: HTMLElement): string | undefined {
	const testId = el.getAttribute('data-testid');
	return testId && TEST_ID_TOKEN.test(testId) ? testId : undefined;
}

function classToken(el: HTMLElement): string | undefined {
	for (const token of el.classList) {
		if (STABLE_SCROLL_CLASSES.has(token)) {
			return token;
		}
	}
	return undefined;
}

/** Own testid, or `ancestorTestId::.class` so git-diff / jobs bodies stay distinct. */
export function scrollKey(el: HTMLElement): string | undefined {
	const own = testIdOf(el);
	if (own) {
		return own;
	}
	const cls = classToken(el);
	if (!cls) {
		return undefined;
	}
	let current = el.parentElement;
	while (current) {
		const id = testIdOf(current);
		if (id) {
			return `${id}::.${cls}`;
		}
		current = current.parentElement;
	}
	return `.${cls}`;
}

function resolveByKey(root: HTMLElement, key: string): HTMLElement | undefined {
	const split = key.indexOf('::');
	if (split === -1) {
		const el = key.startsWith('.')
			? root.querySelector(key)
			: root.querySelector(`[data-testid="${key}"]`);
		return el instanceof HTMLElement ? el : undefined;
	}
	const host = root.querySelector(`[data-testid="${key.slice(0, split)}"]`);
	if (!(host instanceof HTMLElement)) {
		return undefined;
	}
	const el = host.querySelector(key.slice(split + 2));
	return el instanceof HTMLElement ? el : undefined;
}

function resolveScrollTarget(root: HTMLElement, entry: IScrollEntry): HTMLElement | undefined {
	if (entry.key) {
		const byKey = resolveByKey(root, entry.key);
		if (byKey) {
			return byKey;
		}
	}
	const el = resolve(root, entry.path, entry.names);
	return el instanceof HTMLElement ? el : undefined;
}

/**
 * The widget rebuilds its DOM on every state change. A text selection and inner scroll
 * positions are re-applied to the node at the same structural path when it still exists.
 * The chat transcript scroller itself and inputs are excluded: they have their own restore.
 * Other overflow hosts (lump overlays, Config/History pages, Memory panes, checkpoint lists,
 * attached git/jobs panels, dialogs) are captured from the widget root and restored by a
 * stable key when siblings around them shift.
 */
export function captureDomState(root: HTMLElement, skipScroller?: HTMLElement): IKnoxGuiDomSnapshot {
	const snapshot: IKnoxGuiDomSnapshot = { scrolls: [] };
	const selection = root.ownerDocument.getSelection();
	if (selection && selection.rangeCount && !selection.isCollapsed && selection.anchorNode && selection.focusNode) {
		const active = root.ownerDocument.activeElement;
		const inEditable = active instanceof HTMLElement && (active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && root.contains(active);
		const anchor = pathTo(root, selection.anchorNode);
		const focus = pathTo(root, selection.focusNode);
		if (!inEditable && anchor && focus) {
			snapshot.selection = {
				anchor: { ...anchor, offset: selection.anchorOffset },
				focus: { ...focus, offset: selection.focusOffset },
			};
		}
	}
	for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
		if (el === skipScroller || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
			continue;
		}
		if (el.scrollTop > 0 || el.scrollLeft > 0) {
			const at = pathTo(root, el);
			if (at) {
				snapshot.scrolls.push({ ...at, top: el.scrollTop, left: el.scrollLeft, key: scrollKey(el) });
			}
		}
	}
	return snapshot;
}

export function keyedScrolls(snapshot: IKnoxGuiDomSnapshot): IKnoxGuiDomSnapshot {
	return { scrolls: snapshot.scrolls.filter(entry => entry.key) };
}

export function restoreDomState(root: HTMLElement, snapshot: IKnoxGuiDomSnapshot): void {
	for (const entry of snapshot.scrolls) {
		const el = resolveScrollTarget(root, entry);
		if (el) {
			el.scrollTop = entry.top;
			el.scrollLeft = entry.left;
		}
	}
	const saved = snapshot.selection;
	if (!saved) {
		return;
	}
	const anchor = resolve(root, saved.anchor.path, saved.anchor.names);
	const focus = resolve(root, saved.focus.path, saved.focus.names);
	if (!anchor || !focus || saved.anchor.offset > nodeLength(anchor) || saved.focus.offset > nodeLength(focus)) {
		return;
	}
	root.ownerDocument.getSelection()?.setBaseAndExtent(anchor, saved.anchor.offset, focus, saved.focus.offset);
}
