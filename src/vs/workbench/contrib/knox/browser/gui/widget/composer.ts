/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import {
	knoxGuiCanCancel,
	knoxGuiEditSendKey,
	knoxGuiRelativeFontSize,
	knoxGuiShowsLumpOverlay,
	KNOX_LUMP_FADE_MS,
	knoxGuiShowsAgentMeter,
	knoxGuiShowsChatPermissionBar,
	knoxGuiShowsChatToolButtons,
	knoxGuiShowsComposerAcceptReject,
	knoxGuiShowsBatchDiffEntry,
	knoxGuiAcceptRejectLabelKeys,
	knoxGuiAcceptRejectWidthKeys,
	knoxGuiAcceptRejectShortcut,
} from '../../../common/knoxGuiChrome.js';
import { knoxGuiListboxNextIndex, knoxGuiModelSelectTitle, knoxGuiSortModelsByApiKey } from '../../../common/knoxGuiCapabilities.js';
import { appendKnoxGuiSvg, knoxGuiNamedIcon } from '../knoxGuiIcons.js';
import { findCurrentToolCall, toolDisplayKind } from '../../../common/knoxGuiChat.js';
import {
	appendTriggerToDoc,
	docEndCaret,
	IKnoxGuiDocCaret,
	isFolderMentionNode,
	isPathMentionNode,
	isSlashBookmarked,
	lastRelativePathParts,
	mentionChipOpenUri,
	mentionChipTooltip,
	mentionFloatingPosition,
	MENTION_FLOATING_OFFSET,
	composerInputHistoryAdd,
	composerUndoStep,
	composerInputHistoryNext,
	composerInputHistoryPrev,
	composerPlaceholderKey,
	emptyInputDoc,
	groupMentionItems,
	groupSlashItems,
	highlightMentionMatch,
	imagePreviewPosition,
	inputDocIsEmpty,
	inputDocToPlainText,
	IKnoxGuiInputBlock,
	isDroppedImageFile,
	knoxGuiImageFileAccepted,
	IKnoxGuiInputCodeBlock,
	KNOX_DRAG_LEAVE_HIDE_MS,
	knoxGuiCodeBlockOpenAction,
	knoxGuiCodeBlockTitle,
	knoxGuiNewestCodeBlockIndex,
	knoxGuiDragHasImages,
	isFolderMentionItem,
	isMentionUtilityItem,
	isOpenableMentionRow,
	isPathMentionItem,
	isSingleRangeEdit,
	knoxGuiCodeToEditTitle,
	knoxGuiComposerKeyAction,
	knoxGuiSendButtonDisabled,
	knoxGuiPendingToolBlocksSubmit,
	knoxGuiShouldBlockSubmit,
	KnoxGuiInlineNode,
	mentionChipLabel,
	mentionIndexIsTruncated,
	mentionOptionId,
	parseUriList,
	removeCodeBlockAt,
	shouldShowMentionSectionHeaders,
	shouldShowSlashSectionHeaders,
	slashCommandBareName,
	slashCommandTitle,
} from '../../../common/knoxGuiInput.js';
import type { KnoxGuiOverlay } from '../../../common/knoxGuiProtocol.js';
import { reasoningEffortLabelKey } from '../../../common/knoxGuiOverlays.js';
import { IKnoxGuiState, IKnoxGuiSuggestItem } from '../../../common/knoxGuiState.js';
import { pendingApplyStates } from '../../../common/knoxGuiTranscript.js';
import { displayLanguageForFile } from '../../../common/knoxGuiTools.js';
import { processImageFile, processImageFiles } from './images.js';

export function onDragOver(widget: KnoxGuiWidget, event: DragEvent): void {
	event.preventDefault();
	const items = Array.from(event.dataTransfer?.items ?? []);
	if (!knoxGuiDragHasImages(items)) {
		return;
	}
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
		widget.dragLeaveTimer = undefined;
	}
	if (!widget.dragOver) {
		widget.dragOver = true;
		widget.showDropOverlay();
	}
}

/** `TipTapEditor.tsx`: leaving the window hides the overlay after 1000 ms. */
export function onDragLeave(widget: KnoxGuiWidget, event: DragEvent): void {
	if (event.relatedTarget && widget.root.contains(event.relatedTarget as Node)) {
		return;
	}
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
	}
	widget.dragLeaveTimer = setTimeout(() => {
		widget.dragLeaveTimer = undefined;
		widget.dragOver = false;
		widget.hideDropOverlay();
	}, KNOX_DRAG_LEAVE_HIDE_MS);
}

/** The overlay only shows for image models (`modelSupportsImages` guard around `DragOverlay`). */
export function showDropOverlay(widget: KnoxGuiWidget, parent: HTMLElement = widget.root): void {
	if (widget.dropOverlayEl || !widget.controller.store.state.imagesSupported) {
		return;
	}
	const overlay = DOM.append(parent, DOM.$('.knox-gui-drop-overlay'));
	overlay.setAttribute('data-testid', 'knox-gui-drop-overlay');
	if (parent !== widget.root) {
		overlay.classList.add('knox-gui-drop-overlay-scoped');
	}
	DOM.append(overlay, DOM.$('.knox-gui-drop-overlay-fill'));
	DOM.append(overlay, DOM.$('.knox-gui-drop-overlay-text', undefined, t(widget.controller.store.state, 'dragAndDropImages')));
	widget.dropOverlayEl = overlay;
}

export function hideDropOverlay(widget: KnoxGuiWidget): void {
	widget.dropOverlayEl?.remove();
	widget.dropOverlayEl = undefined;
}

/**
 * Images follow `TipTapEditor.tsx` onDrop (model check, image-only toast,
 * `handleMultipleImageFiles`). Dropped paths and explorer URIs become mentions
 * or files to edit, which the webview could not receive.
 */
export function onDrop(widget: KnoxGuiWidget, event: DragEvent): void {
	event.preventDefault();
	event.stopPropagation();
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
		widget.dragLeaveTimer = undefined;
	}
	widget.dragOver = false;
	widget.hideDropOverlay();
	const state = widget.controller.store.state;
	const files = Array.from(event.dataTransfer?.files ?? []);
	const images = files.filter(file => isDroppedImageFile(file));
	const otherFiles = files.filter(file => !isDroppedImageFile(file));
	const uris = parseUriList(event.dataTransfer?.getData('text/uri-list') ?? '');
	if (images.length) {
		if (!state.imagesSupported) {
			widget.controller.messenger.post('showToast', ['warning', t(state, 'modelNoImageSupport')]);
		} else {
			void processImageFiles(widget, images).then(urls => widget.addImages(urls.map(imageUrl => ({ name: '', imageUrl }))));
		}
	} else if (!otherFiles.length && !uris.length && files.length) {
		widget.controller.messenger.post('showToast', ['warning', t(state, 'pleaseDropImageFiles')]);
	}
	const paths = [
		...otherFiles.map(file => (file as File & { path?: string }).path || file.name),
		...uris,
	].filter(Boolean);
	for (const path of paths) {
		if (state.mode === 'edit') {
			void widget.controller.addFilesToEdit([path]);
		} else {
			widget.controller.mentionDroppedFile(path);
		}
	}
}

export function renderComposer(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const composer = DOM.append(widget.root, DOM.$('.knox-gui-composer'));
	composer.setAttribute('data-testid', 'full-composer');
	widget.renderChatPermissionBar(composer, state);
	const lump = DOM.append(composer, DOM.$('.knox-gui-lump-shell'));
	widget.renderToolbar(lump, state);
	renderLumpOverlay(widget, lump, state);
	if (knoxGuiShowsAgentMeter(state.mode)) {
		widget.renderAgentMeter(composer, state);
	}
	widget.renderPanels(composer, state);
	const editorPad = DOM.append(composer, DOM.$('.knox-gui-composer-editor-pad'));
	const frame = DOM.append(editorPad, DOM.$('.knox-sent-frame'));
	frame.setAttribute('data-testid', 'knox-gui-main-sent-frame');
	frame.setAttribute('data-live', 'false');
	const inner = DOM.append(frame, DOM.$('.knox-sent-frame-inner'));
	widget.renderInput(inner, state);
	widget.renderContextPeek(composer, state);
	widget.renderAcceptRejectAll(composer, state);
}

