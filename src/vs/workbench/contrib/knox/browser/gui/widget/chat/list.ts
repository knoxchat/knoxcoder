/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { renderLoadingState } from '../panels.js';
import {
	groupHistoryTurns,
	lastUserHistoryIndex,
	resolveDisplayStart,
	shouldFloatLastUser,
	visibleTurnIndexes,
} from '../../../../common/knoxGuiChat.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	collectDuplicateAssistantMessageIds,
	assistantReplyText,
	isDuplicateAssistantReply,
	shouldShineSentFrame,
	turnHasVisibleProgress,
} from '../../../../common/knoxGuiTranscript.js';

export function renderChat(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (state.isLoadingHistory) {
		widget.historyLoadingStartedAt ??= Date.now();
		const loading = DOM.append(body, DOM.$('.knox-gui-history-loading'));
		loading.setAttribute('data-testid', 'chat-history-loading');
		renderLoadingState(widget, loading, {
			label: t(state, 'loadingConversation'),
			variant: 'drive',
			startedAt: widget.historyLoadingStartedAt,
			testId: 'sent-message-loading-state',
			ownClock: true,
		});
	} else {
		widget.historyLoadingStartedAt = undefined;
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
	const content = DOM.append(body, DOM.$('div'));
	content.setAttribute('data-testid', 'chat-scroll-content');
	if (displayStart > 0) {
		widget.chromeButton(content, {
			label: t(state, 'loadEarlierMessages', { count: displayStart }),
			testId: 'load-earlier-messages',
			extraClass: 'knox-gui-load-earlier',
			onClick: () => widget.loadEarlier(),
		});
	}
	// Chat.tsx: the ErrorBoundary wraps only the list; the loading row, large-session banner and spacer stay outside it.
	if (widget.chatListFailed) {
		content.replaceChildren();
		widget.renderChatListError(content, state);
		return;
	}
	try {
		const list = DOM.append(content, DOM.$('.knox-gui-history'));
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
		content.replaceChildren();
		widget.renderChatListError(content, state, error);
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
		const doomName = t(state, 'doomLoopName');
		const isDoomBlock = item.toolCalls?.some(call => call.outputItems?.some(out => out.name === doomName));
		if (isDoomBlock && index === state.history.length - 1 && !state.isStreaming) {
			const banner = DOM.append(body, DOM.$('.knox-gui-large-banner'));
			banner.setAttribute('role', 'status');
			banner.setAttribute('data-testid', 'change-strategy-banner');
			DOM.append(banner, DOM.$('span', undefined, t(state, 'doomLoopDescription')));
			widget.chromeButton(banner, {
				label: t(state, 'changeStrategy'),
				testId: 'change-strategy',
				onClick: () => { void widget.controller.submit(t(state, 'changeStrategyPrompt')); },
			});
		}
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
	if (item.role === 'assistant' && isDuplicate) {
		// HistoryItemRow.tsx: a duplicate reply never repeats its text (even on the last row), but a row with tool calls still
		// mounts Reasoning (`item.reasoning && !showAssistantReply`) and its tools. Without tool calls the row renders nothing.
		if (item.toolCalls?.length) {
			widget.renderReasoning(body, state, item, index);
			for (const tool of item.toolCalls) {
				widget.renderTool(body, state, tool);
			}
		}
		return;
	}
	if (item.role === 'assistant' && !assistantReplyText(item) && !(isLast && state.isStreaming) && !item.thinking && !item.toolCalls?.length && !item.error) {
		return;
	}
	widget.renderAssistantTurn(body, state, item, highlight, currentHit, index, isLast);
}
