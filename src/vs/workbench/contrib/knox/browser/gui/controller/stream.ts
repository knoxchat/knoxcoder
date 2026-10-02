/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { MEMORY_BUILD_TIMEOUT_MS, asRecord, asArray, contextItemFromRaw, textFromUnknown, withTimeout } from './helpers.js';
import { timeout } from '../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { expandPromptSlashCommand, isPromptBasedSlashCommand, parseLeadingSlash } from '../../../common/knoxGuiChat.js';
import { collectLatestTaskPlanSnapshot, parseInjectedMemories } from '../../../common/knoxGuiPanels.js';
import { toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { knoxGuiMissingSymbolUris, knoxGuiParseSymbolMap, nextCodeBlockToApply, parseStreamError, pendingApplyStates } from '../../../common/knoxGuiTranscript.js';
import { extractMentionsFromDoc, extractSlashFromDoc, inputDocFromPlainText, inputDocToPlainText, knoxGuiPendingToolBlocksSubmit, knoxGuiShouldBlockSubmit, mentionContextProviderName, resolveComposerSlashCommand, slashCommandBareName, submitUsesActiveFile, useActiveFileFromDefaultContext } from '../../../common/knoxGuiInput.js';
import { editSendPromptPayload, knoxGuiMultifileEditPrompt, shouldSendEditPrompt } from '../../../common/knoxGuiEdit.js';
import { IKnoxGuiContextItem, IKnoxGuiHistoryItem, IKnoxGuiToolCall } from '../../../common/knoxGuiState.js';
import { IKnoxCoreChatHistoryItem, IKnoxCoreChatMessage, IKnoxGuiStreamText, knoxGuiAccumulateChunk, knoxGuiChunkToolCalls, knoxGuiDoomCall, knoxGuiEmptyStreamText, knoxGuiFlushStreamText, knoxGuiShouldSplitForTools, knoxGuiFallbackMessages, knoxGuiFormatTurnInject, knoxGuiHistoryToCoreHistory, knoxGuiMemoryGoal, knoxGuiIsCancelledToolError, knoxGuiIsRetryableToolError, knoxGuiShouldContinueTurn, knoxGuiToolFailureOutput, knoxGuiToolIsSettled, knoxGuiToolPreferredModel, knoxGuiToolRetryDelay, KNOX_TOOL_CALL_MAX_RETRIES, knoxGuiTurnDoomCalls, knoxGuiTurnMessages, knoxGuiTurnTools } from '../../../common/knoxGuiAgentRequest.js';
import { knoxGuiT } from '../knoxGuiI18n.js';


/** Core `llm/streamChat` legacySlashCommandData: built-ins with a `run()` (commit, share, http, …). */
interface IKnoxGuiLegacySlash {
	command: { name: string; description: string };
	/** Full user text, slash included (`getSlashCommandForInput`). */
	input: string;
	historyIndex: number;
	contextItems: IKnoxCoreChatHistoryItem['contextItems'];
	selectedCode: Array<{ filepath: string; range?: unknown }>;
}

export async function submit(controller: KnoxGuiController, starterPrompt?: string, modifiers?: { noContext?: boolean; altKey?: boolean; index?: number; doc?: ReturnType<typeof inputDocFromPlainText>; images?: string[] }): Promise<void> {
	const resubmitting = typeof modifiers?.index === 'number';
	if (resubmitting && (controller.store.state.isStreaming || knoxGuiPendingToolBlocksSubmit({
		isStreaming: false,
		history: controller.store.state.history,
	}))) {
		controller.cancel();
	}
	const doc = modifiers?.doc ?? (starterPrompt ? inputDocFromPlainText(starterPrompt) : controller.store.state.inputDoc);
	const images = starterPrompt ? [] : (modifiers?.images ?? [
		...controller.store.state.images.map(image => image.imageUrl),
		...controller.store.state.historicalImages,
	].filter((url, index, all) => all.indexOf(url) === index));
	const blockState = {
		...controller.store.state,
		input: starterPrompt ?? inputDocToPlainText(doc),
		images: images.map(imageUrl => ({ name: 'image', imageUrl })),
		resubmitting,
	};
	if (knoxGuiShouldBlockSubmit(blockState)) {
		return;
	}
	let text = inputDocToPlainText(doc).trim();
	const slashName = extractSlashFromDoc(doc) ?? parseLeadingSlash(text)?.name;
	const slashRest = slashName ? (parseLeadingSlash(text)?.rest ?? text.replace(new RegExp(`^/${slashName}\\s*`), '')) : '';
	let legacySlash: IKnoxGuiLegacySlash['command'] | undefined;
	let autonomousGoal: string | undefined;
	if (slashName) { // KN-374: KN-304 builtins + YAML / .prompt expansion
		const command = resolveComposerSlashCommand(slashName, controller.store.state.slashCommands);
		if (command && isPromptBasedSlashCommand(command) && command.prompt) {
			text = expandPromptSlashCommand(command.prompt, slashRest);
		} else if (command && slashCommandBareName(command.name) === 'autonomous') {
			autonomousGoal = slashRest.trim();
		} else if (command) {
			legacySlash = { name: command.name, description: command.description };
		}
	}
	const useActive = useActiveFileFromDefaultContext(controller.store.state.defaultContext);
	const noContext = modifiers?.noContext ?? !submitUsesActiveFile(useActive, Boolean(modifiers?.altKey));
	if (shouldSendEditPrompt(controller.store.state)) {
		controller.store.patch({ isGatheringContext: true });
		const gathered = await controller.gatherContext(doc, text, true);
		const prompt = [...gathered.items.map(item => item.content), text].filter(Boolean).join('\n\n');
		const code = controller.store.state.codeToEdit[0];
		controller.messenger.post('edit/sendPrompt', editSendPromptPayload(prompt, code, controller.store.state.modelTitle ?? ''));
		controller.store.setInput('');
		controller.store.patch({
			images: [],
			historicalImages: [],
			editingUserIndex: undefined,
			isGatheringContext: false,
			autoScroll: true,
			editStatus: 'streaming',
			editPreviousInputs: [...controller.store.state.editPreviousInputs, prompt],
		});
		controller.closeSuggest();
		return;
	}
	const userItem: IKnoxGuiHistoryItem = {
		id: generateUuid(),
		role: 'user',
		content: text,
		images: images.length ? images : undefined,
		inputDoc: doc,
		contextItems: controller.store.state.contextItems.length ? [...controller.store.state.contextItems] : undefined,
		promptPreamble: controller.store.state.mode === 'edit' ? knoxGuiMultifileEditPrompt(controller.store.state.codeToEdit) : undefined,
		createdAt: new Date().toISOString(),
	};
	const editing = modifiers?.index ?? controller.store.state.editingUserIndex;
	if (typeof editing === 'number' && editing >= 0) {
		controller.store.patch({ history: controller.store.state.history.slice(0, editing).concat(userItem) });
	} else {
		controller.store.appendHistory(userItem);
		controller.store.setInput('');
		controller.store.patch({ images: [], historicalImages: [] });
	}
	controller.store.patch({ editingUserIndex: undefined, autoScroll: true, isGatheringContext: true, streamError: undefined, toolLoopSteps: 0 });
	controller.closeSuggest();
	controller.ensureSessionId();
	if (!controller.store.state.sessionTitle) {
		const title = controller.sessionTitleFallback();
		controller.store.patch({ sessionTitle: title });
		controller.store.syncSessionTab(controller.store.state.sessionId, title);
	}
	controller.turnAborted = false;
	controller.turnInject = undefined;
	controller.store.setStreaming(true);
	controller.store.appendHistory({ id: generateUuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() });
	try {
		const gathered = await controller.gatherContext(doc, text, noContext);
		if (gathered.items.length) {
			controller.patchHistoryItem(userItem.id, { contextItems: gathered.items });
		}
		const memoryTimeout = await startTurn(controller, text);
		if (autonomousGoal !== undefined) {
			controller.store.patch({ isGatheringContext: false });
			if (!controller.turnAborted) {
				await runAutonomous(controller, autonomousGoal);
			}
			return;
		}
		const memory = await controller.injectMemoryContext(text, memoryTimeout);
		const inject = knoxGuiFormatTurnInject(memory, controller.takeRestoreNotice());
		controller.turnInject = inject ? { sessionId: controller.store.state.sessionId, content: inject } : undefined;
		controller.store.patch({ isGatheringContext: false });
		if (!controller.turnAborted) {
			await runRound(controller, legacySlash && {
				command: legacySlash,
				input: text,
				historyIndex: controller.store.state.history.findIndex(item => item.id === userItem.id),
				contextItems: knoxGuiHistoryToCoreHistory([{ ...userItem, contextItems: gathered.items }])[0]?.contextItems ?? [],
				selectedCode: controller.store.state.codeToEdit.map(code => ({ filepath: code.filepath, range: code.range })),
			});
		}
	} finally {
		controller.store.setStreaming(false);
		controller.store.patch({ isGatheringContext: false });
		void controller.refreshGitDiff(true);
		if (controller.store.state.worktree.enabled) {
			void controller.runWorktree('status');
		}
	}
}

/** `streamResponse.ts` trackSession + user recordMessage; returns the memory build timeout. */
async function startTurn(controller: KnoxGuiController, userMessage: string): Promise<number> {
	try {
		const result = await withTimeout(controller.messenger.request<{ memoryBuildTimeoutMs?: number }>('knox/startTurn', {
			sessionId: controller.store.state.sessionId,
			title: controller.store.state.sessionTitle ?? '',
			userMessage,
		}), MEMORY_BUILD_TIMEOUT_MS);
		if (typeof result?.memoryBuildTimeoutMs === 'number') {
			return result.memoryBuildTimeoutMs;
		}
	} catch {
		// memory tracking is best-effort
	}
	return MEMORY_BUILD_TIMEOUT_MS;
}

/**
 * `startAutonomousLoop.ts`: core runs the loop; tool and text events arrive as
 * `brain/memoryEvent` and land in the trailing assistant item. The final result
 * is appended unless the streamed text already contains it.
 */
async function runAutonomous(controller: KnoxGuiController, goal: string): Promise<void> {
	const language = controller.store.state.language;
	if (!goal) {
		controller.store.patch({ streamError: parseStreamError(new Error('Usage: /autonomous <goal description>')) });
		return;
	}
	const state = controller.store.state;
	controller.store.patch({ autonomous: { iteration: 0, status: 'running', max: 0, goal } });
	let result: { final_result?: string; iterations?: number; cancelled?: boolean } | undefined;
	const settle = (cancelled: boolean) => {
		const loop = controller.store.state.autonomous;
		if (loop?.status === 'running') {
			const iteration = typeof result?.iterations === 'number' ? result.iterations : loop.iteration;
			controller.store.patch({ autonomous: { ...loop, iteration, status: cancelled ? 'cancelled' : 'completed' } });
		}
	};
	try {
		result = await controller.messenger.request<{ final_result?: string; iterations?: number; cancelled?: boolean }>('brain/runAutonomousLoop', {
			sessionId: state.sessionId,
			goal,
			modelTitle: state.modelTitle,
			permissionMode: state.permissionMode,
			toolSettings: state.toolSettings,
			sessionAllowlist: state.sessionToolAllowlist,
		});
	} catch (error) {
		settle(true);
		if (!controller.turnAborted) {
			const message = error instanceof Error && error.message ? error.message : knoxGuiT(language, 'autonomousLoopFailed');
			controller.store.patch({ streamError: parseStreamError(new Error(message)) });
		}
		return;
	}
	settle(Boolean(result?.cancelled) || controller.turnAborted);
	if (controller.turnAborted) {
		return;
	}
	const summary = result?.final_result || knoxGuiT(language, 'autonomousLoopCompleted');
	const history = controller.store.state.history.slice();
	const index = history.length - 1;
	const last = history[index];
	if (last?.role === 'assistant' && !last.content.includes(summary.trim())) {
		history[index] = { ...last, content: last.content ? `${last.content}\n\n${summary}` : summary };
		controller.store.patch({ history });
	}
	await controller.saveCurrentSession({ generateTitle: true });
	finishTurn(controller);
}

export function isAutonomousRunning(controller: KnoxGuiController): boolean {
	return controller.store.state.autonomous?.status === 'running';
}

/** `PermissionActionButtons.tsx`: while `/autonomous` runs, core owns the pending call. */
export function resolveAutonomousTool(controller: KnoxGuiController, id: string, allow: boolean, always?: boolean): void {
	controller.messenger.post('brain/resolveAutonomousTool', { sessionId: controller.store.state.sessionId, callId: id, allow, always });
}

/** `streamThunkWrapper.tsx` outermost exit: assistant recordMessage + post-turn memory. */
function finishTurn(controller: KnoxGuiController): void {
	const history = controller.store.state.history;
	controller.messenger.post('knox/finishTurn', {
		sessionId: controller.store.state.sessionId,
		title: controller.store.state.sessionTitle ?? '',
		...knoxGuiTurnMessages(history),
		turnTools: knoxGuiTurnTools(history),
	});
}

/**
 * Messages and tools come from the host (`constructMessages`, system injects,
 * `selectAgentTools`, max steps, doom loop). A host without the handler gets a
 * flat transcript and no tools.
 */
async function buildAgentRequest(controller: KnoxGuiController): Promise<{ messages: IKnoxCoreChatMessage[]; tools: unknown[] }> {
	const state = controller.store.state;
	const history = knoxGuiHistoryToCoreHistory(state.history);
	const injectedContext = controller.turnInject?.sessionId === state.sessionId ? controller.turnInject.content : undefined;
	try {
		const result = await controller.messenger.request<{ messages?: IKnoxCoreChatMessage[]; tools?: unknown[] }>('knox/buildAgentRequest', {
			history,
			sessionId: state.sessionId,
			injectedContext,
			// Candidate tools. Jev may drop them in llm/streamChat for view_read/clarify.
			includeTools: state.mode === 'agent' && state.toolsSupported,
			toolSettings: state.toolSettings,
			excludedGroups: state.toolGroupExcluded,
			dropSearchWeb: (state.webSearchSupported && state.webSearchEnabled) || !state.selectedModelByRole.realTimeSearch,
			toolLoopSteps: state.toolLoopSteps,
			turnToolCalls: knoxGuiTurnDoomCalls(state.history),
		});
		if (Array.isArray(result?.messages)) {
			return { messages: result.messages, tools: Array.isArray(result.tools) ? result.tools : [] };
		}
	} catch {
		// fall through to the local transcript
	}
	return { messages: knoxGuiFallbackMessages(history, injectedContext), tools: [] };
}

function streamUpdate(acc: IKnoxGuiStreamText, toolCalls: IKnoxGuiToolCall[]) {
	return {
		content: acc.content,
		toolCalls: toolCalls.slice(),
		thinking: acc.thinking || undefined,
		thinkingMeta: {
			active: acc.inThinkTag || (!acc.content && !toolCalls.length),
			redactedThinking: acc.redactedThinking,
			thinkingSignature: acc.thinkingSignature,
		},
	};
}

async function streamRound(controller: KnoxGuiController, token: CancellationToken, legacySlash?: IKnoxGuiLegacySlash): Promise<IKnoxGuiToolCall[]> {
	const request = await buildAgentRequest(controller);
	const state = controller.store.state;
	let acc = knoxGuiEmptyStreamText();
	const toolCalls: IKnoxGuiToolCall[] = [];
	const stream = controller.messenger.streamRequest<Record<string, unknown>>('llm/streamChat', {
		messages: request.messages,
		title: state.modelTitle,
		legacySlashCommandData: legacySlash,
		completionOptions: {
			...(request.tools.length ? { tools: request.tools } : {}),
			...(state.reasoningEfforts.length && state.reasoningEffort ? { reasoningEffort: state.reasoningEffort } : {}),
			...(state.webSearchSupported ? { webSearch: state.webSearchEnabled } : {}),
		},
	}, token);
	let next = await stream.next();
	while (!next.done) {
		for (const chunk of next.value) {
			const incoming = knoxGuiChunkToolCalls(chunk);
			knoxGuiAccumulateChunk(acc, chunk);
			if (knoxGuiShouldSplitForTools(acc, toolCalls.length > 0, incoming.length)) {
				knoxGuiFlushStreamText(acc);
				controller.streamCoalescer.enqueue(streamUpdate(acc, []));
				controller.streamCoalescer.flush();
				controller.finishThinking();
				controller.store.appendHistory({ id: generateUuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() });
				acc = knoxGuiEmptyStreamText();
			}
			controller.mergeToolCalls(toolCalls, incoming);
			controller.streamCoalescer.enqueue(streamUpdate(acc, toolCalls));
		}
		next = await stream.next();
	}
	knoxGuiFlushStreamText(acc);
	controller.streamCoalescer.enqueue(streamUpdate(acc, toolCalls));
	controller.streamCoalescer.flush();
	await hydrateLastAssistant(controller, acc, toolCalls, request.tools.length > 0);
	controller.finalizeGeneratingTools(toolCalls);
	controller.store.updateLastAssistant(acc.content, toolCalls);
	controller.finishThinking();
	recordPromptLog(controller, next.value);
	return toolCalls;
}

/**
 * `hydrateLastAssistant` + `recoverTextToolCalls`: leaked DSML/XML tool
 * markup is stripped from the reply. Host `hydrateAssistantTextToolCalls`
 * promotes parsed calls when existing streamed calls have no names.
 */
async function hydrateLastAssistant(controller: KnoxGuiController, acc: IKnoxGuiStreamText, toolCalls: IKnoxGuiToolCall[], allowTools: boolean): Promise<void> {
	if (!acc.content.includes('<')) {
		return;
	}
	try {
		const result = await controller.messenger.request<{ content?: string; toolCalls?: unknown[] }>('knox/hydrateAssistant', {
			content: acc.content,
			toolCalls: toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
		});
		if (typeof result?.content !== 'string') {
			return;
		}
		acc.content = result.content;
		if (allowTools && Array.isArray(result.toolCalls) && result.toolCalls.length) {
			const named = toolCalls.filter(call => call.name);
			if (!named.length) {
				toolCalls.length = 0;
				controller.mergeToolCalls(toolCalls, result.toolCalls);
			}
		}
	} catch {
		// host without the handler keeps the streamed text
	}
}

/** `runGuiAgentLoop.ts` onPromptLog: keep the log on the reply; chat mode also sends `devdata/log`. */
function recordPromptLog(controller: KnoxGuiController, value: unknown): void {
	const log = asRecord(value);
	if (!log || (typeof log.prompt !== 'string' && typeof log.completion !== 'string')) {
		return;
	}
	const state = controller.store.state;
	const entry = {
		modelTitle: typeof log.modelTitle === 'string' ? log.modelTitle : state.modelTitle,
		prompt: typeof log.prompt === 'string' ? log.prompt : undefined,
		completion: typeof log.completion === 'string' ? log.completion : undefined,
	};
	const history = state.history.slice();
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'assistant') {
			history[i] = { ...history[i], promptLogs: [...(history[i].promptLogs ?? []), entry] };
			controller.store.patch({ history });
			break;
		}
	}
	if (state.mode === 'chat') {
		const model = state.models.find(item => item.title === state.modelTitle);
		controller.messenger.post('devdata/log', {
			name: 'chatInteraction',
			data: {
				prompt: entry.prompt,
				completion: entry.completion,
				modelProvider: model?.provider,
				modelTitle: state.modelTitle,
				sessionId: state.sessionId,
			},
		});
	}
}

