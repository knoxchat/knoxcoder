/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { MEMORY_BUILD_TIMEOUT_MS, asRecord, asArray, textFromUnknown, thinkingFromUnknown, withTimeout } from './helpers.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { expandPromptSlashCommand, isPromptBasedSlashCommand, parseLeadingSlash } from '../../../common/knoxGuiChat.js';
import { parseInjectedMemories } from '../../../common/knoxGuiPanels.js';
import { toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { parseStreamError, pendingApplyStates } from '../../../common/knoxGuiTranscript.js';
import { extractMentionsFromDoc, extractSlashFromDoc, inputDocFromPlainText, inputDocToPlainText, knoxGuiShouldBlockSubmit, mentionContextProviderName, resolveComposerSlashCommand, slashCommandBareName, submitUsesActiveFile, useActiveFileFromDefaultContext } from '../../../common/knoxGuiInput.js';
import { editSendPromptPayload, knoxGuiMultifileEditPrompt, shouldSendEditPrompt } from '../../../common/knoxGuiEdit.js';
import { IKnoxGuiHistoryItem, IKnoxGuiToolCall } from '../../../common/knoxGuiState.js';
import { knoxGuiT } from '../knoxGuiI18n.js';

export async function submit(controller: KnoxGuiController, starterPrompt?: string, modifiers?: { noContext?: boolean; altKey?: boolean; index?: number; doc?: ReturnType<typeof inputDocFromPlainText>; images?: string[] }): Promise<void> {
	const resubmitting = typeof modifiers?.index === 'number';
	if (resubmitting && controller.store.state.isStreaming) {
		controller.cancel();
	}
	const doc = modifiers?.doc ?? (starterPrompt ? inputDocFromPlainText(starterPrompt): controller.store.state.inputDoc);
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
	const slashRest = slashName ? (parseLeadingSlash(text)?.rest ?? text.replace(new RegExp(`^/${slashName}\\s*`), '')): '';
	let legacySlash: { command: string; input: string } | undefined;
	if (slashName) { // KN-374: KN-304 builtins + YAML / .prompt expansion
		const command = resolveComposerSlashCommand(slashName, controller.store.state.slashCommands);
		if (command && isPromptBasedSlashCommand(command) && command.prompt) {
			text = expandPromptSlashCommand(command.prompt, slashRest);
		} else if (command) {
			if (slashCommandBareName(command.name) === 'autonomous') {
				controller.store.patch({ autonomous: { iteration: 1, status: 'running', max: 0, goal: slashRest || undefined } });
			}
			legacySlash = { command: slashCommandBareName(command.name), input: slashRest };
		}
	}
	const useActive = useActiveFileFromDefaultContext(controller.store.state.defaultContext);
	const noContext = modifiers?.noContext ?? !submitUsesActiveFile(useActive, Boolean(modifiers?.altKey));
	if (shouldSendEditPrompt(controller.store.state)) {
		controller.store.patch({ isGatheringContext: true });
		const gathered = await controller.gatherContext(doc, text, true);
		const prompt = [gathered.extra, text].filter(Boolean).join('\n\n');
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
	if (!controller.store.state.sessionTitle) {
		const title = controller.sessionTitleFallback();
		controller.store.patch({ sessionTitle: title });
		controller.store.syncSessionTab(controller.store.state.sessionId, title);
	}
	controller.store.setStreaming(true);
	controller.store.appendHistory({ id: generateUuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() });
	const gathered = await controller.gatherContext(doc, text, noContext);
	const memory = await controller.injectMemoryContext(text);
	const restore = controller.takeRestoreNotice();
	controller.store.patch({ isGatheringContext: false });
	controller.streamCancel?.dispose();
	const cancel = new CancellationTokenSource();
	controller.streamCancel = cancel;
	try {
		const extra = [
			controller.store.state.mode === 'edit' ? knoxGuiMultifileEditPrompt(controller.store.state.codeToEdit) : undefined,
			gathered.extra,
			memory,
			restore,
		].filter(Boolean).join('\n\n') || undefined;
		const messages = controller.buildMessages(extra, images);
		let assistant = '';
		let thinking = '';
		const toolCalls: IKnoxGuiToolCall[] = [];
		for await (const batch of controller.messenger.streamRequest<Record<string, unknown>>('llm/streamChat', {
			messages,
			title: controller.store.state.modelTitle,
			legacySlashCommandData: legacySlash,
			completionOptions: {
				reasoningEffort: controller.store.state.reasoningEffort,
				tools: controller.store.state.mode === 'agent' && controller.store.state.toolsSupported,
				webSearch: controller.store.state.webSearchSupported ? controller.store.state.webSearchEnabled : undefined,
			},
		}, cancel.token)) {
			for (const chunk of batch) {
				assistant += textFromUnknown(chunk?.content ?? chunk);
				thinking += thinkingFromUnknown(chunk?.content ?? chunk) ?? '';
				controller.mergeToolCalls(toolCalls, asArray(chunk?.toolCalls).concat(asArray(asRecord(chunk)?.tool_calls)));
				controller.streamCoalescer.enqueue({ content: assistant, toolCalls: toolCalls.slice(), thinking: thinking || undefined });
			}
		}
		controller.streamCoalescer.flush();
		controller.finalizeGeneratingTools(toolCalls);
		controller.store.updateLastAssistant(assistant, toolCalls);
		await controller.resolveTools(toolCalls);
		controller.finishThinking();
		await controller.ensureCheckpointForLastAssistant();
		await controller.saveCurrentSession({ generateTitle: true });
	} catch (error) {
		controller.finishThinking();
		controller.store.patch({ streamError: parseStreamError(error) });
	} finally {
		controller.streamCoalescer.flush();
		controller.store.setStreaming(false);
		controller.store.patch({ isGatheringContext: false });
		void controller.refreshGitDiff(true);
		if (controller.store.state.worktree.enabled) {
			void controller.runWorktree('status');
		}
	}
}

export function cancel(controller: KnoxGuiController): void {
	controller.streamCancel?.cancel();
	controller.messenger.post('abort', undefined);
	controller.messenger.post('tools/cancel', undefined);
	controller.streamCoalescer.flush();
	controller.store.setStreaming(false);
	controller.cancelInFlightTools();
	if (controller.store.state.autonomous?.status === 'running') {
		controller.store.patch({ autonomous: { ...controller.store.state.autonomous, status: 'cancelled' } });
	}
}

export async function approveTool(controller: KnoxGuiController, id: string, always?: boolean): Promise<void> {
	const call = controller.findTool(id);
	if (!call) {
		return;
	}
	controller.patchTool(id, { status: 'calling' });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('tools/call', {
			toolCall: { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } },
			selectedModelTitle: controller.store.state.modelTitle,
			sessionId: controller.store.state.sessionId,
		});
		const items = toolOutputItemsFromUnknown(result?.contextItems ?? result);
		controller.patchTool(id, { status: 'done', outputItems: items, output: toolOutputText(items, textFromUnknown(result?.contextItems ?? result)) });
		if (always) {
			controller.store.patch({ sessionToolAllowlist: [...controller.store.state.sessionToolAllowlist, call.name] });
			controller.messenger.post('ui/sessionAllowTool', { name: call.name });
		}
		await controller.continueAfterTool();
	} catch (error) {
		controller.patchTool(id, { status: 'errored', output: error instanceof Error ? error.message : String(error) });
	}
}

