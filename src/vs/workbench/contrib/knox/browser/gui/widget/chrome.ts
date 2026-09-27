/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import {
	knoxGuiLumpLabelVisible,
	knoxGuiRelativeFontSize,
	knoxGuiRunningJobCount,
	knoxGuiShowsScrollButtons,
	KNOX_GUI_LUMP_TOOLBAR,
} from '../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { nextExpandedStart } from '../../../common/knoxGuiChat.js';
import { knoxGuiIsMetaEquivalent } from '../../../common/knoxGuiInput.js';
import { visibleBackgroundJobs } from '../../../common/knoxGuiPanels.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState, KnoxPermissionMode, PERMISSION_MODES, knoxGuiIsDedicatedEditor } from '../../../common/knoxGuiState.js';
import { pendingApplyStates } from '../../../common/knoxGuiTranscript.js';
import { onCheckpointGraphKeyDown } from './checkpointGraph.js';

export function renderFatalBanner(widget: KnoxGuiWidget, state: IKnoxGuiState): void { // KN-377 Layout.tsx footer
	const banner = DOM.append(widget.root, DOM.$('.knox-gui-fatal'));
	banner.setAttribute('role', 'alert');
	banner.setAttribute('data-testid', 'knox-gui-fatal');
	const strong = DOM.append(banner, DOM.$('strong'));
	strong.textContent = t(state, 'errorExclamation');
	banner.append(` ${t(state, 'failedToLoadConfiguration')}`);
	DOM.append(banner, DOM.$('div.knox-gui-fatal-more', undefined, t(state, 'learnMore')));
	widget.renderStore.add(DOM.addDisposableListener(banner, 'click', () => widget.controller.store.navigate('/config-error')));
}

export function shouldShowComposer(widget: KnoxGuiWidget, state: IKnoxGuiState): boolean {
	return state.route === KnoxGuiRoute.Chat && !knoxGuiIsDedicatedEditor(state);
}

export function renderToolbar(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const bar = DOM.append(parent, DOM.$('.knox-gui-toolbar.knox-gui-lump'));
	bar.setAttribute('data-testid', 'knox-gui-lump');
	bar.setAttribute('data-composer-slot', 'lump');
	bar.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	const left = DOM.append(bar, DOM.$('.knox-gui-toolbar-left'));
	widget.chromeButton(left, {
		svg: 'square-plus',
		title: t(state, 'newChat'),
		testId: 'knox-gui-new-chat',
		onClick: () => void widget.controller.newSession(),
	});
	for (const overlay of KNOX_GUI_LUMP_TOOLBAR) {
		const selected = knoxGuiLumpLabelVisible(state.overlay, overlay.id);
		widget.chromeButton(left, {
			svg: overlay.svg,
			label: t(state, overlay.key),
			expandLabel: true,
			selected,
			title: t(state, overlay.key),
			testId: `knox-gui-lump-${overlay.id}`,
			onClick: () => widget.controller.setOverlay(overlay.id),
		});
	}
	DOM.append(bar, DOM.$('.knox-gui-toolbar-spacer'));
	widget.renderMode(bar, state);
}

