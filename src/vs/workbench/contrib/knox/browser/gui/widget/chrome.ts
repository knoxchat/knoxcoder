/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import {
	knoxGuiLumpLabelVisible,
	knoxGuiRelativeFontSize,
	knoxGuiRunningJobCount,
	knoxGuiShowsChatScrollbar,
	knoxGuiShowsMainComposer,
	knoxGuiShowsScrollButtons,
	knoxGuiAnchorPopoverBox,
	KNOX_GUI_FIND_DEBOUNCE_MS,
	KNOX_GUI_FIND_RESIZE_DEBOUNCE_MS,
	KNOX_GUI_LUMP_TOOLBAR,
	knoxGuiMetaKeyLabel,
} from '../../../common/knoxGuiChrome.js';
import { knoxGuiListboxNextIndex } from '../../../common/knoxGuiCapabilities.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { CHAT_SCROLL_BOTTOM_THRESHOLD_PX, knoxGuiFindRegexInvalid, knoxGuiNextScrollFollow, knoxGuiShouldLoadEarlier, knoxGuiTranscriptRestoreTop, nextExpandedStart } from '../../../common/knoxGuiChat.js';
import { knoxGuiIsMetaEquivalent } from '../../../common/knoxGuiInput.js';
import { visibleBackgroundJobs } from '../../../common/knoxGuiPanels.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState, KnoxPermissionMode, PERMISSION_MODES } from '../../../common/knoxGuiState.js';
import { pendingApplyStates } from '../../../common/knoxGuiTranscript.js';
import { onCheckpointGraphKeyDown } from './checkpointGraph.js';
import { checkpointTimelineEscape } from './checkpoints.js';
import { onHistoryKeyDown } from './overlays.js';

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
	return knoxGuiShowsMainComposer(state);
}

