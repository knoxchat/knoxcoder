/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
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
	checkpointConfigHasErrors,
	checkpointGraphForceMountKey,
	checkpointGraphLaneColor,
	checkpointConfigHasChanges,
	checkpointImpactChipClass,
	checkpointKindClass,
	checkpointKindI18nKey,
	checkpointRiskChipClass,
	checkpointScopeChipClass,
	checkpointShellAction,
	checkpointShellMessageKey,
	checkpointShellViewState,
	compactAxisNumber,
	computeLineDiff,
	DEFAULT_CHECKPOINT_CONFIG,
	fillDailyCarryForward,
	fillDailyCounts,
	filterCheckpoints,
	formatCheckpointAge,
	formatCheckpointBytes,
	groupCheckpointsByDate,
	groupDiffHunks,
	hunkWordAltRanges,
	parseStorageBytes,
	parseTrackedExtensions,
	remapCheckpointBranchColor,
	restorePreviewActionKey,
	selectCheckpointIdRange,
	validateCheckpointConfig,
	type IKnoxGuiTextRange,
} from '../../../common/knoxGuiCheckpoints.js';
import { languageIdFromFence } from '../../../common/knoxGuiTranscript.js';
import { IKnoxGuiCheckpointDiffFile, IKnoxGuiCheckpointNode, IKnoxGuiState } from '../../../common/knoxGuiState.js';
import { knoxGuiIsMetaEquivalent } from '../../../common/knoxGuiInput.js';
import { renderCheckpointGraph } from './checkpointGraph.js';

export function renderCheckpoints(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-checkpoint-page');
	body.setAttribute('data-testid', 'knox-gui-checkpoints');
	const shell = checkpointShellViewState(state.checkpointShell?.state, state.checkpoints.length, state.checkpointShell?.checkpointCount);
	const tabs = DOM.append(body, DOM.$('.knox-gui-checkpoint-tabs'));
	tabs.setAttribute('data-testid', 'checkpoint-panel-tabs');
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
		const empty = DOM.append(panel, DOM.$('.knox-gui-checkpoint-shell'));
		DOM.append(empty, DOM.$('h1.knox-gui-checkpoint-shell-title', undefined, t(state, 'checkpointGraph.title')));
		const status = DOM.append(empty, DOM.$('p.knox-gui-muted', undefined, t(state, checkpointShellMessageKey(shell), { count: state.checkpointShell?.checkpointCount ?? 0 })));
		status.setAttribute('data-testid', 'checkpoint-graph-status');
		const action = checkpointShellAction(shell);
		if (action) {
			widget.chromeButton(empty, {
				label: t(state, action.key),
				onClick: () => widget.controller.messenger.post('runCheckpointGraphAction', { action: action.action }),
			});
		}
	} else {
		mountCheckpointGraph(widget, panel, state);
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
	if (state.checkpointDialog === 'restore') {
		widget.renderRestorePreviewDialog(body, state);
	} else if (state.checkpointDialog === 'compare') {
		widget.renderCompareDialog(body, state);
	}
	if (widget.checkpointDetailsId) {
		renderCheckpointDetailsDialog(widget, body, state);
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

export function renderCheckpointList(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.setAttribute('data-testid', 'checkpoint-list');
	body.tabIndex = 0;
	widget.renderStore.add(DOM.addDisposableListener(body, 'keydown', e => onCheckpointListKeyDown(widget, e, state)));
	const header = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-head'));
	DOM.append(header, DOM.$('h1', undefined, t(state, 'checkpoints')));
	const meta = DOM.append(header, DOM.$('.knox-gui-row'));
	widget.chromeButton(meta, {
		label: t(state, 'thisSession'),
		selected: state.checkpointThisSession,
		onClick: () => {
			widget.controller.store.patch({ checkpointThisSession: !state.checkpointThisSession });
			void widget.controller.loadCheckpointList();
		},
	});
	DOM.append(meta, DOM.$('span.knox-gui-badge', undefined, t(state, 'showingCheckpoints', {
		shown: listCheckpointNodes(state).length,
		total: state.checkpointListTotal || state.checkpointListItems.length || state.checkpoints.length,
	})));
	const search = DOM.append(body, DOM.$('.knox-gui-history-search'));
	const searchIcon = DOM.append(search, DOM.$('span.knox-gui-history-search-icon'));
	appendKnoxGuiSvg(searchIcon, 'search', 14);
	const input = DOM.append(search, DOM.$('input')) as HTMLInputElement;
	input.placeholder = t(state, 'searchByDescriptionOrId');
	input.value = state.checkpointQuery;
	widget.checkpointListSearchInput = input;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.controller.store.patch({ checkpointQuery: input.value });
		void widget.controller.loadCheckpointList();
	}));
	if (state.checkpointQuery) {
		widget.chromeButton(search, {
			svg: 'x',
			svgSize: 12,
			title: t(state, 'clear'),
			extraClass: 'knox-gui-history-search-clear',
			onClick: () => {
				widget.controller.store.patch({ checkpointQuery: '' });
				void widget.controller.loadCheckpointList();
			},
		});
	}
	if (state.checkpointWorkspaceFolders.length > 1) {
		const row = DOM.append(body, DOM.$('.knox-gui-row'));
		DOM.append(row, DOM.$('label', undefined, t(state, 'checkpointWorkspaceFolder')));
		const select = DOM.append(row, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
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
		DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'selectCheckpointToCompare')));
	}
	const nodes = listCheckpointNodes(state);
	const sticky = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-actions'));
	if (widget.checkpointListSelected.size) {
		DOM.append(sticky, DOM.$('span.knox-gui-badge', undefined, t(state, 'selectedCount', { count: widget.checkpointListSelected.size })));
	}
	const actions = DOM.append(sticky, DOM.$('.knox-gui-row'));
	if (!widget.checkpointListSelectMode) {
		widget.chromeButton(actions, {
			svg: 'check-square',
			svgSize: 14,
			label: t(state, 'select'),
			title: t(state, 'selectMultipleCheckpoints'),
			onClick: () => {
				widget.checkpointListSelectMode = true;
				widget.render();
			},
		});
	} else {
		widget.chromeButton(actions, { svg: 'check-square', svgSize: 14, label: t(state, 'selectAll'), onClick: () => { widget.checkpointListSelected = new Set(nodes.map(node => node.id)); widget.render(); } });
		widget.chromeButton(actions, { svg: 'square', svgSize: 14, label: t(state, 'clear'), onClick: () => { widget.checkpointListSelected.clear(); widget.render(); } });
		widget.chromeButton(actions, {
			label: t(state, 'compare'),
			title: t(state, 'compareTwoCheckpoints'),
			disabled: widget.checkpointListSelected.size !== 2,
			onClick: () => {
				const [left, right] = [...widget.checkpointListSelected];
				if (left && right) {
					void widget.controller.openCompareDialog(left, right);
				}
			},
		});
		widget.chromeButton(actions, {
			svg: 'trash',
			svgSize: 14,
			label: t(state, 'deleteCount', { count: widget.checkpointListSelected.size }),
			disabled: widget.checkpointListSelected.size === 0,
			extraClass: 'knox-gui-danger',
			onClick: () => {
				widget.checkpointListDeleteConfirm = true;
				widget.render();
			},
		});
		widget.chromeButton(actions, {
			svg: 'x',
			svgSize: 12,
			label: t(state, 'exit'),
			onClick: () => {
				widget.checkpointListSelectMode = false;
				widget.checkpointListSelected.clear();
				widget.render();
			},
		});
	}
	if (state.checkpointListLoading && !nodes.length) {
		DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'loadingCheckpoints')));
		return;
	}
	if (!nodes.length) {
		const empty = DOM.append(body, DOM.$('.knox-gui-empty'));
		DOM.append(empty, DOM.$('h3', undefined, t(state, 'noCheckpointsFound')));
		DOM.append(empty, DOM.$('p.knox-gui-muted', undefined, t(state, 'noCheckpointsForWorkspace')));
		return;
	}
	for (const group of groupCheckpointsByDate(nodes)) {
		const section = DOM.append(body, DOM.$('.knox-gui-checkpoint-date-group'));
		const head = DOM.append(section, DOM.$('.knox-gui-checkpoint-date-head'));
		DOM.append(head, DOM.$('h2', undefined, t(state, group.header)));
		DOM.append(head, DOM.$('span.knox-gui-badge', undefined, group.checkpoints.length === 1 ? t(state, 'itemCount', { count: 1 }) : t(state, 'itemsCount', { count: group.checkpoints.length })));
		DOM.append(section, DOM.$('hr.knox-gui-rule'));
		for (const node of group.checkpoints) {
			renderCheckpointListCard(widget, section, state, nodes, node);
		}
	}
	if (widget.checkpointListDeleteConfirm) {
		const dialog = widget.modal(body, 'checkpoint-list-delete');
		DOM.append(dialog, DOM.$('h3', undefined, t(state, 'deleteCheckpoints')));
		DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, t(state, 'cannotBeUndone')));
		const row = DOM.append(dialog, DOM.$('.knox-gui-row'));
		widget.chromeButton(row, { label: t(state, 'cancel'), onClick: () => { widget.checkpointListDeleteConfirm = false; widget.render(); } });
		widget.chromeButton(row, {
			label: t(state, 'deleteCheckpointsCount', { count: widget.checkpointListSelected.size }),
			extraClass: 'knox-gui-danger',
			onClick: () => {
				const ids = [...widget.checkpointListSelected];
				widget.checkpointListDeleteConfirm = false;
				widget.checkpointListSelected.clear();
				widget.checkpointListSelectMode = false;
				void widget.controller.deleteSelectedCheckpoints(ids);
			},
		});
	}
	if (state.checkpointListHasMore) {
		widget.chromeButton(body, {
			label: state.checkpointListLoadingMore ? t(state, 'loadingCheckpoints') : t(state, 'loadMoreCheckpoints'),
			disabled: state.checkpointListLoadingMore,
			onClick: () => void widget.controller.loadCheckpointList({ append: true }),
		});
	}
	const footer = DOM.append(body, DOM.$('.knox-gui-checkpoint-list-footer'));
	DOM.append(footer, DOM.$('span.knox-gui-muted', undefined, t(state, 'checkpointDataSavedIn')));
}

