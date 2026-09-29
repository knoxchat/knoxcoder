/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import { appendShortcut } from './controls.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import {
	activeHeadId,
	buildCheckpointFileTree,
	CHECKPOINT_CLEANUP_INTERVALS,
	CHECKPOINT_PANEL_TABS,
	CHECKPOINT_TAB_I18N_KEY,
	CHECKPOINT_TAB_ICON,
	checkpointConfigFieldErrors,
	checkpointConfigIsDirty,
	checkpointConfigNumber,
	checkpointGraphForceMountKey,
	checkpointGraphLaneColor,
	checkpointImpactChipClass,
	checkpointKindI18nKey,
	checkpointRelativeAge,
	checkpointRiskChipClass,
	checkpointScopeChipClass,
	checkpointShellAction,
	checkpointShellMessageKey,
	checkpointShellViewState,
	chronologicalCheckpointPair,
	checkpointChartTickInterval,
	groupTimelineCheckpoints,
	checkpointChartYTicks,
	compactAxisNumber,
	computeLineDiff,
	DEFAULT_CHECKPOINT_CONFIG,
	fillDailyCarryForward,
	fillDailyCounts,
	filterCheckpoints,
	formatCheckpointBytes,
	formatCheckpointDuration,
	formatDashboardBytes,
	groupCheckpointsByDate,
	alignSplitDiffRows,
	buildDiffSegments,
	checkpointDiffChangedFiles,
	checkpointDiffContentBytes,
	checkpointDiffSummary,
	checkpointImageMime,
	formatSnapshotSize,
	hunkWordAltRanges,
	parseStorageBytes,
	parseTrackedExtensions,
	remapCheckpointBranchColor,
	restorePreviewActionKey,
	selectCheckpointIdRange,
	type IKnoxGuiTextRange,
} from '../../../common/knoxGuiCheckpoints.js';
import { languageIdFromFence } from '../../../common/knoxGuiTranscript.js';
import { IKnoxGuiCheckpointDiffFile, IKnoxGuiCheckpointNode, IKnoxGuiState, knoxGuiCheckpointSessionId } from '../../../common/knoxGuiState.js';
import { knoxGuiIsMetaEquivalent } from '../../../common/knoxGuiInput.js';
import { openCheckpointDetails, renderCheckpointDetailsDialog } from './checkpointDetails.js';
import { renderCheckpointGraph } from './checkpointGraph.js';

export function renderCheckpoints(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-checkpoint-page');
	body.setAttribute('data-testid', 'knox-gui-checkpoints');
	const shell = checkpointShellViewState(state.checkpointShell?.state, state.checkpoints.length, state.checkpointShell?.checkpointCount);
	const tabBar = DOM.append(body, DOM.$('.knox-gui-checkpoint-tab-bar'));
	const tabs = DOM.append(tabBar, DOM.$('.knox-gui-checkpoint-tabs'));
	tabs.setAttribute('data-testid', 'checkpoint-panel-tabs');
	tabs.setAttribute('role', 'tablist');
	for (const tab of CHECKPOINT_PANEL_TABS) {
		widget.chromeButton(tabs, {
			svg: CHECKPOINT_TAB_ICON[tab] as KnoxGuiSvgIcon,
			svgSize: 16,
			label: t(state, CHECKPOINT_TAB_I18N_KEY[tab]),
			title: t(state, CHECKPOINT_TAB_I18N_KEY[tab]),
			selected: state.checkpointView === tab,
			extraClass: 'knox-gui-checkpoint-tab',
			onClick: () => widget.controller.setCheckpointTab(tab),
		});
	}
	const panel = DOM.append(body, DOM.$('.knox-gui-checkpoint-panel'));
	if (shell !== 'ready') {
		widget.releaseCheckpointGraph();
	} else {
		mountCheckpointGraph(widget, panel, state);
	}
	if (state.checkpointView === 'graph' && shell !== 'ready') {
		const empty = DOM.append(panel, DOM.$('.knox-gui-checkpoint-shell'));
		DOM.append(empty, DOM.$('h1.knox-gui-checkpoint-shell-title', undefined, t(state, 'checkpointGraph.title')));
		const status = DOM.append(empty, DOM.$('p.knox-gui-muted', undefined, t(state, checkpointShellMessageKey(shell), { count: state.checkpointShell?.checkpointCount ?? 0 })));
		status.setAttribute('data-testid', 'checkpoint-graph-status');
		const action = checkpointShellAction(shell);
		if (action) {
			widget.chromeButton(empty, {
				label: t(state, action.key),
				disabled: state.checkpointGraphActionBusy,
				testId: 'checkpoint-graph-shell-action',
				onClick: () => void widget.controller.runCheckpointGraphAction(action.action),
			});
		}
	} else {
		if (state.checkpointView === 'timeline') {
			renderCheckpointTimeline(widget, panel, state);
		} else if (state.checkpointView === 'configuration') {
			widget.renderCheckpointConfig(panel, state);
		} else if (state.checkpointView === 'dashboard') {
			widget.renderCheckpointDashboard(panel, state);
		} else if (state.checkpointView === 'analysis') {
			widget.renderCheckpointAnalysis(panel, state);
		} else if (state.checkpointView === 'share') {
			widget.renderCheckpointShare(panel, state);
		} else if (state.checkpointView !== 'graph') {
			widget.renderCheckpointList(panel, state);
		}
	}
	renderCheckpointDetailsDialog(widget, body, state);
	if (state.checkpointDialog === 'restore') {
		widget.renderRestorePreviewDialog(body, state);
	} else if (state.checkpointDialog === 'compare') {
		widget.renderCompareDialog(body, state);
	}
}

function mountCheckpointGraph(widget: KnoxGuiWidget, panel: HTMLElement, state: IKnoxGuiState): void {
	const key = checkpointGraphForceMountKey({
		checkpoints: state.checkpoints,
		branches: state.checkpointBranches,
		ui: state.checkpointGraphUi,
		workingTreePaths: state.checkpointWorkingTreePaths,
		headId: state.checkpointHeadId,
		workspace: state.checkpointActiveWorkspace,
		hasMore: state.checkpointGraphHasMore,
		loadMoreError: state.checkpointGraphLoadMoreError,
		findOpen: widget.checkpointGraphFindOpen,
		findQuery: widget.checkpointGraphFindQuery,
		findIndex: widget.checkpointGraphFindIndex,
		findOpenDetails: widget.checkpointGraphFindOpenDetails,
		openId: widget.checkpointGraphOpenId,
		menu: widget.checkpointGraphMenu,
		prompt: widget.checkpointGraphPrompt,
		promptValue: widget.checkpointGraphPromptValue,
		settingsOpen: widget.checkpointGraphSettingsOpen,
		compare: widget.checkpointGraphCompare,
		comparePaths: widget.checkpointGraphComparePaths,
		compareError: widget.checkpointGraphCompareError,
		armCompare: widget.checkpointGraphArmCompare,
		scrollTop: widget.checkpointGraphScrollTop,
		viewport: widget.checkpointGraphViewport,
		pendingHead: widget.checkpointGraphPendingHead,
		expandedFolders: [...widget.checkpointGraphExpandedFolders],
	});
	if (!widget.checkpointGraphMount) {
		widget.checkpointGraphMount = DOM.$('.knox-gui-graph-force-mount');
		widget.checkpointGraphMount.setAttribute('data-testid', 'checkpoint-graph-mount');
	}
	const host = widget.checkpointGraphMount;
	const reuse = widget.checkpointGraphRenderKey === key && host.childElementCount > 0;
	if (!reuse) {
		widget.checkpointGraphStore.clear();
		host.replaceChildren();
		widget.listenerStore = widget.checkpointGraphStore;
		try {
			renderCheckpointGraph(widget, host, state);
		} finally {
			widget.listenerStore = widget.renderStore;
		}
		widget.checkpointGraphRenderKey = key;
	} else {
		widget.checkpointGraphFindInput = host.querySelector('[data-testid="checkpoint-graph-find"] input') as HTMLInputElement | undefined;
	}
	host.classList.toggle('hidden', state.checkpointView !== 'graph');
	host.setAttribute('aria-hidden', state.checkpointView === 'graph' ? 'false' : 'true');
	panel.appendChild(host);
}

export type KnoxCheckpointButtonVariant = 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link';
export type KnoxCheckpointButtonSize = 'default' | 'sm' | 'row' | 'xs' | 'xxs' | 'icon';

/**
 * shadcn `ui/button.tsx` for checkpoint surfaces: `is-<variant>` / `is-size-<size>` map to the cva
 * variants plus the `h-8 px-2` / `h-7 px-2` / `h-6` overrides the reference passes; icons stay 16px.
 */
export function checkpointButton(widget: KnoxGuiWidget, parent: HTMLElement, options: Parameters<KnoxGuiWidget['chromeButton']>[1] & { variant?: KnoxCheckpointButtonVariant; size?: KnoxCheckpointButtonSize; labelClass?: string; ariaLabel?: string }): HTMLButtonElement {
	const { variant = 'outline', size = 'sm', labelClass, ariaLabel, extraClass, ...rest } = options;
	const button = widget.chromeButton(parent, { ...rest, svgSize: 16, extraClass: `knox-gui-cpl-btn is-${variant} is-size-${size}${extraClass ? ` ${extraClass}` : ''}` });
	if (labelClass) {
		button.querySelector('.knox-gui-lump-label')?.classList.add(...labelClass.split(' '));
	}
	if (ariaLabel) {
		button.setAttribute('aria-label', ariaLabel);
	}
	return button;
}

/** shadcn `ui/badge.tsx`; checkpoint badges pass `font-normal` and `size-3` icons. */
export function checkpointBadge(parent: HTMLElement, variant: 'default' | 'secondary' | 'outline', text?: string, icon?: KnoxGuiSvgIcon, extraClass = ''): HTMLElement {
	const badge = DOM.append(parent, DOM.$(`span.knox-gui-cpl-badge.is-${variant}${extraClass}`));
	if (icon) {
		appendKnoxGuiSvg(badge, icon, 12);
	}
	if (text !== undefined) {
		badge.append(text);
	}
	return badge;
}

/** shadcn `ui/checkbox.tsx`. */
export function checkpointCheckbox(parent: HTMLElement, checked: boolean, label?: string, extraClass = ''): HTMLInputElement {
	const box = DOM.append(parent, DOM.$(`input.knox-gui-cpl-checkbox${extraClass}`)) as HTMLInputElement;
	box.type = 'checkbox';
	box.checked = checked;
	if (label) {
		box.setAttribute('aria-label', label);
	}
	return box;
}

/** shadcn `SelectTrigger` look for a native `<select>`, with the trailing 50%-opacity chevron. */
export function checkpointSelect(parent: HTMLElement, extraClass = ''): HTMLSelectElement {
	const wrap = DOM.append(parent, DOM.$(`span.knox-gui-cpl-select${extraClass}`));
	const select = DOM.append(wrap, DOM.$('select')) as HTMLSelectElement;
	appendKnoxGuiSvg(wrap, 'chevron-down', 16).classList.add('knox-gui-cpl-select-chevron');
	return select;
}

function checkpointSearch(parent: HTMLElement, placeholder: string, value: string, extraClass = '', id?: string): HTMLInputElement {
	const wrap = DOM.append(parent, DOM.$(`.knox-gui-cpl-search${extraClass}`));
	appendKnoxGuiSvg(wrap, 'search', 16).classList.add('knox-gui-cpl-search-icon');
	const input = DOM.append(wrap, DOM.$('input.knox-gui-cpl-input', id ? { id } : undefined)) as HTMLInputElement;
	input.placeholder = placeholder;
	input.value = value;
	return input;
}

/** shadcn `DialogContent` / `AlertDialogContent` inside the checkpoint page overlay. */
function checkpointDialog(widget: KnoxGuiWidget, parent: HTMLElement, testId: string, onClose: (() => void) | undefined, size: 'md' | 'lg' | '2xl' | '6xl', closeButton?: { title: string; onClick: () => void }): HTMLElement {
	const dialog = modal(widget, parent, testId, onClose);
	dialog.classList.add('knox-gui-cpl-dialog', `is-${size}`);
	dialog.parentElement?.classList.add('knox-gui-cpl-overlay');
	if (closeButton) {
		checkpointDialogClose(widget, dialog, closeButton.title, closeButton.onClick);
	}
	return dialog;
}

export function checkpointDialogClose(widget: KnoxGuiWidget, parent: HTMLElement, title: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
	const close = DOM.append(parent, DOM.$(`button.knox-gui-cpl-dialog-close${extraClass}`, { type: 'button', title, 'aria-label': title })) as HTMLButtonElement;
	appendKnoxGuiSvg(close, 'x', 16);
	widget.renderStore.add(DOM.addDisposableListener(close, 'click', onClick));
	return close;
}

export function checkpointDialogHeader(parent: HTMLElement, title: string, icon?: KnoxGuiSvgIcon, description?: string): HTMLElement {
	const header = DOM.append(parent, DOM.$('.knox-gui-cpl-dialog-header'));
	const heading = DOM.append(header, DOM.$('h2.knox-gui-cpl-dialog-title'));
	if (icon) {
		appendKnoxGuiSvg(heading, icon, 16);
	}
	heading.append(title);
	if (description !== undefined) {
		DOM.append(header, DOM.$('p.knox-gui-cpl-dialog-desc', undefined, description));
	}
	return header;
}

function checkpointAgeLabel(state: IKnoxGuiState, created: string, yesterday: boolean): string {
	const age = checkpointRelativeAge(created, yesterday);
	if ('date' in age) {
		return yesterday ? age.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : age.date.toLocaleDateString();
	}
	return t(state, age.key, age.count != null ? { count: age.count } : undefined);
}

