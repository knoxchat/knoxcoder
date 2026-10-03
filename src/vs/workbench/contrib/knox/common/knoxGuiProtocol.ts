/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IKnoxGuiMessage {
	readonly messageType: string;
	readonly messageId: string;
	readonly data: unknown;
}

export interface IKnoxGuiResponseEnvelope {
	readonly done?: boolean;
	readonly status?: 'success' | 'error';
	readonly content?: unknown;
	readonly error?: string;
}

/**
 * Replies to a GUI `request` / `streamRequest` (`status` + `done`). Host-pushed
 * inbound such as `setEditStatus` also has a `status` string, but not `done`.
 */
export function isKnoxGuiResponseEnvelope(data: unknown): data is IKnoxGuiResponseEnvelope {
	if (!data || typeof data !== 'object') {
		return false;
	}
	const rec = data as IKnoxGuiResponseEnvelope;
	return (rec.status === 'success' || rec.status === 'error') && typeof rec.done === 'boolean';
}

export const KNOX_GUI_OVERLAYS = [
	'models',
	'rules',
	'prompts',
	'context',
	'tools',
	'history',
	'settings',
] as const;

export type KnoxGuiOverlay = typeof KNOX_GUI_OVERLAYS[number] | null;

/** GUI `useSetup` posts `knox/heartbeat` immediately, every 5s, on focus, and on visibility. */
export const KNOX_GUI_HEARTBEAT_MS = 5_000;

export const enum KnoxGuiRoute {
	Chat = 'chat',
	History = 'history',
	Stats = 'stats',
	Config = 'config',
	ConfigError = 'config-error',
	AddModel = 'add-model',
	AddModelProvider = 'add-model-provider',
	BatchDiff = 'batch-diff',
	Memory = 'memory',
	CheckpointGraph = 'checkpoint-graph',
}

export const LUMP_OVERLAY_BY_PATH: Record<string, Exclude<KnoxGuiOverlay, null>> = {
	'/history': 'history',
};

export const KNOX_GUI_PATH_BY_ROUTE: Record<KnoxGuiRoute, string> = {
	[KnoxGuiRoute.Chat]: '/',
	[KnoxGuiRoute.History]: '/history',
	[KnoxGuiRoute.Stats]: '/stats',
	[KnoxGuiRoute.Config]: '/config',
	[KnoxGuiRoute.ConfigError]: '/config-error',
	[KnoxGuiRoute.AddModel]: '/addModel',
	[KnoxGuiRoute.AddModelProvider]: '/addModel/provider',
	[KnoxGuiRoute.BatchDiff]: '/batch-diff',
	[KnoxGuiRoute.Memory]: '/memory',
	[KnoxGuiRoute.CheckpointGraph]: '/checkpoint-graph',
};

export function lumpOverlaySectionForPath(path: string): Exclude<KnoxGuiOverlay, null> | undefined {
	return LUMP_OVERLAY_BY_PATH[path];
}

export function knoxGuiRouteFromPath(path: string): KnoxGuiRoute {
	if (path === '/' || path === '/index.html') {
		return KnoxGuiRoute.Chat;
	}
	if (path === '/history') {
		return KnoxGuiRoute.History;
	}
	if (path === '/stats') {
		return KnoxGuiRoute.Stats;
	}
	if (path === '/config') {
		return KnoxGuiRoute.Config;
	}
	if (path === '/config-error') {
		return KnoxGuiRoute.ConfigError;
	}
	if (path === '/addModel') {
		return KnoxGuiRoute.AddModel;
	}
	if (path.startsWith('/addModel/provider/')) {
		return KnoxGuiRoute.AddModelProvider;
	}
	if (path === '/batch-diff') {
		return KnoxGuiRoute.BatchDiff;
	}
	if (path === '/memory') {
		return KnoxGuiRoute.Memory;
	}
	if (path === '/checkpoint-graph') {
		return KnoxGuiRoute.CheckpointGraph;
	}
	return KnoxGuiRoute.Chat;
}

/** ToWebview messages the native GUI must handle (Layout + Chat + useSetup). */
export const KNOX_GUI_HOST_INBOUND = [
	'newSession',
	'isKnoxInputFocused',
	'focusKnoxInputWithNewSession',
	'focusKnoxInput',
	'focusKnoxInputWithoutClear',
	'addModel',
	'addApiKey',
	'navigateTo',
	'applyCodeFromChat',
	'updateApplyState',
	'setEditStatus',
	'exitEditMode',
	'focusEdit',
	'focusEditWithoutClear',
	'userInput',
	'highlightedCode',
	'addCodeToEdit',
	'addContextItem',
	'setInactive',
	'configUpdate',
	'didChangeAvailableProfiles',
	'refreshSubmenuItems',
	'agentStreamingUpdate',
	'agent/jobUpdate',
	'tools/partialOutput',
	'compaction/applied',
	'knoxchat/oauth/update',
	'openrouter/oauth/update',
	'brain/memoryEvent',
	'knox/chatTurnEvent',
	'setTheme',
	'setColors',
	'gitStateChanged',
	'agentModeChanged',
	'checkpointListUpdated',
	'checkpointGraphUpdated',
	'checkpointRestored',
	'memoryViewUpdated',
	'guiLanguageChanged',
	'activeChatSessionChanged',
	'addImageAttachment',
	'getWebviewHistoryLength',
	'getCurrentSessionId',
	'getDefaultModelTitle',
	'getActiveChatSession',
	'didCloseFiles',
	'newSessionWithPrompt',
	'focusKnoxSessionId',
] as const;