function listCheckpointNodes(state: IKnoxGuiState): IKnoxGuiCheckpointNode[] {
	return filterCheckpoints(state.checkpointListItems.length ? state.checkpointListItems : state.checkpoints, {
		query: state.checkpointQuery,
		sessionId: state.sessionId,
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
	widget.renderStore.add(DOM.addDisposableListener(card, 'click', e => {
		if ((e.target as HTMLElement).closest('button, input')) {
			return;
		}
		if (widget.checkpointListSelectMode) {
			selectCheckpointRow(widget, nodes, node.id, !selected, e.shiftKey);
			return;
		}
		widget.checkpointListFocusedId = node.id;
		widget.controller.store.patch({ selectedCheckpointId: node.id });
	}));
	const inner = DOM.append(card, DOM.$('.knox-gui-checkpoint-card-inner'));
	if (widget.checkpointListSelectMode) {
		const box = DOM.append(inner, DOM.$('input.knox-gui-checkpoint-check')) as HTMLInputElement;
		box.type = 'checkbox';
		box.checked = selected;
		widget.renderStore.add(DOM.addDisposableListener(box, 'click', e => e.stopPropagation()));
		widget.renderStore.add(DOM.addDisposableListener(box, 'change', e => {
			selectCheckpointRow(widget, nodes, node.id, box.checked, (e as MouseEvent).shiftKey);
		}));
	}
	const main = DOM.append(inner, DOM.$('.knox-gui-checkpoint-card-main'));
	DOM.append(main, DOM.$('h3.knox-gui-checkpoint-card-title', undefined, node.description || t(state, 'noDescriptionAvailable')));
	const badges = DOM.append(main, DOM.$('.knox-gui-checkpoint-badges'));
	const age = formatCheckpointAge(node.created);
	const ageBadge = DOM.append(badges, DOM.$('span.knox-gui-checkpoint-badge'));
	appendKnoxGuiSvg(ageBadge, 'calendar', 12);
	ageBadge.append(t(state, age.key, age.count != null ? { count: age.count } : undefined));
	const idBadge = widget.chromeButton(badges, {
		svg: 'hash',
		svgSize: 12,
		label: widget.checkpointCopiedId === node.id ? t(state, 'copied') : node.shortId,
		title: widget.checkpointCopiedId === node.id ? t(state, 'copiedToClipboard') : t(state, 'clickToCopyId'),
		extraClass: widget.checkpointCopiedId === node.id ? 'knox-gui-checkpoint-badge is-copied' : 'knox-gui-checkpoint-badge',
		onClick: () => {
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
		},
	});
	void idBadge;
	if (node.pinned) {
		const pin = DOM.append(badges, DOM.$('span.knox-gui-checkpoint-badge'));
		appendKnoxGuiSvg(pin, 'pin', 12);
		pin.append(t(state, 'pinned'));
	}
	for (const tag of node.tags) {
		const chip = DOM.append(badges, DOM.$('span.knox-gui-checkpoint-badge'));
		appendKnoxGuiSvg(chip, 'tag', 12);
		chip.append(tag);
	}
	const files = node.fileChanges;
	const totalFiles = (files?.added ?? 0) + (files?.modified ?? 0) + (files?.deleted ?? 0);
	if (totalFiles > 0) {
		const fileBadge = DOM.append(badges, DOM.$('span.knox-gui-checkpoint-badge'));
		fileBadge.title = t(state, 'fileStatsTooltip', { created: files.added, modified: files.modified, deleted: files.deleted });
		appendKnoxGuiSvg(fileBadge, 'file', 12);
		fileBadge.append(String(totalFiles));
		if (files.added) {
			DOM.append(fileBadge, DOM.$('span.knox-gui-diff-added', undefined, ` +${files.added}`));
		}
		if (files.modified) {
			DOM.append(fileBadge, DOM.$('span.knox-gui-diff-modified', undefined, ` ~${files.modified}`));
		}
		if (files.deleted) {
			DOM.append(fileBadge, DOM.$('span.knox-gui-diff-deleted', undefined, ` −${files.deleted}`));
		}
	}
	const rowActions = DOM.append(main, DOM.$('.knox-gui-checkpoint-card-actions'));
	widget.chromeButton(rowActions, {
		svg: node.pinned ? 'pin' : 'pin-off',
		svgSize: 14,
		label: t(state, node.pinned ? 'unpinCheckpoint' : 'pinCheckpoint'),
		title: t(state, node.pinned ? 'unpinCheckpointTooltip' : 'pinCheckpointTooltip'),
		extraClass: node.pinned ? 'knox-gui-checkpoint-action is-on' : 'knox-gui-checkpoint-action knox-gui-checkpoint-pin',
		onClick: () => void widget.controller.pinCheckpoint(node.id, !node.pinned),
	});
	widget.chromeButton(rowActions, {
		svg: 'info',
		svgSize: 14,
		label: t(state, 'details'),
		title: t(state, 'details'),
		extraClass: 'knox-gui-checkpoint-action knox-gui-checkpoint-details',
		onClick: () => void openCheckpointDetails(widget, node.id),
	});
	widget.chromeButton(rowActions, {
		svg: 'rotate-ccw',
		svgSize: 14,
		label: t(state, 'restore'),
		title: t(state, 'restoreTooltip'),
		extraClass: 'knox-gui-checkpoint-action knox-gui-checkpoint-restore',
		onClick: () => void widget.controller.openRestorePreview(node.id),
	});
	widget.chromeButton(rowActions, {
		svg: 'brain',
		svgSize: 14,
		label: t(state, 'restoreWithMemoryShort'),
		title: t(state, 'restoreWithMemoryTooltip'),
		extraClass: 'knox-gui-checkpoint-action knox-gui-checkpoint-memory',
		onClick: () => void widget.controller.openRestorePreview(node.id, true),
	});
	widget.chromeButton(rowActions, {
		svg: 'trash',
		svgSize: 14,
		label: t(state, 'deleteAction'),
		title: t(state, 'deleteCheckpointTooltip'),
		extraClass: 'knox-gui-checkpoint-action knox-gui-danger',
		onClick: () => {
			widget.checkpointListSelected = new Set([node.id]);
			widget.checkpointListSelectMode = true;
			widget.checkpointListDeleteConfirm = true;
			widget.render();
		},
	});
}

async function openCheckpointDetails(widget: KnoxGuiWidget, checkpointId: string): Promise<void> {
	widget.checkpointDetailsId = checkpointId;
	widget.checkpointDetails = null;
	widget.render();
	try {
		const result = await widget.controller.messenger.request<Record<string, unknown>>('getCheckpointDetails', { checkpointId });
		if (widget.checkpointDetailsId === checkpointId) {
			widget.checkpointDetails = result?.details && typeof result.details === 'object' ? result.details as Record<string, unknown> : result ?? null;
			widget.render();
		}
	} catch {
		if (widget.checkpointDetailsId === checkpointId) {
			widget.render();
		}
	}
}

function renderCheckpointDetailsDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const overlay = DOM.append(parent, DOM.$('.knox-gui-text-dialog.knox-gui-checkpoint-details'));
	overlay.setAttribute('data-testid', 'knox-gui-checkpoint-details');
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', () => {
		widget.checkpointDetailsId = null;
		widget.checkpointDetails = null;
		widget.render();
	}));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel.knox-gui-checkpoint-details-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-modal', 'true');
	const head = DOM.append(box, DOM.$('.knox-gui-row'));
	appendKnoxGuiSvg(head, 'info', 16);
	DOM.append(head, DOM.$('h3', undefined, t(state, 'checkpointDetails')));
	widget.chromeButton(box, {
		svg: 'x',
		svgSize: 20,
		title: t(state, 'close'),
		extraClass: 'knox-gui-text-dialog-close',
		onClick: () => {
			widget.checkpointDetailsId = null;
			widget.checkpointDetails = null;
			widget.render();
		},
	});
	const node = listCheckpointNodes(state).find(item => item.id === widget.checkpointDetailsId)
		?? state.checkpoints.find(item => item.id === widget.checkpointDetailsId);
	if (!node) {
		DOM.append(box, DOM.$('p.knox-gui-muted', undefined, t(state, 'loading')));
		return;
	}
	DOM.append(box, DOM.$('p.knox-gui-muted', undefined, node.id));
	const desc = node.description || t(state, 'noDescriptionAvailable');
	try {
		const parsed = JSON.parse(desc);
		DOM.append(box, DOM.$('div.knox-gui-muted', undefined, t(state, 'formattedJson')));
		DOM.append(box, DOM.$('pre.knox-gui-checkpoint-json', undefined, JSON.stringify(parsed, null, 2)));
	} catch {
		DOM.append(box, DOM.$('p', undefined, desc));
	}
	if (node.tags.length) {
		DOM.append(box, DOM.$('p', undefined, node.tags.join(', ')));
	}
	if (widget.checkpointDetails) {
		DOM.append(box, DOM.$('pre.knox-gui-checkpoint-json', undefined, JSON.stringify(widget.checkpointDetails, null, 2)));
	} else {
		DOM.append(box, DOM.$('p.knox-gui-muted', undefined, t(state, 'loading')));
	}
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
			const anchor = widget.checkpointListAnchorId ?? nextId;
			widget.checkpointListAnchorId = anchor;
			widget.checkpointListSelected = new Set(selectCheckpointIdRange(ordered, anchor, nextId));
		}
		widget.render();
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