export function renderCheckpointList(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-cpl-list');
	body.setAttribute('data-testid', 'checkpoint-list');
	body.tabIndex = 0;
	widget.renderStore.add(DOM.addDisposableListener(body, 'keydown', e => onCheckpointListKeyDown(widget, e, state)));
	const allNodes = filterCheckpoints(state.checkpointListItems.length ? state.checkpointListItems : state.checkpoints, {
		sessionId: knoxGuiCheckpointSessionId(state),
		thisSession: state.checkpointThisSession,
	});
	const nodes = listCheckpointNodes(state);
	if (state.checkpointListLoading && !allNodes.length) {
		const skeleton = DOM.append(body, DOM.$('.knox-gui-cpl-skeleton-row'));
		DOM.append(skeleton, DOM.$('span.knox-gui-cpl-skeleton.is-title'));
		DOM.append(skeleton, DOM.$('span.knox-gui-cpl-skeleton.is-session'));
		DOM.append(skeleton, DOM.$('span.knox-gui-cpl-skeleton.is-count'));
		DOM.append(body, DOM.$('span.knox-gui-cpl-skeleton.is-search'));
		const loading = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-loading.is-spinning'));
		loading.setAttribute('data-testid', 'checkpoint-list-loading');
		appendKnoxGuiSvg(loading, 'loader-2', 16);
		DOM.append(loading, DOM.$('span', undefined, t(state, 'loadingCheckpoints')));
		return;
	}
	const header = DOM.append(body, DOM.$('.knox-gui-cpl-list-header'));
	const head = DOM.append(header, DOM.$('.knox-gui-checkpoint-list-head'));
	DOM.append(head, DOM.$('h1', undefined, t(state, 'checkpoints')));
	const meta = DOM.append(head, DOM.$('.knox-gui-checkpoint-list-meta'));
	checkpointButton(widget, meta, {
		label: t(state, 'thisSession'),
		title: t(state, 'thisSession'),
		selected: state.checkpointThisSession,
		variant: state.checkpointThisSession ? 'default' : 'outline',
		size: 'xs',
		onClick: () => {
			widget.controller.store.patch({ checkpointThisSession: !state.checkpointThisSession });
			void widget.controller.loadCheckpointList();
		},
	});
	checkpointBadge(meta, 'secondary', t(state, 'showingCheckpoints', {
		shown: nodes.length,
		total: state.checkpointListTotal || state.checkpointListItems.length || state.checkpoints.length,
	}), undefined, '.is-count');
	const input = checkpointSearch(header, t(state, 'searchByDescriptionOrId'), state.checkpointQuery, '.has-clear');
	input.type = 'text';
	widget.checkpointListSearchInput = input;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.controller.store.patch({ checkpointQuery: input.value });
		scheduleCheckpointListQuery(widget);
	}));
	const clear = checkpointButton(widget, input.parentElement!, {
		svg: 'x',
		title: t(state, 'clear'),
		variant: 'ghost',
		size: 'icon',
		extraClass: 'knox-gui-cpl-search-clear',
		onClick: () => {
			widget.controller.store.patch({ checkpointQuery: '' });
			scheduleCheckpointListQuery(widget);
			widget.checkpointListSearchInput?.focus();
		},
	});
	clear.hidden = !state.checkpointQuery;
	if (state.checkpointWorkspaceFolders.length > 1) {
		const row = DOM.append(header, DOM.$('.knox-gui-cpl-workspace-row'));
		DOM.append(row, DOM.$('label.knox-gui-cpl-label', { for: 'checkpoint-workspace-folder' }, t(state, 'checkpointWorkspaceFolder')));
		const select = checkpointSelect(row, '.is-workspace');
		select.id = 'checkpoint-workspace-folder';
		for (const folder of state.checkpointWorkspaceFolders) {
			const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			option.value = folder.path;
			option.textContent = folder.name;
			if (folder.path === state.checkpointActiveWorkspace) {
				option.selected = true;
			}
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => void widget.controller.setCheckpointWorkspace(select.value)));
	}
	if (state.checkpointComparePickId) {
		DOM.append(header, DOM.$('p.knox-gui-cpl-hint', undefined, t(state, 'selectCheckpointToCompare')));
	}
	if (!allNodes.length) {
		const workspace = state.checkpointActiveWorkspace || widget.controller.workspaceDirectory;
		const empty = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-empty'));
		empty.setAttribute('data-testid', 'checkpoint-list-empty');
		appendKnoxGuiSvg(DOM.append(empty, DOM.$('.knox-gui-checkpoint-empty-icon')), 'archive', 32);
		const copy = DOM.append(empty, DOM.$('.knox-gui-checkpoint-empty-copy'));
		DOM.append(copy, DOM.$('h3', undefined, t(state, 'noCheckpointsFound')));
		const text = DOM.append(copy, DOM.$('p.is-lead', undefined, `${workspace ? t(state, 'noCheckpointsForWorkspace') : t(state, 'checkpointsAutoCreated')} `));
		appendShortcut(text, 'shift + cmd/ctrl + p');
		text.append(` → "${t(state, 'createCheckpoint')}"`);
		if (workspace) {
			DOM.append(copy, DOM.$('p', undefined, `${t(state, 'currentWorkspace')}: ${workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace}`));
		}
	} else {
		const selectedCount = widget.checkpointListSelected.size;
		const sticky = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-actions'));
		const selection = DOM.append(sticky, DOM.$('.knox-gui-cpl-actions-group'));
		if (selectedCount) {
			const badge = checkpointBadge(selection, 'secondary', undefined, 'check', '.is-selection');
			DOM.append(badge, DOM.$('span', undefined, String(selectedCount)));
		}
		const actions = DOM.append(sticky, DOM.$('.knox-gui-cpl-actions-group'));
		if (!widget.checkpointListSelectMode) {
			checkpointButton(widget, actions, {
				svg: 'square-check-big',
				label: t(state, 'select'),
				labelClass: 'knox-gui-cpl-show-sm',
				title: t(state, 'selectMultipleCheckpoints'),
				size: 'xs',
				onClick: () => {
					widget.checkpointListSelectMode = true;
					widget.render();
				},
			});
		} else {
			checkpointButton(widget, actions, { svg: 'square-check-big', label: t(state, 'selectAll'), labelClass: 'knox-gui-cpl-show-md', title: t(state, 'selectAllCheckpoints'), size: 'xs', onClick: () => { widget.checkpointListSelected = new Set(nodes.map(node => node.id)); widget.render(); } });
			checkpointButton(widget, actions, { svg: 'square', label: t(state, 'clear'), labelClass: 'knox-gui-cpl-show-md', title: t(state, 'clearAllSelections'), size: 'xs', onClick: () => { widget.checkpointListSelected.clear(); widget.render(); } });
			checkpointButton(widget, actions, {
				svg: 'git-compare',
				label: t(state, 'compare'),
				labelClass: 'knox-gui-cpl-show-sm',
				title: t(state, 'compareTwoCheckpoints'),
				disabled: selectedCount !== 2,
				size: 'xs',
				onClick: () => {
					const [leftId, rightId] = [...widget.checkpointListSelected];
					if (!leftId || !rightId) {
						return;
					}
					const find = (id: string) => state.checkpointCompareCatalog.find(item => item.id === id) ?? nodes.find(item => item.id === id);
					const left = find(leftId);
					const right = find(rightId);
					const [older, newer] = left && right ? chronologicalCheckpointPair(left, right) : [{ id: leftId }, { id: rightId }];
					void widget.controller.openCompareDialog(older.id, newer.id);
				},
			});
			const remove = checkpointButton(widget, actions, {
				svg: 'trash-2',
				label: t(state, 'deleteCount', { count: selectedCount }),
				labelClass: 'knox-gui-cpl-show-sm',
				title: t(state, 'deleteSelectedCheckpoints', { count: selectedCount }),
				disabled: selectedCount === 0,
				size: 'xs',
				extraClass: 'is-tone-danger',
				onClick: () => {
					widget.checkpointListDeleteConfirm = true;
					widget.render();
				},
			});
			DOM.append(remove, DOM.$('span.knox-gui-cpl-hide-sm', undefined, `(${selectedCount})`));
			checkpointButton(widget, actions, {
				svg: 'x',
				label: t(state, 'exit'),
				labelClass: 'knox-gui-cpl-show-sm',
				title: t(state, 'exitSelectionMode'),
				variant: 'ghost',
				size: 'xs',
				onClick: () => {
					widget.checkpointListSelectMode = false;
					widget.checkpointListSelected.clear();
					widget.render();
				},
			});
		}
		const groups = DOM.append(body, DOM.$('.knox-gui-cpl-groups'));
		for (const group of groupCheckpointsByDate(allNodes)) {
			const section = DOM.append(groups, DOM.$('.knox-gui-checkpoint-date-group'));
			const dateHead = DOM.append(section, DOM.$('.knox-gui-checkpoint-date-head'));
			DOM.append(dateHead, DOM.$('h2', undefined, t(state, group.header)));
			checkpointBadge(dateHead, 'outline', group.checkpoints.length === 1 ? t(state, 'itemCount', { count: 1 }) : t(state, 'itemsCount', { count: group.checkpoints.length }), undefined, '.is-count');
			DOM.append(section, DOM.$('.knox-gui-cpl-separator'));
			const cards = DOM.append(section, DOM.$('.knox-gui-cpl-cards'));
			for (const node of group.checkpoints) {
				renderCheckpointListCard(widget, cards, state, allNodes, node);
			}
		}
		if (state.checkpointListHasMore) {
			const more = DOM.append(groups, DOM.$('.knox-gui-cpl-load-more'));
			checkpointButton(widget, more, {
				label: state.checkpointListLoadingMore ? t(state, 'loadingCheckpoints') : t(state, 'loadMoreCheckpoints'),
				disabled: state.checkpointListLoadingMore,
				onClick: () => void widget.controller.loadCheckpointList({ append: true }),
			});
		}
	}
	const footer = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-footer'));
	appendKnoxGuiSvg(footer, 'info', 16);
	DOM.append(footer, DOM.$('span', undefined, t(state, 'checkpointDataSavedIn')));
	if (widget.checkpointListDeleteConfirm) {
		const cancel = () => { widget.checkpointListDeleteConfirm = false; widget.render(); };
		const dialog = checkpointDialog(widget, body, 'checkpoint-list-delete', cancel, 'md');
		const count = widget.checkpointListSelected.size;
		checkpointDialogHeader(dialog, t(state, 'deleteCheckpoints'), undefined, `${t(state, 'deleteConfirmation', { count })} ${count === 1 ? t(state, 'checkpoint') : t(state, 'checkpointsPlural')}? ${t(state, 'cannotBeUndone')}`).classList.add('is-alert');
		const row = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
		checkpointButton(widget, row, { label: t(state, 'cancel'), size: 'default', onClick: cancel });
		checkpointButton(widget, row, {
			label: t(state, 'deleteAction'),
			variant: 'destructive',
			size: 'default',
			onClick: () => {
				const ids = [...widget.checkpointListSelected];
				widget.checkpointListDeleteConfirm = false;
				widget.checkpointListSelected.clear();
				widget.checkpointListSelectMode = false;
				void widget.controller.deleteSelectedCheckpoints(ids);
			},
		});
	}
	syncCheckpointList(widget, state);
}

/** `Checkpoints/index.tsx`: the host query waits 250 ms; local matching is immediate. */
function scheduleCheckpointListQuery(widget: KnoxGuiWidget): void {
	if (widget.checkpointListQueryTimer) {
		clearTimeout(widget.checkpointListQueryTimer);
	}
	widget.checkpointListQueryTimer = setTimeout(() => {
		widget.checkpointListQueryTimer = undefined;
		void widget.controller.loadCheckpointList();
	}, 250);
}

export function syncCheckpointList(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const root = widget.root.querySelector('[data-testid="checkpoint-list"]') as HTMLElement | null;
	if (!root) {
		return;
	}
	const nodes = listCheckpointNodes(state);
	const ids = new Set(nodes.map(node => node.id));
	let visible = 0;
	for (const card of root.querySelectorAll<HTMLElement>('.knox-gui-checkpoint-card')) {
		const id = card.getAttribute('data-checkpoint-id');
		const show = Boolean(id && ids.has(id));
		card.hidden = !show;
		if (show) {
			visible += 1;
		}
	}
	for (const group of root.querySelectorAll<HTMLElement>('.knox-gui-checkpoint-date-group')) {
		group.hidden = !group.querySelector('.knox-gui-checkpoint-card:not([hidden])');
	}
	const count = root.querySelector('.knox-gui-checkpoint-list-meta .knox-gui-cpl-badge.is-count');
	if (count) {
		count.textContent = t(state, 'showingCheckpoints', {
			shown: visible,
			total: state.checkpointListTotal || state.checkpointListItems.length || state.checkpoints.length,
		});
	}
	const clear = root.querySelector('.knox-gui-cpl-search-clear') as HTMLElement | null;
	if (clear) {
		clear.hidden = !state.checkpointQuery;
	}
	const actions = root.querySelector('.knox-gui-checkpoint-list-actions') as HTMLElement | null;
	if (actions) {
		actions.hidden = visible === 0 && Boolean(state.checkpointQuery);
	}
}

export function syncCheckpointTimeline(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const list = widget.root.querySelector('.knox-gui-timeline-list') as HTMLElement | null;
	if (!list) {
		return;
	}
	const nodes = state.checkpointTimeline.length ? state.checkpointTimeline : state.checkpoints;
	const { groups } = groupTimelineCheckpoints(nodes, widget.checkpointTimelineQuery, widget.checkpointTimelineKind);
	const ids = new Set(groups.flatMap(group => group.nodes.map(node => node.id)));
	let visible = 0;
	for (const item of list.querySelectorAll<HTMLElement>('.knox-gui-timeline-item')) {
		const id = item.getAttribute('data-checkpoint-id');
		const show = !widget.checkpointTimelineQuery.trim() || Boolean(id && ids.has(id));
		item.hidden = !show;
		if (show) {
			visible += 1;
		}
	}
	for (const group of list.querySelectorAll<HTMLElement>('.knox-gui-timeline-group')) {
		group.hidden = !group.querySelector('.knox-gui-timeline-item:not([hidden])');
	}
	let empty = list.querySelector('.knox-gui-timeline-empty') as HTMLElement | null;
	if (!visible && widget.checkpointTimelineQuery.trim()) {
		if (!empty) {
			empty = DOM.append(list, DOM.$('.knox-gui-timeline-empty', { 'data-testid': 'checkpoint-timeline-empty' }));
			appendKnoxGuiSvg(empty, 'history', 32);
			DOM.append(empty, DOM.$('p', undefined, t(state, 'noCheckpointsFound')));
		}
		empty.hidden = false;
	} else if (empty) {
		empty.hidden = visible > 0;
	}
}

function listCheckpointNodes(state: IKnoxGuiState): IKnoxGuiCheckpointNode[] {
	return filterCheckpoints(state.checkpointListItems.length ? state.checkpointListItems : state.checkpoints, {
		query: state.checkpointQuery,
		sessionId: knoxGuiCheckpointSessionId(state),
		thisSession: state.checkpointThisSession,
	});
}

function renderCheckpointListCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, nodes: IKnoxGuiCheckpointNode[], node: IKnoxGuiCheckpointNode): void {
	const selected = widget.checkpointListSelected.has(node.id);
	const focused = widget.checkpointListFocusedId === node.id || node.id === state.selectedCheckpointId;
	const card = DOM.append(parent, DOM.$('.knox-gui-checkpoint-card'));
	card.setAttribute('data-testid', `checkpoint-row-${node.shortId}`);
	card.setAttribute('data-checkpoint-id', node.id);
	if (selected) {
		card.classList.add('is-selected');
	}
	if (focused && !selected) {
		card.classList.add('is-focused');
	}
	widget.listenerStore.add(DOM.addDisposableListener(card, 'click', e => {
		if ((e.target as HTMLElement).closest('button, input')) {
			return;
		}
		if (widget.checkpointListSelectMode || e.shiftKey) {
			if (!widget.checkpointListSelectMode) {
				widget.checkpointListSelectMode = true;
				widget.checkpointListAnchorId ??= widget.checkpointListFocusedId;
			}
			selectCheckpointRow(widget, nodes, node.id, !selected, e.shiftKey);
			return;
		}
		widget.checkpointListFocusedId = node.id;
		widget.controller.store.patch({ selectedCheckpointId: node.id });
	}));
	const inner = DOM.append(card, DOM.$('.knox-gui-checkpoint-card-inner'));
	if (widget.checkpointListSelectMode) {
		const box = checkpointCheckbox(DOM.append(inner, DOM.$('.knox-gui-checkpoint-check-wrap')), selected, undefined, '.knox-gui-checkpoint-check');
		widget.renderStore.add(DOM.addDisposableListener(box, 'click', e => e.stopPropagation()));
		widget.listenerStore.add(DOM.addDisposableListener(box, 'change', e => {
			selectCheckpointRow(widget, nodes, node.id, box.checked, (e as MouseEvent).shiftKey);
		}));
	}
	const main = DOM.append(inner, DOM.$('.knox-gui-checkpoint-card-main'));
	DOM.append(main, DOM.$('h3.knox-gui-checkpoint-card-title', undefined, node.description || t(state, 'noDescriptionAvailable')));
	const context = node.conversationContext;
	if (context) {
		const preview = `${context.messageContent.slice(0, 100)}${context.messageContent.length > 100 ? '...' : ''}`;
		DOM.append(main, DOM.$('p.knox-gui-checkpoint-card-preview', undefined, preview));
	}
	const badges = DOM.append(main, DOM.$('.knox-gui-checkpoint-badges'));
	checkpointBadge(badges, 'secondary', checkpointAgeLabel(state, node.created, true), 'calendar');
	const copied = widget.checkpointCopiedId === node.id;
	const idBadge = DOM.append(badges, DOM.$(`button.knox-gui-cpl-badge.is-outline.is-clickable${copied ? '.odp-chip-green' : ''}`, { type: 'button', title: copied ? t(state, 'copiedToClipboard') : t(state, 'clickToCopyId') })) as HTMLButtonElement;
	appendKnoxGuiSvg(idBadge, 'hash', 12);
	idBadge.append(copied ? t(state, 'copied') : node.id.slice(0, 8));
	widget.renderStore.add(DOM.addDisposableListener(idBadge, 'click', () => {
		widget.controller.messenger.post('copyText', { text: node.id });
		widget.checkpointCopiedId = node.id;
		if (widget.checkpointCopiedTimer) {
			clearTimeout(widget.checkpointCopiedTimer);
		}
		widget.checkpointCopiedTimer = setTimeout(() => {
			widget.checkpointCopiedId = null;
			widget.render();
		}, 3000);
		widget.render();
	}));
	if (node.pinned) {
		checkpointBadge(badges, 'outline', t(state, 'pinned'), 'pin');
	}
	for (const tag of node.tags) {
		checkpointBadge(badges, 'outline', tag, 'tag').title = t(state, 'tags');
	}
	if (context?.role) {
		const user = context.role === 'user';
		checkpointBadge(badges, user ? 'default' : 'secondary', t(state, user ? 'user' : 'ai'), user ? 'user' : 'bot').setAttribute('data-testid', 'checkpoint-role-badge');
	}
	const files = node.fileChanges;
	const totalFiles = (files?.added ?? 0) + (files?.modified ?? 0) + (files?.deleted ?? 0);
	if (totalFiles > 0) {
		const fileBadge = checkpointBadge(badges, 'outline', String(totalFiles), 'file');
		fileBadge.title = t(state, 'fileStatsTooltip', { created: files.added, modified: files.modified, deleted: files.deleted });
		if (files.added) {
			DOM.append(fileBadge, DOM.$('span.knox-gui-cpl-badge-stat.odp-text-green', undefined, `+${files.added}`));
		}
		if (files.modified) {
			DOM.append(fileBadge, DOM.$('span.knox-gui-cpl-badge-stat.odp-text-yellow', undefined, `~${files.modified}`));
		}
		if (files.deleted) {
			DOM.append(fileBadge, DOM.$('span.knox-gui-cpl-badge-stat.odp-text-red', undefined, `−${files.deleted}`));
		}
	}
	const rowActions = DOM.append(main, DOM.$('.knox-gui-checkpoint-card-actions'));
	checkpointButton(widget, rowActions, {
		svg: 'pin',
		label: t(state, node.pinned ? 'unpinCheckpoint' : 'pinCheckpoint'),
		labelClass: 'knox-gui-cpl-show-card-22',
		title: t(state, node.pinned ? 'unpinCheckpointTooltip' : 'pinCheckpointTooltip'),
		ariaLabel: t(state, node.pinned ? 'unpinCheckpoint' : 'pinCheckpoint'),
		selected: node.pinned,
		variant: node.pinned ? 'default' : 'outline',
		size: 'row',
		extraClass: node.pinned ? 'knox-gui-checkpoint-action' : 'knox-gui-checkpoint-action knox-gui-checkpoint-pin is-tone-yellow',
		onClick: () => void widget.controller.pinCheckpoint(node.id, !node.pinned),
	});
	const loadingDetails = widget.checkpointDetails?.id === node.id && widget.checkpointDetails.loading;
	checkpointButton(widget, rowActions, {
		svg: loadingDetails ? 'loader-2' : 'info',
		label: t(state, loadingDetails ? 'loading' : 'details'),
		labelClass: 'knox-gui-cpl-show-card-22',
		title: t(state, 'details'),
		ariaLabel: t(state, 'details'),
		disabled: loadingDetails,
		size: 'row',
		extraClass: `knox-gui-checkpoint-action knox-gui-checkpoint-details is-tone-blue${loadingDetails ? ' is-spinning' : ''}`,
		onClick: () => void openCheckpointDetails(widget, node.id),
	});
	checkpointButton(widget, rowActions, {
		svg: 'rotate-ccw',
		label: t(state, 'restore'),
		labelClass: 'knox-gui-cpl-show-card-18',
		title: t(state, 'restoreTooltip'),
		ariaLabel: t(state, 'restore'),
		size: 'row',
		extraClass: 'knox-gui-checkpoint-action knox-gui-checkpoint-restore is-tone-cyan',
		onClick: () => void widget.controller.openRestorePreview(node.id),
	});
	checkpointButton(widget, rowActions, {
		svg: 'brain',
		label: t(state, 'restoreWithMemoryShort'),
		labelClass: 'knox-gui-cpl-show-card-22',
		title: `${t(state, 'restoreWithMemory')}\n${t(state, 'restoreWithMemoryTooltip')}`,
		ariaLabel: t(state, 'restoreWithMemory'),
		size: 'row',
		extraClass: 'knox-gui-checkpoint-action knox-gui-checkpoint-memory is-tone-purple',
		onClick: () => void widget.controller.openRestorePreview(node.id, true),
	});
	checkpointButton(widget, rowActions, {
		svg: 'trash-2',
		label: t(state, 'deleteAction'),
		labelClass: 'knox-gui-cpl-show-card-22',
		title: t(state, 'deleteCheckpointTooltip'),
		ariaLabel: t(state, 'deleteAction'),
		size: 'row',
		extraClass: 'knox-gui-checkpoint-action is-tone-red',
		onClick: () => {
			widget.checkpointListSelected = new Set([node.id]);
			widget.checkpointListSelectMode = true;
			widget.checkpointListDeleteConfirm = true;
			widget.render();
		},
	});
}