/** FromWebview messages the native GUI sends on setup / chat. */
export const KNOX_GUI_HOST_OUTBOUND = [
	'config/getSerializedProfileInfo',
	'config/updateSharedConfig',
	'config/listProfiles',
	'history/list',
	'history/search',
	'history/load',
	'history/save',
	'history/delete',
	'llm/streamChat',
	'abort',
	'tools/cancel',
	'context/getContextItems',
	'context/loadSubmenuItems',
	'context/searchFiles',
	'showFile',
	'showLines',
	'setGuiLanguage',
	'setActiveChatSession',
	'knoxchat/listModels',
	'openrouter/listModels',
	'knoxchat/oauth/status',
	'knoxchat/oauth/start',
	'knoxchat/oauth/cancel',
	'knoxchat/oauth/signOut',
	'openrouter/oauth/status',
	'openrouter/oauth/start',
	'openrouter/oauth/cancel',
	'openrouter/oauth/signOut',
	'config/addModel',
	'config/deleteModel',
	'openUrl',
	'ui/updateReasoningEffortPrefs',
	'knox/heartbeat',
	'batch/getPendingFiles',
	'batch/acceptAll',
	'batch/rejectAll',
	'batch/acceptSelected',
	'batch/rejectSelected',
	'brain/dashboard',
	'brain/searchMemories',
	'brain/pinMemories',
	'brain/pinMemory',
	'brain/unpinMemory',
	'brain/deleteMemory',
	'brain/mismatchMemory',
	'brain/deleteMemories',
	'brain/unpinMemories',
	'brain/getEffectiveContext',
	'brain/getMetricsTrend',
	'brain/getPhaseStatus',
	'brain/getReviewDue',
	'brain/getEbbinghausStats',
	'brain/consolidate',
	'brain/listEntities',
	'brain/getSessionHistory',
	'brain/searchBacklogs',
	'brain/getConfig',
	'brain/export',
	'brain/import',
	'brain/trackSession',
	'brain/dispatch',
	'memory/buildContext',
	'knox/buildAgentRequest',
	'knox/evaluateToolPolicy',
	'knox/startTurn',
	'knox/finishTurn',
	'knox/hydrateAssistant',
	'knox/runChatTurn',
	'knox/cancelChatTurn',
	'devdata/log',
	'didChangeSelectedProfile',
	'context/getSymbolsForFiles',
	'getPreviousCheckpoint',
	'showVirtualFile',
	'brain/store',
	'brain/recordSoulEvent',
	'brain/cancelAutonomousLoop',
	'brain/runAutonomousLoop',
	'brain/resolveAutonomousTool',
	'getGitChangedFiles',
	'getDiff',
	'openGitChange',
	'showStagedDiff',
	'agent/jobs',
	'getMemoryViewUiState',
	'saveMemoryViewUiState',
	'checkpointGraph',
	'getCheckpointGraphShell',
	'runCheckpointGraphAction',
	'config/updateSelectedModel',
	'config/newPromptFile',
	'config/addPrompt',
	'config/openProfile',
	'config/refreshProfiles',
	'ui/getReasoningEffortPrefs',
	'getCheckpointGraphUiState',
	'getActiveChatSession',
	'edit/exit',
	'focusEditor',
	'brain/exploreGraph',
	'brain/searchEntities',
	'brain/graphStats',
	'brain/listSessions',
	'brain/updateConfig',
	'brain/heal',
	'brain/optimize',
	'checkpointWorkingTree',
	'writeFile',
	'openFile',
	'showToast',
	'getWorkspaceDirs',
	'fileExists',
	'getOpenFiles',
	'edit/sendPrompt',
	'applyToFile',
	'insertAtCursor',
	'runCommand',
	'acceptDiff',
	'rejectDiff',
	'copyText',
	'getCheckpointForMessage',
	'createCheckpointForMessage',
	'restoreCheckpoint',
	'restoreCheckpointFiles',
	'previewRestore',
	'computeCheckpointDiff',
	'getCheckpointConfig',
	'saveCheckpointConfig',
	'getPerformanceDashboard',
	'analyzeCheckpoint',
	'suggestCheckpointGroups',
	'getSharedCheckpointBundles',
	'shareCheckpoints',
	'importSharedBundle',
	'revealSharedBundle',
	'getCheckpointForStableId',
	'setAgentMode',
	'agent/worktree',
	'agent/review',
	'agent/hooks',
	'chatDescriber/describe',
	'pinCheckpoint',
	'listCheckpoints',
	'getCheckpointDetails',
	'deleteCheckpoints',
	'saveCheckpointGraphUiState',
	'getCheckpointTimeline',
	'createCheckpointBranch',
	'setActiveCheckpointWorkspace',
	'openCheckpointFileDiff',
	'openCheckpointFileAtRevision',
	'openCheckpointWorkingFile',
	'copyCheckpointFilePath',
	'exportCheckpoint',
	'switchCheckpointBranch',
	'deleteCheckpointBranch',
	'renameCheckpointBranch',
	'mergeCheckpointBranches',
	'setCheckpointTag',
] as const;

/**
 * KN-378: leftover chrome names that native GUI listed without a caller.
 * Must stay empty — either wire a chrome caller or drop the outbound name.
 * Dropped: memory/create|search|delete|list|cleanup (brain/*), overwriteFile
 * (applyToFile / restoreCheckpoint / knox.enhancedUndo), config/reload (configUpdate inbound),
 * brain/forgetMemories (brain/deleteMemory), brain/stats (brain/getConfig + brain/dashboard).
 */
export const KNOX_GUI_HOST_OUTBOUND_UNUSED_IN_CHROME = [] as const;

/** Host requests with no GUI handler; answering keeps the host promise from hanging. */
export const KNOX_GUI_HOST_INBOUND_EMPTY_ACK = ['didChangeIdeSettings', 'incrementFtc'] as const;
