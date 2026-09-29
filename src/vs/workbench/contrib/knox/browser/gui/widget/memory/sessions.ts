/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Sessions tab: session list, cross-session backlog search and the selected session history. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { formatMemoryDate } from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { mk, svg, memoryButton } from './kit.js';
import { applyMemorySessionFilter, memorySessionMatchesQuery } from './filters.js';

export function renderMemorySessions(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-315
	body.classList.add('knox-gui-memory-sessions-view');
	const header = mk(body, 'div', 'kv shrink-0 gap-2');
	const title = mk(header, 'h2', 'flex items-center gap-1_5 sm fw-6');
	svg(title, 'message-square', 14, 'teal');
	title.append(t(state, 'memorySessionHistoryTitle'));
	memoryButton(widget, header, { tokens: 'pill-btn is-quiet btn-secondary', icon: 'refresh-cw', label: t(state, 'memoryRefresh'), onClick: () => void widget.controller.loadMemorySessions() });
	const searchWrap = mk(body, 'div', 'search shrink-0 knox-gui-memory-search');
	svg(searchWrap, 'search', 14, 'search-icon is-session o-40');
	const search = mk(searchWrap, 'input', 'field session-search-input');
	search.type = 'text';
	search.placeholder = t(state, 'memorySessionHistorySearch');
	search.value = state.memorySessionQuery;
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		const value = search.value;
		applyMemorySessionFilter(widget, value);
		widget.controller.store.patch({ memorySessionQuery: value, ...(value.trim().length < 2 ? { memoryBacklogMatches: [] } : {}) });
		if (widget.memorySessionSearchTimer) {
			clearTimeout(widget.memorySessionSearchTimer);
		}
		widget.memorySessionSearchTimer = setTimeout(() => {
			widget.memorySessionSearchTimer = undefined;
			void widget.controller.searchMemoryBacklogs(value);
		}, 350);
	}));
	if (state.memorySessionQuery.trim().length >= 2) {
		const cross = mk(body, 'div', 'panel shrink-0');
		cross.setAttribute('data-testid', 'memory-backlog-search');
		const crossHead = mk(cross, 'div', 'panel-head flex items-center gap-2');
		svg(crossHead, state.memoryBacklogSearching ? 'loader-2' : 'search', 12, state.memoryBacklogSearching ? 'spin' : undefined);
		crossHead.append(t(state, 'memorySessionHistoryCrossSearch', { count: state.memoryBacklogMatches.length }));
		const crossBody = mk(cross, 'div', 'cross-body');
		if (!state.memoryBacklogMatches.length && !state.memoryBacklogSearching) {
			mk(crossBody, 'p', 'px-1 py-2 xs o-50', t(state, 'memorySessionHistoryCrossSearchEmpty'));
		} else {
			const matches = mk(crossBody, 'div', 'sy-1_5');
			for (const match of state.memoryBacklogMatches.slice(0, 15)) {
				const row = mk(matches, 'button', 'cross-match');
				row.type = 'button';
				mk(row, 'div', 'fw-5 o-80', `[${match.kind === 'semantic' ? (match.category ?? match.kind) : (match.role ?? match.kind)}]${match.title ? ` ${match.title}` : ''}`);
				mk(row, 'div', 'clamp-2 o-70', match.content);
				if (match.sessionId) {
					mk(row, 'div', 'mt-0_5 t-10 o-50', t(state, 'memorySessionHistoryCrossSearchSession', { id: match.sessionId.slice(0, 8) }));
					widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => void widget.controller.loadMemorySessionHistory(match.sessionId!)));
				}
			}
		}
	}
	if (state.memorySessionError) {
		const error = mk(body, 'div', 'session-error', t(state, state.memorySessionError));
		error.setAttribute('data-testid', 'memory-session-error');
	}
	const layout = mk(body, 'div', 'session-grid');
	const list = mk(layout, 'div', 'panel session-panel');
	const query = state.memorySessionQuery.trim().toLowerCase();
	const sessions = state.memorySessions;
	const listHead = mk(list, 'div', 'panel-head shrink-0', t(state, 'memorySessionHistoryList', { count: sessions.filter(session => memorySessionMatchesQuery(session, query)).length }));
	listHead.setAttribute('data-testid', 'memory-session-count');
	const listBody = mk(list, 'div', 'panel-scroll');
	if (state.memorySessionsLoading) {
		svg(mk(listBody, 'div', 'center py-8'), 'loader-2', 20, 'spin o-50');
	} else if (!sessions.length) {
		mk(listBody, 'p', 'px-3 py-4 xs o-50', t(state, 'memoryNoSessionsYet'));
	}
	for (const session of state.memorySessionsLoading ? [] : sessions) {
		const selected = session.id === state.memorySelectedSessionId;
		const row = mk(listBody, 'button', selected ? 'session-row selected' : 'session-row');
		row.type = 'button';
		row.setAttribute('data-session-id', session.id);
		row.hidden = Boolean(query) && !memorySessionMatchesQuery(session, query);
		svg(row, 'chevron-right', 12, selected ? 'mt-0_5 teal' : 'mt-0_5');
		const main = mk(row, 'div', 'min-w-0 flex-1');
		const titleRow = mk(main, 'div', 'truncate fw-5', session.title || session.id.slice(0, 12));
		if (session.isActive) {
			mk(titleRow, 'span', 'teal-badge ml-1_5 px-1 t-10', t(state, 'memorySessionActive'));
		}
		mk(main, 'div', 'mt-0_5 o-50', `${t(state, 'memoryMsgs', { count: session.messageCount ?? 0 })} · ${formatMemoryDate(session.updatedAt)}`);
		if (session.summary) {
			mk(main, 'div', 'mt-1 clamp-2 o-60', session.summary);
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => void widget.controller.loadMemorySessionHistory(session.id)));
	}
	const detailPanel = mk(layout, 'div', 'panel session-panel');
	mk(detailPanel, 'div', 'panel-head shrink-0', state.memorySelectedSessionId ? t(state, 'memorySessionHistoryDetail') : t(state, 'memorySessionHistorySelectPrompt'));
	const detail = mk(detailPanel, 'div', 'panel-scroll p-3');
	const history = state.memorySessionHistory;
	if (!state.memorySelectedSessionId) {
		mk(detail, 'p', 'xs o-50', t(state, 'memorySessionHistorySelectPrompt'));
		return;
	}
	if (state.memorySessionHistoryLoading) {
		const loading = mk(detail, 'div', 'center py-8');
		loading.setAttribute('data-testid', 'memory-session-history-loading');
		svg(loading, 'loader-2', 20, 'spin o-50');
		return;
	}
	if (!history) {
		return;
	}
	const content = mk(detail, 'div', 'sy-4');
	const meta = mk(content, 'div', 'grid-2 gap-2 xs');
	const metaCell = (label: string, value: string) => {
		const cell = mk(meta, 'div', '');
		mk(cell, 'span', 'o-50', label);
		mk(cell, 'div', 'fw-5', value);
	};
	metaCell(t(state, 'memorySessionHistoryMessages'), String(history.messageCount ?? history.episodic.length));
	metaCell(t(state, 'memorySessionHistoryTokens'), (history.tokenEstimate ?? 0).toLocaleString());
	metaCell(t(state, 'memoryEpisodic'), String(history.episodic.length));
	metaCell(t(state, 'memorySemantic'), String(history.semantic.length));
	const detailLabel = (parent: HTMLElement, icon: KnoxGuiSvgIcon, label: string) => {
		const el = mk(parent, 'div', 'mb-1_5 flex items-center gap-1 xs fw-5');
		svg(el, icon, 12);
		el.append(label);
	};
	if (history.topics?.length) {
		const topics = mk(content, 'div', '');
		detailLabel(topics, 'tag', t(state, 'memorySessionHistoryTopics'));
		const chips = mk(topics, 'div', 'flex flex-wrap gap-1');
		for (const topic of history.topics) {
			mk(chips, 'span', 'tag-chip badge-colors t-10', topic);
		}
	}
	if (history.episodic.length) {
		const section = mk(content, 'div', '');
		detailLabel(section, 'file-text', t(state, 'memorySessionHistoryEpisodic'));
		const items = mk(section, 'div', 'sy-1_5');
		for (const item of history.episodic.slice(0, 20)) {
			const row = mk(items, 'div', 'detail-card');
			mk(row, 'div', 'mb-0_5 fw-5 capitalize o-70', item.role ?? '');
			mk(row, 'div', 'clamp-3 o-80', item.content);
		}
		if (history.episodic.length > 20) {
			mk(items, 'p', 't-10 o-50', t(state, 'memorySessionHistoryTruncated', { count: history.episodic.length - 20 }));
		}
	}
	if (history.semantic.length) {
		const section = mk(content, 'div', '');
		detailLabel(section, 'lightbulb', t(state, 'memorySessionHistorySemantic'));
		const items = mk(section, 'div', 'sy-1_5');
		for (const item of history.semantic.slice(0, 10)) {
			const row = mk(items, 'div', 'detail-card');
			mk(row, 'div', 'fw-5', `${item.category ? `[${item.category}] ` : ''}${item.title ?? ''}`);
			mk(row, 'div', 'clamp-2 o-70', item.content);
		}
	}
}
