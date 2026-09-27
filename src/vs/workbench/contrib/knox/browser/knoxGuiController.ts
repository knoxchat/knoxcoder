/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { createStreamUpdateCoalescer } from '../common/knoxGuiChat.js';
import { createLatestValueCoalescer } from '../common/knoxGuiTools.js';
import { IKnoxGuiMessage, KnoxGuiOverlay, KnoxGuiRoute } from '../common/knoxGuiProtocol.js';
import { IKnoxGuiFindState, IKnoxGuiGitDiffFile, IKnoxGuiHistoryItem, IKnoxGuiModel, IKnoxGuiState, IKnoxGuiSuggestItem, IKnoxGuiToolCall, KnoxChatMode, KnoxCheckpointPanelTab, KnoxGuiLanguage, KnoxModelRole, KnoxPermissionMode } from '../common/knoxGuiState.js';
import { type IKnoxGuiAddModelPackage } from '../common/knoxGuiOverlays.js';
import { fileHitToSuggestItem, inputDocFromPlainText } from '../common/knoxGuiInput.js';
import { DEFAULT_CHECKPOINT_CONFIG } from '../common/knoxGuiCheckpoints.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { BOOKMARK_KEY, LANGUAGE_KEY } from './gui/controller/helpers.js';
import * as knoxGuiConfig from './gui/controller/config.js';
import * as knoxGuiInbound from './gui/controller/inbound.js';
import * as knoxGuiSessions from './gui/controller/sessions.js';
import * as knoxGuiModels from './gui/controller/models.js';
import * as knoxGuiComposer from './gui/controller/composer.js';
import * as knoxGuiStream from './gui/controller/stream.js';
import * as knoxGuiTools from './gui/controller/tools.js';
import * as knoxGuiPanels from './gui/controller/panels.js';
import * as knoxGuiMemory from './gui/controller/memory.js';
import * as knoxGuiCheckpoints from './gui/controller/checkpoints.js';

export class KnoxGuiController extends Disposable {
	streamCancel: CancellationTokenSource | undefined;
	mentionLiveTimer: ReturnType<typeof setTimeout> | undefined;
	pendingFilesTimer: ReturnType<typeof setTimeout> | undefined;
	gitPollTimer: ReturnType<typeof setInterval> | undefined;
	heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	heartbeatCleanup: (() => void) | undefined;
	lastGitFetch = 0;
	wasStreaming = false;
	lastRoute: KnoxGuiRoute | undefined;
	lastProviderName: string | undefined;
	checkpointGraphUiLoaded = false;
	readonly partialOutputCoalescer = createLatestValueCoalescer<string, unknown>((id, value) => this.applyPartialToolOutput(id, value));
	readonly streamCoalescer = createStreamUpdateCoalescer<{ content: string; toolCalls: IKnoxGuiToolCall[]; thinking?: string }>(
		value => {
			this.store.updateLastAssistant(value.content, value.toolCalls);
			if (value.thinking) {
				this.patchLastThinking(value.thinking);
			}
		},
		{ flushNow: value => value.toolCalls.length > 0 },
	);

	constructor(
		readonly store: KnoxGuiStore,
		readonly messenger: KnoxGuiMessenger,
		@IStorageService readonly storageService: IStorageService,
	) {
		super();
		const language = this.storageService.get(LANGUAGE_KEY, StorageScope.PROFILE, 'en');
		if (language === 'zh' || language === 'en') {
			this.store.setLanguage(language);
		}
		const bookmarked = this.storageService.get(BOOKMARK_KEY, StorageScope.PROFILE, '');
		if (bookmarked) {
			this.store.patch({ bookmarkedSlash: bookmarked.split(',').filter(Boolean) });
		}
		this.messenger.subscribeHost(message => this.onHostMessage(message));
		this._register(store.onDidChange(state => this.onRouteChanged(state)));
		this._register({ dispose: () => this.partialOutputCoalescer.dispose() });
		this._register({ dispose: () => this.streamCoalescer.dispose() });
		this._register({ dispose: () => this.clearGitPoll() });
		this._register({ dispose: () => this.clearHeartbeat() });
		this._register({ dispose: () => {
			if (this.pendingFilesTimer) {
				clearTimeout(this.pendingFilesTimer);
			}
		} });
		void this.setup();
	}

