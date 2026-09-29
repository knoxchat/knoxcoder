/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Checkpoints tab: filterable list, cards, multi-select, keyboard navigation and list sync. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { appendShortcut } from '../controls.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { chronologicalCheckpointPair, filterCheckpoints, groupCheckpointsByDate, selectCheckpointIdRange } from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiCheckpointNode, IKnoxGuiState, knoxGuiCheckpointSessionId } from '../../../../common/knoxGuiState.js';
import { knoxGuiIsMetaEquivalent } from '../../../../common/knoxGuiInput.js';
import { openCheckpointDetails } from '../checkpointDetails.js';
import { checkpointAgeLabel, checkpointBadge, checkpointButton, checkpointCheckbox, checkpointDialog, checkpointDialogHeader, checkpointSearch, checkpointSelect } from './primitives.js';

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