export function renderMode(widget: KnoxGuiWidget, bar: HTMLElement, state: IKnoxGuiState): void {
	const wrap = DOM.append(bar, DOM.$('.knox-gui-mode'));
	wrap.setAttribute('data-testid', 'knox-gui-mode');
	const running = knoxGuiRunningJobCount(visibleBackgroundJobs(state));
	const streaming = state.isStreaming;

	widget.chromeButton(wrap, {
		label: t(state, 'chat'),
		selected: state.mode === 'chat',
		disabled: streaming,
		title: `${t(state, 'chatMode')} (⌘L)`,
		testId: 'knox-gui-mode-chat',
		extraClass: 'knox-gui-mode-tab',
		onClick: () => {
			widget.closeMenus();
			if (!streaming && state.mode !== 'chat') {
				widget.controller.setMode('chat');
			}
		},
	});

	const agentDisabled = streaming || !state.toolsSupported;
	const agentWrap = DOM.append(wrap, DOM.$('.knox-gui-mode-agent-wrap'));
	const agentBtn = widget.chromeButton(agentWrap, {
		label: t(state, 'agent'),
		selected: state.mode === 'agent',
		disabled: agentDisabled && state.mode !== 'agent',
		title: !state.toolsSupported ? t(state, 'agentModeNotSupported') : state.mode === 'agent' ? t(state, 'agentOptions') : t(state, 'agentMode'),
		testId: 'knox-gui-mode-agent',
		extraClass: `knox-gui-mode-tab${state.toolsSupported ? '' : ' knox-gui-mode-unsupported'}`,
		menuTrigger: true,
		onClick: () => {
			if (streaming) {
				return;
			}
			if (!state.toolsSupported) {
				return;
			}
			if (state.mode === 'agent') {
				widget.toggleMenu('agent');
				return;
			}
			widget.closeMenus();
			widget.controller.setMode('agent');
		},
	});
	if (state.mode === 'agent') {
		if (running) {
			DOM.append(agentBtn, DOM.$('span.knox-gui-job-count', undefined, String(running)));
		}
		appendKnoxGuiSvg(agentBtn, 'chevron-down', 10);
	}
	if (widget.openMenu === 'agent' && state.mode === 'agent') {
		widget.renderAgentMenu(agentWrap, state, running);
	}

	if (state.mode === 'edit') {
		widget.chromeButton(wrap, {
			label: t(state, 'edit'),
			selected: true,
			title: t(state, 'edit'),
			testId: 'knox-gui-mode-edit',
			extraClass: 'knox-gui-mode-tab',
			onClick: () => { /* already in edit */ },
		});
	}
}

export function renderAgentMenu(widget: KnoxGuiWidget, anchor: HTMLElement, state: IKnoxGuiState, running: number): void {
	const menu = DOM.append(anchor, DOM.$('.knox-gui-popover.knox-gui-agent-menu'));
	menu.setAttribute('data-testid', 'knox-gui-agent-menu');
	menu.setAttribute('role', 'menu');
	const group = DOM.append(menu, DOM.$('.knox-gui-popover-group'));
	DOM.append(group, DOM.$('.knox-gui-popover-label', undefined, t(state, 'permissionModeGroup')));
	const permissionLabel: Record<KnoxPermissionMode, string> = {
		default: t(state, 'permissionModeAsk'),
		acceptEdits: t(state, 'permissionModeEdits'),
		fullAuto: t(state, 'permissionModeAuto'),
	};
	const permissionHint: Record<KnoxPermissionMode, string> = {
		default: t(state, 'permissionModeAskHint'),
		acceptEdits: t(state, 'permissionModeEditsHint'),
		fullAuto: t(state, 'permissionModeAutoHint'),
	};
	for (const mode of PERMISSION_MODES) {
		const row = DOM.append(group, DOM.$('button.knox-gui-popover-item')) as HTMLButtonElement;
		row.type = 'button';
		row.disabled = state.isStreaming;
		if (mode === 'fullAuto' && state.permissionMode === mode) {
			row.classList.add('knox-gui-popover-auto');
		}
		if (state.permissionMode === mode) {
			appendKnoxGuiSvg(row, 'check', 12);
		} else {
			DOM.append(row, DOM.$('span.knox-gui-popover-check-slot'));
		}
		row.append(permissionLabel[mode]);
		widget.hover(row, `${permissionHint[mode]} (Shift+Tab)`);
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			widget.closeMenus();
			widget.controller.setPermissionMode(mode);
		}));
	}
	DOM.append(menu, DOM.$('.knox-gui-popover-sep'));
	const worktree = DOM.append(menu, DOM.$('button.knox-gui-popover-item')) as HTMLButtonElement;
	worktree.type = 'button';
	worktree.disabled = state.isStreaming || state.worktree.busy;
	if (state.worktree.enabled) {
		appendKnoxGuiSvg(worktree, 'check', 12);
	} else {
		DOM.append(worktree, DOM.$('span.knox-gui-popover-check-slot'));
	}
	worktree.append(t(state, 'worktreeChip'));
	widget.hover(worktree, state.worktree.enabled ? t(state, 'worktreeLeaveHint') : t(state, 'worktreeEnterHint'));
	widget.renderStore.add(DOM.addDisposableListener(worktree, 'click', e => {
		e.stopPropagation();
		widget.closeMenus();
		void widget.controller.runWorktree(state.worktree.enabled ? 'discard' : 'enter');
	}));
	const jobs = DOM.append(menu, DOM.$('button.knox-gui-popover-item')) as HTMLButtonElement;
	jobs.type = 'button';
	if (state.jobsPanelOpen) {
		appendKnoxGuiSvg(jobs, 'check', 12);
	} else {
		DOM.append(jobs, DOM.$('span.knox-gui-popover-check-slot'));
	}
	jobs.append(running > 0 ? t(state, 'jobsChipCount', { count: running }) : t(state, 'jobsChip'));
	widget.hover(jobs, state.jobsPanelOpen ? t(state, 'jobsChipHintOpen') : t(state, 'jobsChipHint'));
	widget.renderStore.add(DOM.addDisposableListener(jobs, 'click', e => {
		e.stopPropagation();
		widget.closeMenus();
		widget.controller.store.patch({ jobsPanelOpen: !state.jobsPanelOpen });
	}));
}

