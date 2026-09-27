/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { emptyInputDoc, IKnoxGuiInputBlock } from './knoxGuiInput.js';
import { KnoxGuiOverlay, KnoxGuiRoute, lumpOverlaySectionForPath, knoxGuiRouteFromPath } from './knoxGuiProtocol.js';
import type { IKnoxGuiCheckpointGraphUi } from './knoxGuiCheckpoints.js';

export type KnoxChatMode = 'chat' | 'agent' | 'edit';
export type KnoxGuiEditStatus = 'not-started' | 'streaming' | 'accepting' | 'accepting:full-diff' | 'done';
export type KnoxPermissionMode = 'default' | 'acceptEdits' | 'fullAuto';
export type KnoxGuiLanguage = 'en' | 'zh';
export type KnoxToolStatus = 'generating' | 'generated' | 'calling' | 'done' | 'canceled' | 'errored';
export type KnoxToolSetting = 'allowedWithPermission' | 'allowedWithoutPermission' | 'disabled';
export type KnoxModelRole = 'chat' | 'edit' | 'apply' | 'viewRead' | 'realTimeSearch';
export type KnoxPolicyLevel = 'deny' | 'ask' | 'allow';

/** Monaco/TextMate token rule from host `setTheme`. */
export interface IKnoxGuiThemeRule {
	token?: string;
	foreground?: string;
	background?: string;
	fontStyle?: string;
}

/** Converted VS Code theme payload (`setTheme` data.theme). */
export interface IKnoxGuiVscTheme {
	base?: string;
	inherit?: boolean;
	rules?: IKnoxGuiThemeRule[];
	colors?: Record<string, string>;
}

export const DEFAULT_PERMISSION_MODE: KnoxPermissionMode = 'fullAuto';
export const PERMISSION_MODES: KnoxPermissionMode[] = ['default', 'acceptEdits', 'fullAuto'];
export const MODEL_ROLES: KnoxModelRole[] = ['chat', 'edit', 'apply', 'viewRead', 'realTimeSearch'];

export function nextPermissionMode(current: KnoxPermissionMode): KnoxPermissionMode {
	const idx = PERMISSION_MODES.indexOf(current);
	return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length];
}

export function nextToolSetting(current: KnoxToolSetting): KnoxToolSetting {
	if (current === 'allowedWithoutPermission') {
		return 'allowedWithPermission';
	}
	if (current === 'allowedWithPermission') {
		return 'disabled';
	}
	return 'allowedWithoutPermission';
}

export interface IKnoxGuiModel {
	title: string;
	provider?: string;
	model?: string;
	apiKey?: string;
	capabilities?: { tools?: boolean; webSearch?: boolean; images?: boolean; uploadImage?: boolean; reasoning?: boolean };
	supportedParameters?: string[];
}

export interface IKnoxGuiSlashCommand {
	name: string;
	description: string;
	prompt?: string;
}

export interface IKnoxGuiRule {
	title: string;
	body: string;
	source?: 'local' | 'inline' | 'uses';
	uses?: string;
}

export interface IKnoxGuiTool {
	name: string;
	group: string;
	description?: string;
	readonly?: boolean;
	displayTitle?: string;
	wouldLikeTo?: string;
	isCurrently?: string;
	hasAlready?: string;
	faviconUrl?: string;
}

export interface IKnoxGuiToolOutputItem {
	name?: string;
	description?: string;
	content: string;
}

export interface IKnoxGuiContextProvider {
	title: string;
	displayTitle?: string;
	description?: string;
	type?: 'normal' | 'query' | 'submenu';
	renderInlineAs?: string;
}

export interface IKnoxGuiAskQuestion {
	id: string;
	prompt: string;
	options?: string[];
	allowMultiple?: boolean;
	allowFreeform?: boolean;
}

export interface IKnoxGuiToolCall {
	id: string;
	name: string;
	arguments: string;
	status: KnoxToolStatus;
	output?: string;
	outputItems?: IKnoxGuiToolOutputItem[];
	collapsed?: boolean;
	parsedArgs?: Record<string, unknown>;
	questions?: IKnoxGuiAskQuestion[];
	answers?: Record<string, string>;
}

export interface IKnoxGuiPromptLogJevTurn {
	source?: string;
	route?: string;
	skill?: string;
	confidence?: number;
	reason?: string;
}

export interface IKnoxGuiPromptLog {
	modelTitle?: string;
	prompt?: string;
	completion?: string;
	jev?: { turn?: IKnoxGuiPromptLogJevTurn };
}

