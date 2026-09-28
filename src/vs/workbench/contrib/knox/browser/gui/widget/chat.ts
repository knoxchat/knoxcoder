/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { knoxGuiEditSendKey } from '../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg, KnoxGuiSvgIcon } from '../knoxGuiIcons.js';
import { renderLoadingState } from './panels.js';
import { setTranscriptScrollTop } from './chrome.js';
import {
	groupHistoryTurns,
	lastUserHistoryIndex,
	resolveDisplayStart,
	shouldFloatLastUser,
	visibleTurnIndexes,
} from '../../../common/knoxGuiChat.js';
import { appendTriggerToDoc, composerInputHistoryNext, composerInputHistoryPrev, docEndCaret, emptyInputDoc, groupMentionItems, groupSlashItems, IKnoxGuiDocCaret, inputDocIsEmpty, IKnoxGuiInputBlock, isMentionUtilityItem, knoxGuiComposerKeyAction } from '../../../common/knoxGuiInput.js';
import { processImageFile, processImageFiles } from './images.js';
import { visibleToolOutputPeekItems } from '../../../common/knoxGuiPanels.js';
import { IKnoxGuiContextItem, IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../common/knoxGuiState.js';
import {
	activityAnchorId,
	activityKindLabelKey,
	activitySummaryLine,
	assistantReplyText,
	buildAgentActivitySteps,
	collectDuplicateAssistantMessageIds,
	historyUserInputDoc,
	IKnoxGuiActivityStep,
	isDuplicateAssistantReply,
	itemCreatedAtMs,
	isResponseTruncated,
	knoxGuiShowsCodeToEditOnHistoryUser,
	KnoxGuiActivityKind,
	shouldShineSentFrame,
	shouldShowThinkingIndicator,
	IKnoxGuiPastFileInfo,
	knoxGuiContextItemFileIconName,
	knoxGuiPastFileInfo,
	healStreamingMarkdown,
	IKnoxGuiMarkdownFenceBlock,
	splitMarkdownBlocks,
	splitMarkdownParagraphs,
	turnHasVisibleProgress,
	visibleActivitySteps,
} from '../../../common/knoxGuiTranscript.js';

export function patchLastAssistant(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const card = widget.lastAssistantCard;
	const body = card?.querySelector('.knox-gui-stream-body') as HTMLElement | null;
	const item = state.history[state.history.length - 1];
	if (!card || !body || !item) {
		widget.render();
		return;
	}
	widget.renderStreamingAssistantBody(body, state, item);
	const showIndicator = shouldShowThinkingIndicator({
		isStreaming: state.isStreaming,
		isLast: true,
		hasContent: Boolean(assistantReplyText(item)),
		hasReasoning: Boolean(item.thinking?.trim()),
		isGatheringContext: state.isGatheringContext,
		showForModel: state.thinkingPlaceholder,
	});
	let indicator = card.querySelector('.knox-gui-thinking-indicator') as HTMLElement | null;
	if (showIndicator && !indicator) {
		indicator = DOM.append(card, DOM.$('.knox-gui-thinking-indicator'));
		indicator.setAttribute('data-testid', 'knox-gui-thinking-indicator');
		indicator.textContent = t(state, 'thinkingDots');
	} else if (!showIndicator && indicator) {
		indicator.remove();
	}
	if (widget.autoScrollEnabled && widget.bodyEl) {
		setTranscriptScrollTop(widget, widget.bodyEl, widget.bodyEl.scrollHeight);
	}
}

function pastFileInfoFor(state: IKnoxGuiState, item: IKnoxGuiHistoryItem): IKnoxGuiPastFileInfo {
	const index = state.history.findIndex(h => h.id === item.id);
	return knoxGuiPastFileInfo(state.history, index < 0 ? state.history.length : index, state.fileSymbols);
}

type StreamSegment =
	| { key: string; type: 'markdown'; text: string }
	| { key: string; type: 'fence'; fence: IKnoxGuiMarkdownFenceBlock; fenceIndex: number; generating: boolean };

/**
 * `streamingMarkdownBlocks.ts`: the reply as stable blocks; only the last one is
 * healed (`remend`) and re-rendered per token.
 */
function streamSegments(content: string, isStreaming: boolean): StreamSegment[] {
	const blocks = splitMarkdownBlocks(content);
	const lastFence = lastFenceIndex(blocks);
	const segments: StreamSegment[] = [];
	let fenceIndex = 0;
	for (const block of blocks) {
		if (block.type === 'markdown') {
			for (const text of splitMarkdownParagraphs(block.text)) {
				segments.push({ key: `md:${text}`, type: 'markdown', text });
			}
			continue;
		}
		const generating = isStreaming && fenceIndex === lastFence;
		segments.push({ key: `fence:${fenceIndex}:${generating}:${block.closed}:${block.language}:${block.filepath ?? ''}:${block.range ?? ''}:${block.code}`, type: 'fence', fence: block, fenceIndex, generating });
		fenceIndex += 1;
	}
	const last = segments[segments.length - 1];
	if (isStreaming && last?.type === 'markdown') {
		last.text = healStreamingMarkdown(last.text);
	}
	return segments;
}

/**
 * The live reply body. Leading blocks whose source is unchanged keep their DOM
 * (selection, inner scroll, listeners); the rest re-render into their own stores.
 */
export function renderStreamingAssistantBody(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const content = assistantReplyText(item) ? item.content : '';
	const segments = content && state.markdownFormatting !== false ? streamSegments(content, state.isStreaming) : [];
	const cache = widget.streamBlocks;
	let keep = 0;
	while (keep < cache.length && keep < segments.length - 1 && cache[keep].key === segments[keep].key && cache[keep].nodes.every(node => node.parentNode === body)) {
		keep += 1;
	}
	for (const stale of cache.splice(keep)) {
		widget.streamPatchStore.delete(stale.store);
	}
	const kept = new Set(cache.flatMap(block => block.nodes));
	for (const child of Array.from(body.childNodes)) {
		if (!kept.has(child)) {
			child.remove();
		}
	}
	if (!content) {
		return;
	}
	if (state.markdownFormatting === false) {
		DOM.append(body, DOM.$('pre.knox-gui-raw-md', undefined, content));
		return;
	}
	const fileInfo = pastFileInfoFor(state, item);
	for (const segment of segments.slice(keep)) {
		const store = widget.streamPatchStore.add(new DisposableStore());
		const before = body.childNodes.length;
		widget.listenerStore = store;
		try {
			if (segment.type === 'markdown') {
				widget.appendMarkdown(body, segment.text, store, fileInfo);
			} else {
				widget.renderCodeFence(body, state, item, segment.fence, segment.fenceIndex, segment.generating);
			}
		} finally {
			widget.listenerStore = widget.renderStore;
		}
		cache.push({ key: segment.key, nodes: Array.from(body.childNodes).slice(before), store });
	}
}

/** `MarkdownBlock.tsx`: while streaming only the last fence of the reply is generating. */
function lastFenceIndex(blocks: ReturnType<typeof splitMarkdownBlocks>): number {
	return blocks.filter(block => block.type !== 'markdown').length - 1;
}

export function renderChat(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (state.isLoadingHistory) {
		const loading = DOM.append(body, DOM.$('.knox-gui-empty'));
		loading.setAttribute('data-testid', 'chat-history-loading');
		loading.textContent = t(state, 'loadingConversation');
	}
	if (state.historyHydrateNotice === 'large') {
		const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
		banner.setAttribute('role', 'status');
		banner.setAttribute('data-testid', 'large-session-banner');
		DOM.append(banner, DOM.$('span', undefined, t(state, 'largeSessionBanner')));
		widget.chromeButton(banner, {
			label: t(state, 'hide'),
			onClick: () => widget.controller.store.patch({ historyHydrateNotice: null }),
		});
	}
	DOM.append(body, DOM.$('.knox-gui-body-spacer'));
	if (!state.history.length) {
		widget.displayStart = 0;
		return;
	}
	const lastUserIndex = lastUserHistoryIndex(state.history);
	const floatLastUser = shouldFloatLastUser({
		isStreaming: state.isStreaming,
		followLive: widget.autoScrollEnabled,
		lastUserIndex,
	});
	const turns = groupHistoryTurns(state.history);
	if (state.find.open && state.find.matchIndexes.length) {
		const hit = state.find.matchIndexes[state.find.current];
		if (Number.isFinite(hit) && hit < resolveDisplayStart({ historyLength: state.history.length, expandedStart: widget.expandedStart, turns })) {
			widget.expandedStart = hit;
		}
	}
	const displayStart = resolveDisplayStart({
		historyLength: state.history.length,
		expandedStart: widget.expandedStart,
		turns,
	});
	widget.displayStart = displayStart;
	if (displayStart > 0) {
		widget.chromeButton(body, {
			label: t(state, 'loadEarlierMessages', { count: displayStart }),
			testId: 'load-earlier-messages',
			extraClass: 'knox-gui-load-earlier',
			onClick: () => widget.loadEarlier(),
		});
	}
	if (widget.chatListFailed) {
		widget.renderChatListError(body, state);
		return;
	}
	try {
		const list = DOM.append(body, DOM.$('.knox-gui-history'));
		list.setAttribute('data-testid', 'chat-virtual-list');
		const duplicateIds = collectDuplicateAssistantMessageIds(state.history, state.history.length - (state.isStreaming ? 2 : 1));
		for (const turn of turns) {
			const indexes = visibleTurnIndexes(turn, displayStart, lastUserIndex);
			if (!indexes.length) {
				continue;
			}
			const group = DOM.append(list, DOM.$('.knox-gui-turn'));
			group.setAttribute('data-testid', `chat-turn-${turn.startIndex}`);
			for (const i of indexes) {
				if (floatLastUser && i === lastUserIndex) {
					continue;
				}
				const currentHit = state.find.open && state.find.matchIndexes[state.find.current] === i;
				const anyHit = state.find.open && state.find.matchIndexes.includes(i);
				widget.renderHistoryRow(group, state, i, anyHit, currentHit, lastUserIndex, duplicateIds);
			}
		}
		if (floatLastUser && widget.floatingHostEl && lastUserIndex >= 0) {
			const currentHit = state.find.open && state.find.matchIndexes[state.find.current] === lastUserIndex;
			const anyHit = state.find.open && state.find.matchIndexes.includes(lastUserIndex);
			widget.renderHistoryRow(widget.floatingHostEl, state, lastUserIndex, anyHit, currentHit, lastUserIndex, duplicateIds);
			const fade = DOM.append(widget.floatingHostEl, DOM.$('.knox-gui-sticky-last-user-fade'));
			fade.setAttribute('aria-hidden', 'true');
			fade.setAttribute('data-testid', 'sticky-last-user-fade');
		}
	} catch (error) {
		widget.chatListFailed = true;
		body.replaceChildren();
		widget.renderChatListError(body, state, error);
	}
}

export function renderChatListError(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, error?: unknown): void {
	const card = DOM.append(body, DOM.$('.knox-gui-error-fallback'));
	card.setAttribute('role', 'alert');
	card.setAttribute('data-testid', 'chat-list-error');
	DOM.append(card, DOM.$('p', undefined, t(state, 'chatListFailed')));
	if (error) {
		DOM.append(card, DOM.$('pre.knox-gui-error', undefined, error instanceof Error ? error.message : String(error)));
	}
	widget.chromeButton(card, {
		label: t(state, 'retry'),
		onClick: () => {
			widget.chatListFailed = false;
			widget.render();
		},
	});
}

export function renderHistoryRow(widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	index: number,
	highlight: boolean,
	currentHit: boolean,
	lastUserIndex: number,
	duplicateIds: Set<string>,
): void {
	const item = state.history[index];
	const wrap = DOM.append(parent, DOM.$('.knox-gui-turn'));
	wrap.classList.toggle('last-message', index === state.history.length - 1);
	wrap.classList.toggle('knox-gui-floating-last-user', parent === widget.floatingHostEl);
	wrap.setAttribute('data-testid', `history-row-${index}`);
	if (widget.failedRows.has(item.id)) {
		widget.renderRowError(wrap, state, item);
		return;
	}
	try {
		widget.renderMessage(wrap, state, item, highlight, currentHit, index, lastUserIndex, duplicateIds);
	} catch (error) {
		widget.failedRows.add(item.id);
		wrap.replaceChildren();
		widget.renderRowError(wrap, state, item, error);
	}
}

export function renderRowError(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, error?: unknown): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-error-fallback'));
	card.setAttribute('role', 'alert');
	card.setAttribute('data-testid', 'history-row-error');
	DOM.append(card, DOM.$('p', undefined, t(state, 'somethingWentWrong')));
	DOM.append(card, DOM.$('pre.knox-gui-error', undefined, error instanceof Error ? error.message : (item.error || String(error ?? ''))));
	widget.chromeButton(card, {
		label: t(state, 'retry'),
		onClick: () => {
			widget.failedRows.delete(item.id);
			widget.render();
		},
	});
}