export function renderFind(widget: KnoxGuiWidget, state: IKnoxGuiState): void { // KN-377
	const row = DOM.append(widget.root, DOM.$('.knox-gui-find.find-widget-skip'));
	row.setAttribute('data-testid', 'knox-gui-find');
	const input = DOM.append(row, DOM.$('input')) as HTMLInputElement;
	widget.findInput = input;
	input.value = state.find.query;
	input.placeholder = t(state, 'search');
	input.setAttribute('aria-label', t(state, 'search'));
	input.setAttribute('data-knox-find-input', 'true');
	input.disabled = state.isStreaming;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => widget.controller.updateFind({ query: input.value })));
	widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			widget.controller.closeFind();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			widget.controller.stepFind(e.shiftKey ? -1 : 1);
		}
	}));
	DOM.append(row, DOM.$('span.knox-gui-find-count', undefined, state.find.total ? t(state, 'matchCount', { current: state.find.current + 1, total: state.find.total }) : t(state, 'noResults')));
	widget.chromeButton(row, {
		svg: 'arrow-up',
		svgSize: 16,
		title: t(state, 'previousMatch'),
		extraClass: 'knox-gui-find-nav',
		disabled: state.find.total < 2 || state.isStreaming,
		onClick: () => widget.controller.stepFind(-1),
	});
	widget.chromeButton(row, {
		svg: 'arrow-down',
		svgSize: 16,
		title: t(state, 'nextMatch'),
		extraClass: 'knox-gui-find-nav',
		disabled: state.find.total < 2 || state.isStreaming,
		onClick: () => widget.controller.stepFind(1),
	});
	widget.chromeButton(row, {
		label: 'Aa',
		selected: state.find.caseSensitive,
		title: t(state, state.find.caseSensitive ? 'closeCaseSensitive' : 'openCaseSensitive'),
		extraClass: 'knox-gui-find-toggle',
		disabled: state.isStreaming,
		onClick: () => widget.controller.updateFind({ caseSensitive: !state.find.caseSensitive }),
	});
	widget.chromeButton(row, {
		label: '.*',
		selected: state.find.regex,
		title: t(state, state.find.regex ? 'closeRegex' : 'openRegex'),
		extraClass: 'knox-gui-find-toggle',
		disabled: state.isStreaming,
		onClick: () => widget.controller.updateFind({ regex: !state.find.regex }),
	});
	widget.chromeButton(row, {
		svg: 'x',
		svgSize: 16,
		title: t(state, 'close'),
		extraClass: 'knox-gui-find-close',
		onClick: () => widget.controller.closeFind(),
	});
}