/**
 * One model round. Tool calls are resolved (auto-approved ones run now) and
 * the turn continues once every call has a result; otherwise it waits for the
 * user. A round without tool calls ends the turn.
 */
async function runRound(controller: KnoxGuiController, legacySlash?: IKnoxGuiLegacySlash): Promise<void> {
	controller.streamCancel?.dispose();
	const cancel = new CancellationTokenSource();
	controller.streamCancel = cancel;
	try {
		const toolCalls = await streamRound(controller, cancel.token, legacySlash);
		if (controller.turnAborted) {
			return;
		}
		if (toolCalls.length) {
			await controller.resolveTools(toolCalls);
			await controller.saveCurrentSession({ generateTitle: true });
			await controller.maybeContinueTurn();
			return;
		}
		await controller.ensureCheckpointForLastAssistant();
		await controller.saveCurrentSession({ generateTitle: true });
		finishTurn(controller);
	} catch (error) {
		controller.finishThinking();
		if (!controller.turnAborted) {
			controller.store.patch({ streamError: parseStreamError(error) });
		}
		controller.cancelInFlightTools();
	} finally {
		controller.streamCoalescer.flush();
		controller.store.setStreaming(false);
	}
}

export function cancel(controller: KnoxGuiController): void { // cancelStream.ts
	controller.turnAborted = true;
	controller.streamCancel?.cancel();
	controller.messenger.post('abort', undefined);
	controller.messenger.post('tools/cancel', undefined);
	controller.streamCoalescer.flush();
	controller.store.setStreaming(false);
	controller.finishThinking();
	controller.cancelInFlightTools();
	const history = controller.store.state.history;
	const last = history[history.length - 1];
	if (last?.role === 'assistant' && !last.content.trim() && !last.toolCalls?.length && !last.thinking) {
		controller.store.patch({ history: history.slice(0, -1) });
	}
	void controller.runJobAction('killAll');
	for (const apply of controller.store.state.applyStates.filter(item => item.status === 'streaming' && item.filepath)) {
		controller.messenger.post('rejectDiff', { streamId: apply.streamId, filepath: apply.filepath });
	}
	if (controller.store.state.autonomous?.status === 'running') {
		controller.store.patch({ autonomous: { ...controller.store.state.autonomous, status: 'cancelled' } });
	}
	controller.messenger.post('brain/cancelAutonomousLoop', { sessionId: controller.store.state.sessionId });
	finishTurn(controller);
	void controller.saveCurrentSession({ generateTitle: false });
}

