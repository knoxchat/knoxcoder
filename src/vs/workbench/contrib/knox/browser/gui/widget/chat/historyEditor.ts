/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiEditSendKey, knoxGuiRelativeFontSize } from '../../../../common/knoxGuiChrome.js';
import { appendTriggerToDoc, composerInputHistoryNext, composerInputHistoryPrev, composerPlaceholderKey, composerUndoRecord, composerUndoStep, createComposerUndo, detectComposerTrigger, docEndCaret, emptyInputDoc, groupMentionItems, groupSlashItems, IKnoxGuiDocCaret, inputDocIsEmpty, IKnoxGuiInputBlock, isMentionUtilityItem, knoxGuiComposerKeyAction } from '../../../../common/knoxGuiInput.js';
import { hideDropOverlay, renderImageAttach, showDropOverlay } from '../composer.js';
import { processImageFile, processImageFiles } from '../images.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { historyUserInputDoc } from '../../../../common/knoxGuiTranscript.js';

export function historyDraftFor(widget: KnoxGuiWidget, item: IKnoxGuiHistoryItem): { doc: IKnoxGuiInputBlock[]; images: string[] } {
	const existing = widget.historyDrafts.get(item.id);
	if (existing) {
		return existing;
	}
	const draft = { doc: historyUserInputDoc(item), images: [...(item.images ?? [])] };
	widget.historyDrafts.set(item.id, draft);
	return draft;
}