export function renderMessage(widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	highlight: boolean,
	currentHit: boolean,
	index: number,
	lastUserIndex: number,
	duplicateIds: Set<string>,
): void {
	if (item.role === 'tool') {
		widget.renderToolOutputPeek(body, state, item);
		return;
	}
	const isLast = index === state.history.length - 1;
	const isLastUser = index === lastUserIndex;
	if (item.role === 'user') {
		widget.renderUserTurn(body, state, item, highlight, currentHit, index, isLastUser);
		if (state.mode === 'agent' && !isLastUser) {
			widget.renderActivityTimeline(body, state, index);
		} else if (state.mode !== 'agent' && shouldShineSentFrame(isLastUser, state.isStreaming, turnHasVisibleProgress(state.history, index))) {
			widget.renderTurnLoading(body, state, item);
		}
		return;
	}
	if (item.role === 'thinking') {
		widget.renderThinkingPeekBlock(body, state, item, index, isLast && state.isStreaming);
		return;
	}
	const isDuplicate = duplicateIds.has(item.id) || isDuplicateAssistantReply(state.history, index);
	if (item.role === 'assistant' && isDuplicate && !isLast) {
		for (const tool of item.toolCalls ?? []) {
			widget.renderTool(body, state, tool);
		}
		return;
	}
	if (item.role === 'assistant' && !assistantReplyText(item) && !(isLast && state.isStreaming) && !item.thinking && !item.toolCalls?.length && !item.error) {
		return;
	}
	widget.renderAssistantTurn(body, state, item, highlight, currentHit, index, isLast);
}