	async setup(): Promise<void> {
		return knoxGuiConfig.setup(this);
	}

	applyConfig(payload: Record<string, unknown> | undefined): void {
		return knoxGuiConfig.applyConfig(this, payload);
	}

	applyProfiles(payload: Record<string, unknown> | undefined): void {
		return knoxGuiConfig.applyProfiles(this, payload);
	}

	onHostMessage(message: IKnoxGuiMessage): void {
		return knoxGuiInbound.onHostMessage(this, message);
	}

	async handleInbound(type: string, data: unknown, messageId: string): Promise<void> {
		return knoxGuiInbound.handleInbound(this, type, data, messageId);
	}

	onRouteChanged(state: IKnoxGuiState): void {
		return knoxGuiInbound.onRouteChanged(this, state);
	}

	async onNavigated(path: string): Promise<void> {
		return knoxGuiInbound.onNavigated(this, path);
	}

	async newSession(): Promise<void> {
		return knoxGuiSessions.newSession(this);
	}

	async loadSession(id: string, options?: { saveCurrent?: boolean }): Promise<void> {
		return knoxGuiSessions.loadSession(this, id, options);
	}

	async activateTab(tabId: string): Promise<void> {
		return knoxGuiSessions.activateTab(this, tabId);
	}

	async closeTab(tabId: string): Promise<void> {
		return knoxGuiSessions.closeTab(this, tabId);
	}

	async deleteSessions(ids: string[]): Promise<void> {
		return knoxGuiSessions.deleteSessions(this, ids);
	}

	syncActiveSession(): void {
		return knoxGuiSessions.syncActiveSession(this);
	}

	sessionTitleFallback(): string {
		return knoxGuiSessions.sessionTitleFallback(this);
	}

	async saveCurrentSession(options?: { generateTitle?: boolean }): Promise<void> {
		return knoxGuiSessions.saveCurrentSession(this, options);
	}

	historyFromRaw(item: Record<string, unknown>, index: number): IKnoxGuiHistoryItem {
		return knoxGuiSessions.historyFromRaw(this, item, index);
	}

	async setLanguage(language: KnoxGuiLanguage): Promise<void> {
		return knoxGuiConfig.setLanguage(this, language);
	}

	async updateSharedConfig(sharedConfig: Record<string, unknown>): Promise<void> {
		return knoxGuiConfig.updateSharedConfig(this, sharedConfig);
	}

	setMode(mode: KnoxChatMode): void {
		return knoxGuiModels.setMode(this, mode);
	}

	async exitEditMode(nextMode?: KnoxChatMode): Promise<void> {
		return knoxGuiSessions.exitEditMode(this, nextMode);
	}

	enterEditMode(options: { clearSession: boolean }): void {
		return knoxGuiSessions.enterEditMode(this, options);
	}

	focusHostEditor(): void {
		return knoxGuiSessions.focusHostEditor(this);
	}

	selectModel(role: KnoxModelRole, title: string | null): void {
		return knoxGuiModels.selectModel(this, role, title);
	}

	cycleChatModel(direction: 1 | -1): void {
		return knoxGuiModels.cycleChatModel(this, direction);
	}

	deleteModel(title: string): void {
		return knoxGuiModels.deleteModel(this, title);
	}

	chatModels(): IKnoxGuiModel[] {
		return knoxGuiModels.chatModels(this);
	}

	setReasoningEffort(effort: string): void {
		return knoxGuiModels.setReasoningEffort(this, effort);
	}

	setOverlay(overlay: KnoxGuiOverlay): void {
		return knoxGuiModels.setOverlay(this, overlay);
	}

	async refreshHistorySessions(): Promise<void> {
		return knoxGuiSessions.refreshHistorySessions(this);
	}

	applyAgentProfile(value: string): void {
		return knoxGuiConfig.applyAgentProfile(this, value);
	}

