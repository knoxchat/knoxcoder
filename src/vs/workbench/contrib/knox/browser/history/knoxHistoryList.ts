/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxSessionMetadata } from '../../common/knoxChatTypes.js';
import {
	formatKnoxSessionDate,
	knoxFilterSessions,
	knoxGroupByDate,
	knoxWorkspaceBasename,
	parseKnoxSessionDate,
} from '../../common/knoxHistory.js';

export interface IKnoxHistoryListOptions {
	compact?: boolean;
}

/**
 * Native conversation history (T7.1). Same widget is used by Lump History
 * and the full-pane overlay opened by `knoxchat.viewHistory` (T7.2).
 */
export class KnoxHistoryList extends Disposable {

	readonly element: HTMLElement;

	private readonly _search: HTMLInputElement;
	private readonly _count: HTMLElement;
	private readonly _toolbar: HTMLElement;
	private readonly _list: HTMLElement;
	private readonly _empty: HTMLElement;
	private readonly _itemStore = this._register(new DisposableStore());

	private _query = '';
	private _selectionMode = false;
	private _selected = new Set<string>();
	private _editingId: string | undefined;
	private _loading = false;

	private readonly _onDidOpenSession = this._register(new Emitter<string>());
	readonly onDidOpenSession = this._onDidOpenSession.event;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		options: IKnoxHistoryListOptions,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IDialogService private readonly _dialogService: IDialogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.knox-history'));
		this.element.classList.toggle('knox-history-compact', options.compact === true);
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.conversationHistory', "Conversation history"));

		const header = append(this.element, $('.knox-history-header'));
		const titleRow = append(header, $('.knox-history-title-row'));
		append(titleRow, $('h2.knox-history-title')).textContent = localize('knox.conversationHistory', "Conversation history");
		this._count = append(titleRow, $('span.knox-history-count'));

		const searchWrap = append(header, $('.knox-history-search'));
		append(searchWrap, $('span')).className = knoxGuiIconClass('lucide-search');
		this._search = append(searchWrap, $<HTMLInputElement>('input.knox-history-search-input'));
		this._search.type = 'search';
		this._search.placeholder = localize('knox.searchConversations', "Search conversations");
		this._search.setAttribute('aria-label', this._search.placeholder);

		this._toolbar = append(this.element, $('.knox-history-toolbar'));
		this._empty = append(this.element, $('.knox-history-empty.hidden'));
		this._list = append(this.element, $('.knox-history-list'));
		this._list.setAttribute('role', 'list');

		const footer = append(this.element, $('.knox-history-footer'));
		append(footer, $('span')).className = knoxGuiIconClass('lucide-info');
		append(footer, $('span')).textContent = localize('knox.conversationsDataStoredAt', "Conversations are stored in this workspace.");