export async function continueAfterTool(controller: KnoxGuiController): Promise<void> {
	controller.finishThinking();
	controller.store.patch({ toolLoopSteps: controller.store.state.toolLoopSteps + 1 });
	controller.store.setStreaming(true);
	controller.store.appendHistory({ id: generateUuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() });
	try {
		let assistant = '';
		const toolCalls: IKnoxGuiToolCall[] = [];
		for await (const batch of controller.messenger.streamRequest<Record<string, unknown>>('llm/streamChat', {
			messages: controller.buildMessages(),
			title: controller.store.state.modelTitle,
			completionOptions: {
				tools: controller.store.state.mode === 'agent',
				webSearch: controller.store.state.webSearchSupported ? controller.store.state.webSearchEnabled : undefined,
			},
		})) {
			for (const chunk of batch) {
				assistant += textFromUnknown(chunk?.content ?? chunk);
				controller.mergeToolCalls(toolCalls, asArray(chunk?.toolCalls));
				controller.streamCoalescer.enqueue({ content: assistant, toolCalls: toolCalls.slice() });
			}
		}
		controller.streamCoalescer.flush();
		if (toolCalls.length) {
			controller.finalizeGeneratingTools(toolCalls);
			controller.store.updateLastAssistant(assistant, toolCalls);
			await controller.resolveTools(toolCalls);
		} else {
			controller.finishThinking();
			await controller.ensureCheckpointForLastAssistant();
		}
	} catch (error) {
		controller.finishThinking();
		controller.store.patch({ streamError: parseStreamError(error) });
	} finally {
		controller.streamCoalescer.flush();
		controller.store.setStreaming(false);
	}
}