export function renderTabs(widget: KnoxGuiWidget, state: IKnoxGuiState): void { // KN-377
	const row = DOM.append(widget.root, DOM.$('.knox-gui-tabs'));
	row.setAttribute('data-testid', 'knox-gui-tabs');
	row.setAttribute('role', 'tablist');
	for (const tab of state.tabs) {
		const active = tab.id === state.activeTabId;
		const el = DOM.append(row, DOM.$('div.knox-gui-tab'));
		el.setAttribute('role', 'tab');
		el.tabIndex = 0;
		el.setAttribute('aria-selected', active ? 'true' : 'false');
		el.setAttribute('data-testid', `knox-gui-tab-${tab.id}`);
		if (active) {
			el.classList.add('active');
		}
		const title = DOM.append(el, DOM.$('span.knox-gui-tab-title', undefined, tab.title));
		title.title = tab.title;
		widget.renderStore.add(DOM.addDisposableListener(el, 'click', () => void widget.controller.activateTab(tab.id)));
		widget.renderStore.add(DOM.addDisposableListener(el, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				void widget.controller.activateTab(tab.id);
			}
		}));
		widget.chromeButton(el, {
			svg: 'x',
			svgSize: 12,
			title: t(state, 'close'),
			extraClass: 'knox-gui-tab-close',
			onClick: () => void widget.controller.closeTab(tab.id),
		});
	}
	DOM.append(row, DOM.$('.knox-gui-tabs-rest'));
}

export function renderRoute(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	switch (state.route) {
		case KnoxGuiRoute.History:
			widget.renderHistoryPage(body, state);
			return;
		case KnoxGuiRoute.Stats:
			widget.renderStats(body, state);
			return;
		case KnoxGuiRoute.Config:
			widget.renderSettings(body, state, false);
			return;
		case KnoxGuiRoute.ConfigError:
			widget.renderConfigError(body, state);
			return;
		case KnoxGuiRoute.AddModel:
		case KnoxGuiRoute.AddModelProvider:
			widget.renderAddModel(body, state);
			return;
		case KnoxGuiRoute.BatchDiff:
			widget.renderBatchDiff(body, state);
			return;
		case KnoxGuiRoute.Memory:
			widget.renderMemory(body, state);
			return;
		case KnoxGuiRoute.CheckpointGraph:
			widget.renderCheckpoints(body, state);
			return;
		default:
			widget.renderChat(body, state);
	}
}

export function renderErrorFallback(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, error: unknown): void {
	const fallback = DOM.append(body, DOM.$('.knox-gui-error-boundary'));
	fallback.setAttribute('role', 'alert');
	fallback.setAttribute('data-testid', 'knox-gui-error-boundary');
	DOM.append(fallback, DOM.$('h4.knox-gui-error-title', undefined, t(state, 'oopsSomethingWentWrong')));
	const detail = error instanceof Error ? (error.message || String(error)) : String(error);
	DOM.append(fallback, DOM.$('code.knox-gui-error-code', undefined, detail));
	widget.chromeButton(fallback, {
		svg: widget.errorFallbackReady ? 'rotate-cw' : 'flag',
		svgSize: 20,
		label: t(state, 'knox'),
		extraClass: widget.errorFallbackReady ? 'knox-gui-error-home' : 'knox-gui-error-home knox-gui-error-flag',
		onClick: () => {
			widget.controller.store.newSession();
			widget.controller.store.navigate('/');
		},
	});
}

export function renderScrollButtons(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.history.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-scroll-btns'));
	widget.scrollTopBtn = widget.chromeButton(wrap, {
		icon: 'codicon-chevron-up',
		title: t(state, 'scrollToTop'),
		testId: 'knox-gui-scroll-top',
		onClick: () => widget.scrollTranscript('top'),
	});
	widget.scrollBottomBtn = widget.chromeButton(wrap, {
		icon: 'codicon-chevron-down',
		title: t(state, 'scrollToBottom'),
		testId: 'knox-gui-scroll-bottom',
		onClick: () => widget.scrollTranscript('bottom'),
	});
}

