/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import {
	appendTriggerToDoc,
	docEndCaret,
	composerInputHistoryAdd,
	composerUndoStep,
	composerInputHistoryNext,
	composerInputHistoryPrev,
	groupMentionItems,
	groupSlashItems,
	isMentionUtilityItem,
	knoxGuiComposerKeyAction,
	knoxGuiIsImeComposing,
	knoxGuiPendingToolBlocksSubmit,
	knoxGuiShouldBlockSubmit,
} from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { pendingApplyStates } from '../../../../common/knoxGuiTranscript.js';

/** `TipTapEditor.insertCharacterWithWhitespace("@")`: focus end, insert @, open mentions. */
export function insertAddContext(widget: KnoxGuiWidget): void {
	widget.controller.suggestTarget = undefined;
	const doc = appendTriggerToDoc(widget.controller.store.state.inputDoc, '@');
	widget.controller.composerCaret = docEndCaret(doc);
	widget.controller.pendingComposerCaret = widget.controller.composerCaret;
	widget.controller.store.setInputDoc(doc);
	void widget.controller.loadMentions('');
	widget.controller.store.patch({ inputFocused: true });
	queueMicrotask(() => widget.focusInput());
}

export function onEditorKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent, _state?: IKnoxGuiState): void {
	if (knoxGuiIsImeComposing(e)) {
		return;
	}
	const state = widget.controller.store.state;
	const sections = state.slashOpen
		? groupSlashItems(state.suggestItems, { query: state.suggestQuery })
		: groupMentionItems(state.suggestItems, { query: state.suggestQuery, inSubmenu: state.suggestSubmenu });
	const flat = sections.flatMap(section => section.items);
	const action = knoxGuiComposerKeyAction(e, {
		suggestOpen: state.mentionOpen || state.slashOpen,
		inSubmenu: Boolean(state.suggestSubmenu),
		isStreaming: state.isStreaming,
		caretAtStart: widget.caretAtEdge('start'),
		caretAtEnd: widget.caretAtEdge('end'),
		suggestSelected: state.suggestSelected,
		suggestCount: flat.length,
	});
	if (action.type === 'suggest') {
		if (action.action.type === 'move') {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.store.patch({ suggestSelected: action.action.index });
			queueMicrotask(() => widget.suggestEl?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }));
			return;
		}
		if (action.action.type === 'select') {
			e.preventDefault();
			e.stopPropagation();
			const item = flat[state.suggestSelected];
			if (item && !isMentionUtilityItem(item)) {
				widget.controller.applySuggest(item);
			}
			return;
		}
		if (action.action.type === 'close') {
			e.preventDefault();
			widget.controller.closeSuggest();
			return;
		}
	}
	if (action.type === 'exit-submenu') {
		e.preventDefault();
		widget.controller.exitSuggestSubmenu();
		return;
	}
	if (action.type === 'submit') {
		e.preventDefault();
		widget.submitFromComposer(action.altKey);
		return;
	}
	if (action.type === 'accept-diffs') {
		e.preventDefault();
		e.stopPropagation();
		if (pendingApplyStates(state.applyStates).length) {
			widget.controller.acceptAllApplies();
		}
		return;
	}
	if (action.type === 'reject-diffs') {
		e.preventDefault();
		e.stopPropagation();
		if (pendingApplyStates(state.applyStates).length) {
			widget.controller.rejectAllApplies();
		}
		return;
	}
	if (action.type === 'block-backspace') {
		e.preventDefault();
		return;
	}
	if (action.type === 'undo' || action.type === 'redo') {
		e.preventDefault();
		e.stopPropagation();
		stepComposerUndo(widget, action.type === 'undo' ? -1 : 1);
		return;
	}
	if (action.type === 'history-prev') {
		e.preventDefault();
		widget.stepInputHistory(-1);
		return;
	}
	if (action.type === 'history-next') {
		e.preventDefault();
		widget.stepInputHistory(1);
		return;
	}
	if (e.key === 'Escape') {
		widget.onEscape(e, state);
	}
}

