/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray, textFromUnknown, thinkingFromUnknown, imagesFromUnknown, contextItemsFromRaw, parseAskQuestions } from './helpers.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { capDisplayText, parseToolArgs, shouldWarnLargeSession } from '../../../common/knoxGuiChat.js';
import { toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { inputDocFromPlainText } from '../../../common/knoxGuiInput.js';
import { formatSessionExportMarkdown, sessionExportFilename } from '../../../common/knoxGuiOverlays.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { knoxGuiResetEditModeState, shouldFocusEditorOnEditExit } from '../../../common/knoxGuiEdit.js';
import { applyCloseTab, IKnoxGuiHistoryItem, IKnoxGuiPromptLog, IKnoxGuiToolCall, KnoxChatMode } from '../../../common/knoxGuiState.js';
import { knoxGuiT } from '../knoxGuiI18n.js';
import { postSetAgentMode } from './models.js';

export async function newSession(controller: KnoxGuiController): Promise<void> {
	if (controller.store.state.history.length) {
		await controller.saveCurrentSession({ generateTitle: true });
		if (controller.store.state.sessionId) {
			controller.messenger.post('brain/dispatch', { action: 'close_session', session_id: controller.store.state.sessionId });
		}
	}
	controller.streamCancel?.cancel();
	controller.store.newSession();
	const untitled = knoxGuiT(controller.store.state.language, 'chatTab', { number: controller.store.state.tabs.length + 1 });
	controller.store.syncSessionTab(controller.store.state.sessionId, untitled);
	controller.syncActiveSession();
	postSetAgentMode(controller);
}

export async function loadSession(controller: KnoxGuiController, id: string, options?: { saveCurrent?: boolean }): Promise<void> {
	const previous = controller.store.state.sessionId;
	const shouldSave = options?.saveCurrent !== false;
	if (shouldSave && previous && previous !== id && controller.store.state.history.length) {
		await controller.saveCurrentSession({ generateTitle: true });
		controller.messenger.post('brain/dispatch', { action: 'close_session', session_id: previous });
	}
	controller.store.patch({ isLoadingHistory: true, overlay: null, route: KnoxGuiRoute.Chat, autoScroll: true });
	try {
		const session = await controller.messenger.request<Record<string, unknown>>('history/load', { id });
		const raw = Array.isArray(session?.history) ? session.history as Array<Record<string, unknown>> : [];
		const history = raw.map((item, index) => controller.historyFromRaw(item, index));
		const title = String(session?.title ?? '');
		controller.store.patch({
			sessionId: String(session?.sessionId ?? id),
			sessionTitle: title,
			history,
			isLoadingHistory: false,
			historyHydrateNotice: shouldWarnLargeSession(history) ? 'large' : null,
		});
		controller.store.syncSessionTab(controller.store.state.sessionId, title || knoxGuiT(controller.store.state.language, 'newChat'));
		controller.syncActiveSession();
		postSetAgentMode(controller);
		controller.messenger.post('brain/trackSession', { sessionId: controller.store.state.sessionId, title: controller.store.state.sessionTitle, workspaceDir: '' });
	} catch {
		controller.store.patch({ isLoadingHistory: false });
	}
}

export async function activateTab(controller: KnoxGuiController, tabId: string): Promise<void> { // KN-377
	const tab = controller.store.state.tabs.find(item => item.id === tabId);
	if (!tab || tab.id === controller.store.state.activeTabId) {
		return;
	}
	if (tab.sessionId && tab.sessionId !== controller.store.state.sessionId) {
		await controller.loadSession(tab.sessionId);
		return;
	}
	controller.store.patch({ activeTabId: tab.id });
}

export async function closeTab(controller: KnoxGuiController, tabId: string): Promise<void> {
	const result = applyCloseTab(controller.store.state.tabs, controller.store.state.activeTabId, tabId);
	controller.store.patch({ tabs: result.tabs, activeTabId: result.activeTabId });
	if (result.startNew) {
		await controller.newSession();
		return;
	}
	if (result.loadSessionId && result.loadSessionId !== controller.store.state.sessionId) {
		await controller.loadSession(result.loadSessionId);
	}
}

export async function deleteSessions(controller: KnoxGuiController, ids: string[]): Promise<void> {
	for (const id of ids) {
		controller.messenger.post('history/delete', { id });
	}
	controller.store.patch({
		historySessions: controller.store.state.historySessions.filter(session => !ids.includes(session.id)),
		historySelected: [],
		tabs: controller.store.state.tabs.filter(tab => !tab.sessionId || !ids.includes(tab.sessionId)),
	});
	if (ids.includes(controller.store.state.sessionId)) {
		await controller.newSession();
	}
}

export function syncActiveSession(controller: KnoxGuiController): void {
	controller.messenger.post('setActiveChatSession', { sessionId: controller.store.state.sessionId || null });
}

export function sessionTitleFallback(controller: KnoxGuiController): string {
	const firstUser = controller.store.state.history.find(item => item.role === 'user');
	const line = (firstUser?.content ?? '').split('\n').map(part => part.trim()).filter(Boolean).slice(-1)[0] ?? '';
	if (line.length > 100) {
		return `${line.slice(0, 97)}...`;
	}
	return line || knoxGuiT(controller.store.state.language, 'newChat');
}

export async function saveCurrentSession(controller: KnoxGuiController, options?: { generateTitle?: boolean }): Promise<void> {
	if (!controller.store.state.history.length) {
		return;
	}
	const sessionId = controller.store.state.sessionId;
	const history = controller.store.state.history.slice();
	const language = controller.store.state.language;
	const autoName = controller.store.state.autoNameSessionTitles;
	const modelTitle = controller.store.state.modelTitle;
	try {
		const untitled = knoxGuiT(language, 'newChat');
		let title = controller.store.state.sessionTitle;
		if ((!title || title === untitled || title.startsWith('Chat ')) && options?.generateTitle && autoName) {
			const assistant = history.find(item => item.role === 'assistant' && item.content.trim())?.content;
			if (assistant && modelTitle) {
				try {
					const described = await controller.messenger.request<string>('chatDescriber/describe', {
						text: assistant,
						selectedModelTitle: modelTitle,
					});
					if (typeof described === 'string' && described.trim()) {
						title = described.trim();
					}
				} catch {
					// describer is optional
				}
			}
		}
		if (!title || title === untitled || title.startsWith('Chat ')) {
			title = controller.sessionTitleFallback();
		}
		if (controller.store.state.sessionId === sessionId) {
			controller.store.patch({ sessionTitle: title });
			controller.store.syncSessionTab(sessionId, title);
		}
		await controller.messenger.request('history/save', {
			sessionId,
			title,
			workspaceDirectory: undefined,
			history,
		});
		const existing = controller.store.state.historySessions.filter(session => session.id !== sessionId);
		controller.store.patch({
			historySessions: [
				{ id: sessionId, title, date: new Date().toISOString() },
				...existing,
			],
		});
	} catch {
		// save is best-effort
	}
}

export function historyFromRaw(controller: KnoxGuiController, item: Record<string, unknown>, index: number): IKnoxGuiHistoryItem {
	const message = asRecord(item.message) ?? item;
	const role = String(message.role ?? 'assistant') as IKnoxGuiHistoryItem['role'];
	const toolState = asRecord(item.toolCallState);
	const toolStates = asArray(item.toolCallStates).map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value));
	if (toolState) {
		toolStates.unshift(toolState);
	}
	const toolCallsRaw = Array.isArray(message.toolCalls) ? message.toolCalls as Array<Record<string, unknown>> : [];
	const fromStates: IKnoxGuiToolCall[] = toolStates.map(state => {
		const call = asRecord(state.toolCall) ?? state;
		const fn = asRecord(call.function);
		const args = String(fn?.arguments ?? call.arguments ?? '');
		const parsed = asRecord(state.parsedArgs) ?? parseToolArgs(args);
		const outputItems = toolOutputItemsFromUnknown(state.output);
		return {
			id: String(state.toolCallId ?? call.id ?? generateUuid()),
			name: String(fn?.name ?? call.name ?? 'tool'),
			arguments: args,
			status: String(state.status ?? 'done') as IKnoxGuiToolCall['status'],
			outputItems,
			output: capDisplayText(toolOutputText(outputItems, textFromUnknown(state.output))).text,
			parsedArgs: parsed,
			questions: parseAskQuestions(parsed),
			answers: asRecord(state.answers) as Record<string, string> | undefined,
		};
	});
	const fromMessage = toolCallsRaw.map(call => {
		const args = String(asRecord(call.function)?.arguments ?? call.arguments ?? '');
		const parsed = parseToolArgs(args);
		return {
			id: String(call.id ?? generateUuid()),
			name: String(asRecord(call.function)?.name ?? call.name ?? 'tool'),
			arguments: args,
			status: 'done' as const,
			output: call.output ? capDisplayText(textFromUnknown(call.output)).text : undefined,
			parsedArgs: parsed,
			questions: parseAskQuestions(parsed),
		};
	});
	const reasoning = asRecord(item.reasoning);
	const content = textFromUnknown(message.content);
	const images = imagesFromUnknown(message.content) ?? imagesFromUnknown(item.images);
	const contextItems = contextItemsFromRaw(item.contextItems);
	const editorState = item.editorState ?? message.editorState;
	const inputDoc = Array.isArray(editorState) ? editorState as IKnoxGuiHistoryItem['inputDoc'] : (content ? inputDocFromPlainText(content): undefined);
	return {
		id: String(message.id ?? item.id ?? `m-${index}`),
		role: role === 'user' || role === 'system' || role === 'thinking' || role === 'tool' ? role : 'assistant',
		content,
		thinking: reasoning && typeof reasoning.text === 'string' ? reasoning.text : thinkingFromUnknown(message.content),
		toolCalls: fromStates.length ? fromStates : fromMessage,
		images,
		contextItems,
		inputDoc,
		createdAt: typeof item.createdAt === 'string' ? item.createdAt : (typeof message.createdAt === 'string' ? message.createdAt : undefined),
		checkpointId: typeof item.checkpointId === 'string' ? item.checkpointId : undefined,
		promptLogs: promptLogsFromRaw(item, message),
	};
}

