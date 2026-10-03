/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxGuiContextLevel, knoxGuiContextRatio, knoxGuiFormatTokens } from '../../../../common/knoxGuiContextMeter.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiCanCancel, knoxGuiEditSendKey, knoxGuiRelativeFontSize } from '../../../../common/knoxGuiChrome.js';
import {
	composerPlaceholderKey,
	inputDocIsEmpty,
	inputDocToPlainText,
	knoxGuiSendButtonDisabled,
} from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { setComposerCollapsed } from './layout.js';
import { renderImageAttach } from './attachments.js';

export function syncInput(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	if (!widget.editorEl || !widget.inputWrap) {
		widget.render();
		return;
	}
	const current = inputDocToPlainText(widget.readInputDoc(widget.editorEl));
	if (current !== state.input) {
		widget.paintInputDoc(widget.editorEl, state.inputDoc);
		const focused = document.activeElement === widget.editorEl || widget.editorEl.contains(document.activeElement);
		if (focused || (state.inputFocused && widget.controller.pendingComposerCaret)) {
			widget.focusInput();
		}
	}
	widget.syncPlaceholder(widget.editorEl, state);
	widget.paintTypedMention(state);
	const target = widget.controller.suggestTarget;
	widget.renderSuggest(target ? widget.historyEditorBoxes.get(target) ?? widget.inputWrap : widget.inputWrap, state);
	if (state.inputFocused && !state.suggestQueryItem) {
		widget.editorEl.focus();
	}
}

