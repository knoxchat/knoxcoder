/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { KNOX_DEFAULT_CHAT_MODE, KNOX_NEW_CHAT_TITLE } from './knoxChat.js';
import {
	findCurrentToolCall,
	findToolCallStateById,
	getHistoryToolStates,
} from './knoxChatHistory.js';
import { capContextItems } from './knoxDisplayCap.js';
import {
	getMessageToolCalls,
	IKnoxApplyState,
	IKnoxChatHistoryItem,
	IKnoxChatMessage,
	IKnoxChatSessionState,
	IKnoxContextItem,
	IKnoxInjectedMemoryItem,
	IKnoxLastCompaction,
	IKnoxPromptLog,
	IKnoxSession,
	IKnoxToolCallDelta,
	KNOX_IDLE_AUTONOMOUS_LOOP,
	messageHasVisibleContent,
	renderKnoxChatMessage,
	writeAssistantContent,
} from './knoxChatTypes.js';
import {
	mergeToolCallDeltas,
	primaryToolCallState,
	syncToolCallStatesFromDeltas,
} from './knoxMergeToolCalls.js';

export function createEmptySessionState(): IKnoxChatSessionState {
	return {
		history: [],
		isStreaming: false,
		title: KNOX_NEW_CHAT_TITLE,
		id: generateUuid(),
		streamAborter: new AbortController(),
		mode: KNOX_DEFAULT_CHAT_MODE,
		symbols: {},
		applyStates: [],
		applyCurIndex: 0,
		curCheckpointIndex: 0,
		injectedMemories: [],
		lastCompaction: null,
		toolLoopSteps: 0,
		sessionToolAllowlist: [],
		autonomousLoop: { ...KNOX_IDLE_AUTONOMOUS_LOOP },
		allSessionMetadata: [],
	};
}

function findLastHistoryIndex(
	history: IKnoxChatHistoryItem[],
	predicate: (item: IKnoxChatHistoryItem) => boolean,
): number {
	for (let i = history.length - 1; i >= 0; i--) {
		if (predicate(history[i])) {
			return i;
		}
	}
	return -1;
}

function cancelUnsettledToolCalls(history: IKnoxChatHistoryItem[]): void {
	for (const item of history) {
		const toolStates = getHistoryToolStates(item);
		if (!toolStates.length) {
			continue;
		}
		let changed = false;
		for (const toolCallState of toolStates) {
			if (toolCallState.status !== 'done' && toolCallState.status !== 'canceled') {
				toolCallState.status = 'canceled';
				changed = true;
			}
		}
		if (changed) {
			item.toolCallStates = toolStates;
			item.toolCallState = primaryToolCallState(toolStates);
		}
	}
}

function attachToolCalls(item: IKnoxChatHistoryItem, deltas: IKnoxToolCallDelta[]): void {
	if (item.message.role === 'assistant') {
		item.message.toolCalls = deltas;
	}
	item.toolCallStates = syncToolCallStatesFromDeltas(
		deltas,
		item.toolCallStates ?? (item.toolCallState ? [item.toolCallState] : undefined),
	);
	item.toolCallState = primaryToolCallState(item.toolCallStates);
}

export function applyAbortStream(state: IKnoxChatSessionState): void {
	state.streamAborter.abort();
	state.streamAborter = new AbortController();
}

export function applyNewSession(state: IKnoxChatSessionState, session?: IKnoxSession): void {
	state.lastSessionId = state.id;
	applyAbortStream(state);
	state.isStreaming = false;
	state.symbols = {};
	state.injectedMemories = [];
	state.lastCompaction = null;
	state.toolLoopSteps = 0;
	state.sessionToolAllowlist = [];
	state.autonomousLoop = { ...KNOX_IDLE_AUTONOMOUS_LOOP };
	state.applyStates = [];
	state.applyCurIndex = 0;
	state.mainEditorContentTrigger = undefined;

	if (session) {
		state.history = session.history.slice();
		state.title = session.title;
		state.id = session.sessionId;
		state.curCheckpointIndex = 0;
	} else {
		state.history = [];
		state.title = KNOX_NEW_CHAT_TITLE;
		state.id = generateUuid();
		state.curCheckpointIndex = 0;
	}
}

