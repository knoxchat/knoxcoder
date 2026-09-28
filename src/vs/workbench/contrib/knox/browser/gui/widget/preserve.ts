/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
}

export interface IKnoxGuiDomSnapshot {
	selection?: { anchor: IDomPoint; focus: IDomPoint };
	scrolls: IScrollEntry[];
}

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

/**
 * The widget rebuilds its DOM on every state change. A text selection and inner scroll
 * positions are re-applied to the node at the same structural path when it still exists.
 * The transcript scroller itself and inputs are excluded: they have their own restore logic.
 */
export function captureDomState(root: HTMLElement, scrollRoot: HTMLElement | undefined): IKnoxGuiDomSnapshot {
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
	if (scrollRoot) {
		for (const el of Array.from(scrollRoot.querySelectorAll<HTMLElement>('*'))) {
			if ((el.scrollTop > 0 || el.scrollLeft > 0) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) {
				const at = pathTo(root, el);
				if (at) {
					snapshot.scrolls.push({ ...at, top: el.scrollTop, left: el.scrollLeft });
				}
			}
		}
	}
	return snapshot;
}

export function restoreDomState(root: HTMLElement, snapshot: IKnoxGuiDomSnapshot): void {
	for (const entry of snapshot.scrolls) {
		const el = resolve(root, entry.path, entry.names);
		if (el instanceof HTMLElement) {
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
