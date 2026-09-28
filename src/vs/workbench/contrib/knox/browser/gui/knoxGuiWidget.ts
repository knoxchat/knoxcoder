/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { knoxGuiShowsChatScrollbar, knoxGuiShowsFatalBanner, knoxGuiShowsSessionTabs } from '../../common/knoxGuiChrome.js';
import { AUTO_DISPLAY_START, isKnoxGuiInputOnlyChange, isKnoxGuiStreamingTokenChange, toolDisplayKind } from '../../common/knoxGuiChat.js';
import { composerUndoRecord, createComposerInputHistory, createComposerUndo, IKnoxGuiComposerInputHistory, IKnoxGuiComposerUndo, IKnoxGuiDocCaret, IKnoxGuiInputBlock, KnoxGuiInlineNode } from '../../common/knoxGuiInput.js';
import type { IKnoxGuiCheckpointDetailsView } from '../../common/knoxGuiCheckpoints.js';
import { applyKnoxGuiThemeToElement } from '../../common/knoxGuiTheme.js';
import { DARK_TERMINAL_PALETTE, treeThemeColors } from '../../common/knoxGuiTools.js';
import { KnoxGuiOverlay, KnoxGuiRoute } from '../../common/knoxGuiProtocol.js';
import { IKnoxGuiBackgroundJob, IKnoxGuiCheckpointDiffFile, IKnoxGuiContextItem, IKnoxGuiGitDiffFile, IKnoxGuiHistoryItem, IKnoxGuiInjectedMemory, IKnoxGuiState, IKnoxGuiSuggestItem, IKnoxGuiTaskPlanStep, IKnoxGuiToolCall, KnoxModelRole, knoxGuiIsDedicatedEditor } from '../../common/knoxGuiState.js';
import { IKnoxGuiActivityStep, IKnoxGuiPastFileInfo, IKnoxGuiTpsClock, resetTpsClock } from '../../common/knoxGuiTranscript.js';
import { KnoxGuiSvgIcon } from './knoxGuiIcons.js';
import { KnoxGuiController } from '../knoxGuiController.js';

import * as knoxGuiControls from './widget/controls.js';
import * as knoxGuiChromeView from './widget/chrome.js';
import * as knoxGuiChatView from './widget/chat.js';
import * as knoxGuiMarkdownView from './widget/markdown.js';
import * as knoxGuiToolsView from './widget/tools.js';
import * as knoxGuiComposerView from './widget/composer.js';
import * as knoxGuiPanelsView from './widget/panels.js';
import * as knoxGuiOverlaysView from './widget/overlays.js';
import * as knoxGuiPagesView from './widget/pages.js';
import * as knoxGuiMemoryView from './widget/memory.js';
import * as knoxGuiCheckpointsView from './widget/checkpoints.js';
import * as knoxGuiDialogView from './widget/dialog.js';
import { captureDomState, restoreDomState } from './widget/preserve.js';

export class KnoxGuiWidget extends Disposable {
	readonly root: HTMLElement;
	readonly renderStore = this._register(new DisposableStore());
	readonly checkpointGraphStore = this._register(new DisposableStore());
	listenerStore: DisposableStore;
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
	readonly toolCardExpanded = new Set<string>();
	readonly toolCardTab = new Map<string, string>();
	readonly askUserStep = new Map<string, number>();
	readonly askUserDrafts = new Map<string, Record<string, string>>();
	readonly termUserScrolled = new Set<string>();
	readonly termScrollTop = new Map<string, number>();
	readonly termPrevLen = new Map<string, number>();
	readonly termCopiedUntil = new Map<string, number>();
	chatListFailed = false;
	gitDiffExpanded = true;
	gitDiffExpandedPinned = false;
	compactionOpen = false;
	taskPlanOpen = true;
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
	streamBlocks: { key: string; nodes: ChildNode[]; store: DisposableStore; payload: string }[] = [];
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
	errorFallbackReady = false;
	errorFallbackTimer: ReturnType<typeof setTimeout> | undefined;
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
	readonly themeStyleEl: HTMLStyleElement;
	themeCssVars = new Set<string>();