/** `runGuiAgentLoop.ts` executeTool: doom-loop guard, then `tools/call`; failures become tool output. */
export async function approveTool(controller: KnoxGuiController, id: string, always?: boolean): Promise<void> {
	const call = controller.findTool(id);
	if (!call || call.status === 'calling' || knoxGuiToolIsSettled(call)) {
		return;
	}
	if (always && !controller.store.state.sessionToolAllowlist.includes(call.name)) {
		controller.store.patch({ sessionToolAllowlist: [...controller.store.state.sessionToolAllowlist, call.name] });
	}
	if (isAutonomousRunning(controller)) {
		resolveAutonomousTool(controller, id, true, always);
		return;
	}
	const blocked = await doomLoopBlock(controller, call);
	if (blocked) {
		controller.messenger.post('brain/recordSoulEvent', {
			sessionId: controller.store.state.sessionId,
			kind: 'tool_error',
			toolName: blocked.toolName ?? call.name,
			files: [],
			ok: false,
			summary: `Doom loop (${blocked.kind}) blocked further tool calls`,
		});
		const language = controller.store.state.language;
		const item = { name: knoxGuiT(language, 'doomLoopName'), description: knoxGuiT(language, 'doomLoopDescription'), content: blocked.message };
		controller.patchTool(id, { status: 'done', outputItems: [item], output: blocked.message });
		controller.store.appendHistory({
			id: generateUuid(),
			role: 'tool',
			content: blocked.message,
			toolCalls: [{ ...call, status: 'done', outputItems: [item], output: blocked.message }],
		});
		await controller.maybeContinueTurn();
		return;
	}
	controller.patchTool(id, { status: 'calling' });
	const outcome = await callToolWithRetry(controller, call);
	if (outcome === 'stopped') {
		return;
	}
	if (outcome.ok) {
		const items = toolOutputItemsFromUnknown(outcome.result?.contextItems ?? outcome.result);
		controller.patchTool(id, { status: 'done', outputItems: items, output: toolOutputText(items, textFromUnknown(outcome.result?.contextItems ?? outcome.result)) });
	} else {
		const language = controller.store.state.language;
		const unexpectedAbort = knoxGuiIsCancelledToolError(outcome.error) && controller.findTool(id)?.status === 'calling';
		const item = knoxGuiToolFailureOutput(call.name, outcome.error, {
			unexpectedAbort,
			attemptsUsed: outcome.attempts,
			name: knoxGuiT(language, 'toolCallErrorName'),
			description: unexpectedAbort
				? knoxGuiT(language, 'toolCallInterrupted')
				: outcome.attempts > 1
					? knoxGuiT(language, 'toolCallFailedAfterRetries', { count: outcome.attempts })
					: knoxGuiT(language, 'toolCallFailed'),
		});
		controller.patchTool(id, { status: 'errored', outputItems: [item], output: item.content });
	}
	await controller.maybeContinueTurn();
}