export interface IKnoxGuiHistoryItem {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'thinking' | 'tool';
	content: string;
	createdAt?: string;
	thinking?: string;
	thinkingCollapsed?: boolean;
	thinkingActive?: boolean;
	thinkingStartAt?: number;
	thinkingEndAt?: number;
	redactedThinking?: string;
	toolCalls?: IKnoxGuiToolCall[];
	images?: string[];
	inputDoc?: IKnoxGuiInputBlock[];
	contextItems?: { name: string; content: string; provider?: string }[];
	checkpointId?: string;
	error?: string;
	promptLogs?: IKnoxGuiPromptLog[];
}

export interface IKnoxGuiSessionTab {
	id: string;
	title: string;
	sessionId?: string;
}

export interface IKnoxGuiHistorySession {
	id: string;
	title: string;
	date: string;
	workspaceDirectory?: string;
}

/** Local completion counts from Core `stats/getTokensPerDay`. */
export interface IKnoxGuiDailyTokenStats {
	day: string;
	promptTokens: number;
	generatedTokens: number;
}

/** Local completion counts from Core `stats/getTokensPerModel`. */
export interface IKnoxGuiModelTokenStats {
	model: string;
	promptTokens: number;
	generatedTokens: number;
}

export interface IKnoxGuiConfigError {
	fatal: boolean;
	message: string;
}

export type KnoxGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
export type KnoxTaskPlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';
export type KnoxAutonomousStatus = 'idle' | 'running' | 'completed' | 'cancelled';
export type KnoxCompactionMethod = 'heuristic' | 'llm' | 'none';

export interface IKnoxGuiGitDiffFile {
	filename: string;
	filepath: string;
	displayPath: string;
	uri: string;
	additions: number;
	deletions: number;
	fileType: string;
	isBinary: boolean;
	status: KnoxGitFileStatus;
}

export interface IKnoxGuiBackgroundJob {
	id: string;
	kind?: 'shell' | 'task';
	title: string;
	status: 'running' | 'exited' | 'killed' | 'failed';
	startedAt?: number;
	endedAt?: number;
	exitCode?: number;
	detail?: string;
	output?: string;
}

export interface IKnoxGuiTaskPlanStep {
	id: string;
	title: string;
	status: KnoxTaskPlanStepStatus;
	activity?: string;
	live?: boolean;
}

export interface IKnoxGuiTaskPlan {
	title: string;
	steps: IKnoxGuiTaskPlanStep[];
	remaining: number;
	doneCount: number;
	current?: IKnoxGuiTaskPlanStep;
	updating: boolean;
	fingerprint: string;
}

export interface IKnoxGuiCompaction {
	tokensSaved: number;
	originalMessageCount: number;
	compactedMessageCount: number;
	summarized?: boolean;
	deduplicated?: boolean;
	summarizationMethod?: KnoxCompactionMethod;
	summaryText?: string;
}

export interface IKnoxGuiInjectedMemory {
	id: number | null;
	kind: string;
	title: string;
	reason: string;
	category?: string;
	score?: number;
	pinned?: boolean;
	evidence?: string[];
}

export interface IKnoxGuiAutonomous {
	iteration: number;
	max?: number;
	status: KnoxAutonomousStatus;
	goal?: string;
}

export interface IKnoxGuiFindState {
	open: boolean;
	query: string;
	caseSensitive: boolean;
	regex: boolean;
	current: number;
	total: number;
	matchIndexes: number[];
}

export interface IKnoxGuiWorktree {
	enabled: boolean;
	busy: boolean;
	branch?: string;
	path?: string;
	files: string[];
	error?: string;
}

export interface IKnoxGuiSuggestItem {
	id: string;
	label: string;
	description?: string;
	section?: string;
	insertText?: string;
	itemType?: string;
	query?: string;
	icon?: string;
	providerType?: 'normal' | 'query' | 'submenu';
	renderInlineAs?: string;
	bookmarked?: boolean;
	recent?: boolean;
	slashSource?: 'builtin' | 'prompt';
	truncated?: boolean;
	truncatedCount?: number;
}

export interface IKnoxGuiApplyState {
	streamId: string;
	filepath?: string;
	status: string;
	numDiffs?: number;
}

export interface IKnoxGuiCheckpointNode {
	id: string;
	description: string;
	created: string;
	kind: string;
	branchId?: string;
	tags: string[];
	shortId: string;
	pinned: boolean;
	changedPaths: string[];
	sessionId?: string;
	parents: string[];
	fileChanges: { added: number; modified: number; deleted: number };
	workingTree?: boolean;
}

export interface IKnoxGuiCheckpointBranch {
	id: string;
	name: string;
	headCheckpointId: string;
	isActive: boolean;
	color?: string;
}

export type KnoxCheckpointPanelTab = 'graph' | 'checkpoints' | 'timeline' | 'analysis' | 'share' | 'configuration' | 'dashboard';
export type KnoxCheckpointDialog = 'restore' | 'compare' | null;

export interface IKnoxGuiRestorePreviewFile {
	relativePath: string;
	action: 'overwrite' | 'create' | 'delete';
	additions: number;
	deletions: number;
	hunkCount: number;
}

