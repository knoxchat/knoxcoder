/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildCheckpointFileTree, CHECKPOINT_ANALYSIS_GROUP_LIMIT, CHECKPOINT_DASHBOARD_HISTORY_DAYS, checkpointAncestorIds, checkpointConfigHasChanges, checkpointConfigHasErrors, checkpointGraphForceMountKey, CHECKPOINT_GRAPH_ROW_HEIGHT, CHECKPOINT_GRAPH_WORKING_TREE_ID, CHECKPOINT_PANEL_TABS, CHECKPOINT_TAB_ICON, checkpointGraphMatches, checkpointGraphRowTop, checkpointGraphWindow, checkpointImpactChipClass, checkpointLaneNeighbor, checkpointRiskChipClass, checkpointScopeChipClass, checkpointShellAction, checkpointShellMessageKey, checkpointShellViewState, compactAxisNumber, computeLineDiff, defaultCheckpointGraphUi, drawCheckpointGraph, fillDailyCounts, filterCheckpoints, formatCheckpointGraphTime, formatRestoreNotice, groupCheckpointsByDate, groupDiffHunks, hunkWordAltRanges, layoutCheckpointLanes, normalizeCheckpointConfig, parseCheckpointAnalysis, parseCheckpointGraphUi, parseCheckpointRestored, parsePerformanceDashboard, parseRestorePreview, parseStorageBytes, parseSuggestedCheckpointGroups, restorePreviewActionKey, selectCheckpointIdRange, validateCheckpointConfig, withWorkingTreeNode, wordAltRanges } from './knoxGuiCheckpoints.js';
import { knoxGuiAcceptRejectLabelKeys, knoxGuiAcceptRejectShortcut, knoxGuiAcceptRejectWidthKeys, knoxGuiAnchorPopoverBox, knoxGuiCanCancel, knoxGuiComposerShowsJobsButton, knoxGuiEditSendKey, knoxGuiEmptyTranscriptShowsPlaceholder, knoxGuiLumpLabelVisible, knoxGuiMetaKeyLabel, knoxGuiNextMainTextEntry, knoxGuiParseMainTextEntryCount, knoxGuiPermissionModeIsTopTab, knoxGuiRelativeFontSize, knoxGuiRunningJobCount, knoxGuiShowsAgentMeter, knoxGuiShowsBatchDiffEntry, knoxGuiShowsChatPermissionBar, knoxGuiShowsChatScrollbar, knoxGuiShowsChatToolButtons, knoxGuiShowsComposerAcceptReject, knoxGuiShowsEditResponseAcceptReject, knoxGuiShowsFatalBanner, knoxGuiShowsLumpOverlay, knoxGuiShowsMainComposer, knoxGuiShowsScrollButtons, knoxGuiShowsSessionTabs, knoxGuiToolbarShowsAlwaysOnLabels, KNOX_GUI_CHAT_SCROLLBAR_MIN_HEIGHT, KNOX_GUI_COMPOSER_SLOTS, KNOX_GUI_FIND_DEBOUNCE_MS, KNOX_GUI_FIND_RESIZE_DEBOUNCE_MS, KNOX_GUI_LUMP_TOOLBAR, KNOX_GUI_MAIN_TEXT_ENTRY_DIALOG_AT, KNOX_GUI_MODE_TABS, KNOX_GUI_SM_MIN_PX, KNOX_GUI_XS_MAX_PX } from './knoxGuiChrome.js';
import { applyCloseTab, applyNavigateTo, applySessionTabChange, createInitialKnoxGuiState, DEFAULT_PERMISSION_MODE, IKnoxGuiHistoryItem, IKnoxGuiState, IKnoxGuiToolCall, KNOX_GUI_DEFAULT_SESSION_MODE, nextPermissionMode } from './knoxGuiState.js';
import { AUTO_DISPLAY_START, capDisplayText, GUI_DISPLAY_MAX_CHARS, GUI_SESSION_HYDRATE_BUDGET_BYTES, shouldWarnLargeSession, CHAT_DISPLAY_WINDOW, CHAT_LOAD_EARLIER_THRESHOLD_PX, compileSearchPattern, computeDisplayStart, createStreamUpdateCoalescer, expandPromptSlashCommand, extractCodeFences, findCurrentToolCall, findMatchingHistoryIndexes, groupHistoryTurns, incrementalParseJson, isKnoxGuiFilterOnlyChange, isKnoxGuiInputOnlyChange, isKnoxGuiStreamingTokenChange, knoxGuiToolProgressOnlyChange, knoxGuiFindRegexInvalid, nextExpandedStart, parseLeadingSlash, parseToolArgs, resolveDisplayStart, shouldFloatLastUser, snapStartToTurn, STREAM_COALESCE_MS, toolDisplayKind, visibleTurnIndexes } from './knoxGuiChat.js';
import { activityAnchorId, activityKindLabelKey, activitySummaryLine, applyUiAfterAppliedTimeout, applyUiForState, APPLIED_PILL_MS, buildAgentActivitySteps, collectDuplicateAssistantMessageIds, collectTurnPromptLogs, countTurnToolSteps, estimateTokensFromPromptLogs, estimateTurnOutputTokens, extractSoulCheckpointId, fenceApplyStreamId, fenceHasFileToolbar, formatDurationMs, formatLoadingElapsed, formatTokenCount, formatTokenRate, hasForegroundCallingToolCalls, historyUserInputDoc, isResponseTruncated, isTerminalCodeBlock, isTurnGeneratingTokens, knoxGuiShowsCodeToEditOnEmptyComposer, knoxGuiShowsCodeToEditOnHistoryUser, loadingVariantFor, looksLikeFilePath, parseCodeFenceRange, parseStreamError, pendingApplyStates, resetTpsClock, resolveAgentMaxSteps, resubmitHistory, shouldShineSentFrame, shouldShowThinkingIndicator, splitDisplayPath, splitMarkdownBlocks, summarizeJevPromptLogs, tickTokensPerSecond, TOKEN_TPS_MIN_GENERATION_MS, tokensPerSecond, toolStepDetail, turnElapsedMs, turnHasVisibleProgress } from './knoxGuiTranscript.js';
import { calculateFence, capTreeTerminalLines, TREE_TERMINAL_SCROLLBACK, treeTerminalRows, catalogToolForCall, collapseFileToolCodePreview, createLatestValueCoalescer, displayArgsForToolCall, displayBuildCommand, displayLanguageForFile, exactSearchDisplayQuery, exactSearchQueryBadge, extractLogPathFromTerminalOutput, extractStreamingToolCode, extractTerminalOutput, finishedToolSummary, finishedToolSummaryText, formatAskUserDisplayAnswer, formatToolName, highlightSearchQueryInHtml, isAskUserAnswered, isSamePermissionTool, mergeStreamedToolCalls, mergeToolArguments, parseAskUserQuestionsForGui, parseSearchResults, detectSearchLanguage, repoMapFileAnsiColor, repoMapToTreeColorized, resolveGuiToolName, sanitizeExactSearchQuery, shouldRenderToolBody, splitChoiceText, stripAnsi, takeTerminalTail, terminalBodyHeight, terminalCommandForTool, toolAlwaysShowsBody, toolPermissionDisplay, toolStatusFallbackKey, toolStatusIcon, toolStatusIntroKey, treeStatsFromPlain } from './knoxGuiTools.js';
import { appendMentionChip, applySuggestToDoc, appendTriggerToDoc, buildTopLevelMentionItems, composerInputHistoryAdd, composerInputHistoryNext, composerInputHistoryPrev, composerPlaceholderKey, createComposerInputHistory, DEFAULT_MENTION_PROVIDERS, DEFAULT_MENTION_PROVIDER_TITLES, detectComposerTrigger, EDIT_DISALLOWED_CONTEXT_PROVIDERS, emptyInputDoc, extractMentionsFromDoc, extractSlashFromDoc, filterProvidersForMode, groupMentionItems, groupSlashItems, highlightMentionMatch, inputDocFromPlainText, inputDocIsEmpty, inputDocToPlainText, insertCodeBlock, insertTextAtCaret, isDroppedImageFile, isSingleRangeEdit, knoxGuiCodeToEditTitle, knoxGuiComposerKeyAction, knoxGuiPendingToolBlocksSubmit, knoxGuiShouldBlockSubmit, MAX_COMPOSER_INPUT_HISTORY, mentionChipLabel, mentionIndexIsTruncated, mentionListKeyAction, mergeContextProvidersWithDefaults, mergeSlashCommandsWithBuiltins, parseUriList, rankSlashCommands, removeCodeBlockAt, resolveComposerSlashCommand, SLASH_BUILTINS, slashCommandTitle, submitUsesActiveFile, truncatedMentionMarker, useActiveFileFromDefaultContext } from './knoxGuiInput.js';
import { applyKnoxGuiAutonomousEvent, applyLivePlanProgress, autonomousBannerKey, collectLatestTaskPlanSnapshot, collectLiveTaskPlan, collectRunningTaskJobs, compactionMethodKey, countFailedJobs, countRunningJobs, extractPathHints, finalizeGitDiffFiles, formatPlanText, gitDiffTotals, gitFileType, gitFilesFromDiffs, isCompactionBannerVisible, isInjectedMemoryTimeout, isTaskJobId, isVisibleTaskPlanPeekItem, mergeBackgroundJobs, mergeGitChangedWithDiffs, parseCompactionPayload, parseDiffStats, parsePlanText, shouldShowAutonomousBanner, splitSelectiveMemories, stepIntent, taskPlanFillPercent, truncateJobTitle, visibleBackgroundJobs, visibleToolOutputPeekItems } from './knoxGuiPanels.js';
import { DEFAULT_REASONING_EFFORT, DEFAULT_REASONING_EFFORT_ALLOWED, knoxGuiFindCatalogModel, knoxGuiGetReasoningModelKeys, knoxGuiModelSelectTitle, knoxGuiModelSupportsImages, knoxGuiModelSupportsTools, knoxGuiModelSupportsToolsFromSupportedParameters, knoxGuiModelToolsSupportKnown, knoxGuiModelSupportsWebSearch, knoxGuiNextModelTitle, knoxGuiParseModelCatalog, knoxGuiReasoningEffortConfig, knoxGuiResetModelCatalogForTests, knoxGuiResolveReasoningEffort, knoxGuiResolveToolsSupported, knoxGuiSeedModelCatalog } from './knoxGuiCapabilities.js';
import { ADD_MODEL_PROVIDERS, addModelBrowseGroups, addModelPackagesByProvider, addModelProviderById, addModelRequiredSatisfied, agentProfileSharedConfig, appendNewPromptFileMentionAction, applyHistoryRowSelection, batchDiffTotals, buildAddModelPayload, categorizeKnoxChatModel, DEFAULT_AGENT_TOOL_POLICY_TEXT, duplicateToolNames, emptyPromptDraft, exploreBlocksButton, filterHistorySessions, filterKnoxChatModels, formatPolicyLines, formatPromptCommandName, formatSessionExportMarkdown, groupHistoryByDate, groupKnoxChatModels, historyDateSection, historySessionMatchesQuery, isNewPromptFileMentionAction, isPromptFileMentionSubmenu, knoxGuiOAuthErrorI18nKey, knoxGuiOAuthHandle, knoxGuiOAuthPane, knoxGuiProviderLogoUri, mergeDimensionOptions, mergeReasoningEffortPrefs, mergeRuleCards, MODEL_OVERLAY_ROLES, modelUsesChatFallback, NEW_PROMPT_FILE_ACTION_ID, parseKnoxOAuthStatus, parseYamlRules, pendingGeneratedToolName, policyEditorText, PROMPT_FILE_SUBMENU_TITLE, promptDraftFromCommand, promptDraftIsEditing, promptDraftIsValid, promptSlashName, reasoningEffortLabelKey, ruleCardOpensProfile, ruleCardTitleKey, selectHistoryIdRange, sessionExportFilename, setPathValue, sortConfigErrors, sortPromptsBookmarkedFirst, splitFilePath, toggleHistorySelection, toolPermissionBadgeKey, workspaceBasename } from './knoxGuiOverlays.js';
import { filterAndSortMemories, formatBytes, formatMemoryTimeAgo, groupMemoriesByDate, healthStatusColor, hitTestMemoryGraph, isMemoryTabId, layoutMemoryGraph, MEMORY_PANEL_TAB_BRAIN_MESSAGES, MEMORY_RETRIEVAL_THRESHOLD, MEMORY_RETRIEVAL_TOP_K, MEMORY_SETTING_GROUPS, MEMORY_TAB_ICONS, MEMORY_TAB_IDS, MEMORY_TIER_COLORS, memoryConfigUpdatePayload, memoryExploreEdgeDepth, memorySnippet, parseEffectiveContext, parseExploreResult, parseMemoryDashboard, parseMetricsTrend, sortMemoryExploreEdges, unwrapBrainConfig, memoriesToExportJson } from './knoxGuiMemory.js';
import { KNOX_GUI_HEARTBEAT_MS, KNOX_GUI_HOST_INBOUND, KNOX_GUI_HOST_INBOUND_EMPTY_ACK, KNOX_GUI_HOST_OUTBOUND, KNOX_GUI_HOST_OUTBOUND_UNUSED_IN_CHROME, KNOX_GUI_OVERLAYS, KNOX_GUI_PATH_BY_ROUTE, KnoxGuiRoute, knoxGuiRouteFromPath, lumpOverlaySectionForPath } from './knoxGuiProtocol.js';
import { isSingleRangeEditOrInsertion, knoxGuiMultifileEditPrompt, knoxGuiNextEditStatus, knoxGuiResetEditModeState, mergeCodeToEdit, parseCodeToEdit, shouldSendEditPrompt } from './knoxGuiEdit.js';
import { KNOX_AGENT_MODE_CONTEXT_KEY, knoxGuiHostAgentActiveFromPayload, knoxGuiModeAfterEditExit, knoxGuiModeAfterHostAgentFlag, knoxGuiSessionModeIsAgent } from './knoxGuiAgentMode.js';
import { applyKnoxGuiSetColors, applyKnoxGuiSetTheme, constructHljsTheme, cssVarsFromColorMap, knoxGuiHljsTokenColor, knoxGuiThemeIsLight, parseSetColorsPayload, parseSetThemePayload, vscodeCssVarFromColorId } from './knoxGuiTheme.js';