/**
 * `callTool.ts` execute-with-retry: retryable errors back off (800 ms, 1.6 s);
 * a cancel error or a user Stop ends the attempts.
 */
async function callToolWithRetry(controller: KnoxGuiController, call: IKnoxGuiToolCall): Promise<'stopped' | { ok: true; result: Record<string, unknown> | undefined } | { ok: false; error: string; attempts: number }> {
	const stopped = () => controller.turnAborted || controller.findTool(call.id)?.status === 'canceled';
	let lastError = '';
	let attempts = 0;
	for (let attempt = 0; attempt <= KNOX_TOOL_CALL_MAX_RETRIES; attempt++) {
		if (stopped()) {
			return 'stopped';
		}
		if (attempt > 0) {
			await timeout(knoxGuiToolRetryDelay(attempt));
			if (stopped()) {
				return 'stopped';
			}
		}
		attempts = attempt + 1;
		const state = controller.store.state;
		const lastUser = [...state.history].reverse().find(item => item.role === 'user');
		try {
			const result = await controller.messenger.request<Record<string, unknown>>('tools/call', {
				toolCall: { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } },
				selectedModelTitle: state.modelTitle,
				viewReadModelTitle: state.selectedModelByRole.viewRead ?? null,
				realTimeSearchModelTitle: state.selectedModelByRole.realTimeSearch ?? null,
				preferredModel: knoxGuiToolPreferredModel(call.name, state.selectedModelByRole),
				sessionId: state.sessionId,
				turnId: lastUser?.id ?? state.sessionId,
			});
			if (stopped()) {
				return 'stopped';
			}
			if (typeof result?.errorMessage === 'string' && result.errorMessage) {
				throw new Error(result.errorMessage);
			}
			return { ok: true, result };
		} catch (error) {
			if (stopped()) {
				return 'stopped';
			}
			lastError = error instanceof Error ? error.message : String(error);
			if (knoxGuiIsCancelledToolError(lastError) || !knoxGuiIsRetryableToolError(lastError)) {
				break;
			}
		}
	}
	return { ok: false, error: lastError, attempts };
}

