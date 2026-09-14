/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	KNOX_DEFAULT_PERMISSION_MODE,
	KNOX_JOBS_PANEL_STORAGE_KEY,
	KNOX_LUMP_SECTION_STORAGE_KEY,
	KNOX_NEW_CHAT_TITLE,
	KNOX_REASONING_EFFORT_BY_MODEL_STORAGE_KEY,
	KNOX_REASONING_EFFORT_STORAGE_KEY,
	KNOX_TOOL_GROUP_SETTINGS_STORAGE_KEY,
	KNOX_TOOL_SETTINGS_STORAGE_KEY,
	KNOX_WEB_SEARCH_STORAGE_KEY,
	KnoxChatMode,
	KnoxLumpSection,
	KnoxPermissionMode,
	knoxNextPermissionMode,
} from './knoxChat.js';
import {
	findCurrentToolCall,
	findPendingGeneratedToolCalls,
	findToolCallStateById,
	hasUnsettledToolCalls,
	isUserStoppedToolCall,
	shouldAbortToolContinuation,
	shouldResumeAfterUnexpectedAbort,
} from './knoxChatHistory.js';
import {
	applyAbortStream,
	applyAddContextItemsAtIndex,
	applyAddPromptCompletionPair,
	applyAddSessionToolAllowlist,
	applyRemoveSessionToolAllowlist,
	applyApplyAutonomousEvent,
	applyClearDanglingMessages,
	applyHydrateLastAssistant,
	applyNewSession,
	applySetInactive,
	applySetIsGatheringContext,
	applyRemoveInjectedMemory,
	applySetLastCompaction,
	applySetLastInjectedMemories,
	applyUpdateInjectedMemoryPinned,
	knoxPendingApplyStates,
	applySetToolCallOutput,
	applySetToolGenerated,
	applySetToolStatus,
	applyStreamUpdate,
	applySubmitEditorAndInitAtIndex,
	applyUpdateApplyState,
	applyUpdateHistoryItemAtIndex,
	createEmptySessionState,
} from './knoxChatSession.js';
import {
	knoxApplyStateByStreamId,
	knoxBuildApplyToFilePayload,
	KnoxCodeBlockStreamIds,
} from './knoxApply.js';
import { knoxResolveWorkspaceUri } from './knoxMarkdown.js';
import {
	IKnoxApplyState,
	IKnoxAutonomousLoopState,
	IKnoxChatHistoryItem,
	IKnoxChatMessage,
	IKnoxChatSessionState,
	IKnoxContextItem,
	IKnoxInjectedMemoryItem,
	IKnoxInputModifiers,
	IKnoxLastCompaction,
	IKnoxMessageContent,
	IKnoxModelDescription,
	IKnoxProfileDescription,
	IKnoxPromptLog,
	IKnoxBackgroundJob,
	IKnoxSerializedConfig,
	IKnoxSession,
	IKnoxSessionMetadata,
	KnoxExternalDirectoryMode,
	IKnoxWorktreeState,
	KNOX_IDLE_AUTONOMOUS_LOOP,
	KNOX_IDLE_WORKTREE,
	KnoxModelRole,
	renderContextItems,
	renderKnoxChatMessage,
	renderKnoxMessageContent,
} from './knoxChatTypes.js';
import {
	buildDoomLoopBlockedMessage,
	detectDoomLoop,
} from './knoxDoomLoop.js';
import {
	enterKnoxAgentLoop,
	hasKnoxAskUserWaiter,
	hasKnoxToolApproval,
	isKnoxAgentLoopRunning,
	leaveKnoxAgentLoop,
	rejectKnoxLoopWaiters,
	resolveKnoxAskUser,
	resolveKnoxToolApproval,
	waitForKnoxAskUser,
	waitForKnoxToolApproval,
} from './knoxGuiApproval.js';
import { IKnoxGuiBridge } from './knoxGuiProtocol.js';
import {
	knoxSessionExportFilename,
	knoxSessionExportMarkdown,
	parseKnoxSession,
	parseKnoxSessionMetadata,
} from './knoxHistory.js';
import {
	resolveAgentMaxSteps,
	resolveDoomLoopThreshold,
	shouldDisableToolsForMaxSteps,
} from './knoxAgentMaxSteps.js';
import {
	AUTONOMOUS_SLASH_COMMAND,
	expandPromptSlashCommand,
	extractSlashUserInput,
	formatAskUserAnswers,
	isAutonomousCommand,
	isPromptBasedSlashCommand,
	parseAutonomousGoal,
	slashCommandForInput,
} from './knoxSlash.js';
import { knoxReuseImagesInContent } from './knoxImages.js';
import {
	IKnoxGetContextItemsRequest,
	IKnoxRangeInFile,
	knoxHasSlashCommandOrContextProvider,
	knoxParseDefaultContextProviders,
	knoxResolveInput,
	knoxUserMessageWithContext,
} from './knoxResolveInput.js';
import {
	IKnoxCodeToEdit,
	IKnoxEditModeState,
	KnoxEditStatus,
	knoxAddCodeToEdit,
	knoxApplyEditStatus,
	knoxCodeToEditHasRange,
	knoxFocusEditState,
	knoxGetMultifileEditPrompt,
	knoxIsInEditMode,
	knoxIsSingleRangeEditOrInsertion,
	knoxParseCodeToEditList,
	knoxParseEditStatusPayload,
	knoxRemoveCodeToEdit,
	knoxSetEditDone,
	knoxSubmitEdit,
	KNOX_DEFAULT_EDIT_MODE_STATE,
} from './knoxEditMode.js';
import { KnoxBuiltInToolName, resolveBuiltInToolName } from './knoxToolNames.js';
import {
	knoxChatModelOptions,
	knoxFindModelForRole,
	knoxNextChatModelTitle,
} from './knoxModels.js';
import { isKnoxLumpSection, knoxLumpShouldSaveBeforeNewChat, knoxToggleLumpSection } from './knoxLump.js';
import { knoxModeSelectCanChange, knoxModeSelectFallback } from './knoxModeSelect.js';
import {
	knoxParseReasoningEffortByModel,
	knoxReasoningModelKeys,
	knoxResolveReasoningEffort,
} from './knoxReasoningEffort.js';
import { knoxModelSupportsWebSearch } from './knoxWebSearch.js';
import { knoxParseBackgroundJobs, knoxRunningJobCount } from './knoxBackgroundJobs.js';
import { knoxParseLastCompaction } from './knoxCompaction.js';
import {
	KNOX_BOOKMARKED_SLASH_STORAGE_KEY,
	knoxBookmarkStorageKey,
	knoxDefaultBookmarks,
	knoxParseBookmarks,
} from './knoxConversationStarters.js';
import { IKnoxPromptDraft, knoxPromptPayload, knoxToggleBookmark } from './knoxPrompts.js';
import { knoxConfigErrorsFromProfileInfo, knoxHasFatalConfigError, IKnoxConfigError } from './knoxConfigUi.js';
import { knoxCycleProfileId, knoxReadProfileScopedJson, knoxSelectProfileId } from './knoxProfiles.js';
import { knoxApplySharedConfig, IKnoxSharedConfig } from './knoxSharedConfig.js';
import { KNOX_DEFAULT_UI_LANGUAGE, KNOX_LANGUAGE_STORAGE_KEY, KnoxUiLanguage, knoxParseUiLanguage, knoxSetUiLanguage } from './knoxI18n.js';
import {
	KNOX_DEFAULT_TOOL_SETTING,
	KnoxToolGroupSetting,
	KnoxToolPermissionPreset,
	KnoxToolSetting,
	knoxApplyPresetToExistingSettings,
	knoxEnsureToolSetting,
	knoxIsCurrentToolAutoApproved,
	knoxIsToolAutoApproved,
	knoxParseAgentPolicy,
	knoxParsePolicyLines,
	knoxParseStoredToolGroupSettings,
	knoxParseStoredToolSettings,
	knoxParseTools,
	knoxResolvePermissionToolName,
	knoxIsSamePermissionTool,
	knoxToggleToolGroupSetting,
	knoxCycleToolSetting,
	knoxGetToolPermissionDisplay,
} from './knoxToolPermissions.js';

export const IKnoxChatService = createDecorator<IKnoxChatService>('knoxChatService');

export const KNOX_CHAT_AUTO_SAVE_DEBOUNCE_MS = 2000;
export const KNOX_CHAT_AUTO_SAVE_MIN_INTERVAL_MS = 5000;
export const KNOX_CHAT_CONFIG_POLL_MS = 2000;
const KNOX_LAST_ACTIVE_SESSION_KEY = 'knox.chat.lastActiveSession';
const TOOL_CALL_MAX_RETRIES = 2;
const TOOL_CALL_BASE_DELAY_MS = 800;

export interface IKnoxGatherContextResult {
	selectedContextItems: IKnoxContextItem[];
	selectedCode: IKnoxRangeInFile[];
	content: string | IKnoxChatMessage['content'];
}

export interface IKnoxStreamResponseOptions {
	content?: string | IKnoxMessageContent;
	editorState?: unknown;
	modifiers?: IKnoxInputModifiers;
	index?: number;
	promptPreamble?: string;
	contextItems?: IKnoxContextItem[];
}

export interface IKnoxLastActiveSession {
	sessionId: string;
	isEmpty: boolean;
}

export interface IKnoxChatService {
	readonly _serviceBrand: undefined;

	readonly sessionId: string;
	readonly lastSessionId: string | undefined;
	readonly title: string;
	readonly history: readonly IKnoxChatHistoryItem[];
	readonly isStreaming: boolean;
	readonly mode: KnoxChatMode;
	readonly applyStates: readonly IKnoxApplyState[];
	readonly pendingApplyStates: readonly IKnoxApplyState[];
	readonly applyCurIndex: number;
	readonly symbols: Readonly<Record<string, unknown>>;
	readonly injectedMemories: readonly IKnoxInjectedMemoryItem[];
	readonly lastCompaction: IKnoxLastCompaction | null;
	readonly sessionToolAllowlist: readonly string[];
	readonly autonomousLoop: IKnoxAutonomousLoopState;
	readonly toolPending: boolean;
	readonly isCurrentToolAutoApproved: boolean;
	readonly permissionMode: KnoxPermissionMode;
	readonly lumpSection: KnoxLumpSection | undefined;
	readonly streamAborter: AbortController;
	readonly toolLoopSteps: number;
	readonly config: IKnoxSerializedConfig | undefined;
	readonly configError: readonly IKnoxConfigError[];
	readonly hasFatalConfigError: boolean;
	readonly defaultModel: IKnoxModelDescription | undefined;
	readonly defaultModelTitle: string | undefined;
	readonly profileId: string | undefined;
	readonly profile: IKnoxProfileDescription | undefined;
	readonly availableProfiles: readonly IKnoxProfileDescription[];
	readonly language: KnoxUiLanguage;
	readonly webSearchEnabled: boolean;
	readonly reasoningEffort: string | undefined;
	readonly jobsPanelOpen: boolean;
	readonly backgroundJobs: readonly IKnoxBackgroundJob[];
	readonly runningJobCount: number;
	readonly worktree: IKnoxWorktreeState;
	readonly mainEditorContentTrigger: unknown;
	readonly codeToEdit: readonly IKnoxCodeToEdit[];
	readonly editStatus: KnoxEditStatus;
	readonly fileAfterEdit: string | undefined;
	readonly isInEditMode: boolean;
	readonly isSingleRangeEditOrInsertion: boolean;
	readonly toolSettings: Readonly<Record<string, KnoxToolSetting>>;
	readonly toolGroupSettings: Readonly<Record<string, KnoxToolGroupSetting>>;
	readonly allSessionMetadata: readonly IKnoxSessionMetadata[];

	readonly onDidChange: Event<void>;
	readonly onDidStreamError: Event<unknown>;
	readonly onDidRequestApplyFromChat: Event<void>;

