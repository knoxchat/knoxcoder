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
	knoxGuiShowsAgentMeter,
	knoxGuiShowsChatPermissionBar,
	knoxGuiShowsComposerAcceptReject,
	knoxGuiShowsBatchDiffEntry,
	knoxGuiAcceptRejectLabelKeys,
	knoxGuiAcceptRejectShortcut,
} from '../../../common/knoxGuiChrome.js';
import { knoxGuiModelSelectTitle } from '../../../common/knoxGuiCapabilities.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { findCurrentToolCall, toolDisplayKind } from '../../../common/knoxGuiChat.js';
import {
	appendTriggerToDoc,
	composerInputHistoryAdd,
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
	isFolderMentionItem,
	isMentionUtilityItem,
	isOpenableMentionRow,
	isPathMentionItem,
	isSingleRangeEdit,
	knoxGuiCodeToEditTitle,
	knoxGuiComposerKeyAction,
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
import { reasoningEffortLabelKey } from '../../../common/knoxGuiOverlays.js';
import { IKnoxGuiState, IKnoxGuiSuggestItem } from '../../../common/knoxGuiState.js';
import { pendingApplyStates } from '../../../common/knoxGuiTranscript.js';

export function onDragOver(widget: KnoxGuiWidget, event: DragEvent): void {
	event.preventDefault();
	const items = Array.from(event.dataTransfer?.items ?? []);
	const hasPayload = items.some(item => item.kind === 'file' || item.type === 'text/uri-list' || item.type.startsWith('image/'));
	if (!hasPayload) {
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

export function onDragLeave(widget: KnoxGuiWidget, event: DragEvent): void {
	if (event.relatedTarget && widget.root.contains(event.relatedTarget as Node)) {
		return;
	}
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
	}
	widget.dragLeaveTimer = setTimeout(() => {
		widget.dragOver = false;
		widget.hideDropOverlay();
	}, 200);
}

export function showDropOverlay(widget: KnoxGuiWidget): void {
	if (widget.dropOverlayEl) {
		return;
	}
	const overlay = DOM.append(widget.root, DOM.$('.knox-gui-drop-overlay'));
	overlay.setAttribute('data-testid', 'knox-gui-drop-overlay');
	DOM.append(overlay, DOM.$('.knox-gui-drop-overlay-fill'));
	DOM.append(overlay, DOM.$('.knox-gui-drop-overlay-text', undefined, t(widget.controller.store.state, 'dragAndDropImages')));
	widget.dropOverlayEl = overlay;
}

export function hideDropOverlay(widget: KnoxGuiWidget): void {
	widget.dropOverlayEl?.remove();
	widget.dropOverlayEl = undefined;
}

export function onDrop(widget: KnoxGuiWidget, event: DragEvent): void { // KN-374 image + file drop
	event.preventDefault();
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
			for (const file of images) {
				widget.readImageFile(file);
			}
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
	const lump = DOM.append(composer, DOM.$('.knox-gui-lump-shell'));
	widget.renderToolbar(lump, state);
	if (knoxGuiShowsLumpOverlay(state)) {
		const overlay = DOM.append(lump, DOM.$('.knox-gui-overlay'));
		overlay.setAttribute('data-testid', `knox-gui-overlay-${state.overlay}`);
		overlay.setAttribute('data-composer-slot', 'overlay');
		widget.renderOverlay(overlay, state, state.overlay!);
	}
	if (knoxGuiShowsAgentMeter(state.mode)) {
		widget.renderAgentMeter(composer, state);
	}
	widget.renderPanels(composer, state);
	widget.renderInput(composer, state);
	if (state.isGatheringContext) {
		DOM.append(composer, DOM.$('.knox-gui-banner', undefined, t(state, 'gatheringContext')));
	}
	widget.renderContextPeek(composer, state);
	widget.renderChatPermissionBar(composer, state);
	widget.renderAcceptRejectAll(composer, state);
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
	const rejectLabel = singleRange
		? `${t(state, keys.reject)} (${knoxGuiAcceptRejectShortcut(isMacintosh, 'reject')})`
		: t(state, keys.reject);
	const acceptLabel = singleRange
		? `${t(state, keys.accept)} (${knoxGuiAcceptRejectShortcut(isMacintosh, 'accept')})`
		: t(state, keys.accept);
	const bar = DOM.append(parent, DOM.$('.knox-gui-accept-reject-all'));
	bar.setAttribute('data-composer-slot', 'acceptRejectAll');
	bar.setAttribute('data-testid', 'knox-gui-accept-reject-all');
	if (state.isStreaming) {
		bar.classList.add('knox-gui-accept-reject-streaming');
	}
	widget.chromeButton(bar, {
		svg: 'x',
		svgSize: 16,
		label: rejectLabel,
		testId: 'edit-reject-button',
		extraClass: 'knox-gui-reject',
		disabled: state.isStreaming,
		onClick: () => widget.controller.rejectAllApplies(),
	});
	widget.chromeButton(bar, {
		svg: 'check',
		svgSize: 16,
		label: acceptLabel,
		testId: 'edit-accept-button',
		extraClass: 'knox-gui-accept',
		disabled: state.isStreaming,
		onClick: () => widget.controller.acceptAllApplies(),
	});
}

export function renderChatPermissionBar(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const call = findCurrentToolCall(state.history);
	if (!knoxGuiShowsChatPermissionBar(call, { toolSettings: state.toolSettings, sessionAllowlist: state.sessionToolAllowlist })) {
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
		if (document.activeElement === widget.editorEl || widget.editorEl.contains(document.activeElement)) {
			widget.placeCaretAtEnd();
		}
	}
	widget.syncPlaceholder(widget.editorEl, state);
	widget.renderSuggest(widget.inputWrap, state);
	if (state.inputFocused) {
		widget.editorEl.focus();
	}
}

export function renderSuggest(widget: KnoxGuiWidget, wrap: HTMLElement, state: IKnoxGuiState): void {
	widget.suggestEl?.remove();
	widget.suggestEl = undefined;
	if (!(state.mentionOpen || state.slashOpen)) {
		return;
	}
	const list = DOM.append(wrap, DOM.$('.knox-gui-suggest'));
	list.setAttribute('data-testid', 'knox-gui-suggest');
	list.setAttribute('data-suggestion-kind', state.slashOpen ? 'slash' : 'mention');
	widget.suggestEl = list;
	wrap.insertBefore(list, wrap.firstChild);

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
		appendKnoxGuiSvg(iconWrap, 'folder', 16);
	} else if (isPathMentionItem(item)) {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-file');
		appendKnoxGuiSvg(iconWrap, 'file', 16);
	} else if (item.itemType === 'action') {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-action');
		appendKnoxGuiSvg(iconWrap, 'plus', 16);
	} else {
		iconWrap.setAttribute('data-testid', 'mention-row-icon-provider');
		appendKnoxGuiSvg(iconWrap, item.itemType === 'slashCommand' ? 'scroll-text' : 'add-context', 16);
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
		const bookmarked = Boolean(item.bookmarked) || state.bookmarkedSlash.includes(name);
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
	widget.renderSuggest(wrap, state);
	const editor = DOM.append(wrap, DOM.$('.knox-gui-input')) as HTMLElement;
	widget.editorEl = editor;
	editor.contentEditable = 'true';
	editor.setAttribute('role', 'textbox');
	editor.setAttribute('aria-multiline', 'true');
	editor.setAttribute('data-testid', 'knox-gui-input');
	editor.spellcheck = true;
	widget.paintInputDoc(editor, state.inputDoc);
	widget.syncPlaceholder(editor, state);
	if (state.inputFocused) {
		queueMicrotask(() => widget.focusInput());
	}
	widget.renderStore.add(DOM.addDisposableListener(editor, 'focus', () => widget.controller.store.patch({ inputFocused: true })));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'blur', () => widget.controller.store.patch({ inputFocused: false })));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'input', () => {
		widget.controller.store.setInputDoc(widget.readInputDoc(editor));
		widget.syncPlaceholder(editor, widget.controller.store.state);
		widget.controller.onComposerInput();
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'paste', (e: ClipboardEvent) => widget.onEditorPaste(e, state)));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keydown', (e: KeyboardEvent) => widget.onEditorKeyDown(e, state)));
	widget.renderImageThumbnails(wrap, state);
	const row = DOM.append(wrap, DOM.$('.knox-gui-input-bar'));
	const left = DOM.append(row, DOM.$('.knox-gui-input-bar-left'));
	const right = DOM.append(row, DOM.$('.knox-gui-input-bar-right'));

	if (state.imagesSupported) {
		const file = DOM.append(left, DOM.$('input.knox-gui-file')) as HTMLInputElement;
		file.type = 'file';
		file.accept = '.jpg,.jpeg,.png,.gif,.svg,.webp';
		file.multiple = true;
		widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
			for (const item of Array.from(file.files ?? [])) {
				widget.readImageFile(item);
			}
			file.value = '';
		}));
		widget.chromeButton(left, {
			svg: 'attach-image',
			svgSize: 14,
			title: t(state, 'attachImage'),
			testId: 'knox-gui-attach-image',
			onClick: () => file.click(),
		});
	}
	widget.chromeButton(left, {
		svg: 'add-context',
		svgSize: 13,
		title: t(state, 'addContext'),
		testId: 'knox-gui-add-context',
		onClick: () => {
			widget.controller.store.setInputDoc(appendTriggerToDoc(widget.controller.store.state.inputDoc, '@'));
			void widget.controller.loadMentions('');
			widget.controller.store.patch({ inputFocused: true });
		},
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
			extraClass: 'knox-gui-exit-edit',
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
		const blocked = knoxGuiShouldBlockSubmit(state);
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

export function renderModelSelect(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const models = state.modelsByRole.chat.length ? state.modelsByRole.chat : state.models;
	const current = models.find(model => model.title === state.modelTitle) ?? models[0];
	const wrap = DOM.append(parent, DOM.$('.knox-gui-model-wrap'));
	const trigger = widget.chromeButton(wrap, {
		label: knoxGuiModelSelectTitle(current) || t(state, 'selectModel'),
		svg: 'chevrons-down',
		svgSize: 16,
		svgAfter: true,
		title: t(state, 'models'),
		testId: 'knox-gui-model-select',
		extraClass: 'knox-gui-model-trigger',
		menuTrigger: true,
		onClick: () => widget.toggleMenu('model'),
	});
	trigger.setAttribute('aria-haspopup', 'listbox');
	if (widget.openMenu !== 'model') {
		return;
	}
	const menu = DOM.append(wrap, DOM.$('.knox-gui-popover.knox-gui-model-menu'));
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('data-testid', 'knox-gui-model-menu');
	for (const model of models) {
		const row = DOM.append(menu, DOM.$('button.knox-gui-popover-item knox-gui-model-option')) as HTMLButtonElement;
		row.type = 'button';
		const missingKey = model.apiKey === '';
		row.disabled = missingKey;
		appendKnoxGuiSvg(row, 'cpu', 14);
		const title = DOM.append(row, DOM.$('span.knox-gui-model-option-title', undefined, knoxGuiModelSelectTitle(model)));
		if (missingKey) {
			DOM.append(title, DOM.$('span.knox-gui-muted', undefined, ` (${t(state, 'missingApiKey')})`));
		}
		if (model.title === current?.title) {
			appendKnoxGuiSvg(row, 'check', 14);
		}
		const hoverActs = DOM.append(row, DOM.$('span.knox-gui-model-option-actions'));
		widget.chromeButton(hoverActs, {
			svg: 'trash',
			svgSize: 12,
			title: t(state, 'deleteModel'),
			extraClass: 'knox-gui-model-delete',
			onClick: (btn, event) => {
				event?.stopPropagation();
				widget.controller.deleteModel(model.title);
				widget.closeMenus();
			},
		});
		widget.chromeButton(hoverActs, {
			svg: 'gear',
			svgSize: 12,
			title: t(state, 'settings'),
			onClick: (btn, event) => {
				event?.stopPropagation();
				widget.controller.messenger.post('config/openProfile', { profileId: state.profileId });
				widget.closeMenus();
			},
		});
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			if (missingKey) {
				return;
			}
			widget.closeMenus();
			widget.controller.selectModel('chat', model.title);
		}));
	}
	const add = DOM.append(menu, DOM.$('button.knox-gui-popover-item knox-gui-model-add')) as HTMLButtonElement;
	add.type = 'button';
	appendKnoxGuiSvg(add, 'plus', 12);
	add.append(t(state, 'addModel'));
	widget.renderStore.add(DOM.addDisposableListener(add, 'click', e => {
		e.stopPropagation();
		widget.closeMenus();
		widget.controller.openAddModel('chat', { bulk: true });
	}));
}

