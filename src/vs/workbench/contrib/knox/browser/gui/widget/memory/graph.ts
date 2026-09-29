/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Graph tab: stats, entity search/type filters, explore panel, legend and entity list. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import {
	graphEntityColor,
	memoryExploreEdgeDepth,
	memoryGraphTypeCounts,
	visibleMemoryExploreEdges,
} from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	memoryClasses,
	mk,
	svg,
	spinner,
	memoryButton,
} from './kit.js';
import { graphStat, meterHead, meterBar } from './cards.js';
import { applyMemoryGraphFilter } from './filters.js';

export function renderMemoryGraph(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-311
	body.classList.add(...memoryClasses('py-4 sy-4').split(' '));
	const stats = state.memoryGraphStats;
	if (stats) {
		const row = mk(body, 'div', 'grid-3 gap-3');
		graphStat(row, stats.maxEntities ? `${stats.totalEntities}/${stats.maxEntities}` : String(stats.totalEntities), t(state, 'memoryEntities'));
		graphStat(row, String(stats.totalEdges), t(state, 'memoryEdges'));
		graphStat(row, String(Object.keys(stats.entityTypes ?? {}).length), t(state, 'memoryEntityTypesCount'));
		if (stats.maxEntities) {
			const meter = mk(body, 'div', 'sy-1');
			const value = meterHead(meter, t(state, 'memoryGraphCapUtilization'), `${((stats.capUtilization ?? 0) * 100).toFixed(1)}%`);
			if (stats.atCap) {
				mk(value, 'span', 'ml-1 text-amber', t(state, 'memoryGraphAtCap'));
			}
			meterBar(meter, Math.min(100, (stats.capUtilization ?? 0) * 100), stats.atCap ? '#f59e0b' : '#159994');
			mk(meter, 'p', 't-10 o-50', t(state, 'memoryGraphSpreadingHint', { depth: stats.maxDepth ?? 3, gamma: stats.depthDecayGamma ?? 0.7 }));
		}
	}
	const filters = mk(body, 'div', 'flex gap-2');
	const searchWrap = mk(filters, 'div', 'search flex-1 knox-gui-memory-search');
	const search = mk(searchWrap, 'input', 'field graph-search-input');
	search.type = 'text';
	search.placeholder = t(state, 'memorySearchEntities');
	search.value = state.memoryGraphQuery;
	svg(searchWrap, 'search', 14, 'search-icon o-50');
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		widget.controller.store.patch({ memoryGraphQuery: search.value });
		applyMemoryGraphFilter(widget, widget.controller.store.state);
		if (widget.memoryGraphSearchTimer) {
			clearTimeout(widget.memoryGraphSearchTimer);
		}
		widget.memoryGraphSearchTimer = setTimeout(() => {
			widget.memoryGraphSearchTimer = undefined;
			void widget.controller.loadMemoryGraph(false);
		}, 300);
	}));
	const typeCounts = memoryGraphTypeCounts(stats?.entityTypes, state.memoryGraphEntities);
	const typeSelect = mk(filters, 'select', 'dropdown xs');
	typeSelect.setAttribute('data-testid', 'memory-graph-type');
	for (const [value, label] of [['all', t(state, 'memoryAllTypes')] as const, ...typeCounts.map(([type, count]) => [type, `${type} (${count})`] as const)]) {
		const option = mk(typeSelect, 'option', '', label);
		option.value = value;
		option.selected = value === state.memoryGraphFilterType;
	}
	widget.renderStore.add(DOM.addDisposableListener(typeSelect, 'change', () => {
		widget.controller.store.patch({ memoryGraphFilterType: typeSelect.value });
		void widget.controller.loadMemoryGraph(false);
	}));
	if (state.memoryExplore) {
		const explore = state.memoryExplore;
		const panel = mk(body, 'div', 'explore-panel');
		const head = mk(panel, 'div', 'kv mb-2');
		const title = mk(head, 'h3', 'flex items-center gap-2 sm fw-6');
		svg(title, 'compass', 14);
		const centerName = explore.centerName ?? explore.entities.find(entity => entity.id === explore.centerId)?.name ?? '';
		title.append(`${t(state, 'memoryExploring')}: ${centerName}`);
		if (explore.depthReached != null) {
			mk(title, 'span', 'xs o-50', `(${t(state, 'memoryGraphDepth', { count: explore.depthReached })})`);
		}
		const close = memoryButton(widget, head, { tokens: 'explore-close xs o-60', icon: 'x', onClick: () => widget.controller.store.patch({ memoryExplore: undefined }) });
		close.append(` ${t(state, 'memoryClose')}`);
		if (explore.centerDescription) {
			mk(panel, 'p', 'mb-2 xs o-70', explore.centerDescription);
		}
		const edges = visibleMemoryExploreEdges(explore);
		if (!edges.length) {
			mk(panel, 'div', 'xs o-50', t(state, 'memoryGraphNoRelationships'));
		} else {
			const depths = explore.entityDepths;
			const edgeList = mk(panel, 'div', 'explore-edges sy-1');
			for (const edge of edges) {
				const from = explore.entities.find(entity => entity.id === edge.source);
				const to = explore.entities.find(entity => entity.id === edge.target);
				const row = mk(edgeList, 'div', 'flex flex-wrap items-center gap-1_5');
				row.setAttribute('data-testid', 'memory-explore-edge');
				const hop = memoryExploreEdgeDepth(edge, depths);
				const depth = mk(row, 'span', 'edge-depth t-10 o-40', hop === Number.MAX_SAFE_INTEGER ? '' : `d${hop}`);
				if (hop !== Number.MAX_SAFE_INTEGER) {
					depth.setAttribute('data-testid', 'knox-gui-memory-graph-depth');
				}
				entityChip(widget, row, from?.name ?? String(edge.source), from?.entityType, from?.id === explore.centerId, () => void widget.controller.exploreMemoryEntity(edge.source), from?.description ?? from?.entityType);
				mk(row, 'span', 'xs italic o-60', edge.relationship);
				svg(row, 'arrow-right', 10, 'o-40');
				entityChip(widget, row, to?.name ?? String(edge.target), to?.entityType, to?.id === explore.centerId, () => void widget.controller.exploreMemoryEntity(edge.target), to?.description ?? to?.entityType);
			}
		}
		mk(panel, 'div', 'mt-2 xs o-50', `${Math.max(0, explore.entities.length - 1)} ${t(state, 'memoryConnectedEntities')} · ${edges.length} ${t(state, 'memoryRelationships')}`);
	}
	if (typeCounts.length) {
		const legend = mk(body, 'div', 'flex flex-wrap gap-2');
		for (const [type, count] of typeCounts) {
			const color = graphEntityColor(type);
			const active = state.memoryGraphFilterType === type;
			const chip = mk(legend, 'button', 'type-chip');
			chip.type = 'button';
			chip.style.color = color;
			chip.style.border = `1px solid ${active ? color : `${color}30`}`;
			chip.style.backgroundColor = active ? `${color}40` : `${color}15`;
			mk(chip, 'span', 'dot-2').style.backgroundColor = color;
			chip.append(type);
			mk(chip, 'span', 'o-60', `(${count})`);
			widget.renderStore.add(DOM.addDisposableListener(chip, 'click', () => {
				widget.controller.store.patch({ memoryGraphFilterType: active ? 'all' : type });
				void widget.controller.loadMemoryGraph(false);
			}));
		}
	}
	const entities = state.memoryGraphEntities;
	if (state.memoryGraphLoading) {
		const loading = mk(body, 'div', 'py-8 text-center');
		loading.setAttribute('data-testid', 'memory-graph-loading');
		spinner(loading, 24).classList.add('knox-gui-memory-mx-auto');
		return;
	}
	if (state.memoryGraphError) {
		const error = mk(body, 'div', 'sy-2 py-8 text-center sm');
		error.setAttribute('data-testid', 'memory-graph-error');
		mk(error, 'div', 'o-70', `${t(state, 'memoryGraphLoadFailed')}: ${state.memoryGraphError}`);
		memoryButton(widget, error, { tokens: 'retry btn-secondary', label: t(state, 'memoryRetry'), onClick: () => void widget.controller.loadMemoryGraph(false) });
		return;
	}
	if (!entities.length) {
		mk(body, 'div', 'py-8 text-center sm o-50', state.memoryGraphQuery.trim() || state.memoryGraphFilterType !== 'all' ? t(state, 'memoryNoEntitiesFound') : t(state, 'memoryNoEntitiesYet'));
		return;
	}
	const list = mk(body, 'div', 'sy-2');
	const shown = mk(list, 'div', 'xs o-50', t(state, 'memoryGraphShowingEntities', { shown: entities.length, total: state.memoryGraphTotal || entities.length }));
	shown.setAttribute('data-graph-shown-count', '1');
	for (const entity of entities) {
		const color = graphEntityColor(entity.entityType);
		const row = mk(list, 'div', 'entity-row');
		row.setAttribute('data-entity-id', String(entity.id));
		const avatar = mk(row, 'div', 'entity-avatar', (entity.entityType?.[0] ?? '?').toUpperCase());
		avatar.style.backgroundColor = `${color}20`;
		avatar.style.color = color;
		const main = mk(row, 'div', 'min-w-0 flex-1');
		const title = mk(main, 'div', 'flex items-center gap-2');
		mk(title, 'span', 'truncate sm fw-5', entity.name);
		const type = mk(title, 'span', 'row-badge shrink-0', entity.entityType);
		type.style.backgroundColor = `${color}15`;
		type.style.color = color;
		if (entity.description) {
			mk(main, 'p', 'mt-0_5 truncate xs o-60', entity.description);
		}
		const meta = mk(main, 'div', 'mt-0_5 flex items-center gap-3 xs o-40');
		mk(meta, 'span', '', `${t(state, 'memoryEntityMentions')}: ${entity.mentionCount}`);
		if (entity.edgeCount != null) {
			mk(meta, 'span', '', `${t(state, 'memoryGraphEntityEdges')}: ${entity.edgeCount}`);
		}
		const exploring = widget.memoryExploringId === entity.id;
		memoryButton(widget, row, {
			tokens: 'pill-btn shrink-0 btn-secondary',
			icon: 'compass',
			spinning: exploring,
			label: t(state, 'memoryExplore'),
			disabled: exploring,
			onClick: () => {
				widget.memoryExploringId = entity.id;
				widget.controller.store.patch({});
				void widget.controller.exploreMemoryEntity(entity.id).finally(() => {
					widget.memoryExploringId = null;
					widget.controller.store.patch({});
				});
			},
		});
	}
	if (state.memoryGraphHasMore) {
		memoryButton(widget, list, {
			tokens: 'graph-more btn-secondary',
			spinning: state.memoryGraphLoadingMore,
			label: t(state, 'memoryLoadMore'),
			disabled: state.memoryGraphLoadingMore,
			testId: 'memory-graph-load-more',
			onClick: () => void widget.controller.loadMemoryGraph(true),
		});
	}
}

function entityChip(widget: KnoxGuiWidget, parent: HTMLElement, name: string, type: string | undefined, isCenter: boolean, onClick: () => void, title?: string): void {
	const color = graphEntityColor(type);
	const chip = mk(parent, 'button', isCenter ? 'entity-chip fw-7' : 'entity-chip', name);
	chip.type = 'button';
	if (title) {
		chip.title = title;
	}
	if (isCenter) {
		chip.style.backgroundColor = color;
		chip.style.color = '#fff';
	} else {
		chip.style.backgroundColor = `${color}30`;
		chip.style.color = color;
		chip.style.border = `1px solid ${color}50`;
		widget.renderStore.add(DOM.addDisposableListener(chip, 'click', onClick));
	}
}