export function renderCheckpointTimeline(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const nodes = state.checkpointTimeline.length ? state.checkpointTimeline : state.checkpoints;
	const branches = state.checkpointTimelineBranches.length ? state.checkpointTimelineBranches : state.checkpointBranches;
	const toolbar = DOM.append(body, DOM.$('.knox-gui-row'));
	const search = DOM.append(toolbar, DOM.$('.knox-gui-history-search'));
	const icon = DOM.append(search, DOM.$('span.knox-gui-history-search-icon'));
	appendKnoxGuiSvg(icon, 'search', 14);
	const input = DOM.append(search, DOM.$('input')) as HTMLInputElement;
	input.placeholder = t(state, 'searchCheckpoints');
	input.value = widget.checkpointTimelineQuery;
	widget.checkpointTimelineSearchInput = input;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.checkpointTimelineQuery = input.value;
		widget.render();
	}));
	const kinds = ['manual', 'auto', 'ai', 'merge', 'branch-point'];
	const select = DOM.append(toolbar, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	const all = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
	all.value = '';
	all.textContent = t(state, 'allCheckpoints');
	for (const kind of kinds) {
		const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
		option.value = kind;
		option.textContent = t(state, checkpointKindI18nKey(kind));
		if (widget.checkpointTimelineKind === kind) {
			option.selected = true;
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => {
		widget.checkpointTimelineKind = select.value || null;
		widget.render();
	}));
	if (state.checkpointComparePickId) {
		DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'selectCheckpointToCompare')));
	}
	const filtered = filterCheckpoints(nodes, { query: widget.checkpointTimelineQuery, kinds: widget.checkpointTimelineKind ? [widget.checkpointTimelineKind] : undefined });
	if (!filtered.length) {
		DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointTimeline.loading')));
		return;
	}
	const groups = new Map<string, IKnoxGuiCheckpointNode[]>();
	for (const node of filtered) {
		const key = new Date(node.created).toDateString();
		const list = groups.get(key) ?? [];
		list.push(node);
		groups.set(key, list);
	}
	const headId = state.checkpointHeadId ?? activeHeadId(branches);
	for (const [date, group] of groups) {
		DOM.append(body, DOM.$('div.knox-gui-date-header', undefined, date));
		group.forEach((node, index) => {
			const item = DOM.append(body, DOM.$('.knox-gui-timeline-item'));
			item.setAttribute('data-testid', 'checkpoint-timeline-item');
			const rail = DOM.append(item, DOM.$('.knox-gui-timeline-rail'));
			const branch = branches.find(item => item.id === node.branchId);
			const lane = remapCheckpointBranchColor(branch?.color && /^#[0-9a-fA-F]{6}$/.test(branch.color) ? branch.color : checkpointGraphLaneColor(Math.max(0, branches.findIndex(item => item.id === node.branchId))), false);
			rail.style.setProperty('--knox-gui-branch', lane);
			const dot = DOM.append(rail, DOM.$(`span.knox-gui-timeline-dot.${checkpointKindClass(node.kind)}`));
			appendKnoxGuiSvg(dot, node.kind === 'auto' ? 'zap' : node.kind === 'ai' ? 'bot' : 'git-branch', 12);
			if (index < group.length - 1) {
				DOM.append(rail, DOM.$('.knox-gui-timeline-line'));
			}
			const card = DOM.append(item, DOM.$(node.id === headId ? '.knox-gui-timeline-card.current' : '.knox-gui-timeline-card'));
			card.setAttribute('data-testid', 'checkpoint-timeline-card');
			widget.renderStore.add(DOM.addDisposableListener(card, 'click', () => widget.controller.store.patch({ selectedCheckpointId: node.id })));
			DOM.append(card, DOM.$('div.knox-gui-timeline-title', undefined, node.description || node.shortId));
			const meta = DOM.append(card, DOM.$('.knox-gui-muted'));
			const age = formatCheckpointAge(node.created);
			DOM.append(meta, DOM.$('span', undefined, t(state, age.key, age.count != null ? { count: age.count } : undefined)));
			DOM.append(meta, DOM.$('span.knox-gui-mono', undefined, node.shortId || node.id.slice(0, 8)));
			if (node.fileChanges.added) {
				DOM.append(meta, DOM.$('span.knox-gui-diff-added', undefined, `+${node.fileChanges.added}`));
			}
			if (node.fileChanges.modified) {
				DOM.append(meta, DOM.$('span.knox-gui-diff-modified', undefined, `~${node.fileChanges.modified}`));
			}
			if (node.fileChanges.deleted) {
				DOM.append(meta, DOM.$('span.knox-gui-diff-deleted', undefined, `-${node.fileChanges.deleted}`));
			}
			const expanded = widget.checkpointTimelineExpanded.has(node.id);
			widget.chromeButton(card, {
				svg: expanded ? 'chevron-down' : 'chevron-right',
				svgSize: 12,
				title: t(state, expanded ? 'collapse' : 'expand'),
				onClick: () => {
					if (expanded) {
						widget.checkpointTimelineExpanded.delete(node.id);
					} else {
						widget.checkpointTimelineExpanded.add(node.id);
					}
					widget.render();
				},
			});
			if (expanded) {
				const actions = DOM.append(card, DOM.$('.knox-gui-row'));
				widget.chromeButton(actions, { label: t(state, 'restore'), onClick: () => void widget.controller.openRestorePreview(node.id) });
				widget.chromeButton(actions, { label: t(state, 'compare'), onClick: () => widget.controller.openCompare(node.id) });
				widget.chromeButton(actions, { svg: 'trash', svgSize: 12, title: t(state, 'delete'), onClick: () => void widget.controller.deleteSelectedCheckpoints([node.id]) });
			}
		});
	}
	const footer = DOM.append(body, DOM.$('.knox-gui-timeline-footer'));
	DOM.append(footer, DOM.$('span.knox-gui-muted', undefined, t(state, 'totalCheckpoints', { count: nodes.length })));
	DOM.append(footer, DOM.$('span.knox-gui-muted', undefined, t(state, 'checkpointTimeline.totalBranches', { count: branches.length })));
}