	constructor(
		parent: HTMLElement,
		readonly controller: KnoxGuiController,
		@IOpenerService readonly openerService: IOpenerService,
		@IHoverService readonly hoverService: IHoverService,
		@ILanguageService readonly languageService: ILanguageService,
		@IModelService readonly modelService: IModelService,
		@IMarkdownRendererService readonly markdownRendererService: IMarkdownRendererService,
	) {
		super();
		this.chatInputHistory = controller.loadInputHistory('chat');
		this.editInputHistory = controller.loadInputHistory('edit');
		this.composerUndo = createComposerUndo(controller.store.state.inputDoc);
		controller.memoryRefreshBlocked = () => this.memorySelectionMode;
		controller.historyComposer = {
			doc: id => this.historyDrafts.get(id)?.doc ?? [],
			set: (id, doc, caret) => knoxGuiChatView.setHistoryDraftDoc(this, id, doc, caret),
		};
		this._register({ dispose: () => { controller.historyComposer = undefined; } });
		this.listenerStore = this.renderStore;
		this.themeStyleEl = DOM.append(parent, DOM.$('style.knox-gui-theme'));
		this._register({ dispose: () => this.themeStyleEl.remove() });
		this.root = DOM.append(parent, DOM.$('.knox-gui.show-file-icons'));
		this._register(controller.store.onDidChange(state => this.onState(state)));
		this._register(DOM.addDisposableListener(this.root, 'dragover', e => this.onDragOver(e)));
		this._register(DOM.addDisposableListener(this.root, 'dragleave', e => this.onDragLeave(e)));
		this._register(DOM.addDisposableListener(this.root, 'drop', e => this.onDrop(e)));
		this._register(DOM.addDisposableListener(this.root, 'keydown', e => this.onRootKeyDown(e)));
		this._register(DOM.addDisposableListener(this.root, 'mousedown', e => this.onRootMouseDown(e)));
		this._register(DOM.addDisposableListener(this.root, 'contextmenu', e => this.onRootContextMenu(e)));
		this._register({ dispose: () => this.hideImagePreview() });
		this._register({ dispose: () => this.hideOsrMenu() });
		this._register({ dispose: () => { if (this.errorFallbackTimer) { clearTimeout(this.errorFallbackTimer); } } });
		this._register({ dispose: () => this.clearJobClock() });
		this._register({ dispose: () => this.clearMeterClock() });
		this._register({ dispose: () => { if (this.dragLeaveTimer) { clearTimeout(this.dragLeaveTimer); } } });
		this._register({ dispose: () => { if (this.findQueryTimer) { clearTimeout(this.findQueryTimer); } } });
		this._register({ dispose: () => { if (this.findResizeTimer) { clearTimeout(this.findResizeTimer); } } });
		this._register({ dispose: () => { if (this.streamEndStickHandle) { clearTimeout(this.streamEndStickHandle); } } });
		this._register({ dispose: () => this.findResizeObserver?.disconnect() });
		if (typeof ResizeObserver !== 'undefined') {
			this.findResizeObserver = new ResizeObserver(() => this.onPaneResize());
			this.findResizeObserver.observe(this.root);
		}
		this._register({ dispose: () => clearTimeout(this.lumpFade.timer) });
		this._register({ dispose: () => { if (this.checkpointListQueryTimer) { clearTimeout(this.checkpointListQueryTimer); } } });
		this._register({ dispose: () => { if (this.memorySessionSearchTimer) { clearTimeout(this.memorySessionSearchTimer); } } });
		this._register({ dispose: () => { if (this.memoryGraphSearchTimer) { clearTimeout(this.memoryGraphSearchTimer); } } });
		this.gitDiffExpanded = this.controller.gitDiffExpanded();
		this.gitDiffExpandedPinned = this.controller.gitDiffExpandedPinned();
		this.agentMeterOpen = this.controller.activityPanelExpanded();
		this.render();
	}

	layout(_height: number, _width: number): void {
		// CSS flex handles sizing.
	}

	focusInput(): void {
		this.editorEl?.focus();
		const pending = this.controller.pendingComposerCaret;
		if (pending && this.editorEl) {
			this.controller.pendingComposerCaret = undefined;
			this.placeCaretAtDocPosition(this.editorEl, pending);
			return;
		}
		this.placeCaretAtEnd();
	}

	isInputFocused(): boolean {
		return Boolean(this.editorEl && this.editorEl.contains(document.activeElement));
	}

	openFind(): void {
		this.controller.openFind();
		queueMicrotask(() => {
			this.findInput?.focus();
			this.findInput?.select();
		});
	}

	onState(state: IKnoxGuiState): void {
		if (this.lastState && state.inputDoc !== this.lastState.inputDoc && !this.composerUndoApplying) {
			this.composerUndo = composerUndoRecord(this.composerUndo, state.inputDoc, Date.now());
		}
		if (this.lastState && isKnoxGuiInputOnlyChange(this.lastState, state)) {
			this.lastState = state;
			this.syncInput(state);
			return;
		}
		if (this.lastState && isKnoxGuiStreamingTokenChange(this.lastState, state) && this.lastAssistantCard) {
			this.lastState = state;
			this.patchLastAssistant(state);
			return;
		}
		if (this.lastState && !this.lastState.isStreaming && state.isStreaming) {
			this.autoScrollEnabled = true;
		}
		if (this.lastState?.isStreaming && !state.isStreaming && this.autoScrollEnabled) {
			knoxGuiChromeView.scheduleStreamEndStick(this);
		}
		if (this.lastState?.isStreaming && !state.isStreaming && this.shouldShowComposer(state)) {
			this.refocusComposerAfterStream = true;
		}
		this.lastState = state;
		this.render();
	}

