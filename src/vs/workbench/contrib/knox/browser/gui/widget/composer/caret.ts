/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { IKnoxGuiDocCaret } from '../../../../common/knoxGuiInput.js';
export function placeCaretAtEndOf(widget: KnoxGuiWidget, editor: HTMLElement): void {
	const selection = editor.ownerDocument.getSelection();
	if (!selection) {
		return;
	}
	const range = editor.ownerDocument.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Composer caret as a doc position; chips and `<br>` count as one character, like `readInlines`. */
export function caretDocPosition(widget: KnoxGuiWidget, editor: HTMLElement): IKnoxGuiDocCaret | undefined {
	const selection = editor.ownerDocument.getSelection();
	if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
		return undefined;
	}
	const range = selection.getRangeAt(0);
	let target: Node = range.endContainer;
	let targetOffset = range.endOffset;
	if (target === editor) {
		const child = editor.childNodes[targetOffset - 1];
		if (!child) {
			return { block: 0, offset: 0 };
		}
		target = child;
		targetOffset = child.nodeType === Node.TEXT_NODE ? (child.textContent ?? '').length : child.childNodes.length;
	}
	let block = 0;
	let top: Node | undefined;
	for (const child of Array.from(editor.childNodes)) {
		if (child === target || child.contains(target)) {
			top = child;
			break;
		}
		if (child.nodeType !== Node.TEXT_NODE || (child.textContent ?? '')) {
			block++;
		}
	}
	if (!top) {
		return undefined;
	}
	let count = 0;
	let done = false;
	const walk = (current: Node): void => {
		if (done) {
			return;
		}
		if (current instanceof HTMLElement && current.dataset.chip) {
			count += 1;
			done = current === target || current.contains(target);
			return;
		}
		if (current === target) {
			if (current.nodeType === Node.TEXT_NODE) {
				count += targetOffset;
			} else {
				Array.from(current.childNodes).slice(0, targetOffset).forEach(walk);
			}
			done = true;
			return;
		}
		if (current.nodeType === Node.TEXT_NODE) {
			count += (current.textContent ?? '').length;
			return;
		}
		if (current instanceof HTMLBRElement) {
			count += 1;
			return;
		}
		current.childNodes.forEach(walk);
	};
	walk(top);
	return { block, offset: count };
}

export function placeCaretAtDocPosition(widget: KnoxGuiWidget, editor: HTMLElement, caret: IKnoxGuiDocCaret): void {
	const selection = editor.ownerDocument.getSelection();
	if (!selection) {
		return;
	}
	let block = 0;
	let top: Node | undefined;
	for (const child of Array.from(editor.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? '')) {
			continue;
		}
		if (block === caret.block) {
			top = child;
			break;
		}
		block++;
	}
	const range = editor.ownerDocument.createRange();
	if (!top) {
		range.selectNodeContents(editor);
		range.collapse(false);
	} else {
		let remaining = caret.offset;
		const place = (current: Node): boolean => {
			if ((current instanceof HTMLElement && current.dataset.chip) || current instanceof HTMLBRElement) {
				if (remaining === 0) {
					range.setStartBefore(current);
					return true;
				}
				remaining -= 1;
				return false;
			}
			if (current.nodeType === Node.TEXT_NODE) {
				const length = (current.textContent ?? '').length;
				if (remaining <= length) {
					range.setStart(current, remaining);
					return true;
				}
				remaining -= length;
				return false;
			}
			return Array.from(current.childNodes).some(place);
		};
		if (!place(top)) {
			range.selectNodeContents(top);
			range.collapse(false);
		} else {
			range.collapse(true);
		}
	}
	selection.removeAllRanges();
	selection.addRange(range);
}

export function caretClientRect(widget: KnoxGuiWidget): { left: number; top: number; bottom: number } | undefined {
	const target = widget.controller.suggestTarget;
	const editor = target ? widget.historyEditorEls.get(target) : widget.editorEl;
	const selection = editor?.ownerDocument.getSelection();
	if (editor && selection?.rangeCount && editor.contains(selection.anchorNode)) {
		const range = selection.getRangeAt(0).cloneRange();
		range.collapse(false);
		const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
		if (rect && (rect.width || rect.height || rect.left || rect.top)) {
			widget.lastCaretRect = { left: rect.left, top: rect.top, bottom: rect.bottom };
			return widget.lastCaretRect;
		}
		const host = selection.anchorNode instanceof HTMLElement ? selection.anchorNode : selection.anchorNode?.parentElement;
		const fallback = host?.getBoundingClientRect();
		if (fallback) {
			widget.lastCaretRect = { left: fallback.left, top: fallback.top, bottom: fallback.bottom };
			return widget.lastCaretRect;
		}
	}
	return widget.lastCaretRect;
}

export function caretAtEdge(widget: KnoxGuiWidget, edge: 'start' | 'end'): boolean {
	const editor = widget.editorEl;
	if (!editor) {
		return true;
	}
	const selection = editor.ownerDocument.getSelection();
	if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
		return true;
	}
	const range = selection.getRangeAt(0);
	if (!range.collapsed) {
		return false;
	}
	const probe = editor.ownerDocument.createRange();
	probe.selectNodeContents(editor);
	probe.collapse(edge === 'start');
	return range.compareBoundaryPoints(Range.START_TO_START, probe) === 0;
}

export function placeCaretAtStart(widget: KnoxGuiWidget): void {
	const editor = widget.editorEl;
	if (!editor) {
		return;
	}
	const selection = editor.ownerDocument.getSelection();
	if (!selection) {
		return;
	}
	const range = editor.ownerDocument.createRange();
	range.selectNodeContents(editor);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

export function placeCaretAtEnd(widget: KnoxGuiWidget): void {
	const editor = widget.editorEl;
	if (!editor) {
		return;
	}
	const selection = editor.ownerDocument.getSelection();
	if (!selection) {
		return;
	}
	const range = editor.ownerDocument.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}
