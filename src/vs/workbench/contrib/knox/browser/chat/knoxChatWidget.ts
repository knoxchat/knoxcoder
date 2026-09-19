/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import {
	KNOX_DEFAULT_NATIVE_OVERLAY,
	knoxFtcShouldPrompt,
	KnoxNativeOverlay,
	KnoxScrolledUpContext,
} from '../../common/knoxChat.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxInputModifiers, IKnoxMessageContent, knoxHistoryItemPreview } from '../../common/knoxChatTypes.js';
import { knoxMessageContentWithImages } from '../../common/knoxImages.js';
import { knoxIsEditModeAndNoCodeToEdit, knoxIsSingleRangeEditOrInsertion } from '../../common/knoxEditMode.js';
import { describeKnoxStreamError } from '../../common/knoxStreamError.js';
import { KnoxAgentTurnMeter } from './knoxAgentChrome.js';
import { KnoxAcceptRejectAll } from './knoxAcceptRejectAll.js';
import { KnoxBackgroundJobsPanel } from './knoxBackgroundJobsPanel.js';
import { KnoxCodeToEditCard } from './knoxCodeToEditCard.js';
import { KnoxCompactionPanel } from './knoxCompactionPanel.js';
import { KnoxFindWidget } from './knoxFindWidget.js';
import { KnoxGitDiffPanel } from './knoxGitDiffPanel.js';
import { KnoxInjectedMemoriesPanel } from './knoxInjectedMemoriesPanel.js';
import { KnoxInputEditor } from './knoxInputEditor.js';
import { KnoxInputToolbar } from './knoxInputToolbar.js';
import { KnoxLump } from './knoxLump.js';
import { KnoxPermissionBar } from './knoxPermissionBar.js';
import { KnoxTabBar } from './knoxTabBar.js';
import { KnoxTaskPlanPanel } from './knoxTaskPlanPanel.js';
import { KnoxThreadList } from './knoxThreadList.js';
import { KnoxWorktreePanel } from './knoxWorktreePanel.js';
import { KnoxHistoryList } from '../history/knoxHistoryList.js';
import { KnoxCheckpointsPanel } from '../checkpoints/knoxCheckpointsPanel.js';
import { KnoxMemoryPanel } from '../memory/knoxMemoryPanel.js';
import { KnoxConfigPanel } from '../config/knoxConfigPanel.js';
import { KnoxConfigErrorPanel } from '../config/knoxConfigErrorPanel.js';
import { KnoxStatsPanel } from '../config/knoxStatsPanel.js';
import { KnoxAddModelDialog } from '../models/knoxAddModelPanel.js';
import { KnoxConfigureProviderPanel } from '../models/knoxConfigureProviderPanel.js';
import { IKnoxAddModelDialogOptions } from '../../common/knoxAddModel.js';
import { KnoxBatchDiffPanel } from '../batchDiff/knoxBatchDiffPanel.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { knoxNavigateTarget, knoxToggleNativeOverlay, KNOX_WIDGET_OVERLAYS } from '../../common/knoxNavigate.js';
import { knoxNls } from '../../common/knoxI18n.js';
import { knoxSubmitBlockedByPendingTool } from '../../common/knoxToolbar.js';
import { knoxReadFontSize, knoxReadUiBoolean } from '../../common/knoxSharedConfig.js';
import { renderKnoxToolOutput } from '../tools/knoxToolOutput.js';
import { IKnoxToolUiState } from '../tools/knoxToolCard.js';

function overlayTitle(overlay: KnoxNativeOverlay, language: 'en' | 'zh' = 'en'): string {
	const t = (key: string, fallback?: string) => knoxNls(key, undefined, fallback, language);
	switch (overlay) {
		case 'history': return t('history');
		case 'memory': return t('restoreWithMemoryShort');
		case 'config': return t('settings');
		case 'configError': return t('configErrors');
		case 'addModel': return t('addNewModel');
		case 'configureProvider': return t('configureProvider');
		case 'batchDiff': return t('batchDiff');
		case 'stats': return t('tokenUsageDashboard');
		case 'restore': return t('checkpoints');
		case 'chat': return t('chat');
	}
}