export function renderReasoningSelect(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.reasoningEfforts.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-effort-wrap'));
	const currentKey = reasoningEffortLabelKey(state.reasoningEffort ?? '');
	const trigger = widget.chromeButton(wrap, {
		svg: 'brain',
		svgSize: 12,
		label: currentKey ? t(state, currentKey) : (state.reasoningEffort ?? t(state, 'reasoningEffortSelect')),
		svgAfter: false,
		title: t(state, 'reasoningEffortTooltip'),
		testId: 'knox-gui-reasoning-select',
		extraClass: 'knox-gui-effort-trigger',
		menuTrigger: true,
		disabled: state.isStreaming,
		onClick: () => widget.toggleMenu('effort'),
	});
	appendKnoxGuiSvg(trigger, 'chevrons-down', 12);
	if (widget.openMenu !== 'effort') {
		return;
	}
	const menu = DOM.append(wrap, DOM.$('.knox-gui-popover.knox-gui-effort-menu'));
	menu.setAttribute('data-testid', 'knox-gui-effort-menu');
	for (const effort of state.reasoningEfforts) {
		const row = DOM.append(menu, DOM.$('button.knox-gui-popover-item')) as HTMLButtonElement;
		row.type = 'button';
		const labelKey = reasoningEffortLabelKey(effort);
		row.append(labelKey ? t(state, labelKey) : effort);
		if (effort === state.reasoningEffort) {
			appendKnoxGuiSvg(row, 'check', 12);
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			widget.closeMenus();
			widget.controller.setReasoningEffort(effort);
		}));
	}
}

