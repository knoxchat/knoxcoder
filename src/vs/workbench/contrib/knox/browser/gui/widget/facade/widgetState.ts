/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { AUTO_DISPLAY_START } from '../../../../common/knoxGuiChat.js';
import { createComposerInputHistory, createComposerUndo, IKnoxGuiComposerInputHistory, IKnoxGuiComposerUndo, IKnoxGuiDocCaret, IKnoxGuiInputBlock } from '../../../../common/knoxGuiInput.js';
import type { IKnoxGuiCheckpointDetailsView } from '../../../../common/knoxGuiCheckpoints.js';
import { KnoxGuiOverlay } from '../../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState, IKnoxGuiSuggestItem, KnoxModelRole } from '../../../../common/knoxGuiState.js';
import { IKnoxGuiTpsClock, resetTpsClock } from '../../../../common/knoxGuiTranscript.js';
import type { IKnoxGuiStreamCacheBlock } from '../chat.js';

/**
 * Mutable UI state of `KnoxGuiWidget` (scroll, composer, panels, memory, checkpoints, timers).
 * Kept in one base class so the view modules keep reading and writing `widget.<field>` directly.
 * Fields the constructor assigns (`root`, `listenerStore`, `themeStyleEl`) live on the widget itself.
 */
export abstract class KnoxGuiWidgetState extends Disposable {
	readonly renderStore = this._register(new DisposableStore());
	readonly filterStore = this._register(new DisposableStore());
	readonly checkpointGraphStore = this._register(new DisposableStore());
	checkpointGraphMount: HTMLElement | undefined;
	checkpointGraphRenderKey: string | undefined;
	lastState: IKnoxGuiState | undefined;
	editorEl: HTMLElement | undefined;
	suggestEl: HTMLElement | undefined;
	inputWrap: HTMLElement | undefined;
	imagePreviewEl: HTMLElement | undefined;
	bodyEl: HTMLElement | undefined;
	floatingHostEl: HTMLElement | undefined;
	scrollTopBtn: HTMLButtonElement | undefined;
	scrollBottomBtn: HTMLButtonElement | undefined;
	findInput: HTMLInputElement | undefined;
	promptNameInput: HTMLInputElement | undefined;
	autoScrollEnabled = true;
	savedScrollTop = 0;
	programmaticScroll = false;
	lastScrollTop = 0;
	lastScrollHeight = 0;
	stickScheduled = false;
	streamEndStickHandle: ReturnType<typeof setTimeout> | undefined;
	expandedStart = AUTO_DISPLAY_START;
	displayStart = 0;
	pendingRestoreHeight: number | null = null;
	lastSessionId = '';
	loadingEarlier = false;
	agentMeterOpen = false;
	meterFollowEnabled = true;
	refocusComposerAfterStream = false;
	meterProgrammaticScroll = false;
	meterTpsClock: IKnoxGuiTpsClock = resetTpsClock(0, '');
	meterClockTimer: ReturnType<typeof setInterval> | undefined;
	meterElapsedEl: HTMLElement | undefined;
	meterTpsEl: HTMLElement | undefined;
	meterStartedAt: number | undefined;
	historyLoadingStartedAt: number | undefined;
	meterGenerating = false;
	meterOutputTokens = 0;
	meterTurnKey = '';
	meterLastScrollTop = 0;
	readonly activityExpanded = new Set<number>();
	readonly fenceCollapsed = new Set<string>();
	readonly fenceExpanded = new Map<string, boolean>();
	readonly codeGenerating = new Set<string>();
	readonly codeUserScrolled = new Set<string>();
	readonly codePinned = new Set<string>();
	readonly codeWindowShift = new Map<string, number>();
	readonly codeScrollTop = new Map<string, number>();
	readonly codeScrollAdjust = new Map<string, number>();
	readonly failedRows = new Set<string>();
	readonly checkpointFetched = new Set<string>();
	readonly toolArgsOpen = new Set<string>();
	readonly toolBodyCollapsed = new Set<string>();
	/** K-041: cards the user opened although they collapse by default (long read/search results). */
	readonly toolBodyExpanded = new Set<string>();
	readonly toolCardExpanded = new Set<string>();
	readonly toolCardTab = new Map<string, string>();
	readonly askUserStep = new Map<string, number>();
	readonly askUserDrafts = new Map<string, Record<string, string>>();
	readonly termUserScrolled = new Set<string>();
	readonly termScrollTop = new Map<string, number>();
	readonly termPrevLen = new Map<string, number>();
	/** Terminal cards that already played their entrance animation (survives full transcript rebuilds). */
	readonly termEntered = new Set<string>();
	readonly termCopiedUntil = new Map<string, number>();
	chatListFailed = false;
	gitDiffExpanded = true;
	gitDiffExpandedPinned = false;
	compactionOpen = false;
	reviewOpen = true;
	taskPlanOpen = true;
	/** Composer editor + toolbar hidden behind a slim dock; persisted per profile. */
	composerCollapsed = false;
	/** Last collapse/expand toggle, so a re-render mid-animation resumes it instead of jumping. */
	composerToggle: { dir: 'collapse' | 'expand'; at: number } | undefined;
	/** Pending switch of the folded composer to its floating (out-of-flow) form. */
	composerFloatTimer: ReturnType<typeof setTimeout> | undefined;
	taskPlanDismissedKey: string | null = null;
	memoriesOpen = false;
	showLowScoringMemories = false;
	memoriesBusyId: number | null = null;
	jobsLogId: string | null = null;
	jobClock = Date.now();
	jobClockTimer: ReturnType<typeof setInterval> | undefined;
	readonly jobElapsedEls = new Map<string, HTMLElement>();
	lastTaskPlanStructure = '';
	lastAssistantCard: HTMLElement | undefined;
	readonly streamPatchStore = this._register(new DisposableStore());
	readonly reasoningPatchStore = this._register(new DisposableStore());
	readonly reasoningContentStore = this._register(new DisposableStore());
	readonly toolPatchStore = this._register(new DisposableStore());
	readonly toolPatchStores = new Map<string, DisposableStore>();
	/** Rendered blocks of the streaming reply, in order; see `renderStreamingAssistantBody`. */
	streamBlocks: IKnoxGuiStreamCacheBlock[] = [];
	/** Live reasoning markdown cache; see `renderStreamingReasoningBody`. */
	reasoningBlocks: IKnoxGuiStreamCacheBlock[] = [];
	openMenu: 'agent' | 'model' | 'effort' | null = null;
	openMenuSource = 'main';
	openRoleMenu: KnoxModelRole | null = null;
	expandedRuleIndex: number | null = null;
	editingHistoryId: string | null = null;
	historySearchFocus = false;
	historySearchCaret: number | null = null;
	historyListFocusedId: string | null = null;
	historyListAnchorId: string | null = null;
	historyListSearchInput: HTMLInputElement | undefined;
	memoryExpandedId: string | null = null;
	memorySelectedIds = new Set<string>();
	memorySelectionMode = false;
	memoryLastClickedId: string | null = null;
	memoryConfirmDeleteIds: string[] | null = null;
	memoryConfirmDeleteBulk = false;
	memoryExportPassword = '';
	memoryImportPassword = '';
	memoryExploringId: number | null = null;
	knoxChatModelQuery = '';
	openrouterModelQuery = '';
	memorySearchDraft = '';
	memorySearchTimer: ReturnType<typeof setTimeout> | undefined;
	memorySessionSearchTimer: ReturnType<typeof setTimeout> | undefined;
	memoryGraphSearchTimer: ReturnType<typeof setTimeout> | undefined;
	memorySettingsOpen = new Set<string>();
	memorySettingsConfirm: { action: 'consolidate' | 'purge'; label: string; description: string } | null = null;
	checkpointCopiedId: string | null = null;
	checkpointCopiedTimer: ReturnType<typeof setTimeout> | undefined;
	checkpointDetails: IKnoxGuiCheckpointDetailsView | null = null;
	checkpointListQueryTimer: ReturnType<typeof setTimeout> | undefined;
	checkpointDiffTreeCollapsed = false;
	readonly checkpointDiffCollapsedFolders = new Set<string>();
	readonly checkpointDiffExpandedGaps = new Set<string>();
	memoryGraphLayout: Array<{ id: number; x: number; y: number }> = [];
	dragOver = false;
	dragLeaveTimer: ReturnType<typeof setTimeout> | undefined;
	chatInputHistory: IKnoxGuiComposerInputHistory = createComposerInputHistory();
	composerUndo: IKnoxGuiComposerUndo = createComposerUndo();
	composerUndoApplying = false;
	/** Nested `compositionstart` count; the IME owns the composer DOM while this is > 0. */
	composerImeDepth = 0;
	/** Full GUI render skipped during IME; replayed on `compositionend`. */
	composerImeNeedsReplay = false;
	editInputHistory: IKnoxGuiComposerInputHistory = createComposerInputHistory();
	addFileHits: IKnoxGuiSuggestItem[] = [];
	addFileQuery = '';
	addFileSelected = 0;
	codeEditExpanded = new Set<number>();
	/** Composer code blocks the user expanded or collapsed, keyed by source and range. */
	readonly codeBlockExpanded = new Map<string, boolean>();
	/** Tool call whose permission row was last scrolled into view. */
	toolPermScrolledFor: string | undefined;
	readonly lumpFade: { shown: KnoxGuiOverlay | null; phase: 'idle' | 'enter' | 'leave'; at: number; timer?: ReturnType<typeof setTimeout> } = { shown: null, phase: 'idle', at: 0 };
	addFileMenuOpen = false;
	/** Last caret rect in the composer; the picker stays anchored while its query box has focus. */
	lastCaretRect: { left: number; top: number; bottom: number } | undefined;
	queryProviderFor: string | undefined;
	queryProviderValue = '';
	dropOverlayEl: HTMLElement | undefined;
	focusedHistoryId: string | null = null;
	osrMenuEl: HTMLElement | undefined;
	readonly historyDrafts = new Map<string, { doc: IKnoxGuiInputBlock[]; images: string[] }>();
	/** Mounted history message editors (and their boxes) from the last render, by history id. */
	readonly historyEditorEls = new Map<string, HTMLElement>();
	readonly historyEditorBoxes = new Map<string, HTMLElement>();
	/** Per-editor walk through the shared chat input history (`useInputHistory` per editor instance). */
	readonly historyInputHistories = new Map<string, IKnoxGuiComposerInputHistory>();
	readonly historyUndo = new Map<string, IKnoxGuiComposerUndo>();
	readonly historyUndoApplying = new Set<string>();
	historyDropOverId: string | null = null;
	historyPendingCaret: { id: string; caret: IKnoxGuiDocCaret } | undefined;
	textDialog: { title: string; body: string } | null = null;
	imageViewerUrl: string | undefined;
	findQueryDraft = '';
	findQueryTimer: ReturnType<typeof setTimeout> | undefined;
	findResizeTimer: ReturnType<typeof setTimeout> | undefined;
	findResizing = false;
	findResizeObserver: ResizeObserver | undefined;
	osrSelectedRange: Range | undefined;
	addModelBrowseMode: 'provider' | 'model' = 'provider';
	readonly appliedUntil = new Map<string, number>();
	readonly rejectedApplies = new Set<string>();
	readonly contextPeekOpen = new Set<string>();
	checkpointGraphOpenId: string | null = null;
	checkpointGraphFindOpen = false;
	checkpointGraphFindQuery = '';
	checkpointGraphFindIndex = 0;
	checkpointGraphFindOpenDetails = false;
	checkpointGraphFindInput: HTMLInputElement | undefined;
	checkpointGraphSettingsOpen = false;
	checkpointGraphMenu: {
		x: number;
		y: number;
		kind: 'row' | 'file' | 'branch' | 'tag' | 'column';
		nodeId?: string;
		path?: string;
		branchId?: string;
		tag?: string;
	} | null = null;
	checkpointGraphPrompt: {
		kind: 'delete' | 'branch' | 'merge' | 'notice' | 'resetFile' | 'resetTree' | 'rename' | 'addTag' | 'deleteTag';
		id?: string;
		baseId?: string;
		sourceId?: string;
		targetId?: string;
		message?: string;
		checkpointId?: string;
		path?: string;
		branchId?: string;
		name?: string;
		tag?: string;
	} | null = null;
	checkpointGraphPromptValue = '';
	checkpointGraphCompare: { kind: 'checkpoint'; id: string } | { kind: 'workspace' } | null = null;
	checkpointGraphArmCompare = false;
	checkpointGraphComparePaths: string[] | null = null;
	checkpointGraphCompareError: string | null = null;
	checkpointGraphCompareKey: string | null = null;
	checkpointGraphScrollTop = 0;
	checkpointGraphViewport = 0;
	checkpointGraphPendingHead = false;
	checkpointGraphRevealKey: string | undefined;
	checkpointGraphFindKey: string | undefined;
	checkpointGraphPromptFocused: object | null = null;
	checkpointGraphExpandedFolders = new Set<string>();
	checkpointListSelectMode = false;
	checkpointListSelected = new Set<string>();
	checkpointListFocusedId: string | null = null;
	checkpointListAnchorId: string | null = null;
	checkpointListDeleteConfirm = false;
	/** Raw text for the checkpoint config size / extension inputs while they differ from the draft. */
	checkpointConfigInputs: { storage?: string; fileSize?: string; extensions?: string } = {};
	checkpointShareAuditExpanded: string | null = null;
	checkpointListSearchInput: HTMLInputElement | undefined;
	checkpointTimelineQuery = '';
	checkpointTimelineKind: string | null = null;
	checkpointTimelineExpanded = new Set<string>();
	checkpointTimelineShowBranches = true;
	checkpointTimelineDeleteId: string | null = null;
	checkpointTimelineBranchBase: string | null = null;
	checkpointTimelineBranchName = '';
	checkpointTimelineSearchInput: HTMLInputElement | undefined;
	themeCssVars = new Set<string>();
}