function selectCheckpointRow(widget: KnoxGuiWidget, nodes: IKnoxGuiCheckpointNode[], id: string, selected: boolean, shiftKey: boolean): void {
	widget.checkpointListFocusedId = id;
	widget.checkpointListSelectMode = true;
	const ordered = nodes.map(node => node.id);
	if (shiftKey && widget.checkpointListAnchorId) {
		widget.checkpointListSelected = new Set(selectCheckpointIdRange(ordered, widget.checkpointListAnchorId, id));
		widget.render();
		return;
	}
	widget.checkpointListAnchorId = id;
	if (selected) {
		widget.checkpointListSelected.add(id);
	} else {
		widget.checkpointListSelected.delete(id);
	}
	widget.render();
}

function onCheckpointListKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): void {
	if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
		return;
	}
	if (widget.checkpointListDeleteConfirm || state.checkpointDialog || widget.checkpointDetails) {
		return;
	}
	const nodes = listCheckpointNodes(state);
	const ordered = nodes.map(node => node.id);
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		e.preventDefault();
		const current = widget.checkpointListFocusedId ? ordered.indexOf(widget.checkpointListFocusedId) : -1;
		const nextIndex = current < 0 ? (e.key === 'ArrowDown' ? 0 : ordered.length - 1) : Math.max(0, Math.min(ordered.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)));
		const nextId = ordered[nextIndex];
		if (!nextId) {
			return;
		}
		widget.checkpointListFocusedId = nextId;
		if (e.shiftKey) {
			widget.checkpointListSelectMode = true;
			const anchor = widget.checkpointListAnchorId ?? (current >= 0 ? ordered[current] : nextId);
			widget.checkpointListAnchorId = anchor;
			widget.checkpointListSelected = new Set(selectCheckpointIdRange(ordered, anchor, nextId));
		}
		widget.render();
		const row = [...widget.root.querySelectorAll<HTMLElement>('[data-checkpoint-id]')].find(el => el.getAttribute('data-checkpoint-id') === nextId);
		row?.scrollIntoView?.({ block: 'nearest' });
		return;
	}
	if ((e.key === 'Delete' || e.key === 'Backspace') && (widget.checkpointListSelected.size || widget.checkpointListFocusedId)) {
		e.preventDefault();
		if (!widget.checkpointListSelected.size && widget.checkpointListFocusedId) {
			widget.checkpointListSelected = new Set([widget.checkpointListFocusedId]);
			widget.checkpointListSelectMode = true;
		}
		widget.checkpointListDeleteConfirm = true;
		widget.render();
		return;
	}
	if (e.key === 'Enter' && widget.checkpointListFocusedId) {
		e.preventDefault();
		void widget.controller.openRestorePreview(widget.checkpointListFocusedId);
		return;
	}
	if (e.key === 'Escape') {
		widget.checkpointListSelectMode = false;
		widget.checkpointListSelected.clear();
		widget.checkpointListFocusedId = null;
		widget.render();
		return;
	}
	if (e.key === '/' && !knoxGuiIsMetaEquivalent(e)) {
		e.preventDefault();
		widget.checkpointListSearchInput?.focus();
	}
}

const TIMELINE_KIND_ICONS: Record<string, KnoxGuiSvgIcon> = { auto: 'zap', ai: 'bot', merge: 'git-merge', 'branch-point': 'git-branch' };
const TIMELINE_KIND_CLASS: Record<string, string> = { auto: 'odp-type-auto', ai: 'odp-type-ai', merge: 'odp-type-merge', 'branch-point': 'odp-type-branch', manual: 'odp-type-manual' };

/** `CheckpointTimeline.tsx` Escape: close the timeline forms, else cancel compare and clear the search. */
export function checkpointTimelineEscape(widget: KnoxGuiWidget, state: IKnoxGuiState): boolean {
	if (!widget.checkpointTimelineSearchInput) {
		return false;
	}
	if (widget.checkpointTimelineDeleteId || widget.checkpointTimelineBranchBase) {
		widget.checkpointTimelineDeleteId = null;
		widget.checkpointTimelineBranchBase = null;
		widget.render();
		return true;
	}
	if (!state.checkpointComparePickId && !widget.checkpointTimelineQuery) {
		return false;
	}
	widget.checkpointTimelineQuery = '';
	if (state.checkpointComparePickId) {
		widget.controller.store.patch({ checkpointComparePickId: undefined });
	} else {
		widget.render();
	}
	return true;
}

export function renderCheckpointTimeline(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-cpl-timeline');
	if (state.checkpointTimelineLoading) {
		const loading = DOM.append(body, DOM.$('p.knox-gui-timeline-loading.is-spinning', { 'data-testid': 'checkpoint-timeline-loading' }));
		appendKnoxGuiSvg(loading, 'loader-2', 16);
		loading.append(t(state, 'checkpointTimeline.loading'));
		return;
	}
	const nodes = state.checkpointTimeline.length ? state.checkpointTimeline : state.checkpoints;
	const branches = state.checkpointTimelineBranches.length ? state.checkpointTimelineBranches : state.checkpointBranches;
	const { count, groups } = groupTimelineCheckpoints(nodes, widget.checkpointTimelineQuery, widget.checkpointTimelineKind);
	const currentId = state.selectedCheckpointId ?? state.checkpointHeadId ?? activeHeadId(branches) ?? nodes[0]?.id;
	const pickId = state.checkpointComparePickId;
	const branchColor = (branchId: string | undefined) => {
		const index = branches.findIndex(item => item.id === branchId);
		const branch = branches[index];
		return remapCheckpointBranchColor(branch?.color && /^#[0-9a-fA-F]{6}$/.test(branch.color) ? branch.color : checkpointGraphLaneColor(Math.max(0, index)), widget.isLightTheme());
	};

	const header = DOM.append(body, DOM.$('.knox-gui-timeline-header'));
	const titleRow = DOM.append(header, DOM.$('.knox-gui-timeline-title-row'));
	const title = DOM.append(titleRow, DOM.$('.knox-gui-timeline-heading'));
	appendKnoxGuiSvg(title, 'history', 16).classList.add('knox-gui-timeline-heading-icon');
	DOM.append(title, DOM.$('span.knox-gui-timeline-heading-text', undefined, t(state, 'timeline')));
	checkpointBadge(title, 'secondary', String(count), undefined, '.is-count').setAttribute('data-testid', 'checkpoint-timeline-count');
	if (branches.length) {
		checkpointButton(widget, titleRow, {
			svg: 'git-branch',
			label: branches.find(branch => branch.isActive)?.name ?? t(state, 'checkpointTimeline.noActiveBranch'),
			size: 'xs',
			extraClass: 'knox-gui-timeline-branch-toggle',
			testId: 'checkpoint-timeline-branch-toggle',
			onClick: () => {
				widget.checkpointTimelineShowBranches = !widget.checkpointTimelineShowBranches;
				widget.render();
			},
		});
	}
	const toolbar = DOM.append(header, DOM.$('.knox-gui-timeline-toolbar'));
	const input = checkpointSearch(toolbar, t(state, 'searchCheckpoints'), widget.checkpointTimelineQuery, '.is-timeline', 'knox-checkpoint-timeline-search');
	widget.checkpointTimelineSearchInput = input;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.checkpointTimelineQuery = input.value;
		syncCheckpointTimeline(widget, widget.controller.store.state);
	}));
	widget.renderStore.add(DOM.addDisposableListener(window, 'keydown', (e: KeyboardEvent) => {
		const target = e.target as HTMLElement | null;
		if (e.key === '/' && !e.ctrlKey && !e.metaKey && !(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))) {
			e.preventDefault();
			widget.checkpointTimelineSearchInput?.focus();
		}
	}));
	const select = checkpointSelect(toolbar, '.knox-gui-timeline-kind');
	select.setAttribute('data-testid', 'checkpoint-timeline-kind');
	const all = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
	all.value = '';
	all.textContent = t(state, 'allTypes');
	for (const kind of ['manual', 'auto', 'ai', 'merge', 'branch-point']) {
		const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
		option.value = kind;
		option.textContent = t(state, checkpointKindI18nKey(kind));
		option.selected = widget.checkpointTimelineKind === kind;
	}
	widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => {
		widget.checkpointTimelineKind = select.value || null;
		widget.render();
	}));
	if (pickId) {
		const pick = DOM.append(header, DOM.$('.knox-gui-timeline-compare', { 'data-testid': 'checkpoint-timeline-compare' }));
		const text = DOM.append(pick, DOM.$('span', undefined, `${t(state, 'selectCheckpointToCompare')} `));
		DOM.append(text, DOM.$('code', undefined, pickId.substring(0, 8)));
		checkpointButton(widget, pick, { label: t(state, 'cancel'), variant: 'ghost', size: 'xxs', onClick: () => widget.controller.store.patch({ checkpointComparePickId: undefined }) });
	}
	if (widget.checkpointTimelineShowBranches && branches.length) {
		const chips = DOM.append(DOM.append(body, DOM.$('.knox-gui-timeline-branches', { 'data-testid': 'checkpoint-timeline-branches' })), DOM.$('.knox-gui-timeline-branches-row'));
		for (const branch of branches) {
			const chip = checkpointButton(widget, chips, { label: branch.name, selected: branch.isActive, variant: branch.isActive ? 'default' : 'outline', size: 'xxs', extraClass: 'knox-gui-timeline-branch-chip', onClick: () => void widget.controller.switchCheckpointBranch(branch.id) });
			const dot = DOM.$('span.knox-gui-timeline-branch-dot');
			dot.style.background = branchColor(branch.id);
			chip.prepend(dot);
		}
	}

	const list = DOM.append(body, DOM.$('.knox-gui-timeline-list'));
	if (!groups.length) {
		const empty = DOM.append(list, DOM.$('.knox-gui-timeline-empty', { 'data-testid': 'checkpoint-timeline-empty' }));
		appendKnoxGuiSvg(empty, 'history', 32);
		DOM.append(empty, DOM.$('p', undefined, t(state, 'noCheckpointsFound')));
		if (widget.checkpointTimelineQuery) {
			checkpointButton(widget, empty, {
				label: t(state, 'clearSearch'), variant: 'link', onClick: () => {
					widget.checkpointTimelineQuery = '';
					widget.render();
				},
			});
		}
	}
	for (const group of groups) {
		const section = DOM.append(list, DOM.$('.knox-gui-timeline-group'));
		const dateHead = DOM.append(section, DOM.$('.knox-gui-timeline-date', { 'data-testid': 'checkpoint-timeline-date' }));
		appendKnoxGuiSvg(dateHead, 'calendar', 12);
		DOM.append(dateHead, DOM.$('span', undefined, new Date(group.day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
		DOM.append(dateHead, DOM.$('span.knox-gui-cpl-separator'));
		const groupNodes = DOM.append(section, DOM.$('.knox-gui-timeline-nodes'));
		group.nodes.forEach((node, index) => {
			const isLast = index === group.nodes.length - 1;
			const item = DOM.append(groupNodes, DOM.$(pickId === node.id ? '.knox-gui-timeline-item.is-compare' : '.knox-gui-timeline-item'));
			item.setAttribute('data-testid', 'checkpoint-timeline-item');
			item.setAttribute('data-checkpoint-id', node.id);
			const rail = DOM.append(item, DOM.$('.knox-gui-timeline-rail'));
			rail.setAttribute('aria-hidden', 'true');
			const lane = branchColor(node.branchId);
			const dot = DOM.append(rail, DOM.$(`span.knox-gui-timeline-dot.${TIMELINE_KIND_CLASS[node.kind] ?? 'odp-type-manual'}`));
			appendKnoxGuiSvg(dot, TIMELINE_KIND_ICONS[node.kind] ?? 'git-commit', 12);
			if (!isLast) {
				DOM.append(rail, DOM.$('.knox-gui-timeline-line')).style.background = lane;
			}
			const card = DOM.append(item, DOM.$(node.id === currentId ? '.knox-gui-timeline-card.current' : '.knox-gui-timeline-card'));
			card.setAttribute('data-testid', 'checkpoint-timeline-card');
			widget.renderStore.add(DOM.addDisposableListener(card, 'click', () => widget.controller.store.patch({ selectedCheckpointId: node.id })));
			const top = DOM.append(card, DOM.$('.knox-gui-timeline-card-top'));
			const main = DOM.append(top, DOM.$('.knox-gui-timeline-card-main'));
			const titleLine = DOM.append(main, DOM.$('.knox-gui-timeline-title-line'));
			const branch = branches.find(item => item.id === node.branchId);
			if (branch) {
				const branchDot = DOM.append(titleLine, DOM.$('span.knox-gui-timeline-branch-dot', { title: branch.name, 'data-testid': 'checkpoint-timeline-branch-dot' }));
				branchDot.style.background = lane;
			}
			DOM.append(titleLine, DOM.$('span.knox-gui-timeline-title', { title: node.description }, node.description || node.shortId));
			const meta = DOM.append(main, DOM.$('.knox-gui-timeline-meta'));
			const when = DOM.append(meta, DOM.$('span.knox-gui-timeline-when'));
			appendKnoxGuiSvg(when, 'clock', 12);
			DOM.append(when, DOM.$('span', undefined, checkpointAgeLabel(state, node.created, false)));
			DOM.append(meta, DOM.$('span.knox-gui-timeline-id', undefined, node.id.substring(0, 8)));
			if (node.fileChanges.added || node.fileChanges.modified || node.fileChanges.deleted) {
				const changes = DOM.append(meta, DOM.$('span.knox-gui-timeline-changes'));
				if (node.fileChanges.added) {
					DOM.append(changes, DOM.$('span.odp-text-green', undefined, `+${node.fileChanges.added}`));
				}
				if (node.fileChanges.modified) {
					DOM.append(changes, DOM.$('span.odp-text-yellow', undefined, `~${node.fileChanges.modified}`));
				}
				if (node.fileChanges.deleted) {
					DOM.append(changes, DOM.$('span.odp-text-red', undefined, `-${node.fileChanges.deleted}`));
				}
			}
			if (node.isIncremental || node.timelineRisk) {
				const badges = DOM.append(main, DOM.$('.knox-gui-timeline-badges'));
				if (node.isIncremental) {
					DOM.append(badges, DOM.$('span.odp-chip.odp-chip-purple', { 'data-testid': 'checkpoint-timeline-delta' }, `Δ${node.deltaDepth ?? 0}`));
				}
				if (node.timelineRisk) {
					const risk = DOM.append(badges, DOM.$(`span.odp-chip.${checkpointRiskChipClass(node.timelineRisk)}`, { 'data-testid': 'checkpoint-timeline-risk' }, t(state, `checkpointAnalysis.risk.${node.timelineRisk}`)));
					appendKnoxGuiSvg(risk, checkpointRiskIcon(node.timelineRisk), 12);
				}
			}
			if (node.tags.length) {
				const tags = DOM.append(main, DOM.$('.knox-gui-timeline-badges'));
				for (const tag of node.tags) {
					checkpointBadge(tags, 'outline', tag, undefined, '.knox-gui-timeline-tag');
				}
			}
			const expanded = widget.checkpointTimelineExpanded.has(node.id);
			const toggle = DOM.append(top, DOM.$('button.knox-gui-timeline-toggle', { type: 'button', title: t(state, expanded ? 'collapse' : 'expand') })) as HTMLButtonElement;
			appendKnoxGuiSvg(toggle, expanded ? 'chevron-down' : 'chevron-right', 12);
			toggle.setAttribute('aria-expanded', String(expanded));
			toggle.setAttribute('aria-label', t(state, expanded ? 'collapse' : 'expand'));
			widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', e => {
				e.stopPropagation();
				if (expanded) {
					widget.checkpointTimelineExpanded.delete(node.id);
				} else {
					widget.checkpointTimelineExpanded.add(node.id);
				}
				widget.render();
			}));
			if (!expanded) {
				return;
			}
			const details = DOM.append(card, DOM.$('.knox-gui-timeline-details'));
			const context = node.conversationContext;
			if (context?.messageContent) {
				const message = DOM.append(details, DOM.$('.knox-gui-timeline-message'));
				const who = DOM.append(message, DOM.$('.knox-gui-timeline-message-role'));
				appendKnoxGuiSvg(who, context.role === 'user' ? 'user' : 'bot', 12);
				DOM.append(who, DOM.$('span', undefined, t(state, context.role === 'user' ? 'user' : 'ai')));
				DOM.append(message, DOM.$('p', undefined, context.messageContent));
			}
			const actions = DOM.append(details, DOM.$('.knox-gui-timeline-actions'));
			const action = (options: Omit<Parameters<typeof checkpointButton>[2], 'onClick'>, run: () => void) => checkpointButton(widget, actions, {
				size: 'xs',
				labelClass: 'knox-gui-cpl-show-card-18',
				...options,
				onClick: (_button, e) => {
					e?.stopPropagation();
					run();
				},
			});
			action({ svg: 'rotate-ccw', label: t(state, 'restore'), ariaLabel: t(state, 'restore') }, () => void widget.controller.openRestorePreview(node.id));
			const comparing = pickId === node.id;
			action({ svg: 'eye', label: t(state, comparing ? 'selectSecond' : 'compare'), ariaLabel: t(state, comparing ? 'selectSecond' : 'compare'), selected: comparing, variant: comparing ? 'default' : 'outline', testId: 'checkpoint-timeline-compare-button' }, () => {
				if (!comparing) {
					widget.controller.openCompare(node.id);
				}
			});
			action({ svg: 'git-branch', label: t(state, 'branch'), ariaLabel: t(state, 'branch'), testId: 'checkpoint-timeline-branch-button' }, () => {
				widget.checkpointTimelineBranchBase = node.id;
				widget.checkpointTimelineBranchName = '';
				widget.render();
			});
			action({ svg: 'trash-2', title: t(state, 'deleteAction'), ariaLabel: t(state, 'deleteAction'), variant: 'ghost', extraClass: 'is-tone-destructive', testId: 'checkpoint-timeline-delete' }, () => {
				widget.checkpointTimelineDeleteId = node.id;
				widget.render();
			});
		});
	}
	const footer = DOM.append(DOM.append(body, DOM.$('.knox-gui-timeline-footer')), DOM.$('.knox-gui-timeline-footer-row'));
	DOM.append(footer, DOM.$('span', undefined, t(state, 'totalCheckpoints', { count: nodes.length })));
	DOM.append(footer, DOM.$('span', undefined, t(state, 'checkpointTimeline.totalBranches', { count: branches.length })));
	renderTimelineForms(widget, body, state);
}