function roleLabel(role: string): string {
	switch (role) {
		case 'user': return localize('knox.role.user', "User");
		case 'assistant': return localize('knox.role.assistant', "Knox");
		case 'tool': return localize('knox.role.tool', "Tool");
		case 'thinking': return localize('knox.role.thinking', "Thinking");
		case 'system': return localize('knox.role.system', "System");
		default: return role;
	}
}

export interface IKnoxInputFocusOptions {
	clear?: boolean;
	newSession?: boolean;
}

/**
 * Native Knox chrome: WorkbenchList thread + Lump toolbar + input, plus overlay
 * views for History / Checkpoints / Memory / Config / Models / Batch Diff / Stats.
 */
export class KnoxChatWidget extends Disposable {

	readonly element: HTMLElement;

	private readonly _tabBar: KnoxTabBar;
	private readonly _body: HTMLElement;
	private readonly _threadList: KnoxThreadList;
	private readonly _find: KnoxFindWidget;
	private readonly _turnMeter: KnoxAgentTurnMeter;
	private readonly _gitDiff: KnoxGitDiffPanel;
	private readonly _compaction: KnoxCompactionPanel;
	private readonly _worktree: KnoxWorktreePanel;
	private readonly _taskPlan: KnoxTaskPlanPanel;
	private readonly _memories: KnoxInjectedMemoriesPanel;
	private readonly _jobs: KnoxBackgroundJobsPanel;
	private readonly _codeToEdit: KnoxCodeToEditCard;
	private readonly _lump: KnoxLump;
	private readonly _permissionBar: KnoxPermissionBar;
	private readonly _inputChrome: HTMLElement;
	private readonly _input: KnoxInputEditor;
	private readonly _toolbar: KnoxInputToolbar;
	private readonly _acceptReject: KnoxAcceptRejectAll;
	private readonly _inputPeek: HTMLElement;
	private readonly _inputPeekStore = this._register(new DisposableStore());
	private readonly _inputPeekUi: IKnoxToolUiState = {
		argsExpanded: new Set(),
		treeCollapsed: new Set(),
		treeTab: new Map(),
		askAnswers: new Map(),
		askIndex: new Map(),
		searchCollapsed: new Set(),
		peekExpanded: new Set(),
		terminalUnstuck: new Set(),
		terminalScrollTop: new Map(),
	};
	private readonly _overlay: HTMLElement;
	private readonly _overlayTitle: HTMLElement;
	private readonly _overlayBody: HTMLElement;
	private readonly _overlayStore = this._register(new DisposableStore());
	private _overlayWidget: { kind: KnoxNativeOverlay; refresh(): void; setProvider?(id: string): void } | undefined;
	private readonly _addModelDialog: KnoxAddModelDialog;
	private readonly _instantiationService: IInstantiationService;
	private readonly _crash: HTMLElement;
	private readonly _crashMessage: HTMLElement;
	private readonly _fatal: HTMLButtonElement;
	private readonly _scrolledUpKey: IContextKey<boolean>;

	private _overlayKind: KnoxNativeOverlay = KNOX_DEFAULT_NATIVE_OVERLAY;
	private _configureProviderId: string | undefined;
	private _lastHeight = 0;
	private _lastWidth = 0;

	private readonly _onDidChangeOverlay = this._register(new Emitter<KnoxNativeOverlay>());
	readonly onDidChangeOverlay = this._onDidChangeOverlay.event;

	private readonly _onDidFocusInput = this._register(new Emitter<void>());
	readonly onDidFocusInput = this._onDidFocusInput.event;