export function renderHistoricalEditor(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
	const draft = widget.historyDraftFor(item);
	const focused = widget.focusedHistoryId === item.id;
	const box = DOM.append(parent, DOM.$('.knox-gui-input-wrap.knox-gui-history-editor'));
	if (draft.images.length) {
		const thumbs = DOM.append(box, DOM.$('.knox-gui-thumbs'));
		thumbs.setAttribute('data-testid', 'knox-gui-image-thumbs');
		for (const [imageIndex, url] of draft.images.entries()) {
			widget.renderThumb(thumbs, state, url, `historical-${imageIndex}`, t(state, 'historicalImageAlt', { index: imageIndex + 1 }), () => {
				draft.images = draft.images.filter((_, i) => i !== imageIndex);
				widget.historyDrafts.set(item.id, draft);
				widget.render();
			});
		}
	}
	const editor = DOM.append(box, DOM.$('.knox-gui-input')) as HTMLElement;
	editor.contentEditable = 'true';
	editor.spellcheck = false;
	editor.setAttribute('role', 'textbox');
	editor.setAttribute('aria-multiline', 'true');
	editor.setAttribute('data-testid', 'knox-gui-history-input');
	editor.setAttribute('data-history-id', item.id);
	widget.historyEditorEls.set(item.id, editor);
	widget.historyEditorBoxes.set(item.id, box);
	const onDocChange = (next: IKnoxGuiInputBlock[]) => {
		draft.doc = next;
		widget.historyDrafts.set(item.id, draft);
	};
	widget.paintInputDoc(editor, draft.doc, onDocChange);
	const empty = inputDocIsEmpty(draft.doc);
	editor.dataset.empty = empty ? 'true' : 'false';
	editor.dataset.placeholder = t(state, composerPlaceholderKey(state.mode, state.history.length));
	if (!widget.historyUndo.has(item.id)) {
		widget.historyUndo.set(item.id, createComposerUndo(draft.doc));
	}
	const bar = DOM.append(box, DOM.$('.knox-gui-input-bar'));
	bar.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -2)}px`;
	const keepToolbar = state.mode === 'edit';
	if (!focused && !keepToolbar) {
		bar.classList.add('knox-gui-input-bar--hidden');
	}
	widget.renderStore.add(DOM.addDisposableListener(editor, 'focus', () => {
		widget.focusedHistoryId = item.id;
		bar.classList.remove('knox-gui-input-bar--hidden');
	}));
	widget.renderStore.add(DOM.addDisposableListener(box, 'focusout', (e: FocusEvent) => {
		const next = e.relatedTarget as Node | null;
		if (next && box.contains(next)) {
			return;
		}
		window.setTimeout(() => {
			if (widget.focusedHistoryId === item.id && !box.contains(document.activeElement)) {
				widget.focusedHistoryId = null;
				if (!keepToolbar) {
					bar.classList.add('knox-gui-input-bar--hidden');
				}
				if (widget.controller.suggestTarget === item.id) {
					widget.controller.closeSuggest();
				}
			}
		}, 100);
	}));
	const recheckTrigger = () => {
		if (widget.controller.suggestTarget === item.id) {
			widget.controller.onComposerInput(widget.caretDocPosition(editor), item.id);
		}
	};
	widget.renderStore.add(DOM.addDisposableListener(editor, 'input', () => {
		draft.doc = widget.readInputDoc(editor);
		widget.historyDrafts.set(item.id, draft);
		editor.dataset.empty = inputDocIsEmpty(draft.doc) ? 'true' : 'false';
		if (!widget.historyUndoApplying.has(item.id)) {
			widget.historyUndo.set(item.id, composerUndoRecord(widget.historyUndo.get(item.id) ?? createComposerUndo(draft.doc), draft.doc, Date.now()));
		}
		if (widget.controller.suggestTarget === item.id) {
			widget.controller.onComposerInput(widget.caretDocPosition(editor), item.id);
			return;
		}
		if (state.mode === 'edit' && detectComposerTrigger(draft.doc, undefined, { mode: 'edit' })?.kind === 'codeToEdit') {
			widget.controller.onComposerInput(docEndCaret(draft.doc), item.id);
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keyup', (e: KeyboardEvent) => {
		if (widget.controller.suggestTarget === item.id && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
			recheckTrigger();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'mouseup', recheckTrigger));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keydown', (e: KeyboardEvent) => onHistoryEditorKeyDown(widget, e, editor, item, index, draft)));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'paste', (e: ClipboardEvent) => {
		const files = Array.from(e.clipboardData?.items ?? []).map(entry => entry.getAsFile()).filter((file): file is File => Boolean(file));
		if (files.length) {
			e.preventDefault();
			if (widget.controller.store.state.imagesSupported) {
				for (const file of files) {
					widget.readImageFileIntoDraft(file, item.id);
				}
			}
			return;
		}
		const text = e.clipboardData?.getData('text/plain');
		if (text !== undefined) {
			e.preventDefault();
			widget.insertPlainText(editor, text);
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(box, 'dragover', (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (widget.controller.store.state.imagesSupported) {
			widget.historyDropOverId = item.id;
			if (!widget.dropOverlayEl) {
				showDropOverlay(widget, box);
			}
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(box, 'dragleave', (e: DragEvent) => {
		if (e.relatedTarget && box.contains(e.relatedTarget as Node)) {
			return;
		}
		if (widget.historyDropOverId === item.id) {
			widget.historyDropOverId = null;
			hideDropOverlay(widget);
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(box, 'drop', (e: DragEvent) => onHistoryEditorDrop(widget, e, item.id)));
	widget.renderStore.add(DOM.addDisposableListener(box, 'click', () => editor.focus()));
	if (focused) {
		queueMicrotask(() => {
			editor.focus();
			const pending = widget.historyPendingCaret;
			if (pending?.id === item.id) {
				widget.historyPendingCaret = undefined;
				widget.placeCaretAtDocPosition(editor, pending.caret);
			} else {
				widget.placeCaretAtEndOf(editor);
			}
		});
	}
	if (widget.controller.suggestTarget === item.id) {
		widget.renderSuggest(box, state);
	}
	const left = DOM.append(bar, DOM.$('.knox-gui-input-bar-left'));
	const right = DOM.append(bar, DOM.$('.knox-gui-input-bar-right'));
	right.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	const icons = DOM.append(left, DOM.$('.knox-gui-input-bar-icons'));
	if (state.imagesSupported) {
		renderImageAttach(widget, icons, state, 'knox-gui-history-attach-image', urls => addDraftImages(widget, item.id, urls));
	}
	widget.chromeButton(icons, {
		svg: 'add-context',
		svgSize: 13,
		title: t(state, 'addContext'),
		testId: 'knox-gui-history-add-context',
		extraClass: 'knox-gui-xs-hide',
		onClick: () => {
			const doc = appendTriggerToDoc(widget.readInputDoc(editor), '@');
			const caret = docEndCaret(doc);
			setHistoryDraftDoc(widget, item.id, doc, caret);
			widget.controller.onComposerInput(caret, item.id);
		},
	});
	widget.renderModelSelect(left, state, item.id);
	widget.renderReasoningSelect(left, state, item.id);
	if (state.webSearchSupported) {
		widget.chromeButton(left, {
			svg: 'globe',
			svgSize: 12,
			selected: state.webSearchEnabled,
			title: t(state, state.webSearchEnabled ? 'webSearchTooltipActive' : 'webSearchTooltipInactive'),
			extraClass: state.webSearchEnabled ? 'knox-gui-web-search-on' : '',
			onClick: () => widget.controller.store.patch({ webSearchEnabled: !state.webSearchEnabled }),
		});
	}
	if (state.mode === 'edit') {
		widget.chromeButton(right, {
			label: `Esc ${t(state, 'exitEdit')}`,
			title: t(state, 'exitEdit'),
			testId: 'knox-gui-history-exit-edit',
			extraClass: 'knox-gui-exit-edit knox-gui-sm-hide',
			onClick: () => void widget.controller.exitEditMode(),
		});
	}
	widget.chromeButton(right, {
		svg: 'send',
		svgSize: 14,
		label: t(state, knoxGuiEditSendKey(state)),
		title: t(state, 'sendMessage'),
		testId: 'knox-gui-history-send',
		extraClass: 'knox-gui-send',
		onClick: (_button, event) => void widget.controller.submitEditedUser(index, widget.readInputDoc(editor), draft.images, event?.altKey),
	}).style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
}

export function readImageFileIntoDraft(widget: KnoxGuiWidget, file: File, historyId: string): void {
	void processImageFile(widget, file).then(url => addDraftImages(widget, historyId, url ? [url] : []));
}

function addDraftImages(widget: KnoxGuiWidget, historyId: string, urls: readonly string[]): void {
	if (!urls.length) {
		return;
	}
	const draft = widget.historyDrafts.get(historyId) ?? { doc: emptyInputDoc(), images: [] };
	draft.images = [...draft.images, ...urls];
	widget.historyDrafts.set(historyId, draft);
	widget.render();
}

/** `TipTapEditor.tsx` onDrop on a history message editor: images only, into that editor's thumbnails. */
function onHistoryEditorDrop(widget: KnoxGuiWidget, e: DragEvent, historyId: string): void {
	e.preventDefault();
	e.stopPropagation();
	widget.historyDropOverId = null;
	hideDropOverlay(widget);
	const state = widget.controller.store.state;
	if (!state.imagesSupported) {
		widget.controller.messenger.post('showToast', ['warning', t(state, 'modelNoImageSupport')]);
		return;
	}
	const files = Array.from(e.dataTransfer?.files ?? []);
	if (!files.length) {
		return;
	}
	const images = files.filter(file => file.type.startsWith('image/'));
	if (!images.length) {
		widget.controller.messenger.post('showToast', ['warning', t(state, 'pleaseDropImageFiles')]);
		return;
	}
	void processImageFiles(widget, images).then(urls => addDraftImages(widget, historyId, urls));
}

/** A picker pick in a history editor: repaint that editor and put the caret after the chip. */
export function setHistoryDraftDoc(widget: KnoxGuiWidget, historyId: string, doc: IKnoxGuiInputBlock[], caret: IKnoxGuiDocCaret): void {
	const draft = widget.historyDrafts.get(historyId) ?? { doc: emptyInputDoc(), images: [] };
	if (!widget.historyUndoApplying.has(historyId)) {
		widget.historyUndo.set(historyId, composerUndoRecord(widget.historyUndo.get(historyId) ?? createComposerUndo(draft.doc), doc, Date.now()));
	}
	draft.doc = doc;
	widget.historyDrafts.set(historyId, draft);
	const editor = widget.historyEditorEls.get(historyId);
	if (!editor) {
		widget.historyPendingCaret = { id: historyId, caret };
		return;
	}
	widget.paintInputDoc(editor, doc, next => {
		draft.doc = next;
		widget.historyDrafts.set(historyId, draft);
	});
	editor.dataset.empty = inputDocIsEmpty(doc) ? 'true' : 'false';
	editor.focus();
	widget.placeCaretAtDocPosition(editor, caret);
}

/**
 * `editorConfig.ts` keys for a non-main editor: picker navigation, Enter /
 * Mod+Enter / Alt+Enter submit, ArrowUp / ArrowDown walk the chat input
 * history, Escape closes the picker or returns focus to the code editor.
 */
function onHistoryEditorKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent, editor: HTMLElement, item: IKnoxGuiHistoryItem, index: number, draft: { doc: IKnoxGuiInputBlock[]; images: string[] }): void {
	const state = widget.controller.store.state;
	const suggestOpen = (state.mentionOpen || state.slashOpen) && widget.controller.suggestTarget === item.id;
	const sections = state.slashOpen
		? groupSlashItems(state.suggestItems, { query: state.suggestQuery })
		: groupMentionItems(state.suggestItems, { query: state.suggestQuery, inSubmenu: state.suggestSubmenu });
	const flat = suggestOpen ? sections.flatMap(section => section.items) : [];
	const action = knoxGuiComposerKeyAction(e, {
		suggestOpen,
		inSubmenu: Boolean(state.suggestSubmenu),
		isStreaming: false,
		caretAtStart: caretAtEdgeOf(editor, 'start'),
		caretAtEnd: caretAtEdgeOf(editor, 'end'),
		suggestSelected: state.suggestSelected,
		suggestCount: flat.length,
	});
	if (action.type === 'suggest') {
		e.preventDefault();
		e.stopPropagation();
		if (action.action.type === 'move') {
			widget.controller.store.patch({ suggestSelected: action.action.index });
			queueMicrotask(() => widget.suggestEl?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }));
		} else if (action.action.type === 'select') {
			const pick = flat[state.suggestSelected];
			if (pick && !isMentionUtilityItem(pick)) {
				widget.controller.applySuggest(pick);
			}
		} else if (action.action.type === 'close') {
			widget.controller.closeSuggest();
		}
		return;
	}
	if (action.type === 'exit-submenu') {
		e.preventDefault();
		widget.controller.exitSuggestSubmenu();
		return;
	}
	if (action.type === 'undo' || action.type === 'redo') {
		e.preventDefault();
		e.stopPropagation();
		const current = widget.historyUndo.get(item.id) ?? createComposerUndo(draft.doc);
		const stepped = composerUndoStep(current, action.type === 'undo' ? -1 : 1);
		if (!stepped) {
			return;
		}
		widget.historyUndoApplying.add(item.id);
		widget.historyUndo.set(item.id, stepped.undo);
		setHistoryDraftDoc(widget, item.id, stepped.doc, docEndCaret(stepped.doc));
		widget.historyUndoApplying.delete(item.id);
		return;
	}
	if (action.type === 'submit') {
		e.preventDefault();
		e.stopPropagation();
		void widget.controller.submitEditedUser(index, widget.readInputDoc(editor), draft.images, action.altKey);
		return;
	}
	if (action.type === 'history-prev' || action.type === 'history-next') {
		const current = widget.historyInputHistories.get(item.id) ?? { ...widget.chatInputHistory, index: widget.chatInputHistory.entries.length };
		const stepped = action.type === 'history-prev'
			? composerInputHistoryPrev(current, widget.readInputDoc(editor))
			: composerInputHistoryNext(current);
		if (!stepped) {
			return;
		}
		e.preventDefault();
		widget.historyInputHistories.set(item.id, stepped.history);
		setHistoryDraftDoc(widget, item.id, stepped.doc, action.type === 'history-prev' ? { block: 0, offset: 0 } : docEndCaret(stepped.doc));
		return;
	}
	if (e.key === 'Escape') {
		e.preventDefault();
		e.stopPropagation();
		if (state.mode === 'edit') {
			void widget.controller.exitEditMode();
			return;
		}
		widget.controller.focusHostEditor();
	}
}

function caretAtEdgeOf(editor: HTMLElement, edge: 'start' | 'end'): boolean {
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