function renderTimelineForms(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const deleteId = widget.checkpointTimelineDeleteId;
	if (deleteId) {
		const close = () => {
			widget.checkpointTimelineDeleteId = null;
			widget.render();
		};
		const dialog = checkpointDialog(widget, body, 'checkpoint-timeline-delete-dialog', close, 'md');
		checkpointDialogHeader(dialog, t(state, 'deleteAction'), undefined, t(state, 'deleteCheckpointConfirm')).classList.add('is-alert');
		const actions = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
		checkpointButton(widget, actions, { label: t(state, 'cancel'), size: 'default', onClick: close });
		checkpointButton(widget, actions, {
			label: t(state, 'deleteAction'), variant: 'destructive', size: 'default', testId: 'checkpoint-timeline-delete-confirm', onClick: () => {
				widget.checkpointTimelineDeleteId = null;
				void widget.controller.deleteSelectedCheckpoints([deleteId]);
				widget.render();
			},
		});
	}
	const baseId = widget.checkpointTimelineBranchBase;
	if (baseId) {
		const close = () => {
			widget.checkpointTimelineBranchBase = null;
			widget.render();
		};
		const submit = () => {
			const name = widget.checkpointTimelineBranchName.trim();
			if (!name) {
				return;
			}
			widget.checkpointTimelineBranchBase = null;
			widget.checkpointTimelineBranchName = '';
			void widget.controller.createCheckpointBranch(name, baseId);
			widget.render();
		};
		const dialog = checkpointDialog(widget, body, 'checkpoint-timeline-branch-dialog', close, 'md');
		checkpointDialogHeader(dialog, t(state, 'branch'), 'git-branch');
		const field = DOM.append(dialog, DOM.$('.knox-gui-cpl-field'));
		DOM.append(field, DOM.$('label.knox-gui-cpl-label', { for: 'knox-checkpoint-branch-name' }, t(state, 'enterBranchName')));
		const input = DOM.append(field, DOM.$('input.knox-gui-cpl-input', { id: 'knox-checkpoint-branch-name', type: 'text' })) as HTMLInputElement;
		input.value = widget.checkpointTimelineBranchName;
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => { widget.checkpointTimelineBranchName = input.value; }));
		widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.isComposing) {
				e.preventDefault();
				submit();
			}
		}));
		const actions = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
		checkpointButton(widget, actions, { label: t(state, 'cancel'), size: 'default', onClick: close });
		checkpointButton(widget, actions, { svg: 'git-branch', label: t(state, 'branch'), variant: 'default', size: 'default', testId: 'checkpoint-timeline-branch-create', onClick: submit });
		setTimeout(() => input.focus(), 0);
	}
}

export function renderRestorePreviewDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void { // KN-375
	const close = () => {
		if (!state.checkpointRestoring) {
			widget.controller.closeCheckpointDialog();
		}
	};
	const dialog = checkpointDialog(widget, parent, 'restore-preview-dialog', close, '2xl', { title: t(state, 'close'), onClick: close });
	const node = state.checkpoints.find(item => item.id === state.checkpointRestoreId) ?? state.checkpointListItems.find(item => item.id === state.checkpointRestoreId);
	checkpointDialogHeader(dialog, t(state, 'restorePreviewTitle'), 'rotate-ccw', node?.description || state.checkpointRestorePreview?.description || t(state, 'restorePreviewSubtitle'));
	const body = DOM.append(dialog, DOM.$('.knox-gui-restore-body'));
	if (state.checkpointRestoreLoading) {
		DOM.append(body, DOM.$('p.knox-gui-restore-status', undefined, t(state, 'restorePreviewLoading')));
	} else if (state.checkpointRestoreError) {
		const error = DOM.append(body, DOM.$('p.knox-gui-restore-error', undefined, state.checkpointRestoreError === 'restorePreviewFailed' ? t(state, 'restorePreviewFailed') : state.checkpointRestoreError));
		error.setAttribute('data-testid', 'restore-preview-error');
	} else if (state.checkpointRestorePreview && !state.checkpointRestorePreview.files.length) {
		DOM.append(body, DOM.$('p.knox-gui-restore-empty', undefined, t(state, 'restorePreviewEmpty')));
	} else if (state.checkpointRestorePreview) {
		const preview = state.checkpointRestorePreview;
		const summary = DOM.append(body, DOM.$('.knox-gui-restore-summary'));
		DOM.append(summary, DOM.$('span.odp-chip.odp-chip-yellow', undefined, `${t(state, 'modified')}: ${preview.modified}`));
		DOM.append(summary, DOM.$('span.odp-chip.odp-chip-green', undefined, `${t(state, 'added')}: ${preview.added}`));
		DOM.append(summary, DOM.$('span.odp-chip.odp-chip-red', undefined, `${t(state, 'deleted')}: ${preview.deleted}`));
		DOM.append(body, DOM.$('p.knox-gui-restore-hint', undefined, t(state, 'restorePreviewExtrasHint')));
		const all = DOM.append(body, DOM.$('label.knox-gui-restore-all'));
		const allBox = checkpointCheckbox(all, preview.files.length > 0 && state.checkpointRestoreSelected.length === preview.files.length, t(state, 'selectAll'));
		widget.renderStore.add(DOM.addDisposableListener(allBox, 'change', () => widget.controller.toggleRestoreAll(allBox.checked)));
		DOM.append(all, DOM.$('span', undefined, t(state, 'selectAll')));
		const list = DOM.append(body, DOM.$('ul.knox-gui-restore-files'));
		for (const file of preview.files) {
			const row = DOM.append(list, DOM.$('li.knox-gui-restore-file'));
			const box = checkpointCheckbox(row, state.checkpointRestoreSelected.includes(file.relativePath), file.relativePath);
			widget.renderStore.add(DOM.addDisposableListener(box, 'change', () => widget.controller.toggleRestorePath(file.relativePath, box.checked)));
			appendKnoxGuiSvg(row, 'file', 14).classList.add('knox-gui-restore-file-icon');
			const meta = DOM.append(row, DOM.$('.knox-gui-restore-file-main'));
			DOM.append(meta, DOM.$('div.knox-gui-restore-file-path', { title: file.relativePath }, file.relativePath));
			const stats = DOM.append(meta, DOM.$('.knox-gui-restore-file-meta'));
			DOM.append(stats, DOM.$(`span.knox-gui-restore-${file.action}`, undefined, t(state, restorePreviewActionKey(file.action))));
			DOM.append(stats, DOM.$('span', undefined, `+${file.additions}/-${file.deletions}`));
			DOM.append(stats, DOM.$('span', undefined, t(state, 'restorePreviewHunks', { count: file.hunkCount })));
		}
		if (preview.extraPaths.length) {
			DOM.append(body, DOM.$('p.knox-gui-restore-note', undefined, `${t(state, 'restorePreviewWillDelete')}: ${preview.extraPaths.join(', ')}`));
		}
		if (preview.skippedFiles.length) {
			DOM.append(body, DOM.$('p.knox-gui-restore-note', undefined, `${t(state, 'restorePreviewSkipped')}: ${preview.skippedFiles.map(file => `${file.path} (${file.reason})`).join(', ')}`));
		}
		checkpointButton(widget, body, {
			svg: 'git-compare',
			label: state.checkpointRestoreShowDiff ? t(state, 'restorePreviewHideDiff') : t(state, 'restorePreviewShowDiff'),
			variant: 'ghost',
			extraClass: 'knox-gui-restore-diff-toggle',
			onClick: () => void widget.controller.toggleRestoreDiff(),
		});
		if (state.checkpointRestoreShowDiff && state.checkpointRestoreDiff) {
			widget.renderDiffViewer(DOM.append(body, DOM.$('.knox-gui-restore-diff')), state, state.checkpointRestoreDiff);
		}
	}
	const memory = DOM.append(dialog, DOM.$('.knox-gui-restore-memory'));
	widget.toggle(memory, t(state, 'checkpointGraph.menu.restoreMemory'), state.checkpointRestoreMemory, value => widget.controller.store.patch({ checkpointRestoreMemory: value }));
	const actions = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
	const busy = state.checkpointRestoring;
	checkpointButton(widget, actions, { label: t(state, 'cancel'), variant: 'ghost', size: 'default', disabled: busy, onClick: () => widget.controller.closeCheckpointDialog() });
	checkpointButton(widget, actions, { label: t(state, 'restoreSelectedCount', { count: state.checkpointRestoreSelected.length }), size: 'default', disabled: busy || state.checkpointRestoreLoading || !state.checkpointRestoreSelected.length, onClick: () => void widget.controller.restoreSelectedFiles() });
	checkpointButton(widget, actions, {
		label: state.checkpointRestorePreview && !state.checkpointRestorePreview.files.length ? t(state, 'restoreAnyway') : t(state, 'restoreAll'),
		variant: 'default',
		size: 'default',
		disabled: busy || state.checkpointRestoreLoading || Boolean(state.checkpointRestoreError),
		onClick: () => void widget.controller.restoreAllFiles(),
	});
}

export function renderCompareDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const close = () => widget.controller.closeCheckpointDialog();
	const dialog = checkpointDialog(widget, parent, 'checkpoint-compare-dialog', close, '6xl', { title: t(state, 'close'), onClick: close });
	const label = (id: string | undefined) => state.checkpointCompareCatalog.find(item => item.id === id) ?? state.checkpoints.find(node => node.id === id);
	const left = label(state.checkpointCompareLeftId);
	const right = label(state.checkpointCompareRightId);
	checkpointDialogHeader(dialog, t(state, 'compareTwoCheckpoints'), 'git-compare', `${(left?.description || state.checkpointCompareLeftId || '').slice(0, 48)} → ${(right?.description || state.checkpointCompareRightId || '').slice(0, 48)}`);
	const body = DOM.append(dialog, DOM.$('.knox-gui-compare-body'));
	if (state.checkpointCompareLoading) {
		DOM.append(body, DOM.$('p.knox-gui-compare-status', undefined, t(state, 'loadingPreviousCheckpoint')));
	} else if (state.checkpointCompareError) {
		DOM.append(body, DOM.$('p.knox-gui-compare-status', undefined, t(state, state.checkpointCompareError)));
	} else if (state.checkpointCompareDiff) {
		widget.renderDiffViewer(body, state, state.checkpointCompareDiff);
	}
	const footer = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
	checkpointButton(widget, footer, { label: t(state, 'close'), size: 'default', onClick: close });
}