/**
 * `Lump/index.tsx`: the section fades in when one opens and fades out for 300ms after
 * it closes; switching sections does not fade. Re-renders during a fade resume it.
 */
function renderLumpOverlay(widget: KnoxGuiWidget, lump: HTMLElement, state: IKnoxGuiState): void {
	const now = Date.now();
	const fade = widget.lumpFade;
	if (knoxGuiShowsLumpOverlay(state)) {
		clearTimeout(fade.timer);
		fade.timer = undefined;
		if (!fade.shown) {
			fade.phase = 'enter';
			fade.at = now;
		} else if (fade.phase === 'leave') {
			fade.phase = 'idle';
		}
		fade.shown = state.overlay;
		appendLumpOverlay(widget, lump, state, state.overlay!, fade.phase === 'enter' ? now - fade.at : undefined, false);
		return;
	}
	if (!fade.shown) {
		return;
	}
	if (state.overlay !== null) {
		fade.shown = null;
		fade.phase = 'idle';
		return;
	}
	if (fade.phase !== 'leave') {
		fade.phase = 'leave';
		fade.at = now;
		fade.timer = setTimeout(() => {
			fade.timer = undefined;
			fade.shown = null;
			fade.phase = 'idle';
			widget.render();
		}, KNOX_LUMP_FADE_MS);
	}
	appendLumpOverlay(widget, lump, state, fade.shown as Exclude<KnoxGuiOverlay, null>, now - fade.at, true);
}

function appendLumpOverlay(widget: KnoxGuiWidget, lump: HTMLElement, state: IKnoxGuiState, section: Exclude<KnoxGuiOverlay, null>, elapsed: number | undefined, leaving: boolean): void {
	const overlay = DOM.append(lump, DOM.$('.knox-gui-overlay'));
	overlay.setAttribute('data-testid', leaving ? 'knox-gui-overlay-leaving' : `knox-gui-overlay-${section}`);
	overlay.setAttribute('data-composer-slot', leaving ? 'overlay-leaving' : 'overlay');
	overlay.inert = leaving;
	if (elapsed !== undefined && elapsed < KNOX_LUMP_FADE_MS) {
		overlay.classList.add(leaving ? 'knox-gui-overlay-leave' : 'knox-gui-overlay-enter');
		overlay.style.animationDelay = `-${elapsed}ms`;
	}
	widget.renderOverlay(overlay, state, section);
}

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

export function renderAcceptRejectAll(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options?: { singleRange?: boolean }): void { // KN-377
	const pending = pendingApplyStates(state.applyStates);
	if (!pending.length) {
		return;
	}
	const singleRange = options?.singleRange ?? isSingleRangeEdit(state);
	if (options === undefined && knoxGuiShowsBatchDiffEntry(pending.length > 0, singleRange)) {
		const bar = DOM.append(parent, DOM.$('.knox-gui-accept-reject-all'));
		bar.setAttribute('data-composer-slot', 'acceptRejectAll');
		bar.setAttribute('data-testid', 'knox-gui-batch-diff-open');
		widget.chromeButton(bar, {
			svg: 'package',
			svgSize: 16,
			label: t(state, 'batchDiff'),
			testId: 'knox-gui-batch-diff-open-button',
			onClick: () => widget.controller.store.navigate('/batch-diff'),
		});
		return;
	}
	if (options === undefined && !knoxGuiShowsComposerAcceptReject(pending.length > 0, singleRange)) {
		return;
	}
	const keys = knoxGuiAcceptRejectLabelKeys(singleRange);
	const widths = knoxGuiAcceptRejectWidthKeys();
	const rejectLabel = singleRange
		? `${t(state, keys.reject)} (${knoxGuiAcceptRejectShortcut(isMacintosh, 'reject')})`
		: undefined;
	const acceptLabel = singleRange
		? `${t(state, keys.accept)} (${knoxGuiAcceptRejectShortcut(isMacintosh, 'accept')})`
		: undefined;
	const bar = DOM.append(parent, DOM.$('.knox-gui-accept-reject-all'));
	bar.setAttribute('data-composer-slot', 'acceptRejectAll');
	bar.setAttribute('data-testid', 'knox-gui-accept-reject-all');
	if (state.isStreaming) {
		bar.classList.add('knox-gui-accept-reject-streaming');
	}
	const reject = widget.chromeButton(bar, {
		svg: 'x',
		svgSize: 16,
		label: rejectLabel,
		testId: 'edit-reject-button',
		extraClass: 'knox-gui-reject',
		disabled: state.isStreaming,
		onClick: () => widget.controller.rejectAllApplies(),
	});
	const accept = widget.chromeButton(bar, {
		svg: 'check',
		svgSize: 16,
		label: acceptLabel,
		testId: 'edit-accept-button',
		extraClass: 'knox-gui-accept',
		disabled: state.isStreaming,
		onClick: () => widget.controller.acceptAllApplies(),
	});
	if (!singleRange) {
		DOM.append(reject, DOM.$('span.knox-gui-ar-short', undefined, t(state, widths.short.reject)));
		DOM.append(reject, DOM.$('span.knox-gui-ar-mid', undefined, t(state, widths.mid.reject)));
		DOM.append(reject, DOM.$('span.knox-gui-ar-long', undefined, t(state, widths.long.reject)));
		DOM.append(accept, DOM.$('span.knox-gui-ar-short', undefined, t(state, widths.short.accept)));
		DOM.append(accept, DOM.$('span.knox-gui-ar-mid', undefined, t(state, widths.mid.accept)));
		DOM.append(accept, DOM.$('span.knox-gui-ar-long', undefined, t(state, widths.long.accept)));
	}
}

export function renderChatPermissionBar(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const call = findCurrentToolCall(state.history);
	if (!knoxGuiShowsChatToolButtons(call)) {
		return;
	}
	if (call.status === 'generated' && !knoxGuiShowsChatPermissionBar(call, { toolSettings: state.toolSettings, sessionAllowlist: state.sessionToolAllowlist })) {
		return;
	}
	const bar = DOM.append(parent, DOM.$('.knox-gui-chat-tool-buttons'));
	bar.setAttribute('data-composer-slot', 'pendingToolBar');
	bar.setAttribute('data-testid', 'knox-gui-chat-tool-buttons');
	widget.renderToolActions(bar, state, call, toolDisplayKind(call.name), { placement: 'chat' });
}

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

/** Cyan highlight on the `@query` being typed (`typed-mention-input`), via the CSS Custom Highlight API. */
export function paintTypedMention(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
	const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
	if (!highlights || !HighlightCtor) {
		return;
	}
	highlights.delete(TYPED_MENTION_HIGHLIGHT);
	const editor = widget.editorEl;
	if (!editor || !state.mentionOpen || state.suggestCodeToEdit) {
		return;
	}
	const selection = editor.ownerDocument.getSelection();
	if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
		return;
	}
	const end = selection.getRangeAt(0);
	if (end.endContainer.nodeType !== Node.TEXT_NODE) {
		return;
	}
	const text = (end.endContainer.textContent ?? '').slice(0, end.endOffset);
	const at = text.lastIndexOf('@');
	if (at < 0 || /\s/.test(text.slice(at + 1))) {
		return;
	}
	const range = editor.ownerDocument.createRange();
	range.setStart(end.endContainer, at);
	range.setEnd(end.endContainer, end.endOffset);
	highlights.set(TYPED_MENTION_HIGHLIGHT, new HighlightCtor(range));
}