export function renderToolbar(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const bar = DOM.append(parent, DOM.$('.knox-gui-toolbar.knox-gui-lump'));
	bar.setAttribute('data-testid', 'knox-gui-lump');
	bar.setAttribute('data-composer-slot', 'lump');
	bar.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	const left = DOM.append(bar, DOM.$('.knox-gui-toolbar-left.knox-gui-xs-hide'));
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
	wrap.style.fontSize = `${state.fontSize}px`;
	const running = knoxGuiRunningJobCount(visibleBackgroundJobs(state));
	const streaming = state.isStreaming;
	// ModeSelect.tsx: no configured model yet renders the active tab in the warning color.
	const noModel = widget.controller.chatModels().length === 0;
	const noModelClass = noModel ? ' knox-gui-mode-nomodel' : '';

	widget.chromeButton(wrap, {
		label: t(state, 'chat'),
		selected: state.mode === 'chat',
		disabled: streaming,
		title: `${t(state, 'chatMode')} (${knoxGuiMetaKeyLabel(isMacintosh)}L)`,
		testId: 'knox-gui-mode-chat',
		extraClass: `knox-gui-mode-tab${noModelClass}`,
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
		extraClass: `knox-gui-mode-tab${state.toolsSupported ? '' : ' knox-gui-mode-unsupported'}${noModelClass}`,
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
	agentBtn.setAttribute('aria-haspopup', 'menu');
	agentBtn.setAttribute('aria-expanded', String(widget.openMenu === 'agent' && state.mode === 'agent'));
	agentBtn.setAttribute('aria-controls', 'knox-gui-agent-menu');
	if (state.mode === 'agent') {
		if (running) {
			DOM.append(agentBtn, DOM.$('span.knox-gui-job-count', undefined, String(running)));
		}
		appendKnoxGuiSvg(agentBtn, 'chevron-down', 10);
	}
	widget.renderStore.add(DOM.addDisposableListener(agentBtn, 'keydown', e => {
		if (state.mode !== 'agent' || streaming || !state.toolsSupported) {
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			if (widget.openMenu !== 'agent') {
				widget.toggleMenu('agent');
			}
		}
	}));
	if (widget.openMenu === 'agent' && state.mode === 'agent') {
		widget.renderAgentMenu(agentBtn, state, running);
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

export function renderAgentMenu(widget: KnoxGuiWidget, trigger: HTMLElement, state: IKnoxGuiState, running: number): void {
	const menu = DOM.append(widget.root, DOM.$('.knox-gui-popover.knox-gui-agent-menu'));
	menu.id = 'knox-gui-agent-menu';
	menu.setAttribute('data-testid', 'knox-gui-agent-menu');
	menu.setAttribute('role', 'menu');
	const rows: HTMLButtonElement[] = [];
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
		row.setAttribute('role', 'menuitemradio');
		row.setAttribute('aria-checked', String(state.permissionMode === mode));
		row.disabled = state.isStreaming;
		rows.push(row);
		if (state.permissionMode === mode) {
			row.classList.add(mode === 'fullAuto' ? 'knox-gui-popover-auto' : 'knox-gui-popover-active');
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
	worktree.setAttribute('role', 'menuitemcheckbox');
	worktree.setAttribute('aria-checked', String(state.worktree.enabled));
	worktree.disabled = state.isStreaming || state.worktree.busy;
	rows.push(worktree);
	if (state.worktree.enabled) {
		worktree.classList.add('knox-gui-popover-active');
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
	jobs.setAttribute('role', 'menuitemcheckbox');
	jobs.setAttribute('aria-checked', String(state.jobsPanelOpen));
	rows.push(jobs);
	if (running > 0) {
		jobs.classList.add('knox-gui-popover-active');
	}
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
		widget.controller.toggleJobsPanel();
	}));
	widget.renderStore.add(DOM.addDisposableListener(menu, 'keydown', e => {
		const index = rows.indexOf(e.target as HTMLButtonElement);
		const next = knoxGuiListboxNextIndex(e.key, index, rows.length);
		if (next !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			rows[next].focus();
		}
	}));
	widget.anchorPopover(menu, trigger, { minWidth: 192, align: 'end' });
	queueMicrotask(() => {
		const selected = rows.find(row => row.getAttribute('aria-checked') === 'true' && !row.disabled) ?? rows.find(row => !row.disabled) ?? rows[0];
		selected?.focus();
	});
}

export function renderFind(widget: KnoxGuiWidget, state: IKnoxGuiState): void { // KN-377
	const row = DOM.append(widget.root, DOM.$('.knox-gui-find.find-widget-skip'));
	row.setAttribute('data-testid', 'knox-gui-find');
	const open = state.find.open;
	row.classList.toggle('is-closed', !open);
	row.setAttribute('aria-hidden', open ? 'false' : 'true');
	if (!open) {
		row.setAttribute('inert', '');
	}
	const input = DOM.append(row, DOM.$('input')) as HTMLInputElement;
	widget.findInput = input;
	input.value = widget.findQueryDraft || state.find.query;
	input.placeholder = t(state, 'search');
	input.setAttribute('aria-label', t(state, 'search'));
	input.setAttribute('data-knox-find-input', 'true');
	input.disabled = state.isStreaming || !open;
	input.tabIndex = open ? 0 : -1;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.findQueryDraft = input.value;
		if (widget.findQueryTimer) {
			clearTimeout(widget.findQueryTimer);
		}
		widget.findQueryTimer = setTimeout(() => {
			widget.findQueryTimer = undefined;
			widget.controller.updateFind({ query: widget.findQueryDraft });
		}, KNOX_GUI_FIND_DEBOUNCE_MS);
	}));
	widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			widget.controller.closeFind();
		} else if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			if (widget.findQueryTimer) {
				clearTimeout(widget.findQueryTimer);
				widget.findQueryTimer = undefined;
				widget.controller.updateFind({ query: widget.findQueryDraft });
			}
			widget.controller.stepFind(e.shiftKey ? -1 : 1);
		}
	}));
	const count = DOM.append(row, DOM.$('span.knox-gui-find-count', undefined, widget.findResizing ? t(state, 'noResults') : (state.find.total ? t(state, 'matchCount', { current: state.find.current + 1, total: state.find.total }) : t(state, 'noResults'))));
	count.setAttribute('data-testid', 'knox-gui-find-count');
	widget.chromeButton(row, {
		svg: 'arrow-up',
		svgSize: 16,
		title: t(state, 'previousMatch'),
		extraClass: 'knox-gui-find-nav',
		disabled: !open || state.find.total < 2 || state.isStreaming,
		onClick: () => widget.controller.stepFind(-1),
	});
	widget.chromeButton(row, {
		svg: 'arrow-down',
		svgSize: 16,
		title: t(state, 'nextMatch'),
		extraClass: 'knox-gui-find-nav',
		disabled: !open || state.find.total < 2 || state.isStreaming,
		onClick: () => widget.controller.stepFind(1),
	});
	widget.chromeButton(row, {
		label: 'Aa',
		selected: state.find.caseSensitive,
		title: t(state, state.find.caseSensitive ? 'closeCaseSensitive' : 'openCaseSensitive'),
		extraClass: 'knox-gui-find-toggle',
		disabled: !open || state.isStreaming,
		onClick: () => widget.controller.updateFind({ caseSensitive: !state.find.caseSensitive }),
	});
	const regexInvalid = knoxGuiFindRegexInvalid(state.find.query, state.find.regex);
	widget.chromeButton(row, {
		label: '.*',
		selected: state.find.regex,
		title: t(state, regexInvalid ? 'invalidFindRegex' : (state.find.regex ? 'closeRegex' : 'openRegex')),
		extraClass: regexInvalid ? 'knox-gui-find-toggle is-invalid' : 'knox-gui-find-toggle',
		testId: 'knox-gui-find-regex',
		disabled: !open || state.isStreaming,
		onClick: () => widget.controller.updateFind({ regex: !state.find.regex }),
	});
	widget.chromeButton(row, {
		svg: 'x',
		svgSize: 16,
		title: t(state, 'close'),
		extraClass: 'knox-gui-find-close',
		disabled: !open,
		onClick: () => widget.controller.closeFind(),
	});
}