export function onEditorKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): void {
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
	if (e.key === 'Tab' && e.shiftKey && state.mode === 'agent' && !state.isStreaming && !(state.mentionOpen || state.slashOpen)) {
		e.preventDefault();
		widget.controller.store.cyclePermissionMode();
		return;
	}
	if (e.key === 'Escape') {
		widget.onEscape(e, state);
	}
}

export function submitFromComposer(widget: KnoxGuiWidget, altKey: boolean): void {
	const state = widget.controller.store.state;
	if (knoxGuiShouldBlockSubmit(state)) {
		return;
	}
	const history = state.mode === 'edit' ? widget.editInputHistory : widget.chatInputHistory;
	const next = composerInputHistoryAdd(history, state.inputDoc);
	if (state.mode === 'edit') {
		widget.editInputHistory = next;
	} else {
		widget.chatInputHistory = next;
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

export function onEditorPaste(widget: KnoxGuiWidget, event: ClipboardEvent, state: IKnoxGuiState): void {
	const items = event.clipboardData?.items;
	if (!items || !state.imagesSupported) {
		return;
	}
	let handled = false;
	for (const item of Array.from(items)) {
		const file = item.getAsFile();
		if (file && file.type.startsWith('image/')) {
			handled = true;
			widget.readImageFile(file);
		}
	}
	if (handled) {
		event.preventDefault();
	}
}

export function readImageFile(widget: KnoxGuiWidget, file: File): void {
	if (!file.type.startsWith('image/')) {
		return;
	}
	const reader = new FileReader();
	reader.onload = () => {
		widget.controller.store.patch({
			images: [...widget.controller.store.state.images, { name: file.name, imageUrl: String(reader.result) }],
		});
	};
	reader.readAsDataURL(file);
}

export function paintInputDoc(widget: KnoxGuiWidget, editor: HTMLElement, doc: IKnoxGuiInputBlock[], onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
	editor.replaceChildren();
	const blocks = doc.length ? doc : emptyInputDoc();
	for (const block of blocks) {
		if (block.type === 'codeBlock') {
			const chip = DOM.append(editor, DOM.$('div.knox-gui-input-code-chip'));
			chip.contentEditable = 'false';
			if (block.language) {
				chip.dataset.language = block.language;
			}
			if (block.filepath) {
				chip.dataset.filepath = block.filepath;
			}
			if (block.itemName) {
				chip.dataset.itemName = block.itemName;
			}
			const head = DOM.append(chip, DOM.$('.knox-gui-input-code-head'));
			DOM.append(head, DOM.$('span', undefined, block.itemName || block.filepath || 'code'));
			widget.chromeButton(head, {
				svg: 'x',
				svgSize: 12,
				title: t(widget.controller.store.state, 'delete'),
				extraClass: 'knox-gui-input-code-remove',
				onClick: () => {
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
			const pre = DOM.append(chip, DOM.$('pre.knox-gui-input-code'));
			pre.textContent = block.code;
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
	if (node.type === 'mention') {
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
			widget.hover(chip, node.description);
		}
		chip.textContent = mentionChipLabel(node);
	} else {
		chip.textContent = slashCommandTitle(node.id || node.label);
	}
}

export function readInputDoc(widget: KnoxGuiWidget, editor: HTMLElement): IKnoxGuiInputBlock[] {
	const blocks: IKnoxGuiInputBlock[] = [];
	const children = Array.from(editor.childNodes);
	if (!children.length) {
		return emptyInputDoc();
	}
	for (const child of children) {
		if (child instanceof HTMLElement && child.classList.contains('knox-gui-input-code-chip')) {
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
	widget.chromeButton(head, {
		svg: 'plus',
		svgSize: 14,
		title: t(state, 'addFileToEdit'),
		testId: 'knox-gui-add-file-edit',
		onClick: () => {
			widget.addFileHits = [];
			widget.addFileQuery = '';
			widget.addFileSelected = 0;
			widget.controller.store.patch({ addFileOpen: !state.addFileOpen });
			if (!state.addFileOpen) {
				void widget.refreshAddFileHits('');
			}
		},
	});
	if (state.codeToEdit.length) {
		const list = DOM.append(card, DOM.$('ul.knox-gui-code-edit-list'));
		for (const [index, code] of state.codeToEdit.entries()) {
			const row = DOM.append(list, DOM.$('li.knox-gui-code-edit-item'));
			row.setAttribute('data-testid', 'knox-gui-code-to-edit-item');
			const info = knoxGuiCodeToEditTitle(code);
			const label = info.kind === 'insert'
				? `${info.name} - ${t(state, 'insertingAtLine', { line: info.start })}`
				: info.kind === 'range'
					? `${info.name} (${info.start} - ${info.end})`
					: info.name;
			const main = DOM.append(row, DOM.$('.knox-gui-code-edit-main'));
			appendKnoxGuiSvg(main, 'file', 18);
			const fileBtn = DOM.append(main, DOM.$('button.knox-gui-code-edit-name', undefined, label)) as HTMLButtonElement;
			fileBtn.type = 'button';
			widget.renderStore.add(DOM.addDisposableListener(fileBtn, 'click', e => {
				e.stopPropagation();
				widget.controller.showFile(code.filepath);
			}));
			const actions = DOM.append(row, DOM.$('.knox-gui-code-edit-actions'));
			if (info.kind !== 'insert' && code.contents) {
				widget.chromeButton(actions, {
					svg: widget.codeEditExpanded.has(index) ? 'chevron-down' : 'chevron-right',
					svgSize: 16,
					title: t(state, widget.codeEditExpanded.has(index) ? 'hide' : 'show'),
					onClick: () => {
						if (widget.codeEditExpanded.has(index)) {
							widget.codeEditExpanded.delete(index);
						} else {
							widget.codeEditExpanded.add(index);
						}
						widget.controller.store.patch({});
					},
				});
			}
			widget.chromeButton(actions, {
				svg: 'x',
				svgSize: 16,
				title: t(state, 'delete'),
				extraClass: 'knox-gui-code-edit-remove',
				onClick: () => widget.controller.removeCodeToEdit(index),
			});
			if (widget.codeEditExpanded.has(index) && code.contents) {
				const snippet = DOM.append(row, DOM.$('pre.knox-gui-code-edit-snippet'));
				snippet.textContent = code.contents;
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
					void widget.controller.addFilesToEdit([uri]);
					widget.addFileHits = [];
					widget.addFileQuery = '';
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
				widget.renderStore.add(DOM.addDisposableListener(option, 'click', () => {
					void widget.controller.addFilesToEdit([hit.query || hit.id]);
					widget.addFileHits = [];
					widget.addFileQuery = '';
				}));
			}
		} else if (widget.addFileQuery) {
			DOM.append(combobox, DOM.$('.knox-gui-add-file-empty', undefined, t(state, 'noResults')));
		}
		queueMicrotask(() => input.focus());
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
	if (!state.contextItems.length) {
		return;
	}
	const peek = DOM.append(parent, DOM.$('.knox-gui-context-peek'));
	peek.setAttribute('data-testid', 'knox-gui-context-peek');
	peek.setAttribute('data-composer-slot', 'contextPeek');
	DOM.append(peek, DOM.$('div.knox-gui-context-peek-title', undefined, t(state, 'relatedContextItems', { count: state.contextItems.length })));
	for (const [index, item] of state.contextItems.entries()) {
		const row = DOM.append(peek, DOM.$('.knox-gui-chip.knox-gui-context-chip'));
		row.append(item.name);
		widget.iconButton(row, '×', () => widget.controller.removeContextItem(index), 'codicon-close');
	}
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
	widget.renderStore.add(DOM.addDisposableListener(item, 'click', () => widget.controller.messenger.post('showFile', { filepath: url })));
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