const TYPED_MENTION_HIGHLIGHT = 'knox-gui-typed-mention';

export function renderSuggest(widget: KnoxGuiWidget, wrap: HTMLElement, state: IKnoxGuiState): void {
	widget.suggestEl?.remove();
	widget.suggestEl = undefined;
	if (!(state.mentionOpen || state.slashOpen)) {
		return;
	}
	const list = DOM.append(widget.root, DOM.$('.knox-gui-suggest'));
	list.setAttribute('data-testid', 'knox-gui-suggest');
	list.setAttribute('data-suggestion-kind', state.slashOpen ? 'slash' : state.suggestCodeToEdit ? 'codeToEdit' : 'mention');
	widget.suggestEl = list;
	widget.renderStore.add(DOM.addDisposableListener(list, 'mousedown', e => {
		if (!(e.target instanceof HTMLTextAreaElement)) {
			e.preventDefault();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(list, 'keydown', (e: KeyboardEvent) => widget.onEditorKeyDown(e, widget.controller.store.state)));
	fillSuggest(widget, list, state);
	positionSuggest(widget, list, wrap);
}

/** Pin the picker to the caret with `position: fixed`, correcting for any transformed ancestor. */
function positionSuggest(widget: KnoxGuiWidget, list: HTMLElement, wrap: HTMLElement): void {
	const view = DOM.getWindow(list);
	const caret = widget.caretClientRect() ?? wrap.getBoundingClientRect();
	list.style.left = '0px';
	list.style.top = '0px';
	list.style.maxHeight = '';
	const place = mentionFloatingPosition({
		anchor: { left: caret.left, top: caret.top, bottom: caret.bottom },
		viewport: { width: view.innerWidth, height: view.innerHeight },
		contentHeight: list.scrollHeight,
	});
	list.style.width = `${place.width}px`;
	list.style.maxHeight = `${place.maxHeight}px`;
	const height = Math.min(list.scrollHeight, place.maxHeight);
	const top = place.placement === 'top' ? caret.top - MENTION_FLOATING_OFFSET - height : place.top;
	const origin = list.getBoundingClientRect();
	list.style.left = `${place.left - origin.left}px`;
	list.style.top = `${top - origin.top}px`;
	list.dataset.placement = place.placement;
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

function renderQueryProviderBox(widget: KnoxGuiWidget, list: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiSuggestItem): void {
	const box = DOM.append(list, DOM.$('textarea.knox-gui-suggest-query')) as HTMLTextAreaElement;
	box.rows = 1;
	box.placeholder = item.description ?? '';
	box.setAttribute('data-testid', 'mention-query-input');
	if (widget.queryProviderFor !== item.id) {
		widget.queryProviderFor = item.id;
		widget.queryProviderValue = '';
	}
	box.value = widget.queryProviderValue;
	widget.renderStore.add(DOM.addDisposableListener(box, 'input', () => {
		widget.queryProviderValue = box.value;
	}));
	widget.renderStore.add(DOM.addDisposableListener(box, 'keydown', (e: KeyboardEvent) => {
		e.stopPropagation();
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			widget.controller.submitQueryProvider(box.value);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			widget.controller.cancelQueryProvider();
		}
	}));
	queueMicrotask(() => {
		box.focus();
		box.setSelectionRange(box.value.length, box.value.length);
	});
}

function fillSuggest(widget: KnoxGuiWidget, list: HTMLElement, state: IKnoxGuiState): void {
	if (state.suggestSubmenu || state.suggestSubmenuTitle) {
		const header = DOM.append(list, DOM.$('.knox-gui-suggest-header'));
		header.setAttribute('data-testid', 'mention-dropdown-header');
		const back = DOM.append(header, DOM.$('button.knox-gui-suggest-back')) as HTMLButtonElement;
		back.type = 'button';
		back.setAttribute('data-testid', 'mention-dropdown-back');
		back.setAttribute('aria-label', t(state, 'mentionBack'));
		appendKnoxGuiSvg(back, 'arrow-left', 14);
		back.append(` ${t(state, 'mentionBack')}`);
		widget.renderStore.add(DOM.addDisposableListener(back, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.exitSuggestSubmenu();
		}));
		if (state.suggestSubmenuTitle) {
			DOM.append(header, DOM.$('span.knox-gui-suggest-header-title', undefined, state.suggestSubmenuTitle));
		}
	}
	if (state.suggestQueryItem) {
		renderQueryProviderBox(widget, list, state, state.suggestQueryItem);
		return;
	}

	const sections = state.slashOpen
		? groupSlashItems(state.suggestItems, { query: state.suggestQuery })
		: groupMentionItems(state.suggestItems, { query: state.suggestQuery, inSubmenu: state.suggestSubmenu });
	const showHeaders = state.slashOpen
		? shouldShowSlashSectionHeaders(sections)
		: shouldShowMentionSectionHeaders(sections, state.suggestSubmenu);
	const flat = sections.flatMap(section => section.items);
	const showLoading = state.suggestLoading && !flat.length;
	if (showLoading) {
		const loading = DOM.append(list, DOM.$('.knox-gui-suggest-loading'));
		loading.setAttribute('data-testid', 'mention-dropdown-loading');
		loading.setAttribute('aria-busy', 'true');
		DOM.append(loading, DOM.$('span.knox-gui-suggest-spinner'));
		loading.append(t(state, 'loading'));
		return;
	}
	if (!flat.length) {
		const empty = DOM.append(list, DOM.$('.knox-gui-suggest-empty'));
		empty.setAttribute('data-testid', 'mention-dropdown-empty');
		empty.textContent = t(state, state.slashOpen ? 'slashEmpty' : 'mentionEmpty');
		DOM.append(list, DOM.$('.knox-gui-suggest-empty-hint.knox-gui-muted', undefined, t(state, state.slashOpen ? 'slashEmptyHint' : 'mentionEmptyHint')));
		return;
	}
	const box = DOM.append(list, DOM.$('.knox-gui-suggest-list'));
	box.setAttribute('role', 'listbox');
	box.setAttribute('aria-label', t(state, state.slashOpen ? 'slashListbox' : 'mentionListbox'));
	box.setAttribute('data-testid', 'mention-dropdown-listbox');
	let offset = 0;
	for (const section of sections) {
		const group = DOM.append(box, DOM.$('.knox-gui-suggest-group'));
		group.setAttribute('role', 'group');
		group.setAttribute('data-testid', `mention-section-${section.id}`);
		const showHeader = showHeaders && section.id !== 'other';
		if (showHeader) {
			DOM.append(group, DOM.$('.knox-gui-suggest-section', undefined, t(state, section.labelKey)));
		}
		for (const item of section.items) {
			const index = offset++;
			widget.renderSuggestItem(group, state, item, index, index === state.suggestSelected);
		}
	}
	const truncation = mentionIndexIsTruncated(state.suggestItems);
	if (truncation.truncated) {
		const note = DOM.append(list, DOM.$('.knox-gui-suggest-truncated'));
		note.setAttribute('data-testid', 'mention-dropdown-truncated');
		note.textContent = t(state, 'mentionTruncated', { count: truncation.count });
	}
}

export function renderSuggestItem(widget: KnoxGuiWidget, list: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiSuggestItem, index: number, selected: boolean): void {
	const button = DOM.append(list, DOM.$('button.knox-gui-suggest-item')) as HTMLButtonElement;
	button.type = 'button';
	button.id = mentionOptionId(index);
	button.setAttribute('role', 'option');
	button.tabIndex = -1;
	button.setAttribute('aria-selected', selected ? 'true' : 'false');
	button.setAttribute('data-testid', item.id === 'config/newPromptFile' ? 'mention-new-prompt-file' : 'context-provider-dropdown-item');
	button.setAttribute('data-mention-id', item.id);
	button.title = item.description || item.id || item.label;
	if (selected) {
		button.classList.add('selected');
	}
	if (item.itemType === 'slashCommand') {
		button.classList.add('is-slash');
	}
	const iconWrap = DOM.append(button, DOM.$('span.knox-gui-suggest-icon'));
	if (isFolderMentionItem(item)) {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-folder');
		widget.appendFileIcon(iconWrap, item.query || item.id || item.label, 16, true);
	} else if (isPathMentionItem(item)) {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-file');
		widget.appendFileIcon(iconWrap, item.query || item.id || item.label, 16);
	} else if (item.itemType === 'action') {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-action');
		appendKnoxGuiSvg(iconWrap, 'plus', 16);
	} else {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-provider');
		const named = knoxGuiNamedIcon(item.icon) ?? knoxGuiNamedIcon(item.id) ?? knoxGuiNamedIcon(item.providerTitle);
		appendKnoxGuiSvg(iconWrap, named ?? (item.itemType === 'slashCommand' ? 'scroll-text' : 'add-context'), 16);
	}
	const label = DOM.append(button, DOM.$('span.knox-gui-suggest-label'));
	label.setAttribute('data-testid', 'mention-row-title');
	for (const part of highlightMentionMatch(item.label, state.suggestQuery)) {
		if (part.matched) {
			const mark = DOM.append(label, DOM.$('mark.knox-gui-suggest-match'));
			mark.textContent = part.text;
		} else {
			label.append(part.text);
		}
	}
	const showPath = isPathMentionItem(item) && !!item.description && item.description.toLowerCase() !== item.label.toLowerCase();
	const showDescription = !isPathMentionItem(item) && !!item.description;
	const secondary = showPath || showDescription ? item.description : undefined;
	if (secondary) {
		const extra = DOM.append(button, DOM.$(`span.${item.itemType === 'slashCommand' ? 'knox-gui-suggest-desc' : 'knox-gui-suggest-path'}`));
		extra.setAttribute('data-testid', item.itemType === 'slashCommand' ? 'mention-row-description' : 'mention-row-path');
		extra.title = secondary;
		for (const part of highlightMentionMatch(secondary, state.suggestQuery)) {
			if (part.matched) {
				const mark = DOM.append(extra, DOM.$('mark.knox-gui-suggest-match'));
				mark.textContent = part.text;
			} else {
				extra.append(part.text);
			}
		}
	}
	if (item.itemType === 'slashCommand') {
		const name = slashCommandBareName(item.id || item.label);
		const bookmarked = Boolean(item.bookmarked) || isSlashBookmarked(state.bookmarkedSlash, name);
		const star = DOM.append(button, DOM.$('button.knox-gui-suggest-star')) as HTMLButtonElement;
		star.type = 'button';
		star.setAttribute('data-testid', 'slash-row-bookmark');
		star.setAttribute('aria-pressed', bookmarked ? 'true' : 'false');
		star.setAttribute('aria-label', t(state, bookmarked ? 'slashUnbookmark' : 'slashBookmark'));
		if (bookmarked) {
			star.classList.add('is-bookmarked');
		}
		appendKnoxGuiSvg(star, 'bookmark', 12);
		widget.hover(star, t(state, bookmarked ? 'slashUnbookmark' : 'slashBookmark'));
		widget.renderStore.add(DOM.addDisposableListener(star, 'click', e => {
			e.stopPropagation();
			e.preventDefault();
			widget.controller.toggleBookmark(name);
		}));
	}
	if (item.itemType === 'contextProvider' && item.providerType === 'submenu') {
		const chevron = DOM.append(button, DOM.$('span.knox-gui-suggest-chevron'));
		chevron.setAttribute('data-testid', 'mention-row-submenu-chevron');
		appendKnoxGuiSvg(chevron, 'chevron-right', 12);
	}
	if (isOpenableMentionRow(item)) {
		const open = DOM.append(button, DOM.$('button.knox-gui-suggest-open')) as HTMLButtonElement;
		open.type = 'button';
		open.setAttribute('data-testid', 'mention-row-open');
		open.setAttribute('aria-label', t(state, 'mentionOpenFile'));
		widget.hover(open, t(state, 'mentionOpenFile'));
		appendKnoxGuiSvg(open, 'square-pen', 14);
		widget.renderStore.add(DOM.addDisposableListener(open, 'click', e => {
			e.stopPropagation();
			widget.controller.showFile(item.query || item.id);
		}));
	}
	widget.renderStore.add(DOM.addDisposableListener(button, 'mouseenter', () => {
		if (widget.controller.store.state.suggestSelected !== index) {
			widget.controller.store.patch({ suggestSelected: index });
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', () => widget.controller.applySuggest(item)));
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
	widget.renderStore.add(DOM.addDisposableListener(editor, 'blur', () => widget.controller.store.patch({ inputFocused: false })));
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
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
			recheckTrigger();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'mouseup', recheckTrigger));
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

	widget.renderScrollButtons(right, state);

	if (state.mode === 'edit') {
		widget.chromeButton(right, {
			label: `Esc ${t(state, 'exitEdit')}`,
			title: t(state, 'exitEdit'),
			testId: 'knox-gui-exit-edit',
			extraClass: 'knox-gui-exit-edit knox-gui-sm-hide',
			onClick: () => void widget.controller.exitEditMode(),
		});
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

export function renderModelSelect(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
	const models = state.modelsByRole.chat.length ? state.modelsByRole.chat : state.models;
	const current = models.find(model => model.title === state.modelTitle) ?? models[0];
	const wrap = DOM.append(parent, DOM.$('.knox-gui-model-wrap'));
	const open = widget.openMenu === 'model' && widget.openMenuSource === source;
	const trigger = widget.chromeButton(wrap, {
		label: knoxGuiModelSelectTitle(current) || t(state, 'selectModel'),
		svg: 'chevrons-down',
		svgSize: 16,
		svgAfter: true,
		title: t(state, 'models'),
		testId: source === 'main' ? 'knox-gui-model-select' : `knox-gui-model-select-${source}`,
		extraClass: 'knox-gui-model-trigger',
		menuTrigger: true,
		onClick: () => widget.toggleMenu('model', source),
	});
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', String(open));
	trigger.setAttribute('aria-controls', 'knox-gui-model-menu');
	if (!open) {
		return;
	}
	const menu = DOM.append(widget.root, DOM.$('.knox-gui-popover.knox-gui-model-menu'));
	menu.id = 'knox-gui-model-menu';
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('data-testid', 'knox-gui-model-menu');
	const rows: HTMLButtonElement[] = [];
	for (const model of knoxGuiSortModelsByApiKey(models)) {
		const row = DOM.append(menu, DOM.$('button.knox-gui-popover-item.knox-gui-model-option')) as HTMLButtonElement;
		row.type = 'button';
		row.setAttribute('role', 'option');
		const missingKey = model.apiKey === '';
		row.setAttribute('aria-selected', String(model.title === current?.title));
		row.setAttribute('aria-disabled', String(missingKey));
		if (missingKey) {
			row.classList.add('disabled');
		} else {
			rows.push(row);
		}
		appendKnoxGuiSvg(row, 'cpu', 14);
		const title = DOM.append(row, DOM.$('span.knox-gui-model-option-title', undefined, knoxGuiModelSelectTitle(model)));
		if (missingKey) {
			DOM.append(title, DOM.$('span.knox-gui-muted', undefined, ` (${t(state, 'missingApiKey')})`));
		}
		if (model.title === current?.title) {
			appendKnoxGuiSvg(row, 'check', 14);
		}
		const hoverActs = DOM.append(row, DOM.$('span.knox-gui-model-option-actions'));
		const trash = DOM.append(hoverActs, DOM.$('span.knox-gui-model-action.knox-gui-model-delete'));
		trash.setAttribute('role', 'button');
		trash.setAttribute('title', t(state, 'deleteModel'));
		appendKnoxGuiSvg(trash, 'trash', 12);
		widget.renderStore.add(DOM.addDisposableListener(trash, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.deleteModel(model.title);
			widget.closeMenus();
		}));
		const gear = DOM.append(hoverActs, DOM.$('span.knox-gui-model-action.knox-gui-model-config'));
		gear.setAttribute('role', 'button');
		gear.setAttribute('title', t(state, 'configureModel'));
		appendKnoxGuiSvg(gear, 'settings', 12);
		widget.renderStore.add(DOM.addDisposableListener(gear, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.messenger.post('config/openProfile', { profileId: state.profileId });
			widget.closeMenus();
		}));
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			if (missingKey) {
				e.preventDefault();
				return;
			}
			widget.closeMenus();
			if (model.title !== current?.title) {
				widget.controller.selectModel('chat', model.title);
			}
		}));
	}
	if (state.profileType === 'local') {
		const add = DOM.append(menu, DOM.$('button.knox-gui-popover-item.knox-gui-model-add')) as HTMLButtonElement;
		add.type = 'button';
		add.setAttribute('role', 'option');
		rows.push(add);
		appendKnoxGuiSvg(add, 'plus', 12);
		add.append(t(state, 'addModel'));
		widget.renderStore.add(DOM.addDisposableListener(add, 'click', e => {
			e.stopPropagation();
			widget.closeMenus();
			widget.controller.openAddModel('chat', { bulk: true });
		}));
	}
	widget.renderStore.add(DOM.addDisposableListener(trigger, 'keydown', e => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? rows[0];
			selected?.focus();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(menu, 'keydown', e => {
		const index = rows.indexOf(e.target as HTMLButtonElement);
		const next = knoxGuiListboxNextIndex(e.key, index, rows.length);
		if (next !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			rows[next].focus();
		}
	}));
	widget.anchorPopover(menu, trigger, { minWidth: 160 });
	queueMicrotask(() => {
		const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? rows[0];
		selected?.focus();
	});
}

export function renderReasoningSelect(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
	if (!state.reasoningEfforts.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-effort-wrap'));
	const currentKey = reasoningEffortLabelKey(state.reasoningEffort ?? '');
	const open = widget.openMenu === 'effort' && widget.openMenuSource === source;
	const trigger = widget.chromeButton(wrap, {
		svg: 'brain',
		svgSize: 12,
		label: currentKey ? t(state, currentKey) : (state.reasoningEffort ?? t(state, 'reasoningEffortSelect')),
		svgAfter: false,
		title: t(state, 'reasoningEffortTooltip'),
		testId: source === 'main' ? 'knox-gui-reasoning-select' : `knox-gui-reasoning-select-${source}`,
		extraClass: 'knox-gui-effort-trigger',
		menuTrigger: true,
		disabled: state.isStreaming,
		onClick: () => widget.toggleMenu('effort', source),
	});
	appendKnoxGuiSvg(trigger, 'chevron-down', 12).classList.add('knox-gui-effort-chevron');
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', String(open));
	trigger.setAttribute('aria-controls', 'knox-gui-effort-menu');
	if (!open) {
		return;
	}
	const menu = DOM.append(widget.root, DOM.$('.knox-gui-popover.knox-gui-effort-menu'));
	menu.id = 'knox-gui-effort-menu';
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('data-testid', 'knox-gui-effort-menu');
	const rows: HTMLButtonElement[] = [];
	for (const effort of state.reasoningEfforts) {
		const row = DOM.append(menu, DOM.$('button.knox-gui-popover-item.knox-gui-effort-option')) as HTMLButtonElement;
		row.type = 'button';
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(effort === state.reasoningEffort));
		rows.push(row);
		const labelKey = reasoningEffortLabelKey(effort);
		DOM.append(row, DOM.$('span', undefined, labelKey ? t(state, labelKey) : effort));
		if (effort === state.reasoningEffort) {
			appendKnoxGuiSvg(row, 'check', 12).classList.add('knox-gui-effort-check');
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			widget.closeMenus();
			widget.controller.setReasoningEffort(effort);
		}));
	}
	widget.renderStore.add(DOM.addDisposableListener(menu, 'keydown', e => {
		const index = rows.indexOf(e.target as HTMLButtonElement);
		const next = knoxGuiListboxNextIndex(e.key, index, rows.length);
		if (next !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			rows[next].focus();
		}
	}));
	widget.anchorPopover(menu, trigger, { minWidth: 104 });
	queueMicrotask(() => {
		const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? rows[0];
		selected?.focus();
	});
}

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
	editor.ownerDocument.execCommand('insertText', false, text);
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