export interface IKnoxGuiRestorePreview {
	checkpointId: string;
	description: string;
	modified: number;
	added: number;
	deleted: number;
	files: IKnoxGuiRestorePreviewFile[];
	writePaths: string[];
	extraPaths: string[];
	skippedFiles: Array<{ path: string; reason: string }>;
}

export interface IKnoxGuiCheckpointDiffFile {
	relativePath: string;
	status: 'added' | 'deleted' | 'modified' | 'unchanged';
	oldContent: string | null;
	newContent: string | null;
	oldEncoding?: string;
	newEncoding?: string;
	isBinary: boolean;
	additions: number;
	deletions: number;
}

export interface IKnoxGuiCheckpointDiff {
	oldCheckpoint: { id: string; description: string; created: string };
	newCheckpoint: { id: string; description: string; created: string };
	files: IKnoxGuiCheckpointDiffFile[];
}

export interface IKnoxGuiCheckpointConfig {
	maxCheckpoints: number;
	retentionDays: number;
	maxStorageBytes: number;
	maxFilesPerCheckpoint: number;
	maxFileSizeBytes: number;
	captureBinaryFiles: boolean;
	enableCompression: boolean;
	encryptAtRest: boolean;
	enableAutoCheckpoints: boolean;
	trackedExtensions: string[];
	autoCleanup: boolean;
	cleanupIntervalHours: number;
	autoEnabled: boolean;
	autoMinIntervalMs: number;
	autoFileChangeThreshold: number;
	autoShowNotifications: boolean;
}

export interface IKnoxGuiCheckpointDashboard {
	currentStorage?: { totalBytes: number; checkpointCount: number; blobCount?: number };
	storageHistory: Array<{ timestamp: string; totalBytes: number; checkpointCount: number }>;
	creationFrequency: Array<{ bucket: string; count: number }>;
	restorationEvents: Array<{ timestamp: string; checkpointId: string; success: boolean; durationMs: number; filesRestored: number; filesFailed: number; error?: string }>;
	aiSessionMetrics: Array<{ sessionId: string; startedAt: string; filesChanged: number; checkpointsCreated: number; rollbacks?: number; durationSeconds: number }>;
	summary: {
		totalCheckpointsCreated: number;
		totalRestorations: number;
		restorationSuccessRate: number;
		avgCreationTimeMs: number;
		totalAiSessions: number;
		avgChangesPerSession: number;
		totalRollbacks: number;
	};
}

export interface IKnoxGuiCheckpointAnalysis {
	checkpointId: string;
	generatedDescription: string;
	riskAssessment: { level: 'Low' | 'Medium' | 'High' | 'Critical'; score: number; factors: Array<{ category: string; description: string; weight: number; affectedFiles: string[] }>; recommendations: string[] };
	impactAnalysis: { affectedFeatures: Array<{ name: string; impactLevel: string; changedFiles: string[] }>; affectedLayers: string[]; scope: string; uniqueDirectories?: number; testFilesChanged?: boolean; linesAdded?: number; linesDeleted?: number };
	counts?: { changed: number; created?: number; deleted?: number; modified?: number; tests?: number; config?: number; lockfile?: number };
	groupingSuggestion?: IKnoxGuiCheckpointAnalysisGroup;
}

export interface IKnoxGuiCheckpointAnalysisGroup {
	groupName: string;
	rationale: string;
	confidence: number;
	checkpointIds: string[];
	kind?: string;
}

export interface IKnoxGuiCheckpointShareBundle {
	id: string;
	description: string;
	sharedAt: string;
	checkpointCount: number;
	checkpointIds: string[];
	filePath: string;
	sharedBy: string;
	machineId: string;
	exists: boolean;
}

export interface IKnoxGuiCheckpointAuditRecord {
	id: string;
	timestamp: string;
	userId: string;
	machineId: string;
	action: string;
	resourceType: string;
	resourceId: string;
	outcome: string;
	details: string;
}

export interface IKnoxGuiMemoryItem {
	id: string;
	title: string;
	content?: string;
	pinned?: boolean;
	category?: string;
	keywords?: string;
	importance?: number;
	retrievalCount?: number;
	tier?: string;
	createdAt?: string;
	lastAccessedAt?: string;
	sourceSessionId?: string;
}