export function applyClearDanglingMessages(state: IKnoxChatSessionState): void {
	cancelUnsettledToolCalls(state.history);

	if (state.history.length < 2) {
		return;
	}

	const lastUserOrToolIdx = findLastHistoryIndex(
		state.history,
		item => item.message.role === 'tool' || item.message.role === 'user',
	);
	if (lastUserOrToolIdx === -1) {
		return;
	}

	let validAssistantMessageIdx = -1;
	for (let i = state.history.length - 1; i > lastUserOrToolIdx; i--) {
		const item = state.history[i];
		const toolStates = getHistoryToolStates(item);
		const hasGeneratedTool = toolStates.some(toolState => toolState.status !== 'generating');
		if (messageHasVisibleContent(item.message.content) || hasGeneratedTool) {
			validAssistantMessageIdx = i;
			for (const toolCallState of toolStates) {
				if (toolCallState.status !== 'done' && toolCallState.status !== 'canceled') {
					toolCallState.status = 'canceled';
				}
			}
			item.toolCallStates = toolStates.length ? toolStates : undefined;
			item.toolCallState = primaryToolCallState(toolStates);
			break;
		}
	}

	if (validAssistantMessageIdx === -1) {
		const lastMsg = state.history[lastUserOrToolIdx];
		if (lastMsg.message.role === 'user') {
			state.mainEditorContentTrigger = lastMsg.editorState;
			state.history = state.history.slice(0, lastUserOrToolIdx);
		} else {
			state.history = state.history.slice(0, lastUserOrToolIdx + 1);
		}
	} else {
		state.history = state.history.slice(0, validAssistantMessageIdx + 1);
	}
}

export function applySubmitEditorAndInitAtIndex(
	state: IKnoxChatSessionState,
	index: number,
	editorState?: unknown,
): void {
	if (state.history.length && index < state.history.length) {
		const historyItem = state.history[index];
		historyItem.message.content = '';
		historyItem.editorState = editorState;
		historyItem.contextItems = [];
		if (!historyItem.checkpoint) {
			historyItem.checkpoint = {};
		}

		const assistantTimestamp = new Date().toISOString();
		state.history = state.history.slice(0, index + 1).concat({
			message: {
				id: generateUuid(),
				role: 'assistant',
				content: '',
				createdAt: assistantTimestamp,
			},
			contextItems: [],
		});
		state.curCheckpointIndex = index;
	} else {
		const userTimestamp = new Date().toISOString();
		const assistantTimestamp = new Date().toISOString();
		const userIndex = state.history.length;
		state.history = state.history.concat([
			{
				message: {
					id: generateUuid(),
					role: 'user',
					content: '',
					createdAt: userTimestamp,
				},
				contextItems: [],
				editorState,
				checkpoint: {},
			},
			{
				message: {
					id: generateUuid(),
					role: 'assistant',
					content: '',
					createdAt: assistantTimestamp,
				},
				contextItems: [],
			},
		]);
		state.curCheckpointIndex = userIndex;
	}
	state.isStreaming = true;
}

/**
 * GUI `sessionSlice.deleteMessage`: remove the assistant at `index` and the
 * previous user turn (`splice(index - 1, 2)`).
 */
export function applyDeleteMessage(state: IKnoxChatSessionState, index: number): void {
	if (index < 0 || index >= state.history.length) {
		return;
	}
	if (index >= 1) {
		state.history.splice(index - 1, 2);
	} else {
		state.history.splice(0, 1);
	}
}