export function renderUserTurn(widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	highlight: boolean,
	currentHit: boolean,
	index: number,
	isLastUser: boolean,
): void {
	const wrap = DOM.append(body, DOM.$('.knox-gui-history-composer'));
	wrap.setAttribute('data-testid', isLastUser ? 'last-user-composer' : 'history-composer');
	wrap.setAttribute('data-history-id', item.id);
	wrap.setAttribute('data-index', String(index));
	if (highlight) {
		wrap.classList.add('knox-gui-msg-hit');
	}
	if (currentHit) {
		wrap.classList.add('knox-gui-msg-hit-current');
	}
	if (knoxGuiShowsCodeToEditOnHistoryUser(state.mode, index)) {
		widget.renderCodeToEditCard(wrap, state);
	}
	const shine = shouldShineSentFrame(isLastUser, state.isStreaming, turnHasVisibleProgress(state.history, index));
	const frame = DOM.append(wrap, DOM.$(shine ? '.knox-sent-frame.knox-sent-frame--live' : '.knox-sent-frame'));
	frame.setAttribute('data-testid', 'knox-sent-frame');
	frame.setAttribute('data-live', shine ? 'true' : 'false');
	if (shine) {
		DOM.append(frame, DOM.$('span.knox-sent-frame-ring'));
	}
	const inner = DOM.append(frame, DOM.$('.knox-sent-frame-inner'));
	widget.renderHistoricalEditor(inner, state, item, index);
	widget.renderHistoryContextPeek(wrap, state, item);
}

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
	const bar = DOM.append(box, DOM.$('.knox-gui-input-bar'));
	if (!focused) {
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
				bar.classList.add('knox-gui-input-bar--hidden');
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
		widget.controller.onComposerInput(widget.caretDocPosition(editor), item.id);
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keyup', (e: KeyboardEvent) => {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
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
	if (state.imagesSupported) {
		const file = DOM.append(left, DOM.$('input.knox-gui-file')) as HTMLInputElement;
		file.type = 'file';
		file.accept = '.jpg,.jpeg,.png,.gif,.svg,.webp';
		file.multiple = true;
		widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
			for (const itemFile of Array.from(file.files ?? [])) {
				widget.readImageFileIntoDraft(itemFile, item.id);
			}
			file.value = '';
		}));
		widget.chromeButton(left, {
			svg: 'attach-image',
			svgSize: 14,
			title: t(state, 'attachImage'),
			onClick: () => file.click(),
		});
	}
	widget.chromeButton(left, {
		svg: 'add-context',
		svgSize: 13,
		title: t(state, 'addContext'),
		onClick: () => {
			const doc = appendTriggerToDoc(widget.readInputDoc(editor), '@');
			const caret = docEndCaret(doc);
			setHistoryDraftDoc(widget, item.id, doc, caret);
			widget.controller.onComposerInput(caret, item.id);
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
			extraClass: state.webSearchEnabled ? 'knox-gui-web-search-on' : '',
			onClick: () => widget.controller.store.patch({ webSearchEnabled: !state.webSearchEnabled }),
		});
	}
	widget.chromeButton(right, {
		svg: 'send',
		svgSize: 14,
		label: t(state, knoxGuiEditSendKey(state)),
		title: t(state, 'sendMessage'),
		testId: 'knox-gui-history-send',
		extraClass: 'knox-gui-send',
		onClick: () => void widget.controller.submitEditedUser(index, widget.readInputDoc(editor), draft.images),
	});
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