export interface IKnoxGuiMemoryDashboard {
	totalSessions: number;
	totalEpisodic: number;
	totalSemantic: number;
	totalEntities: number;
	totalEdges: number;
	totalAssociations?: number;
	totalPatterns?: number;
	totalProcedures?: number;
	totalTags?: number;
	totalCollections?: number;
	dbSizeBytes?: number;
	healthScore?: number;
	healthGrade?: string;
	healthStatus?: string;
	healthIssues?: string[];
	healthRecommendations?: string[];
	activePhase?: string;
	phaseCounts?: Record<string, number>;
	cycleInvariantMet?: boolean;
	tierCounts?: Record<string, number>;
	categoryCounts?: Record<string, number>;
	entityTypeCounts?: Record<string, number>;
	oldestMemory?: string;
	newestMemory?: string;
	graphMaxEntities?: number;
	graphCapUtilization?: number;
	graphAtCap?: boolean;
	graphTotalEntities?: number;
	graphTotalEdges?: number;
	graphMaxDepth?: number;
	graphDepthDecayGamma?: number;
	sessions?: IKnoxGuiMemorySession[];
	consolidation?: IKnoxGuiMemoryConsolidation;
}

export interface IKnoxGuiEffectiveContext {
	totalEffective: number;
	activeWindowTokens?: number;
	lastContextTokensUsed?: number;
	hierarchyEffectiveTokens?: number;
	workingMemoryBudget?: number;
	contextMaxTokens?: number;
	windowUtilization?: number;
	memoryTokensSaved?: number;
	graphEntityCount?: number;
	graphMaxEntities?: number;
	graphCapUtilization?: number;
	tierTokens?: Record<string, number>;
	compressionRatios?: Record<string, number>;
	levels: Array<{ id: string; name: string; tokens: number; ratio?: number; effectiveTokens?: number }>;
}

export interface IKnoxGuiMemoryConsolidation {
	totalRuns: number;
	lastRunAt?: string;
	avgDurationMs: number;
	lastSubPhases?: Record<string, number>;
}

export interface IKnoxGuiMetricsTrend {
	response?: string;
	success?: string;
	growth?: string;
	compression?: string;
	effectiveContext?: string;
	periodHours?: number;
	snapshots?: Array<{
		avgResponseMs: number;
		successRate: number;
		memoryCount: number;
		totalEffective?: number;
		tokensSaved?: number;
	}>;
}

export interface IKnoxGuiMemoryPhaseStatus {
	activePhase?: string;
	phaseCounts: Record<string, number>;
	cycleInvariantMet?: boolean;
	backgroundSleepActive?: boolean;
	lastCompleted?: string;
}

export interface IKnoxGuiMemoryReviewDue {
	memoryId: string;
	title: string;
	category?: string;
	overdue?: boolean;
	currentRetention?: number;
}

export interface IKnoxGuiEbbinghausStats {
	reviewDueCount: number;
	avgRetention: number;
	lambda?: number;
}

export interface IKnoxGuiMemorySession {
	id: string;
	title: string;
	updatedAt?: string;
	messageCount?: number;
	summary?: string;
	isActive?: boolean;
}

export interface IKnoxGuiMemorySessionHistory {
	sessionId: string;
	episodic: Array<{ id?: string; role?: string; content: string }>;
	semantic: Array<{ id?: string; title?: string; category?: string; content: string }>;
	topics?: string[];
	tokenEstimate?: number;
	messageCount?: number;
}

export interface IKnoxGuiMemoryBacklogMatch {
	id: string;
	kind: 'episodic' | 'semantic';
	title?: string;
	content: string;
	sessionId?: string;
	category?: string;
	role?: string;
}

export interface IKnoxGuiMemoryGraphStats {
	totalEntities: number;
	totalEdges: number;
	entityTypes: Record<string, number>;
	maxEntities?: number;
	capUtilization?: number;
	atCap?: boolean;
	maxDepth?: number;
	depthDecayGamma?: number;
}

export interface IKnoxGuiMemoryGraphExplore {
	centerId?: number;
	centerName?: string;
	centerDescription?: string;
	entities: IKnoxGuiMemoryGraphEntity[];
	edges: IKnoxGuiMemoryGraphEdge[];
	depthReached?: number;
	entityDepths?: Record<string, number>;
}

export interface IKnoxGuiMemoryGraphEntity {
	id: number;
	name: string;
	entityType: string;
	description?: string;
	mentionCount: number;
	edgeCount?: number;
}

export interface IKnoxGuiMemoryGraphEdge {
	id: number;
	source: number;
	target: number;
	relationship: string;
	weight: number;
}

export interface IKnoxGuiPolicy {
	paths: string;
	commands: string;
	externalDirectory: KnoxPolicyLevel;
	sandboxDestructive: boolean;
}

export interface IKnoxGuiPromptDraft {
	name: string;
	description: string;
	prompt: string;
	/** True when SquarePen opened an existing slash prompt (`AddPromptDialog.existingPrompt`). */
	existing?: boolean;
}

export function knoxGuiIsDedicatedEditor(state: { lockedRoute?: KnoxGuiRoute }): boolean {
	return state.lockedRoute === KnoxGuiRoute.Memory || state.lockedRoute === KnoxGuiRoute.CheckpointGraph;
}