export function onRootKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent): void {
	const state = widget.controller.store.state;
	const meta = knoxGuiIsMetaEquivalent(e);
	if (onCheckpointGraphKeyDown(widget, e, state)) {
		e.stopPropagation();
		return;
	}
	if (!meta && e.key === '/' && state.route === KnoxGuiRoute.CheckpointGraph && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
		if (state.checkpointView === 'checkpoints') {
			e.preventDefault();
			widget.checkpointListSearchInput?.focus();
			return;
		}
		if (state.checkpointView === 'timeline') {
			e.preventDefault();
			widget.checkpointTimelineSearchInput?.focus();
			return;
		}
	}
	if (meta && e.key.toLowerCase() === 'f' && !e.shiftKey) {
		e.preventDefault();
		e.stopPropagation();
		widget.openFind();
		return;
	}
	if (meta && e.key === "'") {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.cycleChatModel(e.shiftKey ? -1 : 1);
		return;
	}
	if (meta && e.shiftKey && e.key === 'Enter') {
		if (pendingApplyStates(state.applyStates).length) {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.acceptAllApplies();
		}
		return;
	}
	if (e.key === 'Backspace' && meta && e.shiftKey) {
		if (pendingApplyStates(state.applyStates).length) {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.rejectAllApplies();
		}
		return;
	}
	if (e.key === 'Backspace' && meta && !e.shiftKey) {
		widget.controller.cancel();
	}
	if (e.key === 'Escape') {
		if (widget.expandedRuleIndex !== null) {
			e.preventDefault();
			widget.closeRuleDialog();
			return;
		}
		if (state.promptDraft) {
			e.preventDefault();
			widget.closePromptDialog();
			return;
		}
		if (widget.openMenu) {
			e.preventDefault();
			widget.closeMenus();
			return;
		}
		widget.onEscape(e, state);
	}
}

export function onRootMouseDown(widget: KnoxGuiWidget, e: MouseEvent): void {
	const target = e.target as HTMLElement | null;
	if (!target?.closest('.knox-gui-osr-menu')) {
		widget.hideOsrMenu();
	}
	if (!widget.openMenu && !widget.openRoleMenu) {
		return;
	}
	if (target?.closest('.knox-gui-popover, [data-menu-trigger]')) {
		return;
	}
	widget.closeMenus();
}

export function onRootContextMenu(widget: KnoxGuiWidget, e: MouseEvent): void {
	if (isMacintosh) {
		return;
	}
	const target = e.target as HTMLElement | null;
	const editable = target?.closest('[contenteditable="true"], input, textarea') as HTMLElement | null;
	if (!editable) {
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	widget.hideOsrMenu();
	const selection = window.getSelection();
	const selected = selection?.toString() ?? '';
	const isEditable = editable.isContentEditable || editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement;
	const canCopy = selected.length > 0;
	const canCut = isEditable && canCopy;
	const menu = DOM.append(widget.root, DOM.$('.knox-gui-osr-menu'));
	menu.setAttribute('data-testid', 'knox-gui-osr-menu');
	const rect = widget.root.getBoundingClientRect();
	menu.style.left = `${Math.max(4, e.clientX - rect.left)}px`;
	menu.style.top = `${Math.max(4, e.clientY - rect.top)}px`;
	const run = (command: 'cut' | 'copy' | 'paste') => {
		editable.focus();
		document.execCommand(command);
		widget.hideOsrMenu();
	};
	if (canCopy) {
		widget.chromeButton(menu, { label: t(widget.controller.store.state, 'copy'), extraClass: 'knox-gui-osr-item', onClick: () => run('copy') });
	}
	if (canCut) {
		widget.chromeButton(menu, { label: t(widget.controller.store.state, 'cut'), extraClass: 'knox-gui-osr-item', onClick: () => run('cut') });
	}
	if (isEditable) {
		widget.chromeButton(menu, { label: t(widget.controller.store.state, 'paste'), extraClass: 'knox-gui-osr-item', onClick: () => run('paste') });
	}
	widget.osrMenuEl = menu;
}

export function hideOsrMenu(widget: KnoxGuiWidget): void {
	widget.osrMenuEl?.remove();
	widget.osrMenuEl = undefined;
}

export function toggleMenu(widget: KnoxGuiWidget, menu: 'agent' | 'model' | 'effort'): void {
	widget.openMenu = widget.openMenu === menu ? null : menu;
	widget.render();
}

export function closeMenus(widget: KnoxGuiWidget): void {
	if (!widget.openMenu && !widget.openRoleMenu) {
		return;
	}
	widget.openMenu = null;
	widget.openRoleMenu = null;
	widget.render();
}

export function onEscape(widget: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): void {
	if (state.addModelModal) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.closeAddModelModal();
		return;
	}
	if (widget.checkpointDetailsId) {
		e.preventDefault();
		e.stopPropagation();
		widget.checkpointDetailsId = null;
		widget.checkpointDetails = null;
		widget.render();
		return;
	}
	if (state.find.open) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.closeFind();
		return;
	}
	if (state.mentionOpen || state.slashOpen) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.closeSuggest();
		return;
	}
	if (state.addFileOpen) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.store.patch({ addFileOpen: false });
		return;
	}
	if (!widget.autoScrollEnabled && state.route === KnoxGuiRoute.Chat) {
		e.preventDefault();
		e.stopPropagation();
		widget.scrollTranscript('bottom');
		return;
	}
	if (state.mode === 'edit') {
		e.preventDefault();
		e.stopPropagation();
		void widget.controller.exitEditMode();
		return;
	}
	e.stopPropagation();
	widget.controller.focusHostEditor();
}