async function doomLoopBlock(controller: KnoxGuiController, call: IKnoxGuiToolCall): Promise<{ message: string; kind?: string; toolName?: string } | undefined> {
	try {
		const result = await controller.messenger.request<{ blockedMessage?: string; kind?: string; toolName?: string }>('knox/checkDoomLoop', {
			turnToolCalls: knoxGuiTurnDoomCalls(controller.store.state.history),
			pending: knoxGuiDoomCall(call),
		});
		return typeof result?.blockedMessage === 'string' && result.blockedMessage
			? { message: result.blockedMessage, kind: result.kind, toolName: result.toolName }
			: undefined;
	} catch {
		return undefined;
	}
}

export async function maybeContinueTurn(controller: KnoxGuiController): Promise<void> {
	if (!controller.turnAborted && knoxGuiShouldContinueTurn(controller.store.state.history)) {
		await controller.continueAfterTool();
	}
}

export async function continueAfterTool(controller: KnoxGuiController): Promise<void> {
	if (controller.turnAborted) {
		return;
	}
	controller.finishThinking();
	controller.store.patch({ toolLoopSteps: controller.store.state.toolLoopSteps + 1 });
	controller.store.setStreaming(true);
	controller.store.appendHistory({ id: generateUuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() });
	await runRound(controller);
}