suite('Knox native GUI parity', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('lump overlays match native GUI overlaySections', () => {
		assert.strictEqual(lumpOverlaySectionForPath('/history'), 'history');
		assert.strictEqual(lumpOverlaySectionForPath('/config'), undefined);
		assert.strictEqual(lumpOverlaySectionForPath('/stats'), undefined);
		assert.deepStrictEqual([...KNOX_GUI_OVERLAYS], ['models', 'rules', 'prompts', 'context', 'tools', 'history', 'settings']);
	});

	test('Pass 1 chrome matches native GUI BlockSettingsTopToolbar and ModeSelect', () => {
		assert.deepStrictEqual(KNOX_GUI_LUMP_TOOLBAR.map(entry => entry.id), ['models', 'rules', 'prompts', 'tools', 'history', 'settings']);
		assert.ok(!(KNOX_GUI_LUMP_TOOLBAR as ReadonlyArray<{ id: string }>).some(entry => entry.id === 'context'));
		assert.deepStrictEqual(KNOX_GUI_LUMP_TOOLBAR.map(entry => entry.svg), ['cpu', 'square-pen', 'scroll-text', 'wrench', 'history', 'settings']);
		assert.deepStrictEqual([...KNOX_GUI_MODE_TABS], ['chat', 'agent']);
		assert.strictEqual(KNOX_GUI_DEFAULT_SESSION_MODE, 'agent');
		assert.strictEqual(createInitialKnoxGuiState().mode, 'agent');
		assert.strictEqual(knoxGuiLumpLabelVisible('models', 'models'), true);
		assert.strictEqual(knoxGuiLumpLabelVisible(null, 'models'), false);
		assert.strictEqual(knoxGuiToolbarShowsAlwaysOnLabels(), false);
		assert.strictEqual(knoxGuiEmptyTranscriptShowsPlaceholder(), false);
		assert.strictEqual(knoxGuiComposerShowsJobsButton(), false);
		assert.strictEqual(knoxGuiPermissionModeIsTopTab(), false);
		assert.strictEqual(knoxGuiRunningJobCount([{ id: '1', title: 'a', status: 'running' }, { id: '2', title: 'b', status: 'exited' }]), 1);
		const streaming = { ...createInitialKnoxGuiState(), isStreaming: true };
		assert.strictEqual(knoxGuiCanCancel(streaming), true);
		assert.strictEqual(knoxGuiCanCancel(streaming, false), false);
		assert.strictEqual(knoxGuiCanCancel(createInitialKnoxGuiState()), false);
		assert.strictEqual(knoxGuiShowsMainComposer({ route: KnoxGuiRoute.Chat, mode: 'edit', history: [] }), true);
		assert.strictEqual(knoxGuiShowsMainComposer({ route: KnoxGuiRoute.Chat, mode: 'edit', history: [{}] }), false);
		assert.strictEqual(knoxGuiShowsMainComposer({ route: KnoxGuiRoute.Chat, mode: 'chat', history: [{}] }), true);
	});

	test('KN-350 AgentModeManager switch maps onto GUI session.mode', () => {
		assert.strictEqual(KNOX_AGENT_MODE_CONTEXT_KEY, 'knoxAgentModeActive');
		assert.strictEqual(knoxGuiSessionModeIsAgent('agent'), true);
		assert.strictEqual(knoxGuiSessionModeIsAgent('chat'), false);
		assert.strictEqual(knoxGuiSessionModeIsAgent('edit'), false);
		assert.strictEqual(knoxGuiModeAfterHostAgentFlag('chat', true), 'agent');
		assert.strictEqual(knoxGuiModeAfterHostAgentFlag('agent', true), undefined);
		assert.strictEqual(knoxGuiModeAfterHostAgentFlag('agent', false), 'chat');
		assert.strictEqual(knoxGuiModeAfterHostAgentFlag('edit', false), undefined);
		assert.strictEqual(knoxGuiModeAfterHostAgentFlag('edit', true), 'agent');
		assert.strictEqual(knoxGuiModeAfterEditExit(), 'agent');
		assert.strictEqual(knoxGuiModeAfterEditExit('chat'), 'chat');
		assert.strictEqual(knoxGuiModeAfterEditExit('agent', 'chat'), 'chat');
		assert.strictEqual(knoxGuiModeAfterEditExit('chat', 'edit'), 'chat');
		assert.strictEqual(knoxGuiHostAgentActiveFromPayload({ active: true }), true);
		assert.strictEqual(knoxGuiHostAgentActiveFromPayload({ active: false }), false);
		assert.strictEqual(knoxGuiHostAgentActiveFromPayload({ done: true, status: 'success', content: { active: true } }), undefined);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('setAgentMode'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('agentModeChanged'));
		assert.ok(!(KNOX_GUI_HOST_INBOUND as readonly string[]).includes('setAgentMode'));
	});

	test('GP-043 composer stack and GP-024/029/035 helpers match native GUI Chat + KnoxInputBox', () => {
		assert.deepStrictEqual([...KNOX_GUI_COMPOSER_SLOTS], [
			'pendingToolBar', 'lump', 'overlay', 'agentMeter', 'panels', 'editor', 'contextPeek', 'acceptRejectAll',
		]);
		assert.strictEqual(knoxGuiShowsLumpOverlay({ overlay: 'models', isStreaming: false, history: [] }), true);
		assert.strictEqual(knoxGuiShowsLumpOverlay({ overlay: 'models', isStreaming: true, history: [] }), false);
		assert.strictEqual(knoxGuiShowsLumpOverlay({
			overlay: 'tools',
			isStreaming: true,
			history: [{ id: 'a', role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'builtin_edit_file', arguments: '{}', status: 'generated' }] }],
		}), true);
		assert.strictEqual(knoxGuiShowsAgentMeter('agent'), true);
		assert.strictEqual(knoxGuiShowsAgentMeter('edit'), false);
		assert.strictEqual(knoxGuiShowsAgentMeter('chat'), false);
		const generated = { id: 't', name: 'builtin_edit_file', arguments: '{}', status: 'generated' as const };
		assert.strictEqual(findCurrentToolCall([{ toolCalls: [generated] }])?.id, 't');
		assert.strictEqual(knoxGuiShowsChatPermissionBar(generated, { toolSettings: { builtin_edit_file: 'allowedWithPermission' }, sessionAllowlist: [] }), true);
		assert.strictEqual(knoxGuiShowsChatPermissionBar(generated, { toolSettings: {}, sessionAllowlist: [] }), false);
		assert.strictEqual(knoxGuiShowsChatPermissionBar({ ...generated, name: 'builtin_ask_user' }, { toolSettings: { builtin_ask_user: 'allowedWithPermission' }, sessionAllowlist: [] }), false);
		assert.strictEqual(knoxGuiShowsChatToolButtons({ ...generated, status: 'generating' }), true);
		assert.strictEqual(knoxGuiShowsChatToolButtons({ ...generated, status: 'calling' }), true);
		assert.strictEqual(knoxGuiShowsChatToolButtons({ ...generated, name: 'builtin_ask_user', status: 'calling' }), false);
		assert.strictEqual(knoxGuiShowsComposerAcceptReject(true, true), true);
		assert.strictEqual(knoxGuiShowsComposerAcceptReject(true, false), false);
		assert.strictEqual(knoxGuiShowsBatchDiffEntry(true, false), true);
		assert.strictEqual(knoxGuiShowsBatchDiffEntry(true, true), false);
		assert.strictEqual(knoxGuiShowsBatchDiffEntry(false, false), false);
		assert.strictEqual(knoxGuiShowsEditResponseAcceptReject('edit', false, true), true);
		assert.strictEqual(knoxGuiShowsEditResponseAcceptReject('chat', false, true), false);
		assert.strictEqual(isSingleRangeEdit({ mode: 'edit', codeToEdit: [{ range: { start: { line: 0 }, end: { line: 1 } } }] }), true);
		assert.strictEqual(isSingleRangeEdit({ mode: 'edit', codeToEdit: [{}] }), false);
		assert.strictEqual(isSingleRangeEdit({ mode: 'chat', codeToEdit: [{ range: { start: { line: 0 }, end: { line: 1 } } }] }), false);
		assert.deepStrictEqual(knoxGuiAcceptRejectLabelKeys(true), { reject: 'reject', accept: 'accept' });
		assert.deepStrictEqual(knoxGuiAcceptRejectLabelKeys(false), { reject: 'rejectAllChanges', accept: 'acceptAllChanges' });
		assert.deepStrictEqual(knoxGuiAcceptRejectWidthKeys(), {
			short: { reject: 'reject', accept: 'accept' },
			mid: { reject: 'rejectAll', accept: 'acceptAll' },
			long: { reject: 'rejectAllChanges', accept: 'acceptAllChanges' },
		});
		assert.strictEqual(KNOX_GUI_XS_MAX_PX, 249);
		assert.strictEqual(KNOX_GUI_SM_MIN_PX, 330);
		assert.ok(knoxGuiAcceptRejectShortcut(true, 'accept').includes('⌘'));
		assert.ok(knoxGuiAcceptRejectShortcut(false, 'reject').includes('Ctrl'));
		assert.strictEqual(knoxGuiMetaKeyLabel(true), '⌘');
		const planItem = { name: 'Plan', description: 'created', content: 'Task Execution Plan\n- [ ] do it' };
		assert.strictEqual(isVisibleTaskPlanPeekItem(planItem), false);
		assert.strictEqual(isVisibleTaskPlanPeekItem({ name: 'src/a.ts', content: 'ok', description: 'file' }), true);
		assert.strictEqual(visibleToolOutputPeekItems([planItem, { name: 'log', content: 'done' }]).length, 1);
		const liveFence = splitMarkdownBlocks('```ts app.ts\nconst x = 1;');
		assert.strictEqual(liveFence[0].type, 'fence');
		if (liveFence[0].type === 'fence') {
			assert.strictEqual(liveFence[0].closed, false);
			assert.strictEqual(liveFence[0].filepath, 'app.ts');
		}
		assert.strictEqual(STREAM_COALESCE_MS, 50);
	});

	test('routes cover App.tsx paths', () => {
		assert.strictEqual(knoxGuiRouteFromPath('/'), KnoxGuiRoute.Chat);
		assert.strictEqual(knoxGuiRouteFromPath('/history'), KnoxGuiRoute.History);
		assert.strictEqual(knoxGuiRouteFromPath('/stats'), KnoxGuiRoute.Stats);
		assert.strictEqual(knoxGuiRouteFromPath('/config'), KnoxGuiRoute.Config);
		assert.strictEqual(knoxGuiRouteFromPath('/config-error'), KnoxGuiRoute.ConfigError);
		assert.strictEqual(knoxGuiRouteFromPath('/addModel'), KnoxGuiRoute.AddModel);
		assert.strictEqual(knoxGuiRouteFromPath('/addModel/provider/knoxchat'), KnoxGuiRoute.AddModelProvider);
		assert.strictEqual(knoxGuiRouteFromPath('/batch-diff'), KnoxGuiRoute.BatchDiff);
		assert.strictEqual(knoxGuiRouteFromPath('/memory'), KnoxGuiRoute.Memory);
		assert.strictEqual(knoxGuiRouteFromPath('/checkpoint-graph'), KnoxGuiRoute.CheckpointGraph);
		assert.strictEqual(KNOX_GUI_PATH_BY_ROUTE[KnoxGuiRoute.Chat], '/');
	});

	test('navigateTo history opens the overlay; S-08 config opens the page and toggles back', () => {
		const history = applyNavigateTo(createInitialKnoxGuiState(), '/history');
		assert.strictEqual(history.route, KnoxGuiRoute.Chat);
		assert.strictEqual(history.overlay, 'history');
		const toggled = applyNavigateTo(history, '/history', true);
		assert.strictEqual(toggled.overlay, null);
		const config = applyNavigateTo(createInitialKnoxGuiState(), '/config', true);
		assert.strictEqual(config.route, KnoxGuiRoute.Config);
		assert.strictEqual(config.overlay, null);
		assert.strictEqual(applyNavigateTo(config, '/config', true).route, KnoxGuiRoute.Chat);
		const stats = applyNavigateTo(createInitialKnoxGuiState(), '/stats');
		assert.strictEqual(stats.route, KnoxGuiRoute.Stats);
		assert.strictEqual(stats.overlay, null);
		const batch = applyNavigateTo(createInitialKnoxGuiState(), '/batch-diff');
		assert.strictEqual(batch.route, KnoxGuiRoute.BatchDiff);
		assert.strictEqual(batch.overlay, null);
	});

	test('permission mode default is YOLO fullAuto', () => {
		assert.strictEqual(DEFAULT_PERMISSION_MODE, 'fullAuto');
		assert.strictEqual(nextPermissionMode('fullAuto'), 'default');
		assert.strictEqual(nextPermissionMode('default'), 'acceptEdits');
	});

	test('host inbound/outbound catalogs cover chat protocol', () => {
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('newSession'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('navigateTo'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('llm/streamChat'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('tools/call'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('isKnoxInputFocused'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('agent/worktree'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/updateSelectedModel'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('edit/sendPrompt'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('tools/partialOutput'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('gitStateChanged'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('compaction/applied'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('agent/jobUpdate'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('checkpointRestored'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('knox/heartbeat'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getGitChangedFiles'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getDiff'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('agent/jobs'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('memory/buildContext'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/pinMemory'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/getConfig'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('setTheme'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('setColors'));
	});

	test('KN-370 setTheme / setColors map TextMate rules and CSS vars', () => {
		assert.strictEqual(vscodeCssVarFromColorId('editor.background'), '--vscode-editor-background');
		assert.strictEqual(vscodeCssVarFromColorId('--vscode-foreground'), '--vscode-foreground');
		assert.deepStrictEqual(cssVarsFromColorMap({ 'editor.foreground': 'CCCCCC' }), { '--vscode-editor-foreground': '#CCCCCC' });
		const theme = parseSetThemePayload({
			theme: {
				base: 'vs-dark',
				rules: [{ token: 'comment', foreground: '6A9955' }, { token: 'string', foreground: '#ce9178' }],
				colors: { 'editor.background': '#1e1e1e' },
			},
		});
		assert.strictEqual(theme?.base, 'vs-dark');
		assert.strictEqual(knoxGuiThemeIsLight(theme), false);
		assert.strictEqual(constructHljsTheme(theme, false)['.hljs-comment'], '#6A9955');
		assert.strictEqual(constructHljsTheme(theme, false)['.hljs-string'], '#ce9178');
		assert.strictEqual(knoxGuiThemeIsLight({ base: 'vs' }), true);
		assert.strictEqual(constructHljsTheme(undefined, true)['.hljs-keyword'], '#0000ff');
		const colors = parseSetColorsPayload({ '--vscode-button-background': '#159994', 'editor.foreground': '#fff' });
		assert.deepStrictEqual(colors?.['--vscode-button-background'], '#159994');
		const initial = createInitialKnoxGuiState();
		const themed = applyKnoxGuiSetTheme(initial, { theme });
		assert.strictEqual(themed?.vscTheme?.base, 'vs-dark');
		assert.strictEqual(themed?.vscColors?.['--vscode-editor-background'], '#1e1e1e');
		assert.strictEqual(themed?.vscTokenColors?.['.hljs-comment'], '#6A9955');
		const withColors = applyKnoxGuiSetColors({ ...initial, ...themed }, { '--vscode-focusBorder': '#007acc' });
		assert.strictEqual(withColors?.vscColors?.['--vscode-focusBorder'], '#007acc');
		assert.strictEqual(withColors?.vscColors?.['--vscode-editor-background'], '#1e1e1e');
		assert.strictEqual(applyKnoxGuiSetTheme(initial, { nope: true }), undefined);
		assert.strictEqual(applyKnoxGuiSetColors(initial, { done: true, status: 'success' }), undefined);
	});

	test('slash prompt expansion matches native GUI', () => {
		assert.deepStrictEqual(parseLeadingSlash('/autonomous ship it'), { name: 'autonomous', rest: 'ship it' });
		assert.strictEqual(expandPromptSlashCommand('Hello {{{ input }}}', 'world'), 'Hello world');
		assert.strictEqual(expandPromptSlashCommand('Use this', 'extra'), 'Use this\n\nextra');
	});

	test('find widget search covers history text and tools', () => {
		const history = [
			{ id: '1', role: 'user' as const, content: 'hello world' },
			{ id: '2', role: 'assistant' as const, content: 'later', thinking: 'ponder the widget', toolCalls: [{ id: 't', name: 'builtin_exact_search', arguments: '{"query":"rare-token-xyz"}', status: 'done' as const }] },
		];
		assert.deepStrictEqual(findMatchingHistoryIndexes(history, 'widget', { caseSensitive: false, regex: false }), [1]);
		assert.deepStrictEqual(findMatchingHistoryIndexes(history, 'rare-token-xyz', { caseSensitive: false, regex: false }), [1]);
		assert.deepStrictEqual(findMatchingHistoryIndexes([
			{ id: '3', role: 'user' as const, content: 'ask', contextItems: [{ name: 'auth.ts', content: 'httpOnly cookie' }] },
		], 'httpOnly', { caseSensitive: false, regex: false }), [0]);
		assert.strictEqual(compileSearchPattern('(', { caseSensitive: false, regex: true }).kind, 'invalid');
	});

	test('Pass 5 tool chrome, specialized kinds, and display helpers', () => {
		const fences = extractCodeFences('```ts app.ts\nconst x = 1;\n```');
		assert.strictEqual(fences[0].language, 'ts');
		assert.strictEqual(fences[0].filepath, 'app.ts');
		assert.strictEqual(toolDisplayKind('builtin_ask_user'), 'ask-user');
		assert.strictEqual(toolDisplayKind('builtin_run_terminal_command'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_create_new_file'), 'create-file');
		assert.strictEqual(toolDisplayKind('builtin_view_repo_map'), 'repo-map');
		assert.strictEqual(shouldRenderToolBody('calling', true), true);
		assert.strictEqual(shouldRenderToolBody('done', true), false);
		assert.strictEqual(toolAlwaysShowsBody('builtin_ask_user'), true);
		assert.strictEqual(formatToolName('builtin_read_file'), 'Read File');
		assert.strictEqual(collapseFileToolCodePreview('builtin_read_file'), true);
		assert.strictEqual(collapseFileToolCodePreview('builtin_write_file'), false);
		assert.strictEqual(displayBuildCommand({ action: 'check', extraArgs: '--release' }), 'cargo check --release');
		assert.strictEqual(displayBuildCommand({ explain: 'error[E0502]' }), 'rustc --explain E0502');
		assert.strictEqual(displayBuildCommand(undefined), 'project build');
		assert.strictEqual(extractTerminalOutput([{ name: 'Terminal', content: 'hi' }]), 'hi');
		assert.strictEqual(extractTerminalOutput([
			{ name: 'Build', content: 'Compiling foo' },
			{ name: 'Build diagnostics', content: 'no errors' },
		]), 'Compiling foo');
		assert.deepStrictEqual(extractStreamingToolCode({
			parsedArgs: { filepath: 'src/main.rs', contents: 'fn main() {}' },
		}), { filepath: 'src/main.rs', codeContent: 'fn main() {}', contentKey: 'contents', started: true });
		assert.strictEqual(extractStreamingToolCode({
			rawArguments: '{"filepath": "game.rs", "contents": "fn handle() {\\n    match event";',
		}).filepath, 'game.rs');
		assert.strictEqual(calculateFence('```rust\nfn x() {}\n```'), '````');
		assert.strictEqual(mergeToolArguments('{"a":', ' 1}'), '{"a": 1}');
		assert.strictEqual(mergeToolArguments('{"a": 1}', '{"a": 1, "b": 2}'), '{"a": 1, "b": 2}');
		assert.strictEqual(mergeToolArguments('{"directory_path": ', '"."}'), '{"directory_path": "."}');
		assert.strictEqual(mergeToolArguments('{"filepath":"a.ts","contents":', '"fn main() {}"}'), '{"filepath":"a.ts","contents":"fn main() {}"}');
		assert.strictEqual(toolPermissionDisplay({
			toolName: 'builtin_run_terminal_command',
			toolSettings: { builtin_run_terminal_command: 'allowedWithPermission' },
			sessionAllowlist: ['builtin_run_terminal_command'],
		}), 'sessionAlways');
		assert.strictEqual(isSamePermissionTool('edit', 'builtin_edit_file'), true);
		assert.strictEqual(isSamePermissionTool('builtin_edit_file', 'write'), false);
		assert.strictEqual(toolPermissionDisplay({
			toolName: 'builtin_edit_file',
			toolSettings: { builtin_edit_file: 'allowedWithPermission' },
			sessionAllowlist: ['edit'],
		}), 'sessionAlways');
		const search = parseSearchResults('src/a.ts\n10:const hit = 1;\n11-const skip = 2;');
		assert.strictEqual(search[0].filePath, 'src/a.ts');
		assert.strictEqual(search[0].lines[0].isMatch, true);
		assert.deepStrictEqual(splitChoiceText('Terminal game — runs in your terminal'), {
			value: 'Terminal game — runs in your terminal',
			label: 'Terminal game',
			description: 'runs in your terminal',
		});
		assert.strictEqual(terminalCommandForTool('builtin_await_shell', { job_id: 'sh_1' }, key => key === 'jobsAwaitCommand' ? 'await sh_1' : key), 'await sh_1');
		assert.strictEqual(terminalCommandForTool('builtin_build', { action: 'test' }, key => key), 'cargo test');
		const summary = finishedToolSummary({
			id: 't1',
			name: 'builtin_read_file',
			arguments: '{"filepath":"src/a.ts"}',
			status: 'done',
			parsedArgs: { filepath: 'src/a.ts' },
			outputItems: [{ name: 'src/a.ts', description: 'file', content: 'line\n'.repeat(40) }],
		});
		assert.ok(summary.name.includes('Read File'));
		assert.strictEqual(summary.detail, 'a.ts');
		assert.ok(summary.result?.includes('lines'));
		assert.strictEqual(toolDisplayKind('builtin_task'), 'subagent');
		assert.strictEqual(toolDisplayKind('builtin_view_subdirectory'), 'subdirectory');
		assert.strictEqual(toolDisplayKind('builtin_exact_search'), 'search');
		assert.strictEqual(toolDisplayKind('builtin_glob'), 'generic');
		assert.strictEqual(toolDisplayKind('builtin_search_web'), 'generic');
		assert.strictEqual(toolDisplayKind('builtin_enhanced_search'), 'generic');
		assert.strictEqual(toolStatusIntroKey('generating'), 'toolGenerating');
		assert.strictEqual(toolStatusIntroKey('generated'), 'toolWouldLikeTo');
		assert.strictEqual(toolStatusIntroKey('calling'), 'toolFor');
		assert.strictEqual(toolStatusIntroKey('done'), '');
		assert.strictEqual(toolStatusIntroKey('canceled'), 'toolCanceled');
		assert.strictEqual(toolStatusFallbackKey('calling'), 'toolUsing');
		assert.strictEqual(toolStatusFallbackKey('done'), 'toolUsed');
		assert.strictEqual(toolStatusFallbackKey('generated'), 'toolUse');
		assert.strictEqual(toolStatusIcon('generating'), 'spinner');
		assert.strictEqual(toolStatusIcon('calling'), 'spinner');
		assert.strictEqual(toolStatusIcon('generated'), 'arrow-right');
		assert.strictEqual(toolStatusIcon('done'), 'check');
		assert.strictEqual(toolStatusIcon('canceled'), 'x');
		assert.strictEqual(finishedToolSummaryText(summary), 'a.ts · 41 lines');
		assert.strictEqual(extractLogPathFromTerminalOutput('Status: exited\nFull log: /tmp/job.log\n--- output ---'), '/tmp/job.log');
		assert.strictEqual(takeTerminalTail('a\nb\nc', 2).hiddenLines, 1);
		assert.strictEqual(terminalBodyHeight('', false), 80);
		assert.strictEqual(terminalBodyHeight('a\nb\nc', true), 96);
		assert.ok(terminalBodyHeight('line\n'.repeat(40), true) <= 400);
		assert.ok(highlightSearchQueryInHtml('const <span>hit</span> = 1', 'hit').includes('knox-gui-search-match'));
		assert.strictEqual(highlightSearchQueryInHtml('<span class="x">nope</span>', 'span'), '<span class="x">nope</span>');
		assert.strictEqual(stripAnsi('\x1b[31mfoo\x1b[0m'), 'foo');
		assert.strictEqual(sanitizeExactSearchQuery('\x1b[32mquery\x1b[0m\uE000'), 'query');
		assert.strictEqual(sanitizeExactSearchQuery(['a', 'b']), 'a b');
		assert.strictEqual(exactSearchDisplayQuery({ parsedArgs: { query: 'signup-name' } }), 'signup-name');
		assert.strictEqual(exactSearchDisplayQuery({ arguments: '{"query":"from-json"}' }), 'from-json');
		assert.strictEqual(exactSearchQueryBadge('signup-name'), 'signup-name');
		assert.strictEqual(exactSearchQueryBadge(''), '...');
		// NP-28: guiDisplayCap.test.ts (CSLD-18) for the helpers the native GUI keeps.
		assert.deepStrictEqual(capDisplayText('hello'), { text: 'hello', truncated: false });
		const fat = `${'a'.repeat(10)}\n${'b'.repeat(GUI_DISPLAY_MAX_CHARS + 50)}`;
		const tail = capDisplayText(fat);
		assert.strictEqual(tail.truncated, true);
		assert.ok(tail.text.length < fat.length && tail.text.endsWith('b'.repeat(20)));
		assert.strictEqual(shouldWarnLargeSession([{ id: 'a', role: 'assistant', content: 'x'.repeat(100) }]), false);
		assert.strictEqual(shouldWarnLargeSession([{ id: 'a', role: 'assistant', content: 'x'.repeat(GUI_SESSION_HYDRATE_BUDGET_BYTES) }]), true);
		// NP-04: expanded trees keep the xterm scrollback window (5000 lines + viewport rows), tail-first, without the trailing blank line.
		assert.strictEqual(treeTerminalRows(300), 15);
		assert.strictEqual(treeTerminalRows(100), 8);
		assert.strictEqual(capTreeTerminalLines('a\nb\n', 300), 'a\nb');
		const many = Array.from({ length: TREE_TERMINAL_SCROLLBACK + 100 }, (_, i) => `line${i}`).join('\n');
		const capped = capTreeTerminalLines(many, 300).split('\n');
		assert.strictEqual(capped.length, TREE_TERMINAL_SCROLLBACK + 15);
		assert.strictEqual(capped[capped.length - 1], `line${TREE_TERMINAL_SCROLLBACK + 99}`);
		assert.strictEqual(sanitizeExactSearchQuery('\u{F0000}query\u{100000}'), 'query');
		assert.strictEqual(exactSearchDisplayQuery({
			outputItems: [{ name: 'Search Results', description: 'Exact search results for "邮箱" - No matches found', content: 'No matches found' }],
		}), '邮箱');
		assert.deepStrictEqual(parseSearchResults('\x1b[35msrc/a.ts\x1b[0m\n\x1b[32m10:hit\x1b[0m')[0]?.filePath, 'src/a.ts');
		const coalesced: string[] = [];
		const timers: Array<() => void> = [];
		const c = createLatestValueCoalescer<string, string>((key, value) => coalesced.push(`${key}:${value}`), {
			waitMs: 10,
			schedule: (fn) => {
				timers.push(fn);
				return () => undefined;
			},
		});
		c.enqueue('a', '1');
		c.enqueue('a', '2');
		assert.deepStrictEqual(coalesced, []);
		timers[0]();
		assert.deepStrictEqual(coalesced, ['a:2']);
	});

	test('streamed tool calls match original GUI merge, incremental JSON, and aliases', () => {
		assert.deepStrictEqual(incrementalParseJson('{"directory_path": "src'), [false, { directory_path: 'src' }]);
		assert.deepStrictEqual(incrementalParseJson('{'), [false, {}]);
		assert.deepStrictEqual(parseToolArgs('{"directory_path": "src'), { directory_path: 'src' });
		assert.deepStrictEqual(parseToolArgs('{'), {});
		assert.deepStrictEqual(parseToolArgs('{"filepath":"a.ts"}'), { filepath: 'a.ts' });
		assert.strictEqual(resolveGuiToolName('view_subdirectory'), 'builtin_view_subdirectory');
		assert.strictEqual(resolveGuiToolName('plan'), 'builtin_plan');
		assert.strictEqual(resolveGuiToolName(''), '');
		assert.strictEqual(catalogToolForCall(
			[{ name: 'builtin_view_subdirectory', group: 'Built-In', wouldLikeTo: 'View directory structure for "{{{ directory_path }}}"' }],
			'ls',
		)?.name, 'builtin_view_subdirectory');
		assert.strictEqual(displayArgsForToolCall({}, '{"directory_path": "src/vs').directory_path, 'src/vs');
		const calls: IKnoxGuiToolCall[] = [];
		mergeStreamedToolCalls(calls, [
			{ index: 0, function: { name: 'view_subdirectory', arguments: '' } },
			{ index: 0, function: { name: '', arguments: '{"directory_path":' } },
			{ index: 0, function: { arguments: ' "."}' } },
		], { nextId: () => 'stable-1' });
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].name, 'builtin_view_subdirectory');
		assert.strictEqual(calls[0].arguments, '{"directory_path": "."}');
		assert.deepStrictEqual(calls[0].parsedArgs, { directory_path: '.' });
		const stringDelta: IKnoxGuiToolCall[] = [];
		mergeStreamedToolCalls(stringDelta, [
			{ index: 0, function: { name: 'builtin_view_subdirectory', arguments: '{"directory_path": ' } },
			{ index: 0, function: { arguments: '"."' } },
			{ index: 0, function: { arguments: '}' } },
		], { nextId: () => 'stable-2' });
		assert.strictEqual(stringDelta[0].arguments, '{"directory_path": "."}');
		assert.deepStrictEqual(stringDelta[0].parsedArgs, { directory_path: '.' });
		mergeStreamedToolCalls(calls, [
			{ index: 1, id: 'plan-1', function: { name: 'plan', arguments: '{"action":"update"}' } },
		]);
		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[1].name, 'builtin_plan');
		assert.strictEqual(calls[1].id, 'plan-1');
	});

	test('typing in the composer is an input-only store change', () => {
		const prev = createInitialKnoxGuiState();
		const next = { ...prev, input: 'hello', mentionOpen: true };
		assert.strictEqual(isKnoxGuiInputOnlyChange(prev, next), true);
		assert.strictEqual(isKnoxGuiInputOnlyChange(prev, { ...prev, overlay: 'models' }), false);
	});

	test('typing in overlay search is a filter-only store change', () => {
		const prev = createInitialKnoxGuiState();
		assert.strictEqual(isKnoxGuiFilterOnlyChange(prev, { ...prev, historyQuery: 'demo' }), true);
		assert.strictEqual(isKnoxGuiFilterOnlyChange(prev, { ...prev, checkpointQuery: 'head' }), true);
		assert.strictEqual(isKnoxGuiFilterOnlyChange(prev, { ...prev, memoryQuery: 'auth' }), true);
		assert.strictEqual(isKnoxGuiFilterOnlyChange(prev, { ...prev, overlay: 'history', historyQuery: 'demo' }), false);
		assert.strictEqual(isKnoxGuiFilterOnlyChange(prev, prev), false);
	});

	test('Pass 2 chat shell layout helpers match native GUI Chat.tsx', () => {
		const hidden = createInitialKnoxGuiState();
		assert.strictEqual(knoxGuiShowsSessionTabs(hidden), false);
		assert.strictEqual(knoxGuiShowsSessionTabs({ showSessionTabs: true, tabs: [{ id: 'a', title: 'Chat 1' }] }), false);
		assert.strictEqual(knoxGuiShowsSessionTabs({
			showSessionTabs: true,
			tabs: [{ id: 'a', title: 'Chat 1' }, { id: 'b', title: 'Chat 2' }],
		}), true);
		assert.strictEqual(knoxGuiShowsFatalBanner({ fatalConfig: true, route: KnoxGuiRoute.Chat }), true);
		assert.strictEqual(knoxGuiShowsFatalBanner({ fatalConfig: true, route: KnoxGuiRoute.ConfigError }), false);
		assert.strictEqual(knoxGuiShowsScrollButtons(0, true), false);
		assert.strictEqual(knoxGuiShowsScrollButtons(3, true), true);
		assert.strictEqual(knoxGuiShowsScrollButtons(3, false), false);
	});

	test('session tabs assign, focus, and close like tabsSlice', () => {
		const first = applySessionTabChange([], '', 'sess-1', 'Hello', 'tab-1');
		assert.strictEqual(first.tabs.length, 1);
		assert.strictEqual(first.tabs[0].sessionId, 'sess-1');
		const titled = applySessionTabChange(first.tabs, first.activeTabId, 'sess-1', 'Hello world', 'tab-x');
		assert.strictEqual(titled.tabs[0].title, 'Hello world');
		const second = applySessionTabChange(titled.tabs, titled.activeTabId, 'sess-2', 'Chat 2', 'tab-2');
		assert.strictEqual(second.tabs.length, 2);
		assert.strictEqual(second.activeTabId, 'tab-2');
		const focused = applySessionTabChange(second.tabs, second.activeTabId, 'sess-1', 'Hello world', 'tab-3');
		assert.strictEqual(focused.activeTabId, 'tab-1');
		assert.strictEqual(focused.tabs.length, 2);
		const closed = applyCloseTab(second.tabs, second.activeTabId, 'tab-2');
		assert.strictEqual(closed.activeTabId, 'tab-1');
		assert.strictEqual(closed.loadSessionId, 'sess-1');
		const last = applyCloseTab(first.tabs, first.activeTabId, first.activeTabId);
		assert.strictEqual(last.startNew, true);
	});

	test('windowed transcript matches native GUI chatHistoryWindow', () => {
		const turns = groupHistoryTurns([
			{ role: 'assistant' }, { role: 'tool' }, { role: 'user' }, { role: 'assistant' }, { role: 'tool' }, { role: 'user' }, { role: 'assistant' },
		]);
		assert.deepStrictEqual(turns, [
			{ userIndex: -1, startIndex: 0, endIndex: 2 },
			{ userIndex: 2, startIndex: 2, endIndex: 5 },
			{ userIndex: 5, startIndex: 5, endIndex: 7 },
		]);
		assert.strictEqual(CHAT_DISPLAY_WINDOW, 25);
		assert.strictEqual(CHAT_LOAD_EARLIER_THRESHOLD_PX, 48);
		assert.strictEqual(computeDisplayStart({ historyLength: 10, expandedStart: AUTO_DISPLAY_START }), 0);
		assert.strictEqual(computeDisplayStart({ historyLength: 200, expandedStart: AUTO_DISPLAY_START }), 175);
		assert.strictEqual(computeDisplayStart({ historyLength: 200, expandedStart: 40 }), 40);
		assert.strictEqual(snapStartToTurn(4, groupHistoryTurns([
			{ role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant' }, { role: 'tool' }, { role: 'user' }, { role: 'assistant' },
		])), 2);
		assert.strictEqual(nextExpandedStart(50, 25), 25);
		assert.deepStrictEqual(visibleTurnIndexes({ userIndex: 0, startIndex: 0, endIndex: 200 }, 175, 0), [
			0,
			...Array.from({ length: 25 }, (_, i) => 175 + i),
		]);
		assert.strictEqual(resolveDisplayStart({
			historyLength: 7,
			expandedStart: AUTO_DISPLAY_START,
			turns: groupHistoryTurns([
				{ role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant' }, { role: 'tool' }, { role: 'user' }, { role: 'assistant' },
			]),
			windowSize: 3,
		}), 4);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: true, followLive: true, lastUserIndex: 2 }), true);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: true, followLive: false, lastUserIndex: 2 }), false);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: false, followLive: true, lastUserIndex: 2 }), false);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: true, followLive: true, lastUserIndex: -1 }), false);
	});

	test('outbound catalog includes chat describer for session titles', () => {
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('chatDescriber/describe'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('newSessionWithPrompt'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('setActiveChatSession'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('showFile'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('showLines'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('context/loadSubmenuItems'));
	});

	test('Pass 3 composer document stores chips instead of raw @ / text', () => {
		let doc = appendTriggerToDoc(emptyInputDoc(), '@');
		assert.deepStrictEqual(detectComposerTrigger(doc), { kind: 'mention', query: '' });
		assert.deepStrictEqual(appendTriggerToDoc(doc, '@'), doc);
		doc = applySuggestToDoc(doc, { id: 'src/app.ts', label: 'app.ts', itemType: 'file', query: 'src/app.ts' }, 'mention');
		assert.strictEqual(extractMentionsFromDoc(doc)[0].id, 'src/app.ts');
		assert.ok(!inputDocToPlainText(doc).includes('@src'));
		assert.strictEqual(mentionChipLabel({ label: 'app.ts' }), '@app.ts');
		doc = appendTriggerToDoc(emptyInputDoc(), '/');
		assert.deepStrictEqual(detectComposerTrigger(doc), { kind: 'slash', query: '' });
		doc = applySuggestToDoc(doc, { id: '/commit', label: '/commit', itemType: 'slashCommand' }, 'slash');
		assert.strictEqual(extractSlashFromDoc(doc), 'commit');
		assert.strictEqual(slashCommandTitle('commit'), '/commit');
		const withCode = insertCodeBlock(emptyInputDoc(), { type: 'codeBlock', filepath: 'a.ts', code: 'const x = 1;', itemName: 'a.ts' });
		assert.ok(inputDocToPlainText(withCode).includes('```'));
		assert.strictEqual(inputDocIsEmpty(emptyInputDoc()), true);
		assert.strictEqual(composerPlaceholderKey('chat', 0), 'askAnything');
		assert.strictEqual(composerPlaceholderKey('chat', 2), 'followUpQuestion');
		assert.strictEqual(composerPlaceholderKey('edit', 0), 'describeHowToModifyCode');
		const fences = inputDocFromPlainText('hello\n```ts a.ts\nconst x = 1;\n```');
		assert.strictEqual(fences.some(block => block.type === 'codeBlock'), true);
	});

	test('Pass 3 mentions hide edit-mode providers and group sections', () => {
		assert.ok(EDIT_DISALLOWED_CONTEXT_PROVIDERS.includes('repo-map'));
		const providers = [
			{ title: 'file', displayTitle: 'File', type: 'submenu' as const },
			{ title: 'open', displayTitle: 'Open' },
			{ title: 'diff', displayTitle: 'Diff' },
			{ title: 'problems', displayTitle: 'Problems' },
		];
		assert.deepStrictEqual(filterProvidersForMode(providers, 'edit').map(p => p.title), ['file', 'problems']);
		const items = buildTopLevelMentionItems({
			query: '',
			providers,
			files: [{ id: 'a.ts', label: 'a.ts', itemType: 'file' }],
		});
		assert.ok(items.some(item => item.itemType === 'file'));
		assert.ok(items.some(item => item.itemType === 'contextProvider' && item.id === 'file'));
		const sections = groupMentionItems(items, { query: '' });
		assert.ok(sections.some(section => section.id === 'open'));
		assert.ok(sections.some(section => section.id === 'providers'));
		assert.deepStrictEqual(highlightMentionMatch('app.ts', 'app')[0], { text: 'app', matched: true });
		assert.strictEqual(mentionListKeyAction('Enter', 0, 3).type, 'select');
		assert.strictEqual(mentionListKeyAction('ArrowDown', 0, 3).type, 'move');
	});

	test('Pass 3 slash ranking prefers bookmarks and starters use prompts', () => {
		const ranked = rankSlashCommands([
			{ id: '/share', label: '/share', description: 'Share', itemType: 'slashCommand', slashSource: 'builtin' },
			{ id: '/commit', label: '/commit', description: 'Commit', itemType: 'slashCommand', slashSource: 'prompt', bookmarked: true },
		], 'com');
		assert.strictEqual(ranked[0].id, '/commit');
		const grouped = groupSlashItems([
			{ id: '/commit', label: '/commit', itemType: 'slashCommand', bookmarked: true, slashSource: 'prompt' },
			{ id: '/share', label: '/share', itemType: 'slashCommand', slashSource: 'builtin' },
		], { query: '' });
		assert.ok(grouped.some(section => section.id === 'bookmarked'));
		assert.ok(grouped.some(section => section.id === 'commands'));
	});

	test('Pass 3 submit blocks generated tools and alt toggles active file', () => {
		assert.strictEqual(useActiveFileFromDefaultContext(['activeFile']), true);
		assert.strictEqual(submitUsesActiveFile(true, false), true);
		assert.strictEqual(submitUsesActiveFile(true, true), false);
		assert.strictEqual(submitUsesActiveFile(false, true), true);
		const blocked = knoxGuiShouldBlockSubmit({
			isStreaming: false,
			input: 'hi',
			images: [],
			mode: 'agent',
			codeToEdit: [],
			history: [{ toolCalls: [{ id: '1', name: 'builtin_run_terminal_command', arguments: '{}', status: 'generated' }] }],
		});
		assert.strictEqual(blocked, true);
		assert.strictEqual(knoxGuiShouldBlockSubmit({
			isStreaming: false,
			input: 'hi',
			images: [],
			mode: 'agent',
			codeToEdit: [],
			history: [{ toolCalls: [{ id: '1', name: 'builtin_ask_user', arguments: '{}', status: 'generated' }] }],
		}), false);
		assert.strictEqual(knoxGuiShouldBlockSubmit({
			isStreaming: false,
			input: 'edit this',
			images: [],
			mode: 'edit',
			codeToEdit: [],
			history: [],
		}), true);
		const prev = createInitialKnoxGuiState();
		assert.strictEqual(isKnoxGuiInputOnlyChange(prev, { ...prev, inputDoc: appendTriggerToDoc(emptyInputDoc(), '@'), mentionOpen: true }), true);
	});

	test('Pass 4 transcript duplicates, shine frame, and activity grouping', () => {
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'a1', role: 'assistant', content: 'hello' },
			{ id: 'a2', role: 'assistant', content: 'hello' },
			{ id: 'a3', role: 'assistant', content: 'later' },
		];
		const frozen = collectDuplicateAssistantMessageIds(history, 1);
		assert.strictEqual(frozen.has('a2'), true);
		assert.strictEqual(frozen.has('a1'), false);
		assert.strictEqual(shouldShineSentFrame(true, true, false), true);
		assert.strictEqual(shouldShineSentFrame(true, true, true), false);
		assert.strictEqual(shouldShineSentFrame(true, false, false), false);
		assert.strictEqual(turnHasVisibleProgress([
			{ id: 'u1', role: 'user', content: 'fix it' },
			{ id: 'a1', role: 'assistant', content: 'hello' },
		], 0), true);
		assert.strictEqual(turnHasVisibleProgress([{ id: 'u1', role: 'user', content: 'fix it' }], 0), false);
		assert.strictEqual(isResponseTruncated('unfinished thought', false), true);
		assert.strictEqual(isResponseTruncated('Done.', false), false);
	});

	test('Pass 4 markdown fences, apply stream ids, and stream errors', () => {
		const blocks = splitMarkdownBlocks('intro\n```ts app.ts\nconst x = 1;\n```\noutro');
		assert.strictEqual(blocks[0].type, 'markdown');
		assert.strictEqual(blocks[1].type, 'fence');
		if (blocks[1].type === 'fence') {
			assert.strictEqual(blocks[1].filepath, 'app.ts');
			assert.strictEqual(blocks[1].closed, true);
		}
		const ranged = splitMarkdownBlocks('```ts src/main.rs L10-20\nfn main() {}\n```');
		assert.strictEqual(ranged[0].type, 'fence');
		if (ranged[0].type === 'fence') {
			assert.strictEqual(ranged[0].filepath, 'src/main.rs');
			assert.strictEqual(ranged[0].range, 'L10-20');
		}
		assert.deepStrictEqual(parseCodeFenceRange('L10-20'), { startLine: 10, endLine: 20 });
		assert.deepStrictEqual(splitDisplayPath('tetris/src/main.rs'), { dir: 'tetris/src/', name: 'main.rs' });
		assert.strictEqual(fenceHasFileToolbar('app.ts'), true);
		assert.strictEqual(fenceHasFileToolbar('plain'), false);
		assert.strictEqual(looksLikeFilePath('src/app.ts'), true);
		assert.strictEqual(looksLikeFilePath('hello world'), false);
		assert.deepStrictEqual(applyUiAfterAppliedTimeout({ kind: 'applied' }, Date.now() - 1, Date.now()), { kind: 'reapply' });
		assert.strictEqual(applyUiAfterAppliedTimeout({ kind: 'applied' }, Date.now() + 1000, Date.now()).kind, 'applied');
		assert.ok(APPLIED_PILL_MS >= 5000);
		assert.strictEqual(isTerminalCodeBlock('bash', 'ls'), true);
		assert.strictEqual(isTerminalCodeBlock('ts', 'const x = 1'), false);
		assert.strictEqual(fenceApplyStreamId('msg', 2), 'msg:fence:2');
		assert.deepStrictEqual(applyUiForState({ streamId: 'a', status: 'streaming' }), { kind: 'streaming' });
		assert.deepStrictEqual(applyUiForState({ streamId: 'a', status: 'done', numDiffs: 3 }), { kind: 'done', numDiffs: 3 });
		assert.deepStrictEqual(applyUiForState({ streamId: 'a', status: 'closed', numDiffs: 0 }), { kind: 'applied' });
		assert.deepStrictEqual(applyUiForState({ streamId: 'a', status: 'closed', numDiffs: 0 }, true), { kind: 'idle' });
		assert.deepStrictEqual(applyUiForState({ streamId: 'a', status: 'closed', numDiffs: 2 }), { kind: 'idle' });
		assert.strictEqual(parseStreamError('HTTP 429 rate limited').kind, 'rate-limit');
		assert.strictEqual(parseStreamError('401 invalid key').kind, 'unauthorized');
		assert.strictEqual(parseStreamError('overloaded by provider').kind, 'overloaded');
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getCheckpointForMessage'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('restoreCheckpoint'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('applyToFile'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('copyText'));
	});

	test('Pass 4 agent activity steps and meter helpers', () => {
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u1', role: 'user', content: 'do work' },
			{ id: 'a1', role: 'assistant', content: '', thinking: 'plan', thinkingActive: true, toolCalls: [{ id: 't1', name: 'builtin_read_file', arguments: '{"filepath":"src/a.ts"}', status: 'done', parsedArgs: { filepath: 'src/a.ts' } }] },
			{ id: 'a2', role: 'assistant', content: 'done' },
		];
		const steps = buildAgentActivitySteps(history, 0);
		assert.ok(steps.some(step => step.kind === 'thinking' && step.id.startsWith('reasoning:')));
		assert.ok(steps.some(step => step.kind === 'read' && step.detail === 'a.ts'));
		assert.ok(steps.some(step => step.kind === 'reply'));
		assert.strictEqual(countTurnToolSteps(history, 0), 1);
		assert.strictEqual(resolveAgentMaxSteps(0), null);
		assert.strictEqual(resolveAgentMaxSteps(40), 40);
		assert.strictEqual(formatDurationMs(1500), '1s');
		assert.strictEqual(activityKindLabelKey('shell'), 'activityKindShell');
		assert.strictEqual(pendingApplyStates([{ streamId: '1', status: 'done' }, { streamId: '2', status: 'streaming' }]).length, 1);
		assert.strictEqual(activityAnchorId('tool:abc:1'), 'agent-activity-tool_abc_1');
		assert.strictEqual(loadingVariantFor('thinking'), 'orbit');
		assert.strictEqual(loadingVariantFor('read'), 'dots');
		assert.strictEqual(loadingVariantFor('shell'), 'drive');
		assert.strictEqual(toolStepDetail('builtin_build', { action: 'check', extraArgs: '--release' }), 'check --release');
		assert.strictEqual(toolStepDetail('builtin_read_currently_open_file', {}), 'current file');
		assert.strictEqual(extractSoulCheckpointId('[soul checkpoint=cp-turn-1] ok'), 'cp-turn-1');
		const stamped: IKnoxGuiHistoryItem[] = [
			{ id: 'u', role: 'user', content: 'x' },
			{ id: 'a', role: 'assistant', content: '', toolCalls: [{ id: 'e1', name: 'builtin_edit_file', arguments: '{}', status: 'done', parsedArgs: { filepath: 'b.ts' }, output: '[soul checkpoint=cp-turn-1]' }] },
		];
		assert.strictEqual(buildAgentActivitySteps(stamped, 0)[0].workspaceCheckpointId, 'cp-turn-1');
	});

	test('Pass 4 agent turn meter tokens, jev, tok/s, and duration', () => {
		assert.strictEqual(estimateTokensFromPromptLogs([{ prompt: 'abcd', completion: 'efgh' }]), 2);
		assert.strictEqual(formatTokenCount(420), '420');
		assert.strictEqual(formatTokenCount(4200), '4.2k');
		assert.strictEqual(formatTokenCount(42_000), '42k');
		assert.strictEqual(formatTokenCount(1_356_000), '1.4m');
		assert.strictEqual(formatTokenRate(4.2), '4.2');
		assert.strictEqual(formatTokenRate(42.4), '42');
		const logs = [{ prompt: 'abcdabcd', completion: 'efghij', jev: { turn: { source: 'jev', route: 'view_read', skill: 'qemu' } } }];
		assert.strictEqual(estimateTokensFromPromptLogs(logs), 4);
		assert.deepStrictEqual(summarizeJevPromptLogs(logs), { route: 'view_read', skill: 'qemu', source: 'jev' });
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u1', role: 'user', content: 'edit', createdAt: new Date(1_000).toISOString() },
			{ id: 'a1', role: 'assistant', content: 'ok', createdAt: new Date(5_000).toISOString(), promptLogs: logs, toolCalls: [{ id: 't1', name: 'builtin_task', arguments: '{}', status: 'calling' }] },
		];
		assert.strictEqual(collectTurnPromptLogs(history, 0).length, 1);
		assert.ok(estimateTurnOutputTokens(history, 0, logs) >= 2);
		assert.strictEqual(hasForegroundCallingToolCalls(history), false);
		assert.strictEqual(isTurnGeneratingTokens(true, history), true);
		assert.strictEqual(turnElapsedMs(history, 0, 5_000, false), 4_000);
		assert.strictEqual(tokensPerSecond(42, 1000), 42);
		assert.strictEqual(formatLoadingElapsed(4.2), '4.2s');
		assert.strictEqual(formatLoadingElapsed(0), '0.0s');
		assert.strictEqual(formatLoadingElapsed(62.3), '1m 2.3s');
		let clock = resetTpsClock(0, '0:1');
		clock = tickTokensPerSecond(clock, 10, true, '0:1', 1_000);
		clock = tickTokensPerSecond(clock, 20, true, '0:1', 1_000 + TOKEN_TPS_MIN_GENERATION_MS);
		assert.ok(clock.tps > 0);
		const calling: IKnoxGuiHistoryItem[] = [
			{ id: 'u', role: 'user', content: 'x' },
			{ id: 'a', role: 'assistant', content: '', toolCalls: [{ id: 'e', name: 'builtin_edit_file', arguments: '{}', status: 'calling' }] },
		];
		assert.strictEqual(hasForegroundCallingToolCalls(calling), true);
		assert.strictEqual(isTurnGeneratingTokens(true, calling), false);
		assert.ok(activitySummaryLine(key => key, buildAgentActivitySteps(history, 0)).includes('activitySummaryOther'));
		assert.ok(KNOX_GUI_COMPOSER_SLOTS.includes('agentMeter'));
	});

	test('Pass 6 agent panels match native GUI git, compaction, plan, jobs, memories, autonomous', () => {
		const diff = [
			'diff --git a/src/a.ts b/src/a.ts',
			'index 111..222 100644',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,2 +1,3 @@',
			' keep',
			'-old',
			'+new',
			'+more',
		].join('\n');
		const parsed = parseDiffStats(diff);
		assert.ok(parsed);
		assert.strictEqual(parsed.filepath, 'src/a.ts');
		assert.strictEqual(parsed.additions, 2);
		assert.strictEqual(parsed.deletions, 1);
		assert.strictEqual(gitFileType('Cargo.toml'), 'TOML');
		const files = finalizeGitDiffFiles(gitFilesFromDiffs([diff, 'diff --git a/pkg/a.ts b/pkg/a.ts\n--- a/pkg/a.ts\n+++ b/pkg/a.ts\n@@ -1 +1 @@\n-a\n+b\n']));
		assert.strictEqual(files[0].displayPath, 'src/a.ts');
		assert.ok(files.some(file => file.displayPath.includes('/')));
		assert.deepStrictEqual(gitDiffTotals(files), { additions: 3, deletions: 2 });

		const hidden = parseCompactionPayload({ tokensSaved: 0, originalMessageCount: 2, compactedMessageCount: 2 });
		assert.strictEqual(hidden, undefined);
		const compaction = parseCompactionPayload({
			tokensSaved: 1200,
			originalMessageCount: 40,
			compactedMessageCount: 18,
			summarized: true,
			deduplicated: true,
			summarizationMethod: 'none',
			summaryText: 'Kept the kernel plan.',
		});
		assert.ok(isCompactionBannerVisible(compaction));
		assert.strictEqual(compactionMethodKey(compaction?.summarizationMethod), 'compactionMethodNone');

		const snake = {
			title: 'Snake game with Dioxus 0.8',
			steps: [
				{ id: '1-cargo', title: 'Create snake/Cargo.toml with dioxus 0.8 deps', status: 'pending' as const },
				{ id: '2-main', title: 'Write snake/src/main.rs game logic + UI', status: 'pending' as const },
				{ id: '3-css', title: 'Add style.css', status: 'pending' as const },
				{ id: '4-check', title: 'cargo check / build to verify', status: 'pending' as const },
			],
		};
		assert.deepStrictEqual(extractPathHints('Create snake/Cargo.toml with dioxus 0.8.0-alpha.1'), ['snake/Cargo.toml']);
		assert.strictEqual(stepIntent(snake.steps[0].title), 'write');
		assert.strictEqual(stepIntent(snake.steps[3].title), 'shell');
		const markdown = formatPlanText(snake);
		assert.ok(parsePlanText(markdown)?.title.includes('Snake'));
		const history: IKnoxGuiHistoryItem[] = [
			{ id: 'u', role: 'user', content: 'build snake' },
			{ id: 'p', role: 'tool', content: markdown, toolCalls: [{ id: 'plan', name: 'builtin_plan', arguments: '{}', status: 'done', output: markdown, outputItems: [{ name: 'Plan', description: 'created', content: markdown }] }] },
			{ id: 'f', role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'builtin_create_new_file', arguments: '{"filepath":"snake/Cargo.toml"}', status: 'done', parsedArgs: { filepath: 'snake/Cargo.toml' } }] },
			{ id: 'w', role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'builtin_write_file', arguments: '{"filepath":"snake/src/main.rs"}', status: 'calling', parsedArgs: { filepath: 'snake/src/main.rs' } }] },
		];
		assert.ok(collectLatestTaskPlanSnapshot(history));
		const live = applyLivePlanProgress(snake, history, 1);
		assert.deepStrictEqual(live.steps.map(step => step.status), ['done', 'in_progress', 'pending', 'pending']);
		assert.strictEqual(live.doneCount, 1);
		assert.strictEqual(live.current?.id, '2-main');
		assert.ok(taskPlanFillPercent(live) > 0);
		const collected = collectLiveTaskPlan([
			...history,
			{ id: 'clear', role: 'tool', content: 'Task Execution Plan cleared.', toolCalls: [{ id: 'p2', name: 'builtin_plan', arguments: '{}', status: 'done', output: 'Task Execution Plan cleared.', outputItems: [{ name: 'Plan', description: 'cleared', content: 'Task Execution Plan cleared.' }] }] },
		]);
		assert.strictEqual(collected, undefined);

		const shell = [{ id: 'sh_1', kind: 'shell' as const, title: 'cargo build', status: 'exited' as const, exitCode: 0, output: 'Finished' }];
		const taskHistory: IKnoxGuiHistoryItem[] = [{
			id: 'a',
			role: 'assistant',
			content: '',
			toolCalls: [{ id: 't1', name: 'builtin_task', arguments: '{"prompt":"explore kernel","profile":"explore"}', status: 'calling', parsedArgs: { prompt: 'explore kernel', profile: 'explore' } }],
		}];
		const merged = mergeBackgroundJobs(shell, collectRunningTaskJobs(taskHistory));
		assert.strictEqual(merged.length, 2);
		assert.ok(isTaskJobId(merged.find(job => job.kind === 'task')!.id));
		assert.strictEqual(countRunningJobs(merged), 1);
		assert.strictEqual(countFailedJobs([{ id: 'x', title: 'fail', status: 'exited', exitCode: 1 }]), 1);
		assert.ok(truncateJobTitle('a'.repeat(80)).endsWith('…'));
		assert.strictEqual(visibleBackgroundJobs({ backgroundJobs: shell, history: taskHistory }).length, 2);

		const memories = [
			{ id: 1, kind: 'semantic', title: 'high', reason: 'match', score: 0.9 },
			{ id: 2, kind: 'semantic', title: 'low', reason: 'weak', score: 0.2 },
			{ id: null, kind: 'timeout', title: 'n/a', reason: 'timeout' },
		];
		const split = splitSelectiveMemories(memories, 'selective');
		assert.strictEqual(split.visible.length, 2);
		assert.strictEqual(split.collapsed.length, 1);
		assert.ok(isInjectedMemoryTimeout([{ id: null, kind: 'timeout', title: 'x', reason: 'y' }]));

		const started = applyKnoxGuiAutonomousEvent(createInitialKnoxGuiState(), {
			type: 'autonomous:started',
			data: { session_id: '', goal: 'boot panic', max_iterations: 10 },
		});
		assert.deepStrictEqual(started?.autonomous, { status: 'running', iteration: 0, max: 10, goal: 'boot panic' });
		assert.ok(shouldShowAutonomousBanner(started?.autonomous));
		assert.strictEqual(autonomousBannerKey(started!.autonomous!), 'autonomousBannerRunning');
		const withHistory = { ...createInitialKnoxGuiState(), history: [{ id: 'a', role: 'assistant' as const, content: '' }] };
		const toolStart = applyKnoxGuiAutonomousEvent(withHistory, {
			type: 'autonomous:tool_start',
			data: { call_id: 'c1', name: 'builtin_read_file', args: { filepath: 'mm/filemap.c' } },
		});
		assert.strictEqual(toolStart?.history?.[0].toolCalls?.[0].status, 'calling');
	});

	test('Pass 7 lump overlays match native GUI Models, History, Tools, Prompts', () => {
		assert.deepStrictEqual([...MODEL_OVERLAY_ROLES], ['chat', 'edit', 'apply', 'viewRead', 'realTimeSearch']);
		assert.strictEqual(modelUsesChatFallback('edit', []), true);
		assert.strictEqual(modelUsesChatFallback('viewRead', []), false);
		assert.deepStrictEqual(agentProfileSharedConfig('rust'), {
			agentProfile: 'rust',
			agentDoomLoopThreshold: 4,
			agentVerifyMode: 'command',
			agentVerifyCommand: 'cargo check --workspace --all-targets',
		});
		assert.deepStrictEqual(agentProfileSharedConfig('auto'), { agentProfile: 'auto' });
		const sessions = [
			{ id: '1', title: 'Snake game', date: new Date().toISOString() },
			{ id: '2', title: 'Kernel boot', date: new Date(Date.now() - 3 * 86400000).toISOString() },
			{ id: '3', title: 'Old notes', date: new Date(Date.now() - 40 * 86400000).toISOString() },
		];
		assert.strictEqual(filterHistorySessions(sessions, 'snake')[0].id, '1');
		assert.strictEqual(historySessionMatchesQuery({ id: 'w', title: 'Ship', date: '', workspaceDirectory: '/tmp/demo' }, 'demo'), true);
		assert.deepStrictEqual(selectHistoryIdRange(['a', 'b', 'c'], 'a', 'c'), ['a', 'b', 'c']);
		assert.deepStrictEqual(applyHistoryRowSelection(['a'], ['a', 'b', 'c'], 'c', true, 'a').selected, ['a', 'b', 'c']);
		assert.deepStrictEqual(toggleHistorySelection(['a'], 'b', true), ['a', 'b']);
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);
		const yesterday = new Date(todayStart);
		yesterday.setDate(yesterday.getDate() - 1);
		assert.strictEqual(historyDateSection(Date.now()), 'today');
		assert.strictEqual(historyDateSection(yesterday.getTime() + 60_000, todayStart.getTime() + 12 * 3600_000), 'yesterday');
		const groups = groupHistoryByDate(filterHistorySessions(sessions, ''));
		assert.ok(groups.some(group => group.header === 'today'));
		assert.ok(groups.some(group => group.header === 'thisWeek' || group.header === 'thisMonth'));
		assert.ok(groups.some(group => group.header === 'earlierConversations'));
		assert.deepStrictEqual(sortPromptsBookmarkedFirst(
			[{ name: 'share', description: 'Share' }, { name: 'commit', description: 'Commit' }],
			['commit'],
		).map(cmd => cmd.name), ['commit', 'share']);
		assert.strictEqual(promptDraftIsValid({ name: '/x', description: 'd', prompt: 'p' }), true);
		assert.strictEqual(formatPromptCommandName('commit'), '/commit');
		assert.deepStrictEqual(duplicateToolNames([{ name: 'a', group: 'g' }, { name: 'a', group: 'g' }, { name: 'b', group: 'g' }]), { a: true, b: false });
		assert.strictEqual(pendingGeneratedToolName([{ toolCalls: [{ name: 'builtin_edit_file', status: 'generated' }] }]), 'builtin_edit_file');
		assert.strictEqual(pendingGeneratedToolName([{ toolCalls: [{ name: 'builtin_ask_user', status: 'generated' }] }]), undefined);
		assert.strictEqual(toolPermissionBadgeKey('requiresApproval'), 'toolRequiresApproval');
		assert.strictEqual(toolPermissionBadgeKey('sessionAlways'), 'toolAlwaysThisSession');
		assert.strictEqual(formatPolicyLines([{ action: 'deny', pattern: '~/.ssh/**' }]), 'deny ~/.ssh/**');
		assert.strictEqual(policyEditorText('', DEFAULT_AGENT_TOOL_POLICY_TEXT.paths), DEFAULT_AGENT_TOOL_POLICY_TEXT.paths);
		assert.ok(DEFAULT_AGENT_TOOL_POLICY_TEXT.commands.includes('rm -rf'));
		assert.strictEqual(workspaceBasename('file:///tmp/knoxcoder'), 'knoxcoder');
		assert.ok(sessionExportFilename('Hello World!', new Date('2026-01-02T00:00:00Z')).startsWith('2026-01-02_'));
		const unrolled = [
			{ title: 'Rule 1', body: 'Always be concise', source: 'local' as const },
			{ title: 'Rule 2', body: 'Expanded safety rule', source: 'local' as const },
			{ title: 'Rule 3', body: 'Hidden object rule', source: 'local' as const },
		];
		assert.deepStrictEqual(mergeRuleCards(unrolled).map(rule => rule.source), ['local', 'local', 'local']);
		const merged = mergeRuleCards(unrolled, [undefined, { uses: 'knox/safety' }, { name: 'hidden' }]);
		assert.deepStrictEqual(merged.map(rule => ({ source: rule.source, uses: rule.uses, title: ruleCardTitleKey(rule).title ?? ruleCardTitleKey(rule).key })), [
			{ source: 'local', uses: undefined, title: 'locallyDefinedRule' },
			{ source: 'uses', uses: 'knox/safety', title: 'knox/safety' },
		]);
		assert.strictEqual(ruleCardOpensProfile(merged[0]), true);
		assert.strictEqual(ruleCardOpensProfile(merged[1]), false);
		assert.strictEqual(ruleCardOpensProfile({ title: '', body: 'x', source: 'inline' }), false);
		assert.strictEqual(mergeRuleCards([{ title: '', body: 'inline body' }], ['inline body'])[0].source, 'inline');
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/listProfiles'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/openProfile'));
		assert.deepStrictEqual(parseYamlRules([
			'name: Knox',
			'rules:',
			'  - Always be concise',
			'  - uses: knox/safety',
			'  - name: hidden',
			'    rule: ignore me',
			'prompts:',
			'  - name: x',
		].join('\n')), ['Always be concise', { uses: 'knox/safety' }, { name: 'hidden', rule: 'ignore me' }]);
		assert.strictEqual(parseYamlRules('models:\n  - name: x'), undefined);
		assert.deepStrictEqual(exploreBlocksButton('local', 'rules'), { isLocal: true, icon: 'plus', actionKey: 'add', blockKey: 'rules' });
		assert.deepStrictEqual(exploreBlocksButton(undefined, 'rules'), { isLocal: false, icon: 'share-2', actionKey: 'explore', blockKey: 'rules' });
	});

	test('GP-049 prompts overlay helpers match native GUI PromptsSection and AddPromptDialog', () => {
		assert.strictEqual(promptSlashName('commit'), '/commit');
		assert.strictEqual(promptSlashName('/share'), '/share');
		assert.strictEqual(promptDraftIsEditing(emptyPromptDraft()), false);
		assert.strictEqual(promptDraftIsEditing(promptDraftFromCommand({ name: '/x', description: 'd', prompt: 'p' })), true);
		assert.strictEqual(promptDraftIsValid(emptyPromptDraft()), false);
		assert.strictEqual(promptDraftIsValid({ name: '/x', description: 'd', prompt: 'p' }), true);
		assert.strictEqual(PROMPT_FILE_SUBMENU_TITLE, '.prompt file');
		assert.strictEqual(isPromptFileMentionSubmenu('.prompt file'), true);
		assert.strictEqual(isPromptFileMentionSubmenu(undefined, '.prompt file'), true);
		assert.strictEqual(isPromptFileMentionSubmenu('prompts'), false);
		const injected = appendNewPromptFileMentionAction([], '.prompt file', 'prompts', {
			title: 'Add new .prompt file',
			description: 'Create new .prompt file',
		});
		assert.strictEqual(injected.length, 1);
		assert.strictEqual(isNewPromptFileMentionAction(injected[0]), true);
		assert.strictEqual(injected[0].id, NEW_PROMPT_FILE_ACTION_ID);
		assert.deepStrictEqual(appendNewPromptFileMentionAction(injected, '.prompt file', 'prompts', {
			title: 'Add new .prompt file',
			description: 'Create new .prompt file',
		}), injected);
		assert.deepStrictEqual(appendNewPromptFileMentionAction([], 'file', 'file', { title: 'x', description: 'y' }), []);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/newPromptFile'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/addPrompt'));
	});

	test('Pass 8 secondary pages: config errors, batch diff, add-model providers', () => {
		assert.deepStrictEqual(sortConfigErrors([{ fatal: false, message: 'w' }, { fatal: true, message: 'f' }]).map(e => e.fatal), [true, false]);
		assert.deepStrictEqual(batchDiffTotals([{ numDiffs: 2, selected: true }, { numDiffs: 3, selected: false }]), { selected: 1, diffs: 5 });
		assert.deepStrictEqual(splitFilePath('src/app.ts'), { fileName: 'app.ts', dirPath: 'src' });
		assert.deepStrictEqual(ADD_MODEL_PROVIDERS.map(p => p.id), ['knoxchat', 'openai', 'anthropic']);
		assert.ok(addModelProviderById('knoxchat')?.collectInputFor.some(input => input.key === 'completionOptions.temperature'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/addPrompt'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('didChangeAvailableProfiles'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('didCloseFiles'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('getActiveChatSession'));
	});

	test('Pass 9 memory tabs, browser grouping, and graph layout', () => {
		assert.deepStrictEqual([...MEMORY_TAB_IDS], ['overview', 'memories', 'sessions', 'graph', 'settings']);
		assert.strictEqual(isMemoryTabId('overview'), true);
		assert.strictEqual(isMemoryTabId('nope'), false);
		const memories = [
			{ id: '1', title: 'hot', category: 'insight', tier: 'hot', pinned: true, importance: 0.9, createdAt: new Date().toISOString() },
			{ id: '2', title: 'cold', category: 'general', tier: 'cold', pinned: false, importance: 0.1, createdAt: new Date(Date.now() - 40 * 86400000).toISOString() },
		];
		assert.strictEqual(filterAndSortMemories(memories, { pinned: 'pinned' }).length, 1);
		assert.strictEqual(filterAndSortMemories(memories, { query: 'hot' }).map(memory => memory.id).join(), '1');
		assert.strictEqual(groupMemoriesByDate(memories).some(section => section.headerKey === 'today'), true);
		assert.ok(memorySnippet('a '.repeat(80)).endsWith('…'));
		assert.strictEqual(layoutMemoryGraph([{ id: 1, name: 'A', entityType: 'concept', mentionCount: 1 }], 100, 100)[0].x > 0, true);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/exploreGraph'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/listSessions'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/heal'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/listEntities'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/getSessionHistory'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/consolidate'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/addModel'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/deleteModel'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('pinCheckpoint'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('focusKnoxSessionId'));
		assert.strictEqual(reasoningEffortLabelKey('high'), 'reasoningEffortLevelHigh');
		const knoxchat = addModelProviderById('knoxchat');
		assert.ok(knoxchat);
		assert.strictEqual(addModelRequiredSatisfied(knoxchat, {}, false), false);
		assert.strictEqual(addModelRequiredSatisfied(knoxchat, {}, true), true);
		assert.strictEqual(addModelRequiredSatisfied(knoxchat, { apiKey: 'sk-test' }, false), true);
		assert.strictEqual(knoxGuiOAuthPane('waiting_for_consent', false), 'in_progress');
		assert.strictEqual(knoxGuiOAuthPane('success', true), 'connected');
		assert.strictEqual(knoxGuiOAuthPane('failed', false), 'disconnected');
		assert.strictEqual(knoxGuiOAuthErrorI18nKey('failed', 'denied'), 'oauthErrorDenied');
		assert.strictEqual(knoxGuiOAuthErrorI18nKey('failed', 'cancelled'), undefined);
		assert.strictEqual(knoxGuiOAuthErrorI18nKey('failed', 'bind_failed'), 'oauthErrorPortInUse');
		assert.strictEqual(knoxGuiOAuthHandle({ userId: 9, username: 'knox' }), '@knox');
		assert.strictEqual(knoxGuiOAuthHandle({ userId: 9, username: '' }), 'user 9');
		assert.deepStrictEqual(parseKnoxOAuthStatus({
			state: 'failed',
			error: 'timeout',
		}), {
			oauthStatus: 'failed',
			oauthHandle: undefined,
			oauthConnected: false,
			oauthError: 'timeout',
		});
		assert.deepStrictEqual(parseKnoxOAuthStatus({
			state: 'success',
			account: { userId: 9, username: 'knox', tokenId: 1, connectedAt: 0 },
		}), {
			oauthStatus: 'success',
			oauthHandle: '@knox',
			oauthConnected: true,
			oauthError: undefined,
		});
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('knoxchat/oauth/status'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('knoxchat/oauth/start'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('knoxchat/oauth/cancel'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('knoxchat/oauth/signOut'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('knoxchat/oauth/update'));
		const payload = buildAddModelPayload(knoxchat, knoxchat.packages[0], { apiKey: 'sk-test', 'completionOptions.temperature': '0.4' }, 'chat');
		assert.strictEqual(payload.model.provider, 'knoxchat');
		assert.strictEqual(payload.model.title, 'KnoxChat');
		assert.deepStrictEqual(payload.model.roles, ['chat']);
		assert.deepStrictEqual(buildAddModelPayload(knoxchat, knoxchat.packages[0], { apiKey: 'sk' }, 'chat', { bulk: true }).model.roles, ['chat', 'edit', 'apply']);
		assert.deepStrictEqual((payload.model.completionOptions as { temperature: number }).temperature, 0.4);
		assert.deepStrictEqual(setPathValue({ completionOptions: { temperature: 0.1 } }, 'completionOptions.topP', 0.9).completionOptions, { temperature: 0.1, topP: 0.9 });
		assert.strictEqual(categorizeKnoxChatModel({ id: 'openai/gpt-4o', name: 'GPT-4o' }), 'OpenAI');
		assert.strictEqual(categorizeKnoxChatModel({ id: 'knox/knox-ms', name: 'Knox MS' }), 'KnoxChat');
		assert.deepStrictEqual(groupKnoxChatModels([
			{ title: 'A', category: 'Other' },
			{ title: 'B', category: 'OpenAI' },
		]).map(group => group.category), ['OpenAI', 'Other']);
		assert.strictEqual(filterKnoxChatModels([{ title: 'GPT-4o', model: 'openai/gpt-4o' }, { title: 'Claude', model: 'anthropic/claude' }], 'gpt').length, 1);
		assert.strictEqual(filterKnoxChatModels([
			{ title: 'DeepSeek: DeepSeek V4.1 Flash', model: 'deepseek/deepseek-v4.1-flash', category: 'DeepSeek' },
			{ title: 'DeepSeek-V4.1-Flash', model: 'knoxchat/flash', category: 'KnoxChat' },
			{ title: 'GPT-4o', model: 'openai/gpt-4o', category: 'OpenAI' },
		], 'deepseek').length, 2);
		assert.strictEqual(filterKnoxChatModels([
			{ title: 'DeepSeek: DeepSeek V4.1 Flash', model: 'deepseek/deepseek-v4.1-flash', category: 'DeepSeek' },
			{ title: 'DeepSeek-V4.1-Flash', model: 'knoxchat/flash', category: 'KnoxChat' },
		], 'deepseek knox').length, 1);
		const merged = mergeReasoningEffortPrefs({ lastEffort: undefined, byModel: {} }, { lastEffort: 'high', byModel: { 'GPT-4o': 'high' } }, 'GPT-4o');
		assert.strictEqual(merged.lastEffort, 'high');
		assert.strictEqual(merged.shouldWriteDisk, true);
		assert.deepStrictEqual(memoryConfigUpdatePayload('graph_max_depth', 4), { key: 'graph_max_depth', value: '4' });
		assert.deepStrictEqual(MEMORY_SETTING_GROUPS.map(group => group.titleKey), [
			'memoryGeneralSettings',
			'memoryEbbinghausSettings',
			'memoryCapacitySettings',
			'memoryPrecisionSettings',
			'memoryWorkingMemorySettings',
			'memoryTaskRoutingSettings',
			'memoryContextAssemblySettings',
			'memoryModeTuningSettings',
			'memoryBudgetSettings',
			'memoryFusionSettings',
			'memoryCompressionSettings',
			'memoryIntegrationSettings',
			'memoryGraphSettings',
			'memoryTieringSettings',
			'memoryFeatureSettings',
		]);
		const trend = parseMetricsTrend({
			avg_response_trend: 'improving',
			success_rate_trend: 'stable',
			period_hours: 24,
			snapshots: [{ avg_response_ms: 12, success_rate: 1, memory_count: 3, total_effective: 40 }],
		});
		assert.strictEqual(trend?.response, 'improving');
		assert.strictEqual(trend?.snapshots?.[0].memoryCount, 3);
		const laid = layoutMemoryGraph([{ id: 1, name: 'A', entityType: 'concept', mentionCount: 1 }], 100, 100);
		assert.strictEqual(hitTestMemoryGraph(laid, laid[0].x, laid[0].y), 1);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('ui/getReasoningEffortPrefs'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('ui/updateReasoningEffortPrefs'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('batch/getPendingFiles'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/searchMemories'));
		assert.deepStrictEqual(JSON.parse(memoriesToExportJson([{ id: '1', title: 't', content: 'c' }])).memories[0].title, 't');
		assert.strictEqual(unwrapBrainConfig({ config: { graph_max_depth: 4 } }).graph_max_depth, 4);
		assert.strictEqual(parseEffectiveContext({ total_effective: 12, memory_levels: [{ id: 'm1', name: 'M1', tokens: 3 }] })?.totalEffective, 12);
		assert.strictEqual(healthStatusColor('healthy'), '#22c55e');
		assert.strictEqual(healthStatusColor('degraded'), '#f59e0b');
		assert.strictEqual(healthStatusColor('critical'), '#ef4444');
		assert.strictEqual(MEMORY_TIER_COLORS.hot.text, '#ef4444');
		assert.strictEqual(MEMORY_TIER_COLORS.warm.text, '#f59e0b');
		assert.strictEqual(MEMORY_TIER_COLORS.cold.text, '#3b82f6');
		assert.strictEqual(formatBytes(0), '0 B');
		assert.ok(formatBytes(1536).includes('KB'));
		assert.ok(formatBytes(2 * 1024 * 1024 * 1024).includes('GB'));
		assert.strictEqual(formatMemoryTimeAgo(undefined, key => key), 'memoryTimeNever');
		assert.strictEqual(formatMemoryTimeAgo(new Date().toISOString(), key => key), 'memoryTimeJustNow');
		assert.deepStrictEqual(MEMORY_TAB_ICONS, {
			overview: 'brain',
			memories: 'database',
			sessions: 'message-square',
			graph: 'graph-nodes',
			settings: 'settings',
		});
		const dashboard = parseMemoryDashboard({
			stats: { total_semantic: 4, total_episodic: 2, tier_counts: { hot: 1, warm: 2, cold: 3 }, db_size_bytes: 2048 },
			health: { status: 'healthy', issues: [], recommendations: [] },
			healthScore: { overall: 91, grade: 'A' },
			graphStats: { max_entities: 5000, total_entities: 12, total_edges: 8, cap_utilization: 0.2, max_depth: 3, depth_decay_gamma: 0.7 },
			sessions: [{ id: 's1', title: 'Chat', message_count: 3, updated_at: new Date().toISOString() }],
			consolidation: { total_runs: 2, last_run_at: new Date().toISOString(), avg_duration_ms: 40 },
		});
		assert.strictEqual(dashboard?.healthGrade, 'A');
		assert.strictEqual(dashboard?.healthScore, 91);
		assert.strictEqual(dashboard?.tierCounts?.hot, 1);
		assert.strictEqual(dashboard?.sessions?.length, 1);
		assert.strictEqual(dashboard?.consolidation?.totalRuns, 2);
		assert.strictEqual(dashboard?.graphMaxEntities, 5000);
		const ctx = parseEffectiveContext({
			total_effective: 80,
			active_window_tokens: 10,
			hierarchy_effective_tokens: 20,
			window_utilization: 0.4,
			tier_tokens: { hot: 8 },
			compression_ratios: { hot: 2 },
			memory_levels: [{ id: 'M1', name: 'Sensory', tokens: 4, ratio: 1, effective_tokens: 4 }],
		});
		assert.strictEqual(ctx?.activeWindowTokens, 10);
		assert.strictEqual(ctx?.levels[0].effectiveTokens, 4);
		assert.ok(MEMORY_SETTING_GROUPS[1].fields.some(field => field.key === 'ebbinghaus_salience_weight'));
		assert.ok(MEMORY_SETTING_GROUPS[1].fields.some(field => field.key === 'ebbinghaus_importance_weight'));
		assert.strictEqual(MEMORY_SETTING_GROUPS[1].fields.find(field => field.key === 'ebbinghaus_prune_threshold')?.percent, true);
		assert.ok(MEMORY_SETTING_GROUPS.some(group => group.titleKey === 'memoryTaskRoutingSettings'));
		assert.ok(MEMORY_SETTING_GROUPS.some(group => group.collapsed && group.titleKey === 'memoryBudgetSettings'));
		const mode = MEMORY_SETTING_GROUPS.find(group => group.titleKey === 'memoryModeTuningSettings');
		assert.ok(mode?.fields.some(field => field.key === 'mode_full_episodic_multiplier' && field.sectionKey === 'memoryModeFull'));
		assert.ok(mode?.fields.some(field => field.key === 'mode_summarized_episodic_snippet_len'));
		assert.ok(mode?.fields.some(field => field.key === 'mode_selective_min_importance' && field.percent));
		assert.strictEqual(addModelProviderById('knoxchat')?.provider, 'knoxchat');
		const modeGroup = MEMORY_SETTING_GROUPS.find(group => group.titleKey === 'memoryModeTuningSettings');
		assert.ok(modeGroup?.fields.some(field => field.key === 'mode_full_episodic_multiplier' && field.sectionKey === 'memoryModeFull'));
		assert.ok(modeGroup?.fields.some(field => field.key === 'mode_summarized_episodic_snippet_len'));
		assert.ok(modeGroup?.fields.some(field => field.key === 'mode_selective_min_importance' && field.percent));
	});

	test('Pass 10 checkpoint shell, this-session filter, and lane layout', () => {
		assert.strictEqual(checkpointShellMessageKey('no-workspace'), 'checkpointGraph.noWorkspace');
		assert.strictEqual(checkpointShellMessageKey(undefined), 'checkpointGraph.loading');
		assert.strictEqual(checkpointShellMessageKey('failed'), 'checkpointGraph.failed');
		assert.strictEqual(checkpointShellAction('empty')?.action, 'createCheckpoint');
		assert.strictEqual(checkpointShellAction('no-workspace')?.action, 'openFolder');
		assert.strictEqual(checkpointShellAction('not-initialized')?.action, 'retryInit');
		assert.strictEqual(checkpointShellAction('failed')?.action, 'retryInit');
		assert.strictEqual(checkpointShellViewState(undefined, 0), 'loading');
		assert.strictEqual(checkpointShellViewState('ready', 0, 0), 'empty');
		assert.strictEqual(checkpointShellViewState('ready', 2, 2), 'ready');
		assert.deepStrictEqual(CHECKPOINT_TAB_ICON, {
			graph: 'git-branch',
			checkpoints: 'rotate-ccw',
			timeline: 'history',
			analysis: 'info',
			share: 'share-2',
			configuration: 'settings',
			dashboard: 'bar-chart-3',
		});
		const nodes = [
			{ id: 'a', description: 'head', created: new Date().toISOString(), kind: 'auto', tags: [], shortId: 'a', pinned: false, changedPaths: [], sessionId: 's1', parents: ['b'], fileChanges: { added: 0, modified: 0, deleted: 0 } },
			{ id: 'b', description: 'base', created: new Date(Date.now() - 1000).toISOString(), kind: 'manual', tags: [], shortId: 'b', pinned: true, changedPaths: ['src/a.ts'], sessionId: 's2', parents: [], fileChanges: { added: 0, modified: 1, deleted: 0 } },
		];
		assert.strictEqual(filterCheckpoints(nodes, { thisSession: true, sessionId: 's1' }).length, 1);
		const layout = layoutCheckpointLanes(nodes.map(node => ({ id: node.id, parents: node.parents })), 'a');
		assert.strictEqual(layout.nodes[0].current, true);
		assert.ok(layout.segments.length >= 1);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getCheckpointGraphUiState'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('checkpointWorkingTree'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('previewRestore'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('computeCheckpointDiff'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('restoreCheckpointFiles'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getCheckpointConfig'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('saveCheckpointConfig'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getPerformanceDashboard'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('analyzeCheckpoint'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getSharedCheckpointBundles'));
		const linear = layoutCheckpointLanes([{ id: 'a', parents: ['b'] }, { id: 'b', parents: [] }], 'a');
		const drawing = drawCheckpointGraph(linear);
		assert.strictEqual(drawing.width, 24);
		assert.strictEqual(drawing.height, CHECKPOINT_GRAPH_ROW_HEIGHT * 2);
		assert.deepStrictEqual(drawing.paths, [{ d: 'M12,14 L12,42', colorIndex: 0 }]);
		assert.deepStrictEqual(drawing.vertices, [
			{ id: 'a', cx: 12, cy: 14, colorIndex: 0, current: true },
			{ id: 'b', cx: 12, cy: 42, colorIndex: 0, current: false },
		]);
		const fork = drawCheckpointGraph(layoutCheckpointLanes([
			{ id: 'feature', parents: ['base'] },
			{ id: 'main', parents: ['base'] },
			{ id: 'base', parents: [] },
		]));
		assert.strictEqual(fork.width, 40);
		assert.deepStrictEqual(fork.paths.map(path => path.colorIndex), [0, 0, 1]);
		assert.strictEqual(fork.paths[2]?.d, 'M28,42 C28,64.4 12,47.6 12,70');
		assert.deepStrictEqual(fork.vertices.map(vertex => vertex.cx), [12, 28, 12]);
		const expand = { at: 1, y: 40 };
		const stretched = drawCheckpointGraph(layoutCheckpointLanes([
			{ id: 'feature', parents: ['base'] },
			{ id: 'main', parents: ['base'] },
			{ id: 'base', parents: [] },
		]), expand);
		assert.strictEqual(stretched.height, CHECKPOINT_GRAPH_ROW_HEIGHT * 3 + 40);
		assert.strictEqual(checkpointGraphRowTop(2, expand), CHECKPOINT_GRAPH_ROW_HEIGHT * 2 + 40);
		assert.strictEqual(stretched.vertices[2]?.cy, 70 + 40);
		assert.deepStrictEqual(checkpointGraphWindow(0, 0, 400), { start: 0, end: 0 });
		const firstWindow = checkpointGraphWindow(500, 0, 0);
		assert.ok(firstWindow.end > 0 && firstWindow.end < 80);
		assert.deepStrictEqual(checkpointGraphWindow(500, CHECKPOINT_GRAPH_ROW_HEIGHT * 100, 280), { start: 92, end: 118 });
		const lineageNodes = [
			{ id: 'cp_feature', parents: ['cp_base'] },
			{ id: 'cp_main', parents: ['cp_base'] },
			{ id: 'cp_base', parents: [] },
		];
		const lineageLanes = [
			{ id: 'cp_feature', lane: 1 },
			{ id: 'cp_main', lane: 0 },
			{ id: 'cp_base', lane: 0 },
		];
		assert.deepStrictEqual([...checkpointAncestorIds(lineageNodes, 'cp_main')].sort(), ['cp_base', 'cp_main']);
		assert.strictEqual(checkpointAncestorIds(lineageNodes, null).size, 0);
		assert.strictEqual(checkpointLaneNeighbor(lineageNodes, lineageLanes, 'cp_main', 'down'), 'cp_base');
		assert.strictEqual(checkpointLaneNeighbor(lineageNodes, lineageLanes, 'cp_base', 'up'), 'cp_main');
		assert.strictEqual(checkpointLaneNeighbor(lineageNodes, lineageLanes, 'cp_feature', 'down'), undefined);
		const matchNode = { id: 'cp_mainline01', shortId: 'cp_mainlin', description: 'Ship auth', tags: ['wip'], changedPaths: ['src/login.tsx'] };
		assert.strictEqual(checkpointGraphMatches(matchNode, ['feature'], 'AUTH'), true);
		assert.strictEqual(checkpointGraphMatches(matchNode, ['feature'], 'mainline01'), true);
		assert.strictEqual(checkpointGraphMatches(matchNode, ['feature'], 'absent'), false);
		assert.strictEqual(checkpointGraphMatches(matchNode, ['feature'], '  '), false);
		const now = Date.parse('2026-09-22T12:00:00.000Z');
		assert.strictEqual(formatCheckpointGraphTime(new Date(now - 20_000).toISOString(), now).relativeKey, 'checkpointGraph.justNow');
		assert.strictEqual(formatCheckpointGraphTime(new Date(now - 16 * 60_000).toISOString(), now).count, 16);
		assert.strictEqual(formatCheckpointGraphTime(new Date(now - 60_000).toISOString(), now).relativeKey, 'checkpointGraph.minuteAgo');
		assert.strictEqual(formatCheckpointGraphTime(new Date(now - 8 * 24 * 60 * 60_000).toISOString(), now).relativeKey, undefined);
		assert.deepStrictEqual(formatCheckpointGraphTime('not-a-date', now), { absolute: 'not-a-date' });
		assert.strictEqual(withWorkingTreeNode(nodes, 'a', ['src/a.ts'], 'Uncheckpointed changes')[0].id, CHECKPOINT_GRAPH_WORKING_TREE_ID);
		assert.deepStrictEqual(selectCheckpointIdRange(['a', 'b', 'c'], 'a', 'c'), ['a', 'b', 'c']);
		assert.strictEqual(parseCheckpointGraphUi({ mute: false, detailsLocation: 'dock' }).detailsLocation, 'dock');
		assert.strictEqual(defaultCheckpointGraphUi().mute, true);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('setActiveCheckpointWorkspace'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('openCheckpointFileDiff'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('exportCheckpoint'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('switchCheckpointBranch'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('listCheckpoints'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getCheckpointDetails'));
		assert.deepStrictEqual(groupCheckpointsByDate([
			{ id: 'a', description: 'now', created: new Date('2026-09-26T10:00:00.000Z').toISOString(), kind: 'manual', tags: [], shortId: 'a', pinned: false, changedPaths: [], parents: [], fileChanges: { added: 0, modified: 0, deleted: 0 } },
			{ id: 'b', description: 'old', created: new Date('2026-08-01T10:00:00.000Z').toISOString(), kind: 'manual', tags: [], shortId: 'b', pinned: false, changedPaths: [], parents: [], fileChanges: { added: 0, modified: 0, deleted: 0 } },
		], Date.parse('2026-09-26T12:00:00.000Z')).map(group => group.header), ['today', 'earlierCheckpoints']);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getCheckpointTimeline'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getCheckpointForStableId'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/refreshProfiles'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('edit/exit'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('applyToFile'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('memory/buildContext'));
		assert.strictEqual(KNOX_GUI_HOST_OUTBOUND_UNUSED_IN_CHROME.length, 0);
		assert.strictEqual(knoxGuiRelativeFontSize(14, -3), 11);
		assert.strictEqual(knoxGuiRelativeFontSize(14, -2), 12);
		assert.strictEqual(knoxGuiRelativeFontSize(1, -3), 1);
		const flipped = knoxGuiAnchorPopoverBox({
			trigger: { left: 8, top: 400, bottom: 418, width: 80 },
			viewport: { width: 400, height: 430 },
			menu: { width: 160, height: 200 },
		});
		assert.strictEqual(flipped.placement, 'top');
		assert.ok(flipped.top < 400);
		const below = knoxGuiAnchorPopoverBox({
			trigger: { left: 8, top: 10, bottom: 28, width: 80 },
			viewport: { width: 400, height: 400 },
			menu: { width: 160, height: 80 },
		});
		assert.strictEqual(below.placement, 'bottom');
		assert.ok(below.top >= 28);
		const endAligned = knoxGuiAnchorPopoverBox({
			trigger: { left: 200, top: 10, bottom: 28, width: 80 },
			viewport: { width: 400, height: 400 },
			menu: { width: 160, height: 80 },
			align: 'end',
		});
		assert.strictEqual(endAligned.left, 120);
	});

	test('Pass 11 restore preview, line diff, file tree, and config validation', () => {
		const preview = parseRestorePreview({
			success: true,
			preview: {
				checkpointId: 'cp1',
				description: 'head',
				modified: 1,
				added: 1,
				deleted: 1,
				writePaths: ['a.ts'],
				extraPaths: ['gone.ts'],
				skippedFiles: [],
				files: [
					{ relativePath: 'a.ts', action: 'overwrite', additions: 2, deletions: 1, hunkCount: 1 },
					{ relativePath: 'b.ts', action: 'create', additions: 3, deletions: 0, hunkCount: 1 },
					{ relativePath: 'gone.ts', action: 'delete', additions: 0, deletions: 4, hunkCount: 1 },
				],
			},
		});
		assert.strictEqual(preview?.files.length, 3);
		assert.strictEqual(restorePreviewActionKey('overwrite'), 'restorePreviewWillOverwrite');
		const diff = computeLineDiff('hello\nworld', 'hello\nthere');
		assert.ok(diff.some(line => line.type === 'removed' && line.content === 'world'));
		assert.ok(diff.some(line => line.type === 'added' && line.content === 'there'));
		const hunks = groupDiffHunks(diff);
		assert.ok(hunks.length >= 1);
		assert.ok(hunks[0].lines.some(line => line.type !== 'context'));
		assert.strictEqual(fillDailyCounts([{ bucket: '2026-09-26', count: 2 }], 3).length, 3);
		assert.strictEqual(compactAxisNumber(1500), '1.5k');
		assert.strictEqual(checkpointConfigHasChanges(normalizeCheckpointConfig({ maxCheckpoints: 50 }), normalizeCheckpointConfig({})), true);
		assert.deepStrictEqual(buildCheckpointFileTree(['src/a.ts', 'src/b.ts', 'readme.md']).map(node => node.name).sort(), ['readme.md', 'src']);
		const config = normalizeCheckpointConfig({ maxCheckpoints: 50 });
		assert.strictEqual(config.maxCheckpoints, 50);
		assert.strictEqual(checkpointConfigHasErrors(validateCheckpointConfig(config)), false);
		assert.strictEqual(parseStorageBytes('2 MB'), 2 * 1024 * 1024);
		assert.deepStrictEqual([...CHECKPOINT_PANEL_TABS], ['graph', 'checkpoints', 'timeline', 'analysis', 'share', 'configuration', 'dashboard']);
		assert.strictEqual(STREAM_COALESCE_MS, 50);
		let emitted = 0;
		const coalescer = createStreamUpdateCoalescer(() => { emitted += 1; }, { waitMs: 10, flushNow: () => true });
		coalescer.enqueue(1);
		assert.strictEqual(emitted, 1);
		coalescer.dispose();
		const prev = createInitialKnoxGuiState();
		prev.history = [{ id: 'a', role: 'assistant', content: 'hi' }];
		prev.isStreaming = true;
		const next: IKnoxGuiState = { ...prev, history: [{ id: 'a', role: 'assistant', content: 'hi there' }], isStreaming: true };
		assert.strictEqual(isKnoxGuiStreamingTokenChange(prev, next), true);
		const withTool: IKnoxGuiState = {
			...next,
			history: [{ id: 'a', role: 'assistant', content: 'hi there', toolCalls: [{ id: 't', name: 'builtin_read_file', arguments: '{}', status: 'calling' }] }],
		};
		assert.strictEqual(isKnoxGuiStreamingTokenChange(next, withTool), true);
		const toolOut: IKnoxGuiState = {
			...withTool,
			history: [{ id: 'a', role: 'assistant', content: 'hi there', thinking: 'plan more', toolCalls: [{ id: 't', name: 'builtin_read_file', arguments: '{}', status: 'calling', output: 'file body' }] }],
		};
		assert.strictEqual(isKnoxGuiStreamingTokenChange(withTool, toolOut), true);
		const ended: IKnoxGuiState = { ...toolOut, isStreaming: false, history: [{ id: 'a', role: 'assistant', content: 'hi there done', thinking: 'plan more', toolCalls: toolOut.history[0].toolCalls }] };
		assert.strictEqual(isKnoxGuiStreamingTokenChange(toolOut, ended), true);
		assert.strictEqual(isKnoxGuiStreamingTokenChange(ended, { ...ended, history: [{ ...ended.history[0], content: 'idle edit' }] }), false);
		// Running tool output while not streaming must patch in place (a rebuild restarts the header spinner).
		const running: IKnoxGuiState = { ...ended, history: [{ id: 'a', role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'builtin_run_terminal_command', arguments: '{}', status: 'calling' }] }] };
		const progress: IKnoxGuiState = { ...running, history: [{ ...running.history[0], toolCalls: [{ ...running.history[0].toolCalls![0], output: 'Compiling…' }] }] };
		assert.deepStrictEqual(knoxGuiToolProgressOnlyChange(running, progress), ['t']);
		const finished: IKnoxGuiState = { ...progress, history: [{ ...progress.history[0], toolCalls: [{ ...progress.history[0].toolCalls![0], status: 'done' }] }] };
		assert.strictEqual(knoxGuiToolProgressOnlyChange(progress, finished), undefined);
		assert.strictEqual(knoxGuiToolProgressOnlyChange(progress, { ...progress, history: [...progress.history, { id: 'b', role: 'user', content: 'x' }] }), undefined);
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('applyCodeFromChat'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('focusKnoxInput'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('isKnoxInputFocused'));
		const spans = wordAltRanges('const foo = 1', 'const bar = 1');
		assert.ok(spans.before.some(range => 'const foo = 1'.slice(range.start, range.end).includes('foo')));
		assert.ok(spans.after.some(range => 'const bar = 1'.slice(range.start, range.end).includes('bar')));
		const hunkAlt = hunkWordAltRanges([
			{ type: 'removed', oldLineNum: 1, newLineNum: null, content: 'hello world' },
			{ type: 'added', oldLineNum: null, newLineNum: 1, content: 'hello there' },
		]);
		assert.ok(hunkAlt[0]?.length);
		assert.ok(hunkAlt[1]?.length);
		assert.strictEqual(checkpointRiskChipClass('Low'), 'odp-chip-green');
		assert.strictEqual(checkpointRiskChipClass('Critical'), 'odp-chip-red');
		assert.strictEqual(checkpointScopeChipClass('Module'), 'odp-chip-blue');
		assert.strictEqual(checkpointImpactChipClass('High'), 'odp-chip-red');
		const dimPack = {
			title: 'Sized',
			params: { model: 'sized', title: 'Sized', contextLength: 8000 },
			dimensions: [{
				name: 'size',
				description: 'parameter count',
				options: {
					'7b': { model: 'sized-7b', contextLength: 4000 },
					'13b': { model: 'sized-13b', contextLength: 8000 },
				},
			}],
		};
		assert.deepStrictEqual(mergeDimensionOptions(dimPack.dimensions, ['13b']), { model: 'sized-13b', contextLength: 8000 });
		assert.deepStrictEqual(mergeDimensionOptions(dimPack.dimensions, undefined), { model: 'sized-7b', contextLength: 4000 });
		const knoxchat = addModelProviderById('knoxchat')!;
		const withDim = buildAddModelPayload(knoxchat, { ...knoxchat.packages[0], dimensions: dimPack.dimensions }, { apiKey: 'sk' }, undefined, { dimensionChoices: ['7b'] });
		assert.strictEqual(withDim.model.model, 'sized-7b');
		assert.strictEqual(withDim.model.contextLength, 4000);
		assert.ok(knoxGuiProviderLogoUri('knoxchat.png')?.includes('knoxchat.png'));
		const graphKeyA = checkpointGraphForceMountKey({
			checkpoints: [],
			branches: [],
			ui: { mute: true },
			hasMore: false,
			findOpen: false,
			findQuery: '',
			findIndex: 0,
			findOpenDetails: false,
			openId: null,
			menu: null,
			prompt: null,
			promptValue: '',
			settingsOpen: false,
			compare: null,
			comparePaths: null,
			compareError: null,
			armCompare: false,
			scrollTop: 0,
			viewport: 400,
			pendingHead: false,
			expandedFolders: [],
		});
		const graphKeyB = checkpointGraphForceMountKey({
			checkpoints: [],
			branches: [],
			ui: { mute: true },
			hasMore: false,
			findOpen: false,
			findQuery: '',
			findIndex: 0,
			findOpenDetails: false,
			openId: null,
			menu: null,
			prompt: null,
			promptValue: '',
			settingsOpen: false,
			compare: null,
			comparePaths: null,
			compareError: null,
			armCompare: false,
			scrollTop: 0,
			viewport: 400,
			pendingHead: false,
			expandedFolders: [],
		});
		assert.strictEqual(graphKeyA, graphKeyB);
	});

	test('Pass 0 capability autodetect matches native GUI modelSupports*', () => {
		knoxGuiResetModelCatalogForTests();
		assert.strictEqual(knoxGuiModelSupportsImages({
			title: 'SpaceXAI: Grok 4.7',
			provider: 'knoxchat',
			model: 'spacexai/grok-4.7',
		}), true);
		assert.strictEqual(knoxGuiModelSupportsImages({
			title: 'GPT-4o',
			provider: 'openai',
			model: 'gpt-4o',
			capabilities: { uploadImage: true },
		}), true);
		assert.strictEqual(knoxGuiModelSupportsImages({
			title: 'hidden',
			provider: 'openai',
			model: 'gpt-4o',
			capabilities: { uploadImage: false },
		}), false);
		assert.strictEqual(knoxGuiModelSupportsWebSearch({
			title: 'search',
			supportedParameters: ['web_search'],
		}), true);
		assert.strictEqual(knoxGuiModelSupportsWebSearch({
			title: 'no',
			capabilities: { webSearch: false },
		}), false);
		assert.strictEqual(knoxGuiModelSupportsTools({ title: 'chat', provider: 'knoxchat' }), false);
		assert.strictEqual(knoxGuiModelToolsSupportKnown({ title: 'chat', provider: 'knoxchat' }), undefined);
		assert.strictEqual(knoxGuiResolveToolsSupported(undefined, true), true);
		assert.strictEqual(knoxGuiResolveToolsSupported(false, true), false);
		assert.strictEqual(knoxGuiModelSupportsTools({ title: 'chat', capabilities: { tools: false } }), false);
		assert.strictEqual(knoxGuiModelSupportsTools({ title: 'chat', capabilities: { tools: true } }), true);
		assert.strictEqual(knoxGuiModelSupportsTools({ title: 'chat', supportedParameters: ['tool_choice'] }), true);
		const effort = knoxGuiReasoningEffortConfig({
			title: 'Grok',
			supportedParameters: ['reasoning_effort'],
		});
		assert.ok(effort?.allowed.includes('medium'));
		assert.strictEqual(knoxGuiResolveReasoningEffort({
			title: 'Grok',
			supportedParameters: ['reasoning_effort'],
		}, { Grok: 'high' }), 'high');
		assert.strictEqual(knoxGuiModelSelectTitle({ title: 'SpaceXAI: Grok 4.7' }), 'SpaceXAI: Grok 4.7');
		assert.strictEqual(knoxGuiNextModelTitle([
			{ title: 'a' },
			{ title: 'b' },
		], 'a', 1), 'b');
		assert.deepStrictEqual(effort?.allowed, [...DEFAULT_REASONING_EFFORT_ALLOWED]);
		assert.strictEqual(effort?.default, DEFAULT_REASONING_EFFORT);
		assert.strictEqual(knoxGuiReasoningEffortConfig({ title: 'plain' }), null);
		assert.strictEqual(knoxGuiReasoningEffortConfig({
			title: 'Grok',
			supportedParameters: ['reasoningEffort'],
		})?.allowed.includes('xhigh'), true);
		assert.strictEqual(knoxGuiResolveReasoningEffort({
			title: 'Grok',
			supportedParameters: ['reasoning_effort'],
		}), DEFAULT_REASONING_EFFORT);
		assert.strictEqual(knoxGuiResolveReasoningEffort({
			title: 'Grok',
			supportedParameters: ['reasoning_effort'],
		}, {}, 'max'), 'max');
		assert.strictEqual(knoxGuiModelSupportsImages({
			title: 'vision',
			provider: 'openai',
			model: 'gpt-4o',
			capabilities: { images: true },
		}), true);
		assert.strictEqual(knoxGuiModelSupportsImages({
			title: 'local llama',
			provider: 'ollama',
			model: 'llama3',
		}), false);
		assert.strictEqual(knoxGuiNextModelTitle([
			{ title: 'a' },
			{ title: 'b' },
		], 'b', 1), 'a');
		assert.strictEqual(nextPermissionMode('acceptEdits'), 'fullAuto');
		const merged = mergeGitChangedWithDiffs(
			[{ filename: 'a.ts', filepath: 'src/a.ts', displayPath: 'src/a.ts', uri: 'src/a.ts', additions: 0, deletions: 0, fileType: 'TS', isBinary: false, status: 'modified' }],
			[{ filename: 'a.ts', filepath: 'src/a.ts', displayPath: 'src/a.ts', uri: 'src/a.ts', additions: 4, deletions: 2, fileType: 'TS', isBinary: false, status: 'modified' }],
		);
		assert.deepStrictEqual({ additions: merged[0].additions, deletions: merged[0].deletions }, { additions: 4, deletions: 2 });
		knoxGuiResetModelCatalogForTests();
		knoxGuiSeedModelCatalog(knoxGuiParseModelCatalog([{
			id: 'z-ai/glm-5.3-flash',
			architecture: { input_modalities: ['text', 'image'] },
			supported_parameters: ['reasoning_effort'],
			reasoning: { supported_efforts: ['minimal', 'low', 'medium', 'high'], default_effort: 'minimal' },
		}]));
		assert.strictEqual(knoxGuiModelSupportsImages({
			title: 'Z.ai: GLM 5.3 Flash',
			provider: 'knoxchat',
			model: 'z-ai/glm-5.3-flash',
		}), true);
		assert.deepStrictEqual(knoxGuiReasoningEffortConfig({
			title: 'Z.ai: GLM 5.3 Flash',
			provider: 'knoxchat',
			model: 'z-ai/glm-5.3-flash',
		})?.allowed, ['minimal', 'low', 'medium', 'high']);
		assert.strictEqual(knoxGuiResolveReasoningEffort({
			title: 'Z.ai: GLM 5.3 Flash',
			provider: 'knoxchat',
			model: 'z-ai/glm-5.3-flash',
		}), 'minimal');
		assert.deepStrictEqual(knoxGuiReasoningEffortConfig({
			title: 'Claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4.6',
			supportedParameters: ['reasoning_effort'],
		})?.allowed, ['low', 'medium', 'high']);
		assert.ok(knoxGuiGetReasoningModelKeys({ title: 'Claude', provider: 'anthropic', model: 'claude-sonnet-4.6' }).includes('anthropic/claude-sonnet-4.6'));
		knoxGuiResetModelCatalogForTests();
	});

	test('KN-371 knoxGuiModelSupportsTools uses /v1/models catalog not provider name', () => {
		knoxGuiResetModelCatalogForTests();
		try {
			assert.strictEqual(knoxGuiModelSupportsToolsFromSupportedParameters(['temperature']), false);
			assert.strictEqual(knoxGuiModelSupportsToolsFromSupportedParameters(['tools']), true);
			assert.strictEqual(knoxGuiModelSupportsToolsFromSupportedParameters(['tool_choice']), true);
			const grok = { title: 'SpaceXAI: Grok 4.7', provider: 'knoxchat', model: 'spacexai/grok-4.7' };
			assert.strictEqual(knoxGuiModelSupportsTools(grok), false);
			assert.strictEqual(knoxGuiModelToolsSupportKnown(grok), undefined);
			assert.deepStrictEqual(knoxGuiParseModelCatalog([
				{ id: 'spacexai/grok-4.7', root: 'grok-4.7', name: 'Grok', supported_parameters: ['tools', 'reasoning_effort'] },
				{ id: 'skip-me' },
				{ id: 'chat-only', supportedParameters: ['temperature'] },
			]).map(entry => ({ id: entry.id, root: entry.root, tools: knoxGuiModelSupportsToolsFromSupportedParameters(entry.supportedParameters) })), [
				{ id: 'spacexai/grok-4.7', root: 'grok-4.7', tools: true },
				{ id: 'skip-me', root: undefined, tools: false },
				{ id: 'chat-only', root: undefined, tools: false },
			]);
			knoxGuiSeedModelCatalog(knoxGuiParseModelCatalog([
				{ id: 'spacexai/grok-4.7', root: 'grok-4.7', supported_parameters: ['tools'] },
				{ id: 'chat-only', supported_parameters: ['temperature'] },
			]));
			assert.strictEqual(knoxGuiFindCatalogModel('grok-4.7')?.id, 'spacexai/grok-4.7');
			assert.strictEqual(knoxGuiModelSupportsTools(grok), true);
			assert.strictEqual(knoxGuiModelSupportsTools({
				title: 'chat-only',
				provider: 'knoxchat',
				model: 'chat-only',
				capabilities: { tools: true },
			}), false);
			assert.strictEqual(knoxGuiModelSupportsTools({
				title: 'GPT-4o',
				provider: 'openai',
				model: 'gpt-4o',
			}), false);
			assert.strictEqual(knoxGuiModelSupportsTools({
				title: 'Claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4',
				capabilities: { tools: true },
			}), true);
		} finally {
			knoxGuiResetModelCatalogForTests();
		}
	});

	test('S-14 stats page does not fetch local token tables', () => {
		assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes('stats/getTokensPerDay'));
		assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes('stats/getTokensPerModel'));
	});

	test('KN-373 tool-card helpers match native GUI ToolCallDiv', () => {
		assert.strictEqual(toolDisplayKind('builtin_run_terminal_command'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_build'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_await_shell'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_pty_start'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_qemu'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_debug'), 'terminal');
		assert.strictEqual(toolDisplayKind('builtin_exact_search'), 'search');
		assert.strictEqual(toolDisplayKind('builtin_view_repo_map'), 'repo-map');
		assert.strictEqual(toolDisplayKind('builtin_ask_user'), 'ask-user');
		assert.strictEqual(toolDisplayKind('builtin_task'), 'subagent');
		assert.strictEqual(toolDisplayKind('builtin_create_new_file'), 'create-file');
		assert.strictEqual(displayBuildCommand({ action: 'clippy', extraArgs: '--all-targets' }), 'cargo clippy --all-targets');
		assert.strictEqual(displayBuildCommand({ command: 'make -j8' }), 'make -j8');
		assert.strictEqual(terminalCommandForTool('builtin_build', { action: 'check' }, key => key), 'cargo check');
		assert.strictEqual(takeTerminalTail('a\nb\nc\nd', 2).tail, 'c\nd');
		assert.deepStrictEqual(parseAskUserQuestionsForGui([
			{ prompt: 'Pick one', options: ['alpha', 'beta'] },
			{ id: 'scope', prompt: 'Scope?', options: ['auth'] },
		]).map(q => q.id), ['q1', 'scope']);
		assert.strictEqual(isAskUserAnswered(''), false);
		assert.strictEqual(isAskUserAnswered('alpha'), true);
		assert.strictEqual(formatAskUserDisplayAnswer({ q1: 'a\u0001b', 'q1::freeform': 'other' }, 'q1'), 'a, b, other');
		assert.strictEqual(formatAskUserDisplayAnswer({}, 'q1', 'submitted'), 'submitted');
		assert.strictEqual(displayLanguageForFile('src/main.ts'), 'typescript');
		assert.strictEqual(displayLanguageForFile('README.md'), 'text');
		assert.strictEqual(displayLanguageForFile('a.ts', 'patch'), 'diff');
		const tree = repoMapToTreeColorized('src/a.ts\nsrc/b.py');
		assert.ok(tree.plain.includes('a.ts'));
		assert.ok(tree.colorized.includes(repoMapFileAnsiColor('a.ts')));
		assert.ok(tree.colorized.includes(repoMapFileAnsiColor('b.py')));
		assert.strictEqual(repoMapFileAnsiColor('a.ts'), '\x1b[38;2;86;182;194m');
	});

	test('KN-374 composer helpers match KN-300 @ defaults and KN-304 slash builtins', () => {
		assert.deepStrictEqual([...DEFAULT_MENTION_PROVIDER_TITLES], ['file', 'diff', 'problems', 'repo-map', 'terminal', 'memory']);
		assert.deepStrictEqual(DEFAULT_MENTION_PROVIDERS.map(provider => provider.title), [...DEFAULT_MENTION_PROVIDER_TITLES]);
		assert.strictEqual(DEFAULT_MENTION_PROVIDERS.find(provider => provider.title === 'file')?.type, 'submenu');
		assert.strictEqual(DEFAULT_MENTION_PROVIDERS.find(provider => provider.title === 'memory')?.type, 'query');
		assert.deepStrictEqual(mergeContextProvidersWithDefaults([{ title: 'clipboard', displayTitle: 'Clipboard' }]).map(provider => provider.title), [
			'file', 'diff', 'problems', 'repo-map', 'terminal', 'memory', 'clipboard',
		]);
		assert.deepStrictEqual(mergeSlashCommandsWithBuiltins([{ name: 'ship', description: 'Ship it', prompt: 'Ship {{{ input }}}' }]).map(cmd => cmd.name), [
			'ship', ...SLASH_BUILTINS.map(cmd => cmd.name),
		]);
		assert.strictEqual(resolveComposerSlashCommand('/commit', [])?.name, 'commit');
		assert.strictEqual(resolveComposerSlashCommand('ship', [{ name: 'ship', description: 'Ship', prompt: 'go' }])?.prompt, 'go');
		assert.strictEqual(isDroppedImageFile({ type: 'image/webp', name: 'shot.webp' }), true);
		assert.deepStrictEqual(parseUriList('file:///tmp/a.ts\n# skip\n/tmp/b.ts'), ['file:///tmp/a.ts', '/tmp/b.ts']);
		assert.deepStrictEqual(knoxGuiCodeToEditTitle({ filepath: 'src/app.ts', range: { start: { line: 1 }, end: { line: 4 } } }), { name: 'app.ts', kind: 'range', start: 2, end: 5 });
	});

	test('KN-375 overlay helpers match KN-320–330 restore preview, word diffs, analysis, dashboard, and branches', () => {
		assert.strictEqual(CHECKPOINT_DASHBOARD_HISTORY_DAYS, 30);
		assert.strictEqual(CHECKPOINT_ANALYSIS_GROUP_LIMIT, 50);
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('previewRestore'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('computeCheckpointDiff'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('restoreCheckpointFiles'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('getPerformanceDashboard'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('analyzeCheckpoint'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('suggestCheckpointGroups'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('createCheckpointBranch'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('switchCheckpointBranch'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('mergeCheckpointBranches'));
		const preview = parseRestorePreview({
			success: true,
			preview: {
				checkpointId: 'cp1',
				description: 'head',
				modified: 1,
				added: 0,
				deleted: 0,
				writePaths: ['a.ts'],
				extraPaths: [],
				skippedFiles: [],
				files: [{ relativePath: 'a.ts', action: 'overwrite', additions: 1, deletions: 1, hunkCount: 1 }],
			},
		});
		assert.strictEqual(preview?.checkpointId, 'cp1');
		assert.strictEqual(preview?.writePaths[0], 'a.ts');
		const hunkAlt = hunkWordAltRanges([
			{ type: 'removed', oldLineNum: 1, newLineNum: null, content: 'const foo = 1' },
			{ type: 'added', oldLineNum: null, newLineNum: 1, content: 'const bar = 1' },
		]);
		assert.ok(hunkAlt[0]?.some(range => 'const foo = 1'.slice(range.start, range.end).includes('foo')));
		assert.ok(hunkAlt[1]?.some(range => 'const bar = 1'.slice(range.start, range.end).includes('bar')));
		const dashboard = parsePerformanceDashboard({
			success: true,
			data: {
				summary: { totalCheckpointsCreated: 4, totalRestorations: 1, restorationSuccessRate: 100, avgCreationTimeMs: 12, totalAiSessions: 2, avgChangesPerSession: 3, totalRollbacks: 0 },
				currentStorage: { totalBytes: 2048, checkpointCount: 4 },
				storageHistory: [],
				creationFrequency: [{ bucket: '2026-09-26', count: 2 }],
				restorationEvents: [],
				aiSessionMetrics: [],
			},
		});
		assert.strictEqual(dashboard?.summary.totalCheckpointsCreated, 4);
		const analysis = parseCheckpointAnalysis({
			success: true,
			analysis: {
				checkpointId: 'cp1',
				generatedDescription: 'touched auth',
				riskAssessment: { level: 'Medium', score: 4, factors: [], recommendations: [] },
				impactAnalysis: { affectedFeatures: [], affectedLayers: ['src'], scope: 'Module' },
			},
		});
		assert.strictEqual(analysis?.riskAssessment.level, 'Medium');
		assert.deepStrictEqual(parseSuggestedCheckpointGroups({
			success: true,
			groups: [{ groupName: 'session abc', kind: 'session', rationale: 'same session', confidence: 0.9, checkpointIds: ['cp1'] }],
		}).map(group => group.groupName), ['session abc']);
	});

	test('KN-376 Memory panel helpers match KN-310–317 tabs, retrieval defaults, and brain/* surface', () => {
		assert.deepStrictEqual([...MEMORY_TAB_IDS], ['overview', 'memories', 'sessions', 'graph', 'settings']);
		assert.strictEqual(MEMORY_RETRIEVAL_THRESHOLD, 0.6);
		assert.strictEqual(MEMORY_RETRIEVAL_TOP_K, 20);
		assert.ok(MEMORY_SETTING_GROUPS.some(group => group.fields.some(field => field.key === 'retrieval_threshold')));
		assert.ok(MEMORY_SETTING_GROUPS.some(group => group.fields.some(field => field.key === 'retrieval_top_k')));
		assert.ok(MEMORY_SETTING_GROUPS.some(group => group.fields.some(field => field.key === 'ebbinghaus_lambda')));
		assert.ok(MEMORY_SETTING_GROUPS.some(group => group.fields.some(field => field.key === 'working_memory_max_slots')));
		for (const tab of MEMORY_TAB_IDS) {
			assert.ok(MEMORY_PANEL_TAB_BRAIN_MESSAGES[tab].length > 0, tab);
			for (const message of MEMORY_PANEL_TAB_BRAIN_MESSAGES[tab]) {
				assert.ok(KNOX_GUI_HOST_OUTBOUND.includes(message), message);
			}
		}
		const dashboard = parseMemoryDashboard({
			stats: {
				total_semantic: 4,
				total_episodic: 2,
				total_entities: 3,
				total_procedures: 1,
				total_tags: 5,
				total_collections: 2,
				tier_counts: { hot: 1, warm: 2, cold: 3 },
			},
			health: { status: 'healthy' },
			healthScore: { overall: 91, grade: 'A' },
		});
		assert.strictEqual(dashboard?.totalSemantic, 4);
		assert.strictEqual(dashboard?.totalTags, 5);
		assert.strictEqual(dashboard?.totalCollections, 2);
		const explore = parseExploreResult({
			center: { id: 1, name: 'Auth', entity_type: 'concept' },
			entities: [{ id: 1, name: 'Auth', entity_type: 'concept' }, { id: 2, name: 'JWT', entity_type: 'library' }],
			edges: [
				{ id: 10, source_entity_id: 1, target_entity_id: 2, relationship: 'uses', weight: 1 },
				{ id: 11, source_entity_id: 2, target_entity_id: 3, relationship: 'related', weight: 2 },
			],
			depth_reached: 2,
			entity_depths: { 1: 0, 2: 1, 3: 2 },
		});
		assert.strictEqual(explore?.centerName, 'Auth');
		assert.strictEqual(explore?.entityDepths?.['2'], 1);
		assert.strictEqual(memoryExploreEdgeDepth(explore!.edges[0], explore?.entityDepths), 1);
		assert.deepStrictEqual(sortMemoryExploreEdges(explore!.edges, explore?.entityDepths).map(edge => edge.id), [10, 11]);
	});

	test('NP-10 host userInput text is inserted at the caret, not appended', () => {
		const doc = inputDocFromPlainText('helloworld');
		const inserted = insertTextAtCaret(doc, { block: 0, offset: 3 }, 'X');
		assert.strictEqual(inputDocToPlainText(inserted.doc), 'helXloworld');
		assert.deepStrictEqual(inserted.caret, { block: 0, offset: 4 });
		assert.strictEqual(inputDocToPlainText(insertTextAtCaret(doc, undefined, 'X').doc), 'helloworldX');
		assert.strictEqual(inputDocToPlainText(insertTextAtCaret(doc, { block: 0, offset: 999 }, 'X').doc), 'helloworldX');
		assert.strictEqual(inputDocToPlainText(insertTextAtCaret([], undefined, 'X').doc), 'X');
	});

	test('GP-015–023 composer keys, history, mentions, and edit card match native GUI', () => {
		const key = (partial: Partial<{ key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing: boolean; keyCode: number }>) => ({
			key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...partial,
		});
		const ctx = (partial: Partial<{ suggestOpen: boolean; inSubmenu: boolean; isStreaming: boolean; caretAtStart: boolean; caretAtEnd: boolean; suggestSelected: number; suggestCount: number }>) => ({
			suggestOpen: false, inSubmenu: false, isStreaming: false, caretAtStart: true, caretAtEnd: true, suggestSelected: 0, suggestCount: 3, ...partial,
		});
		// NP-01: Enter that confirms an IME candidate must not submit / select a suggestion.
		assert.strictEqual(knoxGuiComposerKeyAction(key({ isComposing: true }), ctx({})).type, 'ignore');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ keyCode: 229 }), ctx({})).type, 'ignore');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ isComposing: true }), ctx({ suggestOpen: true })).type, 'ignore');
		assert.deepStrictEqual(knoxGuiComposerKeyAction(key({}), ctx({})), { type: 'submit', altKey: false });
		assert.deepStrictEqual(knoxGuiComposerKeyAction(key({ shiftKey: true }), ctx({})), { type: 'newline' });
		assert.deepStrictEqual(knoxGuiComposerKeyAction(key({ altKey: true }), ctx({})), { type: 'submit', altKey: true });
		assert.deepStrictEqual(knoxGuiComposerKeyAction(key({ metaKey: true }), ctx({ suggestOpen: true })), { type: 'submit', altKey: false });
		assert.deepStrictEqual(knoxGuiComposerKeyAction(key({ ctrlKey: true }), ctx({})), { type: 'submit', altKey: false });
		assert.strictEqual(knoxGuiComposerKeyAction(key({}), ctx({ suggestOpen: true })).type, 'suggest');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'ArrowLeft' }), ctx({ suggestOpen: true, inSubmenu: true })).type, 'exit-submenu');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'Backspace', metaKey: true }), ctx({ isStreaming: true })).type, 'block-backspace');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'Backspace', metaKey: true }), ctx({ isStreaming: false })).type, 'ignore');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'ArrowUp' }), ctx({ caretAtStart: true })).type, 'history-prev');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'ArrowUp' }), ctx({ caretAtStart: false })).type, 'ignore');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'ArrowDown' }), ctx({ caretAtEnd: true })).type, 'history-next');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ metaKey: true, shiftKey: true }), ctx({})).type, 'accept-diffs');
		assert.strictEqual(knoxGuiComposerKeyAction(key({ key: 'Backspace', metaKey: true, shiftKey: true }), ctx({})).type, 'reject-diffs');

		let history = createComposerInputHistory();
		history = composerInputHistoryAdd(history, inputDocFromPlainText('first'));
		history = composerInputHistoryAdd(history, inputDocFromPlainText('second'));
		const prev = composerInputHistoryPrev(history, inputDocFromPlainText('draft'));
		assert.strictEqual(inputDocToPlainText(prev!.doc), 'second');
		const older = composerInputHistoryPrev(prev!.history, prev!.doc);
		assert.strictEqual(inputDocToPlainText(older!.doc), 'first');
		const back = composerInputHistoryNext(older!.history);
		assert.strictEqual(inputDocToPlainText(back!.doc), 'second');
		const draft = composerInputHistoryNext(back!.history);
		assert.strictEqual(inputDocToPlainText(draft!.doc), 'draft');
		assert.strictEqual(MAX_COMPOSER_INPUT_HISTORY, 100);

		assert.strictEqual(isDroppedImageFile({ type: 'image/png', name: 'a.png' }), true);
		assert.strictEqual(isDroppedImageFile({ type: 'text/plain', name: 'a.ts' }), false);
		assert.deepStrictEqual(parseUriList('file:///tmp/a.ts\n# comment\n/tmp/b.ts'), ['file:///tmp/a.ts', '/tmp/b.ts']);
		const mentioned = appendMentionChip(emptyInputDoc(), { id: 'src/a.ts', label: 'a.ts', itemType: 'file', query: 'src/a.ts' });
		assert.strictEqual(extractMentionsFromDoc(mentioned)[0].id, 'src/a.ts');
		const withCode = insertCodeBlock(emptyInputDoc(), { type: 'codeBlock', filepath: 'a.ts', code: 'const x = 1;', itemName: 'a.ts' });
		assert.strictEqual(removeCodeBlockAt(withCode, 0).some(block => block.type === 'codeBlock'), false);

		assert.deepStrictEqual(mentionIndexIsTruncated([truncatedMentionMarker(40)]), { truncated: true, count: 40 });
		assert.deepStrictEqual(knoxGuiCodeToEditTitle({ filepath: 'src/app.ts', range: { start: { line: 2 }, end: { line: 8 } } }), { name: 'app.ts', kind: 'range', start: 3, end: 9 });
		assert.strictEqual(knoxGuiCodeToEditTitle({ filepath: 'src/app.ts', range: { start: { line: 4 }, end: { line: 4 } } }).kind, 'insert');
		assert.strictEqual(knoxGuiEditSendKey({ mode: 'chat' }), 'send');
		assert.strictEqual(knoxGuiEditSendKey({ mode: 'edit' }), 'edit');
		assert.strictEqual(knoxGuiEditSendKey({ mode: 'edit', applyStates: [{ status: 'done' }] }), 'retry');
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('focusEditor'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('edit/exit'));
		assert.deepStrictEqual(SLASH_BUILTINS.map(cmd => cmd.name), [
			'autonomous', 'issue', 'share', 'cmd', 'http', 'commit', 'review', 'pr', 'changelog', 'skills',
		]);
	});

	test('GP-025 historical user rows restore input docs and resubmit truncates', () => {
		const item: IKnoxGuiHistoryItem = { id: 'u1', role: 'user', content: 'hello there', inputDoc: inputDocFromPlainText('hello there') };
		assert.strictEqual(inputDocToPlainText(historyUserInputDoc(item)), 'hello there');
		assert.strictEqual(inputDocToPlainText(historyUserInputDoc({ id: 'u2', role: 'user', content: 'plain' })), 'plain');
		assert.strictEqual(knoxGuiShowsCodeToEditOnHistoryUser('edit', 0), true);
		assert.strictEqual(knoxGuiShowsCodeToEditOnHistoryUser('agent', 0), false);
		assert.strictEqual(knoxGuiShowsCodeToEditOnEmptyComposer('edit', 0), true);
		assert.strictEqual(knoxGuiShowsCodeToEditOnEmptyComposer('edit', 2), false);
		const next = resubmitHistory(
			[{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }],
			0,
			{ id: 'u1-new' },
		);
		assert.deepStrictEqual(next.map(row => row.id), ['u1-new']);
		assert.strictEqual(knoxGuiShouldBlockSubmit({
			isStreaming: true,
			input: 'retry',
			images: [],
			mode: 'agent',
			codeToEdit: [],
			history: [],
			resubmitting: true,
		}), false);
	});

	test('GP-026 thinking indicator and GP-033 stream error kinds', () => {
		assert.strictEqual(shouldShowThinkingIndicator({ isStreaming: true, isLast: true, hasContent: false, hasReasoning: false }), true);
		assert.strictEqual(shouldShowThinkingIndicator({ isStreaming: true, isLast: true, hasContent: true, hasReasoning: false }), false);
		assert.strictEqual(shouldShowThinkingIndicator({ isStreaming: false, isLast: true, hasContent: false, hasReasoning: false }), false);
		assert.strictEqual(parseStreamError('HTTP 404 missing').kind, 'not-found');
	});

	test('GP-050 policy editor, GP-073 heartbeat, GP-072 checkpointRestored', () => {
		assert.strictEqual(KNOX_GUI_HEARTBEAT_MS, 5000);
		const notice = formatRestoreNotice({
			checkpointId: 'cp-1',
			description: 'before edit',
			restoredFiles: ['a.ts'],
			memoryRewound: false,
		});
		assert.ok(notice.includes('Workspace restore'));
		assert.ok(notice.includes('cp-1'));
		assert.ok(notice.includes('a.ts'));
		const parsed = parseCheckpointRestored({
			sessionId: 's1',
			checkpointId: 'cp-2',
			restoredFiles: ['b.ts'],
			memoryRewound: true,
			memoryMessage: 'rewound',
		});
		assert.strictEqual(parsed?.sessionId, 's1');
		assert.ok(parsed?.notice.includes('rewound'));
		assert.strictEqual(parseCheckpointRestored({}), undefined);
	});

	test('KN-346 Cmd/Ctrl+I edit mode: range routing, merge, and status transitions', () => {
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('focusEdit'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('focusEditWithoutClear'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('addCodeToEdit'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('exitEditMode'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('setEditStatus'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('edit/sendPrompt'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('edit/exit'));

		const ranged = { filepath: 'a.ts', contents: 'x', range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } } };
		const whole = { filepath: 'b.ts', contents: 'export {}', range: undefined };
		assert.strictEqual(shouldSendEditPrompt({ mode: 'edit', codeToEdit: [ranged] }), true);
		assert.strictEqual(shouldSendEditPrompt({ mode: 'edit', codeToEdit: [whole] }), false);
		assert.strictEqual(isSingleRangeEditOrInsertion({ mode: 'edit', codeToEdit: [] }), true);
		assert.strictEqual(knoxGuiNextEditStatus('not-started', 'streaming'), 'streaming');
		assert.strictEqual(knoxGuiNextEditStatus('streaming', 'accepting'), 'accepting');
		assert.strictEqual(knoxGuiNextEditStatus('not-started', 'done'), undefined);
		assert.deepStrictEqual(knoxGuiResetEditModeState(), { editStatus: 'not-started', editPreviousInputs: [], editFileAfterEdit: undefined });
		assert.strictEqual(mergeCodeToEdit([ranged], ranged).length, 1);
		assert.strictEqual(mergeCodeToEdit([ranged], whole).length, 2);
		assert.strictEqual(parseCodeToEdit({ filepath: 'src/a.ts', contents: 'ok', range: { start: { line: 1, character: 0 }, end: { line: 3, character: 2 } } })?.range?.start.line, 1);
		assert.ok(knoxGuiMultifileEditPrompt([whole]).includes('b.ts'));
	});

	test('KN-377 find-in-chat, session tabs, fatal banner, and composer accept/reject-all', () => {
		assert.strictEqual(knoxGuiShowsSessionTabs({ showSessionTabs: false, tabs: [{ id: 'a', title: 'Chat 1' }, { id: 'b', title: 'Chat 2' }] }), false);
		assert.strictEqual(knoxGuiShowsSessionTabs({ showSessionTabs: true, tabs: [{ id: 'a', title: 'Chat 1' }] }), false);
		assert.strictEqual(knoxGuiShowsSessionTabs({
			showSessionTabs: true,
			tabs: [{ id: 'a', title: 'Chat 1' }, { id: 'b', title: 'Chat 2' }],
		}), true);
		assert.strictEqual(knoxGuiShowsSessionTabs({
			showSessionTabs: true,
			tabs: [{ id: 'a', title: 'Chat 1' }, { id: 'b', title: 'Chat 2' }],
			lockedRoute: KnoxGuiRoute.Memory,
			route: KnoxGuiRoute.Memory,
		}), false);
		assert.strictEqual(knoxGuiShowsFatalBanner({ fatalConfig: true, route: KnoxGuiRoute.Chat }), true);
		assert.strictEqual(knoxGuiShowsFatalBanner({ fatalConfig: true, route: KnoxGuiRoute.ConfigError }), false);
		assert.strictEqual(knoxGuiShowsFatalBanner({ fatalConfig: false, route: KnoxGuiRoute.Chat }), false);
		assert.strictEqual(knoxGuiShowsComposerAcceptReject(true, true), true);
		assert.strictEqual(knoxGuiShowsComposerAcceptReject(true, false), false);
		assert.strictEqual(knoxGuiShowsBatchDiffEntry(true, false), true);
		assert.ok(KNOX_GUI_COMPOSER_SLOTS.includes('acceptRejectAll'));
		assert.deepStrictEqual(knoxGuiAcceptRejectLabelKeys(true), { reject: 'reject', accept: 'accept' });
		assert.deepStrictEqual(findMatchingHistoryIndexes([
			{ id: 'c', role: 'user', content: 'ask', contextItems: [{ name: 'auth.ts', content: 'httpOnly cookie' }] },
		], 'auth.ts', { caseSensitive: false, regex: false }), [0]);
	});

	test('KN-378 chrome outbound has no unused leftovers; brain/* and apply/restore cover the dropped names', () => {
		assert.deepStrictEqual([...KNOX_GUI_HOST_OUTBOUND_UNUSED_IN_CHROME], []);
		for (const dropped of ['config/reload', 'overwriteFile', 'memory/create', 'memory/search', 'memory/delete', 'memory/list', 'memory/cleanup', 'brain/forgetMemories', 'brain/stats'] as const) {
			assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes(dropped), dropped);
		}
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/getSerializedProfileInfo'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('configUpdate'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('applyToFile'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('restoreCheckpoint'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/searchMemories'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/deleteMemory'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/deleteMemories'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('memory/buildContext'));
		for (const tab of MEMORY_TAB_IDS) {
			for (const message of MEMORY_PANEL_TAB_BRAIN_MESSAGES[tab]) {
				assert.ok(KNOX_GUI_HOST_OUTBOUND.includes(message), message);
			}
		}
	});

	test('KP remaining helpers: milestone, scrollbar, find, blocked submit, add-model, export, theme, empty-ack', () => {
		assert.strictEqual(KNOX_GUI_MAIN_TEXT_ENTRY_DIALOG_AT, 300);
		assert.deepStrictEqual(knoxGuiNextMainTextEntry(299, false), { count: 300, shown: true, open: true });
		assert.deepStrictEqual(knoxGuiNextMainTextEntry(300, true), { count: 300, shown: true, open: false });
		assert.deepStrictEqual(knoxGuiNextMainTextEntry(0, true), { count: 0, shown: true, open: false });
		assert.strictEqual(knoxGuiParseMainTextEntryCount('299'), 299);
		assert.strictEqual(knoxGuiParseMainTextEntryCount('nope'), 0);

		assert.strictEqual(knoxGuiShowsChatScrollbar(false, 4999), false);
		assert.strictEqual(knoxGuiShowsChatScrollbar(false, 5001), true);
		assert.strictEqual(knoxGuiShowsChatScrollbar(true, 100), true);
		assert.strictEqual(KNOX_GUI_CHAT_SCROLLBAR_MIN_HEIGHT, 5000);

		assert.strictEqual(KNOX_GUI_FIND_DEBOUNCE_MS, 300);
		assert.strictEqual(KNOX_GUI_FIND_RESIZE_DEBOUNCE_MS, 200);
		assert.strictEqual(knoxGuiFindRegexInvalid('(', true), true);
		assert.strictEqual(knoxGuiFindRegexInvalid('auth', true), false);
		assert.strictEqual(knoxGuiFindRegexInvalid('(', false), false);
		assert.deepStrictEqual(findMatchingHistoryIndexes([{ id: 'c', role: 'user', content: 'ask' }], '(', { caseSensitive: false, regex: true }), []);

		assert.strictEqual(knoxGuiPendingToolBlocksSubmit({
			isStreaming: false,
			history: [{ toolCalls: [{ id: 't', name: 'builtin_edit_file', arguments: '{}', status: 'generated' }] }],
		}), true);
		assert.strictEqual(knoxGuiPendingToolBlocksSubmit({
			isStreaming: true,
			history: [{ toolCalls: [{ id: 't', name: 'builtin_edit_file', arguments: '{}', status: 'generated' }] }],
		}), false);
		assert.strictEqual(knoxGuiShouldBlockSubmit({
			mode: 'chat',
			input: 'hi',
			images: [],
			codeToEdit: [],
			isStreaming: false,
			resubmitting: false,
			history: [{ toolCalls: [{ id: 't', name: 'builtin_edit_file', arguments: '{}', status: 'generated' }] }],
		}), true);

		assert.deepStrictEqual(addModelPackagesByProvider().map(group => group.providerId), ['openai', 'anthropic']);
		assert.deepStrictEqual(addModelBrowseGroups().map(group => group.title), ['Open AI', 'Anthropic']);
		assert.deepStrictEqual(addModelBrowseGroups().flatMap(group => group.packages.map(pack => pack.params.model)), ['gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-5-haiku-latest']);
		assert.ok(addModelProviderById('openai')?.packages.some(pack => pack.params.model === 'AUTODETECT'));
		assert.strictEqual(addModelProviderById('openai')?.packages.find(pack => pack.params.model === 'gpt-3.5-turbo')?.title, 'GPT-3.5-Turbo');
		assert.strictEqual(addModelProviderById('openai')?.packages.find(pack => pack.params.model === 'gpt-3.5-turbo')?.params.contextLength, 8096);
		assert.strictEqual(addModelProviderById('openai')?.packages.find(pack => pack.params.model === 'AUTODETECT')?.title, 'Autodetect');
		assert.strictEqual(addModelProviderById('openai')?.packages.find(pack => pack.params.model === 'AUTODETECT')?.params.title, 'OpenAI');
		assert.strictEqual(addModelProviderById('anthropic')?.refPage, 'anthropicllm');
		assert.strictEqual(addModelProviderById('anthropic')?.apiKeyUrl, 'https://console.anthropic.com/account/keys');
		assert.strictEqual(addModelProviderById('anthropic')?.packages.find(pack => pack.title === 'Claude 3 Opus')?.params.model, 'claude-3-opus-20240229');
		assert.ok(addModelProviderById('anthropic')?.packages.some(pack => pack.title.includes('Sonnet')));
		assert.strictEqual(addModelRequiredSatisfied(addModelProviderById('openai')!, {}, false), false);
		assert.strictEqual(addModelRequiredSatisfied(addModelProviderById('openai')!, { apiKey: 'sk-test' }, false), true);

		const en = formatSessionExportMarkdown({ title: 'Ship', history: [] });
		assert.ok(en.includes('Knox session transcript'));
		assert.ok(en.includes('No messages in this session.'));
		const zh = formatSessionExportMarkdown({ title: 'Ship', history: [{ role: 'user', content: 'hi' }] }, new Date('2026-01-02T00:00:00.000Z'), key => ({
			knoxSessionTranscript: 'Knox 会话记录',
			exported: '已导出',
			sessionLabel: '会话',
			userRole: '用户',
			assistantRole: '助手',
			noMessagesInSession: '此会话没有消息。',
		}[key] ?? key));
		assert.ok(zh.includes('Knox 会话记录'));
		assert.ok(zh.includes('用户'));
		assert.ok(!zh.includes('Knox session transcript'));

		assert.strictEqual(knoxGuiHljsTokenColor({ '.hljs-string': '#aabbcc' }, ['.hljs-string'], '#fff'), '#aabbcc');
		assert.strictEqual(knoxGuiHljsTokenColor(undefined, ['.hljs-string'], '#123'), '#123');

		assert.deepStrictEqual([...KNOX_GUI_HOST_INBOUND_EMPTY_ACK], ['didChangeIdeSettings', 'incrementFtc']);
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('addApiKey'), 'NP-12 quota "Add API key" opens Add Model instead of being empty-acked');
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/refreshProfiles'));
		assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes('brain/stats'));
		assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes('brain/forgetMemories'));
		assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes('knox/reloadWebview'));

		assert.deepStrictEqual(treeStatsFromPlain('src\nsrc/app.ts'), { files: 1, folders: 1, total: 2 });
		assert.strictEqual(detectSearchLanguage('App.vue'), 'vue');
		assert.strictEqual(detectSearchLanguage('Dockerfile'), 'dockerfile');
		assert.strictEqual(detectSearchLanguage('styles.less'), 'less');
		assert.strictEqual(detectSearchLanguage('Widget.svelte'), 'svelte');
	});
});
