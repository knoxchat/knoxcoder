/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord } from './helpers.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { knoxGuiStreamErrorFromState } from '../../../common/knoxGuiTranscript.js';
import { IKnoxGuiToolCall } from '../../../common/knoxGuiState.js';
import { IKnoxGuiStreamText, knoxGuiAccumulateChunk, knoxGuiChunkToolCalls, knoxGuiEmptyStreamText, knoxGuiFlushStreamText, knoxGuiHistoryToCoreHistory, knoxGuiShouldSplitForTools, knoxGuiToolFailureOutput, knoxGuiToolIsSettled, knoxGuiTurnDoomCalls } from '../../../common/knoxGuiAgentRequest.js';
import { knoxGuiT } from '../knoxGuiI18n.js';
import { finishTurn, hydrateLastAssistant, recordPromptLog, streamUpdate } from './stream.js';

/**
 * Shared loop (K-010). The host runs the whole turn on
 * `runAgentLoop` and reports `ChatTurnEvent`s (`knox/chatTurnEvent`); this
 * module only renders them into history and tool cards. Permission cards are
 * answered with `brain/resolveAutonomousTool`, like `/autonomous`.
 */
export interface IKnoxGuiSharedTurn {
	sessionId: string;
	/** Reply text of the assistant item that is currently streaming. */
	acc: IKnoxGuiStreamText;
	/** Tool calls of that item. */
	toolCalls: IKnoxGuiToolCall[];
	/** The turn stopped at ask_user; the answer starts the next turn. */
	awaitingUser: boolean;
	/** Calls waiting for the user's answer: the step result must not settle them. */
	askCallIds?: string[];
}

/** Calls that settle with a result instead of an error card (the model was told why). */
const KNOX_SHARED_SETTLED_ERRORS = new Set(['permission_denied', 'doom_loop']);

export function isSharedTurnActive(controller: KnoxGuiController): boolean {
	return controller.sharedTurn !== undefined;
}

/** Agent chat on the shared loop: Agent mode, tools supported, no legacy slash command. Everything else is a plain tool-free stream. */
export function sharedLoopEligible(controller: KnoxGuiController, legacySlash: boolean): boolean {
	const state = controller.store.state;
	return !legacySlash && state.mode === 'agent' && state.toolsSupported;
}

function newAssistantItem() {
	return { id: generateUuid(), role: 'assistant' as const, content: '', createdAt: new Date().toISOString() };
}

/** Starts one shared turn and resolves when the host finished it and every event was rendered. */
export async function runSharedTurn(controller: KnoxGuiController): Promise<void> {
	const state = controller.store.state;
	const turn: IKnoxGuiSharedTurn = { sessionId: state.sessionId, acc: knoxGuiEmptyStreamText(), toolCalls: [], awaitingUser: false };
	controller.sharedTurn = turn;
	const history = knoxGuiHistoryToCoreHistory(state.history);
	const lastUser = [...state.history].reverse().find(item => item.role === 'user');
	const injectedContext = controller.turnInject?.sessionId === state.sessionId ? controller.turnInject.content : undefined;
	try {
		await controller.messenger.request('knox/runChatTurn', {
			history,
			sessionId: state.sessionId,
			injectedContext,
			includeTools: true,
			toolSettings: state.toolSettings,
			excludedGroups: state.toolGroupExcluded,
			dropSearchWeb: (state.webSearchSupported && state.webSearchEnabled) || !state.selectedModelByRole.realTimeSearch,
			modelTitle: state.modelTitle,
			viewReadModelTitle: state.selectedModelByRole.viewRead ?? null,
			realTimeSearchModelTitle: state.selectedModelByRole.realTimeSearch ?? null,
			permissionMode: state.permissionMode,
			sessionAllowlist: state.sessionToolAllowlist,
			turnId: lastUser?.id ?? state.sessionId,
			turnToolCalls: knoxGuiTurnDoomCalls(state.history),
			priorSteps: state.toolLoopSteps,
			completionOptions: {
				...(state.reasoningEfforts.length && state.reasoningEffort ? { reasoningEffort: state.reasoningEffort } : {}),
				...(state.webSearchSupported ? { webSearch: state.webSearchEnabled } : {}),
			},
		});
		await controller.sharedTurnQueue;
	} catch (error) {
		await controller.sharedTurnQueue;
		controller.finishThinking();
		if (!controller.turnAborted) {
			controller.store.patch({ streamError: knoxGuiStreamErrorFromState(error, controller.store.state) });
		}
		controller.cancelInFlightTools();
	} finally {
		controller.sharedTurn = undefined;
	}
}