/** `editorConfig.ts` Image paste plugin: every pasted file goes through `handleImageFile` on image models. */
export function onEditorPaste(widget: KnoxGuiWidget, event: ClipboardEvent, state: IKnoxGuiState): void {
	const items = event.clipboardData?.items;
	if (!items) {
		return;
	}
	const files = Array.from(items).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
	if (files.length) {
		event.preventDefault();
		if (state.imagesSupported) {
			for (const file of files) {
				widget.readImageFile(file);
			}
		}
		return;
	}
	const text = event.clipboardData?.getData('text/plain');
	if (text !== undefined) {
		event.preventDefault();
		insertPlainText(event.currentTarget as HTMLElement, text);
	}
}

export function readImageFile(widget: KnoxGuiWidget, file: File): void {
	void processImageFile(widget, file).then(imageUrl => {
		if (imageUrl) {
			widget.addImages([{ name: file.name, imageUrl }]);
		}
	});
}

export function addImages(widget: KnoxGuiWidget, images: ReadonlyArray<{ name: string; imageUrl: string }>): void {
	if (images.length) {
		widget.controller.store.patch({ images: [...widget.controller.store.state.images, ...images] });
	}
}

const KNOX_IMAGE_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.svg,.webp';

/** Hidden file input overlay so Electron/VS Code actually opens the picker (display:none `.click()` often no-ops). */
export function renderImageAttach(
	widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	testId: string,
	onImages: (urls: string[], files: File[]) => void,
): void {
	const wrap = DOM.append(parent, DOM.$('span.knox-gui-attach-wrap.knox-gui-xs-hide'));
	const file = DOM.append(wrap, DOM.$('input.knox-gui-file')) as HTMLInputElement;
	file.type = 'file';
	file.accept = KNOX_IMAGE_FILE_ACCEPT;
	file.multiple = true;
	file.tabIndex = -1;
	file.setAttribute('aria-hidden', 'true');
	widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
		const files = Array.from(file.files ?? []);
		file.value = '';
		void attachPickedFiles(widget, files, onImages);
	}));
	widget.chromeButton(wrap, {
		svg: 'attach-image',
		svgSize: 14,
		title: t(state, 'attachImage'),
		testId,
		extraClass: 'knox-gui-xs-hide',
		onClick: () => file.click(),
	});
}