/** `ContextItemsPeek.tsx`: collapsed by default; rows open the item. The latest turn shows gathering progress. */
export function renderHistoryContextPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const lastUser = [...state.history].reverse().find(h => h.role === 'user');
	renderContextItemsPeek(widget, parent, state, item.id, item.contextItems ?? [], !!state.isGatheringContext && lastUser?.id === item.id);
}

export function renderContextItemsPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, key: string, all: readonly IKnoxGuiContextItem[], gathering: boolean): void {
	const items = all.filter(ctx => !ctx.hidden);
	if (!items.length && !gathering) {
		return;
	}
	const open = widget.contextPeekOpen.has(key);
	const peek = DOM.append(parent, DOM.$('.knox-gui-context-peek'));
	const toggle = DOM.append(peek, DOM.$('button.knox-gui-context-peek-title')) as HTMLButtonElement;
	toggle.type = 'button';
	toggle.setAttribute('data-testid', 'context-items-peek');
	toggle.setAttribute('aria-expanded', String(open));
	appendKnoxGuiSvg(toggle, open ? 'chevron-down' : 'chevron-right', 14);
	if (gathering) {
		DOM.append(toggle, DOM.$('span.knox-gui-thinking-dots', undefined, t(state, 'gatheringContext')));
	} else {
		toggle.append(t(state, 'relatedContextItems', { count: items.length }));
	}
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
		if (open) {
			widget.contextPeekOpen.delete(key);
		} else {
			widget.contextPeekOpen.add(key);
		}
		widget.render();
	}));
	if (!open) {
		return;
	}
	const list = DOM.append(peek, DOM.$('.knox-gui-context-peek-list'));
	for (const ctx of items) {
		renderContextPeekItem(widget, list, ctx);
	}
}