export function loadEarlier(widget: KnoxGuiWidget): void {
	if (widget.displayStart <= 0 || widget.loadingEarlier) {
		return;
	}
	widget.loadingEarlier = true;
	widget.pendingRestoreHeight = widget.bodyEl?.scrollHeight ?? null;
	widget.expandedStart = nextExpandedStart(widget.displayStart);
	widget.render();
}

export function restoreTranscriptScroll(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const body = widget.bodyEl;
	if (!body || state.route !== KnoxGuiRoute.Chat) {
		widget.loadingEarlier = false;
		return;
	}
	queueMicrotask(() => {
		if (widget.pendingRestoreHeight != null) {
			body.scrollTop += body.scrollHeight - widget.pendingRestoreHeight;
			widget.pendingRestoreHeight = null;
			widget.loadingEarlier = false;
		} else if (widget.autoScrollEnabled) {
			body.scrollTop = body.scrollHeight;
		} else {
			body.scrollTop = widget.savedScrollTop;
		}
		widget.savedScrollTop = body.scrollTop;
		widget.syncScrollButtons();
		if (state.find.open && state.find.matchIndexes.length) {
			const hit = state.find.matchIndexes[state.find.current];
			body.querySelector<HTMLElement>(`[data-testid="history-row-${hit}"]`)?.scrollIntoView({ block: 'center' });
		}
	});
}

export function attachTranscriptScroll(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (state.route !== KnoxGuiRoute.Chat) {
		return;
	}
	widget.renderStore.add(DOM.addDisposableListener(body, 'scroll', () => {
		widget.savedScrollTop = body.scrollTop;
		const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
		widget.autoScrollEnabled = atBottom;
		widget.syncScrollButtons();
		if (body.scrollTop < 48 && widget.displayStart > 0 && !widget.loadingEarlier) {
			widget.loadEarlier();
		}
	}));
}

export function scrollTranscript(widget: KnoxGuiWidget, to: 'top' | 'bottom'): void {
	const body = widget.bodyEl;
	if (!body) {
		return;
	}
	if (to === 'top') {
		widget.autoScrollEnabled = false;
		if (widget.displayStart > 0) {
			widget.expandedStart = 0;
			widget.render();
			queueMicrotask(() => {
				if (widget.bodyEl) {
					widget.bodyEl.scrollTop = 0;
				}
			});
			return;
		}
		body.scrollTop = 0;
	} else {
		widget.autoScrollEnabled = true;
		body.scrollTop = body.scrollHeight;
	}
	widget.syncScrollButtons();
}

export function syncScrollButtons(widget: KnoxGuiWidget): void {
	const body = widget.bodyEl;
	const wrap = widget.scrollTopBtn?.parentElement;
	if (!body || !wrap) {
		return;
	}
	const hasScrollable = knoxGuiShowsScrollButtons(widget.controller.store.state.history.length, body.scrollHeight > body.clientHeight + 8);
	wrap.classList.toggle('hidden', !hasScrollable);
	const atTop = body.scrollTop < 8;
	const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
	if (widget.scrollTopBtn) {
		widget.scrollTopBtn.disabled = atTop;
		widget.scrollTopBtn.classList.toggle('disabled', atTop);
	}
	if (widget.scrollBottomBtn) {
		widget.scrollBottomBtn.disabled = atBottom;
		widget.scrollBottomBtn.classList.toggle('disabled', atBottom);
	}
}
