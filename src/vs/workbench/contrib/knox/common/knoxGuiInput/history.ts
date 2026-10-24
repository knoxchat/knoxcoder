/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cloneInputDoc, emptyInputDoc, type IKnoxGuiInputBlock, type KnoxGuiInlineNode } from './doc.js';

/** Up/down composer input history (`useInputHistory.ts`). */

export const MAX_COMPOSER_INPUT_HISTORY = 100;

export interface IKnoxGuiComposerInputHistory {
	entries: IKnoxGuiInputBlock[][];
	index: number;
	pending: IKnoxGuiInputBlock[];
}

export function createComposerInputHistory(): IKnoxGuiComposerInputHistory {
	return { entries: [], index: 0, pending: emptyInputDoc() };
}

function isInlineNode(value: unknown): value is KnoxGuiInlineNode {
	const node = value as KnoxGuiInlineNode | undefined;
	if (!node || typeof node !== 'object') {
		return false;
	}
	if (node.type === 'text') {
		return typeof node.text === 'string';
	}
	return (node.type === 'mention' || node.type === 'slash') && typeof node.id === 'string' && typeof node.label === 'string';
}

function isInputBlock(value: unknown): value is IKnoxGuiInputBlock {
	const block = value as IKnoxGuiInputBlock | undefined;
	if (!block || typeof block !== 'object') {
		return false;
	}
	if (block.type === 'paragraph') {
		return Array.isArray(block.content) && block.content.every(isInlineNode);
	}
	return block.type === 'codeBlock' && typeof block.code === 'string';
}

/** `useInputHistory.ts` load: drop malformed entries, keep the last 100, start past the end. */
export function composerInputHistoryFromStorage(raw: string | undefined): IKnoxGuiComposerInputHistory {
	let parsed: unknown;
	try {
		parsed = raw ? JSON.parse(raw) : [];
	} catch {
		parsed = [];
	}
	const entries = (Array.isArray(parsed) ? parsed : [])
		.filter((doc): doc is IKnoxGuiInputBlock[] => Array.isArray(doc) && doc.length > 0 && doc.every(isInputBlock))
		.slice(-MAX_COMPOSER_INPUT_HISTORY);
	return { entries, index: entries.length, pending: emptyInputDoc() };
}

function inputDocsEqual(a: IKnoxGuiInputBlock[], b: IKnoxGuiInputBlock[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function composerInputHistoryPrev(history: IKnoxGuiComposerInputHistory, current: IKnoxGuiInputBlock[]): { history: IKnoxGuiComposerInputHistory; doc: IKnoxGuiInputBlock[] } | undefined {
	const index = history.index;
	const pending = index === history.entries.length ? cloneInputDoc(current) : history.pending;
	if (index > 0 && index <= history.entries.length) {
		return {
			history: { entries: history.entries, index: index - 1, pending },
			doc: cloneInputDoc(history.entries[index - 1]),
		};
	}
	return undefined;
}

export function composerInputHistoryNext(history: IKnoxGuiComposerInputHistory): { history: IKnoxGuiComposerInputHistory; doc: IKnoxGuiInputBlock[] } | undefined {
	const index = history.index;
	if (index >= 0 && index < history.entries.length) {
		const nextIndex = index + 1;
		const doc = index === history.entries.length - 1 ? cloneInputDoc(history.pending) : cloneInputDoc(history.entries[nextIndex]);
		return { history: { ...history, index: nextIndex }, doc };
	}
	return undefined;
}

export function composerInputHistoryAdd(history: IKnoxGuiComposerInputHistory, doc: IKnoxGuiInputBlock[]): IKnoxGuiComposerInputHistory {
	if (history.entries.length && inputDocsEqual(history.entries[history.entries.length - 1], doc)) {
		return { entries: history.entries, index: history.entries.length, pending: emptyInputDoc() };
	}
	const entries = [...history.entries, cloneInputDoc(doc)].slice(-MAX_COMPOSER_INPUT_HISTORY);
	return { entries, index: entries.length, pending: emptyInputDoc() };
}