export function buildMessages(controller: KnoxGuiController, extraContext?: string, images: string[] = []): Array<Record<string, unknown>> {
	const messages: Array<Record<string, unknown>> = [];
	if (extraContext) {
		messages.push({ role: 'user', content: extraContext });
	}
	for (const item of controller.store.state.history) {
		if (item.role === 'thinking' || item.role === 'tool') {
			continue;
		}
		const urls = item.images ?? (item.role === 'user' && item === controller.store.state.history.filter(row => row.role === 'user').slice(-1)[0] ? images : []);
		if (item.role === 'user' && urls.length) {
			messages.push({
				role: 'user',
				content: [
					{ type: 'text', text: item.content },
					...urls.map(url => ({ type: 'imageUrl', imageUrl: { url } })),
				],
			});
		} else {
			messages.push({ role: item.role, content: item.content });
		}
		for (const tool of item.toolCalls ?? []) {
			if (tool.output) {
				messages.push({ role: 'tool', content: tool.output, toolCallId: tool.id });
			}
		}
	}
	return messages;
}

export async function gatherContext(controller: KnoxGuiController, doc: ReturnType<typeof inputDocFromPlainText>, fullInput: string, noContext: boolean): Promise<{ extra?: string }> {
	const chunks: string[] = [];
	const selectedModelTitle = controller.store.state.modelTitle;
	const selectedCode = controller.store.state.codeToEdit;
	const mentions = extractMentionsFromDoc(doc);
	for (const mention of mentions) {
		try {
			const items = await controller.messenger.request<Array<Record<string, unknown>>>('context/getContextItems', {
				name: mentionContextProviderName(mention),
				query: mention.query ?? '',
				fullInput,
				selectedCode,
				selectedModelTitle,
			});
			for (const item of asArray(items)) {
				const rec = asRecord(item);
				if (rec?.content) {
					chunks.push(String(rec.content));
				}
			}
		} catch {
			// provider optional
		}
	}
	for (const block of doc) {
		if (block.type !== 'codeBlock' || !block.code) {
			continue;
		}
		const header = block.filepath ?? block.itemName ?? '';
		chunks.push(`\`\`\`${block.language ?? ''} ${header}\n${block.code}\n\`\`\``.trim());
	}
	if (!noContext) {
		try {
			const items = await controller.messenger.request<Array<Record<string, unknown>>>('context/getContextItems', {
				name: 'currentFile',
				query: 'non-mention-usage',
				fullInput,
				selectedCode,
				selectedModelTitle,
			});
			for (const item of asArray(items)) {
				const rec = asRecord(item);
				if (rec?.content) {
					chunks.push(String(rec.content));
				}
			}
		} catch {
			// current file optional
		}
	}
	for (const name of controller.store.state.defaultContext.filter(item => item !== 'activeFile' && item !== 'currentFile')) {
		try {
			const items = await controller.messenger.request<Array<Record<string, unknown>>>('context/getContextItems', {
				name,
				query: '',
				fullInput,
				selectedCode,
				selectedModelTitle,
			});
			for (const item of asArray(items)) {
				const rec = asRecord(item);
				if (rec?.content) {
					chunks.push(String(rec.content));
				}
			}
		} catch {
			// default context optional
		}
	}
	for (const item of controller.store.state.contextItems) {
		chunks.push(`${item.name}\n${item.content}`);
	}
	return { extra: chunks.length ? chunks.join('\n\n'): undefined };
}

export function patchLastThinking(controller: KnoxGuiController, thinking: string): void {
	const history = controller.store.state.history.slice();
	const now = Date.now();
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'assistant') {
			history[i] = {
				...history[i],
				thinking,
				thinkingActive: true,
				thinkingStartAt: history[i].thinkingStartAt ?? now,
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
	void navigator.clipboard?.writeText(text);
	controller.messenger.post('copyText', { text });
}

export async function injectMemoryContext(controller: KnoxGuiController, userText: string): Promise<string | undefined> {
	try {
		const result = await withTimeout(controller.messenger.request<Record<string, unknown>>('memory/buildContext', {
			message: userText || '',
			sessionId: controller.store.state.sessionId,
		}), MEMORY_BUILD_TIMEOUT_MS);
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
		const context = rec.context ? String(rec.context): '';
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

export function applyCodeFromChat(controller: KnoxGuiController): void {
	const last = [...controller.store.state.history].reverse().find(item => item.role === 'assistant');
	if (last) {
		controller.messenger.post('applyToFile', { text: last.content, streamId: last.id, curSelectedModelTitle: controller.store.state.modelTitle });
	}
}
