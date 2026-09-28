/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { scheduleTranscriptStick } from '../chrome.js';
import { patchLiveTool, toolStreamFingerprint } from '../tools.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	activityAnchorId,
	assistantReplyText,
	isResponseTruncated,
	shouldShowThinkingIndicator,
} from '../../../../common/knoxGuiTranscript.js';
import { pastFileInfoFor, renderStreamingMarkdownInto } from './stream.js';

export function patchLastAssistant(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const card = widget.lastAssistantCard;
	const item = state.history[state.history.length - 1];
	if (!card || !item) {
		widget.render();
		return;
	}
	const index = state.history.length - 1;
	widget.patchLiveReasoning(card, state, item, index);
	if (!patchStreamingTools(widget, card, state, item)) {
		widget.render();
		return;
	}
	let body = card.querySelector('.knox-gui-stream-body') as HTMLElement | null;
	if (!body && assistantReplyText(item)) {
		body = DOM.$('.knox-gui-stream-body.styled-markdown-preview');
		body.setAttribute('data-testid', 'streaming-markdown');
		body.setAttribute('data-streaming', 'true');
		const reasoning = card.querySelector('.knox-gui-reasoning');
		if (reasoning?.nextSibling) {
			card.insertBefore(body, reasoning.nextSibling);
		} else if (reasoning) {
			card.appendChild(body);
		} else {
			card.insertBefore(body, card.firstChild);
		}
	}
	if (body) {
		if (state.isStreaming) {
			body.setAttribute('data-streaming', 'true');
		} else {
			body.removeAttribute('data-streaming');
		}
		widget.renderStreamingAssistantBody(body, state, item);
	} else if (assistantReplyText(item)) {
		widget.render();
		return;
	}
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
	const nextRole = state.history[index + 1]?.role;
	const hideActionSpace = nextRole === 'assistant' || nextRole === 'thinking';
	const hideActions = hideActionSpace || state.isStreaming;
	const actions = card.querySelector('.knox-gui-msg-actions') as HTMLElement | null;
	if (hideActionSpace) {
		actions?.remove();
	} else if (hideActions) {
		if (!actions) {
			DOM.append(card, DOM.$('.knox-gui-msg-actions.knox-gui-msg-actions-slot'));
		}
	} else if (!actions || actions.classList.contains('knox-gui-msg-actions-slot')) {
		actions?.remove();
		widget.renderResponseActions(card, state, item, index, isResponseTruncated(item.content, false));
	}
	if (widget.autoScrollEnabled) {
		scheduleTranscriptStick(widget);
	}
}

function patchStreamingTools(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): boolean {
	const tools = item.toolCalls ?? [];
	const wrap = card.parentElement;
	if (!wrap) {
		return !tools.length;
	}
	const existing = Array.from(wrap.querySelectorAll(':scope > [data-testid="knox-gui-tool"]')) as HTMLElement[];
	if (!tools.length) {
		return existing.length === 0;
	}
	if (existing.length > tools.length) {
		return false;
	}
	for (let i = 0; i < existing.length; i++) {
		if (existing[i].id !== activityAnchorId(`tool:${tools[i].id}`)) {
			return false;
		}
	}
	const previous = widget.listenerStore;
	try {
		for (let i = 0; i < existing.length; i++) {
			const fingerprint = toolStreamFingerprint(tools[i]);
			if (existing[i].dataset.stream === fingerprint) {
				continue;
			}
			let store = widget.toolPatchStores.get(tools[i].id);
			if (!store) {
				store = widget.toolPatchStore.add(new DisposableStore());
				widget.toolPatchStores.set(tools[i].id, store);
			}
			widget.listenerStore = store;
			if (patchLiveTool(widget, existing[i], state, tools[i])) {
				continue;
			}
			store.clear();
			const host = DOM.$('div');
			widget.renderTool(host, state, tools[i]);
			const next = host.firstElementChild as HTMLElement | null;
			if (next) {
				existing[i].replaceWith(next);
			}
		}
		for (let i = existing.length; i < tools.length; i++) {
			let store = widget.toolPatchStores.get(tools[i].id);
			if (!store) {
				store = widget.toolPatchStore.add(new DisposableStore());
				widget.toolPatchStores.set(tools[i].id, store);
			}
			widget.listenerStore = store;
			widget.renderTool(wrap, state, tools[i]);
		}
	} finally {
		widget.listenerStore = previous;
	}
	return true;
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
	if (item.toolCalls?.length && !assistantReplyText(item) && !(isLast && state.isStreaming)) {
		if (isLast) {
			widget.lastAssistantCard = card;
		}
		for (const tool of item.toolCalls) {
			widget.renderTool(body, state, tool);
		}
		return;
	}
	const streamBody = DOM.append(card, DOM.$('.knox-gui-stream-body.styled-markdown-preview'));
	streamBody.setAttribute('data-testid', 'streaming-markdown');
	if (isLast && state.isStreaming) {
		streamBody.setAttribute('data-streaming', 'true');
	}
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
		widget.renderTool(body, state, tool);
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
	const content = assistantReplyText(item);
	if (!content && !(isLast && state.isStreaming)) {
		return;
	}
	if (state.markdownFormatting === false) {
		if (item.images?.length) {
			const thumbs = DOM.append(card, DOM.$('.knox-gui-thumbs'));
			thumbs.setAttribute('data-testid', 'knox-gui-image-thumbs');
			for (const [imageIndex, url] of item.images.entries()) {
				widget.renderThumb(thumbs, state, url, `assistant-${imageIndex}`, t(state, 'historicalImageAlt', { index: imageIndex + 1 }), () => undefined);
			}
		}
		let raw = card.querySelector('pre.knox-gui-raw-md');
		if (!raw) {
			raw = DOM.append(card, DOM.$('pre.knox-gui-raw-md', undefined, content));
		} else if (raw.textContent !== content) {
			raw.textContent = content;
		}
		return;
	}
	const streaming = isLast && state.isStreaming;
	if (isLast) {
		renderStreamingMarkdownInto(widget, card, widget.streamBlocks, widget.streamPatchStore, state, item, content, {
			streaming,
			streamPrefix: item.id,
			fileInfo: pastFileInfoFor(state, item),
		});
		return;
	}
	renderStreamingMarkdownInto(widget, card, [], widget.listenerStore, state, item, content, {
		streaming: false,
		streamPrefix: item.id,
		fileInfo: pastFileInfoFor(state, item),
	});
}
