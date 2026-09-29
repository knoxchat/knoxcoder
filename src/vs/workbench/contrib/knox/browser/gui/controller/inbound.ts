/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray, contextItemFromRaw } from './helpers.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { applyKnoxGuiAutonomousEvent, parseBackgroundJob, parseBackgroundJobs, parseCompactionPayload } from '../../../common/knoxGuiPanels.js';
import { parseCheckpointRestored } from '../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiMessage, KNOX_GUI_HOST_INBOUND_EMPTY_ACK, KNOX_GUI_PATH_BY_ROUTE, KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { knoxGuiNextEditStatus, mergeCodeToEdit, parseCodeToEditList } from '../../../common/knoxGuiEdit.js';
import { knoxGuiHostAgentActiveFromPayload, knoxGuiModeAfterHostAgentFlag } from '../../../common/knoxGuiAgentMode.js';
import { IKnoxGuiState, KnoxModelRole, knoxGuiIsDedicatedEditor } from '../../../common/knoxGuiState.js';
import { applyKnoxGuiSetColors, applyKnoxGuiSetTheme } from '../../../common/knoxGuiTheme.js';
import { insertTextAtCaret } from '../../../common/knoxGuiInput.js';

export function onHostMessage(controller: KnoxGuiController, message: IKnoxGuiMessage): void {
	void controller.handleInbound(message.messageType, message.data, message.messageId);
}

/** Host AgentModeManager switch → GUI session.mode. Edit is only left when turning agent on. */
function applyHostAgentMode(controller: KnoxGuiController, active: boolean): void {
	const next = knoxGuiModeAfterHostAgentFlag(controller.store.state.mode, active);
	if (!next) {
		return;
	}
	if (controller.store.state.mode === 'edit') {
		void controller.exitEditMode(next);
		return;
	}
	controller.store.setMode(next);
}

const KNOX_GUI_CHAT_ONLY_INBOUND = new Set([
	'newSession',
	'newSessionWithPrompt',
	'focusKnoxInputWithNewSession',
	'focusKnoxInput',
	'focusKnoxInputWithoutClear',
	'isKnoxInputFocused',
	'getWebviewHistoryLength',
	'getCurrentSessionId',
	'getDefaultModelTitle',
	'getActiveChatSession',
	'addModel',
	'navigateTo',
	'userInput',
	'highlightedCode',
	'addCodeToEdit',
	'focusKnoxSessionId',
	'applyCodeFromChat',
	'focusEdit',
	'focusEditWithoutClear',
	'exitEditMode',
	'setEditStatus',
	'agentStreamingUpdate',
	'tools/partialOutput',
	'agent/jobUpdate',
	'compaction/applied',
	'addImageAttachment',
	'addContextItem',
	'agentModeChanged',
]);

/** `useNavigationListener.ts` openGUITypes: return to chat from secondary pages first. */
const KNOX_GUI_OPEN_CHAT_INBOUND = new Set(['highlightedCode', 'focusKnoxInput', 'focusKnoxInputWithoutClear', 'newSession']);

/** `useWebviewListeners.ts` focusEditWithoutClear: `focus('end')` runs after 2 s. */
export const KNOX_FOCUS_EDIT_WITHOUT_CLEAR_DELAY_MS = 2000;

/** KP-040: host-only requests with no GUI handler; empty-ack keeps the host promise from hanging. */
const KNOX_GUI_UNHANDLED_HOST_REQUESTS = new Set<string>(KNOX_GUI_HOST_INBOUND_EMPTY_ACK);

/** `CheckpointGraphPage` `useMirroredChatSession`: follow the chat view's session without loading it. */
function mirrorChatSession(controller: KnoxGuiController, data: unknown): void {
	const raw = asRecord(data)?.sessionId;
	const next = typeof raw === 'string' ? raw : '';
	if (next === controller.store.state.checkpointChatSessionId) {
		return;
	}
	controller.store.patch({ checkpointChatSessionId: next });
	if (controller.store.state.checkpointView === 'checkpoints') {
		void controller.loadCheckpointList();
	}
}