/** `ContextItemsPeekItem`: icon, name, cyan description (file basename for files), arrow for URLs. */
export function renderContextPeekItem(widget: KnoxGuiWidget, parent: HTMLElement, ctx: IKnoxGuiContextItem, store = widget.renderStore): HTMLElement {
	const row = DOM.append(parent, DOM.$('.knox-gui-context-peek-item'));
	row.setAttribute('data-testid', 'context-items-peek-item');
	row.setAttribute('role', 'button');
	row.tabIndex = 0;
	const iconName = knoxGuiContextItemFileIconName(ctx);
	if (ctx.icon && /^(https?:|data:image\/)/.test(ctx.icon)) {
		const img = DOM.append(row, DOM.$('img.knox-gui-context-peek-icon')) as HTMLImageElement;
		img.src = ctx.icon;
		img.alt = '';
		img.onerror = () => img.remove();
	} else if (iconName) {
		widget.appendFileIcon(row, iconName, 18).classList.add('knox-gui-context-peek-icon');
	} else {
		DOM.append(row, DOM.$(`span.knox-gui-context-peek-icon.codicon.${contextProviderCodicon(ctx.provider)}`));
	}
	DOM.append(row, DOM.$('span.knox-gui-context-peek-name', undefined, ctx.name));
	const description = ctx.uri && ctx.description ? ctx.description.split('/').pop() ?? ctx.description : ctx.description ?? '';
	DOM.append(row, DOM.$('span.knox-gui-context-peek-desc', undefined, description));
	if (ctx.url) {
		row.classList.add('knox-gui-context-peek-url');
		DOM.append(row, DOM.$('span.knox-gui-context-peek-arrow.codicon.codicon-arrow-up-right'));
	}
	const openItem = (e: Event) => {
		e.preventDefault();
		widget.controller.openContextItem(ctx);
	};
	store.add(DOM.addDisposableListener(row, 'click', openItem));
	store.add(DOM.addDisposableListener(row, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			openItem(e);
		}
	}));
	return row;
}