/** `gatherContext.ts` + `resolveInput.ts`: @ mentions, default providers, then the open file unless already present. */
export async function gatherContext(controller: KnoxGuiController, doc: ReturnType<typeof inputDocFromPlainText>, fullInput: string, noContext: boolean): Promise<{ items: IKnoxGuiContextItem[] }> {
	const selectedModelTitle = controller.store.state.modelTitle;
	const selectedCode = controller.store.state.codeToEdit;
	const items: IKnoxGuiContextItem[] = [];
	const uris = new Set<string>();
	const fetchItems = async (name: string, query: string, input: string, code: unknown): Promise<Array<Record<string, unknown>>> => {
		try {
			const result = await controller.messenger.request<unknown>('context/getContextItems', { name, query, fullInput: input, selectedCode: code, selectedModelTitle });
			return asArray(result).map(asRecord).filter((rec): rec is Record<string, unknown> => Boolean(rec && rec.content));
		} catch {
			return [];
		}
	};
	const add = (rec: Record<string, unknown>, provider: string, front = false) => {
		const uriRec = asRecord(rec.uri);
		const uri = uriRec?.value;
		if (typeof uri === 'string') {
			uris.add(uri);
		}
		const item = contextItemFromRaw(rec, provider)!;
		if (front) {
			items.unshift(item);
		} else {
			items.push(item);
		}
	};
	for (const mention of extractMentionsFromDoc(doc)) {
		const provider = mentionContextProviderName(mention);
		for (const rec of await fetchItems(provider, mention.query ?? '', fullInput, selectedCode)) {
			add(rec, provider);
		}
	}
	for (const name of controller.store.state.defaultContext.filter(item => item !== 'activeFile' && item !== 'currentFile')) {
		for (const rec of await fetchItems(name, '', fullInput, selectedCode)) {
			add(rec, name);
		}
	}
	if (!noContext) {
		const [current] = await fetchItems('currentFile', 'non-mention-usage', '', []);
		const uri = current ? asRecord(current.uri)?.value : undefined;
		if (current && !(typeof uri === 'string' && uris.has(uri))) {
			add(current, 'file', true);
		}
	}
	for (const item of controller.store.state.contextItems) {
		items.push({ ...item });
	}
	void updateFileSymbols(controller, [
		...items.map(item => item.uri ?? ''),
		...selectedCode.map(code => code.filepath),
	]);
	return { items };
}

