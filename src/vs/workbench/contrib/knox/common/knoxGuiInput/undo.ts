/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cloneInputDoc, emptyInputDoc, type IKnoxGuiInputBlock } from './doc.js';

/** Composer undo/redo stack (`tiptap UndoRedo` defaults). */

export const KNOX_COMPOSER_UNDO_DEPTH = 100;
export const KNOX_COMPOSER_UNDO_GROUP_MS = 500;

export interface IKnoxGuiComposerUndo {
	/** Doc states, oldest first; `index` points at the current one. */
	stack: IKnoxGuiInputBlock[][];
	index: number;
	lastAt: number;
}

export function createComposerUndo(doc: IKnoxGuiInputBlock[] = emptyInputDoc()): IKnoxGuiComposerUndo {
	return { stack: [cloneInputDoc(doc)], index: 0, lastAt: 0 };
}

export function composerUndoRecord(undo: IKnoxGuiComposerUndo, doc: IKnoxGuiInputBlock[], now: number): IKnoxGuiComposerUndo {
	const current = undo.stack[undo.index];
	if (current && JSON.stringify(current) === JSON.stringify(doc)) {
		return undo;
	}
	const kept = undo.stack.slice(0, undo.index + 1);
	const grouped = undo.index > 0 && now - undo.lastAt < KNOX_COMPOSER_UNDO_GROUP_MS;
	if (grouped) {
		kept[kept.length - 1] = cloneInputDoc(doc);
	} else {
		kept.push(cloneInputDoc(doc));
	}
	const stack = kept.slice(-(KNOX_COMPOSER_UNDO_DEPTH + 1));
	return { stack, index: stack.length - 1, lastAt: now };
}

export function composerUndoStep(undo: IKnoxGuiComposerUndo, delta: -1 | 1): { undo: IKnoxGuiComposerUndo; doc: IKnoxGuiInputBlock[] } | undefined {
	const index = undo.index + delta;
	if (index < 0 || index >= undo.stack.length) {
		return undefined;
	}
	return { undo: { ...undo, index, lastAt: 0 }, doc: cloneInputDoc(undo.stack[index]) };
}