export function applyStreamUpdate(state: IKnoxChatSessionState, messages: IKnoxChatMessage[]): void {
	if (!state.history.length) {
		return;
	}

	for (const message of messages) {
		const lastItem = state.history[state.history.length - 1];
		const lastMessage = lastItem.message;

		if (message.role === 'thinking' && message.redactedThinking) {
			state.history.push({
				message: {
					role: 'thinking',
					content: 'internal reasoning is hidden due to safety reasons',
					redactedThinking: message.redactedThinking,
					id: generateUuid(),
				},
				contextItems: [],
			});
			continue;
		}

		if (lastItem.reasoning?.active && message.role === 'assistant' && message.toolCalls?.length) {
			lastItem.reasoning.active = false;
			lastItem.reasoning.endAt = Date.now();
		}

		const lastIsEmptyPlaceholder =
			!getMessageToolCalls(lastMessage)?.length && !lastMessage.content && !lastItem.reasoning;
		const lastHasTools = !!getMessageToolCalls(lastMessage)?.length;
		const incomingHasTools = !!getMessageToolCalls(message)?.length;
		if (lastIsEmptyPlaceholder && lastMessage.role === 'assistant' && incomingHasTools) {
			if (message.content) {
				writeAssistantContent(lastMessage, renderKnoxChatMessage(message));
			}
			const historyItem: IKnoxChatHistoryItem = {
				message: {
					...message,
					content: '',
					id: generateUuid(),
					createdAt: new Date().toISOString(),
				},
				contextItems: [],
			};
			attachToolCalls(historyItem, mergeToolCallDeltas([], message.toolCalls ?? []));
			state.history.push(historyItem);
			continue;
		}
		const splittingForTools =
			lastMessage.role === 'assistant' &&
			message.role === 'assistant' &&
			!lastIsEmptyPlaceholder &&
			!lastHasTools &&
			incomingHasTools;

		if (lastMessage.role !== message.role || splittingForTools) {
			if (splittingForTools) {
				const extra = renderKnoxChatMessage(message);
				if (extra) {
					writeAssistantContent(lastMessage, extra);
				}
			}
			const historyItem: IKnoxChatHistoryItem = {
				message: {
					...message,
					content: splittingForTools ? '' : renderKnoxChatMessage(message),
					id: generateUuid(),
					createdAt: new Date().toISOString(),
				},
				contextItems: [],
			};
			if (message.role === 'assistant' && message.toolCalls?.length) {
				attachToolCalls(historyItem, mergeToolCallDeltas([], message.toolCalls));
			}
			state.history.push(historyItem);
		} else if ((message as IKnoxChatMessage).reasoning) {
			const reasoningContent = message.reasoning ?? '';
			if (!lastItem.reasoning) {
				lastItem.reasoning = {
					startAt: Date.now(),
					active: true,
					text: reasoningContent,
				};
			} else if (lastItem.reasoning.active) {
				lastItem.reasoning.text += reasoningContent;
			}
			if (message.content) {
				const messageContent = renderKnoxChatMessage(message);
				if (lastItem.reasoning?.active) {
					lastItem.reasoning.active = false;
					lastItem.reasoning.endAt = Date.now();
				}
				writeAssistantContent(lastMessage, messageContent);
			}
		} else if (message.content) {
			const messageContent = renderKnoxChatMessage(message);
			if (messageContent.includes('<think>')) {
				lastItem.reasoning = {
					startAt: Date.now(),
					active: true,
					text: messageContent.replace('<think>', '').trim(),
				};
			} else if (lastItem.reasoning?.active && messageContent.includes('</think>')) {
				const [reasoningEnd, answerStart] = messageContent.split('</think>');
				lastItem.reasoning.text += reasoningEnd.trimEnd();
				lastItem.reasoning.active = false;
				lastItem.reasoning.endAt = Date.now();
				writeAssistantContent(lastMessage, (answerStart ?? '').trimStart());
			} else if (lastItem.reasoning?.active) {
				if (!messageContent.includes('<think>') && !messageContent.includes('</think>')) {
					lastItem.reasoning.active = false;
					lastItem.reasoning.endAt = Date.now();
					writeAssistantContent(lastMessage, messageContent);
				} else {
					lastItem.reasoning.text += messageContent;
				}
			} else {
				writeAssistantContent(lastMessage, messageContent);
			}
		} else if (message.role === 'thinking' && message.signature) {
			if (lastMessage.role === 'thinking') {
				lastMessage.signature = message.signature;
			}
		} else if (
			message.role === 'assistant' &&
			message.toolCalls?.length &&
			lastMessage.role === 'assistant'
		) {
			attachToolCalls(lastItem, mergeToolCallDeltas(lastMessage.toolCalls ?? [], message.toolCalls));
		}
	}
}

export function applyHydrateLastAssistant(state: IKnoxChatSessionState, assistant: IKnoxChatMessage): void {
	if (assistant.role !== 'assistant') {
		return;
	}
	for (let i = state.history.length - 1; i >= 0; i--) {
		const item = state.history[i];
		if (item.message.role !== 'assistant') {
			continue;
		}
		const prev = i > 0 ? state.history[i - 1] : undefined;
		const contentItem =
			assistant.toolCalls?.length &&
			prev?.message.role === 'assistant' &&
			!getMessageToolCalls(prev.message)?.length
				? prev
				: item;
		if (typeof assistant.content === 'string') {
			if (contentItem !== item) {
				if (assistant.content) {
					contentItem.message.content = assistant.content;
				}
				item.message.content = '';
			} else {
				item.message.content = assistant.content;
			}
		}
		if (assistant.toolCalls?.length) {
			attachToolCalls(item, mergeToolCallDeltas([], assistant.toolCalls));
		}
		break;
	}
}

