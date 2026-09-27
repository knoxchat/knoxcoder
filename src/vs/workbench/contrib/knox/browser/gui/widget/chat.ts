/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { knoxGuiEditSendKey } from '../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg, KnoxGuiSvgIcon } from '../knoxGuiIcons.js';
import {
	groupHistoryTurns,
	lastUserHistoryIndex,
	resolveDisplayStart,
	shouldFloatLastUser,
	visibleTurnIndexes,
} from '../../../common/knoxGuiChat.js';
import { appendTriggerToDoc, emptyInputDoc, inputDocIsEmpty, IKnoxGuiInputBlock } from '../../../common/knoxGuiInput.js';
import { visibleToolOutputPeekItems } from '../../../common/knoxGuiPanels.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../common/knoxGuiState.js';
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
	isResponseTruncated,
	knoxGuiShowsCodeToEditOnHistoryUser,
	KnoxGuiActivityKind,
	shouldShineSentFrame,
	shouldShowThinkingIndicator,
	splitMarkdownBlocks,
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
	widget.streamPatchStore.clear();
	body.replaceChildren();
	widget.renderStreamingAssistantBody(body, state, item);
	const showIndicator = shouldShowThinkingIndicator({
		isStreaming: state.isStreaming,
		isLast: true,
		hasContent: Boolean(assistantReplyText(item)),
		hasReasoning: Boolean(item.thinking?.trim()),
	});
	let indicator = card.querySelector('.knox-gui-thinking-indicator') as HTMLElement | null;
	if (showIndicator && !indicator) {
		indicator = DOM.append(card, DOM.$('.knox-gui-thinking-indicator'));
		indicator.textContent = t(state, 'thinkingDots');
	} else if (!showIndicator && indicator) {
		indicator.remove();
	}
	if (widget.autoScrollEnabled && widget.bodyEl) {
		widget.bodyEl.scrollTop = widget.bodyEl.scrollHeight;
	}
}

export function renderStreamingAssistantBody(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const content = assistantReplyText(item) ? item.content : '';
	if (!content) {
		return;
	}
	if (state.markdownFormatting === false) {
		DOM.append(card, DOM.$('pre.knox-gui-raw-md', undefined, content));
		return;
	}
	for (const block of splitMarkdownBlocks(content)) {
		if (block.type === 'markdown') {
			if (block.text.trim()) {
				widget.appendMarkdown(card, block.text, widget.streamPatchStore);
			}
			continue;
		}
		widget.renderStreamingFencePreview(card, state, block, !block.closed);
	}
}

export function renderStreamingFencePreview(widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	fence: { language: string; filepath?: string; code: string; closed: boolean },
	generating: boolean,
): void {
	const box = DOM.append(parent, DOM.$('.knox-gui-code-block'));
	const head = DOM.append(box, DOM.$('.knox-gui-code-toolbar'));
	if (fence.filepath) {
		DOM.append(head, DOM.$('span.knox-gui-code-file', undefined, fence.filepath));
	} else if (fence.language) {
		DOM.append(head, DOM.$('span.knox-gui-muted', undefined, fence.language));
	}
	if (generating) {
		DOM.append(head, DOM.$('span.knox-gui-muted', undefined, t(state, 'generating')));
	}
	const pre = DOM.append(box, DOM.$('div.knox-gui-code-pre')) as HTMLElement;
	if (state.codeWrap) {
		pre.classList.add('wrap');
	}
	widget.paintHighlightedCode(pre, fence.language, fence.code, fence.filepath);
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
		widget.renderStreamError(list, state);
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
			widget.renderTurnLoading(body, state);
		}
		return;
	}
	if (item.role === 'thinking') {
		widget.renderThinkingPeekBlock(body, state, item, index, isLast && state.isStreaming);
		return;
	}
	const isDuplicate = duplicateIds.has(item.id) || isDuplicateAssistantReply(state.history, index);
	if (item.role === 'assistant' && isDuplicate && !isLast) {
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
	widget.paintInputDoc(editor, draft.doc, next => {
		draft.doc = next;
		widget.historyDrafts.set(item.id, draft);
	});
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
			}
		}, 100);
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'input', () => {
		draft.doc = widget.readInputDoc(editor);
		widget.historyDrafts.set(item.id, draft);
		editor.dataset.empty = inputDocIsEmpty(draft.doc) ? 'true' : 'false';
	}));
	widget.renderStore.add(DOM.addDisposableListener(editor, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			void widget.controller.submitEditedUser(index, widget.readInputDoc(editor), draft.images);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			editor.blur();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(box, 'click', () => editor.focus()));
	if (focused) {
		queueMicrotask(() => {
			editor.focus();
			widget.placeCaretAtEndOf(editor);
		});
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
			draft.doc = appendTriggerToDoc(widget.readInputDoc(editor), '@');
			widget.historyDrafts.set(item.id, draft);
			widget.paintInputDoc(editor, draft.doc, next => {
				draft.doc = next;
				widget.historyDrafts.set(item.id, draft);
			});
			editor.focus();
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
	const reader = new FileReader();
	reader.onload = () => {
		const url = String(reader.result ?? '');
		if (!url) {
			return;
		}
		const draft = widget.historyDrafts.get(historyId) ?? { doc: emptyInputDoc(), images: [] };
		draft.images = [...draft.images, url];
		widget.historyDrafts.set(historyId, draft);
		widget.render();
	};
	reader.readAsDataURL(file);
}

export function renderHistoryContextPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const items = item.contextItems ?? [];
	if (!items.length) {
		return;
	}
	const open = widget.contextPeekOpen.has(item.id);
	const peek = DOM.append(parent, DOM.$('.knox-gui-context-peek'));
	peek.setAttribute('data-testid', 'context-items-peek');
	const toggle = DOM.append(peek, DOM.$('button.knox-gui-context-peek-title')) as HTMLButtonElement;
	toggle.type = 'button';
	appendKnoxGuiSvg(toggle, open ? 'chevron-down' : 'chevron-right', 14);
	toggle.append(t(state, 'relatedContextItems', { count: items.length }));
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
		if (open) {
			widget.contextPeekOpen.delete(item.id);
		} else {
			widget.contextPeekOpen.add(item.id);
		}
		widget.render();
	}));
	if (!open) {
		return;
	}
	for (const ctx of items) {
		const row = DOM.append(peek, DOM.$('.knox-gui-chip.knox-gui-context-chip'));
		row.append(ctx.name);
	}
}