export function renderInput(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const wrap = DOM.append(parent, DOM.$('.knox-gui-input-wrap.knox-gui-editor'));
	wrap.setAttribute('data-composer-slot', 'editor');
	widget.inputWrap = wrap;
	if (!widget.controller.suggestTarget) {
		widget.renderSuggest(wrap, state);
	}
	widget.renderImageThumbnails(wrap, state);
	const editor = DOM.append(wrap, DOM.$('.knox-gui-input')) as HTMLElement;
	widget.editorEl = editor;
	editor.contentEditable = 'true';
	editor.setAttribute('role', 'textbox');
	editor.setAttribute('aria-multiline', 'true');
	editor.setAttribute('data-testid', 'knox-gui-input');
	editor.spellcheck = false;
	widget.paintInputDoc(editor, state.inputDoc);
	widget.syncPlaceholder(editor, state);
	if (state.inputFocused && !state.suggestQueryItem) {
		queueMicrotask(() => widget.focusInput());
	}
	widget.renderStore.add(DOM.addDisposableListener(editor, 'focus', () => widget.controller.store.patch({ inputFocused: true })));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'blur', () => {
		widget.controller.composerCaret = widget.caretDocPosition(editor) ?? widget.controller.composerCaret;
		widget.controller.store.patch({ inputFocused: false });
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'input', () => {
		widget.controller.store.setInputDoc(widget.readInputDoc(editor));
		widget.syncPlaceholder(editor, widget.controller.store.state);
		widget.controller.onComposerInput(widget.caretDocPosition(editor));
		widget.paintTypedMention(widget.controller.store.state);
	}));
	const recheckTrigger = () => {
		const current = widget.controller.store.state;
		if (current.mentionOpen || current.slashOpen) {
			widget.controller.onComposerInput(widget.caretDocPosition(editor));
		}
	};
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keyup', (e: KeyboardEvent) => {
		widget.controller.composerCaret = widget.caretDocPosition(editor) ?? widget.controller.composerCaret;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
			recheckTrigger();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'mouseup', () => {
		widget.controller.composerCaret = widget.caretDocPosition(editor) ?? widget.controller.composerCaret;
		recheckTrigger();
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'paste', (e: ClipboardEvent) => widget.onEditorPaste(e, state)));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keydown', (e: KeyboardEvent) => widget.onEditorKeyDown(e, widget.controller.store.state), true));
	const row = DOM.append(wrap, DOM.$('.knox-gui-input-bar'));
	row.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -2)}px`;
	const left = DOM.append(row, DOM.$('.knox-gui-input-bar-left'));
	const right = DOM.append(row, DOM.$('.knox-gui-input-bar-right'));
	right.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	const icons = DOM.append(left, DOM.$('.knox-gui-input-bar-icons'));

	if (state.imagesSupported) {
		renderImageAttach(widget, icons, state, 'knox-gui-attach-image', (urls, files) => {
			widget.addImages(urls.map((imageUrl, index) => ({ name: files[index]?.name ?? 'image', imageUrl })));
		});
	}
	widget.chromeButton(icons, {
		svg: 'add-context',
		svgSize: 13,
		title: t(state, 'addContext'),
		testId: 'knox-gui-add-context',
		extraClass: 'knox-gui-xs-hide',
		onClick: () => widget.insertAddContext(),
	});

	widget.renderModelSelect(left, state);
	widget.renderReasoningSelect(left, state);
	if (state.webSearchSupported) {
		widget.chromeButton(left, {
			svg: 'globe',
			svgSize: 12,
			selected: state.webSearchEnabled,
			title: t(state, state.webSearchEnabled ? 'webSearchTooltipActive' : 'webSearchTooltipInactive'),
			testId: 'knox-gui-web-search',
			extraClass: state.webSearchEnabled ? 'knox-gui-web-search-on' : '',
			disabled: state.isStreaming,
			onClick: () => widget.controller.store.patch({ webSearchEnabled: !state.webSearchEnabled }),
		});
	}

	const hide = widget.chromeButton(right, {
		svg: 'list-chevrons-down-up',
		svgSize: 14,
		title: t(state, 'hideInput'),
		testId: 'knox-gui-composer-collapse',
		extraClass: 'knox-gui-composer-toggle',
		onClick: () => setComposerCollapsed(widget, true),
	});
	hide.setAttribute('aria-expanded', 'true');
	hide.setAttribute('aria-label', t(state, 'hideInput'));
	if (widget.composerToggle?.dir === 'expand') {
		hide.classList.add('knox-gui-toggle-pop');
	}
	if (!widget.composerCollapsed) {
		widget.renderScrollButtons(right, state);
	}

	if (state.mode === 'edit') {
		widget.chromeButton(right, {
			label: `Esc ${t(state, 'exitEdit')}`,
			title: t(state, 'exitEdit'),
			testId: 'knox-gui-exit-edit',
			extraClass: 'knox-gui-exit-edit knox-gui-sm-hide',
			onClick: () => void widget.controller.exitEditMode(),
		});
	}

	const usage = state.contextUsage;
	if (usage && usage.sessionId === state.sessionId && state.history.length > 0) {
		const ratio = knoxGuiContextRatio(usage);
		const meter = DOM.append(right, DOM.$(`span.knox-gui-context-meter.knox-gui-context-${knoxGuiContextLevel(ratio)}`, undefined, `${Math.round(ratio * 100)}%`));
		meter.setAttribute('data-testid', 'knox-gui-context-meter');
		meter.title = `${t(state, 'contextMeterTitle')}: ${knoxGuiFormatTokens(usage.used)} / ${knoxGuiFormatTokens(usage.limit)}${usage.source === 'estimated' ? ' (~)' : ''}`;
	}
	const canCancel = knoxGuiCanCancel(state);
	if (canCancel) {
		widget.chromeButton(right, {
			svg: 'cancel',
			svgSize: 14,
			title: t(state, 'cancelGeneration'),
			testId: 'knox-gui-send',
			extraClass: 'knox-gui-cancel knox-gui-send',
			onClick: () => widget.controller.cancel(),
		});
	} else {
		const blocked = knoxGuiSendButtonDisabled(state);
		const send = widget.chromeButton(right, {
			svg: 'send',
			svgSize: 14,
			label: t(state, knoxGuiEditSendKey(state)),
			title: t(state, 'sendMessage'),
			testId: 'knox-gui-send',
			extraClass: 'knox-gui-send',
			disabled: blocked,
			onClick: (_button, event) => widget.submitFromComposer(Boolean(event?.altKey)),
		});
		send.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	}
}

export function syncPlaceholder(widget: KnoxGuiWidget, editor: HTMLElement, state: IKnoxGuiState): void {
	const empty = inputDocIsEmpty(widget.readInputDoc(editor));
	editor.dataset.empty = empty ? 'true' : 'false';
	editor.dataset.placeholder = t(state, composerPlaceholderKey(state.mode, state.history.length));
}