/** Events are rendered strictly in order, even when a handler awaits (hydrate, save). */
export function enqueueChatTurnEvent(controller: KnoxGuiController, data: unknown): void {
	controller.sharedTurnQueue = controller.sharedTurnQueue
		.then(() => applyChatTurnEvent(controller, data))
		.catch(() => undefined);
}

async function applyChatTurnEvent(controller: KnoxGuiController, data: unknown): Promise<void> {
	const rec = asRecord(data);
	const event = asRecord(rec?.event);
	const turn = controller.sharedTurn;
	if (!rec || !event || !turn || rec.sessionId !== turn.sessionId || controller.turnAborted) {
		return;
	}
	switch (event.type) {
		case 'chunk':
			return onChunk(controller, turn, event.chunk);
		case 'retry':
			return onRetry(controller, turn, event);
		case 'assistant':
			return onAssistant(controller, turn, event);
		case 'tool_ask':
			if (event.awaitsUser === true) {
				turn.awaitingUser = true;
				turn.askCallIds = [...(turn.askCallIds ?? []), String(event.callId)];
			}
			return;
		case 'tool_start':
			if (typeof event.callId === 'string' && controller.findTool(event.callId)?.status === 'generated') {
				controller.patchTool(event.callId, { status: 'calling' });
			}
			return;
		case 'tool_end':
			return onToolEnd(controller, event);
		case 'step':
			return onStep(controller, turn, event);
		case 'prompt_log':
			recordPromptLog(controller, event.log);
			return;
		case 'done':
			return onDone(controller, turn, event);
	}
}

function onChunk(controller: KnoxGuiController, turn: IKnoxGuiSharedTurn, chunk: unknown): void {
	if (controller.store.state.streamRetry) {
		controller.store.patch({ streamRetry: undefined });
	}
	const incoming = knoxGuiChunkToolCalls(chunk);
	knoxGuiAccumulateChunk(turn.acc, chunk);
	if (knoxGuiShouldSplitForTools(turn.acc, turn.toolCalls.length > 0, incoming.length)) {
		knoxGuiFlushStreamText(turn.acc);
		controller.streamCoalescer.enqueue(streamUpdate(turn.acc, []));
		controller.streamCoalescer.flush();
		controller.finishThinking();
		controller.store.appendHistory(newAssistantItem());
		turn.acc = knoxGuiEmptyStreamText();
	}
	controller.mergeToolCalls(turn.toolCalls, incoming);
	controller.streamCoalescer.enqueue(streamUpdate(turn.acc, turn.toolCalls));
}

/** A transient failure: the host restarts the round, so drop what the failed attempt streamed. */
function onRetry(controller: KnoxGuiController, turn: IKnoxGuiSharedTurn, event: Record<string, unknown>): void {
	const info = asRecord(event.retry);
	if (info && typeof info.attempt === 'number' && typeof info.maxAttempts === 'number') {
		controller.store.patch({ streamRetry: { attempt: info.attempt, maxAttempts: info.maxAttempts, usingFallback: info.usingFallback === true } });
	}
	turn.acc = knoxGuiEmptyStreamText();
	turn.toolCalls = [];
	controller.streamCoalescer.flush();
	controller.finishThinking();
	controller.store.updateLastAssistant('', []);
}

