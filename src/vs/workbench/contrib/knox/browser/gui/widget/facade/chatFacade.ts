/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiControlsFacade } from './controlsFacade.js';
import { IKnoxGuiInputBlock } from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiContextItem, IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { IKnoxGuiActivityStep } from '../../../../common/knoxGuiTranscript.js';
import * as knoxGuiChatView from '../chat.js';

/** Transcript rendering: turns, rows, streaming bodies, context peeks (`widget/chat/`). */
export abstract class KnoxGuiChatFacade extends KnoxGuiControlsFacade {
	patchLastAssistant(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiChatView.patchLastAssistant(this, state);
	}

	renderStreamingAssistantBody(this: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderStreamingAssistantBody(this, card, state, item);
	}

	renderStreamingReasoningBody(this: KnoxGuiWidget, content: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, thinking: string): void {
		knoxGuiChatView.renderStreamingReasoningBody(this, content, state, item, thinking);
	}

	renderChat(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChatView.renderChat(this, body, state);
	}

	renderChatListError(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, error?: unknown): void {
		knoxGuiChatView.renderChatListError(this, body, state, error);
	}

	renderHistoryRow(
		this: KnoxGuiWidget,
		parent: HTMLElement,
		state: IKnoxGuiState,
		index: number,
		highlight: boolean,
		currentHit: boolean,
		lastUserIndex: number,
		duplicateIds: Set<string>,
	): void {
		knoxGuiChatView.renderHistoryRow(this, parent, state, index, highlight, currentHit, lastUserIndex, duplicateIds);
	}

	renderRowError(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, error?: unknown): void {
		knoxGuiChatView.renderRowError(this, parent, state, item, error);
	}

	renderMessage(
		this: KnoxGuiWidget,
		body: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		highlight: boolean,
		currentHit: boolean,
		index: number,
		lastUserIndex: number,
		duplicateIds: Set<string>,
	): void {
		knoxGuiChatView.renderMessage(this, body, state, item, highlight, currentHit, index, lastUserIndex, duplicateIds);
	}

	renderUserTurn(
		this: KnoxGuiWidget,
		body: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		highlight: boolean,
		currentHit: boolean,
		index: number,
		isLastUser: boolean,
	): void {
		knoxGuiChatView.renderUserTurn(this, body, state, item, highlight, currentHit, index, isLastUser);
	}

	historyDraftFor(this: KnoxGuiWidget, item: IKnoxGuiHistoryItem): { doc: IKnoxGuiInputBlock[]; images: string[] } {
		return knoxGuiChatView.historyDraftFor(this, item);
	}

	renderHistoricalEditor(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiChatView.renderHistoricalEditor(this, parent, state, item, index);
	}

	readImageFileIntoDraft(this: KnoxGuiWidget, file: File, historyId: string): void {
		knoxGuiChatView.readImageFileIntoDraft(this, file, historyId);
	}

	renderHistoryContextPeek(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderHistoryContextPeek(this, parent, state, item);
	}

	renderContextItemsPeek(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, key: string, items: readonly IKnoxGuiContextItem[], gathering: boolean): void {
		knoxGuiChatView.renderContextItemsPeek(this, parent, state, key, items, gathering);
	}

	renderContextPeekItem(this: KnoxGuiWidget, parent: HTMLElement, ctx: IKnoxGuiContextItem): HTMLElement {
		return knoxGuiChatView.renderContextPeekItem(this, parent, ctx);
	}

	renderTurnLoading(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item?: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderTurnLoading(this, parent, state, item);
	}

	renderAssistantTurn(
		this: KnoxGuiWidget,
		body: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		highlight: boolean,
		currentHit: boolean,
		index: number,
		isLast: boolean,
	): void {
		knoxGuiChatView.renderAssistantTurn(this, body, state, item, highlight, currentHit, index, isLast);
	}

	renderErrorStep(this: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiChatView.renderErrorStep(this, card, state, item, index);
	}

	renderAssistantBody(this: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, isLast: boolean): void {
		knoxGuiChatView.renderAssistantBody(this, card, state, item, isLast);
	}

	renderActivityTimeline(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, userIndex: number): void {
		knoxGuiChatView.renderActivityTimeline(this, parent, state, userIndex);
	}

	renderActivitySteps(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, steps: IKnoxGuiActivityStep[]): void {
		knoxGuiChatView.renderActivitySteps(this, parent, state, steps);
	}

	renderStreamError(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChatView.renderStreamError(this, parent, state);
	}

	renderToolOutputPeek(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderToolOutputPeek(this, parent, state, item);
	}
}