export function applyUpdateHistoryItemAtIndex(
	state: IKnoxChatSessionState,
	index: number,
	updates: Partial<IKnoxChatHistoryItem> & { message?: Partial<IKnoxChatMessage> },
): void {
	if (index !== 0 && !state.history[index]) {
		return;
	}
	const existing = state.history[index];
	if (!existing) {
		return;
	}
	state.history[index] = {
		...existing,
		...updates,
		message: updates.message ? { ...existing.message, ...updates.message } : existing.message,
	};
}

export function applyAddContextItemsAtIndex(
	state: IKnoxChatSessionState,
	index: number,
	contextItems: IKnoxContextItem[],
): void {
	const historyItem = state.history[index];
	if (!historyItem) {
		return;
	}
	historyItem.contextItems = [...historyItem.contextItems, ...contextItems];
}

export function applySetIsGatheringContext(state: IKnoxChatSessionState, value: boolean): void {
	const curMessage = state.history.at(-1);
	if (curMessage) {
		curMessage.isGatheringContext = value;
	}
}

export function applySetInactive(state: IKnoxChatSessionState): void {
	applySetIsGatheringContext(state, false);
	state.isStreaming = false;
}

export function applyUpdateApplyState(state: IKnoxChatSessionState, payload: IKnoxApplyState): void {
	const applyState = state.applyStates.find(item => item.streamId === payload.streamId);
	if (!applyState) {
		state.applyStates.push({ ...payload });
	} else {
		applyState.status = payload.status ?? applyState.status;
		applyState.numDiffs = payload.numDiffs ?? applyState.numDiffs;
		applyState.filepath = payload.filepath ?? applyState.filepath;
		applyState.fileContent = payload.fileContent ?? applyState.fileContent;
	}
	if (payload.status === 'done') {
		state.applyCurIndex += 1;
	}
}

export function applySetToolGenerated(state: IKnoxChatSessionState): void {
	for (let i = state.history.length - 1; i >= 0; i--) {
		const item = state.history[i];
		const states = getHistoryToolStates(item);
		if (!states.length) {
			continue;
		}
		for (const toolCallState of states) {
			if (toolCallState.status === 'generating') {
				toolCallState.status = 'generated';
			}
		}
		item.toolCallStates = states;
		item.toolCallState = primaryToolCallState(states);
		break;
	}
}

export function applySetToolCallOutput(
	state: IKnoxChatSessionState,
	payload: IKnoxContextItem[] | { toolCallId?: string; output: IKnoxContextItem[] },
): void {
	const output = Array.isArray(payload) ? payload : payload.output;
	const toolCallId = Array.isArray(payload) ? undefined : payload.toolCallId;
	const toolCallState = toolCallId
		? findToolCallStateById(state.history, toolCallId)
		: findCurrentToolCall(state.history);
	if (!toolCallState) {
		return;
	}
	if (toolCallState.status === 'done' || toolCallState.status === 'canceled') {
		return;
	}
	toolCallState.output = capContextItems(output);
}

export function applySetToolStatus(
	state: IKnoxChatSessionState,
	status: 'calling' | 'done' | 'canceled',
	toolCallId?: string,
): void {
	const toolCallState = toolCallId
		? findToolCallStateById(state.history, toolCallId)
		: findCurrentToolCall(state.history);
	if (!toolCallState) {
		return;
	}
	toolCallState.status = status;
}

export function applyAddPromptCompletionPair(state: IKnoxChatSessionState, logs: IKnoxPromptLog[]): void {
	if (!state.history.length) {
		return;
	}
	const lastMessage = state.history[state.history.length - 1];
	lastMessage.promptLogs = lastMessage.promptLogs ? lastMessage.promptLogs.concat(logs) : logs;
}

export function applyAddSessionToolAllowlist(state: IKnoxChatSessionState, name: string): void {
	if (!state.sessionToolAllowlist.includes(name)) {
		state.sessionToolAllowlist.push(name);
	}
}

export function applyRemoveSessionToolAllowlist(state: IKnoxChatSessionState, name: string): void {
	state.sessionToolAllowlist = state.sessionToolAllowlist.filter(allowed => allowed !== name);
}

export function applySetLastInjectedMemories(
	state: IKnoxChatSessionState,
	items: IKnoxInjectedMemoryItem[],
): void {
	state.injectedMemories = items;
}

export function applyUpdateInjectedMemoryPinned(
	state: IKnoxChatSessionState,
	id: number,
	pinned: boolean,
): void {
	state.injectedMemories = state.injectedMemories.map(item =>
		item.id === id ? { ...item, pinned } : item,
	);
}

export function applyRemoveInjectedMemory(state: IKnoxChatSessionState, id: number): void {
	state.injectedMemories = state.injectedMemories.filter(item => item.id !== id);
}