/** `updateFileSymbolsFromFiles`: symbols for the given file uris overwrite earlier ones. */
export async function updateFileSymbols(controller: KnoxGuiController, uris: string[]): Promise<void> {
	const unique = [...new Set(uris.filter(Boolean))];
	if (!unique.length) {
		return;
	}
	try {
		const result = await controller.messenger.request<unknown>('context/getSymbolsForFiles', { uris: unique });
		const symbols = knoxGuiParseSymbolMap(result);
		if (Object.keys(symbols).length) {
			controller.store.patch({ fileSymbols: { ...controller.store.state.fileSymbols, ...symbols } });
		}
	} catch {
		// symbols must not break the chat
	}
}

/** `updateFileSymbolsFromHistory`: only files that have no symbols yet. */
export function updateFileSymbolsFromHistory(controller: KnoxGuiController): Promise<void> {
	return updateFileSymbols(controller, knoxGuiMissingSymbolUris(controller.store.state.history, controller.store.state.fileSymbols));
}

export interface IKnoxGuiThinkingMeta {
	/** Reasoning is still streaming; reply text or `</think>` ends it. */
	active: boolean;
	redactedThinking?: string;
	thinkingSignature?: string;
}

export function patchLastThinking(controller: KnoxGuiController, thinking: string, meta?: IKnoxGuiThinkingMeta): void {
	const history = controller.store.state.history.slice();
	const now = Date.now();
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'assistant') {
			const active = meta?.active ?? true;
			history[i] = {
				...history[i],
				thinking,
				thinkingActive: active,
				thinkingStartAt: history[i].thinkingStartAt ?? now,
				thinkingEndAt: active ? undefined : history[i].thinkingEndAt ?? now,
				...(meta?.redactedThinking ? { redactedThinking: meta.redactedThinking } : {}),
				...(meta?.thinkingSignature ? { thinkingSignature: meta.thinkingSignature } : {}),
			};
			controller.store.patch({ history });
			return;
		}
	}
}

