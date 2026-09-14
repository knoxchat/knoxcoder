/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxBacklogMatch,
	IKnoxBrainSession,
	IKnoxSessionHistory,
	KNOX_MEMORY_PROTOCOL,
	knoxMemoryDateLabel,
	knoxMemorySnippet,
	knoxParseBacklogMatches,
	knoxParseBrainSessions,
	knoxParseSessionHistory,
} from '../../common/knoxMemory.js';

export class KnoxMemorySessions extends Disposable {

	readonly element: HTMLElement;
	private readonly _search: HTMLInputElement;
	private readonly _list: HTMLElement;
	private readonly _detail: HTMLElement;
	private readonly _backlog: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private readonly _backlogStore = this._register(new DisposableStore());
	private _sessions: IKnoxBrainSession[] = [];
	private _selectedId: string | undefined;
	private _history: IKnoxSessionHistory | undefined;
	private _query = '';
	private _backlogMatches: IKnoxBacklogMatch[] = [];
	private _searchTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
	) {
		super();
		this.element = append(parent, $('.knox-memory-tab.knox-memory-sessions'));
		const header = append(this.element, $('.knox-history-title-row'));
		append(header, $('h3')).textContent = localize('knox.memorySessionHistoryTitle', "Session history");
		const refresh = append(header, $<HTMLButtonElement>('button.knox-history-tool'));
		refresh.type = 'button';
		append(refresh, $('span')).className = knoxGuiIconClass('refresh-cw');
		append(refresh, $('span')).textContent = localize('knox.memoryRefresh', "Refresh");
		this._register(addDisposableListener(refresh, 'click', () => void this.refresh()));

		const searchWrap = append(this.element, $('.knox-history-search'));
		append(searchWrap, $('span')).className = knoxGuiIconClass('lucide-search');
		this._search = append(searchWrap, $<HTMLInputElement>('input.knox-history-search-input'));
		this._search.type = 'search';
		this._search.placeholder = localize('knox.memorySessionHistorySearch', "Search sessions and backlogs");
		this._register(addDisposableListener(this._search, 'input', () => {
			this._query = this._search.value;
			this._renderList();
			if (this._searchTimer) {
				clearTimeout(this._searchTimer);
			}
			this._searchTimer = setTimeout(() => void this._searchBacklog(), 350);
		}));

		this._backlog = append(this.element, $('.knox-checkpoint-card.hidden'));
		const split = append(this.element, $('.knox-memory-split'));
		this._list = append(split, $('.knox-memory-session-list'));
		this._detail = append(split, $('.knox-memory-session-detail'));
		void this.refresh();
	}

	override dispose(): void {
		if (this._searchTimer) {
			clearTimeout(this._searchTimer);
		}
		super.dispose();
	}

	async refresh(): Promise<void> {
		try {
			this._sessions = knoxParseBrainSessions(await this._bridge.request(KNOX_MEMORY_PROTOCOL.listSessions, { limit: 100 }));
		} catch {
			this._sessions = [];
		}
		this._renderList();
		if (this._selectedId) {
			await this._loadHistory(this._selectedId);
		} else {
			this._renderDetail();
		}
	}

	private _filtered(): IKnoxBrainSession[] {
		const q = this._query.trim().toLowerCase();
		if (!q) {
			return this._sessions;
		}
		return this._sessions.filter(session =>
			session.title.toLowerCase().includes(q)
			|| session.id.toLowerCase().includes(q)
			|| (session.summary ?? '').toLowerCase().includes(q));
	}

	private async _searchBacklog(): Promise<void> {
		const q = this._query.trim();
		if (q.length < 2) {
			this._backlogMatches = [];
			this._renderBacklog();
			return;
		}
		try {
			const folder = this._workspace.getWorkspace().folders[0];
			this._backlogMatches = knoxParseBacklogMatches(await this._bridge.request(KNOX_MEMORY_PROTOCOL.searchBacklogs, {
				query: q,
				limit: 30,
				workspace_dir: folder?.uri.fsPath ?? '',
			}));
		} catch {
			this._backlogMatches = [];
		}
		this._renderBacklog();
	}

	private _renderBacklog(): void {
		this._backlogStore.clear();
		clearNode(this._backlog);
		const q = this._query.trim();
		this._backlog.classList.toggle('hidden', q.length < 2);
		if (q.length < 2) {
			return;
		}
		append(this._backlog, $('h4')).textContent = localize('knox.memorySessionHistoryCrossSearch', "Cross-session matches ({0})", this._backlogMatches.length);
		if (!this._backlogMatches.length) {
			append(this._backlog, $('p.knox-muted')).textContent = localize('knox.memorySessionHistoryCrossSearchEmpty', "No backlog matches.");
			return;
		}
		for (const match of this._backlogMatches.slice(0, 15)) {
			const button = append(this._backlog, $<HTMLButtonElement>('button.knox-memory-backlog'));
			button.type = 'button';
			const sid = match.session_id ?? match.source_session_id;
			append(button, $('div')).textContent = `[${match.kind === 'semantic' ? match.category : match.role}]${match.title ? ` ${match.title}` : ''}`;
			append(button, $('div.knox-muted')).textContent = knoxMemorySnippet(match.content, 140);
			if (sid) {
				append(button, $('div.knox-muted')).textContent = localize('knox.memorySessionHistoryCrossSearchSession', "Session {0}", sid.slice(0, 8));
				this._backlogStore.add(addDisposableListener(button, 'click', () => void this._select(sid)));
			}
		}
	}

	private _renderList(): void {
		this._viewStore.clear();
		clearNode(this._list);
		const rows = this._filtered();
		append(this._list, $('div.knox-muted')).textContent = localize('knox.memorySessionHistoryList', "{0} sessions", rows.length);
		if (!rows.length) {
			append(this._list, $('p.knox-muted')).textContent = localize('knox.memoryNoSessionsYet', "No sessions yet.");
			this._renderBacklog();
			return;
		}
		for (const session of rows) {
			const button = append(this._list, $<HTMLButtonElement>('button.knox-memory-session'));
			button.type = 'button';
			button.classList.toggle('selected', session.id === this._selectedId);
			const title = append(button, $('div.knox-history-row-title'));
			title.textContent = session.title || session.id.slice(0, 12);
			if (session.is_active) {
				const badge = append(title, $('span.knox-memory-chip'));
				badge.textContent = localize('knox.memorySessionActive', "Active");
			}
			append(button, $('div.knox-muted')).textContent = `${localize('knox.memoryMsgs', "{0} messages", session.message_count)} · ${knoxMemoryDateLabel(session.updated_at || session.created_at)}`;
			if (session.summary) {
				append(button, $('div.knox-muted')).textContent = knoxMemorySnippet(session.summary, 120);
			}
			this._viewStore.add(addDisposableListener(button, 'click', () => void this._select(session.id)));
		}
		this._renderBacklog();
	}

	private async _select(id: string): Promise<void> {
		this._selectedId = id;
		this._renderList();
		await this._loadHistory(id);
	}

	private async _loadHistory(id: string): Promise<void> {
		try {
			this._history = knoxParseSessionHistory(await this._bridge.request(KNOX_MEMORY_PROTOCOL.getSessionHistory, {
				sessionId: id,
				episodicLimit: 200,
				semanticLimit: 100,
			}));
		} catch {
			this._history = undefined;
		}
		this._renderDetail();
	}

	private _renderDetail(): void {
		clearNode(this._detail);
		if (!this._selectedId) {
			append(this._detail, $('p.knox-muted')).textContent = localize('knox.memorySessionHistorySelectPrompt', "Select a session to inspect episodic and semantic history.");
			return;
		}
		append(this._detail, $('h4')).textContent = localize('knox.memorySessionHistoryDetail', "Session detail");
		if (!this._history) {
			append(this._detail, $('p.knox-muted')).textContent = localize('knox.memorySessionHistoryLoadError', "Could not load session history.");
			return;
		}
		const grid = append(this._detail, $('.knox-memory-stats'));
		stat(grid, localize('knox.memorySessionHistoryMessages', "Messages"), this._history.message_count);
		stat(grid, localize('knox.memorySessionHistoryTokens', "Tokens"), this._history.token_estimate.toLocaleString());
		stat(grid, localize('knox.memoryEpisodic', "Episodic"), this._history.episodic.length);
		stat(grid, localize('knox.memorySemantic', "Semantic"), this._history.semantic.length);
		if (this._history.topics.length) {
			const chips = append(this._detail, $('.knox-memory-chips'));
			for (const topic of this._history.topics) {
				const chip = append(chips, $('span.knox-memory-chip'));
				chip.textContent = topic.topic;
			}
		}
		if (this._history.episodic.length) {
			append(this._detail, $('h4')).textContent = localize('knox.memorySessionHistoryEpisodic', "Episodic");
			for (const item of this._history.episodic.slice(0, 20)) {
				const card = append(this._detail, $('.knox-checkpoint-card'));
				append(card, $('div')).textContent = item.role;
				append(card, $('div.knox-muted')).textContent = knoxMemorySnippet(item.content, 180);
			}
			if (this._history.episodic.length > 20) {
				append(this._detail, $('p.knox-muted')).textContent = localize('knox.memorySessionHistoryTruncated', "+{0} more", this._history.episodic.length - 20);
			}
		}
		if (this._history.semantic.length) {
			append(this._detail, $('h4')).textContent = localize('knox.memorySessionHistorySemantic', "Semantic");
			for (const item of this._history.semantic.slice(0, 10)) {
				const card = append(this._detail, $('.knox-checkpoint-card'));
				append(card, $('div')).textContent = `[${item.category}] ${item.title}`;
				append(card, $('div.knox-muted')).textContent = knoxMemorySnippet(item.content, 180);
			}
		}
	}
}

function stat(parent: HTMLElement, label: string, value: string | number): void {
	const card = append(parent, $('.knox-memory-stat'));
	append(card, $('div.knox-memory-stat-value')).textContent = typeof value === 'number' ? value.toLocaleString() : value;
	append(card, $('div.knox-muted')).textContent = label;
}
