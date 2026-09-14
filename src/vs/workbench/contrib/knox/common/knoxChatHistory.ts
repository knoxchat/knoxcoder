/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxChatHistoryItem, IKnoxToolCallState } from './knoxChatTypes.js';
import { primaryToolCallState } from './knoxMergeToolCalls.js';

export function getHistoryToolStates(
	item: IKnoxChatHistoryItem | undefined,
): IKnoxToolCallState[] {
	if (!item) {
		return [];
	}
	if (item.toolCallStates?.length) {
		return item.toolCallStates;
	}
	return item.toolCallState ? [item.toolCallState] : [];
}

export function findCurrentToolCall(
	history: readonly IKnoxChatHistoryItem[],
): IKnoxToolCallState | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const states = getHistoryToolStates(history[i]);
		if (states.length) {
			return primaryToolCallState(states);
		}
	}
	return undefined;
}

export function findToolCallStateById(
	history: readonly IKnoxChatHistoryItem[],
	toolCallId: string,
): IKnoxToolCallState | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const match = getHistoryToolStates(history[i]).find(state => state.toolCallId === toolCallId);
		if (match) {
			return match;
		}
	}
	return undefined;
}

export function findPendingGeneratedToolCalls(
	history: readonly IKnoxChatHistoryItem[],
): IKnoxToolCallState[] {
	for (let i = history.length - 1; i >= 0; i--) {
		const states = getHistoryToolStates(history[i]);
		if (states.length) {
			return states.filter(state => state.status === 'generated');
		}
	}
	return [];
}

export function hasUnsettledToolCalls(history: readonly IKnoxChatHistoryItem[]): boolean {
	for (let i = history.length - 1; i >= 0; i--) {
		const states = getHistoryToolStates(history[i]);
		if (states.length) {
			return states.some(
				state =>
					state.status === 'generating' ||
					state.status === 'generated' ||
					state.status === 'calling',
			);
		}
	}
	return false;
}

export function isUserStoppedToolCall(toolCallState: IKnoxToolCallState | undefined): boolean {
	return toolCallState?.status === 'canceled';
}

export function shouldAbortToolContinuation(toolCallState: IKnoxToolCallState | undefined): boolean {
	return !toolCallState || toolCallState.status !== 'calling';
}

export function isCancelledToolError(errorMessage: string | undefined): boolean {
	if (!errorMessage) {
		return false;
	}
	const msg = errorMessage.toLowerCase();
	return msg.includes('cancelled') || msg.includes('canceled') || msg.includes('aborted');
}

export function shouldResumeAfterUnexpectedAbort(
	toolCallState: IKnoxToolCallState | undefined,
	errorMessage: string | undefined,
): boolean {
	return isCancelledToolError(errorMessage) && toolCallState?.status === 'calling';
}