	render(): void {
		const active = document.activeElement;
		const restoreEditor = Boolean(active instanceof HTMLElement && active.isContentEditable && active.classList.contains('knox-gui-input'));
		const restore = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
			? { id: active.id, name: active.placeholder || active.className, start: active.selectionStart, end: active.selectionEnd, tag: active.tagName, type: active.type, value: active.value, find: active.hasAttribute('data-knox-find-input') }
			: undefined;
		const restoreJobFocus = active instanceof HTMLElement ? active.closest('[data-testid^="agent-job-"]')?.getAttribute('data-testid') ?? undefined : undefined;
		const domSnapshot = captureDomState(this.root, this.bodyEl);
		this.checkpointGraphMount?.remove();
		this.renderStore.clear();
		this.listenerStore = this.renderStore;
		this.editorEl = undefined;
		this.suggestEl = undefined;
		this.historyEditorEls.clear();
		this.historyEditorBoxes.clear();
		this.inputWrap = undefined;
		this.imagePreviewEl?.remove();
		this.imagePreviewEl = undefined;
		this.bodyEl = undefined;
		this.floatingHostEl = undefined;
		this.scrollTopBtn = undefined;
		this.scrollBottomBtn = undefined;
		this.findInput = undefined;
		this.promptNameInput = undefined;
		this.checkpointGraphFindInput = undefined;
		this.checkpointListSearchInput = undefined;
		this.historyListSearchInput = undefined;
		this.checkpointTimelineSearchInput = undefined;
		this.lastAssistantCard = undefined;
		this.dropOverlayEl = undefined;
		this.streamPatchStore.clear();
		this.reasoningPatchStore.clear();
		this.reasoningContentStore.clear();
		this.toolPatchStore.clear();
		this.toolPatchStores.clear();
		this.streamBlocks = [];
		const state = this.controller.store.state;
		if (state.sessionId !== this.lastSessionId) {
			this.lastSessionId = state.sessionId;
			this.expandedStart = AUTO_DISPLAY_START;
			this.autoScrollEnabled = true;
			this.savedScrollTop = 0;
			this.failedRows.clear();
			this.chatListFailed = false;
			this.activityExpanded.clear();
			this.fenceCollapsed.clear();
			this.fenceExpanded.clear();
			this.codeGenerating.clear();
			this.codeUserScrolled.clear();
			this.codePinned.clear();
			this.codeWindowShift.clear();
			this.codeScrollTop.clear();
			this.codeScrollAdjust.clear();
			this.checkpointFetched.clear();
			this.toolArgsOpen.clear();
			this.toolBodyCollapsed.clear();
			this.toolCardExpanded.clear();
			this.toolCardTab.clear();
			this.askUserStep.clear();
			this.askUserDrafts.clear();
			this.termUserScrolled.clear();
			this.termScrollTop.clear();
			this.termPrevLen.clear();
			this.termCopiedUntil.clear();
			this.historyDrafts.clear();
			this.historyInputHistories.clear();
			this.historyUndo.clear();
			this.historyUndoApplying.clear();
			this.historyDropOverId = null;
			this.appliedUntil.clear();
			this.rejectedApplies.clear();
			this.contextPeekOpen.clear();
			this.focusedHistoryId = null;
			this.compactionOpen = false;
			this.taskPlanOpen = true;
			this.taskPlanDismissedKey = null;
			this.memoriesOpen = false;
			this.showLowScoringMemories = false;
			this.memoriesBusyId = null;
			this.jobsLogId = null;
			this.lastTaskPlanStructure = '';
		}
		this.root.replaceChildren();
		this.root.setAttribute('data-testid', 'knox-gui');
		this.root.classList.toggle('knox-gui-dedicated', knoxGuiIsDedicatedEditor(state));
		this.root.style.fontSize = `${state.fontSize}px`;
		this.themeCssVars = applyKnoxGuiThemeToElement(this.root, this.themeStyleEl, state, this.themeCssVars);
		this.renderFind(state);
		if (knoxGuiShowsSessionTabs(state)) {
			this.renderTabs(state);
		}
		if (state.route === KnoxGuiRoute.Chat) {
			const host = DOM.append(this.root, DOM.$('.knox-gui-floating-sent-host'));
			host.setAttribute('data-testid', 'floating-sent-host');
			this.floatingHostEl = host;
		}
		const body = DOM.append(this.root, DOM.$('.knox-gui-body'));
		this.bodyEl = body;
		body.classList.toggle('knox-gui-body-chat', state.route === KnoxGuiRoute.Chat);
		if (knoxGuiShowsChatScrollbar(state.showChatScrollbar, Math.max(this.root.clientHeight, typeof window !== 'undefined' ? window.innerHeight : 0))) {
			body.classList.add('knox-gui-body-scroll');
		} else {
			body.classList.add('knox-gui-body-no-scroll');
		}
		try {
			this.renderRoute(body, state);
		} catch (error) {
			this.renderErrorFallback(body, state, error);
			if (!this.errorFallbackReady && !this.errorFallbackTimer) {
				this.errorFallbackTimer = setTimeout(() => {
					this.errorFallbackReady = true;
					this.errorFallbackTimer = undefined;
					this.controller.store.patch({});
				}, 500);
			}
		}
		if (this.shouldShowComposer(state)) {
			this.renderComposer(state);
		}
		if (knoxGuiShowsFatalBanner(state)) {
			this.renderFatalBanner(state);
		}
		if (this.expandedRuleIndex !== null) {
			this.renderRuleExpandDialog(state);
		}
		if (state.promptDraft) {
			this.renderPromptEditor(state);
		}
		if (state.addModelModal) {
			this.renderAddModelForm(state);
		}
		if (state.streamError) {
			this.renderStreamError(this.root, state);
		}
		if (this.textDialog) {
			knoxGuiDialogView.renderMilestoneDialog(this, state);
		}
		if (this.imageViewerUrl) {
			knoxGuiDialogView.renderImageViewer(this, state);
		}
		if (this.dragOver) {
			this.showDropOverlay();
		}
		restoreDomState(this.root, domSnapshot);
		this.restoreTranscriptScroll(state);
		this.attachTranscriptScroll(body, state);
		if (state.route !== KnoxGuiRoute.CheckpointGraph) {
			this.releaseCheckpointGraph();
		}
		queueMicrotask(() => {
			if (this.textDialog || this.imageViewerUrl) {
				return;
			}
			if (restoreJobFocus) {
				const jobEl = this.root.querySelector(`[data-testid="${restoreJobFocus}"]`) as HTMLElement | null;
				if (jobEl) {
					jobEl.focus();
					return;
				}
			}
			if (state.find.open && this.findInput) {
				this.findInput.focus();
				if (restore?.find) {
					this.findInput.setSelectionRange(restore.start ?? this.findInput.value.length, restore.end ?? this.findInput.value.length);
				} else {
					this.findInput.select();
				}
				return;
			}
			if (state.promptDraft && this.promptNameInput) {
				const restoringDialogField = restore && (restore.tag === 'INPUT' || restore.tag === 'TEXTAREA');
				if (!restoringDialogField) {
					this.promptNameInput.focus();
					return;
				}
			}
			const refocusAfterStream = this.refocusComposerAfterStream;
			this.refocusComposerAfterStream = false;
			if (restoreEditor || state.inputFocused || (refocusAfterStream && typeof document !== 'undefined' && document.hasFocus() && this.shouldShowComposer(state))) {
				this.focusInput();
				return;
			}
			if (!restore) {
				return;
			}
			const candidates = Array.from(this.root.querySelectorAll('input, textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>;
			const sameKind = candidates.filter(el => el.tagName === restore.tag && el.type === restore.type);
			const match = (restore.id ? candidates.find(el => el.id === restore.id) : undefined)
				?? sameKind.find(el => el.value === restore.value)
				?? sameKind.find(el => (el.placeholder || el.className) === restore.name);
			if (match) {
				match.focus();
				if (restore.start !== null && match.selectionStart !== null) {
					match.setSelectionRange(restore.start ?? match.value.length, restore.end ?? match.value.length);
				}
			}
		});
	}

	patchLastAssistant(state: IKnoxGuiState): void {
		knoxGuiChatView.patchLastAssistant(this, state);
	}

	renderStreamingAssistantBody(card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderStreamingAssistantBody(this, card, state, item);
	}

	onDragOver(event: DragEvent): void {
		knoxGuiComposerView.onDragOver(this, event);
	}

	onDragLeave(event: DragEvent): void {
		knoxGuiComposerView.onDragLeave(this, event);
	}

	showDropOverlay(): void {
		knoxGuiComposerView.showDropOverlay(this);
	}

	hideDropOverlay(): void {
		knoxGuiComposerView.hideDropOverlay(this);
	}

	onDrop(event: DragEvent): void {
		knoxGuiComposerView.onDrop(this, event);
	}

	renderFatalBanner(state: IKnoxGuiState): void {
		knoxGuiChromeView.renderFatalBanner(this, state);
	}

	shouldShowComposer(state: IKnoxGuiState): boolean {
		return knoxGuiChromeView.shouldShowComposer(this, state);
	}

	renderComposer(state: IKnoxGuiState): void {
		knoxGuiComposerView.renderComposer(this, state);
	}

	renderToolbar(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderToolbar(this, parent, state);
	}

	renderMode(bar: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderMode(this, bar, state);
	}

	renderAgentMenu(anchor: HTMLElement, state: IKnoxGuiState, running: number): void {
		knoxGuiChromeView.renderAgentMenu(this, anchor, state, running);
	}

	renderFind(state: IKnoxGuiState): void {
		knoxGuiChromeView.renderFind(this, state);
	}

	renderTabs(state: IKnoxGuiState): void {
		knoxGuiChromeView.renderTabs(this, state);
	}

	renderRoute(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderRoute(this, body, state);
	}

	renderChat(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChatView.renderChat(this, body, state);
	}

	renderChatListError(body: HTMLElement, state: IKnoxGuiState, error?: unknown): void {
		knoxGuiChatView.renderChatListError(this, body, state, error);
	}

	renderHistoryRow(
		parent: HTMLElement,
		state: IKnoxGuiState,
		index: number,
		highlight: boolean,
		currentHit: boolean,
		lastUserIndex: number,
		duplicateIds: Set<string>,
	): void {
		knoxGuiChatView.renderHistoryRow(this, parent, state, index, highlight, currentHit, lastUserIndex, duplicateIds);
	}

	renderRowError(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, error?: unknown): void {
		knoxGuiChatView.renderRowError(this, parent, state, item, error);
	}

	renderMessage(
		body: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		highlight: boolean,
		currentHit: boolean,
		index: number,
		lastUserIndex: number,
		duplicateIds: Set<string>,
	): void {
		knoxGuiChatView.renderMessage(this, body, state, item, highlight, currentHit, index, lastUserIndex, duplicateIds);
	}

	renderUserTurn(
		body: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		highlight: boolean,
		currentHit: boolean,
		index: number,
		isLastUser: boolean,
	): void {
		knoxGuiChatView.renderUserTurn(this, body, state, item, highlight, currentHit, index, isLastUser);
	}

	historyDraftFor(item: IKnoxGuiHistoryItem): { doc: IKnoxGuiInputBlock[]; images: string[] } {
		return knoxGuiChatView.historyDraftFor(this, item);
	}

	renderHistoricalEditor(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiChatView.renderHistoricalEditor(this, parent, state, item, index);
	}

	readImageFileIntoDraft(file: File, historyId: string): void {
		knoxGuiChatView.readImageFileIntoDraft(this, file, historyId);
	}

	renderHistoryContextPeek(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderHistoryContextPeek(this, parent, state, item);
	}

	renderContextItemsPeek(parent: HTMLElement, state: IKnoxGuiState, key: string, items: readonly IKnoxGuiContextItem[], gathering: boolean): void {
		knoxGuiChatView.renderContextItemsPeek(this, parent, state, key, items, gathering);
	}

	renderContextPeekItem(parent: HTMLElement, ctx: IKnoxGuiContextItem): HTMLElement {
		return knoxGuiChatView.renderContextPeekItem(this, parent, ctx);
	}

	placeCaretAtEndOf(editor: HTMLElement): void {
		knoxGuiComposerView.placeCaretAtEndOf(this, editor);
	}

	renderTurnLoading(parent: HTMLElement, state: IKnoxGuiState, item?: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderTurnLoading(this, parent, state, item);
	}

	renderAssistantTurn(
		body: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		highlight: boolean,
		currentHit: boolean,
		index: number,
		isLast: boolean,
	): void {
		knoxGuiChatView.renderAssistantTurn(this, body, state, item, highlight, currentHit, index, isLast);
	}

	renderErrorStep(card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiChatView.renderErrorStep(this, card, state, item, index);
	}

	renderAssistantBody(card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, isLast: boolean): void {
		knoxGuiChatView.renderAssistantBody(this, card, state, item, isLast);
	}

	appendMarkdown(parent: HTMLElement, source: string, store = this.renderStore, fileInfo?: IKnoxGuiPastFileInfo, streaming = false, target?: HTMLElement): void {
		knoxGuiMarkdownView.appendMarkdown(this, parent, source, store, fileInfo, streaming, target);
	}

	renderCodeFence(
		parent: HTMLElement,
		state: IKnoxGuiState,
		item: IKnoxGuiHistoryItem,
		fence: { language: string; filepath?: string; range?: string; code: string; closed: boolean },
		fenceIndex: number,
		generating: boolean,
	): void {
		knoxGuiMarkdownView.renderCodeFence(this, parent, state, item, fence, fenceIndex, generating);
	}

	renderCodeLines(parent: HTMLElement, state: IKnoxGuiState, language: string, code: string, filepath: string | undefined, options: knoxGuiMarkdownView.IKnoxGuiCodeLinesOptions): HTMLElement {
		return knoxGuiMarkdownView.renderCodeLines(this, parent, state, language, code, filepath, options);
	}

	renderCodeFenceBlock(parent: HTMLElement, state: IKnoxGuiState, options: knoxGuiMarkdownView.IKnoxGuiFenceBlockOptions): void {
		knoxGuiMarkdownView.renderCodeFenceBlock(this, parent, state, options);
	}

	paintHighlightedCode(pre: HTMLElement, language: string, code: string, filepath?: string): void {
		knoxGuiMarkdownView.paintHighlightedCode(this, pre, language, code, filepath);
	}

	renderApplyActions(parent: HTMLElement, state: IKnoxGuiState, streamId: string, fence: { code: string; filepath?: string }): void {
		knoxGuiMarkdownView.renderApplyActions(this, parent, state, streamId, fence);
	}

	renderReasoning(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiMarkdownView.renderReasoning(this, parent, state, item, index);
	}

	patchLiveReasoning(card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
		knoxGuiMarkdownView.patchLiveReasoning(this, card, state, item, index);
	}

	toggleThinking(item: IKnoxGuiHistoryItem, collapsed: boolean): void {
		knoxGuiMarkdownView.toggleThinking(this, item, collapsed);
	}

	renderThinkingPeekBlock(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, inProgress: boolean): void {
		knoxGuiMarkdownView.renderThinkingPeekBlock(this, parent, state, item, index, inProgress);
	}

	renderResponseActions(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, truncated: boolean): void {
		knoxGuiMarkdownView.renderResponseActions(this, parent, state, item, index, truncated);
	}

	renderActivityTimeline(parent: HTMLElement, state: IKnoxGuiState, userIndex: number): void {
		knoxGuiChatView.renderActivityTimeline(this, parent, state, userIndex);
	}

	renderActivitySteps(parent: HTMLElement, state: IKnoxGuiState, steps: IKnoxGuiActivityStep[]): void {
		knoxGuiChatView.renderActivitySteps(this, parent, state, steps);
	}

	renderStreamError(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChatView.renderStreamError(this, parent, state);
	}

	renderAcceptRejectAll(parent: HTMLElement, state: IKnoxGuiState, options?: { singleRange?: boolean }): void {
		knoxGuiComposerView.renderAcceptRejectAll(this, parent, state, options);
	}

	renderChatPermissionBar(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderChatPermissionBar(this, parent, state);
	}

	renderToolOutputPeek(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem): void {
		knoxGuiChatView.renderToolOutputPeek(this, parent, state, item);
	}

	renderTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderTool(this, parent, state, tool);
	}

	renderToolBody(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, kind: ReturnType<typeof toolDisplayKind>): void {
		knoxGuiToolsView.renderToolBody(this, parent, state, tool, kind);
	}

	renderToolActions(
		parent: HTMLElement,
		state: IKnoxGuiState,
		tool: IKnoxGuiToolCall,
		kind: ReturnType<typeof toolDisplayKind>,
		options?: { placement?: 'card' | 'chat' | 'overlay' },
	): void {
		knoxGuiToolsView.renderToolActions(this, parent, state, tool, kind, options);
	}

	renderTerminalTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderTerminalTool(this, parent, state, tool);
	}

	renderCreateFileTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderCreateFileTool(this, parent, state, tool);
	}

	renderGenericCodeTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderGenericCodeTool(this, parent, state, tool);
	}

	renderToolCodePreview(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, filepath: string, code: string, language: string, collapsedByDefault: boolean): void {
		knoxGuiToolsView.renderToolCodePreview(this, parent, state, tool, filepath, code, language, collapsedByDefault);
	}

	renderSubdirectoryTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderSubdirectoryTool(this, parent, state, tool);
	}

	renderRepoMapTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderRepoMapTool(this, parent, state, tool);
	}

	renderTreeCard(parent: HTMLElement, state: IKnoxGuiState, options: {
		id: string;
		kind?: 'subdirectory' | 'repo-map';
		expanded: boolean;
		theme: ReturnType<typeof treeThemeColors>;
		title: string;
		subtitle?: string;
		stats?: { files: number; folders: number; total: number; size?: string };
		emptyHint?: string;
		preview: string;
		colorized: string;
		toggleTestId: string;
		staticTestId: string;
		cardTestId?: string;
		notice?: string;
		tabs?: { active: string; onStructure: () => void; onSummary: () => void };
	}): HTMLElement {
		return knoxGuiToolsView.renderTreeCard(this, parent, state, options);
	}

	renderExactSearchTool(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderExactSearchTool(this, parent, state, tool);
	}

	renderTaskSubagent(parent: HTMLElement, _state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderTaskSubagent(this, parent, _state, tool);
	}

	renderAskUser(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderAskUser(this, parent, state, tool);
	}

	appendFileIcon(parent: HTMLElement, filepath: string, size?: number, folder?: boolean): HTMLElement {
		return knoxGuiToolsView.appendFileIcon(this, parent, filepath, size, folder);
	}

	renderClickablePath(parent: HTMLElement, filepath: string, options?: { range?: string; startLine?: number; endLine?: number; showIcon?: boolean }): void {
		knoxGuiToolsView.renderClickablePath(this, parent, filepath, options);
	}

	appendAnsi(parent: HTMLElement, text: string, palette: typeof DARK_TERMINAL_PALETTE): void {
		knoxGuiToolsView.appendAnsi(this, parent, text, palette);
	}

	isLightTheme(): boolean {
		return knoxGuiToolsView.isLightTheme(this);
	}

	cardExpanded(id: string, defaultExpanded: boolean): boolean {
		return knoxGuiToolsView.cardExpanded(this, id, defaultExpanded);
	}

	toggleCardExpanded(id: string, defaultExpanded: boolean): void {
		knoxGuiToolsView.toggleCardExpanded(this, id, defaultExpanded);
	}

	setCardTab(id: string, tab: string): void {
		knoxGuiToolsView.setCardTab(this, id, tab);
	}

	renderAgentMeter(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderAgentMeter(this, parent, state);
	}

	renderPanels(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderPanels(this, parent, state);
	}

	renderAutonomousBanner(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderAutonomousBanner(this, parent, state);
	}

	renderGitDiffPanel(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderGitDiffPanel(this, parent, state);
	}

	renderGitDiffRow(parent: HTMLElement, state: IKnoxGuiState, file: IKnoxGuiGitDiffFile): void {
		knoxGuiPanelsView.renderGitDiffRow(this, parent, state, file);
	}

	renderCompactionPanel(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderCompactionPanel(this, parent, state);
	}

	renderWorktreePanel(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderWorktreePanel(this, parent, state);
	}

	renderTaskPlanPanel(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderTaskPlanPanel(this, parent, state);
	}

	renderTaskPlanStep(parent: HTMLElement, state: IKnoxGuiState, step: IKnoxGuiTaskPlanStep, index: number): void {
		knoxGuiPanelsView.renderTaskPlanStep(this, parent, state, step, index);
	}

	renderInjectedMemoriesPanel(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderInjectedMemoriesPanel(this, parent, state);
	}

	renderInjectedMemoryRow(parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiInjectedMemory): void {
		knoxGuiPanelsView.renderInjectedMemoryRow(this, parent, state, item);
	}

	renderBackgroundJobsPanel(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPanelsView.renderBackgroundJobsPanel(this, parent, state);
	}

	renderJobRow(parent: HTMLElement, state: IKnoxGuiState, job: IKnoxGuiBackgroundJob): void {
		knoxGuiPanelsView.renderJobRow(this, parent, state, job);
	}

	attachedPanel(parent: HTMLElement, testId: string): HTMLElement {
		return knoxGuiPanelsView.attachedPanel(this, parent, testId);
	}

	attachedToggle(panel: HTMLElement, _state: IKnoxGuiState, options: { expanded: boolean; testId: string; onToggle: () => void }): HTMLButtonElement {
		return knoxGuiPanelsView.attachedToggle(this, panel, _state, options);
	}

	attachedBody(panel: HTMLElement, expanded: boolean, tag: 'div' | 'ul' = 'div'): HTMLElement {
		return knoxGuiPanelsView.attachedBody(this, panel, expanded, tag);
	}

	attachedDismiss(parent: HTMLElement, label: string, onClick: () => void): HTMLElement {
		return knoxGuiPanelsView.attachedDismiss(this, parent, label, onClick);
	}

	syncJobClock(jobs: IKnoxGuiBackgroundJob[]): void {
		knoxGuiPanelsView.syncJobClock(this, jobs);
	}

	clearJobClock(): void {
		knoxGuiPanelsView.clearJobClock(this);
	}

	clearMeterClock(): void {
		knoxGuiPanelsView.clearMeterClock(this);
	}

	syncInput(state: IKnoxGuiState): void {
		knoxGuiComposerView.syncInput(this, state);
	}

	renderSuggest(wrap: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderSuggest(this, wrap, state);
	}

	renderSuggestItem(list: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiSuggestItem, index: number, selected: boolean): void {
		knoxGuiComposerView.renderSuggestItem(this, list, state, item, index, selected);
	}

	renderInput(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderInput(this, parent, state);
	}

	renderModelSelect(parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
		knoxGuiComposerView.renderModelSelect(this, parent, state, source);
	}

	renderReasoningSelect(parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
		knoxGuiComposerView.renderReasoningSelect(this, parent, state, source);
	}

	renderErrorFallback(body: HTMLElement, state: IKnoxGuiState, error: unknown): void {
		knoxGuiChromeView.renderErrorFallback(this, body, state, error);
	}

	renderOverlay(body: HTMLElement, state: IKnoxGuiState, overlay: Exclude<KnoxGuiOverlay, null>): void {
		knoxGuiOverlaysView.renderOverlay(this, body, state, overlay);
	}

	renderModels(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderModels(this, body, state);
	}

	renderRules(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderRules(this, body, state);
	}

	renderExploreBlocksButton(body: HTMLElement, state: IKnoxGuiState, blockType: string): void {
		knoxGuiOverlaysView.renderExploreBlocksButton(this, body, state, blockType);
	}

	renderRuleExpandDialog(state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderRuleExpandDialog(this, state);
	}

	openRuleDialog(index: number): void {
		this.expandedRuleIndex = index;
		this.render();
	}

	closeRuleDialog(): void {
		if (this.expandedRuleIndex === null) {
			return;
		}
		this.expandedRuleIndex = null;
		this.render();
	}

	renderPrompts(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderPrompts(this, body, state);
	}

	renderPromptEditor(state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderPromptEditor(this, state);
	}

	closePromptDialog(): void {
		if (!this.controller.store.state.promptDraft) {
			return;
		}
		this.controller.store.patch({ promptDraft: undefined });
	}

	renderContext(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderContext(this, body, state);
	}

	renderTools(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderTools(this, body, state);
	}

	savePolicy(partial: Partial<IKnoxGuiState['policy']>): void {
		knoxGuiOverlaysView.savePolicy(this, partial);
	}

	renderHistoryPage(body: HTMLElement, state: IKnoxGuiState, compact?: boolean): void {
		knoxGuiOverlaysView.renderHistoryPage(this, body, state, compact);
	}

	renderHistorySessionRow(parent: HTMLElement, state: IKnoxGuiState, session: IKnoxGuiState['historySessions'][number], index: number, sessions?: IKnoxGuiState['historySessions']): void {
		knoxGuiOverlaysView.renderHistorySessionRow(this, parent, state, session, index, sessions);
	}

	renderHistoryDeleteDialog(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiOverlaysView.renderHistoryDeleteDialog(this, body, state);
	}

	renderSettings(body: HTMLElement, state: IKnoxGuiState, compact: boolean): void {
		knoxGuiOverlaysView.renderSettings(this, body, state, compact);
	}

	renderConfigError(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderConfigError(this, body, state);
	}

	renderStats(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderStats(this, body, state);
	}

	renderAddModel(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderAddModel(this, body, state);
	}

	renderAddModelForm(state: IKnoxGuiState): void {
		knoxGuiPagesView.renderAddModelForm(this, state);
	}

	renderConfigureProvider(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderConfigureProvider(this, body, state);
	}

	renderKnoxChatModelList(body: HTMLElement, state: IKnoxGuiState, ready: boolean, options?: { selectOnly?: boolean }): void {
		knoxGuiPagesView.renderKnoxChatModelList(this, body, state, ready, options);
	}

	renderOAuthRow(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderOAuthRow(this, body, state);
	}

	renderAddModelInput(body: HTMLElement, state: IKnoxGuiState, input: { key: string; labelKey: string; placeholderKey?: string; inputType?: string; defaultValue?: string | number; min?: number; max?: number; step?: number }): void {
		knoxGuiPagesView.renderAddModelInput(this, body, state, input);
	}

	renderBatchDiff(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiPagesView.renderBatchDiff(this, body, state);
	}

	renderMemory(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemory(this, body, state);
	}

	renderMemoryOverview(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemoryOverview(this, body, state);
	}

	renderMemoryBrowser(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemoryBrowser(this, body, state);
	}

	renderMemorySessions(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemorySessions(this, body, state);
	}

	renderMemoryGraph(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemoryGraph(this, body, state);
	}

	renderMemorySettings(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiMemoryView.renderMemorySettings(this, body, state);
	}

	renderCheckpoints(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpoints(this, body, state);
	}

	renderCheckpointList(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointList(this, body, state);
	}

	renderRestorePreviewDialog(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderRestorePreviewDialog(this, parent, state);
	}

	renderCompareDialog(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCompareDialog(this, parent, state);
	}

	renderDiffViewer(parent: HTMLElement, state: IKnoxGuiState, diff: NonNullable<IKnoxGuiState['checkpointCompareDiff']>): void {
		knoxGuiCheckpointsView.renderDiffViewer(this, parent, state, diff);
	}

	renderFileTree(parent: HTMLElement, state: IKnoxGuiState, files: IKnoxGuiCheckpointDiffFile[], onSelect: (path: string) => void): void {
		knoxGuiCheckpointsView.renderFileTree(this, parent, state, files, onSelect);
	}

	renderCheckpointConfig(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointConfig(this, body, state);
	}

	renderCheckpointDashboard(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointDashboard(this, body, state);
	}

	dashCard(parent: HTMLElement, label: string, value: string, icon?: KnoxGuiSvgIcon, subtitle?: string): void {
		knoxGuiCheckpointsView.dashCard(this, parent, label, value, icon, subtitle);
	}

	renderCheckpointAnalysis(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointAnalysis(this, body, state);
	}

	renderCheckpointShare(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiCheckpointsView.renderCheckpointShare(this, body, state);
	}

	modal(parent: HTMLElement, testId: string, onClose?: () => void): HTMLElement {
		return knoxGuiCheckpointsView.modal(this, parent, testId, onClose);
	}

	back(body: HTMLElement, state: IKnoxGuiState, title?: string, extraClass?: string): void {
		knoxGuiControls.back(this, body, state, title, extraClass);
	}

	section(body: HTMLElement, title: string, text: string): void {
		knoxGuiControls.section(this, body, title, text);
	}

	toggle(body: HTMLElement, label: string, value: boolean, onChange: (value: boolean) => void): void {
		knoxGuiControls.toggle(this, body, label, value, onChange);
	}

	customSwitch(parent: HTMLElement, isOn: boolean, onToggle: () => void, size = 12): HTMLElement {
		return knoxGuiControls.customSwitch(this, parent, isOn, onToggle, size);
	}

	numberField(body: HTMLElement, label: string, value: number, min: number, max: number, onChange: (value: number) => void, step?: number, suffix?: string): void {
		knoxGuiControls.numberField(this, body, label, value, min, max, onChange, step, suffix);
	}

	hintedNumber(body: HTMLElement, label: string, hint: string, value: number, min: number, max: number, onChange: (value: number) => void): void {
		knoxGuiControls.hintedNumber(this, body, label, hint, value, min, max, onChange);
	}

	labeledInput(body: HTMLElement, label: string, value: string, placeholder: string): HTMLInputElement {
		return knoxGuiControls.labeledInput(this, body, label, value, placeholder);
	}

	selectField(parent: HTMLElement, values: string[], current: string, allLabel: string, onChange: (value: string) => void): HTMLSelectElement {
		return knoxGuiControls.selectField(this, parent, values, current, allLabel, onChange);
	}

	textAreaSetting(body: HTMLElement, label: string, value: string, onChange: (value: string) => void): void {
		knoxGuiControls.textAreaSetting(this, body, label, value, onChange);
	}

	renderScrollButtons(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderScrollButtons(this, parent, state);
	}

	onRootKeyDown(e: KeyboardEvent): void {
		knoxGuiChromeView.onRootKeyDown(this, e);
	}

	onRootMouseDown(e: MouseEvent): void {
		knoxGuiChromeView.onRootMouseDown(this, e);
	}

	onRootContextMenu(e: MouseEvent): void {
		knoxGuiChromeView.onRootContextMenu(this, e);
	}

	hideOsrMenu(): void {
		knoxGuiChromeView.hideOsrMenu(this);
	}

	toggleMenu(menu: 'agent' | 'model' | 'effort', source = 'main'): void {
		knoxGuiChromeView.toggleMenu(this, menu, source);
	}

	anchorPopover(menu: HTMLElement, trigger: HTMLElement, options?: { minWidth?: number; align?: 'start' | 'end' }): void {
		knoxGuiChromeView.anchorPopover(this, menu, trigger, options);
	}

	closeMenus(): void {
		knoxGuiChromeView.closeMenus(this);
	}

	onEscape(e: KeyboardEvent, state: IKnoxGuiState): void {
		knoxGuiChromeView.onEscape(this, e, state);
	}

	loadEarlier(): void {
		knoxGuiChromeView.loadEarlier(this);
	}

	restoreTranscriptScroll(state: IKnoxGuiState): void {
		knoxGuiChromeView.restoreTranscriptScroll(this, state);
	}

	attachTranscriptScroll(body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.attachTranscriptScroll(this, body, state);
	}

	scrollToHistoryIndex(index: number): void {
		knoxGuiChromeView.scrollToHistoryIndex(this, index);
	}

	scrollTranscript(to: 'top' | 'bottom'): void {
		knoxGuiChromeView.scrollTranscript(this, to);
	}

	syncScrollButtons(): void {
		knoxGuiChromeView.syncScrollButtons(this);
	}

	onEditorKeyDown(e: KeyboardEvent, state?: IKnoxGuiState): void {
		knoxGuiComposerView.onEditorKeyDown(this, e, state);
	}

	submitFromComposer(altKey: boolean): void {
		knoxGuiComposerView.submitFromComposer(this, altKey);
	}

	insertAddContext(): void {
		knoxGuiComposerView.insertAddContext(this);
	}

	stepInputHistory(delta: number): void {
		knoxGuiComposerView.stepInputHistory(this, delta);
	}

	caretAtEdge(edge: 'start' | 'end'): boolean {
		return knoxGuiComposerView.caretAtEdge(this, edge);
	}

	onEditorPaste(event: ClipboardEvent, state: IKnoxGuiState): void {
		knoxGuiComposerView.onEditorPaste(this, event, state);
	}

	insertPlainText(editor: HTMLElement, text: string): void {
		knoxGuiComposerView.insertPlainText(editor, text);
	}

	readImageFile(file: File): void {
		knoxGuiComposerView.readImageFile(this, file);
	}

	addImages(images: ReadonlyArray<{ name: string; imageUrl: string }>): void {
		knoxGuiComposerView.addImages(this, images);
	}

	paintInputDoc(editor: HTMLElement, doc: IKnoxGuiInputBlock[], onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
		knoxGuiComposerView.paintInputDoc(this, editor, doc, onChange);
	}

	appendInline(parent: HTMLElement, node: KnoxGuiInlineNode): void {
		knoxGuiComposerView.appendInline(this, parent, node);
	}

	readInputDoc(editor: HTMLElement): IKnoxGuiInputBlock[] {
		return knoxGuiComposerView.readInputDoc(this, editor);
	}

	readInlines(node: Node): KnoxGuiInlineNode[] {
		return knoxGuiComposerView.readInlines(this, node);
	}

	syncPlaceholder(editor: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.syncPlaceholder(this, editor, state);
	}

	placeCaretAtStart(): void {
		knoxGuiComposerView.placeCaretAtStart(this);
	}

	placeCaretAtEnd(): void {
		knoxGuiComposerView.placeCaretAtEnd(this);
	}

	caretDocPosition(editor: HTMLElement): IKnoxGuiDocCaret | undefined {
		return knoxGuiComposerView.caretDocPosition(this, editor);
	}

	placeCaretAtDocPosition(editor: HTMLElement, caret: IKnoxGuiDocCaret): void {
		knoxGuiComposerView.placeCaretAtDocPosition(this, editor, caret);
	}

	caretClientRect(): { left: number; top: number; bottom: number } | undefined {
		return knoxGuiComposerView.caretClientRect(this);
	}

	paintTypedMention(state: IKnoxGuiState): void {
		knoxGuiComposerView.paintTypedMention(this, state);
	}

	renderCodeToEditCard(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderCodeToEditCard(this, parent, state);
	}

	async refreshAddFileHits(query: string): Promise<void> {
		return knoxGuiComposerView.refreshAddFileHits(this, query);
	}

	renderContextPeek(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderContextPeek(this, parent, state);
	}

	renderImageThumbnails(parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderImageThumbnails(this, parent, state);
	}

	renderThumb(parent: HTMLElement, state: IKnoxGuiState, url: string, name: string, alt: string, onRemove: () => void): void {
		knoxGuiComposerView.renderThumb(this, parent, state, url, name, alt, onRemove);
	}

	showImagePreview(anchor: HTMLElement, url: string): void {
		knoxGuiComposerView.showImagePreview(this, anchor, url);
	}

	hideImagePreview(): void {
		knoxGuiComposerView.hideImagePreview(this);
	}

	iconButton(parent: HTMLElement, label: string, onClick: () => void, icon?: string): HTMLElement {
		return knoxGuiControls.iconButton(this, parent, label, onClick, icon);
	}

	chromeButton(parent: HTMLElement, options: {
		label?: string;
		icon?: string;
		svg?: KnoxGuiSvgIcon;
		svgSize?: number;
		svgAfter?: boolean;
		title?: string;
		selected?: boolean;
		disabled?: boolean;
		expandLabel?: boolean;
		extraClass?: string;
		testId?: string;
		menuTrigger?: boolean;
		onClick: (button: HTMLElement, event?: MouseEvent) => void;
	}): HTMLButtonElement {
		return knoxGuiControls.chromeButton(this, parent, options);
	}

	collapseChevron(parent: HTMLElement, options: {
		expanded: boolean;
		title: string;
		disabled?: boolean;
		testId?: string;
		onClick: () => void;
	}): HTMLElement {
		return knoxGuiControls.collapseChevron(this, parent, options);
	}

	appendSpinner(parent: HTMLElement, size = 16): HTMLElement {
		return knoxGuiControls.appendSpinner(parent, size);
	}

	hover(target: HTMLElement, content: string): void {
		knoxGuiControls.hover(this, target, content);
	}

	releaseCheckpointGraph(): void {
		this.checkpointGraphStore.clear();
		this.checkpointGraphMount?.remove();
		this.checkpointGraphMount = undefined;
		this.checkpointGraphRenderKey = undefined;
		this.checkpointGraphFindInput = undefined;
	}

	closeTextDialog(): void {
		if (!this.textDialog) {
			return;
		}
		this.textDialog = null;
		this.render();
	}

	openImageViewer(url: string): void {
		this.hideImagePreview();
		this.imageViewerUrl = url;
		this.render();
	}

	closeImageViewer(): void {
		if (!this.imageViewerUrl) {
			return;
		}
		this.imageViewerUrl = undefined;
		this.render();
	}

	onPaneResize(): void {
		knoxGuiChromeView.onPaneResize(this);
	}

}