		this._register(addDisposableListener(this._search, 'input', () => {
			this._query = this._search.value;
			this._render();
		}));
		this._register(this._chatService.onDidChange(() => this._render()));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (this._loading) {
			return;
		}
		this._loading = true;
		try {
			await this._chatService.refreshSessionMetadata({});
		} finally {
			this._loading = false;
			this._render();
		}
	}

	focusSearch(): void {
		this._search.focus();
	}

	private _sessions(): IKnoxSessionMetadata[] {
		return knoxFilterSessions(this._chatService.allSessionMetadata, this._query);
	}

	private _render(): void {
		this._itemStore.clear();
		clearNode(this._toolbar);
		clearNode(this._list);
		clearNode(this._empty);

		const sessions = this._sessions();
		this._count.textContent = sessions.length === 1
			? localize('knox.oneConversation', "1 conversation")
			: localize('knox.nConversations', "{0} conversations", sessions.length);

		this._renderToolbar(sessions);
		if (!sessions.length) {
			this._empty.classList.remove('hidden');
			append(this._empty, $('div.knox-history-empty-title')).textContent = localize('knox.noConversationsFound', "No conversations found");
			append(this._empty, $('p')).textContent = localize('knox.noConversationsMessage', "Start a new chat from the Knox sidebar.");
			this._list.classList.add('hidden');
			this._onDidChangeHeight.fire();
			return;
		}

		this._empty.classList.add('hidden');
		this._list.classList.remove('hidden');
		const groups = knoxGroupByDate(sessions, session => parseKnoxSessionDate(session.dateCreated));
		for (const group of groups) {
			const section = append(this._list, $('.knox-history-section'));
			const heading = append(section, $('.knox-history-section-header'));
			append(heading, $('h3')).textContent = group.header;
			append(heading, $('span.knox-history-count')).textContent = String(group.items.length);
			group.items.forEach((session, index) => this._renderRow(section, session, index));
		}
		this._onDidChangeHeight.fire();
	}

	private _renderToolbar(sessions: readonly IKnoxSessionMetadata[]): void {
		if (this._selected.size) {
			const badge = append(this._toolbar, $('span.knox-history-count'));
			badge.textContent = String(this._selected.size);
		}
		const actions = append(this._toolbar, $('.knox-history-toolbar-actions'));
		if (!this._selectionMode) {
			this._toolButton(actions, 'check-square', localize('knox.select', "Select"), () => {
				this._selectionMode = true;
				this._render();
			});
			return;
		}
		this._toolButton(actions, 'check-square', localize('knox.selectAll', "Select all"), () => {
			this._selected = new Set(sessions.map(session => session.sessionId));
			this._render();
		});
		this._toolButton(actions, 'circle-slash', localize('knox.clear', "Clear"), () => {
			this._selected = new Set();
			this._render();
		});
		const del = this._toolButton(
			actions,
			'trash-2',
			localize('knox.deleteCount', "Delete ({0})", this._selected.size),
			() => void this._confirmDeleteSelected(),
		);
		del.disabled = this._selected.size === 0;
		this._toolButton(actions, 'x', localize('knox.exit', "Exit"), () => {
			this._selectionMode = false;
			this._selected = new Set();
			this._render();
		});
	}

	private _renderRow(parent: HTMLElement, session: IKnoxSessionMetadata, index: number): void {
		const selected = this._selected.has(session.sessionId);
		const current = session.sessionId === this._chatService.sessionId;
		const row = append(parent, $('.knox-history-row'));
		row.setAttribute('role', 'listitem');
		row.setAttribute('data-testid', `history-row-${index}`);
		row.classList.toggle('selected', selected);
		row.classList.toggle('current', current);
		row.tabIndex = 0;

		if (this._selectionMode) {
			const check = append(row, $<HTMLButtonElement>('button.knox-history-check'));
			check.type = 'button';
			check.setAttribute('aria-pressed', String(selected));
			append(check, $('span')).className = knoxGuiIconClass(selected ? 'check' : 'square');
			this._itemStore.add(addDisposableListener(check, 'click', e => {
				e.stopPropagation();
				this._toggleSelected(session.sessionId);
			}));
		}

		const body = append(row, $('.knox-history-row-body'));
		if (this._editingId === session.sessionId) {
			const input = append(body, $<HTMLInputElement>('input.knox-history-rename'));
			input.type = 'text';
			input.value = session.title;
			input.setAttribute('aria-label', localize('knox.edit', "Edit"));
			queueMicrotask(() => input.focus());
			this._itemStore.add(addDisposableListener(input, 'keydown', e => {
				if (e.key === 'Enter') {
					e.preventDefault();
					void this._commitRename(session, input.value);
				} else if (e.key === 'Escape') {
					this._editingId = undefined;
					this._render();
				}
			}));
			this._itemStore.add(addDisposableListener(input, 'blur', () => {
				this._editingId = undefined;
				this._render();
			}));
			this._itemStore.add(addDisposableListener(input, 'click', e => e.stopPropagation()));
		} else {
			const title = append(body, $('span.knox-history-row-title'));
			title.textContent = session.title || localize('knox.newChat', "New Chat");
			title.title = session.title;
		}

		const meta = append(body, $('.knox-history-row-meta'));
		const workspace = knoxWorkspaceBasename(session.workspaceDirectory);
		if (workspace) {
			const ws = append(meta, $('span.knox-history-workspace'));
			ws.textContent = workspace;
			ws.title = workspace;
		}
		const date = parseKnoxSessionDate(session.dateCreated);
		const time = append(meta, $<HTMLTimeElement>('time'));
		time.textContent = formatKnoxSessionDate(date);
		if (!isNaN(date.getTime())) {
			time.dateTime = date.toISOString();
			time.title = formatKnoxSessionDate(date);
		}

		if (!this._selectionMode && this._editingId !== session.sessionId) {
			const actions = append(row, $('.knox-history-actions'));
			this._iconButton(actions, 'download', localize('knox.download', "Download"), () => void this._export(session));
			this._iconButton(actions, 'pencil-square', localize('knox.edit', "Edit"), () => {
				this._editingId = session.sessionId;
				this._render();
			});
			this._iconButton(actions, 'trash-2', localize('knox.delete', "Delete"), () => void this._deleteOne(session.sessionId));
		}

		this._itemStore.add(addDisposableListener(row, 'click', () => void this._onRowClick(session)));
		this._itemStore.add(addDisposableListener(row, 'keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				void this._onRowClick(session);
			}
		}));
	}

	private async _onRowClick(session: IKnoxSessionMetadata): Promise<void> {
		if (this._selectionMode) {
			this._toggleSelected(session.sessionId);
			return;
		}
		if (this._editingId) {
			return;
		}
		if (session.sessionId !== this._chatService.sessionId) {
			await this._chatService.loadSession(session.sessionId, this._chatService.history.length > 0);
		}
		this._chatService.setLumpSection(undefined);
		this._onDidOpenSession.fire(session.sessionId);
	}

	private _toggleSelected(sessionId: string): void {
		const next = new Set(this._selected);
		if (next.has(sessionId)) {
			next.delete(sessionId);
		} else {
			next.add(sessionId);
		}
		this._selected = next;
		this._render();
	}

	private async _commitRename(session: IKnoxSessionMetadata, title: string): Promise<void> {
		const next = title.trim();
		this._editingId = undefined;
		if (next && next !== session.title) {
			try {
				await this._chatService.updateSessionTitle(session.sessionId, next);
			} catch (error) {
				this._notificationService.error(error instanceof Error ? error.message : String(error));
			}
		}
		this._render();
	}

	private async _deleteOne(sessionId: string): Promise<void> {
		try {
			await this._chatService.deleteSession(sessionId);
			this._selected.delete(sessionId);
		} catch (error) {
			this._notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private async _confirmDeleteSelected(): Promise<void> {
		if (!this._selected.size) {
			return;
		}
		const confirmed = await this._dialogService.confirm({
			type: 'warning',
			message: localize('knox.deleteConversations', "Delete conversations"),
			detail: localize('knox.confirmDeleteConversations', "Delete {0} conversation(s)? This cannot be undone.", this._selected.size),
			primaryButton: localize('knox.delete', "Delete"),
		});
		if (!confirmed.confirmed) {
			return;
		}
		try {
			await this._chatService.deleteSessions([...this._selected]);
			this._selected = new Set();
			this._selectionMode = false;
		} catch (error) {
			this._notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private async _export(session: IKnoxSessionMetadata): Promise<void> {
		try {
			const exported = await this._chatService.exportSession(session.sessionId);
			if (exported) {
				this._notificationService.info(localize('knox.sessionExportedTo', "Session exported to {0}", exported.filename));
			}
		} catch (error) {
			this._notificationService.error(localize('knox.failedToExportSession', "Failed to export session: {0}", error instanceof Error ? error.message : String(error)));
		}
	}

	private _toolButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.title = label;
		append(button, $('span')).className = knoxGuiIconClass(icon);
		append(button, $('span')).textContent = label;
		this._itemStore.add(addDisposableListener(button, 'click', onClick));
		return button;
	}

	private _iconButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.setAttribute('aria-label', label);
		append(button, $('span')).className = knoxGuiIconClass(icon);
		this._itemStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, label));
		this._itemStore.add(addDisposableListener(button, 'click', e => {
			e.stopPropagation();
			onClick();
		}));
		return button;
	}
}