export function renderDiffViewer(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, diff: NonNullable<IKnoxGuiState['checkpointCompareDiff']>): void {
	const changed = checkpointDiffChangedFiles(diff.files);
	if (!changed.length) {
		const empty = DOM.append(parent, DOM.$('.knox-gui-diff-viewer.knox-gui-diff-viewer-empty'));
		empty.setAttribute('data-testid', 'checkpoint-diff-empty');
		appendKnoxGuiSvg(empty, 'circle-check', 48).classList.add('knox-gui-diff-empty-icon');
		DOM.append(empty, DOM.$('p', undefined, t(state, 'noChangesDetected')));
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-diff-viewer'));
	wrap.setAttribute('data-testid', 'checkpoint-diff-viewer');
	const summary = checkpointDiffSummary(diff.files);
	const header = DOM.append(wrap, DOM.$('.knox-gui-diff-toolbar'));
	const route = DOM.append(header, DOM.$('.knox-gui-diff-route'));
	appendKnoxGuiSvg(route, 'git-compare', 16).classList.add('knox-gui-diff-route-icon');
	const routeText = DOM.append(route, DOM.$('.knox-gui-diff-route-text'));
	appendKnoxGuiSvg(routeText, 'clock', 12);
	DOM.append(routeText, DOM.$('span.knox-gui-diff-route-name', { title: diff.oldCheckpoint.description }, diff.oldCheckpoint.description));
	appendKnoxGuiSvg(routeText, 'chevron-right', 12);
	DOM.append(routeText, DOM.$('span.knox-gui-diff-route-name', { title: diff.newCheckpoint.description }, diff.newCheckpoint.description));
	const controls = DOM.append(header, DOM.$('.knox-gui-diff-controls'));
	const totals = DOM.append(controls, DOM.$('.knox-gui-diff-summary'));
	totals.setAttribute('data-testid', 'checkpoint-diff-summary');
	DOM.append(totals, DOM.$('span.knox-gui-diff-summary-files', undefined, t(state, 'filesChanged', { count: summary.filesChanged })));
	DOM.append(totals, DOM.$('span.knox-gui-diff-vsep'));
	const plus = DOM.append(totals, DOM.$('span.knox-gui-diff-summary-stat.odp-text-green'));
	appendKnoxGuiSvg(plus, 'plus', 12);
	DOM.append(plus, DOM.$('span.sr-only', undefined, '+'));
	plus.append(String(summary.additions));
	const minus = DOM.append(totals, DOM.$('span.knox-gui-diff-summary-stat.odp-text-red'));
	appendKnoxGuiSvg(minus, 'minus', 12);
	DOM.append(minus, DOM.$('span.sr-only', undefined, '-'));
	minus.append(String(summary.deletions));
	DOM.append(controls, DOM.$('span.knox-gui-diff-vsep'));
	const toggles = DOM.append(controls, DOM.$('.knox-gui-diff-toggles'));
	const isSplit = state.checkpointDiffView === 'split';
	checkpointButton(widget, toggles, { svg: 'columns-2', label: t(state, 'split'), title: t(state, 'splitView'), selected: isSplit, variant: isSplit ? 'default' : 'outline', size: 'xs', onClick: () => widget.controller.store.patch({ checkpointDiffView: 'split' }) });
	checkpointButton(widget, toggles, { svg: 'file-text', label: t(state, 'unified'), title: t(state, 'unifiedView'), selected: !isSplit, variant: isSplit ? 'outline' : 'default', size: 'xs', onClick: () => widget.controller.store.patch({ checkpointDiffView: 'unified' }) });
	checkpointButton(widget, toggles, { svg: 'wrap-text', title: t(state, state.checkpointDiffWrap ? 'disableTextWrapping' : 'enableTextWrapping'), ariaLabel: t(state, state.checkpointDiffWrap ? 'disableTextWrapping' : 'enableTextWrapping'), selected: state.checkpointDiffWrap, variant: state.checkpointDiffWrap ? 'default' : 'outline', size: 'xs', onClick: () => widget.controller.store.patch({ checkpointDiffWrap: !state.checkpointDiffWrap }) });
	checkpointButton(widget, toggles, { svg: widget.checkpointDiffTreeCollapsed ? 'panel-left-open' : 'panel-left-close', title: t(state, widget.checkpointDiffTreeCollapsed ? 'showFileTree' : 'hideFileTree'), ariaLabel: t(state, widget.checkpointDiffTreeCollapsed ? 'showFileTree' : 'hideFileTree'), size: 'xs', onClick: () => { widget.checkpointDiffTreeCollapsed = !widget.checkpointDiffTreeCollapsed; widget.render(); } });

	const split = DOM.append(wrap, DOM.$(widget.checkpointDiffTreeCollapsed ? '.knox-gui-diff-split.tree-collapsed' : '.knox-gui-diff-split'));
	const selected = changed.find(file => file.relativePath === state.checkpointDiffSelectedFile) ?? changed[0];
	if (!widget.checkpointDiffTreeCollapsed) {
		const tree = DOM.append(split, DOM.$('.knox-gui-file-tree'));
		tree.setAttribute('data-testid', 'checkpoint-diff-tree');
		widget.renderFileTree(tree, { ...state, checkpointDiffSelectedFile: selected.relativePath }, changed, path => widget.controller.store.patch({ checkpointDiffSelectedFile: path }));
	}
	const pane = DOM.append(split, DOM.$('.knox-gui-diff-pane'));
	const fileHead = DOM.append(pane, DOM.$('.knox-gui-diff-file-head'));
	widget.appendFileIcon(fileHead, selected.relativePath, 14);
	DOM.append(fileHead, DOM.$('div.knox-gui-diff-file-name', { title: selected.relativePath }, selected.relativePath));
	if (selected.isBinary) {
		renderBinaryDiff(pane, state, selected);
		return;
	}
	const stats = DOM.append(fileHead, DOM.$('span.knox-gui-diff-file-stats'));
	DOM.append(stats, DOM.$('span.odp-text-green', undefined, `+${selected.additions}`));
	DOM.append(stats, DOM.$('span.odp-text-red', undefined, `-${selected.deletions}`));
	const lines = computeLineDiff(selected.oldContent ?? '', selected.newContent ?? '');
	const wordAlt = hunkWordAltRanges(lines);
	const view = DOM.append(pane, DOM.$(state.checkpointDiffWrap ? 'div.knox-gui-diff-hunks.wrap.pierre-diff-container' : 'div.knox-gui-diff-hunks.pierre-diff-container'));
	const gutter = (el: HTMLElement, value: number | null) => DOM.append(el, DOM.$('span.knox-gui-diff-gutter', undefined, value != null ? String(value) : ''));
	const renderRun = (block: HTMLElement, start: number, end: number) => {
		const run = lines.slice(start, end);
		if (state.checkpointDiffView === 'unified') {
			run.forEach((line, offset) => {
				const row = DOM.append(block, DOM.$(`div.knox-gui-diff-line.knox-gui-diff-${line.type}`));
				gutter(row, line.oldLineNum);
				gutter(row, line.newLineNum);
				DOM.append(row, DOM.$('span.knox-gui-diff-sign', undefined, line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '));
				paintDiffCode(widget, DOM.append(row, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[start + offset]);
			});
			return;
		}
		for (const pair of alignSplitDiffRows(run)) {
			const row = DOM.append(block, DOM.$('.knox-gui-diff-split-row'));
			for (const [side, index] of [['old', pair.left], ['new', pair.right]] as const) {
				const line = index === undefined ? undefined : run[index];
				if (!line) {
					DOM.append(row, DOM.$('span.knox-gui-diff-empty'));
					continue;
				}
				const cell = DOM.append(row, DOM.$(`span.knox-gui-diff-cell.knox-gui-diff-${line.type}`));
				gutter(cell, side === 'old' ? line.oldLineNum : line.newLineNum);
				paintDiffCode(widget, DOM.append(cell, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[start + index!]);
			}
		}
	};
	for (const segment of buildDiffSegments(lines)) {
		const key = `${selected.relativePath}:${segment.start}`;
		if (segment.kind === 'gap' && !widget.checkpointDiffExpandedGaps.has(key)) {
			const gap = DOM.append(view, DOM.$('button.knox-gui-diff-gap', { type: 'button' }));
			gap.setAttribute('data-testid', 'checkpoint-diff-gap');
			appendKnoxGuiSvg(gap, 'chevrons-up-down', 12);
			DOM.append(gap, DOM.$('span', undefined, t(state, 'linesHiddenExpand', { hidden: segment.end - segment.start })));
			widget.renderStore.add(DOM.addDisposableListener(gap, 'click', () => {
				widget.checkpointDiffExpandedGaps.add(key);
				widget.render();
			}));
			continue;
		}
		const block = DOM.append(view, DOM.$('.knox-gui-diff-hunk'));
		if (segment.kind === 'lines') {
			const run = lines.slice(segment.start, segment.end);
			const oldStart = run.find(line => line.oldLineNum != null)?.oldLineNum ?? 0;
			const newStart = run.find(line => line.newLineNum != null)?.newLineNum ?? 0;
			DOM.append(block, DOM.$('div.knox-gui-diff-hunk-head', undefined, `@@ -${oldStart} +${newStart} @@`));
		}
		renderRun(block, segment.start, segment.end);
	}
}

function renderBinaryDiff(pane: HTMLElement, state: IKnoxGuiState, file: IKnoxGuiCheckpointDiffFile): void {
	const grid = DOM.append(pane, DOM.$('.knox-gui-diff-binary'));
	grid.setAttribute('data-testid', 'checkpoint-diff-binary');
	const side = (title: string, content: string | null, encoding?: string) => {
		const card = DOM.append(grid, DOM.$('.knox-gui-diff-binary-card'));
		DOM.append(card, DOM.$('h4', undefined, title));
		const mime = checkpointImageMime(file.relativePath, encoding);
		if (mime && content) {
			const img = DOM.append(card, DOM.$<HTMLImageElement>('img.knox-gui-diff-binary-image'));
			img.src = `data:${mime};base64,${content}`;
			img.alt = file.relativePath;
			return;
		}
		const notice = DOM.append(card, DOM.$('.knox-gui-diff-binary-notice'));
		appendKnoxGuiSvg(notice, 'file-warning', 32);
		DOM.append(notice, DOM.$('p', undefined, t(state, 'binaryFileNotice')));
		const bytes = checkpointDiffContentBytes(content, encoding);
		if (bytes !== undefined) {
			DOM.append(notice, DOM.$('p.knox-gui-diff-binary-size', undefined, formatSnapshotSize(bytes)));
		}
	};
	if (file.status !== 'added') {
		side(t(state, 'previousVersion'), file.oldContent, file.oldEncoding);
	}
	if (file.status !== 'deleted') {
		side(t(state, 'currentVersion'), file.newContent, file.newEncoding);
	}
}

function paintDiffCode(widget: KnoxGuiWidget, el: HTMLElement, content: string, filepath: string, ranges: ReturnType<typeof hunkWordAltRanges>[number]): void {
	widget.paintHighlightedCode(el, languageIdFromFence('', filepath), content, filepath);
	wrapTextRanges(el, ranges, 'knox-gui-diff-word-alt');
}

function wrapTextRanges(root: HTMLElement, ranges: IKnoxGuiTextRange[] | undefined, className: string): void {
	if (!ranges?.length) {
		return;
	}
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		nodes.push(walker.currentNode as Text);
	}
	let offset = 0;
	for (const node of nodes) {
		const text = node.data;
		const from = offset;
		const to = offset + text.length;
		offset = to;
		const hits = ranges.filter(range => range.start < to && range.end > from);
		if (!hits.length || !node.parentNode) {
			continue;
		}
		const frag = document.createDocumentFragment();
		let cursor = 0;
		const local = hits
			.map(range => ({ start: Math.max(0, range.start - from), end: Math.min(text.length, range.end - from) }))
			.filter(range => range.end > range.start)
			.sort((a, b) => a.start - b.start);
		for (const hit of local) {
			if (hit.start > cursor) {
				frag.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
			}
			const mark = document.createElement('span');
			mark.className = className;
			if (className === 'knox-gui-diff-word-alt') {
				mark.setAttribute('data-testid', 'knox-gui-diff-word-alt');
			}
			mark.textContent = text.slice(hit.start, hit.end);
			frag.appendChild(mark);
			cursor = hit.end;
		}
		if (cursor < text.length) {
			frag.appendChild(document.createTextNode(text.slice(cursor)));
		}
		node.parentNode.replaceChild(frag, node);
	}
}

export function renderFileTree(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, files: IKnoxGuiCheckpointDiffFile[], onSelect: (path: string) => void): void {
	const byPath = new Map(files.map(file => [file.relativePath, file]));
	const chip = (row: HTMLElement, label: string, tone: string) => DOM.append(row, DOM.$(`span.odp-chip.${tone}.knox-gui-file-tree-chip`, undefined, label));
	const renderNodes = (nodes: ReturnType<typeof buildCheckpointFileTree>, depth: number) => {
		for (const node of nodes) {
			const collapsed = node.isDirectory && widget.checkpointDiffCollapsedFolders.has(node.path);
			const row = DOM.append(parent, DOM.$(node.isDirectory ? '.knox-gui-file-tree-row.is-folder' : '.knox-gui-file-tree-row'));
			row.style.paddingLeft = `${(depth + (node.isDirectory ? 1 : 2)) * 12}px`;
			row.title = node.path;
			if (node.path === state.checkpointDiffSelectedFile) {
				row.classList.add('selected');
			}
			if (node.isDirectory) {
				appendKnoxGuiSvg(row, collapsed ? 'chevron-right' : 'chevron-down', 14).classList.add('knox-gui-file-tree-chevron');
			} else {
				widget.appendFileIcon(row, node.name, 14);
			}
			DOM.append(row, DOM.$('span.knox-gui-file-tree-name', undefined, node.name));
			const file = byPath.get(node.path);
			if (file && !node.isDirectory) {
				const stats = DOM.append(row, DOM.$('span.knox-gui-file-tree-stats'));
				if (file.isBinary) {
					chip(stats, 'BIN', 'odp-chip-yellow');
				}
				if (file.status === 'added') {
					chip(stats, 'A', 'odp-chip-green');
				} else if (file.status === 'deleted') {
					chip(stats, 'D', 'odp-chip-red');
				} else if (!file.isBinary) {
					if (file.additions) {
						DOM.append(stats, DOM.$('span.odp-text-green', undefined, `+${file.additions}`));
					}
					if (file.deletions) {
						DOM.append(stats, DOM.$('span.odp-text-red', undefined, `-${file.deletions}`));
					}
				}
			}
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
				if (!node.isDirectory) {
					onSelect(node.path);
					return;
				}
				if (collapsed) {
					widget.checkpointDiffCollapsedFolders.delete(node.path);
				} else {
					widget.checkpointDiffCollapsedFolders.add(node.path);
				}
				widget.render();
			}));
			if (node.children && !collapsed) {
				renderNodes(node.children, depth + 1);
			}
		}
	};
	renderNodes(buildCheckpointFileTree(files.map(file => file.relativePath)), 0);
}

export function renderCheckpointConfig(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const draft = state.checkpointConfigDraft ?? DEFAULT_CHECKPOINT_CONFIG;
	const inputs = widget.checkpointConfigInputs;
	const storageText = inputs.storage ?? formatCheckpointBytes(draft.maxStorageBytes);
	const fileSizeText = inputs.fileSize ?? formatCheckpointBytes(draft.maxFileSizeBytes);
	const extensionsText = inputs.extensions ?? draft.trackedExtensions.join(', ');
	const errors = checkpointConfigFieldErrors(draft, storageText, fileSizeText);
	const hasErrors = Object.keys(errors).length > 0;
	const dirty = checkpointConfigIsDirty(draft, state.checkpointConfig, storageText);
	const loading = state.checkpointConfigLoading;
	const patch = (partial: Partial<typeof DEFAULT_CHECKPOINT_CONFIG>) => widget.controller.patchCheckpointConfig(partial);

	body.classList.add('knox-gui-cp-view');
	const root = DOM.append(body, DOM.$('.knox-gui-cp-config'));
	const header = DOM.append(root, DOM.$('.knox-gui-checkpoint-config-header'));
	const heading = DOM.append(header, DOM.$('.knox-gui-checkpoint-config-heading'));
	appendKnoxGuiSvg(heading, 'settings', 16).classList.add('knox-gui-cp-cyan');
	DOM.append(heading, DOM.$('h1', undefined, t(state, 'checkpointConfiguration')));
	if (dirty) {
		cpBadge(heading, 'secondary', t(state, 'unsavedChanges'), 'knox-gui-cp-unsaved').setAttribute('data-testid', 'checkpoint-config-unsaved');
	}
	const status = state.checkpointConfigStatus;
	if (status) {
		const alert = DOM.append(root, DOM.$(`.knox-gui-checkpoint-config-status.is-${status.type}`, { 'data-testid': 'checkpoint-config-status', role: 'alert' }));
		appendKnoxGuiSvg(alert, status.type === 'success' ? 'circle-check-big' : status.type === 'error' ? 'alert-circle' : 'info', 16);
		const text = status.messageKey === 'checkpointSaveFailed' ? `${t(state, status.messageKey)}: ${status.detail ?? t(state, 'unknownError')}` : t(state, status.messageKey);
		DOM.append(alert, DOM.$('div.knox-gui-checkpoint-config-status-text', undefined, text));
	}

	const sections = DOM.append(root, DOM.$('.knox-gui-cp-config-sections', { 'data-testid': 'checkpoint-config-sections' }));
	const row = (card: HTMLElement, id: string, labelKey: string, helpKey: string, error: string | undefined, control: (slot: HTMLElement) => void) => {
		const line = DOM.append(card, DOM.$('.knox-gui-checkpoint-config-row', { 'data-field': id }));
		const text = DOM.append(line, DOM.$('.knox-gui-checkpoint-config-text'));
		DOM.append(text, DOM.$('label', { for: id }, t(state, labelKey)));
		DOM.append(text, DOM.$('p.knox-gui-checkpoint-config-help', { id: `${id}-help` }, t(state, helpKey)));
		if (error) {
			DOM.append(text, DOM.$('p.knox-gui-checkpoint-config-error', { id: `${id}-error`, 'data-testid': 'checkpoint-config-error' }, t(state, error)));
		}
		const slot = DOM.append(line, DOM.$('.knox-gui-checkpoint-config-control'));
		slot.setAttribute('aria-describedby', error ? `${id}-help ${id}-error` : `${id}-help`);
		control(slot);
	};
	const numberInput = (slot: HTMLElement, id: string, value: number, min: number, max: number, invalid: boolean, onValue: (raw: string) => void) => {
		const input = DOM.append(slot, DOM.$('input', { id })) as HTMLInputElement;
		input.type = 'number';
		input.min = String(min);
		input.max = String(max);
		input.value = String(value);
		input.disabled = loading;
		input.setAttribute('aria-invalid', String(invalid));
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => onValue(input.value)));
	};
	const textInput = (slot: HTMLElement, id: string, value: string, placeholder: string, invalid: boolean, onValue: (raw: string) => void, onBlur: () => void) => {
		const input = DOM.append(slot, DOM.$('input', { id })) as HTMLInputElement;
		input.type = 'text';
		input.value = value;
		input.placeholder = placeholder;
		input.disabled = loading;
		input.setAttribute('aria-invalid', String(invalid));
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => onValue(input.value)));
		widget.renderStore.add(DOM.addDisposableListener(input, 'blur', onBlur));
	};
	const switchInput = (slot: HTMLElement, id: string, labelKey: string, value: boolean, onValue: (value: boolean) => void) => {
		const el = widget.customSwitch(DOM.append(slot, DOM.$('.knox-gui-cp-switch-wrap')), value, () => {
			if (!loading) {
				onValue(!value);
			}
		}, 16);
		el.id = id;
		el.setAttribute('aria-label', t(state, labelKey));
		el.setAttribute('aria-disabled', String(loading));
	};
	const storageRawChange = (key: 'storage' | 'fileSize', field: 'maxStorageBytes' | 'maxFileSizeBytes', raw: string) => {
		widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, [key]: raw };
		const bytes = parseStorageBytes(raw);
		if (bytes !== null) {
			patch({ [field]: bytes });
		} else {
			widget.render();
		}
	};
	const storageBlur = (key: 'storage' | 'fileSize', min: number) => {
		const raw = widget.checkpointConfigInputs[key];
		const bytes = raw === undefined ? null : parseStorageBytes(raw);
		if (bytes !== null && bytes >= min) {
			widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, [key]: undefined };
			widget.render();
		}
	};

	const storage = configSection(sections, t(state, 'storageLimits'), 'hard-drive');
	row(storage, 'maxCheckpoints', 'maxCheckpoints', 'checkpointMaxHelp', errors.maxCheckpoints, slot => numberInput(slot, 'maxCheckpoints', draft.maxCheckpoints, 1, 10000, Boolean(errors.maxCheckpoints), raw => patch({ maxCheckpoints: checkpointConfigNumber(raw, 1) })));
	row(storage, 'retentionDays', 'retentionPeriodDays', 'checkpointRetentionHelp', errors.retentionDays, slot => numberInput(slot, 'retentionDays', draft.retentionDays, 1, 365, Boolean(errors.retentionDays), raw => patch({ retentionDays: checkpointConfigNumber(raw, 1) })));
	row(storage, 'maxStorage', 'maxStorageSize', 'checkpointStorageHelp', errors.maxStorageBytes, slot => textInput(slot, 'maxStorage', storageText, '1 GB', Boolean(errors.maxStorageBytes), raw => storageRawChange('storage', 'maxStorageBytes', raw), () => storageBlur('storage', 1024 * 1024)));

	const automation = configSection(sections, t(state, 'checkpointAutomation'), 'clock');
	row(automation, 'enableAutoCheckpoints', 'enableAutoCheckpoints', 'checkpointAutoCheckpointsHelp', undefined, slot => switchInput(slot, 'enableAutoCheckpoints', 'enableAutoCheckpoints', draft.enableAutoCheckpoints, value => patch({ enableAutoCheckpoints: value })));
	row(automation, 'autoEnabled', 'enableTimedAutoCheckpoints', 'checkpointTimedAutoHelp', undefined, slot => switchInput(slot, 'autoEnabled', 'enableTimedAutoCheckpoints', draft.autoEnabled, value => patch({ autoEnabled: value })));
	if (draft.autoEnabled) {
		row(automation, 'autoMinInterval', 'autoMinIntervalSeconds', 'checkpointAutoIntervalHelp', errors.autoMinIntervalMs, slot => numberInput(slot, 'autoMinInterval', Math.round(draft.autoMinIntervalMs / 1000), 1, 3600, Boolean(errors.autoMinIntervalMs), raw => patch({ autoMinIntervalMs: checkpointConfigNumber(raw, 1) * 1000 })));
		row(automation, 'autoFileChangeThreshold', 'autoFileChangeThreshold', 'checkpointAutoFileThresholdHelp', errors.autoFileChangeThreshold, slot => numberInput(slot, 'autoFileChangeThreshold', draft.autoFileChangeThreshold, 1, 10000, Boolean(errors.autoFileChangeThreshold), raw => patch({ autoFileChangeThreshold: checkpointConfigNumber(raw, 1) })));
		row(automation, 'autoShowNotifications', 'autoShowNotifications', 'checkpointAutoNotifyHelp', undefined, slot => switchInput(slot, 'autoShowNotifications', 'autoShowNotifications', draft.autoShowNotifications, value => patch({ autoShowNotifications: value })));
	}
	row(automation, 'autoCleanup', 'autoCleanup', 'checkpointAutoCleanupHelp', undefined, slot => switchInput(slot, 'autoCleanup', 'autoCleanup', draft.autoCleanup, value => patch({ autoCleanup: value })));
	if (draft.autoCleanup) {
		row(automation, 'cleanupInterval', 'cleanupInterval', 'checkpointCleanupIntervalHelp', undefined, slot => {
			const interval = cpSelect(slot, 'cleanupInterval');
			interval.setAttribute('aria-label', t(state, 'cleanupInterval'));
			interval.disabled = loading;
			for (const option of CHECKPOINT_CLEANUP_INTERVALS) {
				const el = DOM.append(interval, DOM.$('option')) as HTMLOptionElement;
				el.value = String(option.value);
				el.textContent = t(state, option.key);
				el.selected = option.value === draft.cleanupIntervalHours;
			}
			widget.renderStore.add(DOM.addDisposableListener(interval, 'change', () => patch({ cleanupIntervalHours: Number.parseInt(interval.value, 10) })));
		});
	}

	const performance = configSection(sections, t(state, 'performanceSettings'), 'zap');
	row(performance, 'maxFiles', 'maxFilesPerCheckpoint', 'checkpointMaxFilesHelp', errors.maxFilesPerCheckpoint, slot => numberInput(slot, 'maxFiles', draft.maxFilesPerCheckpoint, 1, 100000, Boolean(errors.maxFilesPerCheckpoint), raw => patch({ maxFilesPerCheckpoint: checkpointConfigNumber(raw, 1) })));
	row(performance, 'maxFileSize', 'maxFileSize', 'checkpointMaxFileSizeHelp', errors.maxFileSizeBytes, slot => textInput(slot, 'maxFileSize', fileSizeText, '5 MB', Boolean(errors.maxFileSizeBytes), raw => storageRawChange('fileSize', 'maxFileSizeBytes', raw), () => storageBlur('fileSize', 1024)));
	row(performance, 'enableCompression', 'enableCompression', 'checkpointCompressionHelp', undefined, slot => switchInput(slot, 'enableCompression', 'enableCompression', draft.enableCompression, value => patch({ enableCompression: value })));
	row(performance, 'encryptAtRest', 'encryptAtRest', 'checkpointEncryptAtRestHelp', undefined, slot => switchInput(slot, 'encryptAtRest', 'encryptAtRest', draft.encryptAtRest, value => patch({ encryptAtRest: value })));

	const tracking = configSection(sections, t(state, 'fileTracking'), 'file-text');
	row(tracking, 'trackedExtensions', 'trackedFileExtensions', 'checkpointTrackedExtensionsHelp', undefined, slot => textInput(slot, 'trackedExtensions', extensionsText, t(state, 'fileExtensionsPlaceholder'), false, raw => {
		widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, extensions: raw };
		patch({ trackedExtensions: parseTrackedExtensions(raw) });
	}, () => {
		if (widget.checkpointConfigInputs.extensions !== undefined) {
			widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, extensions: undefined };
			widget.render();
		}
	}));
	row(tracking, 'captureBinaryFiles', 'captureBinaryFiles', 'checkpointCaptureBinaryHelp', undefined, slot => switchInput(slot, 'captureBinaryFiles', 'captureBinaryFiles', draft.captureBinaryFiles, value => patch({ captureBinaryFiles: value })));

	const clearInputs = () => { widget.checkpointConfigInputs = {}; };
	const actions = DOM.append(root, DOM.$('.knox-gui-config-actions'));
	cpButton(widget, actions, { variant: 'outline', svg: 'clock', label: t(state, 'reset'), disabled: loading, testId: 'checkpoint-config-reset', onClick: () => { clearInputs(); widget.controller.resetCheckpointConfigToDefaults(); } });
	cpButton(widget, actions, { variant: 'outline', svg: 'x', label: t(state, 'cancel'), disabled: loading || !dirty, testId: 'checkpoint-config-cancel', onClick: () => { clearInputs(); widget.controller.cancelCheckpointConfig(); } });
	cpButton(widget, actions, {
		variant: 'default',
		svg: loading ? undefined : 'save',
		spinner: loading,
		label: t(state, loading ? 'saving' : 'save'),
		disabled: loading || !dirty || hasErrors,
		testId: 'checkpoint-config-save',
		onClick: () => {
			void widget.controller.saveCheckpointConfig().then(() => {
				if (widget.controller.store.state.checkpointConfigStatus?.type === 'success') {
					clearInputs();
					widget.render();
				}
			});
		},
	});
}