/** Codicons standing in for the reference provider icons (`AtMentionDropdown` getIconFromDropdownItem). */
function contextProviderCodicon(provider: string | undefined): string {
	switch (provider) {
		case 'file': case 'currentFile': case 'open': return 'codicon-file';
		case 'folder': case 'tree': return 'codicon-folder';
		case 'codebase': case 'search': return 'codicon-search';
		case 'terminal': return 'codicon-terminal';
		case 'diff': case 'problems': return 'codicon-diff';
		case 'url': case 'web': case 'docs': return 'codicon-globe';
		case 'code': return 'codicon-symbol-method';
		case 'os': return 'codicon-device-desktop';
		case 'clipboard': return 'codicon-clippy';
		case 'debugger': return 'codicon-debug';
		default: return 'codicon-symbol-misc';
	}
}

/** `HistoryItemRow.tsx` chat/edit turn: `LoadingState` with the user message time as the timer origin. */
export function renderTurnLoading(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item?: IKnoxGuiHistoryItem): void {
	const row = DOM.append(parent, DOM.$('.knox-gui-turn-loading'));
	row.setAttribute('data-testid', 'knox-gui-turn-loading');
	row.style.fontSize = `${state.fontSize - 2}px`;
	renderLoadingState(widget, row, {
		label: t(state, 'activityLoading'),
		variant: 'drive',
		startedAt: itemCreatedAtMs(item),
		testId: 'sent-message-loading-state',
		ownClock: true,
	});
}

export function renderAssistantTurn(widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	highlight: boolean,
	currentHit: boolean,
	index: number,
	isLast: boolean,
): void {
	const card = DOM.append(body, DOM.$('.knox-gui-msg.assistant.thread-message.knox-gui-step'));
	card.setAttribute('data-index', String(index));
	card.id = activityAnchorId(`reply:${item.id}`);
	if (highlight) {
		card.classList.add('knox-gui-msg-hit');
	}
	if (currentHit) {
		card.classList.add('knox-gui-msg-hit-current');
	}
	if (item.error) {
		widget.renderErrorStep(card, state, item, index);
		return;
	}
	widget.renderReasoning(card, state, item, index);
	if (item.toolCalls?.length && !assistantReplyText(item)) {
		if (isLast) {
			widget.lastAssistantCard = card;
		}
		for (const tool of item.toolCalls) {
			widget.renderTool(card, state, tool);
		}
		return;
	}
	const streamBody = DOM.append(card, DOM.$('.knox-gui-stream-body'));
	widget.renderAssistantBody(streamBody, state, item, isLast);
	if (isLast) {
		widget.lastAssistantCard = card;
	}
	if (shouldShowThinkingIndicator({
		isStreaming: state.isStreaming,
		isLast,
		hasContent: Boolean(assistantReplyText(item)),
		hasReasoning: Boolean(item.thinking?.trim()),
		isGatheringContext: state.isGatheringContext,
		showForModel: state.thinkingPlaceholder,
	})) {
		const indicator = DOM.append(card, DOM.$('.knox-gui-thinking-indicator'));
		indicator.setAttribute('data-testid', 'knox-gui-thinking-indicator');
		indicator.textContent = t(state, 'thinkingDots');
	}
	const nextRole = state.history[index + 1]?.role;
	const hideActionSpace = nextRole === 'assistant' || nextRole === 'thinking';
	const hideActions = hideActionSpace || (state.isStreaming && isLast);
	if (!hideActionSpace) {
		if (hideActions) {
			DOM.append(card, DOM.$('.knox-gui-msg-actions.knox-gui-msg-actions-slot'));
		} else {
			widget.renderResponseActions(card, state, item, index, isResponseTruncated(item.content, false));
		}
	}
	for (const tool of item.toolCalls ?? []) {
		widget.renderTool(card, state, tool);
	}
}