export async function handleInbound(controller: KnoxGuiController, type: string, data: unknown, messageId: string): Promise<void> {
	if (type === 'activeChatSessionChanged' && controller.store.state.lockedRoute === KnoxGuiRoute.CheckpointGraph) {
		mirrorChatSession(controller, data);
		return;
	}
	if (knoxGuiIsDedicatedEditor(controller.store.state) && KNOX_GUI_CHAT_ONLY_INBOUND.has(type)) {
		return;
	}
	const rec = asRecord(data);
	if (KNOX_GUI_OPEN_CHAT_INBOUND.has(type)) {
		controller.store.navigate('/');
	}
	switch (type) {
		case 'newSession':
			{
				// Original Layout.tsx: after saveCurrentSession({ openNewSession }) always exitEditMode() (reject diffs, edit/exit, leave Cmd+I).
				// The original newSession reducer keeps codeToEdit, so exitEditMode still rejects those diffs; keep them across the reset.
				const editCode = controller.store.state.mode === 'edit' ? controller.store.state.codeToEdit : undefined;
				await controller.newSession();
				if (editCode && controller.store.state.mode === 'edit') {
					controller.store.patch({ codeToEdit: editCode });
					await controller.exitEditMode(undefined, { restoreLastSession: false });
				}
				return;
			}
		case 'newSessionWithPrompt':
			await controller.newSession();
			if (rec && typeof rec.prompt === 'string') {
				controller.store.setInput(rec.prompt);
				await controller.submit();
			}
			return;
		case 'focusKnoxInputWithNewSession':
			await controller.newSession();
			controller.store.patch({ inputFocused: true });
			return;
		case 'focusKnoxInput':
		case 'focusKnoxInputWithoutClear':
			if (type === 'focusKnoxInput') {
				controller.store.patch({ codeToEdit: [] });
				if (controller.store.state.history.length) {
					await controller.saveCurrentSession({ generateTitle: true });
				}
			}
			controller.store.patch({ inputFocused: true });
			return;
		case 'isKnoxInputFocused':
			// Layout.tsx only lets the chat page (ROUTES.HOME) answer; every other page reports false.
			controller.messenger.post(type, controller.store.state.route === KnoxGuiRoute.Chat && controller.store.state.inputFocused, messageId);
			return;
		case 'getWebviewHistoryLength':
			controller.messenger.post(type, controller.store.state.history.length, messageId);
			return;
		case 'getCurrentSessionId':
			controller.messenger.post(type, controller.store.state.sessionId, messageId);
			return;
		case 'getDefaultModelTitle':
			controller.messenger.post(type, controller.store.state.modelTitle, messageId);
			return;
		case 'getActiveChatSession':
			controller.messenger.post(type, { sessionId: controller.store.state.sessionId || null }, messageId);
			return;
		case 'addModel':
			controller.openAddModel(rec?.role ? String(rec.role) as KnoxModelRole : 'chat', { bulk: !rec?.role || rec.role === 'chat' });
			return;
		case 'addApiKey':
			// Quota notification "Add API Key": route to the same Add Model flow as `addModel`, then answer the host request.
			controller.openAddModel('chat', { bulk: true });
			controller.messenger.post(type, undefined, messageId);
			return;
		case 'focusKnoxSessionId':
			if (rec?.sessionId) {
				await controller.loadSession(String(rec.sessionId));
			}
			return;
		case 'navigateTo':
			if (rec && typeof rec.path === 'string') {
				controller.store.navigate(rec.path, Boolean(rec.toggle));
			}
			return;
		case 'userInput':
			if (rec && typeof rec.input === 'string') {
				// useWebviewListeners.ts: `editor.commands.insertContent(data.input)` at the caret, then onEnter({ noContext: true }).
				const inserted = insertTextAtCaret(controller.store.state.inputDoc, controller.composerCaret, rec.input);
				controller.composerCaret = inserted.caret;
				controller.store.setInputDoc(inserted.doc);
				await controller.submit(undefined, { noContext: true });
			}
			return;
		case 'highlightedCode':
			if (rec) {
				controller.applyHighlightedCode(rec);
			}
			return;
		case 'addCodeToEdit': {
			const added = parseCodeToEditList(rec ?? data);
			if (added.length) {
				controller.store.patch({
					codeToEdit: mergeCodeToEdit(controller.store.state.codeToEdit, added),
					mode: 'edit',
					inputFocused: true,
				});
			}
			return;
		}
		case 'refreshSubmenuItems':
			controller.submenuItems.clear();
			controller.submenuIndexing = false;
			if (controller.store.state.mentionOpen) {
				void controller.loadMentions(controller.store.state.suggestQuery);
			}
			return;
		case 'addContextItem': { // `addContextItemsAtIndex`: attach to the history item the slash command ran for
			const item = asRecord(rec?.item);
			const index = rec?.historyIndex;
			const target = typeof index === 'number' ? controller.store.state.history[index] : undefined;
			if (item && target) {
				controller.patchHistoryItem(target.id, {
					contextItems: [...(target.contextItems ?? []), contextItemFromRaw(item)!],
				});
			}
			return;
		}
		case 'addImageAttachment':
			if (rec && typeof rec.imageUrl === 'string') {
				controller.store.patch({
					images: [...controller.store.state.images, { name: String(rec.name ?? 'image'), imageUrl: rec.imageUrl }],
					inputFocused: true,
				});
			}
			return;
		case 'setInactive':
			controller.store.setStreaming(false);
			return;
		case 'configUpdate':
			controller.applyConfig(rec);
			return;
		case 'didChangeAvailableProfiles':
			controller.applyProfiles(rec);
			void controller.messenger.request('config/getSerializedProfileInfo', undefined).then(profile => controller.applyConfig(profile as Record<string, unknown>)).catch(() => undefined);
			return;
		case 'setTheme': { // KN-370
			const patch = applyKnoxGuiSetTheme(controller.store.state, rec ?? data);
			if (patch) {
				controller.store.patch(patch);
			}
			return;
		}
		case 'setColors': {
			const patch = applyKnoxGuiSetColors(controller.store.state, rec ?? data);
			if (patch) {
				controller.store.patch(patch);
			}
			return;
		}
		case 'didCloseFiles': {
			const closed = new Set(asArray(rec?.files ?? rec?.uris ?? rec).map(item => String(asRecord(item)?.path ?? asRecord(item)?.uri ?? item)));
			if (closed.size) {
				controller.store.patch({ codeToEdit: controller.store.state.codeToEdit.filter(file => !closed.has(file.filepath)) });
			}
			return;
		}
		case 'setEditStatus': {
			const status = rec && typeof rec.status === 'string' ? rec.status : undefined;
			if (status) {
				const next = knoxGuiNextEditStatus(controller.store.state.editStatus, status);
				if (next) {
					controller.store.patch({
						editStatus: next,
						editFileAfterEdit: rec?.fileAfterEdit != null ? String(rec.fileAfterEdit) : controller.store.state.editFileAfterEdit,
					});
				}
			}
			return;
		}
		case 'exitEditMode':
			await controller.exitEditMode();
			return;
		case 'focusEdit':
			controller.enterEditMode({ clearSession: true });
			return;
		case 'focusEditWithoutClear':
			controller.enterEditMode({ clearSession: false, deferFocusMs: KNOX_FOCUS_EDIT_WITHOUT_CLEAR_DELAY_MS });
			return;
		case 'agentModeChanged': {
			const active = knoxGuiHostAgentActiveFromPayload(data);
			if (active === undefined) {
				return;
			}
			applyHostAgentMode(controller, active);
			return;
		}
		case 'applyCodeFromChat':
			controller.applyCodeFromChat();
			return;
		case 'updateApplyState':
			if (rec) {
				const streamId = String(rec.streamId ?? rec.id ?? generateUuid());
				const rest = controller.store.state.applyStates.filter(state => state.streamId !== streamId);
				rest.push({
					streamId,
					filepath: rec.filepath ? String(rec.filepath) : undefined,
					status: String(rec.status ?? 'done'),
					numDiffs: typeof rec.numDiffs === 'number' ? rec.numDiffs : undefined,
				});
				controller.store.patch({ applyStates: rest });
				controller.schedulePendingFilesReload();
			}
			return;
		case 'agentStreamingUpdate': // agentModeStreamingMiddleware.ts: the chat stream already renders the reply
			return;
		case 'tools/partialOutput':
			if (rec && typeof rec.toolCallId === 'string') {
				controller.partialOutputCoalescer.enqueue(rec.toolCallId, rec.contextItems ?? rec.output);
			}
			return;
		case 'agent/jobUpdate':
			if (rec) {
				const listed = parseBackgroundJobs(rec.jobs);
				if (listed.length || Array.isArray(rec.jobs)) {
					// Never touch `jobsPanelOpen` here: new jobs must not override the user's expand/collapse choice.
					controller.store.patch({ backgroundJobs: listed });
					return;
				}
				const job = parseBackgroundJob(rec.job ?? rec);
				if (job) {
					const jobs = controller.store.state.backgroundJobs.filter(existing => existing.id !== job.id);
					jobs.push(job);
					controller.store.patch({ backgroundJobs: jobs });
				}
			}
			return;
		case 'compaction/applied':
			controller.store.patch({ compaction: parseCompactionPayload(rec) });
			return;
		case 'guiLanguageChanged':
			if (rec && (rec.language === 'en' || rec.language === 'zh')) {
				controller.store.setLanguage(rec.language);
			}
			return;
		case 'knoxchat/oauth/update':
			controller.applyOAuthStatus(data);
			return;
		case 'gitStateChanged':
			void controller.refreshGitDiff(true);
			return;
		case 'checkpointListUpdated':
		case 'checkpointGraphUpdated':
			void controller.loadCheckpoints();
			return;
		case 'checkpointRestored': {
			const restored = parseCheckpointRestored(rec);
			if (restored) {
				const sessionId = restored.sessionId || controller.store.state.sessionId;
				controller.store.patch({ restoreNotice: sessionId ? { sessionId, content: restored.notice } : undefined });
				if (sessionId && sessionId === controller.store.state.sessionId && !knoxGuiIsDedicatedEditor(controller.store.state)) {
					void controller.loadSession(sessionId, { saveCurrent: false });
				}
			}
			void controller.loadCheckpoints();
			return;
		}
		case 'memoryViewUpdated':
		case 'brain/memoryEvent':
			if (rec && typeof rec.type === 'string' && rec.type.startsWith('autonomous:')) {
				const patch = applyKnoxGuiAutonomousEvent(controller.store.state, rec);
				if (patch) {
					controller.store.patch(patch);
				}
			}
			if (controller.store.state.route === KnoxGuiRoute.Memory) {
				controller.refreshMemoryActiveTab();
			}
			return;
		case 'activeChatSessionChanged':
			if (knoxGuiIsDedicatedEditor(controller.store.state)) {
				return;
			}
			if (rec && rec.sessionId && String(rec.sessionId) !== controller.store.state.sessionId) {
				await controller.loadSession(String(rec.sessionId));
			}
			return;
		default:
			if (KNOX_GUI_UNHANDLED_HOST_REQUESTS.has(type)) {
				controller.messenger.post(type, undefined, messageId);
			}
			return;
	}
}

export function onRouteChanged(controller: KnoxGuiController, state: IKnoxGuiState): void {
	if (state.route === controller.lastRoute && state.providerName === controller.lastProviderName) {
		return;
	}
	controller.lastRoute = state.route;
	controller.lastProviderName = state.providerName;
	const path = state.route === KnoxGuiRoute.AddModelProvider && state.providerName
		? `/addModel/provider/${state.providerName}`
		: KNOX_GUI_PATH_BY_ROUTE[state.route];
	void controller.onNavigated(path);
}

export async function onNavigated(controller: KnoxGuiController, path: string): Promise<void> {
	if (path === '/batch-diff') {
		await controller.loadPendingFiles();
	}
	if (path === '/memory') {
		await controller.hydrateMemoryTab();
		await controller.loadMemory();
	}
	if (path === '/addModel' || path.startsWith('/addModel/provider/')) {
		await controller.loadOAuthStatus();
		if (controller.store.state.providerName === 'knoxchat' || path === '/addModel') {
			void controller.loadKnoxChatModels();
		}
	}
	if (path === '/checkpoint-graph') {
		await controller.loadCheckpoints();
	}
}
