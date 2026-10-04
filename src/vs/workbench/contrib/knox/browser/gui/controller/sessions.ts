/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { KNOX_PINNED_SESSIONS_KEY, knoxGuiForkHistory, knoxGuiForkTitle, knoxGuiSerializePinned, knoxGuiTogglePinned } from '../../../common/knoxGuiSessions.js';
import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray, textFromUnknown, thinkingFromUnknown, imagesFromUnknown, contextItemsFromRaw, parseAskQuestions } from './helpers.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { capDisplayText, isAskUserToolName, parseToolArgs, shouldWarnLargeSession } from '../../../common/knoxGuiChat.js';
import { toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { inputDocFromPlainText } from '../../../common/knoxGuiInput.js';
import { formatSessionExportMarkdown, sessionExportFilename } from '../../../common/knoxGuiOverlays.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { knoxGuiResetEditModeState, shouldFocusEditorOnEditExit } from '../../../common/knoxGuiEdit.js';
import { knoxGuiIsSessionTabMode, knoxGuiModeAfterEditExit } from '../../../common/knoxGuiAgentMode.js';
import { applyCloseTab, IKnoxGuiHistoryItem, IKnoxGuiPromptLog, IKnoxGuiToolCall, KnoxChatMode } from '../../../common/knoxGuiState.js';
import { knoxGuiT } from '../knoxGuiI18n.js';
import { postSetAgentMode } from './models.js';
import { knoxGuiHistoryToSessionHistory } from '../../../common/knoxGuiAgentRequest.js';
import { updateFileSymbolsFromHistory } from './stream.js';

export async function newSession(controller: KnoxGuiController, options?: { generateTitle?: boolean }): Promise<void> {
	if (controller.store.state.history.length) {
		await controller.saveCurrentSession({ generateTitle: options?.generateTitle ?? true });
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

export function ensureSessionId(controller: KnoxGuiController): string {
	const existing = controller.store.state.sessionId?.trim();
	if (existing) {
		return existing;
	}
	const sessionId = generateUuid();
	controller.store.patch({ sessionId });
	controller.store.syncSessionTab(sessionId, controller.store.state.sessionTitle || knoxGuiT(controller.store.state.language, 'newChat'));
	return sessionId;
}

function sessionFromHistoryLoad(raw: unknown): Record<string, unknown> {
	const rec = asRecord(raw);
	if (!rec) {
		return {};
	}
	const nested = asRecord(rec.session);
	if (nested && (Array.isArray(nested.history) || Array.isArray(nested.messages) || nested.sessionId || nested.title)) {
		return nested;
	}
	return rec;
}

function historyItemsFromSession(session: Record<string, unknown>): Array<Record<string, unknown>> {
	const raw = session.history ?? session.messages;
	return asArray(raw).map(item => asRecord(item) ?? { content: item }).filter((item): item is Record<string, unknown> => Boolean(item));
}

/**
 * HistoryTableRow: load the listed session unless it is already current, then
 * close the lump overlay and show chat. Empty `sessionId` is a real leftover
 * (`~/.knoxcoder/sessions/.json`) — do not treat `'' === ''` as already loaded.
 */
export async function openHistorySession(controller: KnoxGuiController, sessionId: string): Promise<void> {
	const listed = sessionId ?? '';
	const current = controller.store.state.sessionId ?? '';
	const alreadyOpen = current === listed && (Boolean(listed.trim()) || controller.store.state.history.length > 0);
	if (!alreadyOpen) {
		await controller.loadSession(listed);
	}
	controller.store.navigate('/');
}

export async function loadSession(controller: KnoxGuiController, id: string, options?: { saveCurrent?: boolean }): Promise<void> {
	const requestedId = id ?? '';
	const previous = controller.store.state.sessionId;
	const shouldSave = options?.saveCurrent !== false;
	if (shouldSave && previous && previous !== requestedId && controller.store.state.history.length) {
		await controller.saveCurrentSession({ generateTitle: true });
		controller.messenger.post('brain/dispatch', { action: 'close_session', session_id: previous });
	}
	controller.store.patch({ isLoadingHistory: true, overlay: null, route: KnoxGuiRoute.Chat, autoScroll: true });
	try {
		const loaded = sessionFromHistoryLoad(await controller.messenger.request<Record<string, unknown>>('history/load', { id: requestedId }));
		const history = historyItemsFromSession(loaded).map((item, index) => controller.historyFromRaw(item, index));
		const title = String(loaded.title ?? '');
		const sessionId = String(loaded.sessionId ?? requestedId);
		controller.store.patch({
			sessionId,
			sessionTitle: title,
			history,
			isLoadingHistory: false,
			isStreaming: false,
			isGatheringContext: false,
			historyHydrateNotice: shouldWarnLargeSession(history) ? 'large' : null,
			fileSymbols: {},
			injectedMemories: [],
			compaction: undefined,
			autonomous: undefined,
			taskPlan: [],
			sessionToolAllowlist: [],
			toolLoopSteps: 0,
			streamError: undefined,
			applyStates: [],
			overlay: null,
			route: KnoxGuiRoute.Chat,
			autoScroll: true,
		});
		void updateFileSymbolsFromHistory(controller);
		controller.store.syncSessionTab(controller.store.state.sessionId, title || knoxGuiT(controller.store.state.language, 'newChat'));
		controller.syncActiveSession();
		postSetAgentMode(controller);
		controller.messenger.post('brain/trackSession', { sessionId: controller.store.state.sessionId, title: controller.store.state.sessionTitle, workspaceDir: controller.workspaceDirectory });
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
	const unique = [...new Set(ids.filter(id => id !== undefined))];
	if (!unique.length) {
		return;
	}
	for (const id of unique) {
		controller.messenger.post('history/delete', { id });
	}
	const stayInHistory = controller.store.state.overlay === 'history' || controller.store.state.route === KnoxGuiRoute.History;
	const overlay = controller.store.state.overlay;
	const route = controller.store.state.route;
	controller.store.patch({
		historySessions: controller.store.state.historySessions.filter(session => !unique.includes(session.id)),
		historySelected: [],
		historySelectionMode: false,
		historyConfirmDelete: false,
		tabs: controller.store.state.tabs.filter(tab => !tab.sessionId || !unique.includes(tab.sessionId)),
	});
	if (unique.includes(controller.store.state.sessionId)) {
		if (stayInHistory) {
			openFreshSession(controller);
			controller.store.patch({
				overlay: overlay === 'history' ? 'history' : null,
				route: route === KnoxGuiRoute.History ? KnoxGuiRoute.History : KnoxGuiRoute.Chat,
			});
		} else {
			const next = controller.store.state.historySessions[0]?.id;
			if (next) {
				await controller.loadSession(next, { saveCurrent: false });
			} else {
				openFreshSession(controller);
			}
		}
	}
}

function openFreshSession(controller: KnoxGuiController): void {
	controller.store.newSession();
	controller.store.syncSessionTab(controller.store.state.sessionId, knoxGuiT(controller.store.state.language, 'chatTab', { number: controller.store.state.tabs.length + 1 }));
	controller.syncActiveSession();
}

/**
 * `thunks/session.ts:loadLastSession({ saveCurrentSession: false })`: reload the
 * newest session of this workspace, or start a new chat when there is none.
 */
export async function loadLastSession(controller: KnoxGuiController): Promise<void> {
	if (!controller.workspaceDirectory) {
		openFreshSession(controller);
		return;
	}
	await refreshHistorySessions(controller);
	const last = controller.store.state.historySessions[0]?.id;
	if (last) {
		await controller.loadSession(last, { saveCurrent: false });
	} else {
		openFreshSession(controller);
	}
}

export function syncActiveSession(controller: KnoxGuiController): void {
	controller.messenger.post('setActiveChatSession', { sessionId: controller.store.state.sessionId || null });
	// K-026: review state is per session; drop the previous session's panel, then ask the host.
	controller.store.patch({ review: { enabled: false, busy: false, files: [] } });
	void controller.runReview('status');
	void controller.refreshHooks();
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
	const sessionId = ensureSessionId(controller);
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
			workspaceDirectory: controller.workspaceDirectory,
			history: knoxGuiHistoryToSessionHistory(history),
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
		const name = String(fn?.name ?? call.name ?? 'tool');
		return {
			id: String(state.toolCallId ?? call.id ?? generateUuid()),
			name,
			arguments: args,
			status: String(state.status ?? 'done') as IKnoxGuiToolCall['status'],
			outputItems,
			output: capDisplayText(toolOutputText(outputItems, textFromUnknown(state.output))).text,
			parsedArgs: parsed,
			questions: isAskUserToolName(name) ? parseAskQuestions(parsed) : undefined,
			answers: asRecord(state.answers) as Record<string, string> | undefined,
		};
	});
	const fromMessage = toolCallsRaw.map(call => {
		const args = String(asRecord(call.function)?.arguments ?? call.arguments ?? '');
		const parsed = parseToolArgs(args);
		const name = String(asRecord(call.function)?.name ?? call.name ?? 'tool');
		return {
			id: String(call.id ?? generateUuid()),
			name,
			arguments: args,
			status: 'done' as const,
			output: call.output ? capDisplayText(textFromUnknown(call.output)).text : undefined,
			parsedArgs: parsed,
			questions: isAskUserToolName(name) ? parseAskQuestions(parsed) : undefined,
		};
	});
	const reasoning = asRecord(item.reasoning);
	const content = textFromUnknown(message.content);
	const images = imagesFromUnknown(message.content) ?? imagesFromUnknown(item.images);
	const contextItems = contextItemsFromRaw(item.contextItems);
	const editorState = item.editorState ?? message.editorState;
	const inputDoc = Array.isArray(editorState) ? editorState as IKnoxGuiHistoryItem['inputDoc'] : (content ? inputDocFromPlainText(content) : undefined);
	return {
		id: String(message.id ?? item.id ?? `m-${index}`),
		role: role === 'user' || role === 'system' || role === 'thinking' || role === 'tool' ? role : 'assistant',
		content,
		thinking: reasoning && typeof reasoning.text === 'string' ? reasoning.text : typeof item.thinking === 'string' ? item.thinking : thinkingFromUnknown(message.content),
		thinkingStartAt: typeof item.thinkingStartAt === 'number' ? item.thinkingStartAt : typeof reasoning?.startAt === 'number' ? reasoning.startAt : undefined,
		thinkingEndAt: typeof item.thinkingEndAt === 'number' ? item.thinkingEndAt : typeof reasoning?.endAt === 'number' ? reasoning.endAt : undefined,
		redactedThinking: typeof item.redactedThinking === 'string' ? item.redactedThinking : typeof message.redactedThinking === 'string' ? message.redactedThinking : undefined,
		thinkingSignature: typeof item.thinkingSignature === 'string' ? item.thinkingSignature : typeof message.signature === 'string' ? message.signature : undefined,
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
		const usageRec = asRecord(rec.usage);
		logs.push({
			modelTitle: typeof rec.modelTitle === 'string' ? rec.modelTitle : undefined,
			prompt: typeof rec.prompt === 'string' ? rec.prompt : undefined,
			completion: typeof rec.completion === 'string' ? rec.completion : undefined,
			usage: usageRec && (typeof usageRec.promptTokens === 'number' || typeof usageRec.completionTokens === 'number')
				? {
					promptTokens: typeof usageRec.promptTokens === 'number' ? usageRec.promptTokens : undefined,
					completionTokens: typeof usageRec.completionTokens === 'number' ? usageRec.completionTokens : undefined,
				}
				: undefined,
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

export function enterEditMode(controller: KnoxGuiController, options: { clearSession: boolean; deferFocusMs?: number }): void {
	const current = controller.store.state.mode;
	const editReturnMode = knoxGuiIsSessionTabMode(current)
		? current
		: knoxGuiModeAfterEditExit(controller.store.state.editReturnMode, undefined, controller.store.state.toolsSupported);
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
		editReturnMode,
		inputFocused: options.deferFocusMs === undefined,
		addFileOpen: false,
	});
	postSetAgentMode(controller);
	if (options.deferFocusMs !== undefined) {
		// useWebviewListeners.ts focusEditWithoutClear: the composer only takes focus after a delay (not while the session saves).
		setTimeout(() => {
			if (controller.store.state.mode === 'edit') {
				controller.store.patch({ inputFocused: true });
			}
		}, options.deferFocusMs);
	}
}

export async function exitEditMode(controller: KnoxGuiController, nextMode?: KnoxChatMode, options?: { restoreLastSession?: boolean }): Promise<void> {
	if (controller.store.state.mode !== 'edit') {
		controller.messenger.post('focusEditor', undefined);
		return;
	}
	const shouldFocus = shouldFocusEditorOnEditExit(controller.store.state);
	for (const code of controller.store.state.codeToEdit) {
		controller.messenger.post('rejectDiff', { filepath: code.filepath });
	}
	controller.messenger.post('edit/exit', { shouldFocusEditor: shouldFocus });
	const mode = knoxGuiModeAfterEditExit(controller.store.state.editReturnMode, nextMode, controller.store.state.toolsSupported);
	controller.store.patch({
		codeToEdit: [],
		addFileOpen: false,
		mode,
		editReturnMode: undefined,
		editStatus: 'done',
		editPreviousInputs: [],
		editFileAfterEdit: undefined,
		inputFocused: false,
	});
	postSetAgentMode(controller);
	if (options?.restoreLastSession !== false) {
		await loadLastSession(controller);
	}
}

export function focusHostEditor(controller: KnoxGuiController): void {
	controller.messenger.post('focusEditor', undefined);
}

export async function resolveWorkspaceDirectory(controller: KnoxGuiController): Promise<string> {
	try {
		const dirs = await controller.messenger.request<string[]>('getWorkspaceDirs', undefined);
		controller.workspaceDirectory = Array.isArray(dirs) && typeof dirs[0] === 'string' ? dirs[0] : '';
	} catch {
		controller.workspaceDirectory = '';
	}
	return controller.workspaceDirectory;
}

/** `refreshSessionMetadata`: sessions of the current workspace only. */
export async function refreshHistorySessions(controller: KnoxGuiController): Promise<void> {
	try {
		const sessions = await controller.messenger.request<Array<Record<string, unknown>>>('history/list', { workspaceDirectory: controller.workspaceDirectory });
		if (Array.isArray(sessions)) {
			controller.store.patch({
				historySessions: sessions.map(session => ({
					id: String(session.sessionId ?? session.id ?? ''),
					title: String(session.title ?? 'Session'),
					date: String(session.date ?? session.dateCreated ?? session.timestamp ?? ''),
					workspaceDirectory: session.workspaceDirectory ? String(session.workspaceDirectory) : undefined,
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
			? { title: controller.store.state.sessionTitle, history: controller.store.state.history, workspaceDirectory: controller.workspaceDirectory || undefined }
			: await controller.messenger.request<Record<string, unknown>>('history/load', { id });
		const title = String(session?.title ?? 'session');
		const history = Array.isArray(session?.history)
			? (session.history as Array<Record<string, unknown>>).map(item => {
				const rec = asRecord(item) ?? {};
				const message = asRecord(rec.message) ?? rec;
				return { role: String(message.role ?? rec.role ?? 'assistant'), content: textFromUnknown(message.content ?? rec.content) };
			})
			: controller.store.state.history.map(item => ({ role: item.role, content: item.content }));
		const markdown = formatSessionExportMarkdown({ title, workspaceDirectory: session?.workspaceDirectory ? String(session.workspaceDirectory) : undefined, history }, new Date(), key => knoxGuiT(controller.store.state.language, key));
		const filename = sessionExportFilename(title);
		const dirs = await controller.messenger.request<string[]>('getWorkspaceDirs', undefined).catch(() => []);
		const workspaceDir = Array.isArray(dirs) ? String(dirs[0] ?? '').replace(/^file:\/\//, '') : '';
		const filePath = workspaceDir ? `${workspaceDir}/${filename}` : `/tmp/${filename}`;
		const fileUrl = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
		await controller.messenger.request('writeFile', { path: fileUrl, contents: markdown });
		await controller.messenger.request('openFile', { path: fileUrl });
		controller.messenger.post('showToast', ['info', knoxGuiT(controller.store.state.language, 'sessionExportedTo', { filename })]);
	} catch (error) {
		controller.messenger.post('showToast', ['error', knoxGuiT(controller.store.state.language, 'failedToExportSession', { error: error instanceof Error ? error.message : String(error) })]);
	}
}

/** K-043: pinned sessions live in profile storage, so they follow the user across workspaces. */
export function togglePinnedSession(controller: KnoxGuiController, id: string): void {
	const pinnedSessionIds = knoxGuiTogglePinned(controller.store.state.pinnedSessionIds, id);
	controller.store.patch({ pinnedSessionIds });
	controller.storageService.store(KNOX_PINNED_SESSIONS_KEY, knoxGuiSerializePinned(pinnedSessionIds), StorageScope.PROFILE, StorageTarget.USER);
}

const HISTORY_SEARCH_DEBOUNCE_MS = 250;
let historySearchTimer: ReturnType<typeof setTimeout> | undefined;
let historySearchSeq = 0;

/** K-043: the host searches message text; the title filter in the list stays instant. */
export function searchHistoryContent(controller: KnoxGuiController, query: string): void {
	if (historySearchTimer) {
		clearTimeout(historySearchTimer);
		historySearchTimer = undefined;
	}
	const trimmed = query.trim();
	const seq = ++historySearchSeq;
	if (trimmed.length < 2) {
		if (Object.keys(controller.store.state.historyContentHits).length) {
			controller.store.patch({ historyContentHits: {} });
		}
		return;
	}
	historySearchTimer = setTimeout(async () => {
		historySearchTimer = undefined;
		try {
			const hits = await controller.messenger.request<Array<{ sessionId: string; snippet: string }>>('history/search', { query: trimmed, workspaceDirectory: controller.workspaceDirectory });
			if (seq !== historySearchSeq || !Array.isArray(hits)) {
				return;
			}
			controller.store.patch({ historyContentHits: Object.fromEntries(hits.map(hit => [String(hit.sessionId), String(hit.snippet)])) });
		} catch {
			// content search is optional; the title filter still works
		}
	}, HISTORY_SEARCH_DEBOUNCE_MS);
}

/**
 * K-043: continue from one message in a new session. The original stays as it was; the fork is
 * saved first and then opened through the normal load path.
 */
export async function forkSession(controller: KnoxGuiController, index: number): Promise<void> {
	const state = controller.store.state;
	if (state.isStreaming) {
		return;
	}
	const forked = knoxGuiForkHistory(state.history, index);
	if (!forked.length) {
		return;
	}
	await controller.saveCurrentSession();
	const id = generateUuid();
	const title = knoxGuiForkTitle(state.sessionTitle || controller.sessionTitleFallback(), knoxGuiT(state.language, 'forkSuffix'));
	try {
		await controller.messenger.request('history/save', {
			sessionId: id,
			title,
			workspaceDirectory: controller.workspaceDirectory,
			history: knoxGuiHistoryToSessionHistory(forked),
		});
	} catch (error) {
		controller.messenger.post('showToast', ['error', knoxGuiT(state.language, 'forkFailed', { error: error instanceof Error ? error.message : String(error) })]);
		return;
	}
	await controller.loadSession(id, { saveCurrent: false });
	// Forking at a user message: that message is not in the fork, so offer its text for editing.
	const source = state.history[index];
	if (source?.role === 'user') {
		controller.store.patch({ input: source.content, inputDoc: inputDocFromPlainText(source.content) });
	}
	void controller.refreshHistorySessions();
}