async function attachPickedFiles(widget: KnoxGuiWidget, files: readonly File[], onImages: (urls: string[], files: File[]) => void): Promise<void> {
	if (!files.length) {
		return;
	}
	const images = files.filter(file => knoxGuiImageFileAccepted(file));
	const others = files.filter(file => !knoxGuiImageFileAccepted(file));
	if (images.length) {
		const urls = await processImageFiles(widget, images);
		onImages(urls, images);
	}
	const state = widget.controller.store.state;
	for (const extra of others) {
		const path = (extra as File & { path?: string }).path || extra.name;
		if (!path) {
			continue;
		}
		if (state.mode === 'edit') {
			void widget.controller.addFilesToEdit([path]);
		} else {
			widget.controller.mentionDroppedFile(path);
		}
	}
}

export function paintInputDoc(widget: KnoxGuiWidget, editor: HTMLElement, doc: IKnoxGuiInputBlock[], onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
	editor.replaceChildren();
	const blocks = doc.length ? doc : emptyInputDoc();
	const newest = knoxGuiNewestCodeBlockIndex(blocks);
	for (const block of blocks) {
		if (block.type === 'codeBlock') {
			paintCodeBlockChip(widget, editor, block, blocks.indexOf(block) === newest, onChange);
			continue;
		}
		const p = DOM.append(editor, DOM.$('p'));
		if (!block.content.length) {
			continue;
		}
		for (const node of block.content) {
			widget.appendInline(p, node);
		}
	}
}