function configSection(body: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = DOM.append(body, DOM.$('.knox-gui-config-card'));
	const head = DOM.append(DOM.append(card, DOM.$('.knox-gui-config-card-head')), DOM.$('.knox-gui-config-card-title'));
	appendKnoxGuiSvg(DOM.append(head, DOM.$('span.knox-gui-cp-cyan')), icon, 16);
	DOM.append(head, DOM.$('span.knox-gui-cp-truncate', undefined, title));
	return DOM.append(card, DOM.$('.knox-gui-config-card-body'));
}

function cpButton(widget: KnoxGuiWidget, parent: HTMLElement, options: { variant: 'default' | 'outline'; label: string; svg?: KnoxGuiSvgIcon; spinner?: boolean; disabled?: boolean; testId?: string; small?: boolean; onClick: () => void }): HTMLButtonElement {
	const button = DOM.append(parent, DOM.$(`button.knox-gui-cp-btn.is-${options.variant}${options.small ? '.is-sm' : ''}`)) as HTMLButtonElement;
	button.type = 'button';
	button.disabled = Boolean(options.disabled);
	if (options.testId) {
		button.setAttribute('data-testid', options.testId);
	}
	if (options.spinner) {
		DOM.append(button, DOM.$('span.knox-gui-cp-spinner'));
	} else if (options.svg) {
		appendKnoxGuiSvg(button, options.svg, 16);
	}
	DOM.append(button, DOM.$('span', undefined, options.label));
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', e => {
		e.stopPropagation();
		options.onClick();
	}));
	return button;
}

/** shadcn `Badge` variants. */
function cpBadge(parent: HTMLElement, variant: 'default' | 'secondary' | 'destructive', text: string, extraClass?: string): HTMLElement {
	return DOM.append(parent, DOM.$(`span.knox-gui-cp-badge.is-${variant}${extraClass ? `.${extraClass}` : ''}`, undefined, text));
}

/** shadcn `SelectTrigger`: bordered box with a trailing 16px chevron at 50% opacity. */
function cpSelect(parent: HTMLElement, id: string): HTMLSelectElement {
	const wrap = DOM.append(parent, DOM.$('.knox-gui-cp-select'));
	const select = DOM.append(wrap, DOM.$('select', { id })) as HTMLSelectElement;
	appendKnoxGuiSvg(wrap, 'chevron-down', 16);
	return select;
}

function cpTabs(widget: KnoxGuiWidget, parent: HTMLElement, extraClass: string, tabs: Array<{ id: string; label: string; selected: boolean; svg?: KnoxGuiSvgIcon; testId: string; onClick: () => void }>): HTMLElement[] {
	const list = DOM.append(parent, DOM.$(`.knox-gui-cp-tabs.${extraClass}`, { role: 'tablist' }));
	return tabs.map(tab => {
		const button = DOM.append(list, DOM.$(`button.knox-gui-cp-tab${tab.selected ? '.is-active' : ''}`, { role: 'tab', 'data-testid': tab.testId })) as HTMLButtonElement;
		button.type = 'button';
		button.setAttribute('aria-selected', String(tab.selected));
		if (tab.svg) {
			appendKnoxGuiSvg(button, tab.svg, 16);
		}
		DOM.append(button, DOM.$('span', undefined, tab.label));
		widget.renderStore.add(DOM.addDisposableListener(button, 'click', e => {
			e.stopPropagation();
			tab.onClick();
		}));
		return button;
	});
}

function cpLoading(body: HTMLElement, text: string, testId?: string): void {
	const loading = DOM.append(body, DOM.$('.knox-gui-cp-loading'));
	if (testId) {
		loading.setAttribute('data-testid', testId);
	}
	appendKnoxGuiSvg(loading, 'loader-2', 16).classList.add('knox-gui-cp-spin');
	DOM.append(loading, DOM.$('span', undefined, text));
}

function cpEmptyCard(parent: HTMLElement, icon: KnoxGuiSvgIcon, title: string, hint: string | undefined, testId: string): void {
	const empty = DOM.append(parent, DOM.$('.knox-gui-cp-card.knox-gui-cp-empty', { 'data-testid': testId }));
	appendKnoxGuiSvg(empty, icon, 32);
	DOM.append(empty, DOM.$('p', undefined, title));
	if (hint) {
		DOM.append(empty, DOM.$('p.knox-gui-cp-empty-hint', undefined, hint));
	}
}

const CHECKPOINT_CREATION_FILL = { dark: '#c4b5fd', light: '#7c3aed' } as const;
const CHECKPOINT_STORAGE_FILL = { dark: '#38bdf8', light: '#0284c7' } as const;

