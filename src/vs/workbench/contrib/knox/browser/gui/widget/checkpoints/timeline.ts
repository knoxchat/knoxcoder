/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Timeline tab: grouped timeline, compare/restore forms and Escape handling. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import {
	activeHeadId,
	checkpointGraphLaneColor,
	checkpointKindI18nKey,
	checkpointRiskChipClass,
	groupTimelineCheckpoints,
	remapCheckpointBranchColor,
} from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { checkpointAgeLabel, checkpointBadge, checkpointButton, checkpointDialog, checkpointDialogHeader, checkpointRiskIcon, checkpointSearch, checkpointSelect } from './primitives.js';

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