const codeBlockNodes = new WeakMap<HTMLElement, IKnoxGuiInputCodeBlock>();

function codeBlockKey(block: IKnoxGuiInputCodeBlock): string {
	return `${block.itemName ?? block.filepath ?? ''}:${block.range?.start ?? ''}-${block.range?.end ?? ''}`;
}

/**
 * `CodeSnippetPreview.tsx`: a header with chevron, file icon and name (opens the
 * range, file or a virtual file) and a delete button; the body is highlighted and
 * capped at 100px. Only the newest block starts expanded; a toggle sticks per block.
 */
function paintCodeBlockChip(widget: KnoxGuiWidget, editor: HTMLElement, block: IKnoxGuiInputCodeBlock, newest: boolean, onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
	const state = widget.controller.store.state;
	const chip = DOM.append(editor, DOM.$('div.knox-gui-input-code-chip'));
	chip.contentEditable = 'false';
	chip.spellcheck = false;
	chip.setAttribute('data-testid', 'knox-gui-input-code-block');
	codeBlockNodes.set(chip, block);
	const key = codeBlockKey(block);
	const expanded = () => widget.codeBlockExpanded.get(key) ?? newest;
	const head = DOM.append(chip, DOM.$('.knox-gui-input-code-head'));
	head.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	const titleWrap = DOM.append(head, DOM.$('.knox-gui-input-code-title-wrap'));
	const chevron = DOM.append(titleWrap, DOM.$('span.knox-gui-input-code-chevron'));
	const title = DOM.append(titleWrap, DOM.$('span.knox-gui-input-code-title'));
	title.setAttribute('data-testid', 'knox-gui-input-code-open');
	const name = knoxGuiCodeBlockTitle(block);
	widget.appendFileIcon(title, block.filepath ?? name, 16);
	DOM.append(title, DOM.$('span', undefined, name));
	const body = DOM.append(chip, DOM.$('.knox-gui-input-code-body'));
	const pre = DOM.append(body, DOM.$('pre.knox-gui-input-code'));
	const language = block.language || displayLanguageForFile(block.filepath ?? name);
	widget.paintHighlightedCode(pre, language === 'markdown' ? 'text' : language, block.code, block.filepath);
	const sync = () => {
		const open = expanded();
		chevron.replaceChildren();
		appendKnoxGuiSvg(chevron, open ? 'chevron-down' : 'chevron-right', 12);
		body.hidden = !open;
		head.classList.toggle('expanded', open);
	};
	sync();
	widget.renderStore.add(DOM.addDisposableListener(head, 'mousedown', e => e.preventDefault()));
	widget.renderStore.add(DOM.addDisposableListener(head, 'click', () => {
		widget.codeBlockExpanded.set(key, !expanded());
		sync();
	}));
	widget.renderStore.add(DOM.addDisposableListener(title, 'click', e => {
		e.stopPropagation();
		const action = knoxGuiCodeBlockOpenAction(block);
		if (action.type === 'showLines') {
			widget.controller.messenger.post('showLines', { filepath: action.filepath, startLine: action.startLine, endLine: action.endLine });
		} else if (action.type === 'showFile') {
			widget.controller.messenger.post('showFile', { filepath: action.filepath });
		} else {
			widget.controller.messenger.post('showVirtualFile', { name: action.name, content: action.content });
		}
	}));
	widget.chromeButton(head, {
		svg: 'x',
		svgSize: 12,
		title: t(state, 'delete'),
		extraClass: 'knox-gui-input-code-remove',
		onClick: (_button, event) => {
			event?.stopPropagation();
			const index = Array.from(editor.querySelectorAll('.knox-gui-input-code-chip')).indexOf(chip);
			const next = removeCodeBlockAt(widget.readInputDoc(editor), index);
			if (onChange) {
				onChange(next);
				widget.paintInputDoc(editor, next, onChange);
			} else {
				widget.controller.store.setInputDoc(next);
			}
		},
	});
}

export function appendInline(widget: KnoxGuiWidget, parent: HTMLElement, node: KnoxGuiInlineNode): void {
	if (node.type === 'text') {
		parent.append(node.text);
		return;
	}
	const chip = DOM.append(parent, DOM.$('span.knox-gui-inline-chip'));
	chip.contentEditable = 'false';
	chip.dataset.chip = node.type;
	chip.dataset.id = node.id;
	chip.dataset.label = node.label;
	chip.setAttribute('data-testid', node.type === 'mention' ? 'knox-gui-mention-chip' : 'knox-gui-slash-chip');
	const state = widget.controller.store.state;
	let tooltip: string | undefined;
	if (node.type === 'mention') {
		chip.classList.add('knox-gui-mention-chip');
		if (node.itemType) {
			chip.dataset.itemType = node.itemType;
		}
		if (node.query) {
			chip.dataset.query = node.query;
		}
		if (node.renderInlineAs) {
			chip.dataset.renderInlineAs = node.renderInlineAs;
		}
		if (node.description) {
			chip.dataset.description = node.description;
		}
		if (node.icon) {
			chip.dataset.icon = node.icon;
		}
		if (isPathMentionNode(node)) {
			const icon = DOM.append(chip, DOM.$('span.knox-gui-chip-icon'));
			const folder = isFolderMentionNode(node);
			icon.setAttribute('data-testid', folder ? 'mention-chip-folder-icon' : 'mention-chip-file-icon');
			widget.appendFileIcon(icon, node.query || node.id || node.label, 12, folder);
		}
		DOM.append(chip, DOM.$('span.knox-gui-chip-label', undefined, mentionChipLabel(node)));
		tooltip = mentionChipTooltip(node);
		const uri = mentionChipOpenUri(node);
		if (uri) {
			chip.classList.add('is-openable');
			chip.setAttribute('aria-label', `${t(state, 'mentionOpenFile')}: ${tooltip ?? mentionChipLabel(node)}`);
			widget.listenerStore.add(DOM.addDisposableListener(chip, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				widget.controller.showFile(uri);
			}));
		}
	} else {
		chip.classList.add('knox-gui-slash-chip');
		if (node.description) {
			chip.dataset.description = node.description;
		}
		const label = slashCommandTitle(node.id || node.label);
		const named = knoxGuiNamedIcon(node.id || node.label);
		if (named) {
			const icon = DOM.append(chip, DOM.$('span.knox-gui-chip-icon'));
			icon.setAttribute('data-testid', 'slash-command-chip-icon');
			appendKnoxGuiSvg(icon, named, 12);
		}
		DOM.append(chip, DOM.$('span.knox-gui-chip-label', undefined, label));
		tooltip = node.description?.trim() || label;
	}
	if (tooltip) {
		widget.hover(chip, tooltip);
	}
	const dismiss = DOM.append(chip, DOM.$('button.knox-gui-chip-dismiss', undefined, '×')) as HTMLButtonElement;
	dismiss.type = 'button';
	dismiss.tabIndex = -1;
	const dismissLabel = t(state, node.type === 'mention' ? 'mentionRemove' : 'slashRemove');
	dismiss.setAttribute('aria-label', dismissLabel);
	dismiss.setAttribute('data-testid', node.type === 'mention' ? 'mention-chip-dismiss' : 'slash-command-chip-dismiss');
	dismiss.title = dismissLabel;
	widget.listenerStore.add(DOM.addDisposableListener(dismiss, 'mousedown', e => {
		e.preventDefault();
		e.stopPropagation();
	}));
	widget.listenerStore.add(DOM.addDisposableListener(dismiss, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		const editor = chip.closest<HTMLElement>('[contenteditable="true"]');
		chip.remove();
		editor?.dispatchEvent(new Event('input', { bubbles: true }));
	}));
}

