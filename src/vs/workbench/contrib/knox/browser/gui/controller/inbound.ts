/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray } from './helpers.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { applyKnoxGuiAutonomousEvent, parseBackgroundJob, parseBackgroundJobs, parseCompactionPayload } from '../../../common/knoxGuiPanels.js';
import { parseCheckpointRestored } from '../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiMessage, KNOX_GUI_PATH_BY_ROUTE, KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { knoxGuiNextEditStatus, mergeCodeToEdit, parseCodeToEditList } from '../../../common/knoxGuiEdit.js';
import { knoxGuiHostAgentActiveFromPayload, knoxGuiModeAfterHostAgentFlag } from '../../../common/knoxGuiAgentMode.js';
import { IKnoxGuiState, KnoxModelRole, knoxGuiIsDedicatedEditor } from '../../../common/knoxGuiState.js';
import { applyKnoxGuiSetColors, applyKnoxGuiSetTheme } from '../../../common/knoxGuiTheme.js';
import { parseTokensPerDay, parseTokensPerModel } from '../../../common/knoxGuiStats.js';

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

export async function handleInbound(controller: KnoxGuiController, type: string, data: unknown, messageId: string): Promise<void> {
	if (knoxGuiIsDedicatedEditor(controller.store.state) && KNOX_GUI_CHAT_ONLY_INBOUND.has(type)) {
		return;
	}
	const rec = asRecord(data);
	switch (type) {
		case 'newSession':
			await controller.newSession();
			return;
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
				controller.store.setInput('');
				controller.store.patch({ inputFocused: true });
			} else {
				controller.store.patch({ inputFocused: true });
			}
			return;
		case 'isKnoxInputFocused':
			controller.messenger.post(type, controller.store.state.inputFocused, messageId);
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
				controller.store.setInput(rec.input);
				await controller.submit();
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
			if (controller.store.state.mentionOpen) {
				void controller.loadMentions(controller.store.state.suggestQuery);
			}
			return;
		case 'addContextItem':
			if (rec) {
				const item = asRecord(rec.item) ?? rec;
				controller.store.patch({
					contextItems: [...controller.store.state.contextItems, { name: String(item.name ?? 'context'), content: String(item.content ?? ''), provider: item.provider ? String(item.provider): undefined }],
				});
			}
			return;
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
			controller.enterEditMode({ clearSession: false });
			controller.store.patch({ inputFocused: true });
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
					filepath: rec.filepath ? String(rec.filepath): undefined,
					status: String(rec.status ?? 'done'),
					numDiffs: typeof rec.numDiffs === 'number' ? rec.numDiffs : undefined,
				});
				controller.store.patch({ applyStates: rest });
				controller.schedulePendingFilesReload();
			}
			return;
		case 'agentStreamingUpdate':
			if (rec && typeof rec.content === 'string') {
				controller.store.updateLastAssistant(rec.content);
				controller.store.setStreaming(!rec.isComplete);
			}
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
					controller.store.patch({ backgroundJobs: listed, jobsPanelOpen: listed.length > 0 ? true : controller.store.state.jobsPanelOpen });
					return;
				}
				const job = parseBackgroundJob(rec.job ?? rec);
				if (job) {
					const jobs = controller.store.state.backgroundJobs.filter(existing => existing.id !== job.id);
					jobs.push(job);
					controller.store.patch({ backgroundJobs: jobs, jobsPanelOpen: true });
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
				void controller.loadMemory();
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
	if (path === '/stats') {
		await loadStats(controller);
	}
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

/** KN-372: hydrate the stats page from Core local token tables. */
export async function loadStats(controller: KnoxGuiController): Promise<void> {
	const [daily, models] = await Promise.allSettled([
		controller.messenger.request<unknown>('stats/getTokensPerDay', undefined),
		controller.messenger.request<unknown>('stats/getTokensPerModel', undefined),
	]);
	const patch: Partial<IKnoxGuiState> = {};
	if (daily.status === 'fulfilled') {
		patch.statsDaily = parseTokensPerDay(daily.value);
	}
	if (models.status === 'fulfilled') {
		patch.statsByModel = parseTokensPerModel(models.value);
	}
	if (patch.statsDaily || patch.statsByModel) {
		controller.store.patch(patch);
	}
}
