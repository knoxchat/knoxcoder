/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { inputDocIsEmpty, knoxGuiIsImeComposing } from '../../../../common/knoxGuiInput.js';

export function composerImeActive(widget: KnoxGuiWidget): boolean {
	return widget.composerImeDepth > 0;
}

export function beginComposerIme(widget: KnoxGuiWidget): void {
	widget.composerImeDepth += 1;
}

/**
 * TipTap/ProseMirror keeps `view.composing` and never re-applies editor state onto the
 * composition range. The native composer must do the same: the IME owns the DOM until
 * `compositionend`, then we read the committed characters back into the store.
 */
export function endComposerIme(widget: KnoxGuiWidget, editor: HTMLElement, historyId?: string): void {
	widget.composerImeDepth = Math.max(0, widget.composerImeDepth - 1);
	if (widget.composerImeDepth > 0) {
		return;
	}
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
	widget.renderStore.add(DOM.addDisposableListener(editor, 'compositionstart', () => beginComposerIme(widget), true));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'compositionend', () => endComposerIme(widget, editor, historyId), true));
	// A composition that loses focus may never deliver `compositionend`; a stuck depth would freeze syncInput/render replay.
	widget.renderStore.add(DOM.addDisposableListener(editor, 'blur', () => {
		if (widget.composerImeDepth > 0) {
			widget.composerImeDepth = 1;
			endComposerIme(widget, editor, historyId);
		}
	}));
}

export function composerImeFromInput(widget: KnoxGuiWidget, event: Event): boolean {
	if (event instanceof InputEvent && event.isComposing) {
		if (widget.composerImeDepth === 0) {
			widget.composerImeDepth = 1;
		}
		return true;
	}
	return composerImeActive(widget) || knoxGuiIsImeComposing(event as { isComposing?: boolean; keyCode?: number });
}