export function renderRestorePreviewDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void { // KN-375
	const dialog = widget.modal(parent, 'restore-preview-dialog');
	const node = state.checkpoints.find(item => item.id === state.checkpointRestoreId);
	DOM.append(dialog, DOM.$('h3', undefined, t(state, 'restorePreviewTitle')));
	DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, node?.description || state.checkpointRestorePreview?.description || t(state, 'restorePreviewSubtitle')));
	if (state.checkpointRestoreLoading) {
		DOM.append(dialog, DOM.$('p', undefined, t(state, 'restorePreviewLoading')));
	} else if (state.checkpointRestoreError) {
		DOM.append(dialog, DOM.$('p.knox-gui-danger-text', undefined, t(state, state.checkpointRestoreError)));
	} else if (state.checkpointRestorePreview && !state.checkpointRestorePreview.files.length) {
		DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, t(state, 'restorePreviewEmpty')));
	} else if (state.checkpointRestorePreview) {
		const preview = state.checkpointRestorePreview;
		const summary = DOM.append(dialog, DOM.$('.knox-gui-row'));
		DOM.append(summary, DOM.$('span.knox-gui-badge', undefined, `${t(state, 'modified')}: ${preview.modified}`));
		DOM.append(summary, DOM.$('span.knox-gui-badge', undefined, `${t(state, 'added')}: ${preview.added}`));
		DOM.append(summary, DOM.$('span.knox-gui-badge', undefined, `${t(state, 'deleted')}: ${preview.deleted}`));
		DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, t(state, 'restorePreviewExtrasHint')));
		const all = DOM.append(dialog, DOM.$('label.knox-gui-row'));
		const allBox = DOM.append(all, DOM.$('input')) as HTMLInputElement;
		allBox.type = 'checkbox';
		allBox.checked = preview.files.length > 0 && state.checkpointRestoreSelected.length === preview.files.length;
		allBox.setAttribute('aria-label', t(state, 'selectAll'));
		widget.renderStore.add(DOM.addDisposableListener(allBox, 'change', () => widget.controller.toggleRestoreAll(allBox.checked)));
		DOM.append(all, DOM.$('span', undefined, t(state, 'selectAll')));
		const list = DOM.append(dialog, DOM.$('ul.knox-gui-restore-files'));
		for (const file of preview.files) {
			const row = DOM.append(list, DOM.$('li.knox-gui-restore-file'));
			const box = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			box.type = 'checkbox';
			box.checked = state.checkpointRestoreSelected.includes(file.relativePath);
			box.setAttribute('aria-label', file.relativePath);
			widget.renderStore.add(DOM.addDisposableListener(box, 'change', () => widget.controller.toggleRestorePath(file.relativePath, box.checked)));
			const meta = DOM.append(row, DOM.$('div'));
			DOM.append(meta, DOM.$('div.knox-gui-mono', undefined, file.relativePath));
			const stats = DOM.append(meta, DOM.$('span.knox-gui-muted'));
			DOM.append(stats, DOM.$(`span.knox-gui-restore-${file.action}`, undefined, t(state, restorePreviewActionKey(file.action))));
			DOM.append(stats, DOM.$('span', undefined, ` +${file.additions}/-${file.deletions} ${t(state, 'restorePreviewHunks', { count: file.hunkCount })}`));
		}
		if (preview.extraPaths.length) {
			DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, `${t(state, 'restorePreviewWillDelete')}: ${preview.extraPaths.join(', ')}`));
		}
		if (preview.skippedFiles.length) {
			DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, `${t(state, 'restorePreviewSkipped')}: ${preview.skippedFiles.map(file => `${file.path} (${file.reason})`).join(', ')}`));
		}
		widget.chromeButton(dialog, {
			label: state.checkpointRestoreShowDiff ? t(state, 'restorePreviewHideDiff') : t(state, 'restorePreviewShowDiff'),
			onClick: () => void widget.controller.toggleRestoreDiff(),
		});
		if (state.checkpointRestoreShowDiff && state.checkpointRestoreDiff) {
			widget.renderDiffViewer(dialog, state, state.checkpointRestoreDiff);
		}
	}
	widget.toggle(dialog, t(state, 'checkpointGraph.menu.restoreMemory'), state.checkpointRestoreMemory, value => widget.controller.store.patch({ checkpointRestoreMemory: value }));
	const actions = DOM.append(dialog, DOM.$('.knox-gui-row'));
	widget.chromeButton(actions, { label: t(state, 'cancel'), onClick: () => widget.controller.closeCheckpointDialog() });
	widget.chromeButton(actions, { label: t(state, 'restoreSelectedCount', { count: state.checkpointRestoreSelected.length }), disabled: state.checkpointRestoreLoading || !state.checkpointRestoreSelected.length, onClick: () => void widget.controller.restoreSelectedFiles() });
	widget.chromeButton(actions, {
		label: state.checkpointRestorePreview && !state.checkpointRestorePreview.files.length ? t(state, 'restoreAnyway') : t(state, 'restoreAll'),
		disabled: state.checkpointRestoreLoading || Boolean(state.checkpointRestoreError),
		onClick: () => void widget.controller.restoreAllFiles(),
	});
}

export function renderCompareDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const dialog = widget.modal(parent, 'checkpoint-compare-dialog');
	dialog.classList.add('knox-gui-dialog-wide');
	DOM.append(dialog, DOM.$('h3', undefined, t(state, 'compareTwoCheckpoints')));
	const left = state.checkpoints.find(node => node.id === state.checkpointCompareLeftId);
	const right = state.checkpoints.find(node => node.id === state.checkpointCompareRightId);
	DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, `${(left?.description || state.checkpointCompareLeftId || '').slice(0, 48)} → ${(right?.description || state.checkpointCompareRightId || '').slice(0, 48)}`));
	if (state.checkpointCompareLoading) {
		DOM.append(dialog, DOM.$('p', undefined, t(state, 'loadingPreviousCheckpoint')));
	} else if (state.checkpointCompareError) {
		DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, t(state, state.checkpointCompareError)));
	} else if (state.checkpointCompareDiff) {
		widget.renderDiffViewer(dialog, state, state.checkpointCompareDiff);
	}
	widget.chromeButton(dialog, { label: t(state, 'close'), onClick: () => widget.controller.closeCheckpointDialog() });
}