/** The round is final: strip leaked tool markup, then take ids, names and arguments from the loop. */
async function onAssistant(controller: KnoxGuiController, turn: IKnoxGuiSharedTurn, event: Record<string, unknown>): Promise<void> {
	knoxGuiFlushStreamText(turn.acc);
	controller.streamCoalescer.enqueue(streamUpdate(turn.acc, turn.toolCalls));
	controller.streamCoalescer.flush();
	await hydrateLastAssistant(controller, turn.acc, [], false);
	const parsed = Array.isArray(event.toolCalls) ? event.toolCalls : [];
	const calls: IKnoxGuiToolCall[] = [];
	parsed.forEach((raw, index) => {
		const call = asRecord(raw);
		const existing = turn.toolCalls[index];
		if (!call || typeof call.name !== 'string') {
			return;
		}
		const args = asRecord(call.args) ?? {};
		calls.push({
			...existing,
			id: typeof call.id === 'string' && call.id ? call.id : existing?.id ?? generateUuid(),
			name: call.name,
			arguments: typeof call.rawArguments === 'string' ? call.rawArguments : JSON.stringify(args),
			parsedArgs: args,
			status: 'generated',
		});
	});
	controller.finalizeGeneratingTools(calls);
	turn.toolCalls = calls;
	controller.store.updateLastAssistant(turn.acc.content, calls);
	controller.finishThinking();
}

function settleFromOutput(controller: KnoxGuiController, id: string, ok: boolean, output: unknown, error?: string): void {
	const call = controller.findTool(id);
	if (!call || knoxGuiToolIsSettled(call)) {
		return;
	}
	if (ok || (error !== undefined && KNOX_SHARED_SETTLED_ERRORS.has(error))) {
		const items = toolOutputItemsFromUnknown(output);
		controller.patchTool(id, { status: 'done', outputItems: items, output: toolOutputText(items, '') });
		return;
	}
	const items = toolOutputItemsFromUnknown(output);
	if (items.length) {
		controller.patchTool(id, { status: 'errored', outputItems: items, output: toolOutputText(items, '') });
		return;
	}
	const language = controller.store.state.language;
	const item = knoxGuiToolFailureOutput(call.name, error ?? '', {
		attemptsUsed: 1,
		name: knoxGuiT(language, 'toolCallErrorName'),
		description: knoxGuiT(language, 'toolCallFailed'),
	});
	controller.patchTool(id, { status: 'errored', outputItems: [item], output: item.content });
}

function onToolEnd(controller: KnoxGuiController, event: Record<string, unknown>): void {
	if (typeof event.callId === 'string') {
		settleFromOutput(controller, event.callId, event.ok === true, event.output, typeof event.error === 'string' ? event.error : undefined);
	}
}

/**
 * All results of the round are in. Denied, policy-blocked and doom-loop calls
 * never emit `tool_end`, so this settles whatever is still open, then opens
 * the next assistant item.
 */
async function onStep(controller: KnoxGuiController, turn: IKnoxGuiSharedTurn, event: Record<string, unknown>): Promise<void> {
	const step = asRecord(event.step);
	const calls = Array.isArray(step?.toolCalls) ? step.toolCalls : [];
	const results = Array.isArray(step?.results) ? step.results : [];
	calls.forEach((raw, index) => {
		const call = asRecord(raw);
		const result = asRecord(results[index]);
		if (call && result && typeof call.id === 'string' && !turn.askCallIds?.includes(call.id)) {
			settleFromOutput(controller, call.id, result.ok === true, result.output, typeof result.error === 'string' ? result.error : undefined);
		}
	});
	controller.finishThinking();
	controller.store.patch({ toolLoopSteps: controller.store.state.toolLoopSteps + 1 });
	controller.store.appendHistory(newAssistantItem());
	turn.acc = knoxGuiEmptyStreamText();
	turn.toolCalls = [];
	await controller.saveCurrentSession({ generateTitle: true });
}

async function onDone(controller: KnoxGuiController, turn: IKnoxGuiSharedTurn, event: Record<string, unknown>): Promise<void> {
	controller.store.patch({ streamRetry: undefined });
	controller.streamCoalescer.flush();
	controller.finishThinking();
	const history = controller.store.state.history;
	const last = history[history.length - 1];
	if (last?.role === 'assistant' && !last.content.trim() && !last.toolCalls?.length && !last.thinking) {
		controller.store.patch({ history: history.slice(0, -1) });
	}
	if (event.stoppedReason === 'error') {
		const summary = typeof event.summary === 'string' ? event.summary : '';
		controller.store.patch({ streamError: knoxGuiStreamErrorFromState(new Error(summary || 'Agent loop error'), controller.store.state) });
	}
	await controller.saveCurrentSession({ generateTitle: true });
	if (!turn.awaitingUser) {
		finishTurn(controller);
	}
}
