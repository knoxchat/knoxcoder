/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxChatMode } from './knoxChat.js';
import {
	buildKnoxAgentActivitySteps,
	IKnoxAgentActivityStep,
	knoxItemCreatedAtMs,
} from './knoxAgentActivity.js';
import { getHistoryToolStates } from './knoxChatHistory.js';
import {
	IKnoxChatHistoryItem,
	IKnoxToolCallState,
	knoxAssistantReplyText,
	messageHasVisibleContent,
	renderKnoxChatMessage,
} from './knoxChatTypes.js';
import { knoxVisibleToolOutputItems } from './knoxToolOutput.js';

export type KnoxThreadRowKind =
	| 'user'
	| 'assistant'
	| 'thinking'
	| 'tool'
	| 'timeline'
	| 'loading'
	| 'spacer';

export interface IKnoxThreadRow {
	readonly id: string;
	readonly kind: KnoxThreadRowKind;
	readonly historyIndex: number;
	measuredHeight: number | undefined;
	item?: IKnoxChatHistoryItem;
	isLast?: boolean;
	userIndex?: number;
	toolState?: IKnoxToolCallState;
	steps?: IKnoxAgentActivityStep[];
	startedAt?: number;
	timelineExpanded?: boolean;
}

export interface IKnoxThreadModelOptions {
	mode: KnoxChatMode;
	isStreaming: boolean;
	timelineExpanded?: ReadonlySet<number>;
}

const DEFAULT_HEIGHT: Record<KnoxThreadRowKind, number> = {
	user: 72,
	assistant: 88,
	thinking: 64,
	tool: 96,
	timeline: 52,
	loading: 32,
	spacer: 0,
};

export function knoxThreadRowHeight(row: IKnoxThreadRow): number {
	return row.measuredHeight ?? DEFAULT_HEIGHT[row.kind];
}

/** Same visible reply already shown on the previous assistant (skip thinking). */
export function isDuplicateKnoxAssistantReply(
	history: readonly IKnoxChatHistoryItem[],
	index: number,
): boolean {
	const item = history[index];
	if (item.message.role !== 'assistant') {
		return false;
	}
	const content = knoxAssistantReplyText(item);
	if (!content) {
		return false;
	}
	for (let i = index - 1; i >= 0; i--) {
		const prev = history[i];
		if (prev.message.role === 'thinking') {
			continue;
		}
		if (prev.message.role !== 'assistant') {
			return false;
		}
		return knoxAssistantReplyText(prev) === content;
	}
	return false;
}

export function knoxTurnHasVisibleProgress(
	history: readonly IKnoxChatHistoryItem[],
	userIndex: number,
): boolean {
	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.message.role === 'user') {
			break;
		}
		if (item.toolCallState || (item.toolCallStates?.length ?? 0) > 0) {
			return true;
		}
		if (item.message.role === 'thinking') {
			return true;
		}
		if (item.reasoning?.text?.trim()) {
			return true;
		}
		if (messageHasVisibleContent(item.message.content)) {
			return true;
		}
	}
	return false;
}

export function isLastKnoxUserInput(
	history: readonly IKnoxChatHistoryItem[],
	index: number,
): boolean {
	return !history.slice(index + 1).some(entry => entry.message.role === 'user');
}

export function knoxMessageHasReasoning(item: IKnoxChatHistoryItem): boolean {
	return !!item.reasoning?.text?.trim() || !!item.reasoning?.active;
}

export function knoxAssistantIsTruncated(item: IKnoxChatHistoryItem, isStreaming: boolean, isLast: boolean): boolean {
	if (isStreaming && isLast) {
		return false;
	}
	const content = renderKnoxChatMessage(item.message).trim();
	if (!content) {
		return false;
	}
	const endingPunctuation = ['.', '?', '!', '```', ':'];
	if (endingPunctuation.some(p => content.endsWith(p))) {
		return false;
	}
	if (/\p{Emoji}/u.test(content.slice(-2))) {
		return false;
	}
	return true;
}

function rowId(kind: KnoxThreadRowKind, key: string): string {
	return `${kind}:${key}`;
}

function historyKey(item: IKnoxChatHistoryItem, index: number): string {
	return item.message.id ?? item.messageId ?? String(index);
}

/**
 * Flatten session history into WorkbenchList rows matching `knox/gui` Chat.tsx:
 * user bubbles, completed-turn timelines, chat-mode loading, assistant/thinking
 * bodies, and native tool cards.
 */
export function buildKnoxThreadRows(
	history: readonly IKnoxChatHistoryItem[],
	options: IKnoxThreadModelOptions,
): IKnoxThreadRow[] {
	const rows: IKnoxThreadRow[] = [];
	const lastIndex = history.length - 1;

	for (let index = 0; index < history.length; index++) {
		const item = history[index];
		const duplicateReply = isDuplicateKnoxAssistantReply(history, index);
		const replyText = knoxAssistantReplyText(item);
		const showAssistantReply = !!replyText && !duplicateReply;
		const isLast = index === lastIndex;

		if (item.message.role === 'user') {
			rows.push({
				id: rowId('user', historyKey(item, index)),
				kind: 'user',
				historyIndex: index,
				measuredHeight: undefined,
				item,
				isLast,
			});

			const lastUser = isLastKnoxUserInput(history, index);
			if (options.mode === 'agent') {
				if (!lastUser) {
					const steps = buildKnoxAgentActivitySteps(history, index);
					if (steps.length) {
						rows.push({
							id: rowId('timeline', String(index)),
							kind: 'timeline',
							historyIndex: index,
							measuredHeight: undefined,
							userIndex: index,
							steps,
							timelineExpanded: options.timelineExpanded?.has(index) === true,
						});
					}
				}
			} else if (
				options.isStreaming &&
				lastUser &&
				!knoxTurnHasVisibleProgress(history, index)
			) {
				rows.push({
					id: rowId('loading', String(index)),
					kind: 'loading',
					historyIndex: index,
					measuredHeight: undefined,
					userIndex: index,
					startedAt: knoxItemCreatedAtMs(item),
				});
			}
			continue;
		}

		if (item.message.role === 'tool') {
			if (!knoxVisibleToolOutputItems(item.contextItems).length) {
				continue;
			}
			rows.push({
				id: rowId('tool', item.message.toolCallId ?? historyKey(item, index)),
				kind: 'tool',
				historyIndex: index,
				measuredHeight: undefined,
				item,
			});
			continue;
		}

		const toolStates = getHistoryToolStates(item);
		if (item.message.role === 'assistant' && item.message.toolCalls && toolStates.length) {
			if (showAssistantReply || knoxMessageHasReasoning(item)) {
				rows.push({
					id: rowId('assistant', historyKey(item, index)),
					kind: 'assistant',
					historyIndex: index,
					measuredHeight: undefined,
					item,
					isLast,
				});
			}
			for (const state of toolStates) {
				rows.push({
					id: rowId('tool', state.toolCallId || state.toolCall.id),
					kind: 'tool',
					historyIndex: index,
					measuredHeight: undefined,
					item,
					toolState: state,
				});
			}
			continue;
		}

		if (item.message.role === 'thinking') {
			rows.push({
				id: rowId('thinking', historyKey(item, index)),
				kind: 'thinking',
				historyIndex: index,
				measuredHeight: undefined,
				item,
				isLast,
			});
			continue;
		}

		if (duplicateReply) {
			continue;
		}

		rows.push({
			id: rowId('assistant', historyKey(item, index)),
			kind: 'assistant',
			historyIndex: index,
			measuredHeight: undefined,
			item,
			isLast,
		});
	}

	return rows;
}