export function readInputDoc(widget: KnoxGuiWidget, editor: HTMLElement): IKnoxGuiInputBlock[] {
	const blocks: IKnoxGuiInputBlock[] = [];
	const children = Array.from(editor.childNodes);
	if (!children.length) {
		return emptyInputDoc();
	}
	for (const child of children) {
		if (child instanceof HTMLElement && child.classList.contains('knox-gui-input-code-chip')) {
			const known = codeBlockNodes.get(child);
			if (known) {
				blocks.push({ ...known });
				continue;
			}
			const pre = child.querySelector('pre');
			blocks.push({
				type: 'codeBlock',
				language: child.dataset.language,
				filepath: child.dataset.filepath,
				itemName: child.dataset.itemName,
				code: pre?.textContent ?? child.textContent ?? '',
			});
			continue;
		}
		if (child instanceof HTMLPreElement) {
			blocks.push({
				type: 'codeBlock',
				language: child.dataset.language,
				filepath: child.dataset.filepath,
				itemName: child.dataset.itemName,
				code: child.textContent ?? '',
			});
			continue;
		}
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent ?? '';
			if (text) {
				blocks.push({ type: 'paragraph', content: [{ type: 'text', text }] });
			}
			continue;
		}
		if (child instanceof HTMLBRElement) {
			blocks.push({ type: 'paragraph', content: [] });
			continue;
		}
		blocks.push({ type: 'paragraph', content: widget.readInlines(child) });
	}
	return blocks.length ? blocks : emptyInputDoc();
}

export function readInlines(widget: KnoxGuiWidget, node: Node): KnoxGuiInlineNode[] {
	const content: KnoxGuiInlineNode[] = [];
	const walk = (current: Node): void => {
		if (current.nodeType === Node.TEXT_NODE) {
			const text = current.textContent ?? '';
			if (text) {
				content.push({ type: 'text', text });
			}
			return;
		}
		if (current instanceof HTMLBRElement) {
			content.push({ type: 'text', text: '\n' });
			return;
		}
		if (current instanceof HTMLElement && current.dataset.chip) {
			if (current.dataset.chip === 'slash') {
				content.push({ type: 'slash', id: current.dataset.id ?? '', label: current.dataset.label ?? current.textContent ?? '' });
				return;
			}
			content.push({
				type: 'mention',
				id: current.dataset.id ?? '',
				label: current.dataset.label ?? current.textContent ?? '',
				itemType: current.dataset.itemType,
				query: current.dataset.query,
				renderInlineAs: current.dataset.renderInlineAs,
				description: current.dataset.description,
			});
			return;
		}
		current.childNodes.forEach(walk);
	};
	walk(node);
	return content;
}

export function syncPlaceholder(widget: KnoxGuiWidget, editor: HTMLElement, state: IKnoxGuiState): void {
	const empty = inputDocIsEmpty(widget.readInputDoc(editor));
	editor.dataset.empty = empty ? 'true' : 'false';
	editor.dataset.placeholder = t(state, composerPlaceholderKey(state.mode, state.history.length));
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

export function renderCodeToEditCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void { // KN-374
	const card = DOM.append(parent, DOM.$('.knox-gui-code-edit'));
	card.setAttribute('data-testid', 'knox-gui-code-to-edit');
	const head = DOM.append(card, DOM.$('.knox-gui-code-edit-head'));
	const title = state.codeToEdit.length === 0
		? t(state, 'editCode')
		: t(state, 'editCodeItems', { count: state.codeToEdit.length });
	DOM.append(head, DOM.$('span', undefined, title));
	const openAddFile = () => {
		widget.addFileHits = [];
		widget.addFileQuery = '';
		widget.addFileSelected = 0;
		widget.addFileMenuOpen = false;
		widget.controller.store.patch({ addFileOpen: true });
		void widget.refreshAddFileHits('');
	};
	const split = DOM.append(head, DOM.$('.knox-gui-add-file-split'));
	widget.chromeButton(split, {
		svg: 'plus',
		svgSize: 12,
		label: t(state, 'addFile'),
		title: t(state, 'addFileToEdit'),
		testId: 'knox-gui-add-file-edit',
		extraClass: 'knox-gui-add-file-main',
		onClick: openAddFile,
	});
	widget.chromeButton(split, {
		svg: 'arrow-down',
		svgSize: 12,
		title: t(state, 'addAllOpenFiles'),
		testId: 'knox-gui-add-file-menu',
		extraClass: 'knox-gui-add-file-caret',
		menuTrigger: true,
		onClick: () => {
			widget.addFileMenuOpen = !widget.addFileMenuOpen;
			widget.controller.store.patch({});
		},
	});
	if (widget.addFileMenuOpen) {
		const menu = DOM.append(split, DOM.$('.knox-gui-popover.knox-gui-add-file-popover'));
		const all = DOM.append(menu, DOM.$('button.knox-gui-popover-item', undefined, t(state, 'addAllOpenFiles'))) as HTMLButtonElement;
		all.type = 'button';
		all.setAttribute('data-testid', 'knox-gui-add-all-open-files');
		widget.renderStore.add(DOM.addDisposableListener(all, 'click', e => {
			e.stopPropagation();
			widget.addFileMenuOpen = false;
			void widget.controller.addAllOpenFilesToEdit();
		}));
	}
	if (state.codeToEdit.length) {
		const list = DOM.append(card, DOM.$('ul.knox-gui-code-edit-list'));
		const dirs = widget.controller.workspaceDirectory ? [widget.controller.workspaceDirectory] : [];
		for (const [index, code] of state.codeToEdit.entries()) {
			const info = knoxGuiCodeToEditTitle(code);
			const expanded = info.kind !== 'insert' && widget.codeEditExpanded.has(index);
			const row = DOM.append(list, DOM.$('li.knox-gui-code-edit-item'));
			row.setAttribute('data-testid', 'knox-gui-code-to-edit-item');
			row.classList.toggle('expanded', expanded);
			const toggle = () => {
				if (widget.codeEditExpanded.has(index)) {
					widget.codeEditExpanded.delete(index);
				} else {
					widget.codeEditExpanded.add(index);
				}
				widget.controller.store.patch({});
			};
			const label = info.kind === 'insert'
				? `${info.name} - ${t(state, 'insertingAtLine', { line: info.start })}`
				: info.kind === 'range'
					? `${info.name} (${info.start} - ${info.end})`
					: info.name;
			const line = DOM.append(row, DOM.$('.knox-gui-code-edit-line'));
			if (info.kind !== 'insert') {
				widget.renderStore.add(DOM.addDisposableListener(line, 'click', toggle));
			}
			const main = DOM.append(line, DOM.$('.knox-gui-code-edit-main'));
			appendKnoxGuiSvg(main, 'file', 18);
			const fileBtn = DOM.append(main, DOM.$('button.knox-gui-code-edit-name', undefined, label)) as HTMLButtonElement;
			fileBtn.type = 'button';
			fileBtn.setAttribute('data-testid', 'knox-gui-code-to-edit-name');
			widget.renderStore.add(DOM.addDisposableListener(fileBtn, 'click', e => {
				e.stopPropagation();
				widget.controller.openCodeToEdit(code);
			}));
			DOM.append(main, DOM.$('span.knox-gui-code-edit-path', undefined, lastRelativePathParts(code.filepath, dirs, 2)));
			const actions = DOM.append(line, DOM.$('.knox-gui-code-edit-actions'));
			if (info.kind !== 'insert') {
				widget.chromeButton(actions, {
					svg: expanded ? 'chevron-down' : 'chevron-right',
					svgSize: 16,
					title: t(state, expanded ? 'hide' : 'show'),
					onClick: (_button, event) => {
						event?.stopPropagation();
						toggle();
					},
				});
			}
			widget.chromeButton(actions, {
				svg: 'x',
				svgSize: 16,
				title: t(state, 'delete'),
				extraClass: 'knox-gui-code-edit-remove',
				onClick: (_button, event) => {
					event?.stopPropagation();
					widget.codeEditExpanded.clear();
					widget.controller.removeCodeToEdit(index);
				},
			});
			if (expanded && code.contents !== undefined) {
				const snippet = DOM.append(row, DOM.$('pre.knox-gui-code-edit-snippet'));
				snippet.setAttribute('data-testid', 'knox-gui-code-to-edit-preview');
				widget.paintHighlightedCode(snippet, displayLanguageForFile(code.filepath), code.contents, code.filepath);
			}
		}
	} else if (!state.addFileOpen) {
		widget.chromeButton(card, {
			svg: 'plus',
			svgSize: 14,
			label: t(state, 'addFileToEdit'),
			extraClass: 'knox-gui-add-file',
			onClick: () => {
				widget.addFileHits = [];
				widget.addFileQuery = '';
				widget.controller.store.patch({ addFileOpen: true });
				void widget.refreshAddFileHits('');
			},
		});
	}
	if (state.addFileOpen) {
		const combobox = DOM.append(card, DOM.$('.knox-gui-add-file-combo'));
		const input = DOM.append(combobox, DOM.$('input.knox-gui-add-file-input')) as HTMLInputElement;
		input.placeholder = t(state, 'enterSearchFile');
		input.setAttribute('data-testid', 'knox-gui-add-file-input');
		input.value = widget.addFileQuery;
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
			widget.addFileQuery = input.value;
			void widget.refreshAddFileHits(input.value);
		}));
		widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'ArrowDown' && widget.addFileHits.length) {
				e.preventDefault();
				widget.addFileSelected = (widget.addFileSelected + 1) % widget.addFileHits.length;
				widget.controller.store.patch({});
			} else if (e.key === 'ArrowUp' && widget.addFileHits.length) {
				e.preventDefault();
				widget.addFileSelected = (widget.addFileSelected - 1 + widget.addFileHits.length) % widget.addFileHits.length;
				widget.controller.store.patch({});
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const hit = widget.addFileHits[widget.addFileSelected];
				const uri = hit?.query || hit?.id || input.value.trim();
				if (uri) {
					void pickAddFile(widget, uri);
				}
			} else if (e.key === 'Escape') {
				widget.addFileHits = [];
				widget.addFileQuery = '';
				widget.controller.store.patch({ addFileOpen: false });
			}
		}));
		widget.chromeButton(combobox, {
			svg: 'x',
			svgSize: 14,
			title: t(state, 'close'),
			extraClass: 'knox-gui-add-file-close',
			onClick: () => {
				widget.addFileHits = [];
				widget.addFileQuery = '';
				widget.controller.store.patch({ addFileOpen: false });
			},
		});
		if (widget.addFileHits.length) {
			const options = DOM.append(combobox, DOM.$('.knox-gui-add-file-options'));
			for (const [index, hit] of widget.addFileHits.entries()) {
				const option = DOM.append(options, DOM.$('button.knox-gui-add-file-option')) as HTMLButtonElement;
				option.type = 'button';
				if (index === widget.addFileSelected) {
					option.classList.add('selected');
				}
				appendKnoxGuiSvg(option, 'file', 16);
				DOM.append(option, DOM.$('span', undefined, hit.label));
				if (hit.description) {
					DOM.append(option, DOM.$('span.knox-gui-muted', undefined, hit.description));
				}
				widget.renderStore.add(DOM.addDisposableListener(option, 'click', () => void pickAddFile(widget, hit.query || hit.id)));
			}
		} else if (widget.addFileQuery) {
			DOM.append(combobox, DOM.$('.knox-gui-add-file-empty', undefined, t(state, 'noResults')));
		}
		queueMicrotask(() => input.focus());
	}
}

