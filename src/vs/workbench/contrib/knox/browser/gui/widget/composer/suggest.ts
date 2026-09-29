/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg, knoxGuiNamedIcon } from '../../knoxGuiIcons.js';
import {
	isSlashBookmarked,
	mentionFloatingPosition,
	MENTION_FLOATING_OFFSET,
	groupMentionItems,
	groupSlashItems,
	highlightMentionMatch,
	isFolderMentionItem,
	isOpenableMentionRow,
	isPathMentionItem,
	mentionIndexIsTruncated,
	mentionOptionId,
	shouldShowMentionSectionHeaders,
	shouldShowSlashSectionHeaders,
	slashCommandBareName,
} from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState, IKnoxGuiSuggestItem } from '../../../../common/knoxGuiState.js';

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
		if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
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