export function renderErrorStep(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
	const box = DOM.append(card, DOM.$('.knox-gui-error-step'));
	const actions = DOM.append(box, DOM.$('.knox-gui-msg-actions'));
	widget.chromeButton(actions, {
		icon: 'codicon-chevron-up',
		title: t(state, 'collapse'),
		onClick: () => {
			widget.controller.store.patch({
				history: state.history.map(row => row.id === item.id ? { ...row, error: undefined } : row),
			});
		},
	});
	widget.chromeButton(actions, { icon: 'codicon-close', title: t(state, 'delete'), onClick: () => widget.controller.deleteMessage(index) });
	DOM.append(box, DOM.$('pre.knox-gui-error', undefined, item.error ?? ''));
}

export function renderAssistantBody(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, isLast: boolean): void {
	if (isLast && state.isStreaming) {
		widget.renderStreamingAssistantBody(card, state, item);
		return;
	}
	const content = assistantReplyText(item) ? item.content : '';
	if (!content) {
		return;
	}
	if (state.markdownFormatting === false) {
		DOM.append(card, DOM.$('pre.knox-gui-raw-md', undefined, content));
		return;
	}
	let fenceIndex = 0;
	const fileInfo = pastFileInfoFor(state, item);
	const blocks = splitMarkdownBlocks(content);
	const lastFence = lastFenceIndex(blocks);
	for (const block of blocks) {
		if (block.type === 'markdown') {
			if (block.text.trim()) {
				widget.appendMarkdown(card, block.text, undefined, fileInfo);
			}
			continue;
		}
		widget.renderCodeFence(card, state, item, block, fenceIndex, isLast && state.isStreaming && fenceIndex === lastFence);
		fenceIndex += 1;
	}
}

export function renderActivityTimeline(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, userIndex: number): void {
	const steps = buildAgentActivitySteps(state.history, userIndex);
	if (!steps.length) {
		return;
	}
	const expanded = widget.activityExpanded.has(userIndex);
	const { visible, hiddenCount } = visibleActivitySteps(steps, expanded);
	const wrap = DOM.append(parent, DOM.$('.knox-gui-activity'));
	wrap.setAttribute('data-testid', 'agent-activity-timeline');
	wrap.style.fontSize = `${Math.max(9, state.fontSize - 2)}px`;
	const toggle = DOM.append(wrap, DOM.$('button.knox-gui-activity-summary')) as HTMLButtonElement;
	toggle.type = 'button';
	widget.hover(toggle, t(state, 'activityTimeline'));
	DOM.append(toggle, DOM.$('span.knox-gui-activity-summary-text', undefined, activitySummaryLine((key, vars) => t(state, key, vars), steps)));
	DOM.append(toggle, DOM.$('span.knox-gui-muted', undefined, t(state, steps.length === 1 ? 'activityRowCount' : 'activityRowCount_plural', { count: steps.length })));
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
		if (expanded) {
			widget.activityExpanded.delete(userIndex);
		} else {
			widget.activityExpanded.add(userIndex);
		}
		widget.render();
	}));
	if (hiddenCount > 0) {
		widget.chromeButton(wrap, {
			label: t(state, 'activityShowEarlier', { count: hiddenCount }),
			extraClass: 'knox-gui-activity-earlier',
			onClick: () => {
				widget.activityExpanded.add(userIndex);
				widget.render();
			},
		});
	}
	widget.renderActivitySteps(wrap, state, visible);
}