	private readonly _onDidBlurInput = this._register(new Emitter<void>());
	readonly onDidBlurInput = this._onDidBlurInput.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
	) {
		super();
		this._instantiationService = instantiationService;

		this._scrolledUpKey = KnoxScrolledUpContext.bindTo(contextKeyService);

		this.element = append(parent, $('.knox-chat'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.chatRegion', "Knox chat"));

		this._tabBar = this._register(instantiationService.createInstance(KnoxTabBar, this.element));
		this._register(this._tabBar.onDidChangeHeight(() => this._layoutThread()));

		this._body = append(this.element, $('.knox-chat-body'));
		this._threadList = this._register(instantiationService.createInstance(KnoxThreadList, this._body));
		this._find = this._register(instantiationService.createInstance(KnoxFindWidget, this._body, this._threadList));

		this._inputChrome = append(this._body, $('.knox-input-chrome'));
		this._codeToEdit = this._register(instantiationService.createInstance(KnoxCodeToEditCard, this._inputChrome));
		this._register(this._codeToEdit.onDidChangeHeight(() => this._layoutThread()));
		this._lump = this._register(instantiationService.createInstance(KnoxLump, this._inputChrome));
		this._register(this._lump.onDidChangeHeight(() => this._layoutThread()));
		this._turnMeter = this._register(instantiationService.createInstance(KnoxAgentTurnMeter, this._inputChrome));
		this._register(this._turnMeter.onDidSelectStep(step => this._threadList.revealStep(step)));
		this._register(this._turnMeter.onDidChangeHeight(() => this._layoutThread()));
		this._gitDiff = this._register(instantiationService.createInstance(KnoxGitDiffPanel, this._inputChrome));
		this._register(this._gitDiff.onDidChangeHeight(() => this._layoutThread()));
		this._compaction = this._register(instantiationService.createInstance(KnoxCompactionPanel, this._inputChrome));
		this._register(this._compaction.onDidChangeHeight(() => this._layoutThread()));
		this._worktree = this._register(instantiationService.createInstance(KnoxWorktreePanel, this._inputChrome));
		this._register(this._worktree.onDidChangeHeight(() => this._layoutThread()));
		this._taskPlan = this._register(instantiationService.createInstance(KnoxTaskPlanPanel, this._inputChrome));
		this._register(this._taskPlan.onDidChangeHeight(() => this._layoutThread()));
		this._memories = this._register(instantiationService.createInstance(KnoxInjectedMemoriesPanel, this._inputChrome));
		this._register(this._memories.onDidChangeHeight(() => this._layoutThread()));
		this._jobs = this._register(instantiationService.createInstance(KnoxBackgroundJobsPanel, this._inputChrome));
		this._register(this._jobs.onDidChangeHeight(() => this._layoutThread()));
		this._permissionBar = this._register(instantiationService.createInstance(KnoxPermissionBar, this._inputChrome));
		this._register(this._permissionBar.onDidChangeHeight(() => this._layoutThread()));

		const inputContainer = append(this._inputChrome, $('.knox-input-container'));
		const overflowWidgets = append(this.element, $('.knox-input-overflow'));
		this._input = this._register(instantiationService.createInstance(KnoxInputEditor, inputContainer, overflowWidgets));
		this._register(this._input.onDidFocus(() => {
			this._chatService.setKnoxInputFocused(true);
			this._onDidFocusInput.fire();
		}));
		this._register(this._input.onDidBlur(() => {
			this._chatService.setKnoxInputFocused(false);
			this._onDidBlurInput.fire();
		}));
		this._register(this._input.onDidChangeHeight(() => this._layoutThread()));
		this._register(this._input.onDidSubmit(modifiers => void this._onPrimaryAction(modifiers)));
		this._register(this._input.onDidCancelStream(() => void this._chatService.cancelStream()));
		this._register(this._input.onDidEscape(() => this._onInputEscape()));

		this._toolbar = this._register(instantiationService.createInstance(KnoxInputToolbar, this._inputChrome));
		this._register(this._toolbar.onDidChangeHeight(() => this._layoutThread()));
		this._register(this._toolbar.onDidSubmit(modifiers => void this._onPrimaryAction(modifiers)));
		this._register(this._toolbar.onDidCancel(() => void this._chatService.cancelStream()));
		this._register(this._toolbar.onDidAddContext(() => this._input.insertMentionTrigger()));
		this._register(this._toolbar.onDidPickImages(() => void this._input.pickImages()));
		this._register(this._toolbar.onDidScrollToTop(() => this.scrollToTop()));
		this._register(this._toolbar.onDidScrollToBottom(() => this.scrollToBottom()));
		this._acceptReject = this._register(instantiationService.createInstance(KnoxAcceptRejectAll, this._inputChrome));
		this._register(this._acceptReject.onDidChangeHeight(() => this._layoutThread()));
		this._inputPeek = append(this._inputChrome, $('.knox-input-context-peek'));

		this._overlay = append(this.element, $('.knox-overlay.hidden'));
		this._overlay.setAttribute('role', 'region');
		const overlayHeader = append(this._overlay, $('.knox-overlay-header'));
		const back = append(overlayHeader, $<HTMLButtonElement>('button.knox-overlay-back'));
		back.type = 'button';
		back.textContent = localize('knox.overlay.back', "Back to chat");
		this._overlayTitle = append(overlayHeader, $('div.knox-overlay-title'));
		this._overlayBody = append(this._overlay, $('.knox-overlay-body'));

		this._crash = append(this.element, $('.knox-crash.hidden'));
		this._crash.setAttribute('role', 'alert');
		append(this._crash, $('p.knox-row-error-title')).textContent = localize('knox.somethingWentWrong', "Something went wrong:");
		this._crashMessage = append(this._crash, $('pre.knox-row-error-message'));
		const restart = append(this._crash, $<HTMLButtonElement>('button.knox-overlay-back'));
		restart.type = 'button';
		restart.textContent = localize('knox.restart', "Restart");

		this._fatal = append(this.element, $<HTMLButtonElement>('button.knox-config-fatal.hidden'));
		this._fatal.type = 'button';
		this._fatal.setAttribute('role', 'alert');
		this._register(addDisposableListener(this._fatal, 'click', () => this.showOverlay('configError')));

		this._addModelDialog = this._register(instantiationService.createInstance(KnoxAddModelDialog, this.element));

		this._register(this._chatService.onDidChange(() => this._find.refresh()));
		this._register(this._chatService.onDidChange(() => this._syncConfigChrome()));
		this._register(this._chatService.onDidChange(() => this._syncInputPeek()));
		this._register(this._chatService.onDidStreamError(error => void this._showStreamError(error)));
		this._register(this._bridge.onDidReceivePush(message => this._handleIdeEvent(message.messageType, message.data)));
		this._register(this._threadList.onDidChangeScroll(state => {
			this._scrolledUpKey.set(!state.stickToBottom);
			this._toolbar.setScrollState({
				showScrollButtons: state.showScrollButtons,
				isAtTop: state.isAtTop,
				isAtBottom: state.isAtBottom,
			});
		}));
		this._register(this._threadList.onDidCrash(error => this._showCrash(error)));
		this._register(addDisposableListener(back, 'click', () => this.showOverlay('chat')));
		this._register(addDisposableListener(restart, 'click', () => this._restartAfterCrash()));

		this._renderOverlay();
		this._syncConfigChrome();
		this._syncInputPeek();
	}

	get overlay(): KnoxNativeOverlay {
		return this._overlayKind;
	}

	get findVisible(): boolean {
		return this._find.visible;
	}

	layout(height: number, width: number): void {
		this._lastHeight = height;
		this._lastWidth = width;
		this._layoutThread();
	}

	focusInput(options?: IKnoxInputFocusOptions): void {
		if (options?.newSession) {
			this._chatService.newSession();
		}
		if (options?.clear) {
			this.clearInput();
		}
		this.showOverlay('chat');
		this._input.focus();
		this._input.layout();
	}

	focusThread(): void {
		this._threadList.focus();
	}

	isInputFocused(): boolean {
		return this._input.hasFocus();
	}

	/** False while a generated tool waits for approval (GUI `sendInput` guard). */
	canSubmitInput(): boolean {
		return !knoxSubmitBlockedByPendingTool(this._chatService.history);
	}

	clearInput(): void {
		this._input.clear();
	}

	getInputValue(): string {
		return this._input.getValue();
	}

	setInputValue(value: string): void {
		this._input.setValue(value);
	}

	openFind(): void {
		this.showOverlay('chat');
		this._find.reveal();
	}

	hideFind(): void {
		this._find.hide();
		this._input.focus();
	}

	findNext(): void {
		this._find.findNext();
	}

	findPrevious(): void {
		this._find.findPrevious();
	}

	scrollToTop(): void {
		this._threadList.scrollToTop();
	}

	scrollToBottom(): void {
		this._threadList.scrollToBottom(true);
	}

	stickToBottom(): void {
		this._threadList.setStickToBottom(true);
	}

	showOverlay(overlay: KnoxNativeOverlay, options?: { provider?: string }): void {
		if (overlay !== 'chat') {
			this._chatService.setKnoxInputFocused(false);
		}
		if (overlay === 'addModel') {
			this.openAddModelDialog();
			return;
		}
		if (overlay === 'configureProvider') {
			this._configureProviderId = options?.provider;
			if (this._overlayKind === overlay) {
				this._renderOverlay();
				return;
			}
			this._overlayKind = overlay;
			this._renderOverlay();
			this._onDidChangeOverlay.fire(overlay);
			return;
		}
		if (this._overlayKind === overlay) {
			this._renderOverlay();
			return;
		}
		this._overlayKind = overlay;
		this._renderOverlay();
		this._onDidChangeOverlay.fire(overlay);
	}

	openAddModelDialog(options?: IKnoxAddModelDialogOptions): void {
		if (this._overlayKind !== 'chat') {
			this._overlayKind = 'chat';
			this._renderOverlay();
			this._onDidChangeOverlay.fire('chat');
		}
		this._addModelDialog.open(options);
	}

	accessibleContent(): string {
		if (this._overlayKind !== 'chat') {
			return overlayTitle(this._overlayKind, this._chatService.language);
		}
		const lines = this._chatService.history.map(item => {
			const preview = knoxHistoryItemPreview(item);
			return `${roleLabel(preview.role)}: ${preview.text}`;
		});
		if (!lines.length) {
			return localize('knox.emptyThread', "Ask Knox to help with this workspace.");
		}
		if (this._chatService.isStreaming) {
			lines.push(localize('knox.streaming', "Knox is responding."));
		}
		return lines.join('\n');
	}

	private _layoutThread(): void {
		if (this._overlayKind !== 'chat') {
			return;
		}
		const height = this._lastHeight || this.element.clientHeight;
		const width = this._lastWidth || this.element.clientWidth;
		this._input.layout();
		const tabs = this._tabBar.height;
		const chromeWithoutLumpContent = this._inputChrome.offsetHeight - this._lump.contentHeight;
		const remaining = Math.max(0, height - tabs - chromeWithoutLumpContent);
		const maxHeight = Math.floor(window.innerHeight * 0.7);
		this._lump.layoutExpandedContent(Math.min(remaining, maxHeight));
		const chrome = this._inputChrome.offsetHeight;
		this._threadList.layout(Math.max(0, height - chrome - tabs), width);
	}

	private _renderOverlay(): void {
		const showOverlay = this._overlayKind !== 'chat';
		this._body.classList.toggle('hidden', showOverlay);
		this._tabBar.element.classList.toggle('knox-tab-bar-suppressed', showOverlay);
		this._overlay.classList.toggle('hidden', !showOverlay);
		this._overlay.setAttribute('aria-label', overlayTitle(this._overlayKind, this._chatService.language));
		this._overlayTitle.textContent = overlayTitle(this._overlayKind, this._chatService.language);
		this._overlayBody.classList.toggle('knox-overlay-body-widget', KNOX_WIDGET_OVERLAYS.has(this._overlayKind));
		if (!showOverlay) {
			this._overlayStore.clear();
			clearNode(this._overlayBody);
			this._overlayWidget = undefined;
			this._layoutThread();
			return;
		}
		if (this._overlayWidget?.kind === this._overlayKind) {
			if (this._overlayKind === 'configureProvider' && this._configureProviderId) {
				this._overlayWidget.setProvider?.(this._configureProviderId);
			}
			this._overlayWidget.refresh();
			return;
		}
		this._overlayStore.clear();
		clearNode(this._overlayBody);
		this._overlayWidget = undefined;
		if (this._overlayKind === 'history') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxHistoryList, this._overlayBody, { compact: false }));
			this._overlayStore.add(widget.onDidOpenSession(() => this.showOverlay('chat')));
			this._overlayWidget = { kind: 'history', refresh: () => void widget.refresh() };
			return;
		}
		if (this._overlayKind === 'restore') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxCheckpointsPanel, this._overlayBody));
			this._overlayWidget = { kind: 'restore', refresh: () => widget.refresh() };
			return;
		}
		if (this._overlayKind === 'memory') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxMemoryPanel, this._overlayBody));
			this._overlayWidget = { kind: 'memory', refresh: () => widget.refresh() };
			return;
		}
		if (this._overlayKind === 'config') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxConfigPanel, this._overlayBody));
			this._overlayWidget = { kind: 'config', refresh: () => widget.refresh() };
			return;
		}
		if (this._overlayKind === 'configError') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxConfigErrorPanel, this._overlayBody));
			this._overlayWidget = { kind: 'configError', refresh: () => widget.refresh() };
			return;
		}
		if (this._overlayKind === 'addModel') {
			this.openAddModelDialog();
			return;
		}
		if (this._overlayKind === 'configureProvider') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxConfigureProviderPanel, this._overlayBody));
			if (this._configureProviderId) {
				widget.setProvider(this._configureProviderId);
			}
			this._overlayStore.add(widget.onDidAddModel(() => this.showOverlay('chat')));
			this._overlayWidget = {
				kind: 'configureProvider',
				refresh: () => widget.refresh(),
				setProvider: id => widget.setProvider(id),
			};
			return;
		}
		if (this._overlayKind === 'batchDiff') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxBatchDiffPanel, this._overlayBody));
			this._overlayWidget = { kind: 'batchDiff', refresh: () => void widget.refresh() };
			return;
		}
		if (this._overlayKind === 'stats') {
			const widget = this._overlayStore.add(this._instantiationService.createInstance(KnoxStatsPanel, this._overlayBody));
			this._overlayWidget = { kind: 'stats', refresh: () => widget.refresh() };
			return;
		}
	}

	private _syncInputPeek(): void {
		this._inputPeekStore.clear();
		clearNode(this._inputPeek);
		const gathering = this._chatService.history.some(item => item.isGatheringContext);
		if (!gathering) {
			return;
		}
		renderKnoxToolOutput(
			this._inputPeek,
			{ message: { role: 'user', content: '', id: 'input-peek' }, contextItems: [] },
			this._inputPeekUi,
			this._bridge,
			this._workspace,
			this._inputPeekStore,
			() => this._layoutThread(),
			{ gathering: true, peekKey: 'input' },
		);
	}

	private _syncConfigChrome(): void {
		this.element.style.fontSize = `${knoxReadFontSize(this._chatService.config)}px`;
		this._threadList.setShowScrollbar(knoxReadUiBoolean(this._chatService.config, 'showChatScrollbar'));
		const fatal = this._chatService.hasFatalConfigError && this._overlayKind !== 'configError';
		this._fatal.classList.toggle('hidden', !fatal);
		if (fatal) {
			this._fatal.textContent = `${knoxNls('errorExclamation', undefined, undefined, this._chatService.language)} ${knoxNls('failedToLoadConfiguration', undefined, undefined, this._chatService.language)} — ${knoxNls('learnMore', undefined, undefined, this._chatService.language)}`;
		}
		if (this._overlayKind !== 'chat') {
			this._overlayTitle.textContent = overlayTitle(this._overlayKind, this._chatService.language);
		}
	}

	private _handleIdeEvent(messageType: string, data: unknown): void {
		if (messageType === 'navigateTo' && data && typeof data === 'object') {
			const payload = data as { path?: string; toggle?: boolean };
			const target = knoxNavigateTarget(payload.path);
			if (!target) {
				return;
			}
			this.showOverlay(knoxToggleNativeOverlay(this._overlayKind, target.overlay, payload.toggle === true), { provider: target.provider });
			return;
		}
		if (messageType === 'addModel' || messageType === 'addApiKey') {
			this.openAddModelDialog();
			return;
		}
		if (messageType === 'newSessionWithPrompt') {
			this.showOverlay('chat');
			this._input.clear();
			this._input.focus();
			return;
		}
		if (messageType === 'userInput' && data && typeof data === 'object') {
			const input = (data as { input?: string }).input;
			if (typeof input === 'string' && input) {
				this.showOverlay('chat');
				this._input.appendText(input);
				if (this.canSubmitInput()) {
					this._input.submit({ noContext: true });
				}
			}
			return;
		}
		if (messageType === 'highlightedCode' && data && typeof data === 'object') {
			const payload = data as {
				rangeInFileWithContents?: {
					filepath?: string;
					contents?: string;
					description?: string;
					range?: { start: { line: number; character: number }; end: { line: number; character: number } };
				};
				prompt?: string;
				shouldRun?: boolean;
			};
			const rif = payload.rangeInFileWithContents;
			this.showOverlay('chat');
			if (rif?.filepath) {
				// GUI `highlightedCode` inserts a code block carrying the snippet
				// (`rifWithContentsToContextItem`). File-mention-only drops the
				// contents and is a regression.
				const basename = rif.filepath.split(/[\\/]/).pop() || rif.filepath;
				this._input.insertCodeBlock({
					id: rif.filepath,
					name: rif.description ?? basename,
					description: rif.description,
					filepath: rif.filepath,
					content: rif.contents ?? '',
					range: rif.range,
				});
			}
			if (payload.prompt) {
				this._input.appendText(payload.prompt);
			}
			this._input.focus();
			if (payload.shouldRun && this.canSubmitInput()) {
				this._input.submit({ noContext: true });
			}
		}
	}

	private async _onPrimaryAction(modifiers?: IKnoxInputModifiers): Promise<void> {
		if (this._chatService.isStreaming) {
			await this._chatService.cancelStream();
			return;
		}
		if (knoxIsEditModeAndNoCodeToEdit(this._chatService.mode, this._chatService.codeToEdit)) {
			return;
		}
		// GUI `Chat.tsx` `sendInput`: a generated tool is waiting for approval;
		// do not start a second turn.
		if (knoxSubmitBlockedByPendingTool(this._chatService.history)) {
			this._chatService.showToast('warning', knoxNls('cannotSubmitWhileAwaitingTool', undefined, undefined, this._chatService.language));
			return;
		}
		const text = this._input.getValue().trim();
		const images = this._input.getImages();
		if (!text && !images.length) {
			return;
		}
		if (text) {
			this._input.rememberHistory(text);
		}
		const mentions = this._input.getMentions();
		const slashCommands = this._input.getSlashCommands();
		const codeBlocks = this._input.getCodeBlocks();
		const content: IKnoxMessageContent = knoxMessageContentWithImages(text, images);
		this._input.clear();
		this._threadList.setStickToBottom(true);
		this.showOverlay('chat');
		const count = this._chatService.incrementFtc();
		if (knoxFtcShouldPrompt(count)) {
			void this._dialogService.info(knoxNls('ftcThanksTitle'), knoxNls('ftcThanks'));
		}
		const editorState = { mentions, slashCommands, codeBlocks };
		try {
			if (knoxIsSingleRangeEditOrInsertion(this._chatService.mode, this._chatService.codeToEdit) && this._chatService.codeToEdit.length) {
				await this._chatService.sendEditPrompt({ content, modifiers, editorState });
			} else {
				await this._chatService.streamResponse({ content, modifiers, editorState });
			}
		} catch {
			// Stream error dialog is shown via onDidStreamError.
		}
	}

	private _onInputEscape(): void {
		if (this._chatService.mode === 'edit') {
			void this._chatService.exitEditMode();
			return;
		}
		this.stickToBottom();
		this._chatService.focusEditor();
	}

	private async _showStreamError(error: unknown): Promise<void> {
		const info = describeKnoxStreamError(error, this._chatService.defaultModel);
		await this._dialogService.error(info.title, info.detail);
	}

	private _showCrash(error: unknown): void {
		this._crashMessage.textContent = error instanceof Error ? (error.stack || error.message) : String(error);
		this._crash.classList.remove('hidden');
		this._body.classList.add('hidden');
		this._tabBar.element.classList.add('knox-tab-bar-suppressed');
		this._notificationService.error(localize('knox.somethingWentWrong', "Something went wrong:"));
	}

	private _restartAfterCrash(): void {
		this._chatService.newSession();
		this._crash.classList.add('hidden');
		this._body.classList.remove('hidden');
		this._tabBar.element.classList.remove('knox-tab-bar-suppressed');
		this.showOverlay('chat');
		this._threadList.refresh();
		this._layoutThread();
		this.focusInput({ clear: true });
	}
}