	savePrompt(draft: { name: string; description: string; prompt: string }): void {
		return knoxGuiComposer.savePrompt(this, draft);
	}

	insertContextProvider(title: string): void {
		return knoxGuiComposer.insertContextProvider(this, title);
	}

	cycleToolPermission(name: string): void {
		return knoxGuiTools.cycleToolPermission(this, name);
	}

	async renameSession(id: string, title: string): Promise<void> {
		return knoxGuiSessions.renameSession(this, id, title);
	}

	async exportSession(id: string): Promise<void> {
		return knoxGuiSessions.exportSession(this, id);
	}

	toggleBookmark(name: string): void {
		return knoxGuiComposer.toggleBookmark(this, name);
	}

	cycleToolSetting(name: string): void {
		return knoxGuiTools.cycleToolSetting(this, name);
	}

	applyToolPreset(preset: 'safe' | 'yolo'): void {
		return knoxGuiTools.applyToolPreset(this, preset);
	}

	toggleToolGroup(group: string): void {
		return knoxGuiTools.toggleToolGroup(this, group);
	}

	updateFind(partial: Partial<IKnoxGuiFindState>): void {
		return knoxGuiComposer.updateFind(this, partial);
	}

	openFind(): void {
		return knoxGuiComposer.openFind(this);
	}

	closeFind(): void {
		return knoxGuiComposer.closeFind(this);
	}

	stepFind(delta: number): void {
		return knoxGuiComposer.stepFind(this, delta);
	}

	async submit(starterPrompt?: string, modifiers?: { noContext?: boolean; altKey?: boolean; index?: number; doc?: ReturnType<typeof inputDocFromPlainText>; images?: string[] }): Promise<void> {
		return knoxGuiStream.submit(this, starterPrompt, modifiers);
	}

	cancel(): void {
		return knoxGuiStream.cancel(this);
	}

	cancelTool(id: string): void {
		return knoxGuiTools.cancelTool(this, id);
	}

	async approveTool(id: string, always?: boolean): Promise<void> {
		return knoxGuiStream.approveTool(this, id, always);
	}

	denyTool(id: string): void {
		return knoxGuiTools.denyTool(this, id);
	}

	answerAskUser(id: string, answers: Record<string, string>): void {
		return knoxGuiTools.answerAskUser(this, id, answers);
	}

	shouldAutoApprove(call: IKnoxGuiToolCall): boolean {
		return knoxGuiTools.shouldAutoApprove(this, call);
	}

	async resolveTools(toolCalls: IKnoxGuiToolCall[]): Promise<void> {
		return knoxGuiTools.resolveTools(this, toolCalls);
	}

	async syncPendingTools(): Promise<void> {
		return knoxGuiTools.syncPendingTools(this);
	}

	async continueAfterTool(): Promise<void> {
		return knoxGuiStream.continueAfterTool(this);
	}

	mergeToolCalls(toolCalls: IKnoxGuiToolCall[], raw: unknown[]): void {
		return knoxGuiTools.mergeToolCalls(this, toolCalls, raw);
	}

	finalizeGeneratingTools(toolCalls: IKnoxGuiToolCall[]): void {
		return knoxGuiTools.finalizeGeneratingTools(this, toolCalls);
	}

	applyPartialToolOutput(id: string, value: unknown): void {
		return knoxGuiTools.applyPartialToolOutput(this, id, value);
	}

	cancelInFlightTools(): void {
		return knoxGuiTools.cancelInFlightTools(this);
	}

	buildMessages(extraContext?: string, images: string[] = []): Array<Record<string, unknown>> {
		return knoxGuiStream.buildMessages(this, extraContext, images);
	}

	async gatherContext(doc: ReturnType<typeof inputDocFromPlainText>, fullInput: string, noContext: boolean): Promise<{ extra?: string }> {
		return knoxGuiStream.gatherContext(this, doc, fullInput, noContext);
	}

	findTool(id: string): IKnoxGuiToolCall | undefined {
		return knoxGuiTools.findTool(this, id);
	}

	patchTool(id: string, patch: Partial<IKnoxGuiToolCall>): void {
		return knoxGuiTools.patchTool(this, id, patch);
	}