	newSession(session?: IKnoxSession): void;
	setStreaming(streaming: boolean): void;
	setMode(mode: KnoxChatMode): void;
	setSessionMode(mode: KnoxChatMode): Promise<void>;
	setDefaultModel(title: string): void;
	setSelectedModelByRole(role: KnoxModelRole, title: string | null): void;
	cycleChatModel(direction?: 1 | -1): void;
	setWebSearchEnabled(enabled: boolean): void;
	toggleWebSearch(): void;
	setReasoningEffort(effort: string): void;
	toggleJobsPanel(): void;
	setJobsPanelOpen(open: boolean): void;
	runAgentWorktree(action: 'enter' | 'apply' | 'discard' | 'status'): Promise<void>;
	refreshAgentJobs(): Promise<void>;
	runAgentJobAction(action: 'kill' | 'killAll' | 'dismiss' | 'clear' | 'list', jobId?: string): Promise<void>;
	pinInjectedMemory(id: number, currentlyPinned: boolean): Promise<void>;
	forgetInjectedMemory(id: number): Promise<void>;
	mismatchInjectedMemory(id: number): Promise<void>;
	acceptOrRejectAllPending(outcome: 'acceptDiff' | 'rejectDiff'): Promise<void>;
	applyToFile(options: { streamId: string; text: string; filepath?: string }): Promise<void>;
	acceptDiff(streamId: string, filepath?: string): Promise<void>;
	rejectDiff(streamId: string, filepath?: string): Promise<void>;
	codeBlockStreamId(historyIndex: number, codeBlockIndex: number): string;
	applyStateByStreamId(streamId: string): IKnoxApplyState | undefined;
	wasApplyRejected(streamId: string): boolean;
	requestApplyFromChat(): void;
	ensureFileSymbols(uris: readonly string[]): Promise<void>;
	syncPendingToolPermissions(): void;
	cycleToolPermission(toolName: string): void;
	applyToolPermissionPreset(preset: KnoxToolPermissionPreset): void;
	toggleToolGroupSetting(groupName: string): void;
	setAgentPolicy(update: {
		paths?: string;
		commands?: string;
		externalDirectory?: KnoxExternalDirectoryMode;
		sandboxDestructive?: boolean;
	}): void;
	slashBookmarks(): string[];
	toggleSlashBookmark(commandName: string): void;
	addPrompt(draft: IKnoxPromptDraft): void;
	focusEditor(): void;
	exitEditMode(): Promise<void>;
	focusEdit(): Promise<void>;
	focusEditWithoutClear(): Promise<void>;
	addCodeToEdit(entry: IKnoxCodeToEdit | readonly IKnoxCodeToEdit[]): void;
	removeCodeToEdit(entry: IKnoxCodeToEdit): void;
	clearCodeToEdit(): void;
	setEditStatus(status: KnoxEditStatus, fileAfterEdit?: string): void;
	sendEditPrompt(options: IKnoxStreamResponseOptions): Promise<void>;
	setToolPending(pending: boolean): void;
	setPermissionMode(mode: KnoxPermissionMode): void;
	cyclePermissionMode(): void;
	setLumpSection(section: KnoxLumpSection | undefined): void;
	toggleLumpSection(section: KnoxLumpSection): void;
	startNewChat(): Promise<void>;
	abortStream(): void;

	streamUpdate(messages: IKnoxChatMessage[]): void;
	submitEditorAndInitAtIndex(index: number, editorState?: unknown): void;
	updateHistoryItemAtIndex(index: number, updates: Partial<IKnoxChatHistoryItem> & { message?: Partial<IKnoxChatMessage> }): void;
	clearDanglingMessages(): void;
	hydrateLastAssistant(assistant: IKnoxChatMessage): void;
	updateApplyState(state: IKnoxApplyState): void;
	updateFileSymbols(symbols: Record<string, unknown>): void;
	setToolGenerated(): void;
	setCalling(toolCallId?: string): void;
	acceptToolCall(toolCallId?: string): void;
	cancelToolCall(toolCallId?: string): void;
	setToolCallOutput(payload: IKnoxContextItem[] | { toolCallId?: string; output: IKnoxContextItem[] }): void;
	addPromptCompletionPair(logs: IKnoxPromptLog[]): void;
	addSessionToolAllowlist(name: string): void;
	removeSessionToolAllowlist(name: string): void;
	resetToolLoopSteps(): void;
	incrementToolLoopSteps(): void;
	applyAutonomousEvent(type: string, data: Record<string, unknown>): void;
	setLastInjectedMemories(items: IKnoxInjectedMemoryItem[]): void;
	setLastCompaction(payload: IKnoxLastCompaction | null): void;
	replaceHistory(history: IKnoxChatHistoryItem[]): void;

	streamResponse(options: IKnoxStreamResponseOptions): Promise<void>;
	streamNormalInput(messages: IKnoxChatMessage[], legacySlashCommandData?: unknown): Promise<void>;
	runGuiAgentLoop(messages: IKnoxChatMessage[], legacySlashCommandData?: unknown): Promise<void>;
	callTool(arg?: { toolCallId?: string; skipContinue?: boolean }): Promise<void>;
	cancelStream(): Promise<void>;
	cancelTool(arg?: { toolCallId?: string }): Promise<void>;
	answerAskUser(toolCallId: string, answers: Record<string, string | string[]>): Promise<void>;
	approveTool(toolCallId: string, always?: boolean): void;
	gatherContext(options: IKnoxStreamResponseOptions): Promise<IKnoxGatherContextResult>;
	saveCurrentSession(options?: { openNewSession?: boolean; generateTitle?: boolean }): Promise<void>;
	loadLastSession(options?: { saveCurrentSession?: boolean }): Promise<void>;
	loadSession(sessionId: string, saveCurrent?: boolean): Promise<void>;
	refreshSessionMetadata(options?: { offset?: number; limit?: number }): Promise<IKnoxSessionMetadata[]>;
	getSession(sessionId: string): Promise<IKnoxSession | undefined>;
	deleteSession(sessionId: string): Promise<void>;
	deleteSessions(sessionIds: readonly string[]): Promise<void>;
	updateSessionTitle(sessionId: string, title: string): Promise<void>;
	exportSession(sessionId: string): Promise<{ filename: string; path: string } | undefined>;
	loadConfig(): Promise<boolean>;
	updateSharedConfig(shared: IKnoxSharedConfig): void;
	selectProfile(id: string | null): void;
	cycleProfile(): void;
	addModel(model: IKnoxModelDescription, role?: string): void;
	deleteModel(title: string): void;
	openConfigProfile(profileId?: string): void;
	setLanguage(language: KnoxUiLanguage): void;
	showToast(type: 'info' | 'warning' | 'error', message: string): void;
	copyText(text: string): void;
	start(): void;
}

function unwrapProtocol(result: unknown): { status: string; content: unknown; error?: string } {
	if (result && typeof result === 'object') {
		const record = result as { status?: string; content?: unknown; error?: string };
		if (typeof record.status === 'string') {
			return { status: record.status, content: record.content, error: record.error };
		}
	}
	return { status: 'success', content: result };
}

function protocolContentSuccess(content: unknown): boolean {
	return Boolean(content && typeof content === 'object' && (content as { success?: unknown }).success === true);
}