function promptLogsFromRaw(item: Record<string, unknown>, message: Record<string, unknown>): IKnoxGuiPromptLog[] | undefined {
	const raw = [...asArray(item.promptLogs), ...asArray(message.promptLogs)];
	const logs: IKnoxGuiPromptLog[] = [];
	for (const entry of raw) {
		const rec = asRecord(entry);
		if (!rec) {
			continue;
		}
		const jev = asRecord(rec.jev);
		const turn = asRecord(jev?.turn);
		logs.push({
			modelTitle: typeof rec.modelTitle === 'string' ? rec.modelTitle : undefined,
			prompt: typeof rec.prompt === 'string' ? rec.prompt : undefined,
			completion: typeof rec.completion === 'string' ? rec.completion : undefined,
			jev: turn ? {
				turn: {
					source: typeof turn.source === 'string' ? turn.source : undefined,
					route: typeof turn.route === 'string' ? turn.route : undefined,
					skill: typeof turn.skill === 'string' ? turn.skill : undefined,
					confidence: typeof turn.confidence === 'number' ? turn.confidence : undefined,
					reason: typeof turn.reason === 'string' ? turn.reason : undefined,
				},
			} : undefined,
		});
	}
	return logs.length ? logs : undefined;
}

export function enterEditMode(controller: KnoxGuiController, options: { clearSession: boolean }): void {
	const hasHistory = controller.store.state.history.length > 0;
	if (options.clearSession || hasHistory) {
		if (hasHistory) {
			void controller.saveCurrentSession({ generateTitle: !options.clearSession });
			if (controller.store.state.sessionId) {
				controller.messenger.post('brain/dispatch', { action: 'close_session', session_id: controller.store.state.sessionId });
			}
		}
		controller.streamCancel?.cancel();
		controller.store.newSession();
		const untitled = knoxGuiT(controller.store.state.language, 'chatTab', { number: controller.store.state.tabs.length + 1 });
		controller.store.syncSessionTab(controller.store.state.sessionId, untitled);
		controller.syncActiveSession();
	}
	controller.store.patch({
		...knoxGuiResetEditModeState(),
		mode: 'edit',
		inputFocused: true,
		addFileOpen: false,
	});
	postSetAgentMode(controller);
}