export function withLockedEditorRoute(state: IKnoxGuiState): IKnoxGuiState {
	if (!knoxGuiIsDedicatedEditor({ lockedRoute: state.lockedRoute })) {
		return state;
	}
	return { ...state, route: state.lockedRoute!, overlay: null };
}

export interface IKnoxGuiState {
	route: KnoxGuiRoute;
	/** Memory / Checkpoint Graph editors pin this so chat setup cannot steal the pane. */
	lockedRoute?: KnoxGuiRoute;
	overlay: KnoxGuiOverlay;
	providerName?: string;
	language: KnoxGuiLanguage;
	input: string;
	inputDoc: IKnoxGuiInputBlock[];
	inputFocused: boolean;
	sessionId: string;
	sessionTitle: string;
	history: IKnoxGuiHistoryItem[];
	isStreaming: boolean;
	isLoadingHistory: boolean;
	mode: KnoxChatMode;
	permissionMode: KnoxPermissionMode;
	modelTitle?: string;
	models: IKnoxGuiModel[];
	modelsByRole: Record<KnoxModelRole, IKnoxGuiModel[]>;
	selectedModelByRole: Partial<Record<KnoxModelRole, string>>;
	slashCommands: IKnoxGuiSlashCommand[];
	bookmarkedSlash: string[];
	rules: IKnoxGuiRule[];
	tools: IKnoxGuiTool[];
	toolSettings: Record<string, KnoxToolSetting>;
	toolGroupExcluded: string[];
	sessionToolAllowlist: string[];
	contextProviders: IKnoxGuiContextProvider[];
	defaultContext: string[];
	recentSlash: string[];
	profileId?: string;
	profileType?: string;
	yamlRules?: unknown[];
	showSessionTabs: boolean;
	fontSize: number;
	/** Converted TextMate/Monaco theme from host `setTheme`. */
	vscTheme?: IKnoxGuiVscTheme;
	/** CSS vars from host `setColors` plus `theme.colors` (`--vscode-editor-background`, …). */
	vscColors: Record<string, string>;
	/** hljs class → color from `setTheme` rules (VscTheme). */
	vscTokenColors: Record<string, string>;
	webSearchEnabled: boolean;
	webSearchSupported: boolean;
	imagesSupported: boolean;
	toolsSupported: boolean;
	reasoningEffort?: string;
	reasoningEfforts: string[];
	codeWrap: boolean;
	codeBlockToolbarPosition: 'top' | 'bottom';
	showChatScrollbar: boolean;
	autoNameSessionTitles: boolean;
	markdownFormatting: boolean;
	agentProfile: string;
	agentMaxSteps: number;
	agentDoomLoopThreshold: number;
	agentViewSubdirectoryMaxFiles: number;
	jevEnabled: boolean;
	policy: IKnoxGuiPolicy;
	dialogMessage?: string;
	configError: IKnoxGuiConfigError[];
	historySessions: IKnoxGuiHistorySession[];
	historyQuery: string;
	historySelected: string[];
	historySelectionMode: boolean;
	historyConfirmDelete: boolean;
	promptPath: string;
	addModelProvidersSelected: boolean;
	statsDaily: IKnoxGuiDailyTokenStats[];
	statsByModel: IKnoxGuiModelTokenStats[];
	pendingFiles: { filepath: string; numDiffs: number; selected: boolean }[];
	tabs: IKnoxGuiSessionTab[];
	activeTabId: string;
	compaction?: IKnoxGuiCompaction;
	worktree: IKnoxGuiWorktree;
	backgroundJobs: IKnoxGuiBackgroundJob[];
	jobsPanelOpen: boolean;
	taskPlan: IKnoxGuiTaskPlanStep[];
	autonomous?: IKnoxGuiAutonomous;
	injectedMemories: IKnoxGuiInjectedMemory[];
	memoryMode: string;
	gitDiffFiles: IKnoxGuiGitDiffFile[];
	find: IKnoxGuiFindState;
	mentionOpen: boolean;
	slashOpen: boolean;
	suggestItems: IKnoxGuiSuggestItem[];
	suggestQuery: string;
	suggestSelected: number;
	suggestSubmenu?: string;
	suggestSubmenuTitle?: string;
	suggestLoading: boolean;
	contextItems: { name: string; content: string; provider?: string }[];
	codeToEdit: { filepath: string; contents?: string; range?: { start: { line: number; character?: number }; end: { line: number; character?: number } } }[];
	editStatus: KnoxGuiEditStatus;
	editPreviousInputs: string[];
	editFileAfterEdit?: string;
	images: { name: string; imageUrl: string }[];
	historicalImages: string[];
	editingUserIndex?: number;
	isGatheringContext: boolean;
	addFileOpen: boolean;
	applyStates: IKnoxGuiApplyState[];
	streamError?: { message: string; statusCode?: number; kind?: string };
	agentMeterOpen: boolean;
	toolLoopSteps: number;
	oauthStatus?: string;
	oauthHandle?: string;
	oauthConnected: boolean;
	oauthError?: string;
	addModelRole?: KnoxModelRole;
	addModelModal: boolean;
	addModelSelectedModel?: string;
	addModelDraft: Record<string, string>;
	/** Model-picker Add Model assigns chat+edit+apply, matching original `#bulkAddMode`. */
	addModelBulk: boolean;
	knoxChatModels: Array<{
		title: string;
		description?: string;
		model: string;
		contextLength: number;
		category?: string;
		maxTokens?: number;
		supportsTools?: boolean;
		supportsReasoning?: boolean;
		supportsWebSearch?: boolean;
		supportedParameters?: string[];
	}>;
	knoxChatModelsLoading: boolean;
	batchApplying: boolean;
	memoryTab: string;
	memoryQuery: string;
	memoryFilterCategory: string;
	memoryFilterTier: string;
	memoryFilterPinned: 'all' | 'pinned' | 'unpinned';
	memorySortBy: 'recent' | 'importance' | 'accessed';
	memoryHasMore: boolean;
	memoryBusy: boolean;
	memoryActionMessage?: string;
	memoryDashboard?: IKnoxGuiMemoryDashboard;
	memoryEffectiveContext?: IKnoxGuiEffectiveContext;
	memoryMetricsTrend?: IKnoxGuiMetricsTrend;
	memoryPhaseStatus?: IKnoxGuiMemoryPhaseStatus;
	memoryReviewDue: IKnoxGuiMemoryReviewDue[];
	memoryEbbinghausStats?: IKnoxGuiEbbinghausStats;
	memories: IKnoxGuiMemoryItem[];
	memorySessions: IKnoxGuiMemorySession[];
	memorySessionQuery: string;
	memorySelectedSessionId?: string;
	memorySessionHistory?: IKnoxGuiMemorySessionHistory;
	memoryBacklogMatches: IKnoxGuiMemoryBacklogMatch[];
	memoryGraphEntities: IKnoxGuiMemoryGraphEntity[];
	memoryGraphEdges: IKnoxGuiMemoryGraphEdge[];
	memoryGraphQuery: string;
	memoryGraphFilterType: string;
	memoryGraphTotal: number;
	memoryGraphHasMore: boolean;
	memoryGraphStats?: IKnoxGuiMemoryGraphStats;
	memoryExplore?: IKnoxGuiMemoryGraphExplore;
	memoryConfig: Record<string, unknown>;
	reasoningEffortByModel: Record<string, string>;
	checkpointQuery: string;
	checkpointView: KnoxCheckpointPanelTab;
	checkpointThisSession: boolean;
	checkpointShell?: { state: string; checkpointCount: number };
	checkpoints: IKnoxGuiCheckpointNode[];
	checkpointBranches: IKnoxGuiCheckpointBranch[];
	selectedCheckpointId?: string;
	checkpointDialog: KnoxCheckpointDialog;
	checkpointRestoreId?: string;
	checkpointRestoreMemory: boolean;
	checkpointRestoreLoading: boolean;
	checkpointRestoreError?: string;
	checkpointRestorePreview?: IKnoxGuiRestorePreview;
	checkpointRestoreSelected: string[];
	checkpointRestoreShowDiff: boolean;
	checkpointRestoreDiff?: IKnoxGuiCheckpointDiff;
	checkpointCompareLeftId?: string;
	checkpointCompareRightId?: string;
	checkpointComparePickId?: string;
	checkpointCompareLoading: boolean;
	checkpointCompareError?: string;
	checkpointCompareDiff?: IKnoxGuiCheckpointDiff;
	checkpointDiffView: 'split' | 'unified';
	checkpointDiffWrap: boolean;
	checkpointDiffSelectedFile?: string;
	checkpointConfig?: IKnoxGuiCheckpointConfig;
	checkpointConfigDraft?: IKnoxGuiCheckpointConfig;
	checkpointConfigStatus?: { type: 'success' | 'error' | 'info'; messageKey: string };
	checkpointDashboard?: IKnoxGuiCheckpointDashboard;
	checkpointDashboardTab: 'overview' | 'storage' | 'activity' | 'ai';
	checkpointAnalysis?: IKnoxGuiCheckpointAnalysis;
	checkpointAnalysisGroups: IKnoxGuiCheckpointAnalysisGroup[];
	checkpointShareBundles: IKnoxGuiCheckpointShareBundle[];
	checkpointShareAudit: IKnoxGuiCheckpointAuditRecord[];
	checkpointShareTab: 'shared' | 'audit';
	checkpointGraphUi: IKnoxGuiCheckpointGraphUi;
	checkpointHeadId?: string;
	checkpointGraphHasMore: boolean;
	checkpointGraphLimit: number;
	checkpointGraphLoadMoreError?: string;
	checkpointWorkingTreePaths: string[];
	checkpointWorkspaceFolders: Array<{ path: string; name: string }>;
	checkpointActiveWorkspace?: string;
	checkpointListTotal: number;
	checkpointListHasMore: boolean;
	checkpointListLoading: boolean;
	checkpointListLoadingMore: boolean;
	checkpointListItems: IKnoxGuiCheckpointNode[];
	checkpointTimeline: IKnoxGuiCheckpointNode[];
	checkpointTimelineBranches: IKnoxGuiCheckpointBranch[];
	promptDraft?: IKnoxGuiPromptDraft;
	restoreNotice?: { sessionId: string; content: string };
	setupComplete: boolean;
	fatalConfig: boolean;
	historyHydrateNotice: 'large' | null;
	autoScroll: boolean;
	startersExpanded: boolean;
}

