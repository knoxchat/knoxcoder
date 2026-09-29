/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** In-place filtering of the already-rendered browser, session and graph rows (no re-render while typing). */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { filterAndSortMemories, memoryBrowserEmptyKey } from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';

export function syncMemoryFilters(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	applyMemoryBrowserFilter(widget, state);
	applyMemorySessionFilter(widget, state.memorySessionQuery);
	applyMemoryGraphFilter(widget, state);
}

export function memorySessionMatchesQuery(session: IKnoxGuiState['memorySessions'][number], query: string): boolean {
	if (!query) {
		return true;
	}
	return session.title.toLowerCase().includes(query) || session.id.toLowerCase().includes(query) || (session.summary ?? '').toLowerCase().includes(query);
}

export function applyMemoryBrowserFilter(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const pane = widget.root.querySelector('[data-testid="knox-gui-memory-browser"]') as HTMLElement | null;
	if (!pane) {
		return;
	}
	const matched = new Set(filterAndSortMemories(state.memories, {
		category: state.memoryFilterCategory,
		tier: state.memoryFilterTier,
		pinned: state.memoryFilterPinned,
		sortBy: state.memorySortBy,
		query: widget.memorySearchDraft || state.memoryQuery,
	}).map(memory => memory.id));
	for (const row of pane.querySelectorAll<HTMLElement>('[data-memory-id]')) {
		const id = row.getAttribute('data-memory-id');
		row.hidden = !(id && matched.has(id));
	}
	for (const group of pane.querySelectorAll<HTMLElement>('.knox-gui-memory-date-group')) {
		const visible = group.querySelectorAll('[data-memory-id]:not([hidden])').length;
		group.hidden = visible === 0;
		const count = group.querySelector('[data-memory-group-count]');
		if (count) {
			count.textContent = t(state, 'itemsCount', { count: visible });
		}
	}
	const found = pane.querySelector('[data-memory-found-count]');
	if (found) {
		found.textContent = `${matched.size} ${t(state, 'memoryMemoriesFound')}`;
	}
	const empty = pane.querySelector<HTMLElement>('[data-memory-empty]');
	if (empty) {
		empty.hidden = matched.size > 0;
		empty.textContent = t(state, memoryBrowserEmptyKey(widget.memorySearchDraft || state.memoryQuery, state.memoryFilterPinned, state.memoryFilterTier));
	}
	const clear = pane.querySelector<HTMLElement>('.knox-gui-memory-search-clear');
	if (clear) {
		clear.hidden = !(widget.memorySearchDraft || state.memoryQuery);
	}
}

export function applyMemorySessionFilter(widget: KnoxGuiWidget, query: string): void {
	const pane = widget.root.querySelector('[data-testid="knox-gui-memory-sessions"]') as HTMLElement | null;
	if (!pane) {
		return;
	}
	const q = query.trim().toLowerCase();
	const state = widget.controller.store.state;
	let visible = 0;
	for (const row of pane.querySelectorAll<HTMLElement>('[data-session-id]')) {
		const id = row.getAttribute('data-session-id');
		const session = state.memorySessions.find(item => item.id === id);
		const show = !session || memorySessionMatchesQuery(session, q);
		row.hidden = !show;
		if (show) {
			visible += 1;
		}
	}
	const head = pane.querySelector('[data-testid="memory-session-count"]');
	if (head) {
		head.textContent = t(state, 'memorySessionHistoryList', { count: visible });
	}
}

function memoryGraphEntityMatchesQuery(entity: IKnoxGuiState['memoryGraphEntities'][number], query: string): boolean {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!tokens.length) {
		return true;
	}
	const haystack = [entity.name, entity.entityType, entity.description].filter(Boolean).join(' ').toLowerCase();
	return tokens.every(token => haystack.includes(token));
}

export function applyMemoryGraphFilter(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const pane = widget.root.querySelector('[data-testid="knox-gui-memory-graph"]') as HTMLElement | null;
	if (!pane) {
		return;
	}
	let visible = 0;
	for (const row of pane.querySelectorAll<HTMLElement>('[data-entity-id]')) {
		const id = Number(row.getAttribute('data-entity-id'));
		const entity = state.memoryGraphEntities.find(item => item.id === id);
		const show = !entity || memoryGraphEntityMatchesQuery(entity, state.memoryGraphQuery);
		row.hidden = !show;
		if (show) {
			visible += 1;
		}
	}
	const shown = pane.querySelector('[data-graph-shown-count]');
	if (shown) {
		shown.textContent = t(state, 'memoryGraphShowingEntities', { shown: visible, total: state.memoryGraphTotal || state.memoryGraphEntities.length });
	}
}