export function onPaneResize(widget: KnoxGuiWidget): void {
	const state = widget.controller.store.state;
	const body = widget.bodyEl;
	if (body) {
		const tall = knoxGuiShowsChatScrollbar(state.showChatScrollbar, Math.max(widget.root.clientHeight, window.innerHeight));
		body.classList.toggle('knox-gui-body-scroll', tall);
		body.classList.toggle('knox-gui-body-no-scroll', !tall);
	}
	if (!state.find.open) {
		return;
	}
	widget.findResizing = true;
	widget.root.classList.add('knox-gui-find-resizing');
	if (widget.findResizeTimer) {
		clearTimeout(widget.findResizeTimer);
	}
	widget.findResizeTimer = setTimeout(() => {
		widget.findResizeTimer = undefined;
		widget.findResizing = false;
		widget.root.classList.remove('knox-gui-find-resizing');
		widget.controller.updateFind({});
	}, KNOX_GUI_FIND_RESIZE_DEBOUNCE_MS);
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
			if (state.checkpointDialog === 'restore') {
				widget.renderRestorePreviewDialog(body, state);
			}
	}
}

/**
 * `ChatErrorBoundary.tsx` LayoutErrorFallback: a page render throw shows the message and Retry, which remounts the same
 * session and form state. Only a route-level error (`pages/error.tsx`) wipes the session and persisted GUI state.
 */
export function renderErrorFallback(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, error: unknown): void {
	const fallback = DOM.append(body, DOM.$('.knox-gui-error-boundary'));
	fallback.setAttribute('role', 'alert');
	fallback.setAttribute('data-testid', 'knox-gui-error-boundary');
	DOM.append(fallback, DOM.$('p.knox-gui-error-title', undefined, t(state, 'oopsSomethingWentWrong')));
	const detail = error instanceof Error ? (error.message || String(error)) : String(error ?? '');
	DOM.append(fallback, DOM.$('pre.knox-gui-error-code', undefined, detail));
	widget.chromeButton(fallback, {
		label: t(state, 'retry'),
		testId: 'knox-gui-error-retry',
		onClick: () => widget.render(),
	});
}