function emptyRoleModels(): Record<KnoxModelRole, IKnoxGuiModel[]> {
	return { chat: [], edit: [], apply: [], viewRead: [], realTimeSearch: [] };
}

export function createInitialKnoxGuiState(): IKnoxGuiState {
	return {
		route: KnoxGuiRoute.Chat,
		overlay: null,
		language: 'en',
		input: '',
		inputDoc: emptyInputDoc(),
		inputFocused: false,
		sessionId: '',
		sessionTitle: '',
		history: [],
		isStreaming: false,
		isLoadingHistory: false,
		mode: 'agent',
		permissionMode: DEFAULT_PERMISSION_MODE,
		models: [],
		modelsByRole: emptyRoleModels(),
		selectedModelByRole: {},
		slashCommands: [],
		bookmarkedSlash: [],
		rules: [],
		tools: [],
		toolSettings: {},
		toolGroupExcluded: [],
		sessionToolAllowlist: [],
		contextProviders: [],
		defaultContext: [],
		recentSlash: [],
		showSessionTabs: false,
		fontSize: 14,
		vscColors: {},
		vscTokenColors: {},
		webSearchEnabled: false,
		webSearchSupported: false,
		imagesSupported: false,
		toolsSupported: true,
		reasoningEfforts: [],
		codeWrap: true,
		codeBlockToolbarPosition: 'top',
		showChatScrollbar: false,
		autoNameSessionTitles: true,
		markdownFormatting: true,
		agentProfile: 'default',
		agentMaxSteps: 0,
		agentDoomLoopThreshold: 3,
		agentViewSubdirectoryMaxFiles: 1000,
		jevEnabled: false,
		policy: { paths: '', commands: '', externalDirectory: 'ask', sandboxDestructive: true },
		configError: [],
		historySessions: [],
		historyQuery: '',
		historySelected: [],
		historySelectionMode: false,
		historyConfirmDelete: false,
		promptPath: '',
		addModelProvidersSelected: true,
		statsDaily: [],
		statsByModel: [],
		pendingFiles: [],
		tabs: [],
		activeTabId: '',
		worktree: { enabled: false, busy: false, files: [] },
		backgroundJobs: [],
		jobsPanelOpen: false,
		taskPlan: [],
		injectedMemories: [],
		memoryMode: 'summarized',
		gitDiffFiles: [],
		find: { open: false, query: '', caseSensitive: false, regex: false, current: 0, total: 0, matchIndexes: [] },
		mentionOpen: false,
		slashOpen: false,
		suggestItems: [],
		suggestQuery: '',
		suggestSelected: 0,
		suggestLoading: false,
		contextItems: [],
		codeToEdit: [],
		editStatus: 'not-started',
		editPreviousInputs: [],
		images: [],
		historicalImages: [],
		isGatheringContext: false,
		addFileOpen: false,
		applyStates: [],
		agentMeterOpen: false,
		toolLoopSteps: 0,
		oauthConnected: false,
		addModelModal: false,
		addModelDraft: {},
		addModelBulk: false,
		knoxChatModels: [],
		knoxChatModelsLoading: false,
		batchApplying: false,
		memoryTab: 'overview',
		memoryQuery: '',
		memoryFilterCategory: 'all',
		memoryFilterTier: 'all',
		memoryFilterPinned: 'all',
		memorySortBy: 'recent',
		memoryHasMore: false,
		memoryBusy: false,
		memoryReviewDue: [],
		memories: [],
		memorySessions: [],
		memorySessionQuery: '',
		memoryBacklogMatches: [],
		memoryGraphEntities: [],
		memoryGraphEdges: [],
		memoryGraphQuery: '',
		memoryGraphFilterType: 'all',
		memoryGraphTotal: 0,
		memoryGraphHasMore: false,
		memoryConfig: {},
		reasoningEffortByModel: {},
		checkpointQuery: '',
		checkpointView: 'graph',
		checkpointThisSession: true,
		checkpoints: [],
		checkpointBranches: [],
		checkpointDialog: null,
		checkpointRestoreMemory: false,
		checkpointRestoreLoading: false,
		checkpointRestoreSelected: [],
		checkpointRestoreShowDiff: false,
		checkpointCompareLoading: false,
		checkpointDiffView: 'split',
		checkpointDiffWrap: true,
		checkpointDashboardTab: 'overview',
		checkpointAnalysisGroups: [],
		checkpointShareBundles: [],
		checkpointShareAudit: [],
		checkpointShareTab: 'shared',
		checkpointGraphUi: {
			hiddenColumns: [],
			columnWidths: { date: 152, kind: 104, id: 112 },
			mute: true,
			detailsLocation: 'inline',
			dateStyle: 'relative',
			laneColors: ['#61afef', '#98c379', '#e5c07b', '#e06c75', '#c678dd', '#56b6c2', '#d19a66', '#abb2bf'],
			fileView: 'list',
		},
		checkpointGraphHasMore: false,
		checkpointGraphLimit: 100,
		checkpointWorkingTreePaths: [],
		checkpointWorkspaceFolders: [],
		checkpointListTotal: 0,
		checkpointListHasMore: false,
		checkpointListLoading: false,
		checkpointListLoadingMore: false,
		checkpointListItems: [],
		checkpointTimeline: [],
		checkpointTimelineBranches: [],
		setupComplete: false,
		fatalConfig: false,
		historyHydrateNotice: null,
		autoScroll: true,
		startersExpanded: false,
	};
}

