/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { patchLiveCodeFence, patchLiveMarkdown } from '../markdown.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	assistantReplyText,
	fenceApplyStreamId,
	healStreamingMarkdown,
	IKnoxGuiMarkdownFenceBlock,
	IKnoxGuiPastFileInfo,
	knoxGuiPastFileInfo,
	splitMarkdownBlocks,
	splitMarkdownParagraphs,
} from '../../../../common/knoxGuiTranscript.js';

export function pastFileInfoFor(state: IKnoxGuiState, item: IKnoxGuiHistoryItem): IKnoxGuiPastFileInfo {
	const index = state.history.findIndex(h => h.id === item.id);
	return knoxGuiPastFileInfo(state.history, index < 0 ? state.history.length : index, state.fileSymbols);
}

export type IKnoxGuiStreamCacheBlock = { key: string; nodes: ChildNode[]; store: DisposableStore; payload: string };

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
				segments.push({ key: `md:${segments.length}`, type: 'markdown', text });
			}
			continue;
		}
		const generating = isStreaming && fenceIndex === lastFence && !block.closed;
		segments.push({ key: `fence:${fenceIndex}`, type: 'fence', fence: block, fenceIndex, generating });
		fenceIndex += 1;
	}
	const last = segments[segments.length - 1];
	if (isStreaming && last?.type === 'markdown') {
		last.text = healStreamingMarkdown(last.text);
	}
	return segments;
}

function streamPayload(segment: StreamSegment): string {
	return segment.type === 'markdown' ? segment.text : `${segment.generating ? 1 : 0}\0${segment.fence.code}`;
}

/**
 * The live reply body. Leading blocks whose source is unchanged keep their DOM
 * (selection, inner scroll, listeners); the rest re-render into their own stores.
 */
export function renderStreamingAssistantBody(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, streaming = state.isStreaming): void {
	renderStreamingMarkdownInto(widget, body, widget.streamBlocks, widget.streamPatchStore, state, item, assistantReplyText(item), {
		streaming,
		streamPrefix: item.id,
		fileInfo: pastFileInfoFor(state, item),
	});
}

/** Same streamdown split + live patch used by reasoning (`Reasoning.tsx` memoized markdown). */
export function renderStreamingReasoningBody(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, thinking: string): void {
	renderStreamingMarkdownInto(widget, body, widget.reasoningBlocks, widget.reasoningContentStore, state, item, thinking, {
		streaming: Boolean(item.thinkingActive),
		streamPrefix: `${item.id}:reasoning`,
		fileInfo: knoxGuiPastFileInfo(state.history, 0, state.fileSymbols),
	});
}

export function renderStreamingMarkdownInto(
	widget: KnoxGuiWidget,
	body: HTMLElement,
	cache: IKnoxGuiStreamCacheBlock[],
	patchStore: DisposableStore,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	content: string,
	options: { streaming: boolean; streamPrefix: string; fileInfo: IKnoxGuiPastFileInfo },
): void {
	const segments = content && state.markdownFormatting !== false ? streamSegments(content, options.streaming) : [];
	const anchor = body.querySelector('[data-testid="stream-anchor"]');
	let keep = 0;
	while (keep < cache.length && keep < segments.length && cache[keep].key === segments[keep].key && cache[keep].nodes.every(node => node.parentNode === body)) {
		keep += 1;
	}
	for (const stale of cache.splice(keep)) {
		patchStore.delete(stale.store);
	}
	const kept = new Set(cache.flatMap(block => block.nodes));
	for (const child of Array.from(body.childNodes)) {
		if (child === anchor || kept.has(child)) {
			continue;
		}
		child.remove();
	}
	if (!content) {
		if (options.streaming) {
			appendStreamAnchor(body);
		}
		return;
	}
	if (state.markdownFormatting === false) {
		let raw = body.querySelector('pre.knox-gui-raw-md');
		if (!raw) {
			raw = DOM.append(body, DOM.$('pre.knox-gui-raw-md', undefined, content));
		} else if (raw.textContent !== content) {
			raw.textContent = content;
		}
		if (options.streaming) {
			appendStreamAnchor(body);
		}
		return;
	}
	if (keep > 0) {
		const live = options.streaming && keep === segments.length;
		refreshLiveStreamBlock(widget, body, state, item, cache[keep - 1], segments[keep - 1], options.fileInfo, options.streamPrefix, live, patchStore);
	}
	for (let i = keep; i < segments.length; i++) {
		const store = patchStore.add(new DisposableStore());
		widget.listenerStore = store;
		try {
			const live = options.streaming && i === segments.length - 1;
			const nodes = appendStreamSegment(widget, body, state, item, segments[i], options.fileInfo, options.streamPrefix, live);
			cache.push({ key: segments[i].key, nodes, store, payload: streamPayload(segments[i]) });
		} finally {
			widget.listenerStore = widget.renderStore;
		}
	}
	if (options.streaming) {
		appendStreamAnchor(body);
	} else {
		body.querySelector('[data-testid="stream-anchor"]')?.remove();
	}
}