export function finishThinking(controller: KnoxGuiController): void {
	const history = controller.store.state.history.map(item => item.thinkingActive
		? { ...item, thinkingActive: false, thinkingEndAt: item.thinkingEndAt ?? Date.now() }
		: item);
	controller.store.patch({ history });
}

export function patchHistoryItem(controller: KnoxGuiController, id: string, patch: Partial<IKnoxGuiHistoryItem>): void {
	controller.store.patch({
		history: controller.store.state.history.map(item => item.id === id ? { ...item, ...patch } : item),
	});
}

export function deleteMessage(controller: KnoxGuiController, index: number): void {
	controller.store.patch({ history: controller.store.state.history.filter((_, i) => i !== index) });
}

export function continueGeneration(controller: KnoxGuiController): void {
	void controller.submit(knoxGuiT(controller.store.state.language, 'continueFromWhereYouLeftOff'));
}

export function clearStreamError(controller: KnoxGuiController): void {
	controller.store.patch({ streamError: undefined });
}

export function acceptAllApplies(controller: KnoxGuiController): void { // KN-377 Chat.tsx AcceptRejectAllButtons
	for (const apply of pendingApplyStates(controller.store.state.applyStates)) {
		controller.messenger.post('acceptDiff', { streamId: apply.streamId, filepath: apply.filepath });
	}
	if (controller.store.state.mode === 'edit') {
		void controller.exitEditMode();
	}
}

export function rejectAllApplies(controller: KnoxGuiController): void { // KN-377
	for (const apply of pendingApplyStates(controller.store.state.applyStates)) {
		controller.messenger.post('rejectDiff', { streamId: apply.streamId, filepath: apply.filepath });
	}
}

export function copyText(controller: KnoxGuiController, text: string): void {
	void navigator.clipboard?.writeText(text).catch(() => undefined);
	controller.messenger.post('copyText', { text });
}

export async function injectMemoryContext(controller: KnoxGuiController, userText: string, timeoutMs = MEMORY_BUILD_TIMEOUT_MS): Promise<string | undefined> {
	try {
		const result = await withTimeout(controller.messenger.request<Record<string, unknown>>('memory/buildContext', {
			message: userText || '',
			sessionId: controller.store.state.sessionId,
			goal: knoxGuiMemoryGoal(userText, collectLatestTaskPlanSnapshot(controller.store.state.history)?.plan.title),
		}), timeoutMs);
		if (!result) {
			controller.store.patch({
				injectedMemories: [{
					id: null,
					kind: 'timeout',
					title: knoxGuiT(controller.store.state.language, 'memoryInjectUnavailable'),
					reason: knoxGuiT(controller.store.state.language, 'memoryContextTimeoutReason'),
				}],
			});
			return undefined;
		}
		const rec = asRecord(result) ?? {};
		const items = parseInjectedMemories(rec.items);
		if (items.length !== controller.store.state.injectedMemories.length) {
			void controller.loadMemoryMode();
		}
		const context = rec.context ? String(rec.context) : '';
		if (context || items.length) {
			controller.store.patch({ injectedMemories: items });
			return context || undefined;
		}
		controller.store.patch({ injectedMemories: [] });
	} catch {
		controller.store.patch({
			injectedMemories: [{
				id: null,
				kind: 'timeout',
				title: knoxGuiT(controller.store.state.language, 'memoryInjectUnavailable'),
				reason: knoxGuiT(controller.store.state.language, 'memoryContextTimeoutReason'),
			}],
		});
	}
	return undefined;
}

export function takeRestoreNotice(controller: KnoxGuiController): string | undefined {
	const notice = controller.store.state.restoreNotice;
	if (!notice || notice.sessionId !== controller.store.state.sessionId) {
		return undefined;
	}
	controller.store.patch({ restoreNotice: undefined });
	return notice.content;
}

/** `StepContainerPreToolbar.tsx` shortcut: apply the next code block with that block's stream id. */
export function applyCodeFromChat(controller: KnoxGuiController): void {
	const state = controller.store.state;
	const next = nextCodeBlockToApply(state.history, state.applyStates);
	if (next && state.modelTitle) {
		controller.messenger.post('applyToFile', { streamId: next.streamId, filepath: next.fence.filepath, text: next.fence.code, curSelectedModelTitle: state.modelTitle });
	}
}