export function applySessionTabChange(
	tabs: IKnoxGuiSessionTab[],
	activeTabId: string,
	currentSessionId: string,
	currentSessionTitle: string,
	newTabId: string,
): { tabs: IKnoxGuiSessionTab[]; activeTabId: string } {
	if (!currentSessionId) {
		return { tabs, activeTabId };
	}
	const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs.find(tab => !tab.sessionId) ?? tabs[tabs.length - 1];
	if (!activeTab) {
		const tab = { id: newTabId, title: currentSessionTitle || 'Chat 1', sessionId: currentSessionId };
		return { tabs: [tab], activeTabId: tab.id };
	}
	if (activeTab.sessionId === currentSessionId) {
		return {
			tabs: tabs.map(tab => tab.id === activeTab.id ? { ...tab, title: currentSessionTitle || tab.title } : tab),
			activeTabId: activeTab.id,
		};
	}
	const existing = tabs.find(tab => tab.sessionId === currentSessionId);
	if (existing) {
		return {
			tabs: tabs
				.filter(tab => tab.sessionId || tab.id === existing.id)
				.map(tab => ({
					...tab,
					title: tab.sessionId === currentSessionId ? (currentSessionTitle || tab.title) : tab.title,
				})),
			activeTabId: existing.id,
		};
	}
	if (!activeTab.sessionId) {
		return {
			tabs: tabs.map(tab => tab.id === activeTab.id
				? { ...tab, sessionId: currentSessionId, title: currentSessionTitle || tab.title }
				: tab),
			activeTabId: activeTab.id,
		};
	}
	const tab = { id: newTabId, title: currentSessionTitle || 'Chat', sessionId: currentSessionId };
	return { tabs: [...tabs, tab], activeTabId: tab.id };
}