	patchLastThinking(thinking: string): void {
		return knoxGuiStream.patchLastThinking(this, thinking);
	}

	finishThinking(): void {
		return knoxGuiStream.finishThinking(this);
	}

	patchHistoryItem(id: string, patch: Partial<IKnoxGuiHistoryItem>): void {
		return knoxGuiStream.patchHistoryItem(this, id, patch);
	}

	async ensureCheckpointForLastAssistant(): Promise<void> {
		return knoxGuiCheckpoints.ensureCheckpointForLastAssistant(this);
	}

	async ensureCheckpoint(item: IKnoxGuiHistoryItem, index: number): Promise<string | undefined> {
		return knoxGuiCheckpoints.ensureCheckpoint(this, item, index);
	}

	restoreCheckpoint(checkpointId: string, rewindMemory = false): void {
		return knoxGuiCheckpoints.restoreCheckpoint(this, checkpointId, rewindMemory);
	}

	deleteMessage(index: number): void {
		return knoxGuiStream.deleteMessage(this, index);
	}

	continueGeneration(): void {
		return knoxGuiStream.continueGeneration(this);
	}

	clearStreamError(): void {
		return knoxGuiStream.clearStreamError(this);
	}

	acceptAllApplies(): void {
		return knoxGuiStream.acceptAllApplies(this);
	}

	rejectAllApplies(): void {
		return knoxGuiStream.rejectAllApplies(this);
	}

	copyText(text: string): void {
		return knoxGuiStream.copyText(this, text);
	}

	async loadMentions(query: string): Promise<void> {
		return knoxGuiComposer.loadMentions(this, query);
	}

	async loadSlash(query: string): Promise<void> {
		return knoxGuiComposer.loadSlash(this, query);
	}

	insertSuggest(item: IKnoxGuiSuggestItem): void {
		return knoxGuiComposer.insertSuggest(this, item);
	}

	applySuggest(item: IKnoxGuiSuggestItem): void {
		return knoxGuiComposer.applySuggest(this, item);
	}

	closeSuggest(): void {
		return knoxGuiComposer.closeSuggest(this);
	}

	exitSuggestSubmenu(): void {
		return knoxGuiComposer.exitSuggestSubmenu(this);
	}

	onComposerInput(): void {
		return knoxGuiComposer.onComposerInput(this);
	}

	beginEditUser(index: number): void {
		return knoxGuiComposer.beginEditUser(this, index);
	}

	cancelEditUser(): void {
		return knoxGuiComposer.cancelEditUser(this);
	}

	async submitEditedUser(index: number, doc: ReturnType<typeof inputDocFromPlainText>, images?: string[]): Promise<void> {
		return knoxGuiComposer.submitEditedUser(this, index, doc, images);
	}

	removeHistoricalImage(index: number): void {
		return knoxGuiComposer.removeHistoricalImage(this, index);
	}

	removeImage(index: number): void {
		return knoxGuiComposer.removeImage(this, index);
	}

	removeContextItem(index: number): void {
		return knoxGuiComposer.removeContextItem(this, index);
	}

	removeCodeToEdit(index: number): void {
		return knoxGuiComposer.removeCodeToEdit(this, index);
	}

	mentionDroppedFile(uri: string): void {
		return knoxGuiComposer.mentionDroppedFile(this, uri);
	}

	async searchAddFiles(query: string): Promise<IKnoxGuiSuggestItem[]> {
		return knoxGuiComposer.searchAddFiles(this, query);
	}

	async addFilesToEdit(uris: string[]): Promise<void> {
		return knoxGuiComposer.addFilesToEdit(this, uris);
	}

	showFile(filepath: string, options?: { startLine?: number; endLine?: number }): void {
		return knoxGuiPanels.showFile(this, filepath, options);
	}

	openGitFile(file: IKnoxGuiGitDiffFile): void {
		return knoxGuiPanels.openGitFile(this, file);
	}

	gitDiffExpanded(): boolean {
		return knoxGuiPanels.gitDiffExpanded(this);
	}

