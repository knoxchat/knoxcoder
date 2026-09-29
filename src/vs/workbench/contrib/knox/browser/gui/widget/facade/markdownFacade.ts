/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiChatFacade } from './chatFacade.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { IKnoxGuiPastFileInfo } from '../../../../common/knoxGuiTranscript.js';
import * as knoxGuiMarkdownView from '../markdown.js';

/** Markdown, code fences, reasoning blocks and response actions (`widget/markdown.ts`). */
export abstract class KnoxGuiMarkdownFacade extends KnoxGuiChatFacade {
	appendMarkdown(this: KnoxGuiWidget, parent: HTMLElement, source: string, store = this.renderStore, fileInfo?: IKnoxGuiPastFileInfo, streaming = false, target?: HTMLElement): void {
		knoxGuiMarkdownView.appendMarkdown(this, parent, source, store, fileInfo, streaming, target);
	}

	renderCodeFence(
		this: KnoxGuiWidget,
		parent: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		fence: { language: string; filepath?: string; range?: string; code: string; closed: boolean },
		fenceIndex: number,
		generating: boolean,
	): void {
		knoxGuiMarkdownView.renderCodeFence(this, parent, state, item, fence, fenceIndex, generating);
	}

	renderCodeLines(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, language: string, code: string, filepath: string | undefined, options: knoxGuiMarkdownView.IKnoxGuiCodeLinesOptions): HTMLElement {
		return knoxGuiMarkdownView.renderCodeLines(this, parent, state, language, code, filepath, options);
	}

	renderCodeFenceBlock(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: knoxGuiMarkdownView.IKnoxGuiFenceBlockOptions): void {
		knoxGuiMarkdownView.renderCodeFenceBlock(this, parent, state, options);
	}

	paintHighlightedCode(this: KnoxGuiWidget, pre: HTMLElement, language: string, code: string, filepath?: string, allowAuto?: boolean): void {
		knoxGuiMarkdownView.paintHighlightedCode(this, pre, language, code, filepath, allowAuto);
	}

	renderApplyActions(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, streamId: string, fence: { code: string; filepath?: string }): void {
		knoxGuiMarkdownView.renderApplyActions(this, parent, state, streamId, fence);
	}

	renderReasoning(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiMarkdownView.renderReasoning(this, parent, state, item, index);
	}

	patchLiveReasoning(this: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiMarkdownView.patchLiveReasoning(this, card, state, item, index);
	}

	toggleThinking(this: KnoxGuiWidget, item: IKnoxGuiHistoryItem, collapsed: boolean): void {
		knoxGuiMarkdownView.toggleThinking(this, item, collapsed);
	}

	renderThinkingPeekBlock(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, inProgress: boolean): void {
		knoxGuiMarkdownView.renderThinkingPeekBlock(this, parent, state, item, index, inProgress);
	}

	renderResponseActions(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, truncated: boolean): void {
		knoxGuiMarkdownView.renderResponseActions(this, parent, state, item, index, truncated);
	}
}