export function renderActivitySteps(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, steps: IKnoxGuiActivityStep[]): void {
	const list = DOM.append(parent, DOM.$('ol.knox-gui-activity-steps'));
	list.setAttribute('data-testid', 'agent-activity-step-list');
	for (const step of steps) {
		const li = DOM.append(list, DOM.$('li.knox-gui-activity-step'));
		const row = DOM.append(li, DOM.$('button.knox-gui-activity-step-btn')) as HTMLButtonElement;
		row.type = 'button';
		widget.hover(row, t(state, activityKindLabelKey(step.kind)));
		const glyph = DOM.append(row, DOM.$('span.knox-gui-activity-status'));
		if (step.status === 'running') {
			widget.appendSpinner(glyph, 12);
		} else if (step.status === 'done') {
			appendKnoxGuiSvg(glyph, 'check', 12).classList.add('knox-gui-activity-done');
		} else if (step.status === 'canceled') {
			appendKnoxGuiSvg(glyph, 'x', 12).classList.add('knox-gui-activity-canceled');
		} else {
			DOM.append(glyph, DOM.$('span.knox-gui-activity-pending'));
		}
		const kind = DOM.append(row, DOM.$('span.knox-gui-activity-kind'));
		appendKnoxGuiSvg(kind, activityKindSvg(step.kind), 12);
		DOM.append(row, DOM.$('span.knox-gui-activity-label', undefined, t(state, activityKindLabelKey(step.kind))));
		if (step.detail) {
			DOM.append(row, DOM.$('code.knox-gui-muted', undefined, step.detail));
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
			widget.scrollToHistoryIndex(step.historyIndex);
			requestAnimationFrame(() => {
				widget.root.ownerDocument.getElementById(activityAnchorId(step.id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			});
		}));
		if (step.workspaceCheckpointId) {
			const restore = DOM.append(li, DOM.$('button.knox-gui-activity-cp')) as HTMLButtonElement;
			restore.type = 'button';
			restore.textContent = `cp ${step.workspaceCheckpointId.slice(0, 8)}`;
			widget.hover(restore, t(state, 'activityCheckpointRestore', { id: step.workspaceCheckpointId }));
			widget.renderStore.add(DOM.addDisposableListener(restore, 'click', (event: MouseEvent) => {
				event.stopPropagation();
				widget.controller.restoreCheckpoint(step.workspaceCheckpointId!, event.shiftKey);
			}));
		}
	}
}

function activityKindSvg(kind: KnoxGuiActivityKind): KnoxGuiSvgIcon {
	switch (kind) {
		case 'thinking': return 'sparkles';
		case 'read': return 'file-text';
		case 'search': return 'search';
		case 'edit': return 'file-pen-line';
		case 'test': return 'test-tube';
		case 'shell': return 'terminal';
		case 'git': return 'git-branch';
		case 'task': return 'bot';
		case 'ask': return 'message-circle-question';
		case 'reply': return 'message-square';
		default: return 'wrench';
	}
}

/** `StreamErrorDialog` inside the Layout `TextDialog`: status title, capped message box, Close. */
export function renderStreamError(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.streamError) {
		return;
	}
	const close = () => widget.controller.clearStreamError();
	const overlay = DOM.append(parent, DOM.$('.knox-gui-text-dialog'));
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', close));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	box.setAttribute('role', 'alertdialog');
	box.setAttribute('aria-modal', 'true');
	widget.chromeButton(box, { svg: 'x', svgSize: 20, title: t(state, 'close'), extraClass: 'knox-gui-text-dialog-close', onClick: close });
	const card = DOM.append(box, DOM.$('.knox-gui-stream-error'));
	card.setAttribute('data-testid', 'knox-gui-stream-error');
	const code = state.streamError.statusCode ? `${state.streamError.statusCode} ` : '';
	DOM.append(card, DOM.$('p.knox-gui-stream-error-title', undefined, `${code}${t(state, 'error')}`));
	if (state.streamError.message) {
		const messageBox = DOM.append(card, DOM.$('.knox-gui-stream-error-message'));
		DOM.append(messageBox, DOM.$('code', undefined, state.streamError.message));
	}
	const actions = DOM.append(card, DOM.$('.knox-gui-stream-error-actions'));
	widget.chromeButton(actions, { label: t(state, 'close'), extraClass: 'knox-gui-primary', onClick: close });
}

export function renderToolOutputPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const raw = item.toolCalls?.flatMap(call => call.outputItems ?? []) ?? [];
	const items = visibleToolOutputPeekItems(raw.length ? raw : (item.content.trim() ? [{ name: 'Tool', content: item.content }] : []));
	const wrap = DOM.append(parent, DOM.$('div'));
	wrap.setAttribute('data-testid', 'knox-gui-tool-output');
	renderContextItemsPeek(widget, wrap, state, `${item.id}:tool-output`, items.map(output => ({ ...output, name: output.name || 'Tool', content: output.content ?? '' })), false);
	if (!wrap.childElementCount) {
		wrap.remove();
	}
}