	gitDiffExpandedPinned(): boolean {
		return knoxGuiPanels.gitDiffExpandedPinned(this);
	}

	setGitDiffExpanded(expanded: boolean): void {
		return knoxGuiPanels.setGitDiffExpanded(this, expanded);
	}

	activityPanelExpanded(): boolean {
		return knoxGuiPanels.activityPanelExpanded(this);
	}

	setActivityPanelExpanded(expanded: boolean): void {
		return knoxGuiPanels.setActivityPanelExpanded(this, expanded);
	}

	dismissCompaction(): void {
		return knoxGuiPanels.dismissCompaction(this);
	}

	dismissInjectedMemories(): void {
		return knoxGuiPanels.dismissInjectedMemories(this);
	}

	toggleJobsPanel(): void {
		return knoxGuiPanels.toggleJobsPanel(this);
	}

	async runJobAction(action: 'kill' | 'killAll' | 'dismiss' | 'clear', jobId?: string): Promise<void> {
		return knoxGuiPanels.runJobAction(this, action, jobId);
	}

	async pinInjectedMemory(id: number, pinned: boolean): Promise<void> {
		return knoxGuiPanels.pinInjectedMemory(this, id, pinned);
	}

	async forgetInjectedMemory(id: number): Promise<void> {
		return knoxGuiPanels.forgetInjectedMemory(this, id);
	}

	async mismatchInjectedMemory(id: number): Promise<void> {
		return knoxGuiPanels.mismatchInjectedMemory(this, id);
	}

	async refreshGitDiff(force = false): Promise<void> {
		return knoxGuiPanels.refreshGitDiff(this, force);
	}

	startGitPoll(): void {
		return knoxGuiPanels.startGitPoll(this);
	}

	clearGitPoll(): void {
		return knoxGuiPanels.clearGitPoll(this);
	}

	startHeartbeat(): void {
		return knoxGuiConfig.startHeartbeat(this);
	}

	clearHeartbeat(): void {
		return knoxGuiConfig.clearHeartbeat(this);
	}

	async loadMemoryMode(): Promise<void> {
		return knoxGuiConfig.loadMemoryMode(this);
	}

	async refreshBackgroundJobs(): Promise<void> {
		return knoxGuiPanels.refreshBackgroundJobs(this);
	}

	async injectMemoryContext(userText: string): Promise<string | undefined> {
		return knoxGuiStream.injectMemoryContext(this, userText);
	}

	takeRestoreNotice(): string | undefined {
		return knoxGuiStream.takeRestoreNotice(this);
	}

	scheduleLiveMentionSearch(query: string, existing: ReturnType<typeof fileHitToSuggestItem>[]): void {
		return knoxGuiComposer.scheduleLiveMentionSearch(this, query, existing);
	}

	applyHighlightedCode(rec: Record<string, unknown>): void {
		return knoxGuiComposer.applyHighlightedCode(this, rec);
	}

	pushCodeToEdit(rec: Record<string, unknown>): void {
		return knoxGuiComposer.pushCodeToEdit(this, rec);
	}

	setPermissionMode(mode: KnoxPermissionMode): void {
		return knoxGuiTools.setPermissionMode(this, mode);
	}

	async runWorktree(action: 'enter' | 'apply' | 'discard' | 'status'): Promise<void> {
		return knoxGuiPanels.runWorktree(this, action);
	}

	async loadMemory(): Promise<void> {
		return knoxGuiMemory.loadMemory(this);
	}

	async hydrateMemoryTab(): Promise<void> {
		return knoxGuiMemory.hydrateMemoryTab(this);
	}

	async loadMemoryOverview(): Promise<void> {
		return knoxGuiMemory.loadMemoryOverview(this);
	}

	async loadMemories(append = false): Promise<void> {
		return knoxGuiMemory.loadMemories(this, append);
	}

	async loadMemorySessions(): Promise<void> {
		return knoxGuiMemory.loadMemorySessions(this);
	}

	async loadMemorySessionHistory(sessionId: string): Promise<void> {
		return knoxGuiMemory.loadMemorySessionHistory(this, sessionId);
	}