export function renderDiffViewer(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, diff: NonNullable<IKnoxGuiState['checkpointCompareDiff']>): void { // KN-375 Pierre word-alt
	const wrap = DOM.append(parent, DOM.$('.knox-gui-diff-viewer'));
	wrap.setAttribute('data-testid', 'checkpoint-diff-viewer');
	const toolbar = DOM.append(wrap, DOM.$('.knox-gui-diff-toolbar'));
	widget.chromeButton(toolbar, { svg: widget.checkpointDiffTreeCollapsed ? 'panel-left-open' : 'panel-left-close', svgSize: 14, title: t(state, 'fileTree'), extraClass: 'knox-gui-ghost', onClick: () => { widget.checkpointDiffTreeCollapsed = !widget.checkpointDiffTreeCollapsed; widget.render(); } });
	widget.chromeButton(toolbar, { svg: 'columns-2', svgSize: 14, label: t(state, 'split'), selected: state.checkpointDiffView === 'split', onClick: () => widget.controller.store.patch({ checkpointDiffView: 'split' }) });
	widget.chromeButton(toolbar, { svg: 'file-text', svgSize: 14, label: t(state, 'unified'), selected: state.checkpointDiffView === 'unified', onClick: () => widget.controller.store.patch({ checkpointDiffView: 'unified' }) });
	widget.chromeButton(toolbar, { svg: 'wrap-text', svgSize: 14, label: t(state, 'wrap'), selected: state.checkpointDiffWrap, onClick: () => widget.controller.store.patch({ checkpointDiffWrap: !state.checkpointDiffWrap }) });
	const split = DOM.append(wrap, DOM.$(widget.checkpointDiffTreeCollapsed ? '.knox-gui-diff-split.tree-collapsed' : '.knox-gui-diff-split'));
	if (!widget.checkpointDiffTreeCollapsed) {
		const tree = DOM.append(split, DOM.$('.knox-gui-file-tree'));
		widget.renderFileTree(tree, state, diff.files, path => widget.controller.store.patch({ checkpointDiffSelectedFile: path }));
	}
	const pane = DOM.append(split, DOM.$('.knox-gui-diff-pane'));
	const selected = diff.files.find(file => file.relativePath === state.checkpointDiffSelectedFile) ?? diff.files[0];
	if (!selected) {
		return;
	}
	const fileHead = DOM.append(pane, DOM.$('.knox-gui-diff-file-head'));
	appendKnoxGuiSvg(fileHead, 'file-text', 14);
	DOM.append(fileHead, DOM.$('div.knox-gui-mono', undefined, selected.relativePath));
	const stats = DOM.append(fileHead, DOM.$('span.knox-gui-diff-file-stats'));
	DOM.append(stats, DOM.$('span.knox-gui-diff-added', undefined, `+${selected.additions}`));
	DOM.append(stats, DOM.$('span.knox-gui-diff-removed', undefined, `-${selected.deletions}`));
	if (selected.isBinary) {
		DOM.append(pane, DOM.$('p.knox-gui-muted', undefined, t(state, 'binaryDiffNotice')));
		DOM.append(pane, DOM.$('p', undefined, `${t(state, 'size')}: ${formatCheckpointBytes((selected.oldContent?.length ?? 0) + (selected.newContent?.length ?? 0))}`));
		return;
	}
	const lines = computeLineDiff(selected.oldContent ?? '', selected.newContent ?? '');
	const hunks = groupDiffHunks(lines);
	const view = DOM.append(pane, DOM.$(state.checkpointDiffWrap ? 'div.knox-gui-diff-hunks.wrap pierre-diff-container' : 'div.knox-gui-diff-hunks.pierre-diff-container'));
	for (const hunk of hunks) {
		const wordAlt = hunkWordAltRanges(hunk.lines);
		const block = DOM.append(view, DOM.$('.knox-gui-diff-hunk'));
		DOM.append(block, DOM.$('div.knox-gui-diff-hunk-head', undefined, `@@ -${hunk.oldStart} +${hunk.newStart} @@`));
		if (state.checkpointDiffView === 'unified') {
			hunk.lines.forEach((line, index) => {
				const row = DOM.append(block, DOM.$(`div.knox-gui-diff-line.knox-gui-diff-${line.type}`));
				DOM.append(row, DOM.$('span.knox-gui-diff-gutter', undefined, line.oldLineNum != null ? String(line.oldLineNum) : ''));
				DOM.append(row, DOM.$('span.knox-gui-diff-gutter', undefined, line.newLineNum != null ? String(line.newLineNum) : ''));
				DOM.append(row, DOM.$('span.knox-gui-diff-sign', undefined, line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '));
				paintDiffCode(widget, DOM.append(row, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[index]);
			});
			continue;
		}
		hunk.lines.forEach((line, index) => {
			const row = DOM.append(block, DOM.$('.knox-gui-diff-split-row'));
			const left = DOM.append(row, DOM.$(line.type === 'added' ? 'span.knox-gui-diff-empty' : `span.knox-gui-diff-cell.knox-gui-diff-${line.type}`));
			if (line.type !== 'added') {
				DOM.append(left, DOM.$('span.knox-gui-diff-gutter', undefined, line.oldLineNum != null ? String(line.oldLineNum) : ''));
				paintDiffCode(widget, DOM.append(left, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[index]);
			}
			const right = DOM.append(row, DOM.$(line.type === 'removed' ? 'span.knox-gui-diff-empty' : `span.knox-gui-diff-cell.knox-gui-diff-${line.type}`));
			if (line.type !== 'removed') {
				DOM.append(right, DOM.$('span.knox-gui-diff-gutter', undefined, line.newLineNum != null ? String(line.newLineNum) : ''));
				paintDiffCode(widget, DOM.append(right, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[index]);
			}
		});
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
	const renderNodes = (nodes: ReturnType<typeof buildCheckpointFileTree>, depth: number) => {
		for (const node of nodes) {
			const row = DOM.append(parent, DOM.$('.knox-gui-file-tree-row'));
			row.style.paddingLeft = `${depth * 12 + 4}px`;
			if (node.path === state.checkpointDiffSelectedFile) {
				row.classList.add('selected');
			}
			appendKnoxGuiSvg(row, node.isDirectory ? 'folder' : 'file', 12);
			DOM.append(row, DOM.$('span.knox-gui-ellipsis', undefined, node.name));
			const file = byPath.get(node.path);
			if (file && !node.isDirectory) {
				const stats = DOM.append(row, DOM.$('span.knox-gui-file-tree-stats'));
				if (file.additions) {
					DOM.append(stats, DOM.$('span.knox-gui-diff-added', undefined, `+${file.additions}`));
				}
				if (file.deletions) {
					DOM.append(stats, DOM.$('span.knox-gui-diff-removed', undefined, `-${file.deletions}`));
				}
			}
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
				if (!node.isDirectory) {
					onSelect(node.path);
				}
			}));
			if (node.children) {
				renderNodes(node.children, depth + 1);
			}
		}
	};
	renderNodes(buildCheckpointFileTree(files.map(file => file.relativePath)), 0);
}

export function renderCheckpointConfig(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const draft = state.checkpointConfigDraft ?? DEFAULT_CHECKPOINT_CONFIG;
	const errors = validateCheckpointConfig(draft);
	const dirty = checkpointConfigHasChanges(draft, state.checkpointConfig);
	if (state.checkpointConfigStatus) {
		DOM.append(body, DOM.$(state.checkpointConfigStatus.type === 'error' ? 'p.knox-gui-danger-text' : 'p.knox-gui-muted', undefined, t(state, state.checkpointConfigStatus.messageKey)));
	}
	const storage = configSection(body, t(state, 'storageLimits'), 'hard-drive');
	widget.numberField(storage, t(state, 'maxCheckpoints'), draft.maxCheckpoints, 1, 10000, value => widget.controller.patchCheckpointConfig({ maxCheckpoints: value }));
	widget.numberField(storage, t(state, 'retentionPeriodDays'), draft.retentionDays, 1, 365, value => widget.controller.patchCheckpointConfig({ retentionDays: value }));
	const storageInput = widget.labeledInput(storage, t(state, 'maxStorageSize'), formatCheckpointBytes(draft.maxStorageBytes), '1 GB');
	widget.renderStore.add(DOM.addDisposableListener(storageInput, 'change', () => {
		const parsed = parseStorageBytes(storageInput.value);
		if (parsed) {
			widget.controller.patchCheckpointConfig({ maxStorageBytes: parsed });
		}
	}));
	widget.numberField(storage, t(state, 'maxFilesPerCheckpoint'), draft.maxFilesPerCheckpoint, 1, 100000, value => widget.controller.patchCheckpointConfig({ maxFilesPerCheckpoint: value }));
	const fileSize = widget.labeledInput(storage, t(state, 'maxFileSize'), formatCheckpointBytes(draft.maxFileSizeBytes), '5 MB');
	widget.renderStore.add(DOM.addDisposableListener(fileSize, 'change', () => {
		const parsed = parseStorageBytes(fileSize.value);
		if (parsed) {
			widget.controller.patchCheckpointConfig({ maxFileSizeBytes: parsed });
		}
	}));
	if (errors.maxFileSizeBytes) {
		DOM.append(storage, DOM.$('p.knox-gui-danger-text', undefined, t(state, 'checkpointInvalidFileSize')));
	}
	widget.toggle(storage, t(state, 'captureBinaryFiles'), draft.captureBinaryFiles, value => widget.controller.patchCheckpointConfig({ captureBinaryFiles: value }));
	widget.toggle(storage, t(state, 'enableCompression'), draft.enableCompression, value => widget.controller.patchCheckpointConfig({ enableCompression: value }));
	widget.toggle(storage, t(state, 'encryptAtRest'), draft.encryptAtRest, value => widget.controller.patchCheckpointConfig({ encryptAtRest: value }));
	const automation = configSection(body, t(state, 'checkpointAutomation'), 'zap');
	widget.toggle(automation, t(state, 'enableAutoCheckpoints'), draft.enableAutoCheckpoints, value => widget.controller.patchCheckpointConfig({ enableAutoCheckpoints: value }));
	widget.toggle(automation, t(state, 'enableTimedAutoCheckpoints'), draft.autoEnabled, value => widget.controller.patchCheckpointConfig({ autoEnabled: value }));
	if (draft.autoEnabled) {
		widget.numberField(automation, t(state, 'autoMinIntervalSeconds'), Math.round(draft.autoMinIntervalMs / 1000), 1, 3600, value => widget.controller.patchCheckpointConfig({ autoMinIntervalMs: value * 1000 }));
		widget.numberField(automation, t(state, 'autoFileChangeThreshold'), draft.autoFileChangeThreshold, 1, 10000, value => widget.controller.patchCheckpointConfig({ autoFileChangeThreshold: value }));
		widget.toggle(automation, t(state, 'autoShowNotifications'), draft.autoShowNotifications, value => widget.controller.patchCheckpointConfig({ autoShowNotifications: value }));
	}
	widget.toggle(automation, t(state, 'autoCleanup'), draft.autoCleanup, value => widget.controller.patchCheckpointConfig({ autoCleanup: value }));
	const interval = DOM.append(automation, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	interval.setAttribute('aria-label', t(state, 'checkpointAutomation'));
	for (const option of CHECKPOINT_CLEANUP_INTERVALS) {
		const el = DOM.append(interval, DOM.$('option')) as HTMLOptionElement;
		el.value = String(option.value);
		el.textContent = t(state, option.key);
		if (option.value === draft.cleanupIntervalHours) {
			el.selected = true;
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(interval, 'change', () => widget.controller.patchCheckpointConfig({ cleanupIntervalHours: Number(interval.value) })));
	const extensions = widget.labeledInput(automation, t(state, 'trackedFileExtensions'), draft.trackedExtensions.join(', '), t(state, 'fileExtensionsPlaceholder'));
	widget.renderStore.add(DOM.addDisposableListener(extensions, 'change', () => widget.controller.patchCheckpointConfig({ trackedExtensions: parseTrackedExtensions(extensions.value) })));
	if (checkpointConfigHasErrors(errors)) {
		DOM.append(body, DOM.$('p.knox-gui-danger-text', undefined, t(state, 'checkpointFixValidationErrors')));
	}
	const actions = DOM.append(body, DOM.$('.knox-gui-config-actions'));
	widget.chromeButton(actions, { svg: 'timer', svgSize: 14, label: t(state, 'reset'), extraClass: 'knox-gui-ghost', onClick: () => widget.controller.resetCheckpointConfigToDefaults() });
	widget.chromeButton(actions, { svg: 'x', svgSize: 14, label: t(state, 'cancel'), extraClass: 'knox-gui-ghost', disabled: !dirty, onClick: () => widget.controller.cancelCheckpointConfig() });
	widget.chromeButton(actions, { label: t(state, 'save'), disabled: !dirty || checkpointConfigHasErrors(errors), onClick: () => void widget.controller.saveCheckpointConfig() });
}

function configSection(body: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = DOM.append(body, DOM.$('.knox-gui-config-card'));
	const head = DOM.append(card, DOM.$('.knox-gui-config-card-head'));
	appendKnoxGuiSvg(head, icon, 16);
	DOM.append(head, DOM.$('strong', undefined, title));
	return DOM.append(card, DOM.$('.knox-gui-config-card-body'));
}

export function renderCheckpointDashboard(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-375
	const data = state.checkpointDashboard;
	if (!data) {
		DOM.append(body, DOM.$('p', undefined, t(state, 'checkpointDashboard.loading')));
		return;
	}
	body.setAttribute('data-testid', 'knox-gui-checkpoint-dashboard');
	const title = DOM.append(body, DOM.$('h2.knox-gui-dash-title'));
	appendKnoxGuiSvg(title, 'bar-chart-3', 16);
	title.append(` ${t(state, 'checkpointDashboard.title')}`);
	const tabs = DOM.append(body, DOM.$('.knox-gui-dash-tabs'));
	for (const tab of ['overview', 'storage', 'activity', 'ai'] as const) {
		widget.chromeButton(tabs, { label: t(state, `checkpointDashboard.${tab}`), selected: state.checkpointDashboardTab === tab, extraClass: 'knox-gui-dash-tab', onClick: () => widget.controller.store.patch({ checkpointDashboardTab: tab }) });
	}
	const summary = data.summary;
	if (state.checkpointDashboardTab === 'overview') {
		const cards = DOM.append(body, DOM.$('.knox-gui-dash-cards'));
		widget.dashCard(cards, t(state, 'checkpointDashboard.totalCheckpoints'), String(summary.totalCheckpointsCreated));
		widget.dashCard(cards, t(state, 'checkpointDashboard.restorationRate'), `${Math.round(summary.restorationSuccessRate)}%`);
		widget.dashCard(cards, t(state, 'checkpointDashboard.avgCreateTime'), `${Math.round(summary.avgCreationTimeMs)}ms`);
		widget.dashCard(cards, t(state, 'checkpointDashboard.storageUsed'), formatCheckpointBytes(data.currentStorage?.totalBytes ?? 0));
		renderBarChart(widget, body, state, t(state, 'checkpointDashboard.creationFrequency'), fillDailyCounts(data.creationFrequency).map(row => ({ label: row.date, value: row.count })), compactAxisNumber, t(state, 'checkpointDashboard.createdInRange', { count: fillDailyCounts(data.creationFrequency).reduce((sum, row) => sum + row.count, 0) }));
	} else if (state.checkpointDashboardTab === 'storage') {
		renderLineChart(widget, body, state, t(state, 'checkpointDashboard.storageTrend'), fillDailyCarryForward(data.storageHistory.map(row => ({ bucket: row.timestamp, value: row.totalBytes }))).map(row => ({ label: row.date, value: row.value })), formatCheckpointBytes);
	} else if (state.checkpointDashboardTab === 'activity') {
		renderBarChart(widget, body, state, t(state, 'checkpointDashboard.creationFrequency'), fillDailyCounts(data.creationFrequency).map(row => ({ label: row.date, value: row.count })), compactAxisNumber, t(state, 'checkpointDashboard.createdInRange', { count: fillDailyCounts(data.creationFrequency).reduce((sum, row) => sum + row.count, 0) }));
		DOM.append(body, DOM.$('h4', undefined, t(state, 'checkpointDashboard.restorations')));
		if (!data.restorationEvents.length) {
			DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointDashboard.noRestorations')));
		}
		for (const event of data.restorationEvents.slice(0, 12)) {
			DOM.append(body, DOM.$('div.knox-gui-muted', undefined, `${event.timestamp} ${event.success ? '✓' : '✕'} ${event.filesRestored} ${t(state, 'checkpointDashboard.files')}`));
		}
	} else {
		const cards = DOM.append(body, DOM.$('.knox-gui-dash-cards'));
		widget.dashCard(cards, t(state, 'checkpointDashboard.totalSessions'), String(summary.totalAiSessions));
		widget.dashCard(cards, t(state, 'checkpointDashboard.avgChanges'), String(summary.avgChangesPerSession));
		widget.dashCard(cards, t(state, 'checkpointDashboard.totalRollbacks'), String(summary.totalRollbacks));
		for (const session of data.aiSessionMetrics.slice(0, 12)) {
			DOM.append(body, DOM.$('div.knox-gui-muted', undefined, `${session.sessionId.slice(0, 8)} ${session.filesChanged} ${t(state, 'checkpointDashboard.files')} ${session.checkpointsCreated} ${t(state, 'checkpointDashboard.checkpoints')}`));
		}
	}
}

function renderBarChart(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, title: string, points: Array<{ label: string; value: number }>, format: (value: number) => string = compactAxisNumber, footer?: string): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-chart-card'));
	const head = DOM.append(card, DOM.$('.knox-gui-chart-head'));
	DOM.append(head, DOM.$('h4', undefined, title));
	if (points.length) {
		DOM.append(head, DOM.$('span.odp-chip.odp-chip-purple', undefined, t(state, 'checkpointDashboard.lastDays', { count: points.length })));
	}
	if (!points.length) {
		DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointDashboard.noData')));
		return;
	}
	const max = Math.max(1, ...points.map(point => point.value));
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 320 120');
	svg.setAttribute('class', 'knox-gui-chart');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', title);
	const gap = 320 / points.length;
	const hits: Array<{ el: SVGElement; label: string; value: string }> = [];
	points.forEach((point, index) => {
		const height = (point.value / max) * 96;
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', String(index * gap + 2));
		rect.setAttribute('y', String(108 - height));
		rect.setAttribute('width', String(Math.max(4, gap - 4)));
		rect.setAttribute('height', String(Math.max(height, 1)));
		rect.setAttribute('fill', '#159994');
		rect.setAttribute('opacity', '0.85');
		svg.appendChild(rect);
		hits.push({ el: rect, label: point.label, value: format(point.value) });
	});
	card.appendChild(svg);
	attachChartTooltip(widget, card, svg, hits);
	const axis = DOM.append(card, DOM.$('.knox-gui-chart-axis'));
	DOM.append(axis, DOM.$('span', undefined, points[0]?.label ?? ''));
	DOM.append(axis, DOM.$('span', undefined, format(max)));
	DOM.append(axis, DOM.$('span', undefined, points[points.length - 1]?.label ?? ''));
	if (footer) {
		DOM.append(card, DOM.$('p.knox-gui-muted.knox-gui-chart-footer', undefined, footer));
	}
}

function renderLineChart(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, title: string, points: Array<{ label: string; value: number }>, format: (value: number) => string = compactAxisNumber): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-chart-card'));
	const head = DOM.append(card, DOM.$('.knox-gui-chart-head'));
	DOM.append(head, DOM.$('h4', undefined, title));
	if (points.length) {
		DOM.append(head, DOM.$('span.odp-chip.odp-chip-purple', undefined, t(state, 'checkpointDashboard.lastDays', { count: points.length })));
	}
	if (!points.length) {
		DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointDashboard.noData')));
		return;
	}
	const max = Math.max(1, ...points.map(point => point.value));
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 320 120');
	svg.setAttribute('class', 'knox-gui-chart');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', title);
	const coords = points.map((point, index) => {
		const x = points.length === 1 ? 160 : (index / (points.length - 1)) * 312 + 4;
		const y = 108 - (point.value / max) * 96;
		return { x, y, point };
	});
	const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
	polyline.setAttribute('fill', 'none');
	polyline.setAttribute('stroke', '#159994');
	polyline.setAttribute('stroke-width', '2');
	polyline.setAttribute('points', coords.map(item => `${item.x},${item.y}`).join(' '));
	svg.appendChild(polyline);
	const hits: Array<{ el: SVGElement; label: string; value: string }> = [];
	for (const item of coords) {
		const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		dot.setAttribute('cx', String(item.x));
		dot.setAttribute('cy', String(item.y));
		dot.setAttribute('r', '4');
		dot.setAttribute('fill', '#159994');
		dot.setAttribute('class', 'knox-gui-chart-dot');
		svg.appendChild(dot);
		hits.push({ el: dot, label: item.point.label, value: format(item.point.value) });
	}
	card.appendChild(svg);
	attachChartTooltip(widget, card, svg, hits);
	const axis = DOM.append(card, DOM.$('.knox-gui-chart-axis'));
	DOM.append(axis, DOM.$('span', undefined, points[0]?.label ?? ''));
	DOM.append(axis, DOM.$('span', undefined, format(max)));
	DOM.append(axis, DOM.$('span', undefined, points[points.length - 1]?.label ?? ''));
}

function attachChartTooltip(widget: KnoxGuiWidget, card: HTMLElement, svg: SVGSVGElement, hits: Array<{ el: SVGElement; label: string; value: string }>): void {
	card.classList.add('knox-gui-chart-card-hover');
	const tip = DOM.append(card, DOM.$('.knox-gui-chart-tooltip'));
	tip.hidden = true;
	tip.setAttribute('data-testid', 'knox-gui-chart-tooltip');
	const show = (hit: { label: string; value: string }, event: PointerEvent) => {
		tip.hidden = false;
		tip.replaceChildren();
		DOM.append(tip, DOM.$('div.knox-gui-chart-tooltip-label', undefined, hit.label));
		DOM.append(tip, DOM.$('div.knox-gui-chart-tooltip-value', undefined, hit.value));
		const bounds = card.getBoundingClientRect();
		tip.style.left = `${Math.min(bounds.width - 8, Math.max(8, event.clientX - bounds.left + 8))}px`;
		tip.style.top = `${Math.max(8, event.clientY - bounds.top - 8)}px`;
	};
	for (const hit of hits) {
		widget.renderStore.add(DOM.addDisposableListener(hit.el, 'pointerenter', e => show(hit, e as PointerEvent)));
		widget.renderStore.add(DOM.addDisposableListener(hit.el, 'pointermove', e => show(hit, e as PointerEvent)));
		widget.renderStore.add(DOM.addDisposableListener(hit.el, 'pointerleave', () => { tip.hidden = true; }));
	}
	void svg;
}

export function dashCard(widget: KnoxGuiWidget, parent: HTMLElement, label: string, value: string): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-dash-card'));
	DOM.append(card, DOM.$('div.knox-gui-muted', undefined, label));
	DOM.append(card, DOM.$('strong', undefined, value));
}

export function renderCheckpointAnalysis(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-375
	body.setAttribute('data-testid', 'knox-gui-checkpoint-analysis');
	if (!state.checkpoints.length) {
		DOM.append(body, DOM.$('p', undefined, t(state, 'checkpointAnalysis.empty')));
		renderAnalysisGroups(widget, body, state);
		return;
	}
	DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointAnalysis.subtitle')));
	const select = DOM.append(body, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	select.setAttribute('aria-label', t(state, 'checkpointAnalysis.selectCheckpoint'));
	for (const node of state.checkpoints) {
		const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
		option.value = node.id;
		option.textContent = `${node.shortId} ${node.description || node.kind}`;
		if (node.id === (state.selectedCheckpointId ?? state.checkpoints[0].id)) {
			option.selected = true;
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => void widget.controller.loadCheckpointAnalysis(select.value)));
	const analysis = state.checkpointAnalysis;
	if (!analysis) {
		DOM.append(body, DOM.$('p', undefined, t(state, 'checkpointAnalysis.loading')));
		renderAnalysisGroups(widget, body, state);
		return;
	}
	const card = DOM.append(body, DOM.$('.knox-gui-analysis-card'));
	const summary = DOM.append(card, DOM.$('.odp-callout'));
	const summaryHead = DOM.append(summary, DOM.$('div.knox-gui-analysis-summary-head'));
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
	const chips = DOM.append(card, DOM.$('.knox-gui-analysis-chips'));
	const risk = analysisChip(chips, checkpointRiskChipClass(analysis.riskAssessment.level), t(state, `checkpointAnalysis.risk.${analysis.riskAssessment.level}`), analysis.riskAssessment.level === 'Critical' || analysis.riskAssessment.level === 'High' ? 'alert-triangle' : 'check');
	DOM.append(risk, DOM.$('span.knox-gui-analysis-score', undefined, `(${analysis.riskAssessment.score})`));
	analysisChip(chips, checkpointScopeChipClass(analysis.impactAnalysis.scope), t(state, `checkpointAnalysis.scope.${analysis.impactAnalysis.scope}`), 'target');
	if (analysis.riskAssessment.factors.length) {
		for (const factor of analysis.riskAssessment.factors) {
			const row = DOM.append(card, DOM.$('.knox-gui-analysis-factor'));
			appendKnoxGuiSvg(row, 'alert-triangle', 12).classList.add('odp-text-yellow');
			DOM.append(row, DOM.$('span', undefined, `${factor.category} — ${factor.description}${factor.affectedFiles.length ? ` (${factor.affectedFiles.length} ${t(state, 'checkpointAnalysis.files')})` : ''}`));
		}
	}
	if (analysis.riskAssessment.recommendations.length) {
		const recs = DOM.append(card, DOM.$('.odp-callout.odp-callout-blue'));
		const recHead = DOM.append(recs, DOM.$('div.knox-gui-analysis-summary-head'));
		appendKnoxGuiSvg(recHead, 'info', 12);
		DOM.append(recHead, DOM.$('span', undefined, t(state, 'checkpointAnalysis.recommendations')));
		const list = DOM.append(recs, DOM.$('ul'));
		for (const rec of analysis.riskAssessment.recommendations) {
			DOM.append(list, DOM.$('li', undefined, rec));
		}
	}
	if (analysis.impactAnalysis.affectedFeatures.length) {
		const areas = DOM.append(card, DOM.$('.knox-gui-analysis-areas'));
		const areaHead = DOM.append(areas, DOM.$('div.knox-gui-analysis-summary-head.knox-gui-muted'));
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
		const group = DOM.append(card, DOM.$('.odp-callout.odp-callout-purple'));
		DOM.append(group, DOM.$('div', undefined, `${t(state, 'checkpointAnalysis.group')}: ${analysis.groupingSuggestion.groupName}${analysis.groupingSuggestion.kind ? ` (${analysis.groupingSuggestion.kind})` : ''}`));
		DOM.append(group, DOM.$('div.knox-gui-muted', undefined, analysis.groupingSuggestion.rationale));
		DOM.append(group, DOM.$('div.knox-gui-muted', undefined, `${t(state, 'checkpointAnalysis.confidence')}: ${Math.round(analysis.groupingSuggestion.confidence * 100)}% · ${analysis.groupingSuggestion.checkpointIds.length} ${t(state, 'checkpointAnalysis.checkpoints')}`));
	}
	renderAnalysisGroups(widget, body, state);
}

function renderAnalysisGroups(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (!state.checkpointAnalysisGroups.length) {
		return;
	}
	DOM.append(body, DOM.$('div.knox-gui-muted', undefined, t(state, 'checkpointAnalysis.suggestedGroups')));
	for (const group of state.checkpointAnalysisGroups) {
		const card = DOM.append(body, DOM.$('.odp-callout.odp-callout-purple'));
		card.setAttribute('data-testid', 'knox-gui-checkpoint-analysis-group');
		DOM.append(card, DOM.$('div', undefined, `${group.groupName}${group.kind ? ` (${group.kind})` : ''}`));
		DOM.append(card, DOM.$('div.knox-gui-muted', undefined, group.rationale));
		DOM.append(card, DOM.$('div.knox-gui-muted', undefined, `${t(state, 'checkpointAnalysis.confidence')}: ${Math.round(group.confidence * 100)}% · ${group.checkpointIds.length} ${t(state, 'checkpointAnalysis.checkpoints')}`));
		widget.renderStore.add(DOM.addDisposableListener(card, 'click', () => {
			const nextId = group.checkpointIds.find(id => state.checkpoints.some(node => node.id === id)) ?? group.checkpointIds[0];
			if (nextId) {
				void widget.controller.loadCheckpointAnalysis(nextId);
			}
		}));
	}
}

function analysisChip(parent: HTMLElement, chipClass: string, label: string, icon?: KnoxGuiSvgIcon): HTMLElement {
	const chip = DOM.append(parent, DOM.$(`span.odp-chip.${chipClass}`, undefined, ''));
	if (icon) {
		appendKnoxGuiSvg(chip, icon, 10);
	}
	chip.append(label);
	return chip;
}

export function renderCheckpointShare(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointShare.subtitle')));
	const tabs = DOM.append(body, DOM.$('.knox-gui-tabs'));
	widget.chromeButton(tabs, { label: t(state, 'checkpointShare.shared'), selected: state.checkpointShareTab === 'shared', onClick: () => widget.controller.store.patch({ checkpointShareTab: 'shared' }) });
	widget.chromeButton(tabs, { label: t(state, 'checkpointShare.audit'), selected: state.checkpointShareTab === 'audit', onClick: () => widget.controller.store.patch({ checkpointShareTab: 'audit' }) });
	if (state.checkpointShareTab === 'audit') {
		if (!state.checkpointShareAudit.length) {
			DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointShare.noAudit')));
		}
		for (const record of state.checkpointShareAudit) {
			DOM.append(body, DOM.$('div.knox-gui-muted', undefined, `${record.timestamp} ${record.action} ${record.outcome} ${record.details}`));
		}
		return;
	}
	widget.chromeButton(body, { label: t(state, 'checkpointShare.shareNew'), onClick: () => void widget.controller.shareCheckpoints() });
	if (!state.checkpointShareBundles.length) {
		DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointShare.noBundles')));
		DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointShare.shareHint')));
		return;
	}
	for (const bundle of state.checkpointShareBundles) {
		const row = DOM.append(body, DOM.$('.knox-gui-settings-card'));
		DOM.append(row, DOM.$('div', undefined, bundle.description || t(state, 'checkpointShare.untitled')));
		DOM.append(row, DOM.$('div.knox-gui-muted', undefined, `${bundle.checkpointCount} ${t(state, 'checkpointShare.checkpointsLabel')} · ${bundle.filePath}`));
		if (!bundle.exists) {
			DOM.append(row, DOM.$('span.knox-gui-danger-text', undefined, t(state, 'checkpointShare.missingFile')));
		}
		const actions = DOM.append(row, DOM.$('.knox-gui-row'));
		widget.chromeButton(actions, { label: t(state, 'checkpointShare.import'), onClick: () => void widget.controller.importShareBundle(bundle.filePath) });
		widget.chromeButton(actions, { label: t(state, 'checkpointShare.reveal'), onClick: () => void widget.controller.revealShareBundle(bundle.filePath) });
	}
}

export function modal(widget: KnoxGuiWidget, parent: HTMLElement, testId: string): HTMLElement {
	const overlay = DOM.append(parent, DOM.$('.knox-gui-modal'));
	const dialog = DOM.append(overlay, DOM.$('.knox-gui-dialog.knox-gui-modal-dialog'));
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('data-testid', testId);
	return dialog;
}