export async function exitEditMode(controller: KnoxGuiController, nextMode: KnoxChatMode = 'chat'): Promise<void> {
	if (controller.store.state.mode !== 'edit') {
		controller.messenger.post('focusEditor', undefined);
		return;
	}
	const shouldFocus = shouldFocusEditorOnEditExit(controller.store.state);
	for (const code of controller.store.state.codeToEdit) {
		controller.messenger.post('rejectDiff', { filepath: code.filepath });
	}
	controller.messenger.post('edit/exit', { shouldFocusEditor: shouldFocus });
	controller.store.patch({
		codeToEdit: [],
		addFileOpen: false,
		mode: nextMode,
		editStatus: 'done',
		editPreviousInputs: [],
		editFileAfterEdit: undefined,
		inputFocused: false,
	});
	postSetAgentMode(controller);
	const last = controller.store.state.historySessions[0];
	if (last?.id && last.id !== controller.store.state.sessionId) {
		await controller.loadSession(last.id, { saveCurrent: false });
	}
}

export function focusHostEditor(controller: KnoxGuiController): void {
	controller.messenger.post('focusEditor', undefined);
}

export async function refreshHistorySessions(controller: KnoxGuiController): Promise<void> {
	try {
		const sessions = await controller.messenger.request<Array<Record<string, unknown>>>('history/list', {});
		if (Array.isArray(sessions)) {
			controller.store.patch({
				historySessions: sessions.map(session => ({
					id: String(session.id ?? session.sessionId ?? ''),
					title: String(session.title ?? 'Session'),
					date: String(session.date ?? session.dateCreated ?? session.timestamp ?? ''),
					workspaceDirectory: session.workspaceDirectory ? String(session.workspaceDirectory): undefined,
				})),
			});
		}
	} catch {
		// history optional
	}
}