export function renderScrollButtons(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, extraClass?: string): void {
	if (!state.history.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-scroll-btns'));
	widget.scrollTopBtn = widget.chromeButton(wrap, {
		svg: 'chevron-up',
		svgSize: extraClass ? 12 : 14,
		title: t(state, 'scrollToTop'),
		testId: 'knox-gui-scroll-top',
		extraClass,
		onClick: () => widget.scrollTranscript('top'),
	});
	widget.scrollBottomBtn = widget.chromeButton(wrap, {
		svg: 'chevron-down',
		svgSize: extraClass ? 12 : 14,
		title: t(state, 'scrollToBottom'),
		testId: 'knox-gui-scroll-bottom',
		extraClass,
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
	if (onHistoryKeyDown(widget, e, state)) {
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
	if (e.key === '.' && meta) {
		// ModeSelect.tsx swallows Cmd/Ctrl+. so it never falls through to the editor (quick fix / parameter hints).
		e.preventDefault();
		e.stopPropagation();
	}
	if (e.key === 'Tab' && e.shiftKey && !e.defaultPrevented && state.mode === 'agent' && !state.isStreaming && !(state.mentionOpen || state.slashOpen)) {
		e.preventDefault();
		widget.controller.cyclePermissionMode();
		return;
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
		if (widget.textDialog) {
			e.preventDefault();
			widget.closeTextDialog();
			return;
		}
		if (widget.imageViewerUrl) {
			e.preventDefault();
			widget.closeImageViewer();
			return;
		}
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
	widget.osrSelectedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
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
		const range = widget.osrSelectedRange;
		if (range && command !== 'paste') {
			const next = window.getSelection();
			next?.removeAllRanges();
			next?.addRange(range);
		}
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
	widget.osrSelectedRange = undefined;
}

export function toggleMenu(widget: KnoxGuiWidget, menu: 'agent' | 'model' | 'effort', source = 'main'): void {
	if (widget.openMenu === menu && widget.openMenuSource === source) {
		widget.openMenu = null;
		widget.openMenuSource = 'main';
	} else {
		widget.openMenu = menu;
		widget.openMenuSource = source;
	}
	widget.render();
}

export function closeMenus(widget: KnoxGuiWidget): void {
	if (!widget.openMenu && !widget.openRoleMenu) {
		return;
	}
	widget.openMenu = null;
	widget.openMenuSource = 'main';
	widget.openRoleMenu = null;
	widget.render();
}

/** Headless UI / Radix portal: pin the menu to the trigger in viewport space. */
export function anchorPopover(widget: KnoxGuiWidget, menu: HTMLElement, trigger: HTMLElement, options?: { minWidth?: number; align?: 'start' | 'end' }): void {
	menu.classList.add('knox-gui-popover-anchored');
	widget.root.appendChild(menu);
	const view = DOM.getWindow(menu);
	const place = () => {
		const triggerRect = trigger.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.left = '0px';
		menu.style.top = '0px';
		menu.style.right = 'auto';
		menu.style.bottom = 'auto';
		menu.style.minWidth = `${Math.max(options?.minWidth ?? 160, triggerRect.width)}px`;
		const menuRect = menu.getBoundingClientRect();
		const box = knoxGuiAnchorPopoverBox({
			trigger: { left: triggerRect.left, top: triggerRect.top, bottom: triggerRect.bottom, width: triggerRect.width },
			viewport: { width: view.innerWidth, height: view.innerHeight },
			menu: { width: menuRect.width, height: menuRect.height },
			align: options?.align,
		});
		const origin = menu.getBoundingClientRect();
		menu.style.left = `${box.left - origin.left}px`;
		menu.style.top = `${box.top - origin.top}px`;
		menu.style.maxHeight = `${Math.max(box.maxHeight, 80)}px`;
		menu.dataset.placement = box.placement;
	};
	place();
	widget.renderStore.add(DOM.addDisposableListener(view, 'resize', place));
	widget.renderStore.add(DOM.addDisposableListener(widget.root, 'scroll', place, true));
}

export function onEscape(widget: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): void {
	if (widget.textDialog) {
		e.preventDefault();
		e.stopPropagation();
		widget.closeTextDialog();
		return;
	}
	if (widget.imageViewerUrl) {
		e.preventDefault();
		e.stopPropagation();
		widget.closeImageViewer();
		return;
	}
	if (state.addModelModal) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.closeAddModelModal();
		return;
	}
	if (state.streamError) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.clearStreamError();
		return;
	}
	if (state.checkpointDialog) {
		e.preventDefault();
		e.stopPropagation();
		if (!state.checkpointRestoring) {
			widget.controller.closeCheckpointDialog();
		}
		return;
	}
	if (widget.checkpointListDeleteConfirm) {
		e.preventDefault();
		e.stopPropagation();
		widget.checkpointListDeleteConfirm = false;
		widget.render();
		return;
	}
	if (widget.memorySettingsConfirm) {
		e.preventDefault();
		e.stopPropagation();
		widget.memorySettingsConfirm = null;
		widget.render();
		return;
	}
	if (checkpointTimelineEscape(widget, state)) {
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	if (widget.checkpointDetails) {
		e.preventDefault();
		e.stopPropagation();
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
		// editorConfig.ts Escape: `inDropdownRef.current || !isInEditModeRef.current` -> post("focusEditor") (the suggestion plugin closes the picker too).
		widget.controller.focusHostEditor();
		return;
	}
	if (state.addFileOpen) {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.store.patch({ addFileOpen: false });
		return;
	}
	if (state.overlay === 'history' || state.route === KnoxGuiRoute.History) {
		if (state.historyConfirmDelete) {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.store.patch({ historyConfirmDelete: false });
			return;
		}
		if (widget.editingHistoryId) {
			e.preventDefault();
			e.stopPropagation();
			widget.editingHistoryId = null;
			widget.controller.store.patch({});
			return;
		}
		if (state.historySelectionMode) {
			e.preventDefault();
			e.stopPropagation();
			widget.historyListAnchorId = null;
			widget.historyListFocusedId = null;
			widget.controller.store.patch({ historySelectionMode: false, historySelected: [], historyConfirmDelete: false });
			return;
		}
		if (state.historyQuery) {
			e.preventDefault();
			e.stopPropagation();
			widget.historySearchFocus = true;
			widget.historySearchCaret = 0;
			widget.controller.store.patch({ historyQuery: '' });
			return;
		}
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
	const body = widget.bodyEl;
	widget.loadingEarlier = true;
	widget.pendingRestoreHeight = body?.scrollHeight ?? null;
	if (body) {
		widget.savedScrollTop = body.scrollTop;
	}
	widget.expandedStart = nextExpandedStart(widget.displayStart);
	widget.render();
}

/** Scrolls the transcript without the scroll handler reading it as a user pause. */
export function setTranscriptScrollTop(widget: KnoxGuiWidget, body: HTMLElement, top: number): void {
	const target = Math.max(0, Math.min(top, body.scrollHeight - body.clientHeight));
	if (Math.abs(body.scrollTop - target) >= 1) {
		widget.programmaticScroll = true;
		body.scrollTop = target;
	}
	widget.lastScrollTop = body.scrollTop;
	widget.lastScrollHeight = body.scrollHeight;
	widget.savedScrollTop = body.scrollTop;
}

/**
 * `useLayoutEffect` equivalent: pin/restore before paint so a rebuild cannot flash to
 * the top or fight an in-flight wheel gesture. Never load the full transcript here.
 */
export function restoreTranscriptScroll(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const body = widget.bodyEl;
	if (!body || state.route !== KnoxGuiRoute.Chat) {
		widget.loadingEarlier = false;
		widget.pendingRestoreHeight = null;
		return;
	}
	const top = knoxGuiTranscriptRestoreTop({
		following: widget.autoScrollEnabled,
		previousScrollTop: widget.savedScrollTop,
		previousScrollHeight: widget.pendingRestoreHeight,
		scrollHeight: body.scrollHeight,
		clientHeight: body.clientHeight,
	});
	widget.pendingRestoreHeight = null;
	widget.loadingEarlier = false;
	setTranscriptScrollTop(widget, body, top);
	widget.syncScrollButtons();
	if (state.find.open && state.find.matchIndexes.length) {
		const hit = state.find.matchIndexes[state.find.current];
		widget.programmaticScroll = true;
		body.querySelector<HTMLElement>(`[data-testid="history-row-${hit}"]`)?.scrollIntoView({ block: 'center' });
	}
}

/** `useEnhancedScroll`: one rAF stick per frame while following. */
export function scheduleTranscriptStick(widget: KnoxGuiWidget): void {
	if (!widget.autoScrollEnabled || widget.stickScheduled) {
		return;
	}
	widget.stickScheduled = true;
	requestAnimationFrame(() => {
		widget.stickScheduled = false;
		const body = widget.bodyEl;
		if (!widget.autoScrollEnabled || !body) {
			return;
		}
		setTranscriptScrollTop(widget, body, body.scrollHeight);
		widget.syncScrollButtons();
	});
}

/** Immediate stick plus one more rAF so late markdown/code layout is still followed. */
export function forceTranscriptStick(widget: KnoxGuiWidget): void {
	const run = () => {
		const body = widget.bodyEl;
		if (!widget.autoScrollEnabled || !body) {
			return;
		}
		setTranscriptScrollTop(widget, body, body.scrollHeight);
		widget.syncScrollButtons();
	};
	run();
	requestAnimationFrame(run);
}

/** `useEnhancedScroll`: 50ms force stick after streaming ends so the last healed block stays in view. */
export function scheduleStreamEndStick(widget: KnoxGuiWidget): void {
	if (widget.streamEndStickHandle !== undefined) {
		clearTimeout(widget.streamEndStickHandle);
	}
	widget.streamEndStickHandle = setTimeout(() => {
		widget.streamEndStickHandle = undefined;
		forceTranscriptStick(widget);
	}, 50);
}

export function attachTranscriptScroll(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (state.route !== KnoxGuiRoute.Chat) {
		return;
	}
	widget.renderStore.add(DOM.addDisposableListener(body, 'scroll', () => {
		const programmatic = widget.programmaticScroll;
		widget.programmaticScroll = false;
		const next = knoxGuiNextScrollFollow(
			{ following: widget.autoScrollEnabled, lastScrollTop: widget.lastScrollTop, lastScrollHeight: widget.lastScrollHeight },
			{ scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, programmatic },
		);
		const followChanged = next.following !== widget.autoScrollEnabled;
		widget.autoScrollEnabled = next.following;
		widget.lastScrollTop = next.lastScrollTop;
		widget.lastScrollHeight = next.lastScrollHeight;
		widget.savedScrollTop = body.scrollTop;
		widget.syncScrollButtons();
		// Never rebuild the transcript from a scroll event: that tears down the
		// scroller mid-gesture (the original `useEnhancedScroll` only updates refs).
		if (followChanged && next.following) {
			scheduleTranscriptStick(widget);
		}
		if (knoxGuiShouldLoadEarlier({
			programmatic,
			scrollTop: body.scrollTop,
			displayStart: widget.displayStart,
			loadingEarlier: widget.loadingEarlier,
		})) {
			widget.loadEarlier();
		}
	}, { passive: true }));
	if (typeof ResizeObserver === 'undefined') {
		return;
	}
	const observer = new ResizeObserver(() => {
		scheduleTranscriptStick(widget);
		widget.syncScrollButtons();
	});
	observer.observe(body);
	const content = body.querySelector('[data-testid="chat-scroll-content"]');
	if (content) {
		observer.observe(content);
	}
	const list = body.querySelector('.knox-gui-history');
	if (list) {
		observer.observe(list);
	}
	const lastRow = body.querySelector('.last-message');
	if (lastRow) {
		observer.observe(lastRow);
	}
	const markdown = body.querySelector('[data-testid="streaming-markdown"]');
	if (markdown) {
		observer.observe(markdown);
	}
	widget.renderStore.add({ dispose: () => observer.disconnect() });
}

/** `ChatHistoryList.scrollToIndex`: mounts rows before the display window first, then centers the row. */
export function scrollToHistoryIndex(widget: KnoxGuiWidget, index: number): void {
	const history = widget.controller.store.state.history;
	if (index < 0 || index >= history.length) {
		return;
	}
	if (index < widget.displayStart) {
		widget.expandedStart = index;
		widget.autoScrollEnabled = false;
		widget.render();
	}
	const row = widget.bodyEl?.querySelector<HTMLElement>(`[data-testid="history-row-${index}"]`);
	if (!row) {
		return;
	}
	widget.autoScrollEnabled = false;
	row.scrollIntoView({ block: 'center', behavior: 'auto' });
}

export function scrollTranscript(widget: KnoxGuiWidget, to: 'top' | 'bottom'): void {
	const body = widget.bodyEl;
	if (!body) {
		return;
	}
	if (to === 'top') {
		// Original `scrollToTop` only moves the current window. Expanding to index 0
		// would mount a hours-long session in one frame.
		widget.autoScrollEnabled = false;
		setTranscriptScrollTop(widget, body, 0);
	} else {
		widget.autoScrollEnabled = true;
		forceTranscriptStick(widget);
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
	const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
	if (widget.scrollTopBtn) {
		widget.scrollTopBtn.disabled = atTop;
		widget.scrollTopBtn.classList.toggle('disabled', atTop);
	}
	if (widget.scrollBottomBtn) {
		widget.scrollBottomBtn.disabled = atBottom;
		widget.scrollBottomBtn.classList.toggle('disabled', atBottom);
	}
}