export function renderCheckpointDashboard(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-375
	const data = state.checkpointDashboard;
	body.classList.add('knox-gui-cp-view');
	if (state.checkpointDashboardLoading) {
		const loading = DOM.append(body, DOM.$('.knox-gui-cp-dash-loading', { 'data-testid': 'checkpoint-dashboard-loading' }));
		DOM.append(loading, DOM.$('.knox-gui-cp-skeleton.is-title'));
		DOM.append(loading, DOM.$('.knox-gui-cp-skeleton.is-bar'));
		cpLoading(loading, t(state, 'checkpointDashboard.loading'));
		return;
	}
	if (!data) {
		DOM.append(body, DOM.$('p.knox-gui-cp-muted.knox-gui-checkpoint-dash-nodata', { 'data-testid': 'checkpoint-dashboard-nodata' }, t(state, 'checkpointDashboard.noData')));
		return;
	}
	body.classList.add('is-fill');
	body.setAttribute('data-testid', 'knox-gui-checkpoint-dashboard');
	const root = DOM.append(body, DOM.$('.knox-gui-cp-fill-root'));
	const title = DOM.append(root, DOM.$('h2.knox-gui-cp-title'));
	appendKnoxGuiSvg(title, 'bar-chart-3', 16);
	DOM.append(title, DOM.$('span', undefined, t(state, 'checkpointDashboard.title')));
	const tabbed = DOM.append(root, DOM.$('.knox-gui-cp-tabbed'));
	cpTabs(widget, tabbed, 'knox-gui-dash-tabs', (['overview', 'storage', 'activity', 'ai'] as const).map(tab => ({
		id: tab,
		label: t(state, `checkpointDashboard.${tab}`),
		selected: state.checkpointDashboardTab === tab,
		testId: `checkpoint-dashboard-tab-${tab}`,
		onClick: () => widget.controller.store.patch({ checkpointDashboardTab: tab }),
	})));
	const content = DOM.append(tabbed, DOM.$('.knox-gui-cp-tab-content', { role: 'tabpanel' }));
	const theme = widget.isLightTheme() ? 'light' : 'dark';
	const summary = data.summary;
	const storage = data.currentStorage ?? { totalBytes: 0, checkpointCount: 0 };
	const heading = (parent: HTMLElement, icon: KnoxGuiSvgIcon, key: string, strong: boolean) => {
		const h3 = DOM.append(parent, DOM.$(`h3.knox-gui-cp-heading${strong ? '.is-strong' : ''}`));
		appendKnoxGuiSvg(h3, icon, 16);
		DOM.append(h3, DOM.$('span', undefined, t(state, key)));
		return h3;
	};
	const daysChip = (parent: HTMLElement, count: number) => DOM.append(parent, DOM.$('span.odp-chip.knox-gui-cp-days', undefined, t(state, 'checkpointDashboard.lastDays', { count })));
	const emptyCard = (parent: HTMLElement, key: string) => DOM.append(parent, DOM.$('.knox-gui-cp-card.knox-gui-dash-empty', undefined, t(state, key)));
	if (state.checkpointDashboardTab === 'overview') {
		const cards = DOM.append(content, DOM.$('.knox-gui-dash-cards'));
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalCheckpoints'), String(summary.totalCheckpointsCreated), 'database');
		dashCard(widget, cards, t(state, 'checkpointDashboard.restorationRate'), `${summary.restorationSuccessRate.toFixed(0)}%`, 'activity');
		dashCard(widget, cards, t(state, 'checkpointDashboard.avgCreateTime'), formatCheckpointDuration(summary.avgCreationTimeMs), 'clock');
		dashCard(widget, cards, t(state, 'checkpointDashboard.storageUsed'), formatDashboardBytes(storage.totalBytes), 'hard-drive');
		const rows = fillDailyCounts(data.creationFrequency);
		const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
		const head = DOM.append(section, DOM.$('.knox-gui-dash-heading'));
		heading(head, 'bar-chart-3', 'checkpointDashboard.creationFrequency', false);
		daysChip(head, rows.length);
		if (!data.creationFrequency.length) {
			emptyCard(section, 'checkpointDashboard.noData');
		} else {
			const card = DOM.append(section, DOM.$('.knox-gui-cp-card.knox-gui-chart-card'));
			renderBarChart(widget, card, t(state, 'checkpointDashboard.creationFrequency'), rows.map(row => ({ label: row.date, value: row.count })), compactAxisNumber, CHECKPOINT_CREATION_FILL[theme], 'Checkpoints', 32, true);
			DOM.append(card, DOM.$('p.knox-gui-cp-muted.knox-gui-chart-footer', undefined, t(state, 'checkpointDashboard.createdInRange', { count: rows.reduce((sum, row) => sum + row.count, 0) })));
		}
	} else if (state.checkpointDashboardTab === 'storage') {
		const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
		heading(DOM.append(section, DOM.$('.knox-gui-dash-heading')), 'hard-drive', 'checkpointDashboard.storageUsage', false);
		const cards = DOM.append(section, DOM.$('.knox-gui-dash-cards'));
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalStorage'), formatDashboardBytes(storage.totalBytes), 'database');
		dashCard(widget, cards, t(state, 'checkpointDashboard.checkpoints'), String(storage.checkpointCount), 'hard-drive', `${storage.blobCount ?? 0} blobs`);
		if (data.storageHistory.length) {
			const rows = fillDailyCarryForward(data.storageHistory.map(row => ({ bucket: row.timestamp, value: row.totalBytes })));
			const card = DOM.append(section, DOM.$('.knox-gui-cp-card.knox-gui-chart-card.is-storage'));
			const head = DOM.append(card, DOM.$('.knox-gui-chart-head'));
			DOM.append(head, DOM.$('p', undefined, t(state, 'checkpointDashboard.storageTrend')));
			daysChip(head, rows.length);
			renderBarChart(widget, card, t(state, 'checkpointDashboard.storageTrend'), rows.map(row => ({ label: row.date, value: row.value })), formatDashboardBytes, CHECKPOINT_STORAGE_FILL[theme], 'Storage', 44, false);
		}
	} else if (state.checkpointDashboardTab === 'activity') {
		content.classList.add('is-fill');
		heading(content, 'activity', 'checkpointDashboard.restorations', true);
		const meta = DOM.append(content, DOM.$('.knox-gui-cp-dash-meta'));
		const rate = summary.restorationSuccessRate;
		const variant = rate >= 90 ? 'default' : rate >= 70 ? 'secondary' : 'destructive';
		cpBadge(meta, variant, `${rate.toFixed(0)}% ${t(state, 'checkpointDashboard.successRate')}`, rate >= 90 ? 'is-green' : rate >= 70 ? 'is-yellow' : 'is-red').setAttribute('data-testid', 'checkpoint-dashboard-rate');
		DOM.append(meta, DOM.$('span.knox-gui-cp-muted', undefined, `${data.restorationEvents.length} ${t(state, 'checkpointDashboard.totalEvents')}`));
		if (!data.restorationEvents.length) {
			emptyCard(content, 'checkpointDashboard.noRestorations');
		} else {
			const list = DOM.append(content, DOM.$('.knox-gui-dash-list'));
			for (const event of data.restorationEvents) {
				const row = DOM.append(list, DOM.$('.knox-gui-cp-card.knox-gui-dash-row', { 'data-testid': 'checkpoint-dashboard-restoration' }));
				appendKnoxGuiSvg(row, event.success ? 'circle-check-big' : 'circle-x', 16).classList.add(event.success ? 'odp-text-green' : 'odp-text-red');
				DOM.append(row, DOM.$('span.knox-gui-cp-mono.knox-gui-dash-grow', undefined, `${event.checkpointId.slice(0, 8)}...`));
				DOM.append(row, DOM.$('span.knox-gui-cp-muted', undefined, `${event.filesRestored} ${t(state, 'checkpointDashboard.files')}`));
				DOM.append(row, DOM.$('span.knox-gui-cp-muted', undefined, formatCheckpointDuration(event.durationMs)));
			}
		}
	} else {
		const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
		heading(section, 'bot', 'checkpointDashboard.aiSessions', true);
		const cards = DOM.append(section, DOM.$('.knox-gui-dash-cards.is-three'));
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalSessions'), String(summary.totalAiSessions), 'bot');
		dashCard(widget, cards, t(state, 'checkpointDashboard.avgChanges'), summary.avgChangesPerSession.toFixed(1), 'trending-up');
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalRollbacks'), String(summary.totalRollbacks), 'activity');
		const list = data.aiSessionMetrics.length ? DOM.append(section, DOM.$('.knox-gui-dash-list.is-capped')) : section;
		for (const session of data.aiSessionMetrics.slice(0, 5)) {
			const card = DOM.append(list, DOM.$('.knox-gui-cp-card.knox-gui-dash-session', { 'data-testid': 'checkpoint-dashboard-session' }));
			const top = DOM.append(card, DOM.$('.knox-gui-dash-session-top'));
			DOM.append(top, DOM.$('span.knox-gui-cp-mono', undefined, `${session.sessionId.slice(0, 8)}...`));
			DOM.append(top, DOM.$('span.knox-gui-cp-muted', undefined, formatCheckpointDuration(session.durationSeconds * 1000)));
			const stats = DOM.append(card, DOM.$('.knox-gui-dash-session-stats'));
			DOM.append(stats, DOM.$('span', undefined, `${session.filesChanged} ${t(state, 'checkpointDashboard.files')}`));
			if (typeof session.linesAdded === 'number') {
				DOM.append(stats, DOM.$('span.is-green', undefined, `+${session.linesAdded}`));
			}
			if (typeof session.linesDeleted === 'number') {
				DOM.append(stats, DOM.$('span.is-red', undefined, `-${session.linesDeleted}`));
			}
			DOM.append(stats, DOM.$('span', undefined, `${session.checkpointsCreated} ${t(state, 'checkpointDashboard.checkpoints')}`));
			if ((session.rollbacks ?? 0) > 0) {
				DOM.append(stats, DOM.$('span.is-orange', undefined, `${session.rollbacks} ${t(state, 'checkpointDashboard.rollbacks')}`));
			}
		}
	}
}

interface ICheckpointChartGeometry {
	left: number;
	right: number;
	top: number;
	bottom: number;
	band: number;
}

/**
 * Recharts `BarChart` geometry from `PerformanceDashboard.tsx`: margin `{ left: 4, right: 8, top: 10, bottom: 4 }`,
 * YAxis `width` / `tickMargin={4}` (tick size 6), XAxis `height={48}` / `tickMargin={10}` / `angle={-35}`,
 * `barCategoryGap="28%"`, `maxBarSize={18}`, drawn at the real pixel width.
 */
function renderBarChart(widget: KnoxGuiWidget, card: HTMLElement, title: string, points: Array<{ label: string; value: number }>, format: (value: number) => string, fill: string, seriesLabel: string, yAxisWidth: number, creation: boolean): void {
	const ns = 'http://www.w3.org/2000/svg';
	const height = 228;
	const ticks = checkpointChartYTicks(Math.max(0, ...points.map(point => point.value)));
	const max = ticks[ticks.length - 1] || 1;
	const interval = checkpointChartTickInterval(points.length);
	const wrap = DOM.append(card, DOM.$('.knox-gui-cp-chart'));
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('class', 'knox-gui-chart');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', title);
	svg.setAttribute('height', String(height));
	wrap.appendChild(svg);
	const el = <K extends keyof SVGElementTagNameMap>(parent: SVGElement, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
		const node = document.createElementNS(ns, tag);
		for (const [key, value] of Object.entries(attrs)) {
			node.setAttribute(key, String(value));
		}
		parent.appendChild(node);
		return node;
	};
	let geometry: ICheckpointChartGeometry = { left: 0, right: 0, top: 0, bottom: 0, band: 0 };
	let cursor: SVGRectElement | undefined;
	const draw = (width: number) => {
		svg.replaceChildren();
		svg.setAttribute('width', String(width));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		const left = 4 + yAxisWidth;
		const right = Math.max(left + 1, width - 8);
		const top = 10;
		const bottom = height - 4 - 48;
		const plotH = bottom - top;
		const band = (right - left) / Math.max(1, points.length);
		geometry = { left, right, top, bottom, band };
		const grid = el(svg, 'g', { class: 'knox-gui-chart-grid-layer' });
		for (const tick of ticks) {
			const y = bottom - (tick / max) * plotH;
			el(grid, 'line', { class: 'knox-gui-chart-grid', x1: left, x2: right, y1: y, y2: y });
			el(svg, 'text', { class: 'knox-gui-chart-tick', x: left - 10, y, dy: '0.355em', 'text-anchor': 'end' }).textContent = format(tick);
		}
		cursor = el(svg, 'rect', { class: 'knox-gui-chart-cursor', x: left, y: top, width: band, height: plotH, visibility: 'hidden' });
		const barW = Math.min(18, band * 0.44);
		points.forEach((point, index) => {
			const h = (point.value / max) * plotH;
			if (h > 0) {
				el(svg, 'rect', { x: left + index * band + (band - barW) / 2, y: bottom - h, width: barW, height: h, fill });
			}
			if (index % (interval + 1) === 0) {
				const cx = left + index * band + band / 2;
				const cy = bottom + 16;
				el(svg, 'text', { class: 'knox-gui-chart-tick', x: cx, y: cy, dy: '0.71em', 'text-anchor': 'end', transform: `rotate(-35 ${cx} ${cy})` }).textContent = point.label;
			}
		});
	};
	draw(wrap.clientWidth || 320);
	if (typeof ResizeObserver !== 'undefined') {
		const observer = new ResizeObserver(() => {
			if (wrap.clientWidth > 0) {
				draw(wrap.clientWidth);
			}
		});
		observer.observe(wrap);
		widget.renderStore.add({ dispose: () => observer.disconnect() });
	}
	attachChartTooltip(widget, wrap, svg, {
		geometry: () => geometry,
		cursor: () => cursor,
		count: points.length,
		item: index => {
			const value = points[index].value;
			return { label: points[index].label, name: seriesLabel, value: creation ? (value ? value.toLocaleString() : undefined) : format(value), dot: creation ? fill : undefined };
		},
	});
}

/** shadcn `ChartTooltipContent` (`indicator="dot"`) placed like the Recharts tooltip: 10px right / below the active band, flipped inside the plot. */
function attachChartTooltip(widget: KnoxGuiWidget, wrap: HTMLElement, svg: SVGSVGElement, chart: { geometry: () => ICheckpointChartGeometry; cursor: () => SVGRectElement | undefined; count: number; item: (index: number) => { label: string; name: string; value?: string; dot?: string } }): void {
	const tip = DOM.append(wrap, DOM.$('.knox-gui-chart-tooltip'));
	tip.hidden = true;
	tip.setAttribute('data-testid', 'knox-gui-chart-tooltip');
	let active = -1;
	const hide = () => {
		active = -1;
		tip.hidden = true;
		tip.classList.remove('is-moving');
		chart.cursor()?.setAttribute('visibility', 'hidden');
	};
	const move = (event: PointerEvent) => {
		const g = chart.geometry();
		const bounds = svg.getBoundingClientRect();
		const x = event.clientX - bounds.left;
		const y = event.clientY - bounds.top;
		if (x < g.left || x > g.right || y < g.top || y > g.bottom || !chart.count) {
			hide();
			return;
		}
		const index = Math.min(chart.count - 1, Math.floor((x - g.left) / g.band));
		if (index !== active) {
			active = index;
			const item = chart.item(index);
			tip.replaceChildren();
			DOM.append(tip, DOM.$('div.knox-gui-chart-tooltip-label', undefined, item.label));
			const row = DOM.append(tip, DOM.$('div.knox-gui-chart-tooltip-row'));
			if (item.dot) {
				DOM.append(row, DOM.$('span.knox-gui-chart-tooltip-dot')).style.background = item.dot;
			}
			const line = DOM.append(row, DOM.$(`div.knox-gui-chart-tooltip-body${item.dot ? '' : '.is-plain'}`));
			DOM.append(line, DOM.$('span.knox-gui-cp-muted', undefined, item.name));
			if (item.value !== undefined) {
				DOM.append(line, DOM.$('span.knox-gui-chart-tooltip-value', undefined, item.value));
			}
			const cursor = chart.cursor();
			cursor?.setAttribute('x', String(g.left + index * g.band));
			cursor?.setAttribute('visibility', 'visible');
		}
		const wasHidden = tip.hidden;
		tip.hidden = false;
		const cx = g.left + index * g.band + g.band / 2;
		const tipX = cx + 10 + tip.offsetWidth > g.right ? Math.max(cx - tip.offsetWidth - 10, g.left) : Math.max(cx + 10, g.left);
		const tipY = y + 10 + tip.offsetHeight > g.bottom ? Math.max(y - tip.offsetHeight - 10, g.top) : Math.max(y + 10, g.top);
		tip.classList.toggle('is-moving', !wasHidden);
		tip.style.transform = `translate(${tipX}px, ${tipY}px)`;
	};
	widget.renderStore.add(DOM.addDisposableListener(svg, 'pointermove', e => move(e as PointerEvent)));
	widget.renderStore.add(DOM.addDisposableListener(svg, 'pointerleave', hide));
}

/** `StatCard` in `PerformanceDashboard.tsx`. */
export function dashCard(widget: KnoxGuiWidget, parent: HTMLElement, label: string, value: string, icon?: KnoxGuiSvgIcon, subtitle?: string): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-cp-card.knox-gui-dash-card'));
	if (icon) {
		appendKnoxGuiSvg(DOM.append(card, DOM.$('.knox-gui-dash-card-icon')), icon, 16);
	}
	const text = DOM.append(card, DOM.$('.knox-gui-dash-card-text'));
	DOM.append(text, DOM.$('p.knox-gui-dash-card-label', { title: label }, label));
	DOM.append(text, DOM.$('p.knox-gui-dash-card-value', undefined, value));
	if (subtitle) {
		DOM.append(text, DOM.$('p.knox-gui-dash-card-sub', undefined, subtitle));
	}
}

export function renderCheckpointAnalysis(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-375
	body.setAttribute('data-testid', 'knox-gui-checkpoint-analysis');
	body.classList.add('knox-gui-cp-view');
	if (state.checkpointAnalysisCatalogLoading) {
		cpLoading(body, t(state, 'checkpointAnalysis.loading'));
		return;
	}
	const root = DOM.append(body, DOM.$('.knox-gui-cp-analysis'));
	const header = DOM.append(root, DOM.$('.knox-gui-checkpoint-analysis-header'));
	DOM.append(header, DOM.$('h2.knox-gui-cp-title', undefined, t(state, 'checkpointAnalysis.title')));
	DOM.append(header, DOM.$('p.knox-gui-cp-subtitle', undefined, t(state, 'checkpointAnalysis.subtitle')));
	const catalog = state.checkpointAnalysisCatalog.length
		? state.checkpointAnalysisCatalog
		: state.checkpoints.map(node => ({ id: node.id, description: node.description }));
	const selectedId = state.checkpointAnalysisId ?? catalog[0]?.id;
	if (!catalog.length) {
		DOM.append(root, DOM.$('p.knox-gui-cp-note', undefined, t(state, 'checkpointAnalysis.empty')));
	} else {
		const field = DOM.append(root, DOM.$('.knox-gui-checkpoint-analysis-field'));
		DOM.append(field, DOM.$('label', { for: 'checkpoint-analysis-select' }, t(state, 'checkpointAnalysis.selectCheckpoint')));
		const select = cpSelect(field, 'checkpoint-analysis-select');
		select.setAttribute('data-testid', 'checkpoint-analysis-select');
		for (const item of catalog) {
			const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			option.value = item.id;
			option.textContent = item.description || item.id.slice(0, 8);
			option.selected = item.id === selectedId;
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => void widget.controller.loadCheckpointAnalysis(select.value)));
	}
	const analysis = state.checkpointAnalysis;
	if (!analysis) {
		if (selectedId) {
			const text = state.checkpointAnalysisPending ? t(state, 'checkpointAnalysis.loading') : t(state, 'checkpointAnalysis.unavailable');
			DOM.append(root, DOM.$('p.knox-gui-cp-note', { 'data-testid': 'checkpoint-analysis-unavailable' }, text));
		}
		renderAnalysisGroups(widget, root, state);
		return;
	}
	const card = DOM.append(root, DOM.$('.knox-gui-cp-card.knox-gui-analysis-card'));
	const summary = DOM.append(card, DOM.$('.odp-callout.knox-gui-analysis-summary'));
	const summaryHead = DOM.append(summary, DOM.$('div.knox-gui-analysis-summary-head.odp-text-comment'));
	appendKnoxGuiSvg(summaryHead, 'file-text', 12);
	DOM.append(summaryHead, DOM.$('span', undefined, t(state, 'checkpointAnalysis.summary')));
	DOM.append(summary, DOM.$('p', undefined, analysis.generatedDescription || t(state, 'checkpointAnalysis.unavailable')));
	if (analysis.counts) {
		const counts = DOM.append(card, DOM.$('.knox-gui-analysis-counts'));
		DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.changed')}: ${analysis.counts.changed}`));
		if (analysis.counts.tests != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.tests')}: ${analysis.counts.tests}`));
		}
		if (analysis.counts.config != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.config')}: ${analysis.counts.config}`));
		}
		if (analysis.counts.lockfile != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.lockfiles')}: ${analysis.counts.lockfile}`));
		}
		if (analysis.impactAnalysis.linesAdded != null) {
			DOM.append(counts, DOM.$('span', undefined, `+${analysis.impactAnalysis.linesAdded} / -${analysis.impactAnalysis.linesDeleted ?? 0} ${t(state, 'checkpointAnalysis.lines')}`));
		}
		if (analysis.impactAnalysis.uniqueDirectories != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.directories')}: ${analysis.impactAnalysis.uniqueDirectories}`));
		}
	}
	const risks = DOM.append(card, DOM.$('.knox-gui-analysis-risks'));
	const chips = DOM.append(risks, DOM.$('.knox-gui-analysis-chips.is-badges'));
	const risk = analysisChip(chips, checkpointRiskChipClass(analysis.riskAssessment.level), t(state, `checkpointAnalysis.risk.${analysis.riskAssessment.level}`), checkpointRiskIcon(analysis.riskAssessment.level));
	risk.setAttribute('data-testid', 'checkpoint-risk-badge');
	DOM.append(risk, DOM.$('span.knox-gui-analysis-score', undefined, `(${analysis.riskAssessment.score.toFixed(1)})`));
	analysisChip(chips, checkpointScopeChipClass(analysis.impactAnalysis.scope), t(state, `checkpointAnalysis.scope.${analysis.impactAnalysis.scope}`), 'target');
	if (analysis.riskAssessment.factors.length) {
		const factors = DOM.append(risks, DOM.$('.knox-gui-analysis-factors'));
		for (const factor of analysis.riskAssessment.factors) {
			const row = DOM.append(factors, DOM.$('.knox-gui-analysis-factor'));
			appendKnoxGuiSvg(row, 'alert-triangle', 12).classList.add('odp-text-yellow');
			const text = DOM.append(row, DOM.$('div'));
			DOM.append(text, DOM.$('span.knox-gui-analysis-factor-category', undefined, factor.category));
			DOM.append(text, DOM.$('span.knox-gui-cp-muted', undefined, ` — ${factor.description}`));
			if (factor.affectedFiles.length) {
				DOM.append(text, DOM.$('span.knox-gui-cp-faint', undefined, ` (${factor.affectedFiles.length} ${t(state, 'checkpointAnalysis.files')})`));
			}
		}
	}
	if (analysis.riskAssessment.recommendations.length) {
		const recs = DOM.append(risks, DOM.$('.odp-callout-blue.knox-gui-analysis-recs', { role: 'alert' }));
		appendKnoxGuiSvg(recs, 'info', 14);
		DOM.append(recs, DOM.$('h5', undefined, t(state, 'checkpointAnalysis.recommendations')));
		const list = DOM.append(DOM.append(recs, DOM.$('div.knox-gui-analysis-recs-body')), DOM.$('ul'));
		for (const rec of analysis.riskAssessment.recommendations) {
			DOM.append(list, DOM.$('li', undefined, rec));
		}
	}
	if (analysis.impactAnalysis.affectedFeatures.length) {
		const areas = DOM.append(card, DOM.$('.knox-gui-analysis-areas'));
		const areaHead = DOM.append(areas, DOM.$('div.knox-gui-analysis-areas-head'));
		appendKnoxGuiSvg(areaHead, 'layers', 12);
		DOM.append(areaHead, DOM.$('span', undefined, t(state, 'checkpointAnalysis.affectedAreas')));
		const wrap = DOM.append(areas, DOM.$('.knox-gui-analysis-chips'));
		for (const feature of analysis.impactAnalysis.affectedFeatures) {
			analysisChip(wrap, checkpointImpactChipClass(feature.impactLevel), `${feature.name} (${feature.changedFiles.length})`);
		}
	}
	if (analysis.impactAnalysis.affectedLayers.length) {
		const wrap = DOM.append(card, DOM.$('.knox-gui-analysis-chips'));
		for (const layer of analysis.impactAnalysis.affectedLayers) {
			analysisChip(wrap, 'odp-chip-muted', layer);
		}
	}
	if (analysis.groupingSuggestion) {
		const suggestion = analysis.groupingSuggestion;
		const group = DOM.append(card, DOM.$('.odp-callout-purple.knox-gui-analysis-grouping'));
		const name = DOM.append(group, DOM.$('div.knox-gui-analysis-grouping-name', undefined, `${t(state, 'checkpointAnalysis.group')}: ${suggestion.groupName}`));
		if (suggestion.kind) {
			DOM.append(name, DOM.$('span.knox-gui-analysis-grouping-kind', undefined, `(${suggestion.kind})`));
		}
		DOM.append(group, DOM.$('div.knox-gui-cp-muted', undefined, suggestion.rationale));
		DOM.append(group, DOM.$('div.knox-gui-cp-faint', undefined, `${t(state, 'checkpointAnalysis.confidence')}: ${Math.round(suggestion.confidence * 100)}% · ${suggestion.checkpointIds.length} ${t(state, 'checkpointAnalysis.checkpoints')}`));
	}
	renderAnalysisGroups(widget, root, state);
}