export async function renameSession(controller: KnoxGuiController, id: string, title: string): Promise<void> {
	const trimmed = title.trim();
	if (!trimmed) {
		return;
	}
	controller.store.patch({
		historySessions: controller.store.state.historySessions.map(session => session.id === id ? { ...session, title: trimmed } : session),
		sessionTitle: controller.store.state.sessionId === id ? trimmed : controller.store.state.sessionTitle,
	});
	if (controller.store.state.sessionId === id) {
		controller.store.syncSessionTab(id, trimmed);
		await controller.saveCurrentSession();
		return;
	}
	try {
		const session = await controller.messenger.request<Record<string, unknown>>('history/load', { id });
		await controller.messenger.request('history/save', { ...session, sessionId: id, title: trimmed });
	} catch {
		// rename is best-effort
	}
}

export async function exportSession(controller: KnoxGuiController, id: string): Promise<void> {
	try {
		const session = controller.store.state.sessionId === id
			? { title: controller.store.state.sessionTitle, history: controller.store.state.history, workspaceDirectory: undefined as string | undefined }
			: await controller.messenger.request<Record<string, unknown>>('history/load', { id });
		const title = String(session?.title ?? 'session');
		const history = Array.isArray(session?.history)
			? (session.history as Array<Record<string, unknown>>).map(item => {
				const rec = asRecord(item) ?? {};
				const message = asRecord(rec.message) ?? rec;
				return { role: String(message.role ?? rec.role ?? 'assistant'), content: textFromUnknown(message.content ?? rec.content) };
			})
			: controller.store.state.history.map(item => ({ role: item.role, content: item.content }));
		const markdown = formatSessionExportMarkdown({ title, workspaceDirectory: session?.workspaceDirectory ? String(session.workspaceDirectory): undefined, history });
		const filename = sessionExportFilename(title);
		const dirs = await controller.messenger.request<string[]>('getWorkspaceDirs', undefined).catch(() => []);
		const workspaceDir = Array.isArray(dirs) ? String(dirs[0] ?? '').replace(/^file:\/\//, ''): '';
		const filePath = workspaceDir ? `${workspaceDir}/${filename}` : `/tmp/${filename}`;
		const fileUrl = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
		await controller.messenger.request('writeFile', { path: fileUrl, contents: markdown });
		await controller.messenger.request('openFile', { path: fileUrl });
		controller.messenger.post('showToast', ['info', knoxGuiT(controller.store.state.language, 'sessionExportedTo', { filename })]);
	} catch (error) {
		controller.messenger.post('showToast', ['error', knoxGuiT(controller.store.state.language, 'failedToExportSession', { error: error instanceof Error ? error.message : String(error) })]);
	}
}