function appendStreamSegment(
	widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	_item: IKnoxGuiHistoryItem,
	segment: StreamSegment,
	fileInfo: IKnoxGuiPastFileInfo,
	streamPrefix: string,
	liveMarkdown: boolean,
): ChildNode[] {
	const anchor = body.querySelector('[data-testid="stream-anchor"]');
	const before = Array.from(body.childNodes);
	if (segment.type === 'markdown') {
		widget.appendMarkdown(body, segment.text, widget.listenerStore, fileInfo, liveMarkdown);
	} else {
		widget.renderCodeFenceBlock(body, state, {
			streamId: fenceApplyStreamId(streamPrefix, segment.fenceIndex),
			fence: segment.fence,
			generating: segment.generating,
			anchor: 'end',
		});
	}
	const nodes = Array.from(body.childNodes).filter(node => !before.includes(node) && node !== anchor);
	if (anchor) {
		for (const node of nodes) {
			body.insertBefore(node, anchor);
		}
	}
	return nodes;
}

function refreshLiveStreamBlock(
	widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	cached: IKnoxGuiStreamCacheBlock,
	segment: StreamSegment,
	fileInfo: IKnoxGuiPastFileInfo,
	streamPrefix: string,
	live: boolean,
	patchStore: DisposableStore,
): void {
	if (cached.payload === streamPayload(segment)) {
		return;
	}
	const previous = widget.listenerStore;
	widget.listenerStore = cached.store;
	try {
		if (segment.type === 'markdown' && cached.nodes.length === 1 && patchLiveMarkdown(widget, cached.nodes[0], segment.text, cached.store, fileInfo, live)) {
			cached.payload = streamPayload(segment);
			return;
		}
		if (segment.type === 'fence' && patchLiveCodeFence(widget, cached.nodes, state, item, segment.fence, segment.fenceIndex, segment.generating, fenceApplyStreamId(streamPrefix, segment.fenceIndex))) {
			cached.payload = streamPayload(segment);
			return;
		}
	} finally {
		widget.listenerStore = previous;
	}
	patchStore.delete(cached.store);
	const store = patchStore.add(new DisposableStore());
	for (const node of cached.nodes) {
		node.remove();
	}
	widget.listenerStore = store;
	try {
		cached.store = store;
		cached.nodes = appendStreamSegment(widget, body, state, item, segment, fileInfo, streamPrefix, live && segment.type === 'markdown');
		cached.payload = streamPayload(segment);
	} finally {
		widget.listenerStore = widget.renderStore;
	}
}

function appendStreamAnchor(body: HTMLElement): void {
	if (body.querySelector('[data-testid="stream-anchor"]')) {
		return;
	}
	const anchor = DOM.append(body, DOM.$('.knox-gui-stream-anchor'));
	anchor.setAttribute('data-testid', 'stream-anchor');
	anchor.setAttribute('aria-hidden', 'true');
}

/** `MarkdownBlock.tsx`: while streaming only the last fence of the reply is generating. */
function lastFenceIndex(blocks: ReturnType<typeof splitMarkdownBlocks>): number {
	return blocks.filter(block => block.type !== 'markdown').length - 1;
}
