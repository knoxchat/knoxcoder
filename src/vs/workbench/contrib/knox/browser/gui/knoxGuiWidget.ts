/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { knoxGuiShowsChatScrollbar, knoxGuiShowsFatalBanner, knoxGuiShowsSessionTabs } from '../../common/knoxGuiChrome.js';
import { AUTO_DISPLAY_START, isKnoxGuiFilterOnlyChange, isKnoxGuiInputOnlyChange, isKnoxGuiStreamingTokenChange, knoxGuiToolProgressOnlyChange } from '../../common/knoxGuiChat.js';
import { patchToolProgress } from './widget/chat/assistant.js';
import { composerUndoRecord, createComposerUndo } from '../../common/knoxGuiInput.js';
import { applyKnoxGuiThemeToElement } from '../../common/knoxGuiTheme.js';
import { KnoxGuiRoute } from '../../common/knoxGuiProtocol.js';
import { IKnoxGuiState, knoxGuiIsDedicatedEditor } from '../../common/knoxGuiState.js';
import { KnoxGuiController } from '../knoxGuiController.js';
import * as knoxGuiChromeView from './widget/chrome.js';
import * as knoxGuiChatView from './widget/chat.js';
import * as knoxGuiOverlaysView from './widget/overlays.js';
import * as knoxGuiPagesView from './widget/pages.js';
import * as knoxGuiMemoryView from './widget/memory.js';
import * as knoxGuiCheckpointsView from './widget/checkpoints.js';
import * as knoxGuiDialogView from './widget/dialog.js';
import { captureDomState, restoreDomState } from './widget/preserve.js';
import { stepComposerUndo } from './widget/composer.js';
import { stepHistoryUndo } from './widget/chat/historyEditor.js';
import { isNativeTextInput, KnoxEditCommand, registerKnoxEditHost, selectAllContents } from './widget/editCommands.js';
import { KnoxGuiCheckpointsFacade } from './widget/facade/checkpointsFacade.js';

export class KnoxGuiWidget extends KnoxGuiCheckpointsFacade {
	readonly root: HTMLElement;
	listenerStore: DisposableStore;
	readonly themeStyleEl: HTMLStyleElement;

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
		this._register(registerKnoxEditHost(this.root, { run: (command, active) => this.runEditCommand(command, active) }));
		this._register({ dispose: () => this.hideImagePreview() });
		this._register({ dispose: () => this.hideOsrMenu() });
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
		this._register({ dispose: () => clearTimeout(this.composerFloatTimer) });
		this._register({ dispose: () => { if (this.checkpointListQueryTimer) { clearTimeout(this.checkpointListQueryTimer); } } });
		this._register({ dispose: () => { if (this.memorySearchTimer) { clearTimeout(this.memorySearchTimer); } } });
		this._register({ dispose: () => { if (this.memorySessionSearchTimer) { clearTimeout(this.memorySessionSearchTimer); } } });
		this._register({ dispose: () => { if (this.memoryGraphSearchTimer) { clearTimeout(this.memoryGraphSearchTimer); } } });
		this.gitDiffExpanded = this.controller.gitDiffExpanded();
		this.gitDiffExpandedPinned = this.controller.gitDiffExpandedPinned();
		this.agentMeterOpen = this.controller.activityPanelExpanded();
		this.composerCollapsed = this.controller.composerCollapsed();
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

	/**
	 * Select All / Undo / Redo for whatever is focused inside this widget, so the workbench never
	 * redirects them to the active code editor. Native `<input>` / `<textarea>` are left to the workbench.
	 */
	runEditCommand(command: KnoxEditCommand, active: HTMLElement): boolean {
		if (isNativeTextInput(active)) {
			return false;
		}
		if (command === 'selectAll') {
			// A focused contenteditable selects its own text; anywhere else in the pane selects the visible page.
			return selectAllContents(active.isContentEditable ? active : this.bodyEl ?? this.root);
		}
		const delta = command === 'undo' ? -1 : 1;
		if (this.editorEl && active === this.editorEl) {
			stepComposerUndo(this, delta);
			return true;
		}
		for (const [id, editor] of this.historyEditorEls) {
			if (editor === active) {
				stepHistoryUndo(this, id, delta);
				return true;
			}
		}
		return false;
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
		if (this.composerCollapsed && this.lastState && this.shouldShowComposer(state) && ((state.inputFocused && !this.lastState.inputFocused) || (state.overlay && !this.lastState.overlay))) {
			// Something asked to type (an @ mention, a slash command, host-inserted text) or opened a settings section: reveal the hidden composer.
			this.lastState = state;
			this.setComposerCollapsed(false);
			return;
		}
		if (this.lastState && isKnoxGuiInputOnlyChange(this.lastState, state)) {
			this.lastState = state;
			this.syncInput(state);
			return;
		}
		if (this.lastState && isKnoxGuiFilterOnlyChange(this.lastState, state)) {
			this.lastState = state;
			this.syncLiveFilters(state);
			return;
		}
		if (this.lastState && isKnoxGuiStreamingTokenChange(this.lastState, state) && this.lastAssistantCard) {
			const ended = this.lastState.isStreaming && !state.isStreaming;
			this.lastState = state;
			this.patchLastAssistant(state);
			if (ended && this.autoScrollEnabled) {
				knoxGuiChromeView.scheduleStreamEndStick(this);
			}
			if (ended && this.shouldShowComposer(state)) {
				this.refocusComposerAfterStream = true;
			}
			return;
		}
		if (this.lastState) {
			const progress = knoxGuiToolProgressOnlyChange(this.lastState, state);
			if (progress) {
				this.lastState = state;
				if (!patchToolProgress(this, state, progress)) {
					this.render();
				} else if (this.autoScrollEnabled) {
					knoxGuiChromeView.scheduleTranscriptStick(this);
				}
				return;
			}
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
		if (this.bodyEl && this.lastState?.route === KnoxGuiRoute.Chat) {
			this.savedScrollTop = this.bodyEl.scrollTop;
			this.lastScrollTop = this.bodyEl.scrollTop;
			this.lastScrollHeight = this.bodyEl.scrollHeight;
		}
		const domSnapshot = captureDomState(this.root, this.bodyEl);
		this.checkpointGraphMount?.remove();
		this.renderStore.clear();
		this.filterStore.clear();
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
		this.reasoningBlocks = [];
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
			this.termEntered.clear();
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

	withFilterStore<T>(fn: () => T): T {
		this.filterStore.clear();
		const previous = this.listenerStore;
		this.listenerStore = this.filterStore;
		try {
			return fn();
		} finally {
			this.listenerStore = previous;
		}
	}

	syncLiveFilters(state: IKnoxGuiState): void {
		this.withFilterStore(() => {
			knoxGuiPagesView.syncKnoxChatModelList(this, state);
			knoxGuiOverlaysView.syncHistoryList(this, state);
			knoxGuiCheckpointsView.syncCheckpointList(this, state);
			knoxGuiCheckpointsView.syncCheckpointTimeline(this, state);
			knoxGuiMemoryView.syncMemoryFilters(this, state);
		});
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

	closePromptDialog(): void {
		if (!this.controller.store.state.promptDraft) {
			return;
		}
		this.controller.store.patch({ promptDraft: undefined });
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
}