export function knoxPendingApplyStates(states: readonly IKnoxApplyState[]): IKnoxApplyState[] {
	return states.filter(state => state.status === 'done');
}

export function applySetLastCompaction(
	state: IKnoxChatSessionState,
	payload: IKnoxLastCompaction | null,
): void {
	state.lastCompaction = payload;
}

export function applyApplyAutonomousEvent(
	state: IKnoxChatSessionState,
	type: string,
	data: Record<string, unknown>,
): void {
	if (typeof data.session_id === 'string' && data.session_id && data.session_id !== state.id) {
		return;
	}

	if (type === 'autonomous:tool_start' || type === 'autonomous:tool_ask') {
		const name = typeof data.name === 'string' ? data.name : '';
		const callId =
			typeof data.call_id === 'string' && data.call_id ? data.call_id : `${name}-${Date.now()}`;
		const args =
			data.args && typeof data.args === 'object' && !Array.isArray(data.args)
				? (data.args as Record<string, unknown>)
				: {};
		const last = state.history[state.history.length - 1];
		if (!last || last.message.role !== 'assistant') {
			return;
		}
		const existing = findToolCallStateById(state.history, callId);
		if (existing) {
			existing.status = type === 'autonomous:tool_ask' ? 'generated' : 'calling';
			last.toolCallState = primaryToolCallState(last.toolCallStates);
			return;
		}
		const deltas = mergeToolCallDeltas(last.message.toolCalls ?? [], [
			{
				id: callId,
				type: 'function',
				function: { name, arguments: JSON.stringify(args) },
			},
		]);
		attachToolCalls(last, deltas);
		const started = findToolCallStateById(state.history, callId);
		if (started) {
			started.status = type === 'autonomous:tool_ask' ? 'generated' : 'calling';
		}
		last.toolCallState = primaryToolCallState(last.toolCallStates);
		return;
	}

	if (type === 'autonomous:tool_end') {
		const callId = typeof data.call_id === 'string' ? data.call_id : '';
		const toolCallState = callId
			? findToolCallStateById(state.history, callId)
			: findCurrentToolCall(state.history);
		if (!toolCallState) {
			return;
		}
		const output = Array.isArray(data.output) ? (data.output as IKnoxContextItem[]) : [];
		toolCallState.output = output;
		toolCallState.status = data.ok === false ? 'canceled' : 'done';
		const last = state.history[state.history.length - 1];
		if (last) {
			last.toolCallState = primaryToolCallState(last.toolCallStates);
		}
		state.toolLoopSteps += 1;
		return;
	}

	if (type === 'autonomous:started') {
		state.autonomousLoop = {
			status: 'running',
			iteration: 0,
			maxIterations: typeof data.max_iterations === 'number' ? data.max_iterations : 0,
			goal: typeof data.goal === 'string' ? data.goal : undefined,
			startedAt: Date.now(),
		};
		return;
	}

	if (type === 'autonomous:iteration') {
		const iteration =
			typeof data.iteration === 'number' ? data.iteration : state.autonomousLoop.iteration;
		const maxIterations =
			typeof data.max_iterations === 'number'
				? data.max_iterations
				: state.autonomousLoop.maxIterations;
		state.autonomousLoop = {
			...state.autonomousLoop,
			status: 'running',
			iteration,
			maxIterations,
			startedAt: state.autonomousLoop.startedAt ?? Date.now(),
		};
		return;
	}

	if (type === 'autonomous:completed') {
		state.autonomousLoop = {
			...state.autonomousLoop,
			status: 'completed',
			iteration:
				typeof data.iterations === 'number' ? data.iterations : state.autonomousLoop.iteration,
		};
		return;
	}

	if (type === 'autonomous:cancelled') {
		state.autonomousLoop = {
			...state.autonomousLoop,
			status: 'cancelled',
			iteration:
				typeof data.iteration === 'number' ? data.iteration : state.autonomousLoop.iteration,
		};
		return;
	}

	if (type === 'autonomous:assistant') {
		const last = state.history[state.history.length - 1];
		if (!last || last.message.role !== 'assistant') {
			return;
		}
		const chunk = typeof data.content === 'string' ? data.content : '';
		if (!chunk.trim()) {
			return;
		}
		const current = typeof last.message.content === 'string' ? last.message.content : '';
		if (current.includes(chunk.trim())) {
			return;
		}
		last.message.content = current ? `${current}${chunk}` : chunk;
	}
}

export { mergeAssistantText } from './knoxChatTypes.js';