export function applyCloseTab(
	tabs: IKnoxGuiSessionTab[],
	activeTabId: string,
	closeId: string,
): { tabs: IKnoxGuiSessionTab[]; activeTabId: string; loadSessionId?: string; startNew: boolean } {
	const closingActive = (tabs.find(tab => tab.id === closeId)?.id ?? '') === activeTabId || closeId === activeTabId;
	const next = tabs.filter(tab => tab.id !== closeId);
	if (!closingActive) {
		return { tabs: next, activeTabId, startNew: false };
	}
	if (!next.length) {
		return { tabs: [], activeTabId: '', startNew: true };
	}
	const last = next[next.length - 1];
	return { tabs: next, activeTabId: last.id, loadSessionId: last.sessionId, startNew: !last.sessionId };
}

export function applyNavigateTo(state: IKnoxGuiState, path: string, toggle?: boolean): IKnoxGuiState {
	const overlay = lumpOverlaySectionForPath(path);
	if (overlay) {
		const nextOverlay = toggle && state.overlay === overlay ? null : overlay;
		return { ...state, route: KnoxGuiRoute.Chat, overlay: nextOverlay };
	}
	if (toggle && knoxGuiRouteFromPath(path) === state.route && path !== '/') {
		return { ...state, route: KnoxGuiRoute.Chat, overlay: null };
	}
	const route = knoxGuiRouteFromPath(path);
	const providerName = path.startsWith('/addModel/provider/')
		? path.slice('/addModel/provider/'.length)
		: undefined;
	return { ...state, route, overlay: null, providerName };
}