/** Multi-pick: the combobox stays open and already-added files drop out of the list. */
async function pickAddFile(widget: KnoxGuiWidget, uri: string): Promise<void> {
	widget.addFileQuery = '';
	widget.addFileHits = widget.addFileHits.filter(hit => (hit.query || hit.id) !== uri);
	widget.addFileSelected = 0;
	await widget.controller.addFilesToEdit([uri]);
	if (widget.controller.store.state.addFileOpen) {
		await widget.refreshAddFileHits('');
	}
}

export async function refreshAddFileHits(widget: KnoxGuiWidget, query: string): Promise<void> {
	const hits = await widget.controller.searchAddFiles(query);
	if (!widget.controller.store.state.addFileOpen || widget.addFileQuery !== query) {
		return;
	}
	widget.addFileHits = hits;
	widget.addFileSelected = 0;
	widget.controller.store.patch({});
}

export function renderContextPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.contextItems.length && !state.isGatheringContext) {
		return;
	}
	widget.renderContextItemsPeek(parent, state, 'main', state.contextItems, Boolean(state.isGatheringContext));
	const peek = parent.querySelector('.knox-gui-context-peek');
	peek?.setAttribute('data-testid', 'knox-gui-context-peek');
	peek?.setAttribute('data-composer-slot', 'contextPeek');
}

export function renderImageThumbnails(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const uploaded = state.images;
	const historical = state.historicalImages;
	if (!uploaded.length && !historical.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-thumbs'));
	wrap.setAttribute('data-testid', 'knox-gui-image-thumbs');
	for (const [index, image] of uploaded.entries()) {
		widget.renderThumb(wrap, state, image.imageUrl, image.name, t(state, 'uploadedImageAlt', { index: index + 1 }), () => widget.controller.removeImage(index));
	}
	for (const [index, url] of historical.entries()) {
		widget.renderThumb(wrap, state, url, `historical-${index}`, t(state, 'historicalImageAlt', { index: index + 1 }), () => widget.controller.removeHistoricalImage(index));
	}
}

export function renderThumb(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, url: string, name: string, alt: string, onRemove: () => void): void {
	const item = DOM.append(parent, DOM.$('.knox-gui-thumb-item'));
	const img = DOM.append(item, DOM.$('img.knox-gui-thumb')) as HTMLImageElement;
	img.src = url;
	img.alt = alt;
	widget.renderStore.add(DOM.addDisposableListener(item, 'mouseenter', () => widget.showImagePreview(item, url)));
	widget.renderStore.add(DOM.addDisposableListener(item, 'mouseleave', () => widget.hideImagePreview()));
	widget.renderStore.add(DOM.addDisposableListener(img, 'click', e => {
		e.stopPropagation();
		widget.openImageViewer(url);
	}));
	const remove = widget.iconButton(item, '×', onRemove, 'codicon-close');
	remove.classList.add('knox-gui-thumb-remove');
	widget.hover(remove, t(state, 'deleteImage'));
	void name;
}

export function showImagePreview(widget: KnoxGuiWidget, anchor: HTMLElement, url: string): void {
	widget.hideImagePreview();
	const rect = anchor.getBoundingClientRect();
	const pos = imagePreviewPosition(rect, window.innerWidth, window.innerHeight);
	const preview = DOM.append(document.body, DOM.$('.knox-gui-image-preview'));
	preview.style.left = `${pos.x}px`;
	preview.style.top = `${pos.y}px`;
	preview.style.transform = pos.below ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)';
	const img = DOM.append(preview, DOM.$('img')) as HTMLImageElement;
	img.src = url;
	widget.imagePreviewEl = preview;
}

export function hideImagePreview(widget: KnoxGuiWidget): void {
	widget.imagePreviewEl?.remove();
	widget.imagePreviewEl = undefined;
}