function isRetryableToolError(errorMessage: string): boolean {
	if (!errorMessage) {
		return false;
	}
	const msg = errorMessage.toLowerCase();
	return (
		msg.includes('timeout') ||
		msg.includes('ebusy') ||
		msg.includes('eagain') ||
		msg.includes('disposed') ||
		msg.includes('network') ||
		msg.includes('econnreset') ||
		msg.includes('circuit') ||
		msg.includes('rate limit') ||
		msg.includes('execution_timeout') ||
		msg.includes('ide_operation_failed')
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function toolFailureOutput(
	toolName: string,
	errorDetail: string,
	opts: { unexpectedAbort?: boolean; retried?: boolean; attemptsUsed?: number },
): IKnoxContextItem[] {
	const unexpectedAbort = opts.unexpectedAbort === true;
	const retried = opts.retried === true;
	const description = unexpectedAbort
		? 'Interrupted'
		: retried
			? `Failed after ${opts.attemptsUsed ?? 0} retries`
			: 'Failed';
	const content = unexpectedAbort
		? `Tool call "${toolName}" was interrupted before it finished (the user did not hit Stop):\n\n${errorDetail}\n\nRetry the same tool or try an alternative approach.`
		: `Tool call "${toolName}" failed${retried ? ` (after ${opts.attemptsUsed} attempts)` : ''}:\n\n${errorDetail}\n\nPlease try an alternative approach or ask for further instructions.`;
	return [{ icon: 'problems', name: 'Tool Call Error', description, content, hidden: false }];
}

function formatToolCallIpcError(result: { status?: string; error?: unknown }): string {
	if (typeof result?.error === 'string' && result.error.trim()) {
		return result.error;
	}
	if (result?.error != null) {
		return String(result.error);
	}
	try {
		return `Tool call failed (${result?.status ?? 'unknown'}): ${JSON.stringify(result)}`;
	} catch {
		return 'Unknown tool call error';
	}
}

function historyToMessages(history: readonly IKnoxChatHistoryItem[]): IKnoxChatMessage[] {
	return history.map(item => {
		if (item.message.role !== 'user' || !item.contextItems.length) {
			return item.message;
		}
		return {
			...item.message,
			content: knoxUserMessageWithContext(item.message.content, item.contextItems),
		};
	});
}

export class KnoxChatService extends Disposable implements IKnoxChatService {
	declare readonly _serviceBrand: undefined;

	private readonly _state: IKnoxChatSessionState = createEmptySessionState();
	private _codeToEdit: IKnoxCodeToEdit[] = [];
	private _editMode: IKnoxEditModeState = { ...KNOX_DEFAULT_EDIT_MODE_STATE };
	private _toolPending = false;
	private _permissionMode: KnoxPermissionMode = KNOX_DEFAULT_PERMISSION_MODE;
	private _lumpSection: KnoxLumpSection | undefined;
	private _config: IKnoxSerializedConfig | undefined;
	private _configError: IKnoxConfigError[] = [];
	private _defaultModelTitle: string | undefined;
	private _profileId: string | undefined;
	private _profile: IKnoxProfileDescription | undefined;
	private _profiles: IKnoxProfileDescription[] = [];
	private _language: KnoxUiLanguage = KNOX_DEFAULT_UI_LANGUAGE;
	private _toolSettings: Record<string, KnoxToolSetting> = {};
	private _toolGroupSettings: Record<string, KnoxToolGroupSetting> = {};
	private _webSearchEnabled = false;
	private _reasoningEffort: string | undefined;
	private _reasoningEffortByModel: Record<string, string> = {};
	private _jobsPanelOpen = true;
	private _backgroundJobs: IKnoxBackgroundJob[] = [];
	private _worktree: IKnoxWorktreeState = { ...KNOX_IDLE_WORKTREE };
	private _injectedSystemContext: { sessionId: string; content: string } | undefined;
	private _hasLoadedConfig = false;
	private _streamWrapperDepth = 0;
	private _lastSaveTime = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidStreamError = this._register(new Emitter<unknown>());
	readonly onDidStreamError = this._onDidStreamError.event;
	private readonly _onDidRequestApplyFromChat = this._register(new Emitter<void>());
	readonly onDidRequestApplyFromChat = this._onDidRequestApplyFromChat.event;
	private readonly _codeBlockStreamIds = new KnoxCodeBlockStreamIds();
	private readonly _rejectedApplyStreamIds = new Set<string>();
	private readonly _symbolRequests = new Set<string>();

	private readonly _autoSaveScheduler: RunOnceScheduler;
	private readonly _configPollScheduler: RunOnceScheduler;
	private readonly _autoApproveScheduler: RunOnceScheduler;

	constructor(
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this._autoSaveScheduler = this._register(new RunOnceScheduler(() => void this._runAutoSave(), KNOX_CHAT_AUTO_SAVE_DEBOUNCE_MS));
		this._configPollScheduler = this._register(new RunOnceScheduler(() => void this._pollConfig(), KNOX_CHAT_CONFIG_POLL_MS));
		this._autoApproveScheduler = this._register(new RunOnceScheduler(() => this._autoApprovePendingTool(), 0));
		this._register(this._bridge.onDidReceivePush(message => this._handlePush(message.messageType, message.data)));
		this._hydrateUiPrefs();
	}

	start(): void {
		if (!this._hasLoadedConfig) {
			this._configPollScheduler.schedule(0);
		}
		void this._loadReasoningEffortPrefs();
	}

	get sessionId(): string { return this._state.id; }
	get lastSessionId(): string | undefined { return this._state.lastSessionId; }
	get title(): string { return this._state.title; }
	get history(): readonly IKnoxChatHistoryItem[] { return this._state.history; }
	get isStreaming(): boolean { return this._state.isStreaming; }
	get mode(): KnoxChatMode { return this._state.mode; }
	get applyStates(): readonly IKnoxApplyState[] { return this._state.applyStates; }
	get pendingApplyStates(): readonly IKnoxApplyState[] { return knoxPendingApplyStates(this._state.applyStates); }
	get applyCurIndex(): number { return this._state.applyCurIndex; }
	get symbols(): Readonly<Record<string, unknown>> { return this._state.symbols; }
	get injectedMemories(): readonly IKnoxInjectedMemoryItem[] { return this._state.injectedMemories; }
	get lastCompaction(): IKnoxLastCompaction | null { return this._state.lastCompaction; }
	get sessionToolAllowlist(): readonly string[] { return this._state.sessionToolAllowlist; }
	get autonomousLoop(): IKnoxAutonomousLoopState { return this._state.autonomousLoop; }
	get toolPending(): boolean { return this._toolPending; }
	get isCurrentToolAutoApproved(): boolean {
		return knoxIsCurrentToolAutoApproved({
			toolCall: findCurrentToolCall(this._state.history),
			toolSettings: this._toolSettings,
			permissionMode: this._permissionMode,
			sessionAllowlist: this._state.sessionToolAllowlist,
		});
	}
	get permissionMode(): KnoxPermissionMode { return this._permissionMode; }
	get lumpSection(): KnoxLumpSection | undefined { return this._lumpSection; }
	get streamAborter(): AbortController { return this._state.streamAborter; }
	get toolLoopSteps(): number { return this._state.toolLoopSteps; }
	get config(): IKnoxSerializedConfig | undefined { return this._config; }
	get configError(): readonly IKnoxConfigError[] { return this._configError; }
	get hasFatalConfigError(): boolean { return knoxHasFatalConfigError(this._configError); }
	get defaultModel(): IKnoxModelDescription | undefined { return this._defaultModel(); }
	get defaultModelTitle(): string | undefined { return this._defaultModelTitle; }
	get profileId(): string | undefined { return this._profileId; }
	get profile(): IKnoxProfileDescription | undefined { return this._profile; }
	get availableProfiles(): readonly IKnoxProfileDescription[] { return this._profiles; }
	get language(): KnoxUiLanguage { return this._language; }
	get webSearchEnabled(): boolean { return this._webSearchEnabled; }
	get reasoningEffort(): string | undefined {
		return knoxResolveReasoningEffort(this._defaultModel(), this._reasoningEffortByModel, this._reasoningEffort);
	}
	get jobsPanelOpen(): boolean { return this._jobsPanelOpen; }
	get backgroundJobs(): readonly IKnoxBackgroundJob[] { return this._backgroundJobs; }
	get runningJobCount(): number { return knoxRunningJobCount(this._backgroundJobs, this._state.history); }
	get worktree(): IKnoxWorktreeState { return this._worktree; }
	get mainEditorContentTrigger(): unknown { return this._state.mainEditorContentTrigger; }
	get codeToEdit(): readonly IKnoxCodeToEdit[] { return this._codeToEdit; }
	get editStatus(): KnoxEditStatus { return this._editMode.editStatus; }
	get fileAfterEdit(): string | undefined { return this._editMode.fileAfterEdit; }
	get isInEditMode(): boolean { return knoxIsInEditMode(this._state.mode); }
	get isSingleRangeEditOrInsertion(): boolean {
		return knoxIsSingleRangeEditOrInsertion(this._state.mode, this._codeToEdit);
	}
	get toolSettings(): Readonly<Record<string, KnoxToolSetting>> { return this._toolSettings; }
	get toolGroupSettings(): Readonly<Record<string, KnoxToolGroupSetting>> { return this._toolGroupSettings; }
	get allSessionMetadata(): readonly IKnoxSessionMetadata[] { return this._state.allSessionMetadata; }

	newSession(session?: IKnoxSession): void {
		applyNewSession(this._state, session);
		this._codeBlockStreamIds.clear();
		this._rejectedApplyStreamIds.clear();
		this._symbolRequests.clear();
		this._syncToolPending();
		this._injectedSystemContext = undefined;
		this._rememberLastActive();
		this._fire();
	}

	setStreaming(streaming: boolean): void {
		if (this._state.isStreaming === streaming) {
			return;
		}
		this._state.isStreaming = streaming;
		this._fire();
	}

	setMode(mode: KnoxChatMode): void {
		if (this._state.mode === mode) {
			return;
		}
		this._state.mode = mode;
		this._fire();
	}

	async setSessionMode(mode: KnoxChatMode): Promise<void> {
		if (!knoxModeSelectCanChange(this._state.mode, mode, this._state.isStreaming, this._defaultModel())) {
			return;
		}
		const previous = this._state.mode;
		if (previous === 'edit' && mode !== 'edit') {
			await this.exitEditMode();
		}
		if (this._state.mode !== mode) {
			this._state.mode = mode;
			this._fire();
		}
		if (mode === 'agent' || previous === 'agent') {
			void this._bridge.post('setAgentMode', {
				active: mode === 'agent',
				sessionId: this._state.id,
			}).catch(() => { });
		}
	}

	setDefaultModel(title: string): void {
		if (!title || title === this._defaultModelTitle) {
			return;
		}
		this._defaultModelTitle = title;
		this._patchSelectedModelByRole('chat', knoxFindModelForRole(this._config, 'chat', title) ?? { title });
		this._ensureAgentSupported();
		this._fire();
		if (this._profileId) {
			void this._bridge.post('config/updateSelectedModel', {
				profileId: this._profileId,
				role: 'chat',
				title,
			}).catch(() => { });
		}
	}

	setSelectedModelByRole(role: KnoxModelRole, title: string | null): void {
		if (role === 'chat') {
			if (title) {
				this.setDefaultModel(title);
			}
			return;
		}
		const model = knoxFindModelForRole(this._config, role, title);
		const current = this._config?.selectedModelByRole?.[role];
		if ((current?.title ?? null) === (model?.title ?? null)) {
			return;
		}
		this._patchSelectedModelByRole(role, model);
		this._fire();
		if (this._profileId) {
			void this._bridge.post('config/updateSelectedModel', {
				profileId: this._profileId,
				role,
				title: model?.title ?? null,
			}).catch(() => { });
		}
	}

	cycleChatModel(direction: 1 | -1 = 1): void {
		const next = knoxNextChatModelTitle(
			knoxChatModelOptions(this._config?.models),
			this._defaultModelTitle,
			direction,
		);
		if (next) {
			this.setDefaultModel(next);
		}
	}

	setWebSearchEnabled(enabled: boolean): void {
		if (this._webSearchEnabled === enabled) {
			return;
		}
		this._webSearchEnabled = enabled;
		this._storageService.store(KNOX_WEB_SEARCH_STORAGE_KEY, enabled, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._fire();
	}

	toggleWebSearch(): void {
		this.setWebSearchEnabled(!this._webSearchEnabled);
	}

	setReasoningEffort(effort: string): void {
		const keys = knoxReasoningModelKeys(this._defaultModel());
		this._reasoningEffort = effort;
		const next = { ...this._reasoningEffortByModel };
		for (const key of keys) {
			next[key] = effort;
		}
		this._reasoningEffortByModel = next;
		this._persistReasoningEffort();
		void this._bridge.post('ui/updateReasoningEffortPrefs', {
			lastEffort: effort,
			byModel: Object.fromEntries(keys.map(key => [key, effort])),
		}).catch(() => { });
		this._fire();
	}

	toggleJobsPanel(): void {
		this.setJobsPanelOpen(!this._jobsPanelOpen);
	}

	setJobsPanelOpen(open: boolean): void {
		if (this._jobsPanelOpen === open) {
			return;
		}
		this._jobsPanelOpen = open;
		this._storageService.store(KNOX_JOBS_PANEL_STORAGE_KEY, open, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._fire();
	}

	async runAgentWorktree(action: 'enter' | 'apply' | 'discard' | 'status'): Promise<void> {
		this._worktree = { ...this._worktree, busy: true };
		this._fire();
		try {
			const result = unwrapProtocol(await this._bridge.request('agent/worktree', {
				action,
				sessionId: this._state.id,
			}));
			if (result.status !== 'success') {
				this._worktree = { ...this._worktree, busy: false, error: result.error };
				this._fire();
				return;
			}
			const payload = (result.content ?? {}) as {
				ok?: boolean;
				error?: string;
				state?: { enabled?: boolean; branch?: string; path?: string; files?: string[] } | null;
			};
			if (!payload.ok || !payload.state?.enabled) {
				this._worktree = { ...KNOX_IDLE_WORKTREE, error: payload.ok ? undefined : payload.error };
				this._fire();
				return;
			}
			this._worktree = {
				enabled: true,
				busy: false,
				branch: payload.state.branch,
				path: payload.state.path,
				files: payload.state.files ?? [],
				error: payload.error,
			};
			this._fire();
		} catch (error) {
			this._worktree = {
				...this._worktree,
				busy: false,
				error: error instanceof Error ? error.message : String(error),
			};
			this._fire();
		}
	}

	async refreshAgentJobs(): Promise<void> {
		await this.runAgentJobAction('list');
	}

	async runAgentJobAction(action: 'kill' | 'killAll' | 'dismiss' | 'clear' | 'list', jobId?: string): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			const result = unwrapProtocol(await this._bridge.request('agent/jobs', { action, jobId }));
			if (result.status !== 'success') {
				return;
			}
			this._backgroundJobs = knoxParseBackgroundJobs(result.content);
			this._fire();
		} catch {
			// Job list is best-effort.
		}
	}

	async pinInjectedMemory(id: number, currentlyPinned: boolean): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			const result = unwrapProtocol(await this._bridge.request(
				currentlyPinned ? 'brain/unpinMemory' : 'brain/pinMemory',
				{ id },
			));
			if (result.status === 'success' && protocolContentSuccess(result.content)) {
				applyUpdateInjectedMemoryPinned(this._state, id, !currentlyPinned);
				this._fire();
			}
		} catch {
			// Pin is best-effort.
		}
	}

	async forgetInjectedMemory(id: number): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			const result = unwrapProtocol(await this._bridge.request('brain/deleteMemory', { id }));
			if (result.status === 'success' && protocolContentSuccess(result.content)) {
				applyRemoveInjectedMemory(this._state, id);
				this._fire();
			}
		} catch {
			// Forget is best-effort.
		}
	}

	async mismatchInjectedMemory(id: number): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			const result = unwrapProtocol(await this._bridge.request('brain/mismatchMemory', {
				id,
				sessionId: this._state.id,
			}));
			if (result.status === 'success' && protocolContentSuccess(result.content)) {
				applyRemoveInjectedMemory(this._state, id);
				this._fire();
			}
		} catch {
			// Mismatch is best-effort.
		}
	}

	async acceptOrRejectAllPending(outcome: 'acceptDiff' | 'rejectDiff'): Promise<void> {
		const pending = knoxPendingApplyStates(this._state.applyStates);
		for (const apply of pending) {
			await this._bridge.post(outcome, {
				filepath: apply.filepath ?? '',
				streamId: apply.streamId,
			}).catch(() => { });
		}
		if (outcome === 'acceptDiff') {
			await this.loadLastSession({ saveCurrentSession: false });
			await this.exitEditMode();
		}
	}

	syncPendingToolPermissions(): void {
		const pending = findPendingGeneratedToolCalls(this._state.history);
		for (const state of pending) {
			const toolName = knoxResolvePermissionToolName(state.toolCall.function.name);
			if (!toolName || toolName === KnoxBuiltInToolName.AskUser) {
				continue;
			}
			const setting = this._toolSettings[toolName] ?? KNOX_DEFAULT_TOOL_SETTING;
			if (setting === 'disabled') {
				if (hasKnoxToolApproval(state.toolCallId)) {
					resolveKnoxToolApproval(state.toolCallId, false);
					continue;
				}
				void this.cancelTool({ toolCallId: state.toolCallId });
				continue;
			}
			if (!this._isAutoApproved(toolName)) {
				continue;
			}
			if (hasKnoxToolApproval(state.toolCallId)) {
				resolveKnoxToolApproval(state.toolCallId, true);
				continue;
			}
			void this.callTool({ toolCallId: state.toolCallId });
		}
	}

	cycleToolPermission(toolName: string): void {
		const name = knoxResolvePermissionToolName(toolName);
		if (!name) {
			return;
		}
		const display = knoxGetToolPermissionDisplay({
			toolName: name,
			toolSettings: this._toolSettings,
			sessionAllowlist: this._state.sessionToolAllowlist,
		});
		if (display === 'sessionAlways') {
			this._removeMatchingAllowlist(name);
			this._fire();
			this.syncPendingToolPermissions();
			return;
		}
		this._toolSettings = { ...this._toolSettings, [name]: knoxCycleToolSetting(this._toolSettings[name]) };
		if (display === 'autoApprove') {
			this._removeMatchingAllowlist(name);
		}
		this._persistToolSettings();
		this._fire();
		this.syncPendingToolPermissions();
	}

	applyToolPermissionPreset(preset: KnoxToolPermissionPreset): void {
		this._toolSettings = knoxApplyPresetToExistingSettings(this._toolSettings, this._config?.tools ?? [], preset);
		this._persistToolSettings();
		this._fire();
		this.syncPendingToolPermissions();
	}

	toggleToolGroupSetting(groupName: string): void {
		this._toolGroupSettings = {
			...this._toolGroupSettings,
			[groupName]: knoxToggleToolGroupSetting(this._toolGroupSettings[groupName]),
		};
		this._persistToolGroupSettings();
		this._fire();
	}

	setAgentPolicy(update: {
		paths?: string;
		commands?: string;
		externalDirectory?: KnoxExternalDirectoryMode;
		sandboxDestructive?: boolean;
	}): void {
		const current = this._config?.experimental?.agentPolicy ?? {};
		const next = {
			...current,
			...(update.paths !== undefined ? { paths: knoxParsePolicyLines(update.paths) } : {}),
			...(update.commands !== undefined ? { commands: knoxParsePolicyLines(update.commands) } : {}),
			...(update.externalDirectory !== undefined ? { externalDirectory: update.externalDirectory } : {}),
			...(update.sandboxDestructive !== undefined ? { sandboxDestructive: update.sandboxDestructive } : {}),
		};
		this._config = {
			...this._config,
			experimental: { ...this._config?.experimental, agentPolicy: next },
		};
		this._fire();
		void this._bridge.post('config/updateSharedConfig', {
			agentPolicyPaths: update.paths,
			agentPolicyCommands: update.commands,
			agentPolicyExternalDirectory: update.externalDirectory,
			agentPolicySandboxDestructive: update.sandboxDestructive,
		}).catch(() => { });
	}

	slashBookmarks(): string[] {
		const commands = this._config?.slashCommands ?? [];
		const raw = knoxReadProfileScopedJson(
			key => this._storageService.get(key, StorageScope.PROFILE),
			KNOX_BOOKMARKED_SLASH_STORAGE_KEY,
			this._profileId,
		);
		return knoxParseBookmarks(raw, knoxDefaultBookmarks(commands));
	}

	toggleSlashBookmark(commandName: string): void {
		const next = knoxToggleBookmark(this.slashBookmarks(), commandName);
		this._storageService.store(
			knoxBookmarkStorageKey(this._profileId),
			JSON.stringify(next),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
		this._fire();
	}

	addPrompt(draft: IKnoxPromptDraft): void {
		void this._bridge.post('config/addPrompt', knoxPromptPayload(draft)).catch(() => { });
	}

	focusEditor(): void {
		void this._bridge.post('focusEditor', undefined).catch(() => { });
	}

	showToast(type: 'info' | 'warning' | 'error', message: string): void {
		void this._bridge.post('showToast', [type, message]).catch(() => { });
	}

	copyText(text: string): void {
		void this._bridge.post('copyText', text).catch(() => { });
	}

	updateSharedConfig(shared: IKnoxSharedConfig): void {
		this._config = knoxApplySharedConfig(this._config, shared);
		this._fire();
		void this._bridge.post('config/updateSharedConfig', shared).catch(() => { });
	}

	selectProfile(id: string | null): void {
		const next = knoxSelectProfileId(this._profiles, id);
		if ((next ?? null) === (this._profileId ?? null)) {
			return;
		}
		this._profileId = next ?? undefined;
		this._profile = this._profiles.find(profile => profile.id === this._profileId)
			?? (this._profileId ? { id: this._profileId } : undefined);
		this._fire();
		void this._bridge.post('didChangeSelectedProfile', { id: next }).catch(() => { });
	}

	cycleProfile(): void {
		this.selectProfile(knoxCycleProfileId(this._profiles, this._profileId));
	}

	addModel(model: IKnoxModelDescription, role?: string): void {
		void this._bridge.post('config/addModel', { model, role }).catch(() => { });
		if ((!role || role === 'chat') && model.title) {
			this.setDefaultModel(model.title);
		}
	}

	deleteModel(title: string): void {
		if (!title) {
			return;
		}
		void this._bridge.post('config/deleteModel', { title }).catch(() => { });
	}

	openConfigProfile(profileId?: string): void {
		void this._bridge.post('config/openProfile', { profileId }).catch(() => { });
	}

	setLanguage(language: KnoxUiLanguage): void {
		if (this._language === language) {
			return;
		}
		this._language = language;
		knoxSetUiLanguage(language);
		this._storageService.store(KNOX_LANGUAGE_STORAGE_KEY, language, StorageScope.PROFILE, StorageTarget.USER);
		this._fire();
	}

	async exitEditMode(): Promise<void> {
		if (this._state.mode !== 'edit') {
			return;
		}
		const shouldFocusEditor = knoxIsSingleRangeEditOrInsertion(this._state.mode, this._codeToEdit);
		try {
			await this.loadLastSession({ saveCurrentSession: false });
		} catch {
			// Restore is best-effort; still leave edit mode.
		}
		this._state.mode = 'chat';
		for (const code of this._codeToEdit) {
			await this._bridge.post('rejectDiff', { filepath: code.filepath }).catch(() => { });
		}
		this._codeToEdit = [];
		this._editMode = knoxSetEditDone();
		this._state.mainEditorContentTrigger = undefined;
		this._fire();
		await this._bridge.post('edit/exit', { shouldFocusEditor });
	}

	async focusEdit(): Promise<void> {
		await this.saveCurrentSession({ openNewSession: false, generateTitle: false });
		this._editMode = knoxFocusEditState();
		this.newSession();
		this._state.mode = 'edit';
		this._fire();
	}

	async focusEditWithoutClear(): Promise<void> {
		await this.saveCurrentSession({ openNewSession: true, generateTitle: true });
		this._editMode = knoxFocusEditState();
		this._state.mode = 'edit';
		this._fire();
	}

	addCodeToEdit(entry: IKnoxCodeToEdit | readonly IKnoxCodeToEdit[]): void {
		const next = knoxAddCodeToEdit(this._codeToEdit, entry);
		if (next.length === this._codeToEdit.length) {
			return;
		}
		this._codeToEdit = next;
		this._fire();
	}

	removeCodeToEdit(entry: IKnoxCodeToEdit): void {
		const next = knoxRemoveCodeToEdit(this._codeToEdit, entry);
		if (next.length === this._codeToEdit.length) {
			return;
		}
		this._codeToEdit = next;
		this._fire();
	}

	clearCodeToEdit(): void {
		if (!this._codeToEdit.length) {
			return;
		}
		this._codeToEdit = [];
		this._fire();
	}

	setEditStatus(status: KnoxEditStatus, fileAfterEdit?: string): void {
		const next = knoxApplyEditStatus(this._editMode, status, fileAfterEdit);
		if (next === this._editMode) {
			return;
		}
		this._editMode = next;
		this._fire();
	}

	async sendEditPrompt(options: IKnoxStreamResponseOptions): Promise<void> {
		if (!knoxIsSingleRangeEditOrInsertion(this._state.mode, this._codeToEdit) || !this._codeToEdit.length) {
			return;
		}
		const model = this._defaultModel();
		if (!model) {
			throw new Error('No selected chat model');
		}
		const range = this._codeToEdit[0];
		if (!knoxCodeToEditHasRange(range)) {
			return;
		}
		const gathered = await this.gatherContext({
			...options,
			modifiers: { ...(options.modifiers ?? {}), noContext: true },
		});
		const prompt = [
			...gathered.selectedContextItems.map(item => item.content),
			renderKnoxMessageContent(gathered.content),
		].filter(part => !!part && part.trim()).join('\n\n');
		await this._bridge.post('edit/sendPrompt', {
			prompt,
			range,
			selectedModelTitle: model.title,
		});
		this._editMode = knoxSubmitEdit(this._editMode, prompt);
		this._fire();
	}

	setToolPending(pending: boolean): void {
		if (this._toolPending === pending) {
			return;
		}
		this._toolPending = pending;
		this._fire();
	}

	setPermissionMode(mode: KnoxPermissionMode): void {
		if (this._permissionMode === mode) {
			return;
		}
		this._permissionMode = mode;
		this._fire();
		this.syncPendingToolPermissions();
	}

	cyclePermissionMode(): void {
		if (this._state.mode !== 'agent' || this._state.isStreaming) {
			return;
		}
		this.setPermissionMode(knoxNextPermissionMode(this._permissionMode));
	}

	setLumpSection(section: KnoxLumpSection | undefined): void {
		if (this._lumpSection === section) {
			return;
		}
		this._lumpSection = section;
		this._persistLumpSection();
		this._fire();
	}

	toggleLumpSection(section: KnoxLumpSection): void {
		this.setLumpSection(knoxToggleLumpSection(this._lumpSection, section));
	}

	async startNewChat(): Promise<void> {
		await this.exitEditMode();
		if (knoxLumpShouldSaveBeforeNewChat(this._state.history.length)) {
			await this.saveCurrentSession({ openNewSession: false, generateTitle: true });
		}
		this.newSession();
	}

	abortStream(): void {
		applyAbortStream(this._state);
		if (!this._state.isStreaming && !this._toolPending) {
			return;
		}
		this._state.isStreaming = false;
		this._toolPending = false;
		this._fire();
	}

	streamUpdate(messages: IKnoxChatMessage[]): void {
		applyStreamUpdate(this._state, messages);
		this._syncToolPending();
		this._rememberLastActive();
		this._scheduleAutoSave();
		this._fire();
	}

	submitEditorAndInitAtIndex(index: number, editorState?: unknown): void {
		applySubmitEditorAndInitAtIndex(this._state, index, editorState);
		this._rememberLastActive();
		this._fire();
	}

	updateHistoryItemAtIndex(
		index: number,
		updates: Partial<IKnoxChatHistoryItem> & { message?: Partial<IKnoxChatMessage> },
	): void {
		applyUpdateHistoryItemAtIndex(this._state, index, updates);
		this._rememberLastActive();
		this._scheduleAutoSave();
		this._fire();
	}

	clearDanglingMessages(): void {
		applyClearDanglingMessages(this._state);
		this._syncToolPending();
		this._fire();
	}

	hydrateLastAssistant(assistant: IKnoxChatMessage): void {
		applyHydrateLastAssistant(this._state, assistant);
		this._syncToolPending();
		this._fire();
	}

	updateApplyState(applyState: IKnoxApplyState): void {
		applyUpdateApplyState(this._state, applyState);
		this._fire();
	}

	updateFileSymbols(symbols: Record<string, unknown>): void {
		this._state.symbols = { ...this._state.symbols, ...symbols };
		this._fire();
	}

	applyStateByStreamId(streamId: string): IKnoxApplyState | undefined {
		return knoxApplyStateByStreamId(this._state.applyStates, streamId);
	}

	codeBlockStreamId(historyIndex: number, codeBlockIndex: number): string {
		return this._codeBlockStreamIds.get(this._state.id, historyIndex, codeBlockIndex);
	}

	wasApplyRejected(streamId: string): boolean {
		return this._rejectedApplyStreamIds.has(streamId);
	}

	requestApplyFromChat(): void {
		this._onDidRequestApplyFromChat.fire();
	}

	async applyToFile(options: { streamId: string; text: string; filepath?: string }): Promise<void> {
		const title = this._defaultModelTitle;
		if (!title || !this._bridge) {
			return;
		}
		const filepath = options.filepath
			? knoxResolveWorkspaceUri(options.filepath, this._workspaceFolders())
			: undefined;
		this.updateApplyState({
			streamId: options.streamId,
			status: 'streaming',
			fileContent: options.text,
			filepath,
		});
		await this._bridge.post('applyToFile', knoxBuildApplyToFilePayload(
			options.text,
			options.streamId,
			title,
			filepath,
		)).catch(() => { });
	}

	async acceptDiff(streamId: string, filepath?: string): Promise<void> {
		if (!this._bridge) {
			return;
		}
		await this._bridge.post('acceptDiff', {
			streamId,
			filepath: filepath ? knoxResolveWorkspaceUri(filepath, this._workspaceFolders()) : '',
		}).catch(() => { });
	}

	async rejectDiff(streamId: string, filepath?: string): Promise<void> {
		this._rejectedApplyStreamIds.add(streamId);
		if (!this._bridge) {
			return;
		}
		await this._bridge.post('rejectDiff', {
			streamId,
			filepath: filepath ? knoxResolveWorkspaceUri(filepath, this._workspaceFolders()) : '',
		}).catch(() => { });
		this._fire();
	}

	async ensureFileSymbols(uris: readonly string[]): Promise<void> {
		if (!this._bridge) {
			return;
		}
		const missing = [...new Set(uris)].filter(uri =>
			!!uri && !(uri in this._state.symbols) && !this._symbolRequests.has(uri),
		);
		if (!missing.length) {
			return;
		}
		for (const uri of missing) {
			this._symbolRequests.add(uri);
		}
		try {
			const result = unwrapProtocol(await this._bridge.request('context/getSymbolsForFiles', { uris: missing }));
			if (result.status === 'success' && result.content && typeof result.content === 'object' && !Array.isArray(result.content)) {
				this.updateFileSymbols(result.content as Record<string, unknown>);
			}
		} catch {
			for (const uri of missing) {
				this._symbolRequests.delete(uri);
			}
		}
	}

	setToolGenerated(): void {
		applySetToolGenerated(this._state);
		this._syncToolPending();
		this._fire();
		if (!isKnoxAgentLoopRunning()) {
			this._autoApproveScheduler.schedule();
		}
	}

	setCalling(toolCallId?: string): void {
		applySetToolStatus(this._state, 'calling', toolCallId);
		this._syncToolPending();
		this._fire();
	}

	acceptToolCall(toolCallId?: string): void {
		applySetToolStatus(this._state, 'done', toolCallId);
		this._syncToolPending();
		this._fire();
	}

	cancelToolCall(toolCallId?: string): void {
		applySetToolStatus(this._state, 'canceled', toolCallId);
		this._syncToolPending();
		this._fire();
	}

	setToolCallOutput(payload: IKnoxContextItem[] | { toolCallId?: string; output: IKnoxContextItem[] }): void {
		applySetToolCallOutput(this._state, payload);
		this._fire();
	}

	addPromptCompletionPair(logs: IKnoxPromptLog[]): void {
		applyAddPromptCompletionPair(this._state, logs);
		this._fire();
	}

	addSessionToolAllowlist(name: string): void {
		applyAddSessionToolAllowlist(this._state, name);
		if (this._bridge) {
			void this._bridge.request('brain/recordSoulEvent', {
				sessionId: this._state.id,
				kind: 'tool_success',
				toolName: name,
				policy: 'allow',
				summary: `Always allowed ${name} for this chat`,
			}).catch(() => { });
		}
		this._fire();
	}

	removeSessionToolAllowlist(name: string): void {
		this._removeMatchingAllowlist(name);
		this._fire();
		this.syncPendingToolPermissions();
	}

	resetToolLoopSteps(): void {
		this._state.toolLoopSteps = 0;
		this._state.autonomousLoop = { ...KNOX_IDLE_AUTONOMOUS_LOOP };
		this._fire();
	}

	incrementToolLoopSteps(): void {
		this._state.toolLoopSteps += 1;
		this._fire();
	}

	applyAutonomousEvent(type: string, data: Record<string, unknown>): void {
		applyApplyAutonomousEvent(this._state, type, data);
		this._syncToolPending();
		this._fire();
	}

	setLastInjectedMemories(items: IKnoxInjectedMemoryItem[]): void {
		applySetLastInjectedMemories(this._state, items);
		this._fire();
	}

	setLastCompaction(payload: IKnoxLastCompaction | null): void {
		applySetLastCompaction(this._state, payload);
		this._fire();
	}

	replaceHistory(history: IKnoxChatHistoryItem[]): void {
		this._state.history = history;
		this._syncToolPending();
		this._fire();
	}

	async gatherContext(options: IKnoxStreamResponseOptions): Promise<IKnoxGatherContextResult> {
		let content: string | IKnoxChatMessage['content'] = options.content ?? '';
		const selectedContextItems = [...(options.contextItems ?? [])];
		const modifiers = options.modifiers ?? {};
		const model = this._defaultModel();
		if (!model) {
			throw new Error('No model selected');
		}

		const shouldGather = knoxHasSlashCommandOrContextProvider(options.editorState);
		if (shouldGather) {
			applySetIsGatheringContext(this._state, true);
			this._fire();
		}

		let selectedCode: IKnoxRangeInFile[] = [];
		try {
			if (this._bridge) {
				const resolved = await knoxResolveInput({
					content,
					editorState: options.editorState,
					defaultContextProviders: knoxParseDefaultContextProviders(this._config?.experimental?.defaultContext),
					selectedModelTitle: model.title,
					requestContextItems: data => this._requestContextItems(data),
				});
				content = resolved.content;
				selectedCode = resolved.selectedCode;
				selectedContextItems.push(...resolved.contextItems);
			}

			if (!modifiers.noContext && this._bridge) {
				const currentFileItems = await this._requestContextItems({
					name: 'currentFile',
					query: 'non-mention-usage',
					fullInput: '',
					selectedCode: [],
					selectedModelTitle: model.title,
				});
				if (currentFileItems.length) {
					const currentFile = currentFileItems[0];
					const uri = currentFile.uri?.value;
					if (uri && !selectedContextItems.some(item => item.uri?.value === uri)) {
						currentFile.id = { providerTitle: 'file', itemId: uri };
						selectedContextItems.unshift(currentFile);
					}
				}
			}
		} finally {
			if (shouldGather) {
				applySetIsGatheringContext(this._state, false);
				this._fire();
			}
		}

		if (options.promptPreamble) {
			if (typeof content === 'string') {
				content = options.promptPreamble + content;
			} else if (Array.isArray(content) && content[0]?.type === 'text') {
				const first = content[0];
				content = [{ type: 'text', text: options.promptPreamble + first.text }, ...content.slice(1)];
			}
		}

		return { selectedContextItems, selectedCode, content };
	}

	async streamResponse(options: IKnoxStreamResponseOptions): Promise<void> {
		await this._withStreamWrapper(async () => {
			const model = this._defaultModel();
			if (!model) {
				throw new Error('No chat model to select');
			}
			const inputIndex = options.index ?? this._state.history.length;
			this.submitEditorAndInitAtIndex(inputIndex, options.editorState);
			this._state.applyCurIndex = 0;
			this.resetToolLoopSteps();

			const promptPreamble = options.promptPreamble
				?? (this._state.mode === 'edit' && !knoxIsSingleRangeEditOrInsertion(this._state.mode, this._codeToEdit)
					? knoxGetMultifileEditPrompt(this._codeToEdit, [this._workspaceDirectory()].filter(Boolean))
					: undefined);
			const gathered = await this.gatherContext({ ...options, promptPreamble });
			this.updateHistoryItemAtIndex(inputIndex, {
				message: {
					role: 'user',
					content: gathered.content,
					id: generateUuid(),
				},
				contextItems: gathered.selectedContextItems,
			});

			const text = typeof gathered.content === 'string'
				? gathered.content
				: renderKnoxMessageContent(gathered.content);

			await this._trackSession(text);

			if (text && isAutonomousCommand(text)) {
				await this._runAutonomous(text, inputIndex);
				return;
			}

			await this._injectMemory(text);

			const slashCommands = this._config?.slashCommands ?? [];
			const commandAndInput = slashCommandForInput(text, slashCommands);
			const messages = this._messagesWithInjectedContext();
			if (!commandAndInput) {
				await this.streamNormalInput(messages);
				return;
			}

			const [slashCommand, commandInput] = commandAndInput;
			if (isPromptBasedSlashCommand(slashCommand)) {
				const userInput = extractSlashUserInput(commandInput, slashCommand.name);
				const expanded = expandPromptSlashCommand(slashCommand.prompt!, userInput);
				this.updateHistoryItemAtIndex(inputIndex, {
					message: { role: 'user', content: knoxReuseImagesInContent(expanded, gathered.content), id: generateUuid() },
				});
				await this.streamNormalInput(this._messagesWithInjectedContext());
				return;
			}

			await this.streamNormalInput(messages, {
				command: slashCommand,
				contextItems: gathered.selectedContextItems,
				historyIndex: inputIndex,
				input: commandInput,
				selectedCode: gathered.selectedCode,
			});
		});
	}

	async streamNormalInput(messages: IKnoxChatMessage[], legacySlashCommandData?: unknown): Promise<void> {
		const model = this._defaultModel();
		if (!model) {
			throw new Error('Default model not defined');
		}
		if (this._state.mode === 'agent') {
			await this.runGuiAgentLoop(messages, legacySlashCommandData);
			return;
		}
		await this._streamChatOnce(messages, model, legacySlashCommandData);
	}

	async runGuiAgentLoop(messages: IKnoxChatMessage[], legacySlashCommandData?: unknown): Promise<void> {
		const model = this._defaultModel();
		if (!model) {
			throw new Error('Default model not defined');
		}
		if (this._bridge) {
			try {
				await this._bridge.request('debugControl', { op: 'status' });
			} catch {
				// Best-effort; Core still streams without a debug session.
			}
		}

		const agentMaxSteps = resolveAgentMaxSteps(
			this._config?.experimental?.agentMaxSteps,
			this._config?.experimental?.agentProfile,
		);
		const doomThreshold = resolveDoomLoopThreshold(
			this._config?.experimental?.agentDoomLoopThreshold,
			this._config?.experimental?.agentProfile,
		);

		enterKnoxAgentLoop();
		try {
			let nextMessages = [...messages];
			while (this._state.isStreaming && !this._state.streamAborter.signal.aborted) {
				if (shouldDisableToolsForMaxSteps(this._state.toolLoopSteps, agentMaxSteps)) {
					await this._streamChatOnce(nextMessages, model, legacySlashCommandData);
					break;
				}
				await this._streamChatOnce(nextMessages, model, legacySlashCommandData);
				this.setToolGenerated();
				const pending = findPendingGeneratedToolCalls(this._state.history);
				if (!pending.length) {
					break;
				}
				for (const tool of pending) {
					if (this._state.streamAborter.signal.aborted) {
						break;
					}
					const hit = detectDoomLoop(this._state.history, {
						pending: [tool],
						threshold: doomThreshold,
					});
					if (hit) {
						const blocked = buildDoomLoopBlockedMessage(hit);
						const output: IKnoxContextItem[] = [{
							name: 'Doom loop',
							description: 'blocked',
							content: blocked,
						}];
						this.setCalling(tool.toolCallId);
						this.setToolCallOutput({ toolCallId: tool.toolCallId, output });
						this.acceptToolCall(tool.toolCallId);
						await this._appendToolResult(tool.toolCallId, output, true);
						continue;
					}
					if (tool.toolCall.function.name === KnoxBuiltInToolName.AskUser) {
						const output = await waitForKnoxAskUser({
							callId: tool.toolCallId,
							abortSignal: this._state.streamAborter.signal,
						});
						if (!output) {
							this.cancelToolCall(tool.toolCallId);
							continue;
						}
						this.setToolCallOutput({ toolCallId: tool.toolCallId, output });
						this.acceptToolCall(tool.toolCallId);
						await this._appendToolResult(tool.toolCallId, output, true);
						continue;
					}
					if (!this._isAutoApproved(tool.toolCall.function.name)) {
						const decision = await waitForKnoxToolApproval({
							callId: tool.toolCallId,
							abortSignal: this._state.streamAborter.signal,
						});
						if (decision.always) {
							this.addSessionToolAllowlist(tool.toolCall.function.name);
						}
						if (!decision.allow) {
							const denied: IKnoxContextItem[] = [{
								name: 'Agent',
								description: 'permission-denied',
								content: 'Blocked: this tool was not approved. The call was not executed. Continue with a different approach or wait for the user.',
							}];
							this.setCalling(tool.toolCallId);
							this.setToolCallOutput({ toolCallId: tool.toolCallId, output: denied });
							this.acceptToolCall(tool.toolCallId);
							await this._appendToolResult(tool.toolCallId, denied, true);
							continue;
						}
					}
					await this.callTool({ toolCallId: tool.toolCallId, skipContinue: true });
					this.incrementToolLoopSteps();
				}
				nextMessages = this._messagesWithInjectedContext();
			}
		} finally {
			rejectKnoxLoopWaiters();
			leaveKnoxAgentLoop();
		}
	}

	async callTool(arg?: { toolCallId?: string; skipContinue?: boolean }): Promise<void> {
		const toolCallState = arg?.toolCallId
			? findToolCallStateById(this._state.history, arg.toolCallId)
			: findCurrentToolCall(this._state.history);
		if (!toolCallState || toolCallState.status !== 'generated') {
			return;
		}

		const loopOwnsGuards = arg?.skipContinue === true;
		const agentMaxSteps = resolveAgentMaxSteps(
			this._config?.experimental?.agentMaxSteps,
			this._config?.experimental?.agentProfile,
		);
		if (!loopOwnsGuards && shouldDisableToolsForMaxSteps(this._state.toolLoopSteps, agentMaxSteps)) {
			this.cancelToolCall(toolCallState.toolCallId);
			return;
		}

		if (!loopOwnsGuards) {
			const doomLoop = detectDoomLoop(this._state.history, {
				pending: [toolCallState],
				threshold: resolveDoomLoopThreshold(
					this._config?.experimental?.agentDoomLoopThreshold,
					this._config?.experimental?.agentProfile,
				),
			});
			if (doomLoop) {
				const blocked = buildDoomLoopBlockedMessage(doomLoop);
				const output: IKnoxContextItem[] = [{
					name: 'Doom loop',
					description: 'blocked',
					content: blocked,
				}];
				this.setCalling(toolCallState.toolCallId);
				this.setToolCallOutput({ toolCallId: toolCallState.toolCallId, output });
				this.acceptToolCall(toolCallState.toolCallId);
				await this._appendToolResult(toolCallState.toolCallId, output, arg?.skipContinue);
				return;
			}
		}

		const model = this._defaultModel();
		if (!model) {
			throw new Error('No model selected');
		}

		const toolName =
			resolveBuiltInToolName(toolCallState.toolCall.function.name) ||
			toolCallState.toolCall.function.name;
		const toolCallId = toolCallState.toolCallId;
		this.setCalling(toolCallId);

		if (!this._bridge) {
			this.cancelToolCall(toolCallId);
			return;
		}

		const resolveLive = () => findToolCallStateById(this._state.history, toolCallId);
		let lastError: string | undefined;
		let result: { status?: string; content?: unknown; error?: unknown } | undefined;
		let attemptsUsed = 0;

		for (let attempt = 0; attempt <= TOOL_CALL_MAX_RETRIES; attempt++) {
			if (isUserStoppedToolCall(resolveLive()) || shouldAbortToolContinuation(resolveLive())) {
				return;
			}
			if (attempt > 0) {
				await sleep(TOOL_CALL_BASE_DELAY_MS * Math.pow(2, attempt - 1));
			}
			attemptsUsed = attempt + 1;
			const lastUser = [...this._state.history].reverse().find(item => item.message.role === 'user');
			result = unwrapProtocol(await this._bridge.request('tools/call', {
				toolCall: {
					...toolCallState.toolCall,
					function: { ...toolCallState.toolCall.function, name: toolName },
				},
				selectedModelTitle: model.title,
				sessionId: this._state.id,
				turnId: lastUser?.message.id ?? this._state.id,
			}));
			if (isUserStoppedToolCall(resolveLive())) {
				return;
			}
			if (result.status === 'success') {
				break;
			}
			lastError = formatToolCallIpcError(result);
			if (!isRetryableToolError(lastError) || attempt >= TOOL_CALL_MAX_RETRIES) {
				break;
			}
		}

		if (isUserStoppedToolCall(resolveLive())) {
			return;
		}

		if (result?.status === 'success') {
			const content = result.content as { contextItems?: IKnoxContextItem[] } | undefined;
			const contextItems = content?.contextItems ?? [];
			this.setToolCallOutput({ toolCallId, output: contextItems });
			this.acceptToolCall(toolCallId);
			await this._appendToolResult(toolCallId, contextItems, arg?.skipContinue);
			return;
		}

		const errorDetail = lastError ?? formatToolCallIpcError(result ?? {});
		const unexpectedAbort = shouldResumeAfterUnexpectedAbort(resolveLive(), errorDetail);
		const errorItems = toolFailureOutput(toolName, errorDetail, {
			unexpectedAbort,
			retried: attemptsUsed > 1,
			attemptsUsed,
		});
		this.setToolCallOutput({ toolCallId, output: errorItems });
		this.acceptToolCall(toolCallId);
		await this._appendToolResult(toolCallId, errorItems, arg?.skipContinue);
	}

	async cancelStream(): Promise<void> {
		applySetInactive(this._state);
		applyAbortStream(this._state);
		rejectKnoxLoopWaiters();
		this._toolPending = false;
		this._fire();

		if (this._bridge) {
			void this._bridge.request('brain/cancelAutonomousLoop', { sessionId: this._state.id }).catch(() => { });
			void this._bridge.post('tools/cancel', undefined).catch(() => { });
			void this.runAgentJobAction('killAll');
			for (const apply of this._state.applyStates.filter(state => state.status === 'streaming' && state.filepath)) {
				void this._bridge.post('rejectDiff', { filepath: apply.filepath, streamId: apply.streamId }).catch(() => { });
			}
		}

		this.clearDanglingMessages();
		try {
			await this.saveCurrentSession({ generateTitle: false });
		} catch {
			// Persist is best-effort after cancel.
		}
	}

	async cancelTool(arg?: { toolCallId?: string }): Promise<void> {
		const toolCallState = arg?.toolCallId
			? findToolCallStateById(this._state.history, arg.toolCallId)
			: findCurrentToolCall(this._state.history);
		if (!toolCallState || toolCallState.status !== 'generated') {
			return;
		}

		if (this._state.autonomousLoop.status === 'running' && this._bridge) {
			await this._bridge.request('brain/resolveAutonomousTool', {
				sessionId: this._state.id,
				callId: toolCallState.toolCallId,
				allow: false,
			});
			return;
		}

		if (hasKnoxToolApproval(toolCallState.toolCallId)) {
			resolveKnoxToolApproval(toolCallState.toolCallId, false);
			return;
		}
		if (hasKnoxAskUserWaiter(toolCallState.toolCallId)) {
			resolveKnoxAskUser(toolCallState.toolCallId, null);
			return;
		}

		this.cancelToolCall(toolCallState.toolCallId);
		const output: IKnoxContextItem[] = [{
			name: 'Tool call cancelled',
			description: 'Tool call cancelled',
			content: 'The tool call has been cancelled by the user. Please try another action or request further instructions.',
			hidden: true,
		}];
		await this._appendToolResult(toolCallState.toolCallId, output, false);
	}

	async answerAskUser(toolCallId: string, answers: Record<string, string | string[]>): Promise<void> {
		const state = findToolCallStateById(this._state.history, toolCallId);
		if (!state || state.status !== 'generated') {
			return;
		}
		const content = formatAskUserAnswers(answers);
		if (this._bridge) {
			void this._bridge.request('brain/recordSoulEvent', {
				sessionId: this._state.id,
				kind: 'tool_success',
				toolName: 'builtin_ask_user',
				ok: true,
				summary: content,
			}).catch(() => { });
		}
		const output: IKnoxContextItem[] = [{
			name: 'answers',
			description: 'Answered',
			content,
		}];
		this.setToolCallOutput({ toolCallId, output });
		this.acceptToolCall(toolCallId);
		const skipLlm = hasKnoxAskUserWaiter(toolCallId);
		await this._appendToolResult(toolCallId, output, skipLlm);
		if (skipLlm) {
			resolveKnoxAskUser(toolCallId, output);
		}
	}

	approveTool(toolCallId: string, always?: boolean): void {
		if (this._state.autonomousLoop.status === 'running' && this._bridge) {
			void this._bridge.request('brain/resolveAutonomousTool', {
				sessionId: this._state.id,
				callId: toolCallId,
				allow: true,
				always,
			});
			return;
		}
		if (!resolveKnoxToolApproval(toolCallId, true, always)) {
			void this.callTool({ toolCallId });
		}
	}

	async saveCurrentSession(options?: { openNewSession?: boolean; generateTitle?: boolean }): Promise<void> {
		if (!this._state.history.length || !this._bridge) {
			if (options?.openNewSession) {
				this.newSession();
			}
			return;
		}

		const snapshot: IKnoxSession = {
			sessionId: this._state.id,
			title: this._state.title,
			workspaceDirectory: this._workspaceDirectory(),
			history: this._state.history,
		};

		if (options?.openNewSession) {
			const previousId = this._state.id;
			this.newSession();
			void this._bridge.request('brain/dispatch', { action: 'close_session', session_id: previousId }).catch(() => { });
		}

		let title = snapshot.title;
		if (title === KNOX_NEW_CHAT_TITLE) {
			const firstUser = snapshot.history.find(item => item.message.role === 'user');
			const text = firstUser ? renderKnoxChatMessage(firstUser.message).split('\n').filter(line => line.trim()).slice(-1)[0] ?? '' : '';
			title = text.length > 100 ? `${text.slice(0, 97)}...` : (text || KNOX_NEW_CHAT_TITLE);
			if (options?.generateTitle && this._defaultModel() && !this._config?.disableSessionTitles) {
				const assistant = snapshot.history.find(item => item.message.role === 'assistant');
				const assistantText = assistant ? renderKnoxChatMessage(assistant.message) : '';
				if (assistantText) {
					try {
						const described = unwrapProtocol(await this._bridge.request('chatDescriber/describe', {
							text: assistantText,
							selectedModelTitle: this._defaultModel()!.title,
						}));
						if (described.status === 'success' && typeof described.content === 'string' && described.content) {
							title = described.content;
						}
					} catch {
						// Fall back to first-line title.
					}
				}
			}
			if (!options?.openNewSession) {
				this._state.title = title;
			}
		}

		await this._bridge.request('history/save', { ...snapshot, title });
		this._lastSaveTime = Date.now();
		this._rememberLastActive();
	}

	async loadLastSession(options?: { saveCurrentSession?: boolean }): Promise<void> {
		if (options?.saveCurrentSession) {
			try {
				await this.saveCurrentSession({ generateTitle: true });
			} catch {
				// Keep going even if the previous session cannot be saved.
			}
		}
		const workspace = this._workspaceDirectory();
		if (!workspace || !this._bridge) {
			this.newSession();
			return;
		}
		const listed = unwrapProtocol(await this._bridge.request('history/list', {
			workspaceDirectory: workspace,
			limit: 1,
		}));
		if (listed.status !== 'success' || !Array.isArray(listed.content) || !listed.content.length) {
			this.newSession();
			return;
		}
		const mostRecent = listed.content[0] as { sessionId?: string };
		if (!mostRecent.sessionId) {
			this.newSession();
			return;
		}
		await this.loadSession(mostRecent.sessionId, false);
	}

	async loadSession(sessionId: string, saveCurrent = false): Promise<void> {
		if (saveCurrent) {
			await this.saveCurrentSession({ generateTitle: true });
		}
		if (!this._bridge) {
			return;
		}
		const previousSessionId = this._state.id;
		const loaded = unwrapProtocol(await this._bridge.request('history/load', { id: sessionId }));
		if (loaded.status !== 'success' || !loaded.content || typeof loaded.content !== 'object') {
			this.newSession();
			return;
		}
		const session = loaded.content as IKnoxSession;
		if (previousSessionId && previousSessionId !== session.sessionId) {
			void this._bridge.request('brain/dispatch', {
				action: 'close_session',
				session_id: previousSessionId,
			}).catch(() => { });
		}
		this.newSession(session);
		await this._trackSession();
	}

	async refreshSessionMetadata(options?: { offset?: number; limit?: number }): Promise<IKnoxSessionMetadata[]> {
		if (!this._bridge) {
			return this._state.allSessionMetadata;
		}
		const listed = unwrapProtocol(await this._bridge.request('history/list', {
			limit: options?.limit,
			offset: options?.offset,
			workspaceDirectory: this._workspaceDirectory(),
		}));
		const raw = listed.status === 'success' && Array.isArray(listed.content)
			? listed.content
			: [];
		this._state.allSessionMetadata = raw
			.map(parseKnoxSessionMetadata)
			.filter((item): item is IKnoxSessionMetadata => !!item);
		this._fire();
		return this._state.allSessionMetadata;
	}

	async getSession(sessionId: string): Promise<IKnoxSession | undefined> {
		if (!this._bridge) {
			return undefined;
		}
		const loaded = unwrapProtocol(await this._bridge.request('history/load', { id: sessionId }));
		if (loaded.status !== 'success') {
			return undefined;
		}
		return parseKnoxSession(loaded.content);
	}

	async deleteSession(sessionId: string): Promise<void> {
		this._state.allSessionMetadata = this._state.allSessionMetadata.filter(item => item.sessionId !== sessionId);
		this._fire();
		if (sessionId === this._state.id) {
			await this.loadLastSession({ saveCurrentSession: false });
		}
		if (this._bridge) {
			await this._bridge.request('history/delete', { id: sessionId });
		}
		await this.refreshSessionMetadata();
	}

	async deleteSessions(sessionIds: readonly string[]): Promise<void> {
		for (const sessionId of sessionIds) {
			await this.deleteSession(sessionId);
		}
	}

	async updateSessionTitle(sessionId: string, title: string): Promise<void> {
		const session = await this.getSession(sessionId);
		if (!session) {
			return;
		}
		session.title = title;
		this._state.allSessionMetadata = this._state.allSessionMetadata.map(item =>
			item.sessionId === sessionId ? { ...item, title } : item,
		);
		if (this._state.id === sessionId) {
			this._state.title = title;
		}
		this._fire();
		if (this._bridge) {
			await this._bridge.request('history/save', session);
		}
		await this.refreshSessionMetadata();
	}

	async exportSession(sessionId: string): Promise<{ filename: string; path: string } | undefined> {
		const session = await this.getSession(sessionId);
		if (!session || !this._bridge) {
			return undefined;
		}
		const now = new Date();
		const filename = knoxSessionExportFilename(session.title || sessionId, now);
		const contents = knoxSessionExportMarkdown(session, now);
		const folder = this._workspaceFolders()[0];
		const target = folder ? URI.joinPath(folder, filename) : URI.file(`/tmp/${filename}`);
		const path = target.toString();
		await this._bridge.request('writeFile', { path, contents });
		await this._bridge.request('openFile', { path });
		return { filename, path };
	}

	async loadConfig(): Promise<boolean> {
		if (!this._bridge) {
			return false;
		}
		const result = unwrapProtocol(await this._bridge.request('config/getSerializedProfileInfo', undefined));
		if (result.status !== 'success' || !result.content || typeof result.content !== 'object') {
			return false;
		}
		const payload = result.content as {
			result?: { config?: IKnoxSerializedConfig; errors?: unknown };
			config?: IKnoxSerializedConfig;
			errors?: unknown;
			profileId?: string | null;
		};
		this._configError = knoxConfigErrorsFromProfileInfo(payload);
		const config = payload.result?.config ?? payload.config;
		if (!config) {
			this._fire();
			return false;
		}
		this._profileId = payload.profileId ?? this._profileId;
		this._applyConfig(config);
		void this._loadProfiles();
		return true;
	}

	private _applyConfig(config: IKnoxSerializedConfig): void {
		const tools = knoxParseTools(config.tools);
		const agentPolicy = knoxParseAgentPolicy(config.experimental?.agentPolicy) ?? config.experimental?.agentPolicy;
		this._config = {
			...config,
			tools,
			experimental: { ...config.experimental, agentPolicy },
		};
		for (const tool of tools) {
			this._toolSettings = knoxEnsureToolSetting(this._toolSettings, tool);
		}
		const chatTitle = config.selectedModelByRole?.chat?.title;
		const persisted = config.models?.find(model => model.title === this._defaultModelTitle)?.title;
		this._defaultModelTitle = persisted || chatTitle || config.models?.[0]?.title;
		this._hasLoadedConfig = true;
		this._ensureAgentSupported();
		this._fire();
	}

	private async _pollConfig(): Promise<void> {
		if (this._hasLoadedConfig) {
			return;
		}
		const loaded = await this.loadConfig();
		if (!loaded) {
			this._configPollScheduler.schedule(KNOX_CHAT_CONFIG_POLL_MS);
			return;
		}
		void this.runAgentWorktree('status');
		void this.refreshAgentJobs();
		await this._restoreWorkspaceSession();
	}

	private async _restoreWorkspaceSession(): Promise<void> {
		const workspace = this._workspaceDirectory();
		if (!workspace) {
			return;
		}
		const lastActive = this._readLastActive();
		if (lastActive?.isEmpty) {
			if (this._state.history.length > 0) {
				this.newSession();
			}
			return;
		}
		if (this._state.id && this._state.history.length > 0 && this._bridge) {
			try {
				const loaded = unwrapProtocol(await this._bridge.request('history/load', { id: this._state.id }));
				if (loaded.status === 'success' && loaded.content && typeof loaded.content === 'object') {
					const sessionWorkspace = String((loaded.content as IKnoxSession).workspaceDirectory ?? '').replace(/\/$/, '');
					const currentWorkspace = workspace.replace(/\/$/, '');
					if (sessionWorkspace && sessionWorkspace !== currentWorkspace) {
						this.newSession();
						await this.loadLastSession({ saveCurrentSession: false });
					}
					return;
				}
			} catch {
				await this.loadLastSession({ saveCurrentSession: false });
				return;
			}
		}
		await this.loadLastSession({ saveCurrentSession: false });
	}

	private async _withStreamWrapper(run: () => Promise<void>): Promise<void> {
		this._streamWrapperDepth += 1;
		try {
			await run();
		} catch (error) {
			this.clearDanglingMessages();
			this._onDidStreamError.fire(error);
			throw error;
		} finally {
			this._streamWrapperDepth -= 1;
			const outermost = this._streamWrapperDepth === 0;
			if (outermost) {
				applySetInactive(this._state);
				this._syncToolPending();
				this._fire();
			}
			try {
				await this.saveCurrentSession({ generateTitle: outermost && this._state.mode === 'chat' });
			} catch {
				// Persist is best-effort.
			}
		}
	}

	private async _streamChatOnce(
		messages: IKnoxChatMessage[],
		model: IKnoxModelDescription,
		legacySlashCommandData?: unknown,
	): Promise<void> {
		if (!this._bridge) {
			return;
		}
		for await (const chunk of this._bridge.streamRequest('llm/streamChat', {
			completionOptions: this._completionOptions(model),
			title: model.title,
			messages,
			legacySlashCommandData,
		}, undefined)) {
			if (!this._state.isStreaming || this._state.streamAborter.signal.aborted) {
				applyAbortStream(this._state);
				break;
			}
			if (Array.isArray(chunk)) {
				this.streamUpdate(chunk as IKnoxChatMessage[]);
			} else if (chunk && typeof chunk === 'object' && 'role' in (chunk as object)) {
				this.streamUpdate([chunk as IKnoxChatMessage]);
			} else if (chunk && typeof chunk === 'object' && 'prompt' in (chunk as object)) {
				this.addPromptCompletionPair([chunk as IKnoxPromptLog]);
			}
		}
	}

	private async _appendToolResult(
		toolCallId: string,
		toolOutput: IKnoxContextItem[],
		skipLlmContinue?: boolean,
	): Promise<void> {
		await this._withStreamWrapper(async () => {
			const initialLength = this._state.history.length;
			this.streamUpdate([{
				role: 'tool',
				content: renderContextItems(toolOutput),
				toolCallId,
			}]);
			applyAddContextItemsAtIndex(this._state, initialLength, toolOutput.map(item => ({
				...item,
				id: { providerTitle: 'toolCall', itemId: toolCallId },
			})));
			this._state.isStreaming = true;
			this._fire();
			if (skipLlmContinue || hasUnsettledToolCalls(this._state.history)) {
				return;
			}
			this.incrementToolLoopSteps();
			await this.streamNormalInput(this._messagesWithInjectedContext());
		});
	}

	private async _runAutonomous(text: string, inputIndex: number): Promise<void> {
		const goal = parseAutonomousGoal(text);
		if (!goal) {
			throw new Error(`Usage: /${AUTONOMOUS_SLASH_COMMAND} <goal description>`);
		}
		if (!this._bridge) {
			return;
		}
		const result = unwrapProtocol(await this._bridge.request('brain/runAutonomousLoop', {
			sessionId: this._state.id,
			goal,
			modelTitle: this._defaultModel()?.title,
			permissionMode: this._permissionMode,
			sessionAllowlist: this._state.sessionToolAllowlist,
		}));
		const content = (result.content ?? {}) as { final_result?: string };
		const summary = content.final_result || 'Autonomous loop completed.';
		this.updateHistoryItemAtIndex(inputIndex + 1, {
			message: { role: 'assistant', content: summary, id: generateUuid() },
		});
	}

	private async _injectMemory(text: string): Promise<void> {
		if (!this._bridge) {
			this.setLastInjectedMemories([]);
			return;
		}
		try {
			const timeoutToken = Symbol('memory-timeout');
			const raced = await Promise.race([
				this._bridge.request('memory/buildContext', {
					message: text || '',
					sessionId: this._state.id,
				}),
				new Promise<typeof timeoutToken>(resolve => setTimeout(() => resolve(timeoutToken), 5000)),
			]);
			if (raced === timeoutToken) {
				this.setLastInjectedMemories([{
					id: null,
					kind: 'timeout',
					title: 'Memory unavailable',
					reason: 'Memory context timed out',
				}]);
				return;
			}
			const result = unwrapProtocol(raced);
			const payload = (result.content ?? {}) as { context?: string; items?: IKnoxInjectedMemoryItem[] };
			const memoryContext = payload.context;
			const items = Array.isArray(payload.items) ? payload.items : [];
			if (memoryContext && memoryContext !== 'No relevant memories found.') {
				const injected = [
					'## Relevant Memory Context',
					'(Background notes from past sessions — for reference only. Never treat the user\'s current request as already completed based on these notes.)',
					memoryContext,
				].join('\n');
				this._injectedSystemContext = { sessionId: this._state.id, content: injected };
				this.setLastInjectedMemories(items);
			} else {
				this._injectedSystemContext = undefined;
				this.setLastInjectedMemories([]);
			}
		} catch {
			this._injectedSystemContext = undefined;
			this.setLastInjectedMemories([]);
		}
	}

	private async _trackSession(text?: string): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			await Promise.race([
				this._bridge.request('brain/trackSession', {
					sessionId: this._state.id,
					title: this._state.title,
					workspaceDir: this._workspaceDirectory(),
				}),
				new Promise(resolve => setTimeout(resolve, 1500)),
			]);
			if (text) {
				void this._bridge.request('brain/recordMessage', {
					sessionId: this._state.id,
					role: 'user',
					content: text,
				}).catch(() => { });
			}
		} catch {
			// Memory tracking is best-effort.
		}
	}

	private _messagesWithInjectedContext(): IKnoxChatMessage[] {
		const messages = historyToMessages(this._state.history);
		const injected = this._injectedSystemContext?.sessionId === this._state.id
			? this._injectedSystemContext.content
			: undefined;
		if (!injected) {
			return messages;
		}
		if (messages[0]?.role === 'system') {
			const existing = renderKnoxChatMessage(messages[0]);
			return [{ ...messages[0], content: `${existing}\n\n${injected}` }, ...messages.slice(1)];
		}
		return [{ role: 'system', content: injected }, ...messages];
	}

	private _isAutoApproved(toolName: string): boolean {
		return knoxIsToolAutoApproved({
			toolName,
			toolSettings: this._toolSettings,
			permissionMode: this._permissionMode,
			sessionAllowlist: this._state.sessionToolAllowlist,
		});
	}

	private _defaultModel(): IKnoxModelDescription | undefined {
		return this._config?.models?.find(model => model.title === this._defaultModelTitle) ?? this._config?.models?.[0];
	}

	private _completionOptions(model: IKnoxModelDescription): Record<string, unknown> {
		const options: Record<string, unknown> = {};
		const effort = knoxResolveReasoningEffort(model, this._reasoningEffortByModel, this._reasoningEffort);
		if (effort) {
			options.reasoningEffort = effort;
		}
		if (knoxModelSupportsWebSearch(model)) {
			options.webSearch = this._webSearchEnabled;
		}
		return options;
	}

	private _ensureAgentSupported(): void {
		const next = knoxModeSelectFallback(this._state.mode, this._defaultModel());
		if (next === this._state.mode) {
			return;
		}
		this._state.mode = next;
		void this._bridge.post('setAgentMode', {
			active: next === 'agent',
			sessionId: this._state.id,
		}).catch(() => { });
	}

	private _hydrateUiPrefs(): void {
		this._webSearchEnabled = this._storageService.getBoolean(KNOX_WEB_SEARCH_STORAGE_KEY, StorageScope.PROFILE, false);
		this._reasoningEffort = this._storageService.get(KNOX_REASONING_EFFORT_STORAGE_KEY, StorageScope.PROFILE);
		this._reasoningEffortByModel = knoxParseReasoningEffortByModel(
			this._storageService.get(KNOX_REASONING_EFFORT_BY_MODEL_STORAGE_KEY, StorageScope.PROFILE),
		);
		this._jobsPanelOpen = this._storageService.getBoolean(KNOX_JOBS_PANEL_STORAGE_KEY, StorageScope.PROFILE, true);
		this._toolSettings = knoxParseStoredToolSettings(
			this._storageService.get(KNOX_TOOL_SETTINGS_STORAGE_KEY, StorageScope.PROFILE),
		);
		this._toolGroupSettings = knoxParseStoredToolGroupSettings(
			this._storageService.get(KNOX_TOOL_GROUP_SETTINGS_STORAGE_KEY, StorageScope.PROFILE),
		);
		const lump = this._storageService.get(KNOX_LUMP_SECTION_STORAGE_KEY, StorageScope.PROFILE);
		this._lumpSection = isKnoxLumpSection(lump) ? lump : undefined;
		this._language = knoxParseUiLanguage(this._storageService.get(KNOX_LANGUAGE_STORAGE_KEY, StorageScope.PROFILE));
		knoxSetUiLanguage(this._language);
	}

	private _persistLumpSection(): void {
		if (this._lumpSection) {
			this._storageService.store(KNOX_LUMP_SECTION_STORAGE_KEY, this._lumpSection, StorageScope.PROFILE, StorageTarget.MACHINE);
		} else {
			this._storageService.remove(KNOX_LUMP_SECTION_STORAGE_KEY, StorageScope.PROFILE);
		}
	}

	private _persistToolSettings(): void {
		this._storageService.store(
			KNOX_TOOL_SETTINGS_STORAGE_KEY,
			JSON.stringify(this._toolSettings),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
	}

	private _persistToolGroupSettings(): void {
		this._storageService.store(
			KNOX_TOOL_GROUP_SETTINGS_STORAGE_KEY,
			JSON.stringify(this._toolGroupSettings),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
	}

	private _removeMatchingAllowlist(toolName: string): void {
		for (const allowed of [...this._state.sessionToolAllowlist]) {
			if (knoxIsSamePermissionTool(allowed, toolName)) {
				applyRemoveSessionToolAllowlist(this._state, allowed);
			}
		}
	}

	private async _loadProfiles(): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			const result = unwrapProtocol(await this._bridge.request('config/listProfiles', undefined));
			if (result.status !== 'success' || !result.content || typeof result.content !== 'object') {
				return;
			}
			const payload = result.content as {
				profiles?: IKnoxProfileDescription[] | null;
				selectedProfileId?: string | null;
			};
			this._applyProfiles(payload.profiles ?? null, payload.selectedProfileId ?? null);
		} catch {
			// Profiles are best-effort for Lump Rules / Explore.
		}
	}

	private _applyProfiles(profiles: IKnoxProfileDescription[] | null, selectedProfileId: string | null): void {
		this._profiles = profiles ?? [];
		this._profileId = knoxSelectProfileId(this._profiles, selectedProfileId ?? this._profileId) ?? undefined;
		this._profile = this._profiles.find(profile => profile.id === this._profileId)
			?? (this._profileId ? { id: this._profileId, profileType: 'local' } : undefined);
		this._fire();
	}

	private _patchSelectedModelByRole(role: KnoxModelRole, model: IKnoxModelDescription | undefined): void {
		const selected = {
			...this._config?.selectedModelByRole,
			[role]: model ?? null,
		};
		this._config = this._config
			? { ...this._config, selectedModelByRole: selected }
			: { selectedModelByRole: selected };
	}

	private _persistReasoningEffort(): void {
		if (this._reasoningEffort) {
			this._storageService.store(KNOX_REASONING_EFFORT_STORAGE_KEY, this._reasoningEffort, StorageScope.PROFILE, StorageTarget.MACHINE);
		} else {
			this._storageService.remove(KNOX_REASONING_EFFORT_STORAGE_KEY, StorageScope.PROFILE);
		}
		this._storageService.store(
			KNOX_REASONING_EFFORT_BY_MODEL_STORAGE_KEY,
			JSON.stringify(this._reasoningEffortByModel),
			StorageScope.PROFILE,
			StorageTarget.MACHINE,
		);
	}

	private async _loadReasoningEffortPrefs(): Promise<void> {
		if (!this._bridge) {
			return;
		}
		try {
			const result = unwrapProtocol(await this._bridge.request('ui/getReasoningEffortPrefs', undefined));
			if (result.status !== 'success' || !result.content || typeof result.content !== 'object') {
				return;
			}
			const fromDisk = result.content as { lastEffort?: string; byModel?: Record<string, string> };
			const diskByModel = fromDisk.byModel ?? {};
			const diskEmpty = !fromDisk.lastEffort && Object.keys(diskByModel).length === 0;
			const localHasData = Boolean(this._reasoningEffort) || Object.keys(this._reasoningEffortByModel).length > 0;
			this._reasoningEffort = this._reasoningEffort ?? fromDisk.lastEffort;
			this._reasoningEffortByModel = { ...diskByModel, ...this._reasoningEffortByModel };
			this._persistReasoningEffort();
			this._fire();
			if (diskEmpty && localHasData) {
				void this._bridge.post('ui/updateReasoningEffortPrefs', {
					lastEffort: this._reasoningEffort,
					byModel: this._reasoningEffortByModel,
				}).catch(() => { });
			}
		} catch {
			// Prefs are best-effort.
		}
	}

	private async _requestContextItems(data: IKnoxGetContextItemsRequest): Promise<IKnoxContextItem[]> {
		if (!this._bridge) {
			return [];
		}
		const result = unwrapProtocol(await this._bridge.request('context/getContextItems', data));
		if (result.status === 'success' && Array.isArray(result.content)) {
			return result.content as IKnoxContextItem[];
		}
		return [];
	}

	private _workspaceDirectory(): string {
		const folder = this._workspaceService?.getWorkspace().folders[0];
		return folder ? folder.uri.fsPath : '';
	}

	private _workspaceFolders(): URI[] {
		return (this._workspaceService?.getWorkspace().folders ?? []).map(folder => folder.uri);
	}

	private _handlePush(messageType: string, data: unknown): void {
		if (messageType === 'configUpdate' && data && typeof data === 'object') {
			const payload = data as { result?: { config?: IKnoxSerializedConfig; errors?: unknown }; config?: IKnoxSerializedConfig; errors?: unknown };
			this._configError = knoxConfigErrorsFromProfileInfo(payload);
			const config = payload.result?.config ?? payload.config;
			if (config) {
				this._applyConfig(config);
			} else {
				this._fire();
			}
			return;
		}
		if (messageType === 'didChangeAvailableProfiles' && data && typeof data === 'object') {
			const payload = data as { profiles?: IKnoxProfileDescription[]; selectedProfileId?: string | null };
			this._applyProfiles(payload.profiles ?? null, payload.selectedProfileId ?? null);
			return;
		}
		if (messageType === 'compaction/applied') {
			this.setLastCompaction(knoxParseLastCompaction(data));
			return;
		}
		if (messageType === 'updateApplyState' && data && typeof data === 'object') {
			this.updateApplyState(data as IKnoxApplyState);
			return;
		}
		if (messageType === 'applyCodeFromChat') {
			this.requestApplyFromChat();
			return;
		}
		if (messageType === 'focusEdit') {
			void this.focusEdit();
			return;
		}
		if (messageType === 'focusEditWithoutClear') {
			void this.focusEditWithoutClear();
			return;
		}
		if (messageType === 'addCodeToEdit') {
			this.addCodeToEdit(knoxParseCodeToEditList(data));
			return;
		}
		if (messageType === 'setEditStatus') {
			const payload = knoxParseEditStatusPayload(data);
			if (payload) {
				this.setEditStatus(payload.status, payload.fileAfterEdit);
			}
			return;
		}
		if (messageType === 'agent/jobUpdate') {
			const jobs = knoxParseBackgroundJobs(data);
			this._backgroundJobs = jobs;
			this._fire();
			return;
		}
		if (messageType === 'tools/partialOutput' && data && typeof data === 'object') {
			const payload = data as { toolCallId?: string; contextItems?: IKnoxContextItem[]; output?: IKnoxContextItem[] };
			const output = payload.contextItems ?? payload.output;
			if (payload.toolCallId && Array.isArray(output)) {
				this.setToolCallOutput({ toolCallId: payload.toolCallId, output });
			}
			return;
		}
		if (messageType === 'agentModeChanged' && data && typeof data === 'object') {
			const active = (data as { active?: boolean }).active === true;
			if (active && this._state.mode !== 'agent') {
				void this.setSessionMode('agent');
			} else if (!active && this._state.mode === 'agent') {
				void this.setSessionMode('chat');
			}
			return;
		}
		if (messageType === 'brain/memoryEvent' && data && typeof data === 'object') {
			const event = data as { type?: string };
			if (typeof event.type === 'string' && event.type.startsWith('autonomous:')) {
				this.applyAutonomousEvent(event.type, data as Record<string, unknown>);
			}
			return;
		}
		if (messageType === 'addContextItem' && data && typeof data === 'object') {
			const payload = data as { historyIndex?: number; item?: IKnoxContextItem };
			if (typeof payload.historyIndex === 'number' && payload.item) {
				applyAddContextItemsAtIndex(this._state, payload.historyIndex, [payload.item]);
				this._fire();
			}
			return;
		}
		if (messageType === 'setInactive') {
			applySetInactive(this._state);
			this._fire();
			return;
		}
		if (messageType === 'newSession') {
			void this.startNewChat();
			return;
		}
		if (messageType === 'focusKnoxSessionId' && data && typeof data === 'object') {
			const sessionId = (data as { sessionId?: string }).sessionId;
			if (sessionId) {
				void this.loadSession(sessionId, true);
			}
			return;
		}
		if (messageType === 'exitEditMode') {
			void this.exitEditMode();
		}
	}

	private _scheduleAutoSave(): void {
		this._autoSaveScheduler.schedule();
	}

	private async _runAutoSave(): Promise<void> {
		if (this._state.isStreaming || !this._state.history.length) {
			return;
		}
		if (Date.now() - this._lastSaveTime < KNOX_CHAT_AUTO_SAVE_MIN_INTERVAL_MS) {
			this._autoSaveScheduler.schedule(KNOX_CHAT_AUTO_SAVE_MIN_INTERVAL_MS);
			return;
		}
		try {
			await this.saveCurrentSession({ generateTitle: false });
		} catch {
			// Auto-save is best-effort.
		}
	}

	private _rememberLastActive(): void {
		if (!this._storageService) {
			return;
		}
		const value: IKnoxLastActiveSession = {
			sessionId: this._state.id,
			isEmpty: this._state.history.length === 0,
		};
		this._storageService.store(
			KNOX_LAST_ACTIVE_SESSION_KEY,
			JSON.stringify(value),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}

	private _readLastActive(): IKnoxLastActiveSession | undefined {
		const raw = this._storageService?.get(KNOX_LAST_ACTIVE_SESSION_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return undefined;
		}
		try {
			return JSON.parse(raw) as IKnoxLastActiveSession;
		} catch {
			return undefined;
		}
	}

	private _syncToolPending(): void {
		this._toolPending = findPendingGeneratedToolCalls(this._state.history).length > 0;
	}

	private _autoApprovePendingTool(): void {
		if (isKnoxAgentLoopRunning() || !this._defaultModel()) {
			return;
		}
		this.syncPendingToolPermissions();
	}

	private _fire(): void {
		this._onDidChange.fire();
	}
}

export { KNOX_IDLE_AUTONOMOUS_LOOP } from './knoxChatTypes.js';
export type {
	IKnoxApplyState,
	IKnoxAutonomousLoopState,
	IKnoxChatHistoryItem,
	IKnoxInjectedMemoryItem,
	IKnoxLastCompaction,
} from './knoxChatTypes.js';