export function renderTurnLoading(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const row = DOM.append(parent, DOM.$('.knox-gui-turn-loading'));
	row.setAttribute('data-testid', 'knox-gui-turn-loading');
	const label = DOM.append(row, DOM.$('span.knox-gui-thinking-dots'));
	label.textContent = t(state, 'activityLoading');
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
	const content = assistantReplyText(item) ? item.content : '';
	if (!content) {
		return;
	}
	if (state.markdownFormatting === false) {
		DOM.append(card, DOM.$('pre.knox-gui-raw-md', undefined, content));
		return;
	}
	let fenceIndex = 0;
	for (const block of splitMarkdownBlocks(content)) {
		if (block.type === 'markdown') {
			if (block.text.trim()) {
				widget.appendMarkdown(card, block.text);
			}
			continue;
		}
		widget.renderCodeFence(card, state, item, block, fenceIndex, isLast && state.isStreaming && !block.closed);
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
			const byIndex = widget.root.querySelector(`[data-index="${step.historyIndex}"]`);
			byIndex?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			requestAnimationFrame(() => {
				const anchor = widget.root.ownerDocument.getElementById(activityAnchorId(step.id));
				(anchor ?? byIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

export function renderStreamError(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.streamError) {
		return;
	}
	const card = DOM.append(parent, DOM.$('.knox-gui-stream-error'));
	card.setAttribute('role', 'alert');
	card.setAttribute('data-testid', 'knox-gui-stream-error');
	const code = state.streamError.statusCode ? `${state.streamError.statusCode} ` : '';
	DOM.append(card, DOM.$('p.knox-gui-error', undefined, `${code}${t(state, 'error')}`));
	if (state.streamError.message) {
		DOM.append(card, DOM.$('pre', undefined, state.streamError.message));
	}
	if (state.streamError.kind === 'rate-limit') {
		DOM.append(card, DOM.$('div', undefined, t(state, 'rateLimited', { model: state.modelTitle ?? t(state, 'chatModel'), provider: t(state, 'theModelProvider') })));
	} else if (state.streamError.kind === 'not-found') {
		DOM.append(card, DOM.$('div', undefined, t(state, 'likelyCauses')));
		const list = DOM.append(card, DOM.$('ul.knox-gui-stream-error-list'));
		const api = DOM.append(list, DOM.$('li'));
		api.append(t(state, 'invalidApiBase'));
		DOM.append(api, DOM.$('code', undefined, 'apiBase'));
		const model = DOM.append(list, DOM.$('li'));
		model.append(t(state, 'modelNotFound'));
		if (state.modelTitle) {
			model.append(`: `);
			DOM.append(model, DOM.$('code', undefined, state.modelTitle));
		}
	} else if (state.streamError.kind === 'unauthorized') {
		DOM.append(card, DOM.$('div', undefined, t(state, 'refreshHubSecrets')));
		widget.chromeButton(card, { label: t(state, 'refreshAssistantSecrets'), onClick: () => widget.controller.messenger.post('config/refreshProfiles', undefined) });
		DOM.append(card, DOM.$('div', undefined, t(state, 'invalidApiKey')));
	} else if (state.streamError.kind === 'overloaded') {
		DOM.append(card, DOM.$('div', undefined, t(state, 'serverOverloaded')));
		if (state.modelTitle) {
			const provider = DOM.append(card, DOM.$('div'));
			provider.append(t(state, 'provider'));
			DOM.append(provider, DOM.$('code', undefined, state.modelTitle));
		}
	}
	const actions = DOM.append(card, DOM.$('.knox-gui-stream-error-actions'));
	widget.chromeButton(actions, { label: t(state, 'close'), onClick: () => widget.controller.clearStreamError() });
}

export function renderToolOutputPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
	const raw = item.toolCalls?.flatMap(call => call.outputItems ?? []) ?? [];
	const items = visibleToolOutputPeekItems(raw.length ? raw : (item.content.trim() ? [{ name: 'Tool', content: item.content }] : []));
	if (!items.length) {
		return;
	}
	const peek = DOM.append(parent, DOM.$('.knox-gui-context-peek'));
	peek.setAttribute('data-testid', 'knox-gui-tool-output');
	DOM.append(peek, DOM.$('div.knox-gui-context-peek-title', undefined, t(state, 'relatedContextItems', { count: items.length })));
	for (const output of items) {
		const row = DOM.append(peek, DOM.$('.knox-gui-chip.knox-gui-context-chip'));
		row.append(output.name || 'Tool');
	}
}
