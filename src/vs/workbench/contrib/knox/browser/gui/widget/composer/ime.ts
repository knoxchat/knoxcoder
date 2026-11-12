/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { inputDocIsEmpty, KNOX_COMPOSER_IME_SUBMIT_GUARD_MS, knoxGuiIsImeComposing } from '../../../../common/knoxGuiInput.js';

export function composerImeActive(widget: KnoxGuiWidget): boolean {
	return widget.composerImeDepth > 0;
}

/** Hide the empty-state placeholder for the whole composition so it cannot clip pinyin. */
export function markComposerImeDom(editor: HTMLElement, composing: boolean): void {
	if (composing) {
		editor.dataset.composing = 'true';
		editor.dataset.empty = 'false';
		return;
	}
	delete editor.dataset.composing;
}

export function beginComposerIme(widget: KnoxGuiWidget, editor: HTMLElement): void {
	widget.composerImeDepth += 1;
	markComposerImeDom(editor, true);
}

/**
 * TipTap/ProseMirror keeps `view.composing` and never re-applies editor state onto the
 * composition range. The native composer must do the same: the IME owns the DOM until
 * `compositionend`, then we read the committed characters back into the store.
 *
 * A stray `compositionend` with no matching start (macOS/iOS Chinese IME extra empty
 * end) must not commit or rebuild the editor.
 */
export function endComposerIme(widget: KnoxGuiWidget, editor: HTMLElement, historyId?: string): void {
	if (widget.composerImeDepth === 0) {
		return;
	}
	widget.composerImeDepth -= 1;
	if (widget.composerImeDepth > 0) {
		return;
	}
	markComposerImeDom(editor, false);
	// Candidate-confirm Enter often arrives after this event with isComposing false.
	widget.composerImeIgnoreSubmitUntil = Date.now() + KNOX_COMPOSER_IME_SUBMIT_GUARD_MS;
	const replay = widget.composerImeNeedsReplay;
	widget.composerImeNeedsReplay = false;
	if (historyId) {
		const draft = widget.historyDrafts.get(historyId);
		if (draft) {
			draft.doc = widget.readInputDoc(editor);
			widget.historyDrafts.set(historyId, draft);
			editor.dataset.empty = inputDocIsEmpty(draft.doc) ? 'true' : 'false';
		}
		if (widget.controller.suggestTarget === historyId) {
			widget.controller.onComposerInput(widget.caretDocPosition(editor), historyId);
		}
	} else {
		widget.controller.store.setInputDoc(widget.readInputDoc(editor));
		widget.syncPlaceholder(editor, widget.controller.store.state);
		widget.controller.onComposerInput(widget.caretDocPosition(editor));
		widget.paintTypedMention(widget.controller.store.state);
	}
	if (replay) {
		widget.onState(widget.controller.store.state);
	}
}

export function bindComposerIme(widget: KnoxGuiWidget, editor: HTMLElement, historyId?: string): void {
	widget.renderStore.add(DOM.addDisposableListener(editor, 'compositionstart', () => beginComposerIme(widget, editor), true));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'compositionend', () => endComposerIme(widget, editor, historyId), true));
	// A composition that loses focus may never deliver `compositionend`; a stuck depth would freeze syncInput/render replay.
	widget.renderStore.add(DOM.addDisposableListener(editor, 'blur', () => {
		if (widget.composerImeDepth > 0) {
			widget.composerImeDepth = 1;
			endComposerIme(widget, editor, historyId);
		}
	}));
}

export function composerImeFromInput(widget: KnoxGuiWidget, event: Event, editor?: HTMLElement): boolean {
	if (event instanceof InputEvent && event.isComposing) {
		if (widget.composerImeDepth === 0) {
			widget.composerImeDepth = 1;
		}
		if (editor) {
			markComposerImeDom(editor, true);
		}
		return true;
	}
	const active = composerImeActive(widget) || knoxGuiIsImeComposing(event as { isComposing?: boolean; keyCode?: number });
	if (active && editor) {
		markComposerImeDom(editor, true);
	}
	return active;
}