/** `GroupingSuggestionsList` in `CheckpointAnalysisPanel.tsx`. */
function renderAnalysisGroups(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (!state.checkpointAnalysisGroups.length) {
		return;
	}
	const groups = DOM.append(body, DOM.$('.knox-gui-analysis-groups'));
	DOM.append(groups, DOM.$('div.knox-gui-analysis-groups-head', undefined, t(state, 'checkpointAnalysis.suggestedGroups')));
	for (const group of state.checkpointAnalysisGroups) {
		const card = DOM.append(groups, DOM.$('.knox-gui-cp-card.knox-gui-analysis-group'));
		card.setAttribute('data-testid', 'knox-gui-checkpoint-analysis-group');
		const top = DOM.append(card, DOM.$('.knox-gui-analysis-group-top'));
		DOM.append(top, DOM.$('span.knox-gui-analysis-group-name', undefined, group.groupName));
		cpBadge(top, 'secondary', `${group.checkpointIds.length} ${t(state, 'checkpointAnalysis.checkpoints')}`, 'is-tiny');
		if (group.kind) {
			DOM.append(card, DOM.$('div.knox-gui-cp-faint.knox-gui-analysis-group-kind', undefined, group.kind));
		}
		DOM.append(card, DOM.$('p.knox-gui-cp-muted', undefined, group.rationale));
		DOM.append(card, DOM.$('div.knox-gui-cp-faint.knox-gui-analysis-group-confidence', undefined, `${t(state, 'checkpointAnalysis.confidence')}: ${Math.round(group.confidence * 100)}%`));
		widget.renderStore.add(DOM.addDisposableListener(card, 'click', () => {
			const nextId = group.checkpointIds.find(id => state.checkpointAnalysisCatalog.some(item => item.id === id)) ?? group.checkpointIds[0];
			if (nextId) {
				void widget.controller.loadCheckpointAnalysis(nextId);
			}
		}));
	}
}

/** `RiskBadge` in `CheckpointAnalysisPanel.tsx`. */
export function checkpointRiskIcon(level: string): KnoxGuiSvgIcon {
	return level === 'Low' ? 'shield-check' : level === 'Medium' ? 'shield' : level === 'High' ? 'shield-alert' : 'alert-triangle';
}

function analysisChip(parent: HTMLElement, chipClass: string, label: string, icon?: KnoxGuiSvgIcon): HTMLElement {
	const chip = DOM.append(parent, DOM.$(`span.odp-chip.${chipClass}`, undefined, ''));
	if (icon) {
		appendKnoxGuiSvg(chip, icon, 12);
	}
	chip.append(label);
	return chip;
}

/** `CollaborativePanel.tsx` action colors and outcome badges. */
export function checkpointAuditActionClass(action: string): string {
	if (action.includes('create') || action.includes('share')) {
		return 'is-green';
	}
	if (action.includes('delete') || action.includes('remove')) {
		return 'is-red';
	}
	if (action.includes('restore') || action.includes('rollback')) {
		return 'is-orange';
	}
	return 'is-blue';
}

export function checkpointAuditOutcome(outcome: string): 'OK' | 'FAIL' | 'PARTIAL' {
	if (outcome === 'success' || outcome.includes('Success')) {
		return 'OK';
	}
	if (outcome === 'failure' || outcome.includes('Failure')) {
		return 'FAIL';
	}
	return 'PARTIAL';
}

export function renderCheckpointShare(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-cp-view');
	if (state.checkpointShareLoading) {
		cpLoading(body, t(state, 'checkpointShare.loading'), 'checkpoint-share-loading');
		return;
	}
	body.classList.add('is-fill');
	const root = DOM.append(body, DOM.$('.knox-gui-cp-fill-root'));
	const header = DOM.append(root, DOM.$('.knox-gui-checkpoint-analysis-header'));
	const title = DOM.append(header, DOM.$('h2.knox-gui-cp-title'));
	appendKnoxGuiSvg(title, 'share-2', 16);
	DOM.append(title, DOM.$('span', undefined, t(state, 'checkpointShare.title')));
	DOM.append(header, DOM.$('p.knox-gui-cp-subtitle', undefined, t(state, 'checkpointShare.subtitle')));
	const tabbed = DOM.append(root, DOM.$('.knox-gui-cp-tabbed'));
	const counts = [state.checkpointShareBundles.length, state.checkpointShareAudit.length];
	cpTabs(widget, tabbed, 'knox-gui-checkpoint-share-tabs', [
		{ id: 'shared', svg: 'share-2', label: t(state, 'checkpointShare.shared'), selected: state.checkpointShareTab !== 'audit', testId: 'checkpoint-share-tab-shared', onClick: () => widget.controller.store.patch({ checkpointShareTab: 'shared' }) },
		{ id: 'audit', svg: 'shield', label: t(state, 'checkpointShare.audit'), selected: state.checkpointShareTab === 'audit', testId: 'checkpoint-share-tab-audit', onClick: () => widget.controller.store.patch({ checkpointShareTab: 'audit' }) },
	]).forEach((button, index) => {
		if (counts[index] > 0) {
			cpBadge(button, 'secondary', String(counts[index]), 'knox-gui-checkpoint-share-count');
		}
	});
	const content = DOM.append(tabbed, DOM.$('.knox-gui-cp-tab-content', { role: 'tabpanel' }));
	if (state.checkpointShareTab === 'audit') {
		content.classList.add('is-fill');
		renderCheckpointShareAudit(widget, content, state);
		return;
	}
	const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
	const head = DOM.append(section, DOM.$('.knox-gui-checkpoint-share-head'));
	const h3 = DOM.append(head, DOM.$('h3.knox-gui-cp-heading.is-strong'));
	appendKnoxGuiSvg(h3, 'share-2', 16);
	DOM.append(h3, DOM.$('span', undefined, t(state, 'checkpointShare.sharedBundles')));
	cpButton(widget, head, { variant: 'default', small: true, label: t(state, 'checkpointShare.shareNew'), testId: 'checkpoint-share-new', onClick: () => void widget.controller.shareCheckpoints() });
	if (!state.checkpointShareBundles.length) {
		cpEmptyCard(section, 'share-2', t(state, 'checkpointShare.noBundles'), t(state, 'checkpointShare.shareHint'), 'checkpoint-share-empty');
		return;
	}
	const bundles = DOM.append(section, DOM.$('.knox-gui-checkpoint-bundles'));
	for (const bundle of state.checkpointShareBundles) {
		const card = DOM.append(bundles, DOM.$('.knox-gui-cp-card.knox-gui-checkpoint-bundle', { 'data-testid': 'checkpoint-share-bundle' }));
		const top = DOM.append(card, DOM.$('.knox-gui-checkpoint-bundle-top'));
		const info = DOM.append(top, DOM.$('.knox-gui-checkpoint-bundle-info'));
		DOM.append(info, DOM.$('p.knox-gui-checkpoint-bundle-title', undefined, bundle.description || t(state, 'checkpointShare.untitled')));
		const meta = DOM.append(info, DOM.$('.knox-gui-checkpoint-bundle-meta'));
		const machine = DOM.append(meta, DOM.$('span'));
		appendKnoxGuiSvg(machine, 'monitor', 12);
		DOM.append(machine, DOM.$('span', undefined, `${t(state, 'checkpointShare.thisMachine')}${bundle.machineId && bundle.machineId !== 'unknown' ? ` · ${bundle.machineId.slice(0, 8)}` : ''}`));
		const when = DOM.append(meta, DOM.$('span'));
		appendKnoxGuiSvg(when, 'clock', 12);
		DOM.append(when, DOM.$('span', undefined, bundle.sharedAt ? new Date(bundle.sharedAt).toLocaleDateString() : ''));
		if (bundle.filePath) {
			const path = DOM.append(info, DOM.$('.knox-gui-checkpoint-bundle-path'));
			path.title = bundle.filePath;
			appendKnoxGuiSvg(path, 'file-text', 12);
			DOM.append(path, DOM.$('span.knox-gui-ellipsis', undefined, bundle.filePath));
		}
		const badges = DOM.append(top, DOM.$('.knox-gui-checkpoint-bundle-badges'));
		cpBadge(badges, 'secondary', `${bundle.checkpointCount} ${t(state, 'checkpointShare.checkpointsLabel')}`);
		if (!bundle.exists) {
			cpBadge(badges, 'destructive', t(state, 'checkpointShare.missingFile')).setAttribute('data-testid', 'checkpoint-share-missing');
			continue;
		}
		const actions = DOM.append(card, DOM.$('.knox-gui-checkpoint-bundle-actions'));
		cpButton(widget, actions, { variant: 'outline', small: true, svg: 'download', label: t(state, 'checkpointShare.import'), onClick: () => void widget.controller.importShareBundle(bundle.filePath) });
		cpButton(widget, actions, { variant: 'outline', small: true, svg: 'folder-open', label: t(state, 'checkpointShare.reveal'), onClick: () => void widget.controller.revealShareBundle(bundle.filePath) });
	}
}

/** `CollaborativePanel.tsx` `AuditTrailSection`: heading + empty card, or a scrolling list of expandable cards. */
function renderCheckpointShareAudit(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const root = DOM.append(body, DOM.$('.knox-gui-checkpoint-audit-root'));
	const h3 = DOM.append(root, DOM.$('h3.knox-gui-cp-heading.is-strong'));
	appendKnoxGuiSvg(h3, 'shield', 16);
	DOM.append(h3, DOM.$('span', undefined, t(state, 'checkpointShare.auditTrail')));
	if (!state.checkpointShareAudit.length) {
		cpEmptyCard(root, 'shield', t(state, 'checkpointShare.noAudit'), undefined, 'checkpoint-audit-empty');
		return;
	}
	const list = DOM.append(root, DOM.$('.knox-gui-checkpoint-audit-list'));
	for (const record of state.checkpointShareAudit) {
		const expanded = widget.checkpointShareAuditExpanded === record.id;
		const card = DOM.append(list, DOM.$('.knox-gui-cp-card.knox-gui-checkpoint-audit', { 'data-testid': 'checkpoint-audit-row' }));
		const toggle = DOM.append(card, DOM.$('button.knox-gui-checkpoint-audit-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.setAttribute('aria-expanded', String(expanded));
		appendKnoxGuiSvg(toggle, expanded ? 'chevron-down' : 'chevron-right', 12);
		DOM.append(toggle, DOM.$(`span.knox-gui-checkpoint-audit-action.${checkpointAuditActionClass(record.action)}`, undefined, record.action));
		DOM.append(toggle, DOM.$('span.knox-gui-checkpoint-audit-resource', undefined, `${record.resourceType}/${record.resourceId.slice(0, 8)}...`));
		const outcome = checkpointAuditOutcome(record.outcome);
		cpBadge(toggle, outcome === 'OK' ? 'default' : outcome === 'FAIL' ? 'destructive' : 'secondary', outcome).classList.add('knox-gui-checkpoint-audit-outcome');
		DOM.append(toggle, DOM.$('span.knox-gui-checkpoint-audit-time', undefined, record.timestamp ? new Date(record.timestamp).toLocaleTimeString() : ''));
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
			widget.checkpointShareAuditExpanded = expanded ? null : record.id;
			widget.render();
		}));
		if (!expanded) {
			continue;
		}
		const detail = DOM.append(card, DOM.$('.knox-gui-checkpoint-audit-detail', { 'data-testid': 'checkpoint-audit-detail' }));
		const machine = DOM.append(detail, DOM.$('div.knox-gui-checkpoint-audit-machine'));
		const machineLine = DOM.append(machine, DOM.$('span'));
		DOM.append(machineLine, DOM.$('strong', undefined, `${t(state, 'checkpointShare.machine')}:`));
		DOM.append(machineLine, document.createTextNode(` ${record.machineId || record.userId}`));
		const resource = DOM.append(detail, DOM.$('div'));
		DOM.append(resource, DOM.$('strong', undefined, `${t(state, 'checkpointShare.resource')}:`));
		DOM.append(resource, document.createTextNode(` ${record.resourceType} / ${record.resourceId}`));
		if (record.details && record.details !== '{}') {
			const el = DOM.append(detail, DOM.$('div'));
			DOM.append(el, DOM.$('strong', undefined, `${t(state, 'checkpointShare.details')}:`));
			DOM.append(el, DOM.$('pre.knox-gui-checkpoint-audit-pre', undefined, record.details));
		}
		const result = DOM.append(detail, DOM.$('div'));
		DOM.append(result, DOM.$('strong', undefined, `${t(state, 'checkpointShare.outcome')}:`));
		DOM.append(result, document.createTextNode(` ${record.outcome}`));
	}
}

export function modal(widget: KnoxGuiWidget, parent: HTMLElement, testId: string, onClose?: () => void): HTMLElement {
	const overlay = DOM.append(parent, DOM.$('.knox-gui-modal'));
	if (onClose) {
		widget.renderStore.add(DOM.addDisposableListener(overlay, 'mousedown', e => {
			if (e.target === overlay) {
				onClose();
			}
		}));
	}
	const dialog = DOM.append(overlay, DOM.$('.knox-gui-dialog.knox-gui-modal-dialog'));
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('data-testid', testId);
	return dialog;
}