	async searchMemoryBacklogs(query: string): Promise<void> {
		return knoxGuiMemory.searchMemoryBacklogs(this, query);
	}

	async loadMemoryGraph(append = false): Promise<void> {
		return knoxGuiMemory.loadMemoryGraph(this, append);
	}

	async exploreMemoryEntity(entityId: number): Promise<void> {
		return knoxGuiMemory.exploreMemoryEntity(this, entityId);
	}

	async loadMemoryConfig(): Promise<void> {
		return knoxGuiMemory.loadMemoryConfig(this);
	}

	updateMemoryConfig(key: string, value: unknown): void {
		return knoxGuiMemory.updateMemoryConfig(this, key, value);
	}

	async consolidateMemory(): Promise<void> {
		return knoxGuiMemory.consolidateMemory(this);
	}

	async deleteMemories(ids: string[]): Promise<void> {
		return knoxGuiMemory.deleteMemories(this, ids);
	}

	async pinMemories(ids: string[], pinned: boolean): Promise<void> {
		return knoxGuiMemory.pinMemories(this, ids, pinned);
	}

	async runMemoryMaintenance(action: knoxGuiMemory.KnoxMemoryMaintenanceAction): Promise<void> {
		return knoxGuiMemory.runMemoryMaintenance(this, action);
	}

	async exportMemory(password?: string): Promise<void> {
		return knoxGuiMemory.exportMemory(this, password);
	}

	async importMemoryData(data: string, password?: string): Promise<void> {
		return knoxGuiMemory.importMemoryData(this, data, password);
	}