export function submitFromComposer(widget: KnoxGuiWidget, altKey: boolean): void {
	const state = widget.controller.store.state;
	if (knoxGuiShouldBlockSubmit(state)) {
		if (knoxGuiPendingToolBlocksSubmit(state)) {
			widget.controller.messenger.post('showToast', ['error', t(state, 'cannotSubmitWhileAwaitingTool')]);
		}
		return;
	}
	if (widget.controller.noteMainComposerSend()) {
		widget.textDialog = {
			title: t(state, 'textDialogMilestoneTitle'),
			body: t(state, 'textDialogMilestoneBody'),
		};
	}
	const history = state.mode === 'edit' ? widget.editInputHistory : widget.chatInputHistory;
	const next = composerInputHistoryAdd(history, state.inputDoc);
	if (state.mode === 'edit') {
		widget.editInputHistory = next;
	} else {
		widget.chatInputHistory = next;
	}
	if (next.entries !== history.entries) {
		widget.controller.saveInputHistory(state.mode === 'edit' ? 'edit' : 'chat', next.entries);
	}
	void widget.controller.submit(undefined, { altKey });
}

export function stepInputHistory(widget: KnoxGuiWidget, delta: number): void { // KN-374
	const state = widget.controller.store.state;
	const current = state.mode === 'edit' ? widget.editInputHistory : widget.chatInputHistory;
	const stepped = delta < 0
		? composerInputHistoryPrev(current, state.inputDoc)
		: composerInputHistoryNext(current);
	if (!stepped) {
		return;
	}
	if (state.mode === 'edit') {
		widget.editInputHistory = stepped.history;
	} else {
		widget.chatInputHistory = stepped.history;
	}
	widget.controller.store.setInputDoc(stepped.doc);
	queueMicrotask(() => {
		if (!widget.editorEl) {
			return;
		}
		widget.editorEl.focus();
		if (delta < 0) {
			widget.placeCaretAtStart();
		} else {
			widget.placeCaretAtEnd();
		}
	});
}

export function stepComposerUndo(widget: KnoxGuiWidget, delta: -1 | 1): void {
	const stepped = composerUndoStep(widget.composerUndo, delta);
	if (!stepped) {
		return;
	}
	widget.composerUndo = stepped.undo;
	widget.controller.pendingComposerCaret = docEndCaret(stepped.doc);
	widget.composerUndoApplying = true;
	try {
		widget.controller.store.setInputDoc(stepped.doc);
	} finally {
		widget.composerUndoApplying = false;
	}
}

/** `editorConfig.ts`: pasted text lands as plain text; `insertText` keeps the browser's own undo in step. */
export function insertPlainText(editor: HTMLElement, text: string): void {
	const doc = editor.ownerDocument;
	if (doc.execCommand('insertText', false, text)) {
		return;
	}
	// execCommand is refused when the window is not focused; insert through the selection instead.
	const selection = doc.getSelection();
	let range = selection && selection.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : undefined;
	if (!range) {
		range = doc.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
	}
	range.deleteContents();
	const node = doc.createTextNode(text);
	range.insertNode(node);
	range.setStartAfter(node);
	range.collapse(true);
	selection?.removeAllRanges();
	selection?.addRange(range);
	editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/** `editorConfig.ts` Image paste plugin: every pasted file goes through `handleImageFile` on image models. */
export function onEditorPaste(widget: KnoxGuiWidget, event: ClipboardEvent, state: IKnoxGuiState): void {
	const items = event.clipboardData?.items;
	if (!items) {
		return;
	}
	const files = Array.from(items).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
	// Image paste plugin only queues files on image models and never cancels the paste; text in the same clipboard still lands.
	if (files.length && state.imagesSupported) {
		for (const file of files) {
			widget.readImageFile(file);
		}
	}
	const text = event.clipboardData?.getData('text/plain');
	if (text) {
		event.preventDefault();
		insertPlainText(event.currentTarget as HTMLElement, text);
		return;
	}
	if (files.length || text !== undefined) {
		// Nothing to insert as text: keep the browser from dropping a raw <img> / empty node into the contenteditable.
		event.preventDefault();
	}
}