	async loadCheckpoints(): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpoints(this);
	}

	applyCodeFromChat(): void {
		return knoxGuiStream.applyCodeFromChat(this);
	}

	openSettingsOverlay(): void {
		return knoxGuiModels.openSettingsOverlay(this);
	}

	setCheckpointTab(tab: KnoxCheckpointPanelTab): void {
		return knoxGuiCheckpoints.setCheckpointTab(this, tab);
	}

	async openRestorePreview(checkpointId: string, rewindMemory = false): Promise<void> {
		return knoxGuiCheckpoints.openRestorePreview(this, checkpointId, rewindMemory);
	}

	closeCheckpointDialog(): void {
		return knoxGuiCheckpoints.closeCheckpointDialog(this);
	}

	toggleRestorePath(relativePath: string, checked: boolean): void {
		return knoxGuiCheckpoints.toggleRestorePath(this, relativePath, checked);
	}

	toggleRestoreAll(checked: boolean): void {
		return knoxGuiCheckpoints.toggleRestoreAll(this, checked);
	}

	async restoreSelectedFiles(): Promise<void> {
		return knoxGuiCheckpoints.restoreSelectedFiles(this);
	}

	async restoreAllFiles(): Promise<void> {
		return knoxGuiCheckpoints.restoreAllFiles(this);
	}

	async toggleRestoreDiff(): Promise<void> {
		return knoxGuiCheckpoints.toggleRestoreDiff(this);
	}

	openCompare(checkpointId: string): void {
		return knoxGuiCheckpoints.openCompare(this, checkpointId);
	}

	async openCompareDialog(leftId: string, rightId: string): Promise<void> {
		return knoxGuiCheckpoints.openCompareDialog(this, leftId, rightId);
	}

	async loadCheckpointConfig(): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpointConfig(this);
	}

	patchCheckpointConfig(partial: Partial<typeof DEFAULT_CHECKPOINT_CONFIG>): void {
		return knoxGuiCheckpoints.patchCheckpointConfig(this, partial);
	}

	async saveCheckpointConfig(): Promise<void> {
		return knoxGuiCheckpoints.saveCheckpointConfig(this);
	}

	resetCheckpointConfigToDefaults(): void {
		return knoxGuiCheckpoints.resetCheckpointConfigToDefaults(this);
	}

	cancelCheckpointConfig(): void {
		return knoxGuiCheckpoints.cancelCheckpointConfig(this);
	}

	async loadCheckpointDashboard(): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpointDashboard(this);
	}

	async loadCheckpointAnalysis(checkpointId?: string): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpointAnalysis(this, checkpointId);
	}

	async loadCheckpointAnalysisGroups(): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpointAnalysisGroups(this);
	}

	async loadShareBundles(): Promise<void> {
		return knoxGuiCheckpoints.loadShareBundles(this);
	}

	async shareCheckpoints(): Promise<void> {
		return knoxGuiCheckpoints.shareCheckpoints(this);
	}

	async importShareBundle(filePath: string): Promise<void> {
		return knoxGuiCheckpoints.importShareBundle(this, filePath);
	}

	async revealShareBundle(filePath: string): Promise<void> {
		return knoxGuiCheckpoints.revealShareBundle(this, filePath);
	}

	async loadPendingFiles(): Promise<void> {
		return knoxGuiPanels.loadPendingFiles(this);
	}

	async applyBatchDiff(kind: 'acceptAll' | 'rejectAll' | 'acceptSelected' | 'rejectSelected', fileUris?: string[]): Promise<void> {
		return knoxGuiPanels.applyBatchDiff(this, kind, fileUris);
	}

	openAddModel(role: KnoxModelRole = 'chat', options?: { bulk?: boolean }): void {
		return knoxGuiModels.openAddModel(this, role, options);
	}

	closeAddModelModal(): void {
		return knoxGuiModels.closeAddModelModal(this);
	}

	applyOAuthStatus(data: unknown): void {
		return knoxGuiModels.applyOAuthStatus(this, data);
	}

	async loadOAuthStatus(): Promise<void> {
		return knoxGuiModels.loadOAuthStatus(this);
	}

	async loadKnoxChatModels(): Promise<void> {
		return knoxGuiModels.loadKnoxChatModels(this);
	}

	async addConfiguredModel(providerId: string, pack: IKnoxGuiAddModelPackage, extras?: { dimensionChoices?: string[]; selectedProvider?: string }): Promise<void> {
		return knoxGuiModels.addConfiguredModel(this, providerId, pack, extras);
	}

	async loadReasoningEffortPrefs(): Promise<void> {
		return knoxGuiConfig.loadReasoningEffortPrefs(this);
	}

	schedulePendingFilesReload(): void {
		return knoxGuiPanels.schedulePendingFilesReload(this);
	}

	async pinCheckpoint(checkpointId: string, pinned: boolean): Promise<void> {
		return knoxGuiCheckpoints.pinCheckpoint(this, checkpointId, pinned);
	}

	async loadMoreCheckpoints(): Promise<void> {
		return knoxGuiCheckpoints.loadMoreCheckpoints(this);
	}

	async saveCheckpointGraphUi(partial: Partial<IKnoxGuiState['checkpointGraphUi']>): Promise<void> {
		return knoxGuiCheckpoints.saveCheckpointGraphUi(this, partial);
	}

	async setCheckpointBranchFilter(filter: { branchIds?: string[]; activeBranchOnly?: boolean }): Promise<void> {
		return knoxGuiCheckpoints.setCheckpointBranchFilter(this, filter);
	}

	async setCheckpointWorkspace(path: string): Promise<void> {
		return knoxGuiCheckpoints.setCheckpointWorkspace(this, path);
	}

	async deleteSelectedCheckpoints(ids: string[]): Promise<void> {
		return knoxGuiCheckpoints.deleteSelectedCheckpoints(this, ids);
	}

	async loadCheckpointList(options?: { append?: boolean }): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpointList(this, options);
	}

	async loadCheckpointTimeline(): Promise<void> {
		return knoxGuiCheckpoints.loadCheckpointTimeline(this);
	}

	async ensureCheckpointHead(): Promise<void> {
		return knoxGuiCheckpoints.ensureCheckpointHead(this);
	}

	async createCheckpointBranch(name: string, baseCheckpointId: string): Promise<string | undefined> {
		return knoxGuiCheckpoints.createCheckpointBranch(this, name, baseCheckpointId);
	}

	async switchCheckpointBranch(branchId: string): Promise<void> {
		return knoxGuiCheckpoints.switchCheckpointBranch(this, branchId);
	}
}
